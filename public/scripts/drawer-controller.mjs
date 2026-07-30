import { renderSessionDrawer } from './drawer.mjs';
import { t } from './i18n.mjs';

async function copyValue(event, showNotice) {
  const value = event.currentTarget.dataset.copyValue || '';
  let copied = false;
  try {
    await navigator.clipboard.writeText(value);
    copied = true;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    document.body.append(input);
    input.select();
    copied = document.execCommand('copy');
    input.remove();
  }
  showNotice(copied ? t('copy.success') : t('copy.failure'));
}

export function createSessionDrawerController({ getState, getElement, showNotice }) {
  function render(focus = false) {
    const state = getState();
    const drawer = getElement('sessionDrawer');
    const session = state.view.drawerSession;
    drawer.hidden = !session;
    getElement('drawerBackdrop').hidden = !session;
    if (!session) return;
    drawer.innerHTML = renderSessionDrawer(session, state.source.data.pricing, state.view.showDetails);
    getElement('closeDrawer').addEventListener('click', close);
    drawer.querySelectorAll('.copy-value').forEach((button) => button.addEventListener('click', (event) => copyValue(event, showNotice)));
    if (focus) getElement('closeDrawer').focus();
  }

  function open(session, trigger) {
    const state = getState();
    state.view.drawerSession = session;
    state.view.drawerTrigger = trigger;
    document.querySelectorAll('#rows tr[aria-selected="true"]').forEach((row) => row.setAttribute('aria-selected', 'false'));
    trigger.closest('tr')?.setAttribute('aria-selected', 'true');
    render(true);
  }

  function close() {
    const state = getState();
    const trigger = state.view.drawerTrigger;
    state.view.drawerSession = null;
    state.view.drawerTrigger = null;
    document.querySelectorAll('#rows tr[aria-selected="true"]').forEach((row) => row.setAttribute('aria-selected', 'false'));
    render();
    if (trigger?.isConnected) trigger.focus();
  }

  function bind() {
    getElement('drawerBackdrop').addEventListener('click', close);
  }

  return { bind, close, open, render };
}
