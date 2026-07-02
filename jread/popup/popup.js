// JRead — Popup entry
// 綁 DOM 事件、呼叫 chrome API、委派核心邏輯給 popup-core.js。
// 狀態提示主要走頁面 toast（content script 負責渲染）；popup 本身僅在
// toast 進不去的禁止注入頁面（例如 chrome://）顯示錯誤。
// 頁面設定直接寫入 browser.storage.sync，content script 透過
// browser.storage.onChanged 即時套用（不需要額外訊息協定）。

const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');
const borderlessBtn = document.getElementById('borderless-btn');
const readerBtn = document.getElementById('reader-btn');
const readwiseBtn = document.getElementById('readwise-btn');
const editBtn = document.getElementById('edit-btn');
const readwiseStatusEl = document.getElementById('readwise-status');
const openOptionsLink = document.getElementById('open-options');
const shortcutEl = document.getElementById('shortcut-hint');
const fontSizeValEl = document.getElementById('font-size-val');
const fontAutoBtn = document.getElementById('font-auto-btn');
const titleFontSizeValEl = document.getElementById('title-font-size-val');
const titleFontAutoBtn = document.getElementById('title-font-auto-btn');
const lineHeightValEl = document.getElementById('line-height-val');
const lineHeightAutoBtn = document.getElementById('line-height-auto-btn');
const paragraphSpacingValEl = document.getElementById('paragraph-spacing-val');
const paragraphSpacingAutoBtn = document.getElementById('paragraph-spacing-auto-btn');
const contentWidthValEl = document.getElementById('content-width-val');
const fontFamilySelect = document.getElementById('font-family-select');
const latinFontSelect = document.getElementById('latin-font-select');
const latinFontRow = document.getElementById('latin-font-row');
const fontWeightBtns = document.querySelectorAll('[data-weight]');
const themeBtns = document.querySelectorAll('.theme-btn');
const autoDomainRow = document.getElementById('auto-domain-row');
const autoDomainCb = document.getElementById('auto-domain-cb');
const autoDomainHostEl = document.getElementById('auto-domain-host');
const pagedModeCb = document.getElementById('paged-mode-cb');

// ---- 頁內浮層模式（v0.8.162，?panel=1）-------------------------------------
// 懸浮按鈕長按選單的「功能選單」在非 Safari 把本 popup 以 iframe 嵌進網頁當頁內
// 浮層（src 帶 ?panel=1，floating-icon.js openFeaturePanelIframe）。嵌入頁無法
// 自關（window.close 無效）→ 改 postMessage 通知外層 content script 收掉浮層；
// 並回報內容高/寬讓外層 iframe 收緊到內容尺寸（不留白）。非 panel（原生工具列
// popup）一律 no-op，維持原本行為。
const IS_PANEL = (() => {
  try { return new URLSearchParams(location.search).get('panel') === '1'; }
  catch (_e) { return false; }
})();
function closePanel() {
  if (!IS_PANEL) return;
  try { window.parent.postMessage({ type: 'jread-close-panel' }, '*'); } catch (_e) {}
}
if (IS_PANEL) {
  document.body.classList.add('panel-mode');
  const postPanelSize = () => {
    try {
      const rect = document.body.getBoundingClientRect();
      window.parent.postMessage({
        type: 'jread-panel-size',
        height: Math.ceil(rect.height),
        width: Math.ceil(rect.width)
      }, '*');
    } catch (_e) {}
  };
  window.addEventListener('load', postPanelSize);
  if (window.ResizeObserver) {
    try { new ResizeObserver(postPanelSize).observe(document.body); } catch (_e) {}
  }
  setTimeout(postPanelSize, 0);
}

// v0.8.163：iPad 工具列 popover 高度受限，全展開內容（zoom 1.35 下 ~845px）底部被
// 截斷（Jimmy iPad 截圖）。CSS 的 pointer:coarse 媒體查詢分不出 iPad（popover）與
// iPhone（底部 sheet，空間較足）——兩者 popup viewport 寬度相近。改用 screen 短邊
// 判別（iPad mini 短邊 744、最大 iPhone Pro Max 約 430，門檻 600 乾淨分離；Mac 上
// 跑 iOS build 時 maxTouchPoints=0 排除）標記 body.device-ipad，CSS 對 iPad 降 zoom
// + 壓縮間距。screen 回的是裝置螢幕（非 popover viewport），popover 內仍可靠。
(function markIpad() {
  try {
    const shortEdge = Math.min(screen.width || 0, screen.height || 0);
    if ((navigator.maxTouchPoints || 0) >= 3 && shortEdge >= 600) {
      document.body.classList.add('device-ipad');
    }
  } catch (_e) { /* screen 缺席等罕見環境：不標記，維持 1.35 */ }
})();

// ---- 設定範圍常數（對齊 SPEC 預設值）----------------------------------
// fontSize 特殊值 0 = "Auto / 原站字級"（styler 不注入任何 font-size override）
const FONT_SIZE = { min: 12, max: 32, step: 1, default: 18, auto: 0 };
// v0.8.158：標題字級（h1）從 options 移來。0 = Auto（保留原站標題大小）；stepper
// 範圍 [16, 96] step 2、default 32；styler clamp [8, 200] 為最終防線。
const TITLE_FONT_SIZE = { min: 16, max: 96, step: 2, default: 32, auto: 0 };
// v0.7.237：上限 1200 → 1600。寬視窗（iPad 橫向 / 桌面寬螢幕）下版心可調更
// 寬；styler 端 clamp [300, 2000] 仍是最終防線（1600 < 2000 安全）。窄視窗
// （手機）下 card 受 viewport clamp，上限拉高不影響——viewport < contentWidth
// 時 max-width cap 無效、實際寬 = viewport（這是「手機調版心無感」的本質）。
const CONTENT_WIDTH = { min: 480, max: 1600, step: 40, default: 720 };
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
// v0.8.16：font stacks 與 DEFAULT_SETTINGS 改讀 settings-defaults.js 單一資料源
//（由 popup.html `<script src="../content/settings-defaults.js">` 在 popup.js
// 之前載入）。原本 popup 各自宣告一份完整字面值、靠 forcing spec 人工校對防
// drift（CLAUDE.md 工作流原則 5 點名）。UI 常數（FONT_SIZE / CONTENT_WIDTH /
// LINE_HEIGHT / PARAGRAPH_SPACING）仍是 popup 專用（slider 邊界 + Auto sentinel），
// 不在此整併。注意：popup.html 的 fontFamily <option value> 是靜態 HTML 拷貝，
// 由 serif-font-stack spec 校對與 FONT_STACKS 一致。
const FONT_STACKS = window.__JReadFontStacks;
const DEFAULT_SETTINGS = window.__JReadSettingsDefaults;

versionEl.textContent = browser.runtime.getManifest().version;

// ---- 快速鍵提示 --------------------------------------------------------
// v0.7.220：優先顯示 options 錄的自訂快速鍵（storage.sync.customShortcuts，
// Jimmy 回報：已自訂仍顯示「未設定請到 chrome://extensions/shortcuts」——
// 舊版只看 commands.getAll 的 browser 層指派，不知道自訂鍵存在）。
// 順位：觸控手勢（v0.7.232）→ 自訂鍵 → browser 層指派（commands.getAll）→
// 未設定提示（指向進階設定的 recorder，不再指 chrome://extensions/shortcuts
// ——Safari 沒有那頁）→ commands API 缺席且無自訂才整列隱藏。
// v0.7.217 iOS Safari guard 保留：browser.commands 可能缺席，top-level 直呼
// 會 TypeError 中斷整個 popup。
browser.storage.sync.get({ customShortcuts: DEFAULT_SETTINGS.customShortcuts }).then((v) => {
  if (!shortcutEl) return;
  // v0.7.232：觸控裝置（maxTouchPoints >= 3，門檻與 touch-gestures.js 安裝
  // 條件一致）的主 toggle 通道是 3 指輕點、不是鍵盤——footer 提示改顯示
  // 手勢，優先於自訂鍵 / browser 指派（觸控恆可用，外接鍵盤未必在）。
  if ((navigator.maxTouchPoints || 0) >= 3) {
    shortcutEl.textContent = '三指輕點：切換純閱讀';
    return;
  }
  const SCU = window.__JReadShortcuts;
  const table = SCU.sanitizeTable(v && v.customShortcuts);
  const custom = table['toggle-reader-mode'];
  if (custom) {
    shortcutEl.textContent = `快速鍵：${SCU.format(custom)}`;
    return;
  }
  // v0.8.164：browser.commands.getAll 原生 Promise（reject → 隱藏整列）。
  if (browser.commands && browser.commands.getAll) {
    browser.commands.getAll().then((commands) => {
      const cmd = (commands || []).find(c => c.name === 'toggle-reader-mode');
      const shortcut = cmd && cmd.shortcut;
      shortcutEl.textContent = shortcut
        ? `快速鍵：${shortcut}`
        : '快速鍵未設定——可在進階設定錄製';
    }).catch(() => { shortcutEl.hidden = true; });
  } else {
    shortcutEl.hidden = true;
  }
}).catch(() => {});

// ---- 設定面板 ----------------------------------------------------------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function render(settings) {
  const isAuto = settings.fontSize === FONT_SIZE.auto;
  fontSizeValEl.textContent = isAuto ? 'Auto' : String(settings.fontSize);
  // 標題字級：Auto sentinel = 0
  const isTitleAuto = settings.titleFontSize === TITLE_FONT_SIZE.auto;
  if (titleFontSizeValEl) {
    titleFontSizeValEl.textContent = isTitleAuto ? 'Auto' : String(settings.titleFontSize);
  }
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
  // 標題字級邊界 disable（Auto 模式下 - disable、+ 從 Auto 跳到 default）
  const tfDec = document.querySelector('[data-action="title-font-dec"]');
  const tfInc = document.querySelector('[data-action="title-font-inc"]');
  if (tfDec) tfDec.disabled = isTitleAuto || settings.titleFontSize <= TITLE_FONT_SIZE.min;
  if (tfInc) tfInc.disabled = !isTitleAuto && settings.titleFontSize >= TITLE_FONT_SIZE.max;
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
  if (titleFontAutoBtn) titleFontAutoBtn.classList.toggle('active', isTitleAuto);
  if (lineHeightAutoBtn) lineHeightAutoBtn.classList.toggle('active', isLhAuto);
  if (paragraphSpacingAutoBtn) paragraphSpacingAutoBtn.classList.toggle('active', isPsAuto);
  // 字重 segmented（細 300 / 中 400 / 粗 600）
  for (const btn of fontWeightBtns) {
    btn.classList.toggle('active', String(settings.fontWeight) === btn.dataset.weight);
  }
  // 字型 select：value 對 4 個 option match 不到（例如外部直接 storage.set
  // 自訂 stack）時 fall back 顯示「系統預設」但不寫回 storage，避免默默改動
  // 使用者外部設定。
  if (fontFamilySelect) {
    fontFamilySelect.value = settings.fontFamily;
    if (fontFamilySelect.value === '') fontFamilySelect.value = FONT_STACKS.system;
  }
  // v0.8.144：英文（拉丁）fallback 字型 row——襯線 / 無襯線時可自訂，各自載入記住
  // 的選擇（latinSerif / latinSans）。
  // v0.8.147：row 改為**永遠顯示**（不跳版）；系統預設 / 等寬 / 外部自訂 stack 時
  // 英文無 base stack 可前接、不可自訂，select 設 disabled 並顯示「跟隨中文字型」
  // 狀態（__follow sentinel，文字隨中文字型 = 系統預設 / 等寬 動態切換）。
  if (latinFontSelect && latinFontRow) {
    const ff = settings.fontFamily;
    latinFontRow.hidden = false;
    if (ff === FONT_STACKS.serif) {
      latinFontSelect.disabled = false;
      latinFontSelect.value = settings.latinSerif || 'auto';
    } else if (ff === FONT_STACKS.sans) {
      latinFontSelect.disabled = false;
      latinFontSelect.value = settings.latinSans || 'auto';
    } else {
      // 不可自訂：顯示跟隨中文字型的狀態（系統預設 / 等寬）
      latinFontSelect.disabled = true;
      const followOpt = latinFontSelect.querySelector('option[value="__follow"]');
      if (followOpt) followOpt.textContent = ff === FONT_STACKS.mono ? '等寬' : '系統預設';
      latinFontSelect.value = '__follow';
    }
    // value 對不到 option（外部寫入怪值）時 fall back 顯示「自動」
    if (latinFontSelect.value === '') latinFontSelect.value = 'auto';
    // v0.8.147：把 select 顯示值用「選定字型」本身渲染（預覽）
    applyLatinPreview();
  }
  // v0.7.227：翻頁模式 checkbox（嚴格 === true，外部寫入非 boolean 當關）
  if (pagedModeCb) pagedModeCb.checked = settings.pagedMode === true;
}

let current = { ...DEFAULT_SETTINGS };

// v0.7.143：debounce storage.sync.set 防 browser.storage.sync quota 踩線。
// 連點 stepper（fontSize 12-32 跨 20 step、contentWidth 480-1200 跨 18 step）
// 每 click 觸發一次 set，加上 storage.onChanged broadcast 到所有 tab 的 content
// script、各自跑 styler restore+apply，連環 cost。browser.storage.sync quota：
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
    // v0.8.35：MV3 promise 模式下 set() 失敗（QuotaExceeded / 寫入頻率超限）是
    // promise rejection，同步 try/catch 接不到——必須 .catch 吞掉，否則 unhandled
    // rejection。current 已有最新值，下次 popup 開啟仍會走 storage.get。
    const p = browser.storage.sync.set(patch);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) { /* callback 模式（無 promise 回傳）的同步 throw 兜底 */ }
  notifyContentReapply();
}

// v0.8.148：主動叫 content script 即時重套設定。為什麼需要：iOS Safari popup 開啟時
// 底層頁面被掛起，content 的 storage.onChanged 廣播被丟掉（桌機 Chrome 頁面在 popup
// 後仍存活故照收）→ 改主題 / 字級閱讀模式不即時生效、要重整。runtime 訊息在 iOS 仍
// 會送達（toggle 走同路徑可用為證），故額外送 REAPPLY_SETTINGS 補上。fire-and-forget：
// 非注入頁 / 連不上 / 非閱讀模式都會被 content 端 guard 或 reject 吞掉；桌機與
// onChanged 經 content 端 200ms debounce 合併、不雙重重套。
function notifyContentReapply() {
  getActiveTabId().then((tabId) => {
    if (typeof tabId !== 'number') return;
    const p = browser.tabs.sendMessage(tabId, { type: 'REAPPLY_SETTINGS' });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }).catch(() => {});
}

function save(patch) {
  Object.assign(current, patch);
  Object.assign(pendingPatch, patch);
  render(current);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(commitSave, 200);
  // content script 透過 storage.onChanged 即時重新套用（若閱讀模式開啟）
}

// popup 即將關閉時強制 flush pending patch（不然連點後立刻關 popup 會丟失最後幾次變更）。
// v0.8.35：改聽 pagehide + visibilitychange——Chrome action popup 關閉不走一般
// navigation path，beforeunload 長期不可靠；iOS Safari 則完全不支援 beforeunload
// （popup sheet 收合同樣丟事件）。pagehide 與 visibilitychange(hidden) 兩者在
// 桌面 Chrome / iOS Safari 都會觸發，雙掛保險（flushPendingSave 冪等，重複呼叫無害）。
function flushPendingSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  commitSave();
}
window.addEventListener('pagehide', flushPendingSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPendingSave();
});

browser.storage.sync.get(DEFAULT_SETTINGS).then((values) => {
  // v0.8.36：merge pendingPatch——popup 開啟瞬間使用者已點擊的變更（Promise
  // resolve 前累積在 pendingPatch、尚未 commit）不可被 storage 舊值蓋回 UI
  current = { ...DEFAULT_SETTINGS, ...values, ...pendingPatch };
  render(current);
}).catch(() => {});

for (const btn of themeBtns) {
  btn.addEventListener('click', () => save({ theme: btn.dataset.theme }));
}

// v0.7.227：翻頁模式 toggle。寫入後 content script 走 storage.onChanged →
// scheduleReapply 即時切換（閱讀模式開啟中也能直接生效）。
if (pagedModeCb) {
  pagedModeCb.addEventListener('change', () => {
    save({ pagedMode: pagedModeCb.checked });
  });
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

// 標題字級：與字級同 Auto + stepper 模式（v0.8.158 從 options 移來）
const tfDecBtn = document.querySelector('[data-action="title-font-dec"]');
const tfIncBtn = document.querySelector('[data-action="title-font-inc"]');
if (tfDecBtn) tfDecBtn.addEventListener('click', () => {
  if (current.titleFontSize === TITLE_FONT_SIZE.auto) return;
  save({ titleFontSize: clamp(current.titleFontSize - TITLE_FONT_SIZE.step, TITLE_FONT_SIZE.min, TITLE_FONT_SIZE.max) });
});
if (tfIncBtn) tfIncBtn.addEventListener('click', () => {
  if (current.titleFontSize === TITLE_FONT_SIZE.auto) {
    save({ titleFontSize: TITLE_FONT_SIZE.default });
    return;
  }
  save({ titleFontSize: clamp(current.titleFontSize + TITLE_FONT_SIZE.step, TITLE_FONT_SIZE.min, TITLE_FONT_SIZE.max) });
});
if (titleFontAutoBtn) {
  titleFontAutoBtn.addEventListener('click', () => {
    const next = current.titleFontSize === TITLE_FONT_SIZE.auto ? TITLE_FONT_SIZE.default : TITLE_FONT_SIZE.auto;
    save({ titleFontSize: next });
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

// v0.8.147：把「英文字型」select 的顯示值用**選定字型本身**渲染（所見即所得預覽）。
// iOS Safari 對 <select> 自身的 font-family 有效（顯示值會換字型）；但展開後的原生
// 滾輪清單 iOS 仍以系統字渲染、無法逐項預覽（平台限制，桌機 Chrome 下拉清單才逐項）。
// 具名字型（含內嵌 woff2 family）取 LATIN_FONTS 值；auto / __follow / 未知 → 清掉
// inline、回到 popup 預設 UI 字型（顯示中文「自動 / 系統預設 / 等寬」用預設字即可）。
function applyLatinPreview() {
  if (!latinFontSelect) return;
  const v = latinFontSelect.value;
  const LATIN = (typeof window !== 'undefined' && window.__JReadLatinFonts) || {};
  latinFontSelect.style.fontFamily =
    (v && v !== 'auto' && v !== '__follow' && LATIN[v]) ? LATIN[v] : '';
}

// v0.8.144：英文（拉丁）fallback 字型——寫進當前字型對應的 key（襯線 → latinSerif、
// 無襯線 → latinSans）。兩者各自記，切回另一個字型時載回各自的選擇。
if (latinFontSelect) {
  latinFontSelect.addEventListener('change', (e) => {
    if (current.fontFamily === FONT_STACKS.serif) save({ latinSerif: e.target.value });
    else if (current.fontFamily === FONT_STACKS.sans) save({ latinSans: e.target.value });
    applyLatinPreview();   // v0.8.147：即時更新預覽字型
  });
}

// 字重 segmented（細 300 / 中 400 / 粗 600）
for (const btn of fontWeightBtns) {
  btn.addEventListener('click', () => {
    save({ fontWeight: Number(btn.dataset.weight) });
  });
}

// ---- 切換閱讀模式 ------------------------------------------------------
async function getActiveTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  // tab.id 理論上一定是 number，但 DevTools / 特殊頁可能回 TAB_ID_NONE(-1)
  // 或缺值；統一正規化成「number 或 null」，呼叫端一律用 typeof 判定，
  // 避免 `if (!tabId)` 把合法的 tab.id===0 誤判為失敗（v0.8.15）。
  return tab && typeof tab.id === 'number' ? tab.id : null;
}

toggleBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (typeof tabId !== 'number') {
    statusEl.textContent = '無法取得當前分頁';
    statusEl.hidden = false;
    return;
  }

  const { toggleWithInjectionFallback } = window.__JReadPopup;
  const result = await toggleWithInjectionFallback(tabId, {
    sendMessage: (id, msg) => browser.tabs.sendMessage(id, msg),
    executeScript: (opts) => browser.scripting.executeScript(opts)
  });

  if (result.ok) {
    flushPendingSave(); // 自家 close 路徑明確 flush，不賭 pagehide 時序
    window.close();
  } else {
    // v0.8.115：區分「真的不支援的頁面」vs「可注入頁但連不上」。後者多半是 iOS
    // Safari 偶發把擴充訊息層回收（Apple Forums 758346）——此頁仍能閱讀、三指
    // 手勢仍可切換，誤報「此頁無法啟動」會害使用者以為頁面壞掉。injectable 判定
    // 複用 getActiveTabUrlInfo（只認 http(s)）；三指提示 gate 在 popup 自身觸控能力。
    const urlInfo = await getActiveTabUrlInfo();
    statusEl.textContent = window.__JReadPopup.toggleFailureMessage({
      injectable: !!urlInfo,
      touch: (navigator.maxTouchPoints || 0) >= 3
    });
    statusEl.hidden = false;
  }
});

openOptionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  // panel 浮層模式：設定頁在新分頁開啟後收掉頁內浮層（避免覆蓋在底層頁上殘留）
  closePanel();
});

// ---- v1.0.22：進入 Reader（Readwise 收件匣 feed）-----------------------------
// 開新分頁載 reader/reader.html（擴充自有頁），列 Readwise inbox 最新十篇。全域
// 入口，與當前分頁閱讀狀態無關；僅在已設 readwiseToken 時顯示（沒 token 進去也
// 只會看到「請填 token」訊息，按鈕露出只是雜訊，比照 readwise-btn 的 token gate）。
async function refreshReaderButton() {
  // v1.5.1：在 reader 自有頁（reader/ 下的 feed／article）本就「已在 Reader」，
  // 這顆全域入口是雜訊——直接隱藏（與 refreshPopupForActiveTab 的 readerHostPage
  // 隱藏一致，URL 前綴判定不依賴 GET_READER_STATE round-trip，無 async 競態）。
  try {
    if (await isReaderHostTab()) { readerBtn.hidden = true; return; }
  } catch (_) { /* 判定失敗則回退到 token gate */ }
  try { readerBtn.hidden = !(await hasActiveServiceCredentials()); }
  catch (_) { readerBtn.hidden = true; }
}

// 當前作用分頁是否為 reader 自有頁（chrome-extension://<id>/reader/…）。
async function isReaderHostTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return false;
    return tab.url.startsWith(browser.runtime.getURL('reader/'));
  } catch (_) { return false; }
}

// v1.5.4：當前作用分頁是否為 reader feed 列表頁（reader/reader.html）。feed 是
// 文章清單、不是內容頁，「啟動閱讀模式」在此無意義（沒有主文可進閱讀模式）→ 隱藏
// toggle。article.html（reader/article.html）不在此列——它的 toggle = 退出閱讀模式。
async function isReaderFeedTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return false;
    return tab.url.startsWith(browser.runtime.getURL('reader/reader.html'));
  } catch (_) { return false; }
}
readerBtn.addEventListener('click', async () => {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL('reader/reader.html') });
  } catch (_) { /* tabs.create 失敗（極罕見）靜默吞掉 */ }
  flushPendingSave(); // 自家 close 路徑明確 flush，不賭 pagehide 時序
  window.close();
});
refreshReaderButton();

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
//
// v0.8.50：未設定 readwiseToken 時按鈕也整顆 hidden（Jimmy 2026-06-12）——
// 沒 token 按下去必然走到「尚未設定 token」錯誤，按鈕露出只是雜訊。token
// 在 popup 開啟期間於 options 填入的情境不需即時反映（開 options 時 popup
// 已關閉，下次開啟重新讀取）。
// v1.6.0：儲存服務二擇一——依 storageService 判斷當前服務的憑證是否齊備
//（readwise：readwiseToken；instapaper：instapaperToken + instapaperTokenSecret）。
// 憑證解析單一資料源在 popup-core.resolveServiceCredentials（reader / SW 共用）。
// 沿用 hasReadwiseToken 舊語意（沒憑證 → 送出 / 進 Reader 按鈕整顆隱藏）。
function hasActiveServiceCredentials() {
  try {
    const DEF = window.__JReadSettingsDefaults || {};
    return browser.storage.sync.get({
      storageService: DEF.storageService || 'readwise',
      readwiseToken: '',
      instapaperToken: '',
      instapaperTokenSecret: ''
    }).then((v) => {
      const r = window.__JReadPopup.resolveServiceCredentials(v || {});
      return !!(r && r.ok);
    }).catch(() => false);
  } catch (_) { return Promise.resolve(false); }
}

// 當前儲存服務（'readwise' | 'instapaper'），供送出按鈕 label 用。
function getStorageService() {
  try {
    const DEF = window.__JReadSettingsDefaults || {};
    return browser.storage.sync.get({ storageService: DEF.storageService || 'readwise' })
      .then((v) => (v && v.storageService === 'instapaper') ? 'instapaper' : 'readwise')
      .catch(() => 'readwise');
  } catch (_) { return Promise.resolve('readwise'); }
}

// 送出按鈕文字 + tooltip 依當前儲存服務切換。
async function updateSendButtonLabel() {
  try {
    const service = await getStorageService();
    const label = window.__JReadPopup.serviceLabel(service);
    readwiseBtn.textContent = '送到 ' + label;
    readwiseBtn.title = '把當前 reader card 內容送到 ' + label;
  } catch (_) { /* 讀取失敗保留 HTML 預設文字 */ }
}

// v0.8.109：編輯模式按鈕受 options「編輯模式」開關控制。預設 true（!== false）
// ——關閉後 popup 不顯示「編輯模式：移除雜訊」按鈕。
function isEditModeEnabled() {
  // v0.8.164：browser.storage.sync.get 原生 Promise（reject / throw → 預設 true）。
  try {
    return browser.storage.sync.get({ editModeEnabled: true })
      .then((v) => !v || v.editModeEnabled !== false)
      .catch(() => true);
  } catch (_) { return Promise.resolve(true); }
}

async function refreshPopupForActiveTab() {
  // v1.5.4：reader feed 列表頁（reader/reader.html）——「啟動閱讀模式」沒有意義
  // （feed 是文章清單、非內容頁），整顆 toggle + 次級按鈕全隱藏，只留設定（主題 /
  // 字型…影響點進文章後的閱讀體驗）。article.html 不在此列（toggle = 退出閱讀模式）。
  try {
    if (await isReaderFeedTab()) {
      toggleBtn.hidden = true;
      readerBtn.hidden = true;
      readwiseBtn.hidden = true;
      editBtn.hidden = true;
      borderlessBtn.hidden = true;
      return;
    }
  } catch (_) { /* 判定失敗則照常跑下方一般邏輯 */ }
  const tabId = await getActiveTabId();
  if (typeof tabId !== 'number') {
    // 無有效分頁 = 沒有可啟動的閱讀模式，toggle 文字回到「啟動」態（off）。
    toggleBtn.textContent = '啟動閱讀模式';
    readwiseBtn.hidden = true;
    editBtn.hidden = true;
    borderlessBtn.hidden = true;
    return;
  }
  try {
    const res = await browser.tabs.sendMessage(tabId, { type: 'GET_READER_STATE' });
    const siteMode = res && res.siteMode;
    const active = !!(res && res.active);
    const cinemaActive = !!(res && res.cinemaActive);
    const borderlessActive = !!(res && res.borderlessActive);
    const editModeActive = !!(res && res.editModeActive);
    // v1.5.1：reader 自有頁（article feed 閱讀／feed 列表）——「進入 Reader /
    // 送到 Readwise / 編輯模式」三顆在此情境都是雜訊（已在 Reader、文章本就來自
    // Readwise、reader 版型不需手動移雜訊），整批隱藏並提前 return，不跑下方一般邏輯。
    const readerHostPage = !!(res && res.readerHostPage);
    if (readerHostPage) {
      if (siteMode === 'youtube-cinema') {
        toggleBtn.textContent = cinemaActive ? '退出影院模式' : '啟動影院模式';
      } else {
        toggleBtn.textContent = active ? '退出閱讀模式' : '啟動閱讀模式';
      }
      readerBtn.hidden = true;
      readwiseBtn.hidden = true;
      editBtn.hidden = true;
      borderlessBtn.hidden = true;
      return;
    }
    // YouTube watch 頁：toggle 按鈕文字改「啟動 / 退出影院模式」。
    // v0.8.104：其他站不再固定顯示「切換閱讀模式」，改為反映 reader mode 狀態
    //（已啟動 → 「退出閱讀模式」、未啟動 → 「啟動閱讀模式」），與影院模式按鈕
    // 同一套狀態化詞彙——使用者一眼看出按下去會進還是出。
    if (siteMode === 'youtube-cinema') {
      toggleBtn.textContent = cinemaActive ? '退出影院模式' : '啟動影院模式';
    } else {
      toggleBtn.textContent = active ? '退出閱讀模式' : '啟動閱讀模式';
    }
    // v0.7.134：無邊模式按鈕——YouTube watch 頁才露出（與 cinema 完全獨立、
    // 兩者可同時 toggle）。按鈕文字依 borderless 自己的 active 狀態切換。
    if (siteMode === 'youtube-cinema') {
      borderlessBtn.hidden = false;
      borderlessBtn.textContent = borderlessActive ? '退出無邊模式' : '啟動無邊模式';
    } else {
      borderlessBtn.hidden = true;
    }
    // v0.8.108：編輯模式按鈕——閱讀模式啟動且非 cinema 才露出（cinema 無主文
    // 可編輯）。文字依編輯模式自身狀態切換：未啟動「編輯模式：移除雜訊」、
    // 已啟動「完成編輯」。v0.8.109：另受 options editModeEnabled 開關 gate。
    if (active && !cinemaActive && await isEditModeEnabled()) {
      editBtn.hidden = false;
      editBtn.textContent = editModeActive ? '完成編輯' : '編輯模式：移除雜訊';
    } else {
      editBtn.hidden = true;
    }
    // 送出按鈕：active=true 且 非 cinema 且 當前服務憑證齊備才露出
    // （cinema 沒主文可送；沒憑證按了必失敗，v0.8.50 整顆隱藏）。v1.6.0：label
    // 依儲存服務動態切換（送到 Readwise Reader / 送到 Instapaper）。
    readwiseBtn.hidden = !active || cinemaActive || !(await hasActiveServiceCredentials());
    if (!readwiseBtn.hidden) await updateSendButtonLabel();
  } catch (_) {
    // content script 未注入（禁注入頁 / 尚未載入）= reader mode 必為 off，
    // toggle 文字回到「啟動」態（按下去會走 inject fallback 嘗試進入）。
    toggleBtn.textContent = '啟動閱讀模式';
    readwiseBtn.hidden = true;
    editBtn.hidden = true;
    borderlessBtn.hidden = true;
  }
}

// v0.7.134：點按鈕 → sendMessage TOGGLE_YT_BORDERLESS。content script 端
// 委派給 NS.borderless.toggle()；無 inject fallback（YouTube watch 頁本身
// 一定載過 jread content script，不會發生 receiving end does not exist）。
borderlessBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (typeof tabId !== 'number') return;
  try {
    await browser.tabs.sendMessage(tabId, { type: 'TOGGLE_YT_BORDERLESS' });
  } catch (_) { /* content script 沒注入時 silently fail */ }
  flushPendingSave(); // 自家 close 路徑明確 flush，不賭 pagehide 時序
  window.close();
});

// v0.8.108：編輯模式 toggle。送 EDIT_MODE_TOGGLE 給 content script 後關閉
// popup——編輯互動在頁面內進行（hover 標亮 + 點擊移除 + 頁內 toolbar），popup
// 留著沒意義。content 端 enterEditMode 內 guard 閱讀模式須 active。
editBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (typeof tabId !== 'number') return;
  try {
    await browser.tabs.sendMessage(tabId, { type: 'EDIT_MODE_TOGGLE' });
  } catch (_) { /* content script 沒注入時 silently fail */ }
  flushPendingSave(); // 自家 close 路徑明確 flush，不賭 pagehide 時序
  window.close();
});

readwiseBtn.addEventListener('click', async () => {
  readwiseBtn.disabled = true;
  setReadwiseStatus('送出中…', 'info');

  const tabId = await getActiveTabId();
  if (typeof tabId !== 'number') {
    setReadwiseStatus('無法取得當前分頁', 'err');
    readwiseBtn.disabled = false;
    return;
  }

  let extracted;
  try {
    extracted = await browser.tabs.sendMessage(tabId, { type: 'EXTRACT_READER_HTML' });
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

  // v1.6.0：讀儲存服務二擇一設定 + 兩服務憑證 + 摘要開關。
  const DEF = window.__JReadSettingsDefaults || {};
  const cfg = await browser.storage.sync.get({
    storageService: DEF.storageService || 'readwise',
    readwiseToken: '',
    instapaperToken: '',
    instapaperTokenSecret: '',
    readwiseSummary: false,
    geminiApiKey: ''
  }).then((v) => v || {}).catch(() => ({}));
  const { service, creds, ok } = window.__JReadPopup.resolveServiceCredentials(cfg);
  const label = window.__JReadPopup.serviceLabel(service);
  if (!ok) {
    setReadwiseStatus(`尚未設定 ${label} 憑證，請到「進階設定」填入`, 'err');
    readwiseBtn.disabled = false;
    return;
  }

  // v0.8.72：若開啟「自動摘要」且已設 Gemini key，先用 Gemini Flash Lite 產生繁中
  // 三句摘要塞進 payload.summary（兩服務共用——Readwise 對映 summary、Instapaper
  // 對映 description）。任何失敗都 fallback 不帶 summary 照送，不阻斷儲存。
  if (cfg.readwiseSummary && cfg.geminiApiKey && extracted.payload && extracted.payload.text) {
    setReadwiseStatus('產生摘要中…', 'info');
    try {
      const sum = await window.__JReadPopup.generateGeminiSummary({
        apiKey: cfg.geminiApiKey,
        title: extracted.payload.title,
        author: extracted.payload.author,
        domain: extracted.payload.domain,
        text: extracted.payload.text
      });
      if (sum && sum.ok) extracted.payload.summary = sum.summary;
    } catch (_) { /* 摘要失敗不阻斷，照送 */ }
    setReadwiseStatus('送出中…', 'info');
  }

  // v1.6.0：走 sendDocument dispatcher，在 popup（extension 頁）自己 fetch、不繞
  // background（iOS Safari 背景頁掛起會 silently 失敗，見 popup-core 註解）。
  const result = await window.__JReadPopup.sendDocument({ service, creds, payload: extracted.payload });

  if (result && result.ok) {
    // Readwise 200=已存在、201=新建；Instapaper 無此區分，一律「已送到」
    setReadwiseStatus((service === 'readwise' && result.status === 200)
      ? `已存在於 ${label}` : `已送到 ${label}`, 'ok');
  } else if (result && result.error === 'NO_CREDENTIALS') {
    setReadwiseStatus(`尚未設定 ${label} 憑證，請到「進階設定」填入`, 'err');
  } else if (result && result.error === 'CONFIG') {
    setReadwiseStatus(`此版本未內建 ${label} 金鑰`, 'err');
  } else if (result && result.error === 'AUTH') {
    setReadwiseStatus(`${label} 憑證無效或已過期`, 'err');
  } else if (result && result.error === 'NETWORK') {
    setReadwiseStatus('網路錯誤，請稍後再試', 'err');
  } else {
    // generic 分支帶上 error code（INVALID_PAYLOAD / HTTP 碼）方便真機回報看出失敗層次
    const detail = result && result.status ? `（HTTP ${result.status}）`
                 : result && result.error ? `（${result.error}）` : '';
    const reason = result && result.detail ? `：${result.detail}` : '';
    setReadwiseStatus(`送出失敗${detail}${reason}`, 'err');
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
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
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
  browser.storage.sync.get({ autoEnableDomains: [] }).then((values) => {
    const list = Array.isArray(values.autoEnableDomains) ? values.autoEnableDomains : [];
    autoDomainCb.checked = helper.matchHostname(currentHostname, list);
  }).catch(() => {});
}

autoDomainCb.addEventListener('change', () => {
  const helper = window.__JReadDomainMatch;
  if (!helper || !currentHostname) return;
  const wantOn = autoDomainCb.checked;
  browser.storage.sync.get({ autoEnableDomains: [] }).then((values) => {
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
    const p = browser.storage.sync.set({ autoEnableDomains: helper.parseList(next.join('\n')) });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }).catch(() => {});
});

// 跨 tab / options 同步：清單在他處變動時，popup checkbox 立刻反映
if (browser.storage && browser.storage.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !('autoEnableDomains' in changes)) return;
    const helper = window.__JReadDomainMatch;
    if (!helper || !currentHostname) return;
    const list = Array.isArray(changes.autoEnableDomains.newValue) ? changes.autoEnableDomains.newValue : [];
    autoDomainCb.checked = helper.matchHostname(currentHostname, list);
  });
}

refreshAutoDomainRow();
