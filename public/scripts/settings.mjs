import { applyDocumentTranslations, detectLocale, setLocale, t } from './i18n.mjs';
import { setButtonBusy } from './button-state.mjs';
import { settingsChanged } from './settings-state.mjs';

const SETTINGS_KEYS = Object.freeze(['HOST', 'PORT', 'CODEX_SESSIONS_DIR', 'CLAUDE_SESSIONS_DIR', 'MAX_FILES', 'PARSE_CONCURRENCY', 'ALLOW_REMOTE', 'EXPOSE_FULL_PATHS', 'AUTO_REFRESH', 'AUTO_REFRESH_DEBOUNCE_MS', 'UPDATE_REPOSITORY']);
const form = document.getElementById('settingsForm');
const notice = document.getElementById('settingsNotice');
const remoteWarning = document.getElementById('remoteWarning');
const unavailablePanel = document.getElementById('settingsUnavailable');
const dirtyStatus = document.getElementById('settingsDirty');
const retry = document.getElementById('settingsRetry');
const back = document.getElementById('settingsBack');
const leave = document.getElementById('settingsLeave');
let baseline = null;
let ready = false;
let dirty = false;

function setNotice(message, state = 'info') {
  notice.textContent = message;
  notice.dataset.state = state;
  notice.setAttribute('role', state === 'error' ? 'alert' : 'status');
  notice.dataset.validation = 'false';
}

function setDisabled(disabled) {
  for (const element of form.querySelectorAll('input, button')) element.disabled = disabled;
  form.setAttribute('aria-busy', String(disabled));
  back.setAttribute('aria-disabled', String(disabled && ready));
}

function responseError(payload, fallback) {
  const error = new Error(payload?.error?.message || fallback);
  error.code = payload?.error?.code;
  return error;
}

function inputFor(key) {
  const input = form.elements.namedItem(key);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${key} control.`);
  return input;
}

function renderSettings(values) {
  for (const key of SETTINGS_KEYS) {
    const input = inputFor(key);
    if (input.type === 'checkbox') input.checked = values[key] === '1' || values[key] === 'true';
    else input.value = values[key] || '';
  }
  remoteWarning.hidden = !inputFor('ALLOW_REMOTE').checked;
}

function payload() {
  return Object.fromEntries(SETTINGS_KEYS.map((key) => {
    const input = inputFor(key);
    return [key, input.type === 'checkbox' ? input.checked ? '1' : '0' : input.value];
  }));
}

function updateDirty() {
  dirty = settingsChanged(baseline, payload());
  dirtyStatus.textContent = ready ? t(dirty ? 'settings.dirty' : 'settings.clean') : '';
  dirtyStatus.dataset.state = dirty ? 'dirty' : 'clean';
}

for (const key of SETTINGS_KEYS) {
  const input = inputFor(key);
  const labelText = input.parentElement.querySelector('span[data-i18n]');
  if (labelText) { labelText.id = `label-${key}`; input.setAttribute('aria-labelledby', labelText.id); }
  const error = document.createElement('span'); error.id = `error-${key}`; error.className = 'field-error'; error.hidden = true;
  input.parentElement.append(error);
  const hint = ['MAX_FILES', 'PARSE_CONCURRENCY'].includes(key) ? 'parseHint' : ['HOST', 'PORT', 'EXPOSE_FULL_PATHS'].includes(key) ? 'networkHint' : ['AUTO_REFRESH', 'AUTO_REFRESH_DEBOUNCE_MS'].includes(key) ? 'watcherHint' : '';
  input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), hint, error.id].filter(Boolean).join(' '));
  input.addEventListener('invalid', () => { input.setAttribute('aria-invalid', 'true'); error.textContent = input.validationMessage; error.hidden = false; setNotice(t('settings.invalid'), 'error'); notice.dataset.validation = 'true'; });
  input.addEventListener('input', () => { if (input.validity.valid) { input.removeAttribute('aria-invalid'); error.hidden = true; if (notice.dataset.validation === 'true' && !form.querySelector('[aria-invalid="true"]')) setNotice(t('settings.restart')); } });
}
form.addEventListener('input', updateDirty);
form.addEventListener('change', updateDirty);
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
back.addEventListener('click', (event) => {
  if (back.getAttribute('aria-disabled') === 'true') { event.preventDefault(); return; }
  if (!dirty || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault(); leave.showModal();
});
document.getElementById('settingsKeep').addEventListener('click', () => leave.close());
document.getElementById('settingsDiscard').addEventListener('click', () => { dirty = false; leave.close(); window.location.assign(back.href); });
retry.addEventListener('click', () => void loadSettings());

async function loadSettings() {
  ready = false;
  retry.hidden = true;
  setButtonBusy(document.getElementById('settingsSave'), true);
  setDisabled(true);
  setNotice(t('settings.loading'));
  try {
    const response = await fetch('/api/settings', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw responseError(data, t('settings.loadError'));
    renderSettings(data.settings);
    baseline = payload(); ready = true; updateDirty();
    setNotice(t('settings.restart'));
  } catch (error) {
    if (error?.code === 'SETTINGS_DISABLED') {
      form.hidden = true;
      unavailablePanel.hidden = false;
      setNotice(t('settings.unavailable'), 'error');
      return;
    }
    setNotice(error instanceof Error ? error.message : t('settings.loadError'), 'error');
    retry.hidden = false;
  } finally {
    setButtonBusy(document.getElementById('settingsSave'), false, 'settings.saving');
    setDisabled(!ready);
  }
}

inputFor('ALLOW_REMOTE').addEventListener('change', () => { remoteWarning.hidden = !inputFor('ALLOW_REMOTE').checked; });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  setButtonBusy(document.getElementById('settingsSave'), true, 'settings.saving');
  setDisabled(true);
  setNotice(t('settings.saving'));
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const data = await response.json();
    if (!response.ok) throw responseError(data, t('settings.saveError'));
    renderSettings(data.settings);
    baseline = payload(); updateDirty();
    setNotice(t('settings.saved'), 'success');
  } catch (error) {
    setNotice(error instanceof Error ? error.message : t('settings.saveError'), 'error');
  } finally {
    setButtonBusy(document.getElementById('settingsSave'), false, 'settings.saving');
    setDisabled(false);
  }
});

setLocale(detectLocale(window.localStorage, navigator.languages));
applyDocumentTranslations();
document.title = t('settings.title');
void loadSettings();
