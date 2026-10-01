import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

function failure(status, code, message) { return Object.assign(new Error(message), { status, code }); }

export function createExportService({ now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let active = null; let closed = false;
  function release(lease) {
    if (active !== lease) return;
    for (const timer of lease.timers) cancel(timer);
    lease.abort.abort(); lease.plan = null; lease.state = 'released'; active = null;
  }
  function timer(lease, callback, duration) { const handle = schedule(callback, duration); handle.unref?.(); lease.timers.add(handle); return handle; }
  function reserve() {
    if (closed) throw failure(503, 'EXPORT_UNAVAILABLE', 'Export service is closed.');
    if (active) throw failure(429, 'EXPORT_BUSY', 'An export is being prepared or transferred. Retry when it ends.');
    active = { ticket: randomBytes(32).toString('hex'), state: 'preparing', plan: null, timers: new Set(), abort: new AbortController(), response: null };
    return active;
  }
  function prepare(lease, plan) {
    if (active !== lease || lease.state !== 'preparing') throw failure(410, 'EXPORT_EXPIRED', 'Export preparation was cancelled. Start again.');
    lease.plan = plan; lease.state = 'ready'; lease.expiresAt = now() + 120000;
    lease.readyTimer = timer(lease, () => release(lease), 120000);
    return { downloadUrl: `/api/export/download/${lease.ticket}`, expiresAt: new Date(lease.expiresAt).toISOString(), byteLength: plan.byteLength, fileName: plan.fileName };
  }
  function claim(ticket) {
    if (!/^[a-f0-9]{64}$/.test(ticket)) throw failure(400, 'INVALID_EXPORT_TICKET', 'Invalid download ticket.');
    if (active?.state === 'ready' && now() >= active.expiresAt) release(active);
    if (!active || active.ticket !== ticket || active.state !== 'ready') throw failure(410, 'EXPORT_EXPIRED', 'Download is expired or already used. Start again.');
    active.state = 'claimed'; return active;
  }
  async function send(lease, response, writeHeaders) {
    if (active !== lease || !['ready', 'claimed'].includes(lease.state)) throw failure(410, 'EXPORT_EXPIRED', 'Download is unavailable. Start again.');
    cancel(lease.readyTimer); lease.timers.delete(lease.readyTimer);
    lease.state = 'transferring'; lease.response = response;
    const stop = () => { response.destroy(); release(lease); };
    response.once('close', stop);
    let idle;
    const progress = () => { if (idle) { cancel(idle); lease.timers.delete(idle); } idle = timer(lease, stop, 60000); };
    timer(lease, stop, 1800000); progress();
    const completion = finished(response, { cleanup: true }); completion.catch(() => undefined);
    try {
      const plan = lease.plan; writeHeaders(plan);
      for (const part of plan.buffers()) {
        lease.abort.signal.throwIfAborted();
        let drained;
        const written = new Promise((resolve, reject) => {
          const interrupted = () => { lease.abort.signal.removeEventListener('abort', interrupted); reject(lease.abort.signal.reason); };
          lease.abort.signal.addEventListener('abort', interrupted, { once: true });
          try { drained = response.write(part, (error) => { lease.abort.signal.removeEventListener('abort', interrupted); error ? reject(error) : resolve(); }); }
          catch (error) { lease.abort.signal.removeEventListener('abort', interrupted); reject(error); }
        });
        progress();
        await (drained ? written : Promise.all([written, once(response, 'drain', { signal: lease.abort.signal })]));
      }
      response.end(); await completion;
    } finally { response.removeListener('close', stop); release(lease); }
  }
  function close() { closed = true; if (active) { active.response?.destroy(); release(active); } }
  return { reserve, prepare, claim, send, release, close };
}
