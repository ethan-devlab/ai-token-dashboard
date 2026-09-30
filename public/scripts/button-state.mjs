import { t } from './i18n.mjs';

const busyFocus = new WeakMap();

export function setButtonBusy(button, busy, busyKey = 'action.loading') {
  const document = button.ownerDocument;
  if (busy && !busyFocus.has(button)) busyFocus.set(button, document.activeElement === button);
  const idleKey = button.dataset.i18n;
  button.removeAttribute('data-i18n');
  button.dataset.idleLabel = idleKey || button.dataset.idleLabel;
  button.dataset.busyLabel = busyKey;
  button.setAttribute('aria-busy', String(busy));
  button.disabled = busy;
  renderButtonLabel(button);
  if (!busy) {
    if (busyFocus.get(button) && document.activeElement === document.body && button.isConnected) button.focus();
    busyFocus.delete(button);
  }
}

export function renderButtonLabel(button) {
  const busy = button.getAttribute('aria-busy') === 'true';
  const idle = t(button.dataset.idleLabel);
  const pending = t(button.dataset.busyLabel);
  let label = button.querySelector('.button-label');
  if (!label) {
    label = document.createElement('span'); label.className = 'button-label';
    label.append(document.createElement('span'), document.createElement('span'));
    button.replaceChildren(label);
  }
  label.children[0].textContent = idle; label.children[0].setAttribute('aria-hidden', String(busy));
  label.children[1].textContent = pending; label.children[1].setAttribute('aria-hidden', String(!busy));
  button.setAttribute('aria-label', busy ? pending : idle);
}

export function translateButtonLabels(root = document) {
  root.querySelectorAll('button[data-idle-label]').forEach(renderButtonLabel);
}
