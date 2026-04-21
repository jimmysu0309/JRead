// JRead — Popup entry
// 綁 DOM 事件、呼叫 chrome API、委派核心邏輯給 popup-core.js。

const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');
const openOptionsLink = document.getElementById('open-options');

versionEl.textContent = chrome.runtime.getManifest().version;

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function renderToggleResult(res) {
  statusEl.textContent = (res && res.active) ? '閱讀模式：開' : '閱讀模式：關';
}

toggleBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = '無法取得當前分頁';
    return;
  }

  const { toggleWithInjectionFallback } = window.__JReadPopup;
  const result = await toggleWithInjectionFallback(tabId, {
    sendMessage: (id, msg) => chrome.tabs.sendMessage(id, msg),
    executeScript: (opts) => chrome.scripting.executeScript(opts)
  });

  if (result.ok) {
    renderToggleResult(result.res);
  } else {
    // chrome:// / 應用商店 / PDF 檢視器等禁止注入的頁面會走到這裡
    statusEl.textContent = '此頁面無法啟動閱讀模式';
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'REPORT_DETECTION_RESULT') return;
  const p = msg.payload || {};
  if (p.ok) {
    statusEl.textContent = `偵測成功（信心 ${(p.confidence || 0).toFixed(2)}，策略 ${p.strategy || '-'}）`;
  } else {
    statusEl.textContent = `偵測失敗：${p.reason || '未知原因'}`;
  }
});

openOptionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

statusEl.textContent = '按下按鈕以切換閱讀模式';
