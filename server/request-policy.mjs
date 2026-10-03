import { isIP } from 'node:net';
import { allowedRequestHost, isLoopbackAddress } from './config.mjs';

export function isLocalSettingsRequest(req, requestUrl) {
  // Only the actual local connection grants access. Proxy headers cannot grant it.
  return isLoopbackAddress(req.socket.remoteAddress) && isLoopbackAddress(req.socket.localAddress)
    && (requestUrl.hostname === 'localhost' || isLoopbackAddress(requestUrl.hostname));
}

function reject(status, code, message) { throw Object.assign(new Error(message), { status, code }); }

function singleHeader(req, name, code) {
  const count = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name).length;
  const value = req.headers[name];
  if (count > 1 || Array.isArray(value)) reject(code === 'INVALID_HOST' ? 400 : 403, code, 'A single request header is required.');
  return value;
}

function authority(value) {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]+))?$/i.exec(value || '');
  if (!match || match[1].endsWith('.') || match[1].startsWith('[') && isIP(match[1].slice(1, -1)) !== 6) return null;
  const port = match[2] === undefined ? 80 : Number(match[2]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
  return `${match[1].toLowerCase()}:${port}`;
}

export function validateRequest(req, config) {
  const host = authority(singleHeader(req, 'host', 'INVALID_HOST'));
  if (!host || !allowedRequestHost(config, host, req.socket.localAddress)) reject(400, 'INVALID_HOST', 'Invalid Host header.');
  if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) reject(400, 'INVALID_REQUEST_TARGET', 'An origin-form request target is required.');
  const origin = new URL(`http://${host}`).origin;
  const url = new URL(req.url, origin);
  if (url.origin !== origin) reject(400, 'INVALID_REQUEST_TARGET', 'The request target cannot change authority.');
  if (req.method === 'POST' || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    const supplied = singleHeader(req, 'origin', 'INVALID_ORIGIN');
    const sourceHost = typeof supplied === 'string' && supplied.startsWith('http://') ? authority(supplied.slice(7)) : null;
    if ((supplied !== undefined && sourceHost !== host) || (req.method === 'POST' && !supplied)) reject(403, 'INVALID_ORIGIN', 'Same-origin Origin is required.');
    const site = singleHeader(req, 'sec-fetch-site', 'INVALID_FETCH_METADATA');
    if (site !== undefined && !(req.method === 'POST' ? site === 'same-origin' : ['same-origin', 'none'].includes(site))) reject(403, 'INVALID_FETCH_METADATA', 'Same-origin request metadata is required.');
  }
  return url;
}
