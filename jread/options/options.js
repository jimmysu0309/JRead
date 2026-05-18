// JRead — Options
// 使用者可調欄位：theme / fontSize / contentWidth（對齊 SPEC.md）。

const DEFAULTS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  readwiseToken: '',
  // v0.7.131：reader mode 攔截原站快速鍵（Gmail j/k/e、YouTube k 等誤觸救援）
  blockPageShortcuts: true
};

const fields = ['theme', 'fontSize', 'contentWidth', 'readwiseToken', 'blockPageShortcuts'];

document.getElementById('version').textContent = chrome.runtime.getManifest().version;

function load() {
  chrome.storage.sync.get(DEFAULTS, (values) => {
    document.getElementById('theme').value = values.theme;
    document.getElementById('fontSize').value = values.fontSize;
    document.getElementById('contentWidth').value = values.contentWidth;
    document.getElementById('readwiseToken').value = values.readwiseToken || '';
    document.getElementById('blockPageShortcuts').checked = values.blockPageShortcuts !== false;
  });
}

function save() {
  const patch = {
    theme: document.getElementById('theme').value,
    fontSize: Number(document.getElementById('fontSize').value),
    contentWidth: Number(document.getElementById('contentWidth').value),
    readwiseToken: document.getElementById('readwiseToken').value.trim(),
    blockPageShortcuts: document.getElementById('blockPageShortcuts').checked
  };
  chrome.storage.sync.set(patch, () => {
    const s = document.getElementById('save-status');
    s.textContent = '已儲存';
    setTimeout(() => { s.textContent = ''; }, 1500);
  });
}

// 任何欄位變更即存檔
fields.forEach((id) => {
  document.getElementById(id).addEventListener('change', save);
});

load();
