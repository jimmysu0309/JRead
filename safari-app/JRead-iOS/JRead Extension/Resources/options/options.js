// JRead — Options
// 進階設定欄位（主題 / 字級 / 標題字級 / 版心寬度 / 字重 已移到 popup 即時調整）。

// v0.8.16：DEFAULTS 改讀 settings-defaults.js 單一資料源（由 options.html
// `<script src="../content/settings-defaults.js">` 在 options.js 之前載入）。
// 原本 options 自宣告一份預設值 literal、靠 forcing spec 校對防 drift（CLAUDE.md
// 工作流原則 5）。shared 是 superset；options 實際只儲存 `fields` 列出的 9 欄
// + customShortcuts + autoEnableDomains，多出的預設 key 僅作 storage.get fallback、
// 不影響儲存範圍。titleFontSize 等欄位自動齊備（修掉 popup 缺 titleFontSize 的舊 drift）。
const DEFAULTS = window.__JReadSettingsDefaults;

// v0.8.158：theme / fontSize / titleFontSize / contentWidth / fontWeight 已移到
// popup（工具列圖示選單）即時調整，options 不再列出這幾欄（避免雙入口 drift）。
const fields = ['storageService', 'readwiseToken', 'readwiseSummary', 'geminiApiKey', 'blockPageShortcuts', 'pangu', 'editModeEnabled', 'spaceScrollRatio', 'positionMemoryDays', 'threeFingerTap', 'floatingIcon', 'floatingIconOpacity', 'floatingIconSize'];

// v0.8.154：懸浮按鈕啟用旗標的解析（settings-defaults.js 單一資料源）。
// 未設過（非 boolean）時一律預設勾（v0.8.158）——checkbox 顯示初值與
// content/floating-icon.js 走同一個 resolver，不在 options 另寫一份判定。
const resolveFloatingIconEnabled = window.__JReadResolveFloatingIconEnabled || ((v) => v === true);

document.getElementById('version').textContent = browser.runtime.getManifest().version;

// ---- 快速鍵 recorder（v0.7.218）--------------------------------------
// 點 recorder 進入錄製狀態 → window keydown capture 抓組合 → validate →
// 寫回 storage.sync.customShortcuts 整張表。比對 / 驗證 / 格式化邏輯共用
// content/shortcut-utils.js（window.__JReadShortcuts），與 content script
// 的 keydown 比對單一資料源。
const SC = window.__JReadShortcuts;
let shortcutTable = SC.sanitizeTable(null); // 三 key 全 null
let recordingCmd = null;                    // 錄製中的 command（null = 沒在錄）

// runtime 偵測（依 extension URL 前綴，非 OS / build flag）：
//   chrome-extension:// → Chrome、moz-extension:// → Firefox、其餘 → Safari
//   （safari-web-extension:// 涵蓋 macOS / iPadOS / iOS Safari）。
// body class 讓「說明文字依引擎切換」純 CSS 完成（不需額外 JS）；
// isSafariRuntime 餵給 validate 的 requireCtrl——Safari 自訂鍵必含 ⌃ Control。
const extUrl = browser.runtime.getURL('');
let runtime = 'safari';
if (extUrl.startsWith('chrome-extension://')) runtime = 'chrome';
else if (extUrl.startsWith('moz-extension://')) runtime = 'firefox';
document.body.classList.add('runtime-' + runtime);
const isSafariRuntime = (runtime === 'safari');

// v0.8.163：三指輕點切換是觸控裝置（iPhone / iPad，maxTouchPoints >= 3）專屬手勢。
// 桌面 Chrome / macOS Safari（含 iOS build 跑在 Mac，無觸控螢幕 maxTouchPoints=0）
// 顯示這個開關只會誤導——touch-gestures.js 在非觸控裝置根本不安裝辨識器（同門檻
// maxTouchPoints >= 3），開了也無效。門檻與 popup footer 手勢提示一致。非觸控整列隱藏。
if ((navigator.maxTouchPoints || 0) < 3) {
  const tfField = document.getElementById('threeFingerTap');
  const field = tfField && tfField.closest('.field');
  if (field) field.hidden = true;
}

// hint 文字加 ⚠ 前綴（空字串不撐空間，CSS :not(:empty) 才上 amber 底框）
function shortcutHint(msg) {
  document.getElementById('shortcut-hint').textContent = msg ? '⚠ ' + msg : '';
}

// 錄製被拒時讓該 recorder 紅框 + 抖動閃一下（~1.2s 後移除）
function flashRecorderInvalid(cmd) {
  const btn = document.getElementById('sc-' + cmd);
  if (!btn) return;
  btn.classList.remove('invalid'); // 連續被拒時重啟動畫
  // 強制 reflow 讓 animation 重新觸發
  void btn.offsetWidth;
  btn.classList.add('invalid');
  setTimeout(() => btn.classList.remove('invalid'), 1200);
}

function renderShortcuts() {
  SC.COMMANDS.forEach((cmd) => {
    const btn = document.getElementById('sc-' + cmd);
    const clearBtn = document.getElementById('sc-clear-' + cmd);
    if (!btn) return;
    const custom = shortcutTable[cmd];
    const def = SC.MANIFEST_DEFAULTS[cmd];
    if (recordingCmd === cmd) {
      btn.textContent = '按下組合鍵…';
    } else if (custom) {
      btn.textContent = SC.format(custom);
    } else {
      btn.textContent = def ? SC.format(def) + '（預設）' : '未設定';
    }
    btn.classList.toggle('recording', recordingCmd === cmd);
    btn.classList.toggle('is-default', !custom && recordingCmd !== cmd);
    if (clearBtn) clearBtn.disabled = !custom;
  });
}

function saveShortcuts() {
  showSaving();
  browser.storage.sync.set({ customShortcuts: shortcutTable }).then(flashSaved).catch(flashSaveError);
}

SC.COMMANDS.forEach((cmd) => {
  document.getElementById('sc-' + cmd).addEventListener('click', () => {
    // 再點同一顆 = 取消錄製
    recordingCmd = recordingCmd === cmd ? null : cmd;
    shortcutHint('');
    renderShortcuts();
  });
  document.getElementById('sc-clear-' + cmd).addEventListener('click', () => {
    shortcutTable[cmd] = null;
    recordingCmd = null;
    shortcutHint('');
    saveShortcuts();
    renderShortcuts();
  });
});

// 錄製用 keydown：capture phase 搶在頁面其他 handler 前
window.addEventListener('keydown', (e) => {
  if (!recordingCmd) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') { // 取消錄製
    recordingCmd = null;
    renderShortcuts();
    return;
  }
  const s = SC.eventToShortcut(e);
  if (!s) return; // 純 modifier 鍵——組合未完成，等下一鍵
  const rejectedCmd = recordingCmd; // flash 用——下面會把 recordingCmd 清掉
  const v = SC.validate(s, { requireCtrl: isSafariRuntime });
  if (!v.ok) {
    shortcutHint(v.reason);
    recordingCmd = null;
    renderShortcuts();
    flashRecorderInvalid(rejectedCmd);
    return;
  }
  // 與其他指令的「生效鍵」（自訂值 || 內建預設）衝突檢查
  for (const other of SC.COMMANDS) {
    if (other === recordingCmd) continue;
    const effective = shortcutTable[other] || SC.MANIFEST_DEFAULTS[other];
    if (effective && SC.shortcutEquals(s, effective)) {
      shortcutHint(SC.format(s) + ' 已指派給其他指令');
      recordingCmd = null;
      renderShortcuts();
      flashRecorderInvalid(rejectedCmd);
      return;
    }
  }
  shortcutTable[recordingCmd] = s;
  recordingCmd = null;
  shortcutHint('');
  saveShortcuts();
  renderShortcuts();
}, true);

// ---- 欄位 ↔ DOM 雙向轉換（單一資料源，load 與 storage.onChanged 共用）------
// v0.8.35：原本 save() 把 9 欄全部從 DOM 讀回整包重寫——options 分頁開著時，
// popup（或另一個 options 分頁）寫入的變更會被本頁 DOM 殘留值無聲蓋回（stale
// overwrite，CLAUDE.md 工作流原則 5 的雙 path drift）。改成：
//   1. 每欄 change 只寫該欄（diff write）
//   2. storage.onChanged 把其他 context 的變更同步回本頁 DOM（全欄位，不只
//      autoEnableDomains）
function readFieldFromDom(id) {
  const el = document.getElementById(id);
  switch (id) {
    case 'spaceScrollRatio': case 'positionMemoryDays':
    case 'floatingIconOpacity': {
      // v0.8.36：number input 的 min/max 屬性不阻止手動輸入超界值或留空
      // （Number('') = 0 → contentWidth 存 0）。以 input 自身的 min/max 為
      // clamp 範圍（單一資料源在 HTML），空值 / NaN 退回 shared 預設值——
      // 與 popup 端 clamp() 防護對齊（原本兩條寫入 path 驗證不一致）
      let n = Number(el.value);
      if (el.value === '' || !Number.isFinite(n)) n = Number(DEFAULTS[id]);
      if (typeof el.min === 'string' && el.min !== '') n = Math.max(Number(el.min), n);
      if (typeof el.max === 'string' && el.max !== '') n = Math.min(Number(el.max), n);
      return n;
    }
    case 'threeFingerTap': case 'floatingIcon':
    case 'blockPageShortcuts': case 'pangu': case 'editModeEnabled': case 'readwiseSummary':
      return el.checked;
    case 'floatingIconSize': {
      // v0.8.166：radio 群（小 / 中 / 大）取代下拉 select；el 是 wrapper（id 在容器上）。
      // 讀已勾選的 radio；損壞 / 無勾選退回預設 'small'。
      const checked = el.querySelector('input[name="floatingIconSize"]:checked');
      const v = checked ? checked.value : 'small';
      return (v === 'medium' || v === 'large') ? v : 'small';
    }
    case 'readwiseToken': case 'geminiApiKey':
      return el.value.trim();
    case 'storageService': {
      // v1.6.0：兩顆分段 toggle（radio 群，wrapper id=storageService）。讀已勾選值；
      // 損壞 / 無勾選退回 'readwise'。
      const checked = el.querySelector('input[name="storageService"]:checked');
      const v = checked ? checked.value : 'readwise';
      return v === 'instapaper' ? 'instapaper' : 'readwise';
    }
    default:
      return el.value;
  }
}

// 透明度 % 讀數（input 拖動即時更新，與 storage 無關）
function updateOpacityReadout(frac) {
  const out = document.getElementById('floatingIconOpacityVal');
  if (out) out.textContent = Math.round(Number(frac) * 100) + '%';
}

// 範例 icon 跟著透明度滑桿（即時不透明度）+ 尺寸 radio 群（icon 大小）變動。
// 尺寸對照與 content/floating-icon.js SIZE_MAP 一致：small=16 / medium=24 / large=32（視覺）。
function updateOpacityDemo() {
  const demo = document.getElementById('floatingIconOpacityDemo');
  if (!demo) return;
  const opacityEl = document.getElementById('floatingIconOpacity');
  const sizeEl = document.getElementById('floatingIconSize');
  if (opacityEl) {
    const o = Number(opacityEl.value);
    demo.style.opacity = String(Math.max(0.1, Math.min(1, Number.isFinite(o) ? o : 0.7)));
  }
  const img = demo.querySelector('img');
  if (img) {
    // v0.8.166：尺寸來源改 radio 群（wrapper id=floatingIconSize 內的 checked radio）
    const checked = sizeEl && sizeEl.querySelector('input[name="floatingIconSize"]:checked');
    const v = checked ? checked.value : 'small';
    const px = v === 'large' ? 32 : v === 'medium' ? 24 : 16;
    img.style.width = px + 'px';
    img.style.height = px + 'px';
  }
}

function applyFieldToDom(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  // 使用者正在編輯的欄位不回寫（避免打字途中被外部變更清掉）
  if (el === document.activeElement) return;
  if (id === 'blockPageShortcuts' || id === 'pangu' || id === 'editModeEnabled') {
    el.checked = value !== false;
  } else if (id === 'threeFingerTap') {
    // v0.8.157：預設 false——只有明確為 true 才勾選
    el.checked = value === true;
  } else if (id === 'floatingIcon') {
    // 三態：boolean 尊重使用者設定；未設過（null / undefined）一律預設勾（v0.8.158）
    el.checked = resolveFloatingIconEnabled(value);
  } else if (id === 'floatingIconOpacity') {
    const n = typeof value === 'number' && isFinite(value) ? value : Number(DEFAULTS.floatingIconOpacity);
    el.value = String(n);
    updateOpacityReadout(n);
    updateOpacityDemo();
  } else if (id === 'floatingIconSize') {
    // v0.8.166：radio 群（小 / 中 / 大）；勾選對應值，舊資料 / 損壞退回 'small'
    const v = (value === 'large' || value === 'medium') ? value : 'small';
    const radio = el.querySelector('input[name="floatingIconSize"][value="' + v + '"]');
    if (radio) radio.checked = true;
    updateOpacityDemo();
  } else if (id === 'readwiseSummary') {
    // 預設 false——只有明確為 true 才勾選
    el.checked = value === true;
  } else if (id === 'storageService') {
    // v1.6.0：分段 toggle radio 群；勾選對應值，舊資料 / 損壞退回 'readwise'
    const v = value === 'instapaper' ? 'instapaper' : 'readwise';
    const radio = el.querySelector('input[name="storageService"][value="' + v + '"]');
    if (radio) radio.checked = true;
  } else if (id === 'readwiseToken' || id === 'geminiApiKey') {
    el.value = value || '';
  } else {
    el.value = value;
  }
}

function load() {
  // floatingIcon 不在 DEFAULTS（三態）——以 null fallback 一併請求，
  // applyFieldToDom 收到 null 時走 resolveFloatingIconEnabled 解析（未設過預設開）。
  // v0.8.164：browser.storage.sync.get 原生 Promise（reject 即不刷新，保留 DOM 預設）。
  browser.storage.sync.get(Object.assign({ floatingIcon: null }, DEFAULTS)).then((values) => {
    fields.forEach((id) => applyFieldToDom(id, values[id]));
    // autoEnableDomains：array → textarea 多行字串（每行一個正規化過的網域）
    const helper = window.__JReadDomainMatch;
    const list = Array.isArray(values.autoEnableDomains) ? values.autoEnableDomains : [];
    document.getElementById('autoEnableDomains').value =
      helper ? helper.serializeList(list) : list.join('\n');
    // v0.7.218：自訂快速鍵——storage 讀回值消毒後渲染 recorder 顯示
    shortcutTable = SC.sanitizeTable(values.customShortcuts);
    renderShortcuts();
    updateOpacityDemo();   // 範例 icon 套初始透明度 + 尺寸
    // v1.6.0：儲存服務顯隱 + Instapaper 連結狀態（instapaperUsername 不在 fields，
    // 由 renderInstapaperLinkState 直接渲染）
    renderInstapaperLinkState(values.instapaperUsername);
    updateServiceVisibility();
  }).catch(() => {});
}

// ---- 儲存狀態提示條（v0.8.162，參考姊妹專案 Shinkansen save-bar）----------
// 固定頂端的提示條，三態：存檔中（紅）→ 已存檔（綠、3s 淡出）／儲存失敗（紅、停留）。
// 任一寫入 path（欄位 change / 快速鍵 / 自動啟動網域）寫入前呼 showSaving()、
// browser.storage.sync.set 的 callback 呼 flashSaved() 收尾。
const saveBarEl = document.getElementById('save-bar');
let saveBarHideTimer = null;
function showSaveBar(state, text) {
  if (!saveBarEl) return;
  saveBarEl.textContent = text;
  saveBarEl.className = 'save-bar ' + state;
  saveBarEl.hidden = false;
  if (saveBarHideTimer) { clearTimeout(saveBarHideTimer); saveBarHideTimer = null; }
  // 成功才自動淡出；存檔中持續顯示等 callback、失敗停久一點讓使用者看清
  if (state === 'saved') {
    saveBarHideTimer = setTimeout(() => { saveBarEl.hidden = true; }, 3000);
  } else if (state === 'error') {
    saveBarHideTimer = setTimeout(() => { saveBarEl.hidden = true; }, 4000);
  }
}
// 寫入前：先亮「存檔中」（紅）。set callback 很快 → 短暫閃過後轉「已存檔」
function showSaving() {
  showSaveBar('saving', '存檔中…');
}
// v0.8.164：set 改用 browser.storage.sync.set 原生 Promise——成功走 flashSaved、
// 失敗（quota / 寫入頻率超限，Promise reject）走 flashSaveError，不再讀 lastError。
function flashSaved() {
  showSaveBar('saved', '已存檔');
}
function flashSaveError() {
  // set 失敗不可閃「已存檔」假訊號（v0.8.35 語意維持）
  showSaveBar('error', '儲存失敗，請稍後再試');
}

// 任何欄位變更即存檔——只寫該欄（diff write，見上方 v0.8.35 註解）
fields.forEach((id) => {
  document.getElementById(id).addEventListener('change', () => {
    showSaving();
    browser.storage.sync.set({ [id]: readFieldFromDom(id) }).then(flashSaved).catch(flashSaveError);
  });
});

// 透明度滑桿拖動途中即時更新 % 讀數 + 範例 icon（change 才存檔；input 只更新顯示）
const opacityRange = document.getElementById('floatingIconOpacity');
if (opacityRange) {
  opacityRange.addEventListener('input', () => {
    updateOpacityReadout(opacityRange.value);
    updateOpacityDemo();
  });
}

// 尺寸 radio 群切換即時更新範例 icon 大小（v0.8.166；radio change 冒泡到 wrapper，
// wrapper id=floatingIconSize；存檔由 fields 通用 change listener 處理，本 listener 只更新預覽）
const sizeGroup = document.getElementById('floatingIconSize');
if (sizeGroup) {
  sizeGroup.addEventListener('change', updateOpacityDemo);
}

// ---- Readwise token 測試（v0.8.64）-----------------------------------
// 讀 input 目前值（含尚未 blur 存檔的輸入）→ 走 popup-core.validateReadwiseToken
// 打官方 auth 端點驗證。fetch 在 options 頁直接發（extension 頁有 <all_urls>
// host_permission，免 CORS）。結果雙通道呈現（色 + ✓ / ✗ 符號）。
const readwiseTestBtn = document.getElementById('readwiseTest');
const readwiseTestResultEl = document.getElementById('readwiseTestResult');

function setReadwiseTestResult(kind, text) {
  readwiseTestResultEl.textContent = text;
  readwiseTestResultEl.className = 'token-test-result is-' + kind;
}

if (readwiseTestBtn && readwiseTestResultEl) {
  readwiseTestBtn.addEventListener('click', async () => {
    const token = document.getElementById('readwiseToken').value.trim();
    if (!token) {
      setReadwiseTestResult('error', '✗ 請先貼上 token');
      return;
    }
    const PopupAPI = window.__JReadPopup;
    if (!PopupAPI || typeof PopupAPI.validateReadwiseToken !== 'function') {
      setReadwiseTestResult('error', '✗ 無法載入驗證模組');
      return;
    }
    setReadwiseTestResult('pending', '測試中…');
    readwiseTestBtn.disabled = true;
    let result;
    try {
      result = await PopupAPI.validateReadwiseToken({ token });
    } catch (_) {
      result = { ok: false, error: 'NETWORK' };
    }
    readwiseTestBtn.disabled = false;
    if (result.ok) {
      setReadwiseTestResult('ok', '✓ Token 有效');
    } else if (result.error === 'AUTH') {
      setReadwiseTestResult('error', '✗ Token 無效或已過期');
    } else if (result.error === 'NETWORK') {
      setReadwiseTestResult('error', '✗ 無法連線，請檢查網路');
    } else {
      setReadwiseTestResult('error', '✗ 測試失敗（' + (result.status || result.error || '未知') + '）');
    }
  });

  // 使用者重新編輯 token 時清掉上次測試結果（避免舊結果誤導）
  document.getElementById('readwiseToken').addEventListener('input', () => {
    setReadwiseTestResult('', '');
  });
}

// ---- Gemini API key 測試（v0.8.74）---------------------------------
// 讀 input 目前值 → 走 popup-core.validateGeminiKey 打 models list 端點（GET、
// 零 token 成本）。與 Readwise 測試同一套呈現（色 + ✓ / ✗ 雙通道）。
const geminiTestBtn = document.getElementById('geminiTest');
const geminiTestResultEl = document.getElementById('geminiTestResult');

function setGeminiTestResult(kind, text) {
  geminiTestResultEl.textContent = text;
  geminiTestResultEl.className = 'token-test-result is-' + kind;
}

if (geminiTestBtn && geminiTestResultEl) {
  geminiTestBtn.addEventListener('click', async () => {
    const apiKey = document.getElementById('geminiApiKey').value.trim();
    if (!apiKey) {
      setGeminiTestResult('error', '✗ 請先貼上 API key');
      return;
    }
    const PopupAPI = window.__JReadPopup;
    if (!PopupAPI || typeof PopupAPI.validateGeminiKey !== 'function') {
      setGeminiTestResult('error', '✗ 無法載入驗證模組');
      return;
    }
    setGeminiTestResult('pending', '測試中…');
    geminiTestBtn.disabled = true;
    let result;
    try {
      result = await PopupAPI.validateGeminiKey({ apiKey });
    } catch (_) {
      result = { ok: false, error: 'NETWORK' };
    }
    geminiTestBtn.disabled = false;
    if (result.ok) {
      setGeminiTestResult('ok', '✓ API key 有效');
    } else if (result.error === 'AUTH') {
      setGeminiTestResult('error', '✗ API key 無效');
    } else if (result.error === 'NETWORK') {
      setGeminiTestResult('error', '✗ 無法連線，請檢查網路');
    } else {
      setGeminiTestResult('error', '✗ 測試失敗（' + (result.status || result.error || '未知') + '）');
    }
  });

  // 使用者重新編輯 key 時清掉上次測試結果
  document.getElementById('geminiApiKey').addEventListener('input', () => {
    setGeminiTestResult('', '');
  });
}

// ---- 儲存服務二擇一：顯隱 + Instapaper 連結（v1.6.0）----------------------
// storageService select 決定顯示哪個服務的憑證區（摘要 / Gemini key 兩服務共用、
// 永遠顯示）。Instapaper 走 xAuth（email + 密碼換 OAuth token），密碼用完即丟；
// 已連結顯示帳號 + 解除連結。__JReadInstapaper 由 lib/instapaper.js 掛（keys 缺檔
// 時 hasInstapaperConsumerKeys() 回 false → 顯示「未內建金鑰」）。
const IP = window.__JReadInstapaper;

function updateServiceVisibility() {
  const sel = document.getElementById('storageService');
  const checked = sel && sel.querySelector('input[name="storageService"]:checked');
  const svc = checked && checked.value === 'instapaper' ? 'instapaper' : 'readwise';
  const blocks = document.querySelectorAll('[data-service-block]');
  for (const el of blocks) el.hidden = el.getAttribute('data-service-block') !== svc;
}

// 依「有無 username」切換 Instapaper 未連結（填帳密）/ 已連結（顯示帳號）兩態。
// 無內建金鑰時兩態都收、只露「未內建金鑰」提示。
function renderInstapaperLinkState(username) {
  const form = document.getElementById('instapaper-link-form');
  const linked = document.getElementById('instapaper-linked');
  const noKeys = document.getElementById('instapaper-no-keys');
  const linkedUser = document.getElementById('instapaper-linked-user');
  const hasKeys = !!(IP && typeof IP.hasInstapaperConsumerKeys === 'function' && IP.hasInstapaperConsumerKeys());
  if (noKeys) noKeys.hidden = hasKeys;
  const isLinked = !!(username && String(username).trim());
  if (form) form.hidden = !hasKeys || isLinked;
  if (linked) linked.hidden = !isLinked;
  if (isLinked && linkedUser) linkedUser.value = String(username);
}

// storageService 切換：存檔由通用 change listener 處理，本 listener 只更新顯隱
const serviceSel = document.getElementById('storageService');
if (serviceSel) serviceSel.addEventListener('change', updateServiceVisibility);

// 連結：email + 密碼 → instapaperXAuth → 存 token/secret/username、密碼清空
const ipConnectBtn = document.getElementById('instapaper-connect');
const ipConnectResultEl = document.getElementById('instapaper-connect-result');
function setIpConnectResult(kind, text) {
  if (!ipConnectResultEl) return;
  ipConnectResultEl.textContent = text;
  ipConnectResultEl.className = 'token-test-result is-' + kind;
}
if (ipConnectBtn) {
  ipConnectBtn.addEventListener('click', async () => {
    const email = (document.getElementById('instapaper-email').value || '').trim();
    const password = document.getElementById('instapaper-password').value || '';
    if (!email || !password) { setIpConnectResult('error', '✗ 請輸入帳號與密碼'); return; }
    if (!IP || typeof IP.instapaperXAuth !== 'function') { setIpConnectResult('error', '✗ 無法載入 Instapaper 模組'); return; }
    setIpConnectResult('pending', '連結中…');
    ipConnectBtn.disabled = true;
    let r;
    try { r = await IP.instapaperXAuth({ email, password }); }
    catch (_) { r = { ok: false, error: 'NETWORK' }; }
    ipConnectBtn.disabled = false;
    if (r && r.ok) {
      showSaving();
      browser.storage.sync.set({
        instapaperToken: r.token,
        instapaperTokenSecret: r.tokenSecret,
        instapaperUsername: email
      }).then(flashSaved).catch(flashSaveError);
      document.getElementById('instapaper-password').value = '';  // 密碼用完即丟
      setIpConnectResult('', '');
      renderInstapaperLinkState(email);
    } else if (r && r.error === 'AUTH') {
      setIpConnectResult('error', '✗ 帳號或密碼錯誤');
    } else if (r && r.error === 'CONFIG') {
      setIpConnectResult('error', '✗ 此版本未內建 Instapaper 金鑰');
    } else if (r && r.error === 'NETWORK') {
      setIpConnectResult('error', '✗ 無法連線，請檢查網路');
    } else {
      setIpConnectResult('error', '✗ 連結失敗（' + ((r && (r.status || r.error)) || '未知') + '）');
    }
  });
}

// 解除連結：清 token/secret/username，回未連結態
const ipUnlinkBtn = document.getElementById('instapaper-unlink');
if (ipUnlinkBtn) {
  ipUnlinkBtn.addEventListener('click', () => {
    showSaving();
    browser.storage.sync.set({ instapaperToken: '', instapaperTokenSecret: '', instapaperUsername: '' })
      .then(flashSaved).catch(flashSaveError);
    renderInstapaperLinkState('');
  });
}

// autoEnableDomains 走獨立路徑：textarea 多行字串 → parseList → 寫回 sync。
// 用 'change'（blur 觸發）而非 'input'，避免使用者打字途中每按一鍵就 set
// 觸發 browser.storage.sync 寫入配額 + 跨 tab broadcast。
document.getElementById('autoEnableDomains').addEventListener('change', (e) => {
  const helper = window.__JReadDomainMatch;
  const raw = e.target.value;
  const list = helper ? helper.parseList(raw) : raw.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
  showSaving();
  browser.storage.sync.set({ autoEnableDomains: list }).then(() => {
    // 把正規化結果寫回 textarea（含 lowercase / 去 scheme / 去 path / 去重），
    // 讓使用者立刻看到實際生效的清單
    if (helper) e.target.value = helper.serializeList(list);
    flashSaved();
  }).catch(flashSaveError);
});

// 其他 context（popup / 另一個 options 分頁）寫入時，options 開著要跟著刷新。
// v0.8.35：從只同步 autoEnableDomains 擴成全欄位 + customShortcuts——這是
// diff-write 修法的另一半（DOM 永遠反映 storage 最新值，殘留 stale 值的面消失）
if (browser.storage && browser.storage.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const id of fields) {
      if (id in changes) applyFieldToDom(id, changes[id].newValue);
    }
    if ('customShortcuts' in changes && !recordingCmd) {
      shortcutTable = SC.sanitizeTable(changes.customShortcuts.newValue);
      renderShortcuts();
    }
    if ('autoEnableDomains' in changes) {
      const helper = window.__JReadDomainMatch;
      const next = changes.autoEnableDomains.newValue;
      const list = Array.isArray(next) ? next : [];
      const ta = document.getElementById('autoEnableDomains');
      if (ta !== document.activeElement) {
        ta.value = helper ? helper.serializeList(list) : list.join('\n');
      }
    }
    // v1.6.0：跨 context 切服務 / 連結變更 → 同步顯隱與 Instapaper 連結狀態
    if ('storageService' in changes) updateServiceVisibility();
    if ('instapaperUsername' in changes) renderInstapaperLinkState(changes.instapaperUsername.newValue);
  });
}

// ---- 回復預設設定（v0.8.157）-----------------------------------------
// 把所有設定複寫回 settings-defaults.js 的預設值，但保留兩個 API key
//（readwiseToken / geminiApiKey——使用者貼過的憑證，重 reset 不該被洗掉）。
// floatingIcon 三態回復為「未設過」（null → resolveFloatingIconEnabled 走預設開）、
// floatingIconPos 拖移位置一併清掉。danger 雙態：第一次點進入確認狀態，
// 4s 未再點自動還原，避免誤觸。
const resetBtn = document.getElementById('resetDefaults');
const resetStatusEl = document.getElementById('reset-status');
let resetConfirming = false;
let resetConfirmTimer = null;

function exitResetConfirm() {
  resetConfirming = false;
  if (resetConfirmTimer) { clearTimeout(resetConfirmTimer); resetConfirmTimer = null; }
  if (resetBtn) {
    resetBtn.classList.remove('confirming');
    resetBtn.textContent = '回復預設';
  }
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (!resetConfirming) {
      // 第一次點：進入確認狀態
      resetConfirming = true;
      resetBtn.classList.add('confirming');
      resetBtn.textContent = '再按一次確認';
      resetConfirmTimer = setTimeout(exitResetConfirm, 4000);
      return;
    }
    // 第二次點：執行回復
    exitResetConfirm();
    const payload = Object.assign({}, DEFAULTS);
    delete payload.readwiseToken; // 保留使用者憑證
    delete payload.geminiApiKey;  // 保留使用者憑證
    delete payload.instapaperToken;       // 保留 Instapaper 連結
    delete payload.instapaperTokenSecret; // 保留 Instapaper 連結
    delete payload.instapaperUsername;    // 保留 Instapaper 連結
    payload.floatingIcon = null;  // 回復三態（未設過 → 預設開）
    payload.floatingIconPos = null; // 清掉拖移位置
    // v0.8.164：browser.storage.sync.set 原生 Promise——reject（失敗）走錯誤訊息。
    browser.storage.sync.set(payload).then(() => {
      load(); // 重讀 storage 刷新整個表單顯示
      resetStatusEl.textContent = '已回復預設設定';
      setTimeout(() => { resetStatusEl.textContent = ''; }, 2000);
    }).catch(() => {
      resetStatusEl.textContent = '回復失敗，請稍後再試';
      setTimeout(() => { resetStatusEl.textContent = ''; }, 3000);
    });
  });
}

// ---- 本機快取除錯（v1.0.13）-----------------------------------------
// storage.local 只存 readingPositions（閱讀位置記憶，見 content/position-memory.js）。
// 位置記憶忽然失效時，這裡顯示用量 / 筆數方便判斷是否 storage 滿了，並提供一鍵
// 清除。清 local 不動任何偏好——所有偏好都在 storage.sync。danger 雙態同
// resetDefaults：第一次點進入確認、4s 未再點自動還原、第二次點才真正清除。
const storageInfoEl = document.getElementById('storage-info');
const clearCacheBtn = document.getElementById('clearLocalCache');
const clearCacheStatusEl = document.getElementById('clear-cache-status');
let clearCacheConfirming = false;
let clearCacheConfirmTimer = null;

function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

// 讀本機快取現況顯示。storage.local 不存在（既有 spec stub 只給 sync）→ 直接
// 返回，不可讓載入期 throw 波及其他 options 測試。getBytesInUse 在 Safari / iOS
// 可能不支援 → 退回用 readingPositions 的 JSON byte 長度估算。
function refreshStorageInfo() {
  if (!storageInfoEl) return;
  let local;
  try { local = browser.storage && browser.storage.local; } catch (_) { local = null; }
  if (!local || typeof local.get !== 'function') { storageInfoEl.textContent = ''; return; }
  storageInfoEl.textContent = '計算中…';
  local.get({ readingPositions: {}, readingPositionsDiag: null, readingPositionsRestoreDiag: null }).then((v) => {
    const map = (v && v.readingPositions) || {};
    const diag = v && v.readingPositionsDiag;
    const count = Object.keys(map).length;
    let bytes = NaN;
    try { bytes = new TextEncoder().encode(JSON.stringify(map)).length; } catch (_) {}
    const line = '閱讀位置記憶：' + count + ' 筆，約 ' + formatBytes(bytes);
    // 寫入失敗診斷（position-memory recordWriteError 寫入）——有就附在後面
    const diagSuffix = (diag && diag.error) ? '　⚠ 上次寫入失敗：' + diag.error : '';
    // v1.5.10 診斷：上次還原當下的事實（釘 H2b/H2c，確認後移除）
    const rd = v && v.readingPositionsRestoreDiag;
    let restoreSuffix = '';
    if (rd) {
      if (rd.stage === 'read-null') restoreSuffix = '　⚑ 上次還原：讀取 storage 失敗';
      else if (!rd.found) restoreSuffix = '　⚑ 上次還原：found=否（磁碟 ' + count + ' 筆內無此篇記錄）';
      else restoreSuffix = '　⚑ 上次還原：found=是 page=' + rd.page + ' pages=' + rd.pages +
        ' 當下total=' + (rd.total == null ? '?' : rd.total) + ' →resolved=' + (rd.resolved == null ? '?' : rd.resolved) +
        (rd.fresh === false ? '（過期）' : '');
    }
    let probe = null;
    try { probe = local.getBytesInUse ? local.getBytesInUse(null) : null; } catch (_) { probe = null; }
    if (probe && typeof probe.then === 'function') {
      probe.then((b) => {
        storageInfoEl.textContent = (Number.isFinite(b) ? line + '　|　本機快取總用量 ' + formatBytes(b) : line) + diagSuffix + restoreSuffix;
      }).catch(() => { storageInfoEl.textContent = line + diagSuffix + restoreSuffix; });
    } else {
      storageInfoEl.textContent = line + diagSuffix + restoreSuffix;
    }
  }).catch(() => { storageInfoEl.textContent = '無法讀取本機快取'; });
}

function exitClearCacheConfirm() {
  clearCacheConfirming = false;
  if (clearCacheConfirmTimer) { clearTimeout(clearCacheConfirmTimer); clearCacheConfirmTimer = null; }
  if (clearCacheBtn) { clearCacheBtn.classList.remove('confirming'); clearCacheBtn.textContent = '清除快取'; }
}

if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', () => {
    if (!clearCacheConfirming) {
      clearCacheConfirming = true;
      clearCacheBtn.classList.add('confirming');
      clearCacheBtn.textContent = '再按一次確認';
      clearCacheConfirmTimer = setTimeout(exitClearCacheConfirm, 4000);
      return;
    }
    exitClearCacheConfirm();
    browser.storage.local.clear().then(() => {
      if (clearCacheStatusEl) {
        clearCacheStatusEl.textContent = '已清除本機快取';
        setTimeout(() => { clearCacheStatusEl.textContent = ''; }, 2000);
      }
      refreshStorageInfo();
    }).catch(() => {
      if (clearCacheStatusEl) {
        clearCacheStatusEl.textContent = '清除失敗，請稍後再試';
        setTimeout(() => { clearCacheStatusEl.textContent = ''; }, 3000);
      }
    });
  });
}

refreshStorageInfo();

load();
