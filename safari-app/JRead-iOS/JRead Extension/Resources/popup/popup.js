// JRead — Popup entry
// 綁 DOM 事件、呼叫 chrome API、委派核心邏輯給 popup-core.js。
// 狀態提示主要走頁面 toast（content script 負責渲染）；popup 本身僅在
// toast 進不去的禁止注入頁面（例如 chrome://）顯示錯誤。
// 頁面設定直接寫入 chrome.storage.sync，content script 透過
// chrome.storage.onChanged 即時套用（不需要額外訊息協定）。

const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');
const borderlessBtn = document.getElementById('borderless-btn');
const readwiseBtn = document.getElementById('readwise-btn');
const readwiseStatusEl = document.getElementById('readwise-status');
const openOptionsLink = document.getElementById('open-options');
const shortcutEl = document.getElementById('shortcut-hint');
const fontSizeValEl = document.getElementById('font-size-val');
const fontAutoBtn = document.getElementById('font-auto-btn');
const lineHeightValEl = document.getElementById('line-height-val');
const lineHeightAutoBtn = document.getElementById('line-height-auto-btn');
const paragraphSpacingValEl = document.getElementById('paragraph-spacing-val');
const paragraphSpacingAutoBtn = document.getElementById('paragraph-spacing-auto-btn');
const contentWidthValEl = document.getElementById('content-width-val');
const fontFamilySelect = document.getElementById('font-family-select');
const boldTextBtns = document.querySelectorAll('[data-bold]');
const themeBtns = document.querySelectorAll('.theme-btn');
const autoDomainRow = document.getElementById('auto-domain-row');
const autoDomainCb = document.getElementById('auto-domain-cb');
const autoDomainHostEl = document.getElementById('auto-domain-host');

// ---- 設定範圍常數（對齊 SPEC 預設值）----------------------------------
// fontSize 特殊值 0 = "Auto / 原站字級"（styler 不注入任何 font-size override）
const FONT_SIZE = { min: 12, max: 32, step: 1, default: 18, auto: 0 };
const CONTENT_WIDTH = { min: 480, max: 1200, step: 40, default: 720 };
// 行距：unitless ratio，clamp 對齊 styler [1.0, 3.0]；auto = 0 sentinel（不注入
// line-height，保留原站行距）。step 0.1 配合人眼舒適區間細調。
const LINE_HEIGHT = { min: 1.0, max: 3.0, step: 0.1, default: 1.7, auto: 0 };
// 段落間距：em 為單位，clamp [0, 3.0]；auto = -1 sentinel（不注入 p/ul/ol/
// blockquote margin-bottom 規則，保留原站 typography）。0 是合法值（段落貼緊）
// 所以不能拿來當 sentinel，改用 -1。step 0.25 給「半段、一段、兩段」這類常見
// 間距選擇。
const PARAGRAPH_SPACING = { min: 0, max: 3.0, step: 0.25, default: 1.0, auto: -1 };

// 浮點誤差校正：1.7 + 0.1 = 1.7999999999999998；統一 round 到 2 位小數後再
// 用 String() 印出（會自動省略尾端 0，例如 1 而不是 1.00）。
function roundStep(v) { return Math.round(v * 100) / 100; }
// v0.7.140：popup 字型 select 的 4 個內建 stack。預設 'system-ui' 對齊 styler
// DEFAULTS.fontFamily —— 選「系統預設」== 不注入 font-family override，保留各
// 站原本字體。其他三組故意把 generic family（serif / sans-serif / monospace）
// 放在 stack 末尾，確保即使 stack 內具名字型都沒裝，瀏覽器仍能 fall back 到
// 一個合理的通用 family。styler 注入時會再串接自己的 fallback chain，重複沒關
// 係（CSS 解析正確、第一個能命中的字型即勝出）。HTML 內 option value 必須與
// 此處字面值逐字一致（forcing function spec 會校對）。
const FONT_STACKS = {
  system: 'system-ui',
  serif: '"Noto Serif TC", Georgia, "Times New Roman", serif',
  sans: '"Noto Sans TC", -apple-system, "Helvetica Neue", sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace'
};
const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: FONT_SIZE.default,
  contentWidth: CONTENT_WIDTH.default,
  fontFamily: FONT_STACKS.system,
  lineHeight: LINE_HEIGHT.default,
  paragraphSpacing: PARAGRAPH_SPACING.default,
  // 字粗外觀（細 = antialiased / 粗 = subpixel-antialiased）;預設細 對齊 styler
  // reader card baseline (antialiased) — 使用者切「粗」反轉回 macOS 預設 subpixel
  boldText: false,
  // v0.7.131：reader mode 攔截原站快速鍵；popup 不放 toggle（options 有），這裡
  // 僅作 storage.get 的 default fallback，避免讀回 undefined。
  blockPageShortcuts: true,
  // Pangu spacing（中英文間自動補空白）；popup 不放 toggle（options 有），這裡
  // 僅作 storage.get 的 default fallback，避免讀回 undefined。
  pangu: true,
  // v0.7.155：自動啟動網域清單。popup 端會用 __JReadDomainMatch 比對當前 tab
  // hostname 反映 toggle 狀態；options 是完整清單編輯入口。
  autoEnableDomains: [],
  // v0.7.215：Space 平滑卷動比例（% of viewport）；popup 不放控制項（options
  // 有），這裡僅作 storage.get 的 default fallback，避免讀回 undefined。
  spaceScrollRatio: 50,
  // v0.7.218：自訂快速鍵；popup 不放控制項（options 有 recorder），這裡僅作
  // storage.get 的 default fallback，避免讀回 undefined。
  customShortcuts: {
    'toggle-reader-mode': null,
    'send-to-readwise': null,
    'toggle-youtube-borderless': null
  }
};

versionEl.textContent = chrome.runtime.getManifest().version;

// ---- 快速鍵提示 --------------------------------------------------------
// v0.7.217 iOS Safari guard：iOS 無 chrome.commands API——popup.js 是
// top-level script，直接呼叫會 TypeError 中斷整個 popup（連 toggle 按鈕
// handler 都掛）。缺 API 時隱藏快速鍵提示列（觸控環境本來就沒鍵盤指派）。
if (chrome.commands && chrome.commands.getAll) {
  chrome.commands.getAll((commands) => {
    if (!shortcutEl) return;
    const cmd = (commands || []).find(c => c.name === 'toggle-reader-mode');
    const shortcut = cmd && cmd.shortcut;
    if (shortcut) {
      shortcutEl.textContent = `快速鍵：${shortcut}`;
    } else {
      shortcutEl.innerHTML = '快速鍵未設定，請到 <code>chrome://extensions/shortcuts</code> 指派';
    }
  });
} else if (shortcutEl) {
  shortcutEl.hidden = true;
}

// ---- 設定面板 ----------------------------------------------------------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function render(settings) {
  const isAuto = settings.fontSize === FONT_SIZE.auto;
  fontSizeValEl.textContent = isAuto ? 'Auto' : String(settings.fontSize);
  contentWidthValEl.textContent = String(settings.contentWidth);
  // 行距：Auto sentinel = 0；其他顯示 roundStep 後的數字（避免浮點 trailing 9）
  const isLhAuto = settings.lineHeight === LINE_HEIGHT.auto;
  if (lineHeightValEl) {
    lineHeightValEl.textContent = isLhAuto ? 'Auto' : String(roundStep(settings.lineHeight));
  }
  // 段落間距：Auto sentinel = -1；非 Auto 顯示數字（0 / 1 / 1.25 / 2 etc.）
  const isPsAuto = settings.paragraphSpacing === PARAGRAPH_SPACING.auto;
  if (paragraphSpacingValEl) {
    paragraphSpacingValEl.textContent = isPsAuto ? 'Auto' : String(roundStep(settings.paragraphSpacing));
  }
  for (const btn of themeBtns) {
    btn.classList.toggle('active', btn.dataset.theme === settings.theme);
  }
  // 邊界 disable
  // 字級 Auto 模式下 - 按鈕 disable、+ 按鈕從 Auto 跳到 DEFAULT
  document.querySelector('[data-action="font-dec"]').disabled =
    isAuto || settings.fontSize <= FONT_SIZE.min;
  document.querySelector('[data-action="font-inc"]').disabled =
    !isAuto && settings.fontSize >= FONT_SIZE.max;
  // 行距 / 段落間距同 Auto 處理邏輯
  const lhDec = document.querySelector('[data-action="line-height-dec"]');
  const lhInc = document.querySelector('[data-action="line-height-inc"]');
  if (lhDec) lhDec.disabled = isLhAuto || settings.lineHeight <= LINE_HEIGHT.min;
  if (lhInc) lhInc.disabled = !isLhAuto && settings.lineHeight >= LINE_HEIGHT.max;
  const psDec = document.querySelector('[data-action="paragraph-spacing-dec"]');
  const psInc = document.querySelector('[data-action="paragraph-spacing-inc"]');
  if (psDec) psDec.disabled = isPsAuto || settings.paragraphSpacing <= PARAGRAPH_SPACING.min;
  if (psInc) psInc.disabled = !isPsAuto && settings.paragraphSpacing >= PARAGRAPH_SPACING.max;
  document.querySelector('[data-action="width-dec"]').disabled = settings.contentWidth <= CONTENT_WIDTH.min;
  document.querySelector('[data-action="width-inc"]').disabled = settings.contentWidth >= CONTENT_WIDTH.max;
  // Auto 按鈕 active 狀態
  if (fontAutoBtn) fontAutoBtn.classList.toggle('active', isAuto);
  if (lineHeightAutoBtn) lineHeightAutoBtn.classList.toggle('active', isLhAuto);
  if (paragraphSpacingAutoBtn) paragraphSpacingAutoBtn.classList.toggle('active', isPsAuto);
  // 字粗 segmented
  for (const btn of boldTextBtns) {
    btn.classList.toggle('active', String(settings.boldText) === btn.dataset.bold);
  }
  // 字型 select：value 對 4 個 option match 不到（例如外部直接 storage.set
  // 自訂 stack）時 fall back 顯示「系統預設」但不寫回 storage，避免默默改動
  // 使用者外部設定。
  if (fontFamilySelect) {
    fontFamilySelect.value = settings.fontFamily;
    if (fontFamilySelect.value === '') fontFamilySelect.value = FONT_STACKS.system;
  }
}

let current = { ...DEFAULT_SETTINGS };

// v0.7.143：debounce storage.sync.set 防 chrome.storage.sync quota 踩線。
// 連點 stepper（fontSize 12-32 跨 20 step、contentWidth 480-1200 跨 18 step）
// 每 click 觸發一次 set，加上 storage.onChanged broadcast 到所有 tab 的 content
// script、各自跑 styler restore+apply，連環 cost。chrome.storage.sync quota：
// MAX_WRITE_OPERATIONS_PER_MINUTE = 120、MAX_WRITE_OPERATIONS_PER_HOUR = 1800。
// 200ms debounce 對人類連點足夠合併、單次調整無感。
//
// 設計：render 在 click 同步跑（UI 立刻反映、popup 內按鈕狀態跟著刷新），但
// storage.sync.set 透過 debounce 合併。pendingPatch 累積所有未 commit 的欄位。
let saveTimer = null;
let pendingPatch = {};
function commitSave() {
  if (!Object.keys(pendingPatch).length) return;
  const patch = pendingPatch;
  pendingPatch = {};
  saveTimer = null;
  try {
    chrome.storage.sync.set(patch);
  } catch (_) { /* QuotaExceeded 等 silently 吞——current 已有最新值，下次 popup 開啟仍會走 storage.get */ }
}

function save(patch) {
  Object.assign(current, patch);
  Object.assign(pendingPatch, patch);
  render(current);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(commitSave, 200);
  // content script 透過 storage.onChanged 即時重新套用（若閱讀模式開啟）
}

// popup 即將關閉時強制 flush pending patch（不然連點後立刻關 popup 會丟失最後幾次變更）
window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    commitSave();
  }
});

chrome.storage.sync.get(DEFAULT_SETTINGS, (values) => {
  current = { ...DEFAULT_SETTINGS, ...values };
  render(current);
});

for (const btn of themeBtns) {
  btn.addEventListener('click', () => save({ theme: btn.dataset.theme }));
}

document.querySelector('[data-action="font-dec"]').addEventListener('click', () => {
  // Auto 模式下 - 不做事（按鈕 disabled，這裡只是 fallback）
  if (current.fontSize === FONT_SIZE.auto) return;
  save({ fontSize: clamp(current.fontSize - FONT_SIZE.step, FONT_SIZE.min, FONT_SIZE.max) });
});
document.querySelector('[data-action="font-inc"]').addEventListener('click', () => {
  // 從 Auto 按 + 直接跳到 DEFAULT（使用者從「保留原站」想回到手動控制）
  if (current.fontSize === FONT_SIZE.auto) {
    save({ fontSize: FONT_SIZE.default });
    return;
  }
  save({ fontSize: clamp(current.fontSize + FONT_SIZE.step, FONT_SIZE.min, FONT_SIZE.max) });
});
if (fontAutoBtn) {
  fontAutoBtn.addEventListener('click', () => {
    // toggle：Auto ↔ DEFAULT。按 "自動" 切到 Auto（0）；已在 Auto 再按切回 DEFAULT
    const next = current.fontSize === FONT_SIZE.auto
      ? FONT_SIZE.default
      : FONT_SIZE.auto;
    save({ fontSize: next });
  });
}

// 行距：與字級同 Auto + stepper 模式
const lhDecBtn = document.querySelector('[data-action="line-height-dec"]');
const lhIncBtn = document.querySelector('[data-action="line-height-inc"]');
if (lhDecBtn) lhDecBtn.addEventListener('click', () => {
  if (current.lineHeight === LINE_HEIGHT.auto) return;
  save({ lineHeight: roundStep(clamp(current.lineHeight - LINE_HEIGHT.step, LINE_HEIGHT.min, LINE_HEIGHT.max)) });
});
if (lhIncBtn) lhIncBtn.addEventListener('click', () => {
  if (current.lineHeight === LINE_HEIGHT.auto) {
    save({ lineHeight: LINE_HEIGHT.default });
    return;
  }
  save({ lineHeight: roundStep(clamp(current.lineHeight + LINE_HEIGHT.step, LINE_HEIGHT.min, LINE_HEIGHT.max)) });
});
if (lineHeightAutoBtn) {
  lineHeightAutoBtn.addEventListener('click', () => {
    const next = current.lineHeight === LINE_HEIGHT.auto ? LINE_HEIGHT.default : LINE_HEIGHT.auto;
    save({ lineHeight: next });
  });
}

// 段落間距：與字級同 Auto + stepper 模式（Auto sentinel = -1，因為 0 是合法值）
const psDecBtn = document.querySelector('[data-action="paragraph-spacing-dec"]');
const psIncBtn = document.querySelector('[data-action="paragraph-spacing-inc"]');
if (psDecBtn) psDecBtn.addEventListener('click', () => {
  if (current.paragraphSpacing === PARAGRAPH_SPACING.auto) return;
  save({ paragraphSpacing: roundStep(clamp(current.paragraphSpacing - PARAGRAPH_SPACING.step, PARAGRAPH_SPACING.min, PARAGRAPH_SPACING.max)) });
});
if (psIncBtn) psIncBtn.addEventListener('click', () => {
  if (current.paragraphSpacing === PARAGRAPH_SPACING.auto) {
    save({ paragraphSpacing: PARAGRAPH_SPACING.default });
    return;
  }
  save({ paragraphSpacing: roundStep(clamp(current.paragraphSpacing + PARAGRAPH_SPACING.step, PARAGRAPH_SPACING.min, PARAGRAPH_SPACING.max)) });
});
if (paragraphSpacingAutoBtn) {
  paragraphSpacingAutoBtn.addEventListener('click', () => {
    const next = current.paragraphSpacing === PARAGRAPH_SPACING.auto ? PARAGRAPH_SPACING.default : PARAGRAPH_SPACING.auto;
    save({ paragraphSpacing: next });
  });
}
document.querySelector('[data-action="width-dec"]').addEventListener('click', () => {
  save({ contentWidth: clamp(current.contentWidth - CONTENT_WIDTH.step, CONTENT_WIDTH.min, CONTENT_WIDTH.max) });
});
document.querySelector('[data-action="width-inc"]').addEventListener('click', () => {
  save({ contentWidth: clamp(current.contentWidth + CONTENT_WIDTH.step, CONTENT_WIDTH.min, CONTENT_WIDTH.max) });
});
if (fontFamilySelect) {
  fontFamilySelect.addEventListener('change', (e) => {
    save({ fontFamily: e.target.value });
  });
}

// 字粗 segmented
for (const btn of boldTextBtns) {
  btn.addEventListener('click', () => {
    save({ boldText: btn.dataset.bold === 'true' });
  });
}

// ---- 切換閱讀模式 ------------------------------------------------------
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

toggleBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = '無法取得當前分頁';
    statusEl.hidden = false;
    return;
  }

  const { toggleWithInjectionFallback } = window.__JReadPopup;
  const result = await toggleWithInjectionFallback(tabId, {
    sendMessage: (id, msg) => chrome.tabs.sendMessage(id, msg),
    executeScript: (opts) => chrome.scripting.executeScript(opts)
  });

  if (result.ok) {
    window.close();
  } else {
    statusEl.textContent = '此頁面無法啟動閱讀模式';
    statusEl.hidden = false;
  }
});

openOptionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ---- Readwise Reader 整合 ----------------------------------------------
// popup 開啟時查 reader mode 是否啟動，沒啟動就把按鈕 disable。
// 沒注入 content script 的頁面（chrome://、Web Store 等）sendMessage 會 reject，
// 同樣 disable。
function setReadwiseStatus(text, kind) {
  if (!text) {
    readwiseStatusEl.hidden = true;
    readwiseStatusEl.textContent = '';
    readwiseStatusEl.className = '';
    return;
  }
  readwiseStatusEl.hidden = false;
  readwiseStatusEl.textContent = text;
  readwiseStatusEl.className = kind || 'info';
}

// v0.7.130：非閱讀模式時整顆按鈕隱藏（不只 disabled）。 reader mode 才是
// 「送到 Readwise」有意義的入口；非閱讀模式露出灰色 disabled 按鈕只是雜訊。
// 用 `hidden` 屬性（瀏覽器原生 display:none），保留 `disabled` 給「送出中
// 防連點」用——hidden 與 disabled 是兩個獨立軸：hidden=「現在不該看到」、
// disabled=「看得到但暫時不能按」。
//
// v0.7.133：擴增為 refreshPopupForActiveTab，同時依 siteMode 切換 toggle 按鈕
// 文字（YouTube watch → 影院模式）。Readwise 按鈕在 cinema mode 下強制 hidden
// （cinema mode 沒主文 outerHTML 可送，按鈕露出無意義）。
async function refreshPopupForActiveTab() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    readwiseBtn.hidden = true;
    borderlessBtn.hidden = true;
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_READER_STATE' });
    const siteMode = res && res.siteMode;
    const active = !!(res && res.active);
    const cinemaActive = !!(res && res.cinemaActive);
    const borderlessActive = !!(res && res.borderlessActive);
    // YouTube watch 頁：toggle 按鈕文字改「啟動 / 退出影院模式」；其他站維持
    // popup.html 的 default「切換閱讀模式」。
    if (siteMode === 'youtube-cinema') {
      toggleBtn.textContent = cinemaActive ? '退出影院模式' : '啟動影院模式';
    }
    // v0.7.134：無邊模式按鈕——YouTube watch 頁才露出（與 cinema 完全獨立、
    // 兩者可同時 toggle）。按鈕文字依 borderless 自己的 active 狀態切換。
    if (siteMode === 'youtube-cinema') {
      borderlessBtn.hidden = false;
      borderlessBtn.textContent = borderlessActive ? '退出無邊模式' : '啟動無邊模式';
    } else {
      borderlessBtn.hidden = true;
    }
    // Readwise 按鈕：active=true 且 非 cinema 才露出（cinema 沒主文可送）
    readwiseBtn.hidden = !active || cinemaActive;
  } catch (_) {
    readwiseBtn.hidden = true;
    borderlessBtn.hidden = true;
  }
}

// v0.7.134：點按鈕 → sendMessage TOGGLE_YT_BORDERLESS。content script 端
// 委派給 NS.borderless.toggle()；無 inject fallback（YouTube watch 頁本身
// 一定載過 jread content script，不會發生 receiving end does not exist）。
borderlessBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_YT_BORDERLESS' });
  } catch (_) { /* content script 沒注入時 silently fail */ }
  window.close();
});

readwiseBtn.addEventListener('click', async () => {
  readwiseBtn.disabled = true;
  setReadwiseStatus('送出中…', 'info');

  const tabId = await getActiveTabId();
  if (!tabId) {
    setReadwiseStatus('無法取得當前分頁', 'err');
    readwiseBtn.disabled = false;
    return;
  }

  let extracted;
  try {
    extracted = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_READER_HTML' });
  } catch (e) {
    setReadwiseStatus('無法取得頁面內容（請重新啟動閱讀模式）', 'err');
    readwiseBtn.disabled = false;
    return;
  }
  if (!extracted || !extracted.ok) {
    setReadwiseStatus('閱讀模式未啟動', 'err');
    readwiseBtn.disabled = false;
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: 'SAVE_TO_READWISE',
    payload: extracted.payload
  });

  if (result && result.ok) {
    setReadwiseStatus(result.status === 200 ? '已存在於 Readwise Reader' : '已送到 Readwise Reader', 'ok');
  } else if (result && result.error === 'NO_TOKEN') {
    setReadwiseStatus('尚未設定 Readwise token，請到「進階設定」填入', 'err');
  } else if (result && result.error === 'AUTH') {
    setReadwiseStatus('Readwise token 無效或已過期', 'err');
  } else if (result && result.error === 'NETWORK') {
    setReadwiseStatus('網路錯誤，請稍後再試', 'err');
  } else {
    const detail = result && result.status ? `（HTTP ${result.status}）` : '';
    setReadwiseStatus(`送出失敗${detail}`, 'err');
  }
  readwiseBtn.disabled = false;
});

refreshPopupForActiveTab();

// ---- v0.7.155：此網域自動啟動 toggle ----------------------------------------
// 在 popup 開啟時拉當前 tab 的 hostname + 從 storage 讀 autoEnableDomains，
// 反映 checkbox 狀態。chrome:// / file:// / about: / 無 host 的 URL 整 row hidden。
// Toggle ON：把當前 hostname 加進清單（若尚未被 match）。
// Toggle OFF：移除清單中**所有**符合此 hostname 的 entry（含更寬的 pattern，
//   如 'abc.com'）——確保使用者按關閉後，此頁面真的不會再 auto-enter。
//   tooltip 已說明此語意。
async function getActiveTabUrlInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;
    const u = new URL(tab.url);
    // 只認 http/https；其他 scheme（chrome://、about:、file://、chrome-extension://）
    // 沒 meaningful hostname、auto-enable 也不會生效，整 row 隱藏比較乾淨。
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { hostname: (u.hostname || '').toLowerCase() };
  } catch (_) { return null; }
}

let currentHostname = '';

async function refreshAutoDomainRow() {
  const info = await getActiveTabUrlInfo();
  const helper = window.__JReadDomainMatch;
  if (!info || !info.hostname || !helper) {
    autoDomainRow.hidden = true;
    return;
  }
  currentHostname = info.hostname;
  autoDomainHostEl.textContent = info.hostname;
  autoDomainRow.hidden = false;
  chrome.storage.sync.get({ autoEnableDomains: [] }, (values) => {
    const list = Array.isArray(values.autoEnableDomains) ? values.autoEnableDomains : [];
    autoDomainCb.checked = helper.matchHostname(currentHostname, list);
  });
}

autoDomainCb.addEventListener('change', () => {
  const helper = window.__JReadDomainMatch;
  if (!helper || !currentHostname) return;
  const wantOn = autoDomainCb.checked;
  chrome.storage.sync.get({ autoEnableDomains: [] }, (values) => {
    const list = Array.isArray(values.autoEnableDomains) ? values.autoEnableDomains.slice() : [];
    let next;
    if (wantOn) {
      // 已 match 則不重複加（例如清單中已有 abc.com、目前 hostname=www.abc.com）
      next = helper.matchHostname(currentHostname, list)
        ? list
        : list.concat([currentHostname]);
    } else {
      next = helper.removeMatching(currentHostname, list);
    }
    chrome.storage.sync.set({ autoEnableDomains: helper.parseList(next.join('\n')) });
  });
});

// 跨 tab / options 同步：清單在他處變動時，popup checkbox 立刻反映
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !('autoEnableDomains' in changes)) return;
    const helper = window.__JReadDomainMatch;
    if (!helper || !currentHostname) return;
    const list = Array.isArray(changes.autoEnableDomains.newValue) ? changes.autoEnableDomains.newValue : [];
    autoDomainCb.checked = helper.matchHostname(currentHostname, list);
  });
}

refreshAutoDomainRow();
