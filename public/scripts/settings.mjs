import { applyDocumentTranslations, detectLocale, setLocale, t } from './i18n.mjs';

const SETTINGS_KEYS = Object.freeze(['HOST', 'PORT', 'CODEX_SESSIONS_DIR', 'CLAUDE_SESSIONS_DIR', 'MAX_FILES', 'PARSE_CONCURRENCY', 'ALLOW_REMOTE', 'EXPOSE_FULL_PATHS', 'AUTO_REFRESH', 'AUTO_REFRESH_DEBOUNCE_MS', 'UPDATE_REPOSITORY']);
const form = document.getElementById('settingsForm');
const notice = document.getElementById('settingsNotice');
const remoteWarning = document.getElementById('remoteWarning');
const unavailablePanel = document.getElementById('settingsUnavailable');

function setNotice(message, state = 'info') {
  notice.textContent = message;
  notice.dataset.state = state;
}

function setDisabled(disabled) {
  for (const element of form.querySelectorAll('input, button')) element.disabled = disabled;
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

async function loadSettings() {
  setDisabled(true);
  setNotice(t('settings.loading'));
  try {
    const response = await fetch('/api/settings', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw responseError(data, t('settings.loadError'));
    renderSettings(data.settings);
    setNotice(t('settings.restart'));
  } catch (error) {
    if (error?.code === 'SETTINGS_DISABLED') {
      form.hidden = true;
      unavailablePanel.hidden = false;
      setNotice(t('settings.unavailable'), 'error');
      return;
    }
    setNotice(error instanceof Error ? error.message : t('settings.loadError'), 'error');
  } finally {
    setDisabled(false);
  }
}

inputFor('ALLOW_REMOTE').addEventListener('change', () => { remoteWarning.hidden = !inputFor('ALLOW_REMOTE').checked; });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  setDisabled(true);
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const data = await response.json();
    if (!response.ok) throw responseError(data, t('settings.saveError'));
    renderSettings(data.settings);
    setNotice(t('settings.saved'), 'success');
  } catch (error) {
    setNotice(error instanceof Error ? error.message : t('settings.saveError'), 'error');
  } finally {
    setDisabled(false);
  }
});

setLocale(detectLocale(window.localStorage, navigator.languages));
applyDocumentTranslations();
document.title = t('settings.title');
void loadSettings();
