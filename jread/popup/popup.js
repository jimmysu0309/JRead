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

// MV3 的 content_scripts 只會自動注入「新載入的分頁」，
// extension 安裝/更新前就打開的既有分頁不會自動注入。
// 因此 sendMessage 丟錯時先嘗試主動注入再重試一次。
// 這是通用限制的結構性解法，不綁站點。
const CONTENT_SCRIPT_FILES = [
  'content/namespace.js',
  'content/detector.js',
  'content/cleaner.js',
  'content/styler.js',
  'content/main.js'
];

async function injectContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });
}

async function sendToggle(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_READER_MODE' });
}

function renderToggleResult(res) {
  if (res && res.active) {
    statusEl.textContent = '閱讀模式：開';
  } else {
    statusEl.textContent = '閱讀模式：關';
  }
}

toggleBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = '無法取得當前分頁';
    return;
  }
  try {
    const res = await sendToggle(tabId);
    renderToggleResult(res);
  } catch (err) {
    // 最常見是 "Could not establish connection. Receiving end does not exist."
    // 代表 content script 尚未注入這個分頁。主動注入後重試一次。
    try {
      await injectContentScripts(tabId);
      const res = await sendToggle(tabId);
      renderToggleResult(res);
    } catch (err2) {
      // 注入或 retry 仍失敗：多半是 chrome:// / 應用商店 / PDF 檢視器這類禁止注入的頁面
      statusEl.textContent = '此頁面無法啟動閱讀模式';
    }
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
