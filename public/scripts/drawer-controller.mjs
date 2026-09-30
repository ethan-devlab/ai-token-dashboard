import { renderSessionDrawer } from './drawer.mjs';
import { t } from './i18n.mjs';

export function createSessionDrawerController({ getState, getElement, loadDetail }) {
  const drawer = getElement('sessionDrawer'); const backdrop = getElement('drawerBackdrop');
  const doc = drawer.ownerDocument; const background = new Map();
  let priorOverflow;
  drawer.innerHTML = '<div class="drawer-heading"><div><p class="eyebrow" data-drawer-heading></p><h2 id="drawerTitle"></h2></div><button id="closeDrawer" type="button"></button></div><div id="drawerContent"></div>';
  const closeButton = drawer.querySelector('#closeDrawer'); const content = drawer.querySelector('#drawerContent');
  function setBackgroundInactive(active) {
    if (active && !background.size) {
      for (const element of drawer.parentElement.children) {
        if (element === drawer || element === backdrop) continue;
        background.set(element, element.inert); element.inert = true;
      }
      priorOverflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden';
    } else if (!active && background.size) {
      for (const [element, wasInert] of background) element.inert = wasInert;
      background.clear(); doc.body.style.overflow = priorOverflow;
    }
  }
  function render(focus = false) {
    const state = getState(); const active = Boolean(state.drawer.sessionKey);
    drawer.hidden = !active; backdrop.hidden = !active; setBackgroundInactive(active);
    if (!active) return;
    drawer.querySelector('[data-drawer-heading]').textContent = t('drawer.title');
    drawer.querySelector('#drawerTitle').textContent = state.drawer.detail?.sessionId || state.drawer.detail?.sessionKey || t('drawer.title');
    closeButton.textContent = t('drawer.close');
    content.setAttribute('aria-busy', String(state.drawer.status === 'loading'));
    const hadContentFocus = content.contains(doc.activeElement);
    content.innerHTML = renderSessionDrawer({ detail: state.drawer.detail, status: state.drawer.status, error: state.drawer.error, showDetails: state.view.showDetails, timezone: state.source.data?.range?.timezone || state.query.timezone });
    if (focus || hadContentFocus) closeButton.focus();
  }
  function open(session, trigger) {
    const state = getState(); const key = session.sessionKey || session.id || session.sessionId;
    if (!key) return;
    const sessionKey = String(key);
    state.drawer = { sessionKey, trigger, detail: null, status: 'loading', error: '' };
    render(true);
    loadDetail(state.drawer.sessionKey).then((detail) => {
      if (getState().drawer.sessionKey !== sessionKey) return;
      state.drawer.detail = detail; state.drawer.status = 'ready'; render();
    }).catch((error) => {
      if (getState().drawer.sessionKey !== sessionKey || error?.name === 'AbortError') return;
      state.drawer.status = 'error'; state.drawer.error = error instanceof Error ? error.message : String(error); render();
    });
  }
  function close() {
    const state = getState(); const trigger = state.drawer.trigger; const wasOpen = Boolean(state.drawer.sessionKey);
    state.drawer = { sessionKey: null, trigger: null, detail: null, status: 'idle', error: '' };
    render(); if (wasOpen) (trigger?.isConnected ? trigger : getElement('search')).focus();
  }
  function containFocus(event) { if (getState().drawer.sessionKey && !drawer.contains(event.target)) closeButton.focus(); }
  function keyboard(event) {
    if (!getState().drawer.sessionKey) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter((element) => element.getClientRects().length && !element.closest('[hidden], [inert]'));
    const index = focusable.indexOf(doc.activeElement);
    const next = index < 0 ? (event.shiftKey ? focusable.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    event.preventDefault(); (focusable[next] || drawer).focus();
  }
  function bind() { closeButton.addEventListener('click', close); backdrop.addEventListener('click', close); doc.addEventListener('keydown', keyboard, true); doc.addEventListener('focusin', containFocus); }
  function destroy() { closeButton.removeEventListener('click', close); backdrop.removeEventListener('click', close); doc.removeEventListener('keydown', keyboard, true); doc.removeEventListener('focusin', containFocus); setBackgroundInactive(false); }
  return { bind, close, destroy, open, render };
}
