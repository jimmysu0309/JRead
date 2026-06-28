// JRead — 主畫面快速啟動跳板轉址（v1.5.12）
//
// 問題：iOS「加入主畫面」沒辦法直接釘擴充自有頁。擴充頁 origin
// `safari-web-extension://<UUID>/` 的 UUID 每次 Safari 重啟就換一組（見
// spaRouteKey 揮發 origin 修法 / project_ios_extension_origin_uuid_rotates），
// web-clip 釘死當下那組 UUID，重啟後即指向死 URL。file:// 擴充不跑、手機沒常駐
// server、原生 app 也拿不到當下 UUID——只有 http(s) 穩定頁能當入口。
//
// 解法：把穩定 https 跳板頁（docs/open.html，例
// https://jimmysu0309.github.io/JRead/open.html?jread-open=feed）加入主畫面。
// 本 content script 跑在該頁時讀 marker，當場用 browser.runtime.getURL 解析
// 「當前」UUID 的擴充頁並導入——getURL 是 runtime 即時解析，永遠拿到當下這組
// UUID，所以重啟換 UUID 也對得到。唯一能做這件事的是 content script（跑在擴充
// runtime、知道當下 UUID），頁面自身 script 與原生 app 都拿不到。
//
// 排在 namespace.js 之後、其餘 content script 之前：要盡早轉址、減少跳板頁閃現
// （namespace.js 必須是第一個檔——它建 window.__JRead + 正典 browser shim）。
// 仍自帶 browser shim 當防禦：萬一日後被重排到 namespace.js 前也不會炸。

globalThis.browser = globalThis.browser ?? globalThis.chrome;

(function () {
  'use strict';

  // marker 是 URL query（結構性訊號，非 hostname / class 特判，符合硬規則 3）——
  // 任何 host 上帶此 query 都會轉址，跳板頁換網域不用改 code。
  var target;
  try {
    target = new URLSearchParams(location.search).get('jread-open');
  } catch (_e) { return; }
  if (!target) return;

  // extension context 必須有效，否則 getURL 拿不到正確 base。
  try {
    if (!(browser && browser.runtime && browser.runtime.id && browser.runtime.getURL)) return;
    if (!browser.runtime.getURL('')) return;
  } catch (_e) { return; }

  var dest = null;
  if (target === 'feed') {
    dest = browser.runtime.getURL('reader/reader.html');
  } else if (target === 'article') {
    // 預留：article=<docId> 直開 Article View；無 id 退回 feed。
    var id = null;
    try { id = new URLSearchParams(location.search).get('id'); } catch (_e2) {}
    dest = id
      ? browser.runtime.getURL('reader/article.html?id=' + encodeURIComponent(id))
      : browser.runtime.getURL('reader/reader.html');
  } else {
    return; // 未知 target 不動作
  }
  if (!dest) return;

  // location.replace：跳板頁不留在歷史，回上一頁不會卡回跳板再彈回 feed。
  try { location.replace(dest); }
  catch (_e) { try { location.href = dest; } catch (_e2) {} }
})();
