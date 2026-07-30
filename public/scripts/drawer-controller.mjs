import { renderSessionDrawer } from './drawer.mjs';

export function createSessionDrawerController({ getState, getElement, loadDetail }) {
  const backdrop = getElement('drawerBackdrop');
  function render(focus = false) {
    const state = getState(); const drawer = getElement('sessionDrawer'); const active = state.drawer.sessionKey;
    drawer.hidden = !active; getElement('drawerBackdrop').hidden = !active;
    if (!active) return;
    drawer.innerHTML = renderSessionDrawer({ detail: state.drawer.detail, status: state.drawer.status, error: state.drawer.error, showDetails: state.view.showDetails });
    drawer.querySelector('#closeDrawer')?.addEventListener('click', close);
    if (focus) drawer.querySelector('#closeDrawer')?.focus();
  }
  function open(session, trigger) {
    const state = getState(); const sessionKey = session.sessionKey || session.id || session.sessionId;
    if (!sessionKey) return;
    state.drawer = { sessionKey: String(sessionKey), trigger, detail: null, status: 'loading', error: '' };
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
    const state = getState(); const trigger = state.drawer.trigger; state.drawer = { sessionKey: null, trigger: null, detail: null, status: 'idle', error: '' };
    render(); if (trigger?.isConnected) trigger.focus();
  }
  function bind() { backdrop.addEventListener('click', close); }
  function destroy() { backdrop.removeEventListener('click', close); }
  return { bind, close, destroy, open, render };
}
