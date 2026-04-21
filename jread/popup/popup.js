// JRead — Popup
// 顯示版本號（動態讀 manifest）、切換閱讀模式、顯示偵測結果。

const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');
const openOptionsLink = document.getElementById('open-options');

// 版本號一律從 manifest 動態讀取，不寫死
versionEl.textContent = chrome.runtime.getManifest().version;

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

toggleBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = '無法取得當前分頁';
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_READER_MODE' });
    if (res && res.active) {
      statusEl.textContent = '閱讀模式：開';
    } else {
      statusEl.textContent = '閱讀模式：關';
    }
  } catch (err) {
    statusEl.textContent = '此頁面無法啟動閱讀模式';
  }
});

// 接收 content 回報的偵測結果
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

// 初始狀態顯示
statusEl.textContent = '按下按鈕以切換閱讀模式';
