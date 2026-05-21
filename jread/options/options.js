// JRead — Options
// 使用者可調欄位：theme / fontSize / contentWidth（對齊 SPEC.md）。

const DEFAULTS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  // 字粗外觀（細 = antialiased / 粗 = subpixel-antialiased）;預設細
  boldText: false,
  readwiseToken: '',
  // v0.7.131：reader mode 攔截原站快速鍵（Gmail j/k/e、YouTube k 等誤觸救援）
  blockPageShortcuts: true,
  // 中英文字之間自動補空白（盤古之白）；預設 true
  pangu: true,
  // v0.7.155：自動啟動閱讀模式的網域清單（字串陣列）。matching rule：
  // hostname === pattern OR hostname endsWith '.' + pattern。
  // 'abc.com' 涵蓋 www.abc.com / foo.abc.com；'www.abc.com' 只含 www.abc.com。
  autoEnableDomains: []
};

const fields = ['theme', 'fontSize', 'contentWidth', 'boldText', 'readwiseToken', 'blockPageShortcuts', 'pangu'];

document.getElementById('version').textContent = chrome.runtime.getManifest().version;

function load() {
  chrome.storage.sync.get(DEFAULTS, (values) => {
    document.getElementById('theme').value = values.theme;
    document.getElementById('fontSize').value = values.fontSize;
    document.getElementById('contentWidth').value = values.contentWidth;
    document.getElementById('boldText').checked = values.boldText === true;
    document.getElementById('readwiseToken').value = values.readwiseToken || '';
    document.getElementById('blockPageShortcuts').checked = values.blockPageShortcuts !== false;
    document.getElementById('pangu').checked = values.pangu !== false;
    // autoEnableDomains：array → textarea 多行字串（每行一個正規化過的網域）
    const helper = window.__JReadDomainMatch;
    const list = Array.isArray(values.autoEnableDomains) ? values.autoEnableDomains : [];
    document.getElementById('autoEnableDomains').value =
      helper ? helper.serializeList(list) : list.join('\n');
  });
}

function flashSaved() {
  const s = document.getElementById('save-status');
  s.textContent = '已儲存';
  setTimeout(() => { s.textContent = ''; }, 1500);
}

function save() {
  const patch = {
    theme: document.getElementById('theme').value,
    fontSize: Number(document.getElementById('fontSize').value),
    contentWidth: Number(document.getElementById('contentWidth').value),
    boldText: document.getElementById('boldText').checked,
    readwiseToken: document.getElementById('readwiseToken').value.trim(),
    blockPageShortcuts: document.getElementById('blockPageShortcuts').checked,
    pangu: document.getElementById('pangu').checked
  };
  chrome.storage.sync.set(patch, flashSaved);
}

// 任何欄位變更即存檔
fields.forEach((id) => {
  document.getElementById(id).addEventListener('change', save);
});

// autoEnableDomains 走獨立路徑：textarea 多行字串 → parseList → 寫回 sync。
// 用 'change'（blur 觸發）而非 'input'，避免使用者打字途中每按一鍵就 set
// 觸發 chrome.storage.sync 寫入配額 + 跨 tab broadcast。
document.getElementById('autoEnableDomains').addEventListener('change', (e) => {
  const helper = window.__JReadDomainMatch;
  const raw = e.target.value;
  const list = helper ? helper.parseList(raw) : raw.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
  chrome.storage.sync.set({ autoEnableDomains: list }, () => {
    // 把正規化結果寫回 textarea（含 lowercase / 去 scheme / 去 path / 去重），
    // 讓使用者立刻看到實際生效的清單
    if (helper) e.target.value = helper.serializeList(list);
    flashSaved();
  });
});

// popup 端 toggle 會即時更新 sync.autoEnableDomains；options 開著時跟著刷新
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !('autoEnableDomains' in changes)) return;
    const helper = window.__JReadDomainMatch;
    const next = changes.autoEnableDomains.newValue;
    const list = Array.isArray(next) ? next : [];
    document.getElementById('autoEnableDomains').value =
      helper ? helper.serializeList(list) : list.join('\n');
  });
}

load();
