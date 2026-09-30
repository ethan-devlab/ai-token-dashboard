import { FILTER_KEYS, normalizeFilters } from './state.mjs';
import { t } from './i18n.mjs';

const GROUP_LABELS = { models: 'models', workspaces: 'workspaces', pricingStatus: 'pricing', usageSource: 'source', cliVersion: 'cli', originator: 'originator', quality: 'quality', executionType: 'executionType' };

export function createFilterDraft(initial = {}) {
  let applied = normalizeFilters(initial);
  let draft = normalizeFilters(applied);
  const snapshot = () => ({ applied: normalizeFilters(applied), draft: normalizeFilters(draft), dirty: FILTER_KEYS.some((key) => applied[key].length !== draft[key].length || applied[key].some((value) => !draft[key].includes(value))) });
  return {
    snapshot,
    reset(filters) { applied = normalizeFilters(filters); draft = normalizeFilters(applied); return snapshot(); },
    select(key, value, checked) {
      if (!FILTER_KEYS.includes(key)) return snapshot();
      draft[key] = checked ? normalizeFilters({ [key]: [...draft[key], value] })[key] : draft[key].filter((item) => item !== value);
      return snapshot();
    },
    apply() { applied = normalizeFilters(draft); return snapshot(); },
    discard() { draft = normalizeFilters(applied); return snapshot(); },
    remove(key, value) {
      if (!FILTER_KEYS.includes(key)) return snapshot();
      applied[key] = applied[key].filter((item) => item !== value);
      draft[key] = draft[key].filter((item) => item !== value);
      return snapshot();
    },
    clear() {
      // Remove applied values from the draft without applying unrelated edits.
      for (const key of FILTER_KEYS) draft[key] = draft[key].filter((value) => !applied[key].includes(value));
      applied = normalizeFilters();
      return snapshot();
    },
  };
}

export function facetItems(values = [], selected = []) {
  const items = new Map();
  for (const item of Array.isArray(values) ? values : []) {
    const value = String(typeof item === 'string' ? item : item?.value ?? item?.key ?? '').trim();
    if (value) items.set(value, { value, label: String(item?.label ?? value), count: item?.count });
  }
  for (const value of selected) if (!items.has(value)) items.set(value, { value, label: value });
  return [...items.values()];
}

export function createFilterController({ getElement, onApply }) {
  const model = createFilterDraft();
  const groups = new Map();
  const chips = new Map();
  let facets = {};
  let facetScope = '';
  let serial = 0;
  const summary = getElement('filterDisclosure').querySelector('summary');
  const groupLabel = (key) => t(`v2.filter.${GROUP_LABELS[key]}`);

  for (const key of FILTER_KEYS) {
    const root = getElement(`filter${key[0].toUpperCase()}${key.slice(1)}`);
    const group = { root, list: root.querySelector('.facet-list'), search: root.querySelector('input[type="search"]'), empty: root.querySelector('.facet-empty'), rows: new Map() };
    groups.set(key, group);
    group.search?.addEventListener('input', render);
    group.list.addEventListener('change', (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') { model.select(key, input.value, input.checked); render(); }
    });
  }

  function commit(snapshot) { render(); onApply(snapshot.applied); }
  function render() {
    const { applied, draft, dirty } = model.snapshot();
    const count = FILTER_KEYS.reduce((sum, key) => sum + applied[key].length, 0);
    getElement('filterStatus').textContent = count ? t('v2.filter.active', { count }) : t('v2.filter.none');
    getElement('filterDraftStatus').textContent = t(dirty ? 'filters.pending' : 'filters.synced');
    getElement('filterDraftStatus').dataset.state = dirty ? 'pending' : 'synced';
    getElement('applyFilters').disabled = !dirty;
    getElement('discardFilters').disabled = !dirty;
    getElement('clearFilters').disabled = count === 0;
    getElement('activeFilters').hidden = count === 0;
    getElement('filterEmpty').hidden = count !== 0;
    const activeChipKeys = new Set();
    for (const key of FILTER_KEYS) {
      const group = groups.get(key);
      const items = facetItems(facets[key], [...applied[key], ...draft[key]]);
      const itemKeys = new Set(items.map((item) => item.value));
      const search = (group.search?.value || '').trim().toLocaleLowerCase();
      let visible = 0;
      for (const item of items) {
        let row = group.rows.get(item.value);
        if (!row) {
          const label = document.createElement('label'); label.className = 'facet-option';
          const input = document.createElement('input'); input.type = 'checkbox'; input.id = `facet-${++serial}`; input.value = item.value;
          const text = document.createElement('span'); label.append(input, text); group.list.append(label);
          row = { label, input, text }; group.rows.set(item.value, row);
        }
        row.input.checked = draft[key].includes(item.value);
        row.text.textContent = item.count == null ? item.label : `${item.label} (${item.count})`;
        row.label.hidden = Boolean(search && !item.label.toLocaleLowerCase().includes(search));
        if (!row.label.hidden) visible += 1;
      }
      for (const [value, row] of group.rows) if (!itemKeys.has(value)) { row.label.remove(); group.rows.delete(value); }
      group.empty.hidden = visible !== 0;
      group.empty.textContent = t(search ? 'filters.noMatches' : 'filters.empty');
      for (const value of applied[key]) {
        const chipKey = JSON.stringify([key, value]); activeChipKeys.add(chipKey);
        let button = chips.get(chipKey);
        if (!button) {
          button = document.createElement('button'); button.type = 'button'; button.className = 'filter-chip button--remove button--compact';
          button.addEventListener('click', () => {
            const siblings = [...getElement('activeFilters').children]; const index = siblings.indexOf(button);
            const snapshot = model.remove(key, value);
            commit(snapshot);
            (getElement('activeFilters').children[index] || getElement('activeFilters').children[index - 1] || summary).focus();
          });
          chips.set(chipKey, button); getElement('activeFilters').append(button);
        }
        const label = items.find((item) => item.value === value)?.label || value;
        button.textContent = `${groupLabel(key)}: ${label} ×`;
        button.setAttribute('aria-label', t('filters.remove', { group: groupLabel(key), value: label }));
      }
    }
    for (const [key, button] of chips) if (!activeChipKeys.has(key)) { button.remove(); chips.delete(key); }
  }

  getElement('applyFilters').addEventListener('click', () => { const snapshot = model.apply(); summary.focus(); commit(snapshot); });
  getElement('discardFilters').addEventListener('click', () => { model.discard(); summary.focus(); render(); });
  getElement('clearFilters').addEventListener('click', () => { summary.focus(); commit(model.clear()); });
  return {
    render,
    reset(filters) {
      model.reset(filters); facets = {}; facetScope = '';
      for (const group of groups.values()) { if (group.search) group.search.value = ''; for (const row of group.rows.values()) row.label.remove(); group.rows.clear(); }
      if (FILTER_KEYS.some((key) => filters?.[key]?.length)) getElement('filterDisclosure').open = true;
      render();
    },
    setFacets(values, scope) {
      if (scope !== facetScope) { facets = {}; facetScope = scope; }
      // The API returns facets for the filtered result. Retain observed choices
      // within this period so applying one choice does not block adding another.
      for (const key of FILTER_KEYS) {
        const prior = (facets[key] || []).map(({ value, label }) => ({ value, label }));
        const items = new Map(prior.map((item) => [item.value, item]));
        for (const item of facetItems(values?.[key])) items.set(item.value, item);
        facets[key] = [...items.values()];
      }
      render();
    },
  };
}
