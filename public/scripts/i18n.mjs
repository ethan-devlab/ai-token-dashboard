export const LOCALES = Object.freeze({ EN: 'en', ZH_HANT: 'zh-Hant' });
export const LOCALE_PREFERENCE_KEY = 'codex-token-dashboard:locale:v1';

const dictionaries = {
  en: {
    'meta.description': 'Local Codex JSONL token and API-equivalent cost dashboard',
    'header.eyebrow': 'LOCAL OBSERVABILITY', 'header.subtitle': 'Token usage and API-equivalent cost from JSONL event timestamps.',
    'view.label': 'View', 'view.settings': 'View settings', 'view.language': 'Language', 'view.unit': 'Display unit',
    'view.auto': 'Auto', 'view.exact': 'Exact integers', 'view.k': 'K (thousand)', 'view.m': 'M (million)', 'view.b': 'B (billion)', 'view.exactValues': 'Show exact values', 'view.details': 'Show token and cost details',
    'view.density': 'Table density', 'view.comfortable': 'Comfortable', 'view.compact': 'Compact', 'view.columns': 'Visible columns',
    'refresh': 'Reparse JSONL', 'updates.check': 'Check for updates', 'period.eyebrow': 'SELECTED PERIOD', 'period.controls': 'Dashboard controls',
    'period.detail': 'The range is half-open; exact values can be toggled at any time.', 'period.range': 'Time range',
    'range.all': 'All time', 'range.last24h': 'Last 24 hours', 'range.today': 'Today', 'range.week': 'Week', 'range.month': 'Month', 'range.year': 'Year', 'range.custom': 'Custom range',
    'range.start': 'Start', 'range.end': 'End', 'summary.label': 'Filtered totals', 'cost.title': 'API-equivalent cost (USD)',
    'total.tokens': 'Total tokens', 'input.tokens': 'Input tokens', 'output.tokens': 'Output tokens', 'token.breakdown': 'TOKEN BREAKDOWN',
    'cached.input': 'Cached input', 'uncached.input': 'Uncached input', 'cache.write': 'Cache write', 'reasoning.output': 'Reasoning output',
    'trend.eyebrow': 'USAGE INSIGHT', 'trend.title': 'Usage trend', 'trend.metric': 'Trend metric', 'trend.cost': 'Estimated cost',
    'trend.tokens': 'Total tokens', 'model.eyebrow': 'MODEL USAGE', 'model.title': 'Model usage', 'metadata.label': 'System metadata',
    'explorer.label': 'Session explorer', 'explorer.eyebrow': 'SESSION EXPLORER', 'explorer.search': 'Search sessions, models, cwd…',
    'explorer.searchLabel': 'Search sessions', 'explorer.clear': 'Clear search', 'explorer.sort': 'Sort', 'sort.recent': 'Recent activity',
    'sort.cost': 'Cost', 'sort.total': 'Total tokens', 'sort.input': 'Input tokens', 'sort.cache': 'Cached input', 'sort.output': 'Output tokens',
    'table.lastUsed': 'Last used', 'table.session': 'Session / JSONL', 'table.model': 'Model', 'table.total': 'Total', 'table.input': 'Input', 'table.output': 'Output', 'table.cost': 'Estimated cost', 'table.status': 'Status',
    'pagination.label': 'Session pagination', 'pagination.previous': 'Previous', 'pagination.next': 'Next', 'pricing.summary': 'View built-in model prices',
    'footer': 'Costs are estimates using public OpenAI API Standard prices, not a Codex or ChatGPT subscription bill. Cached input is part of Input tokens; reasoning is normally included in Output and is not charged twice.',
    'drawer.title': 'SESSION DETAIL', 'drawer.close': 'Close', 'drawer.copy': 'Copy {label}', 'drawer.identity': 'IDENTITY', 'drawer.tokens': 'TOKENS', 'drawer.cost': 'ESTIMATED API COST', 'drawer.quality': 'DATA QUALITY',
    'status.unpriced': 'Unpriced', 'status.partial': 'Partial pricing', 'status.quality': 'Data note', 'status.complete': 'Complete', 'explorer.open': 'View details for {session}',
    'drawer.sessionId': 'Session ID', 'drawer.jsonl': 'JSONL', 'drawer.cwd': 'CWD', 'drawer.originator': 'CLI originator', 'drawer.firstUsed': 'First used', 'copy.success': 'Copied to clipboard.', 'copy.failure': 'Browser did not allow copying; select the value manually.', 'drawer.lines': 'JSONL lines {count}', 'drawer.skipped': 'Skipped {count} lines', 'drawer.duplicates': 'Skipped {count} duplicate cumulative events', 'drawer.resets': 'Corrected {count} counter resets', 'drawer.estimatedTimestamp': 'Contains estimated timestamps',
    'range.invalidDate': 'Enter a valid date and time.', 'range.invalidWeek': 'Choose a valid week.', 'range.invalidMonth': 'Choose a valid month.', 'range.invalidYear': 'Enter a year from 2000 to 2200.', 'range.endBeforeStart': 'End time must be later than start time.',
    'range.allLocal': 'All local data · local time', 'range.earliest': 'earliest', 'range.now': 'now', 'range.halfOpen': 'local time · half-open range',
    'load.localError': 'Cannot read local sessions. Confirm the server is still running on localhost.', 'load.error': 'Could not load dashboard data.', 'load.loading': 'Loading…', 'load.parsing': 'Parsing…', 'load.scanning': 'Rescanning…', 'load.noData': 'Data not loaded',
    'load.sessionsMetadata': 'Session metadata has not been loaded.', 'load.trend': 'Loading trend data…', 'load.model': 'Loading model usage…', 'load.sessions': 'Could not load Codex sessions. Confirm the local sessions directory and try again.',
    'notice.refreshed': 'Reparsed {files} JSONL files in {duration} ms.', 'scan.info': 'Scanned: {time} · snapshot v{version}', 'scan.source': 'Source: local sessions root', 'scan.sessions': 'Sessions in range: {count}', 'scan.jsonl': 'JSONL: {count}', 'scan.duration': 'Parse: {duration} ms', 'scan.pricing': 'Pricing version: {date}',
    'quality.files': '{count} JSONL files could not be parsed', 'quality.lines': '{count} JSONL lines were skipped', 'quality.resets': '{count} cumulative counter resets were corrected as deltas', 'quality.estimated': '{count} usage events have estimated timestamps', 'quality.unpriced': 'Unpriced models: {models}', 'quality.partial': 'Some pricing components have no public rate', 'quality.truncated': 'MAX_FILES={count} reached',
    'explorer.showing': 'Showing {start}–{end} / {count} sessions', 'explorer.emptySearch': 'No sessions match the search. Press Escape or use Clear search to return to the full table.', 'explorer.emptyRange': 'No token usage records in {range}.',
    'trend.empty': 'There are no usage events to plot in this range.', 'trend.summary': '{unit} aggregation across {count} intervals; peak {label}, {value}.{partial}', 'trend.partial': ' Unknown models or missing prices are excluded from the trend.', 'trend.hour': 'Hourly', 'trend.day': 'Daily', 'trend.month': 'Monthly', 'trend.year': 'Yearly', 'trend.aria': '{metric} trend. Use Left and Right Arrow keys to inspect points.', 'trend.point': '{label}: {value}', 'trend.table': 'View trend data table', 'trend.time': 'Time', 'trend.value': 'Value',
    'model.empty': 'There are no model events to group in this range.', 'model.summary': 'Sorted by {metric}; showing {visible} of {total} models.',
    'price.unavailable': 'Unavailable', 'update.disabled': 'Update checks are disabled. Set UPDATE_REPOSITORY to owner/repo to enable them.', 'update.checking': 'Checking GitHub Releases…', 'update.current': 'You are using the current release ({version}).', 'update.available': 'Version {version} is available. Download it manually, verify SHA-256, then replace the local files after closing this dashboard.', 'update.unavailable.network': 'Could not reach GitHub Releases. The dashboard remains local and usable.', 'update.unavailable.not-found': 'The configured GitHub release repository was not found.', 'update.unavailable.rate-limit': 'GitHub rate limit reached. Try again later.', 'update.unavailable.invalid-release': 'GitHub returned an invalid stable release.', 'update.unavailable.invalid-version': 'Could not compare the release version safely.', 'update.download': 'Download {name}', 'update.verify': 'Verify SHA-256: {sha256}',
  },
  'zh-Hant': {
    'meta.description': '本機 Codex JSONL token 與 API 等值費用儀表板',
    'header.eyebrow': '本機觀測', 'header.subtitle': '依 JSONL 事件時間統計 token 與 API 等值費用。', 'view.label': '檢視', 'view.settings': '檢視設定', 'view.language': '語言', 'view.unit': '顯示單位', 'view.auto': '自動', 'view.exact': '完整數字', 'view.k': 'K（千）', 'view.m': 'M（百萬）', 'view.b': 'B（十億）', 'view.exactValues': '顯示精確值', 'view.details': '顯示 token／費用明細', 'view.density': '表格密度', 'view.comfortable': '舒適', 'view.compact': '緊湊', 'view.columns': '顯示欄位', 'refresh': '重新解析 JSONL', 'updates.check': '檢查更新', 'period.eyebrow': '已選範圍', 'period.controls': '儀表板控制項', 'period.detail': '範圍採半開區間，精確值可隨時切換。', 'period.range': '時間範圍', 'range.all': '全部時間', 'range.last24h': '最近 24 小時', 'range.today': '當日使用', 'range.week': '週使用', 'range.month': '月使用', 'range.year': '年度使用', 'range.custom': '自訂範圍', 'range.start': '起', 'range.end': '迄', 'summary.label': '篩選後總計', 'cost.title': 'API 等值費用（USD）', 'total.tokens': 'Total tokens', 'input.tokens': 'Input tokens', 'output.tokens': 'Output tokens', 'token.breakdown': 'TOKEN 細目', 'cached.input': 'Cached input', 'uncached.input': 'Uncached input', 'cache.write': 'Cache write', 'reasoning.output': 'Reasoning output', 'trend.eyebrow': '使用洞察', 'trend.title': '使用趨勢', 'trend.metric': '趨勢指標', 'trend.cost': '估算費用', 'trend.tokens': 'Total tokens', 'model.eyebrow': '模型使用量', 'model.title': '模型用量', 'metadata.label': '系統中繼資料', 'explorer.label': 'Session Explorer', 'explorer.eyebrow': 'SESSION EXPLORER', 'explorer.search': '搜尋 session、模型、cwd…', 'explorer.searchLabel': '搜尋 sessions', 'explorer.clear': '清除搜尋', 'explorer.sort': '排序', 'sort.recent': '最近活動', 'sort.cost': '費用', 'sort.total': 'Total tokens', 'sort.input': 'Input tokens', 'sort.cache': 'Cached input', 'sort.output': 'Output tokens', 'table.lastUsed': '最後使用', 'table.session': 'Session / JSONL', 'table.model': '模型', 'table.total': 'Total', 'table.input': 'Input', 'table.output': 'Output', 'table.cost': '估算費用', 'table.status': 'Status', 'pagination.label': 'Session 分頁', 'pagination.previous': '上一頁', 'pagination.next': '下一頁', 'pricing.summary': '查看內建模型定價', 'footer': '費用是依 OpenAI API Standard 公開單價估算，不是 Codex／ChatGPT 訂閱帳單。Cached input 已包含在 Input tokens；Reasoning 通常包含於 Output，不重複收費。', 'drawer.title': 'SESSION 詳細資料', 'drawer.close': '關閉', 'drawer.copy': '複製 {label}', 'drawer.identity': '身分資訊', 'drawer.tokens': 'TOKEN', 'drawer.cost': '預估 API 費用', 'drawer.quality': '資料品質', 'status.unpriced': '未定價', 'status.partial': '定價部分', 'status.quality': '資料提醒', 'status.complete': '完整', 'explorer.open': '查看 {session} 的細節', 'range.invalidDate': '請輸入有效的日期時間。', 'range.invalidWeek': '請選擇有效週別。', 'range.invalidMonth': '請選擇有效月份。', 'range.invalidYear': '請輸入 2000 至 2200 的年份。', 'range.allLocal': '全部本機資料 · local time', 'range.earliest': '最早', 'range.now': '現在', 'range.halfOpen': 'local time · 半開區間', 'load.localError': '無法讀取本機 sessions。請確認伺服器仍在 localhost 執行。', 'load.error': '無法載入儀表板資料。', 'load.loading': '載入中…', 'load.parsing': '解析中…', 'load.scanning': '重新掃描中…', 'load.noData': '資料未載入', 'load.sessionsMetadata': '尚未讀取 sessions metadata。', 'load.trend': '載入趨勢資料…', 'load.model': '載入模型用量…', 'load.sessions': '無法載入 Codex sessions。請確認本機 sessions 目錄後重試。', 'notice.refreshed': '已重新掃描 {files} 個 JSONL，耗時 {duration} ms。', 'scan.info': '掃描時間：{time} · snapshot v{version}', 'scan.source': '來源：local sessions root', 'scan.sessions': '範圍內 sessions：{count}', 'scan.jsonl': 'JSONL：{count}', 'scan.duration': '解析：{duration} ms', 'scan.pricing': '定價版本：{date}', 'quality.files': '{count} 個 JSONL 檔案無法解析', 'quality.lines': '{count} 行 JSONL 已略過', 'quality.resets': '{count} 次累積計數器重設已以增量修正', 'quality.estimated': '{count} 筆使用事件採估算時間戳', 'quality.unpriced': '未定價模型：{models}', 'quality.partial': '部分計價元件未提供公開單價', 'quality.truncated': '已達 MAX_FILES={count}', 'explorer.showing': '顯示 {start}–{end} / {count} sessions', 'explorer.emptySearch': '找不到符合搜尋條件的 session。按 Escape 或使用「清除搜尋」返回完整表格。', 'explorer.emptyRange': '此範圍（{range}）沒有 token 使用紀錄。', 'trend.empty': '此範圍沒有可繪製的使用事件。', 'trend.summary': '{unit}彙整 {count} 個區間；峰值 {label}，{value}。{partial}', 'trend.partial': '未知模型或缺失單價未納入趨勢。', 'trend.hour': '每小時', 'trend.day': '每日', 'trend.month': '每月', 'trend.year': '每年', 'trend.aria': '{metric} 趨勢。可用左右方向鍵檢視資料點。', 'trend.point': '{label}：{value}', 'trend.table': '查看趨勢資料表', 'trend.time': '時間', 'trend.value': '值', 'model.empty': '此範圍沒有可分組的模型事件。', 'model.summary': '依 {metric} 排序，顯示 {visible} / {total} 個模型。', 'price.unavailable': '未提供', 'update.disabled': '更新檢查已停用。設定 UPDATE_REPOSITORY=owner/repo 後即可啟用。', 'update.checking': '正在檢查 GitHub Releases…', 'update.current': '目前已是最新版本（{version}）。', 'update.available': '可使用版本 {version}。請手動下載、驗證 SHA-256，關閉儀表板後再替換本機檔案。', 'update.unavailable.network': '無法連線至 GitHub Releases；儀表板仍可維持本機使用。', 'update.unavailable.not-found': '找不到設定的 GitHub release repository。', 'update.unavailable.rate-limit': 'GitHub 已達 rate limit，請稍後再試。', 'update.unavailable.invalid-release': 'GitHub 回傳的 stable release 無效。', 'update.unavailable.invalid-version': '無法安全比較 release 版本。', 'update.download': '下載 {name}', 'update.verify': '驗證 SHA-256：{sha256}',
    'drawer.sessionId': 'Session ID', 'drawer.jsonl': 'JSONL', 'drawer.cwd': 'CWD', 'drawer.originator': 'CLI 來源', 'drawer.firstUsed': '首次使用', 'copy.success': '已複製到剪貼簿。', 'copy.failure': '瀏覽器未允許複製；請手動選取內容。', 'drawer.lines': 'JSONL 行數 {count}', 'drawer.skipped': '略過 {count} 行', 'drawer.duplicates': '略過 {count} 個重複累計事件', 'drawer.resets': '修正 {count} 次累計重設', 'drawer.estimatedTimestamp': '包含估算時間戳', 'range.endBeforeStart': '結束時間必須晚於起始時間。',
  },
};

let activeLocale = LOCALES.ZH_HANT;

function interpolate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

export function normalizeLocale(value) {
  return String(value || '').toLowerCase().startsWith('zh') ? LOCALES.ZH_HANT : LOCALES.EN;
}

export function detectLocale(storage, languages = []) {
  try {
    const saved = storage?.getItem(LOCALE_PREFERENCE_KEY);
    if (saved === LOCALES.EN || saved === LOCALES.ZH_HANT) return saved;
  } catch { /* Local storage is optional. */ }
  return normalizeLocale(languages.find(Boolean));
}

export function setLocale(locale) {
  activeLocale = normalizeLocale(locale);
  return activeLocale;
}

export function getLocale() {
  return activeLocale;
}

export function t(key, values = {}) {
  return interpolate(dictionaries[activeLocale]?.[key] ?? dictionaries.en[key] ?? key, values);
}

export function applyDocumentTranslations(root = document) {
  root.documentElement.lang = activeLocale;
  root.title = 'Codex Token Dashboard';
  root.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  root.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => { element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel)); });
}
