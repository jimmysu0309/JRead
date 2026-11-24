// JRead — 設定頁分頁切換（v3.0.1）
//
// Jimmy 2026-11-24：單頁設定太長、日後還要繼續加，分成 閱讀 / 操作 / 稍後閱讀 /
// 進階 / 關於 五個分頁。只負責顯示切換：所有欄位仍在同一份 DOM，options.js 的
// 讀寫、儲存提示條、Instapaper 連結流程完全不受影響（隱藏的分頁欄位照樣載入）。
//
// - 網址 hash 記住目前分頁（options.html#services），重新整理停在同一頁，
//   日後別的入口也能直接開到指定分頁；hash 不認得就回第一頁
// - 鍵盤：分頁列上 ← → Home End 切換（WAI-ARIA tabs 慣例，roving tabindex）
// - 某分頁內容在這個平台上全被隱藏（每個子元素都有 hidden）→ 整個分頁按鈕一起藏
//
// 必須在 options.js 之後載入：options.js 頂層會依平台把 App 圖示等區塊設 hidden，
// 空分頁判斷要看到那個結果。
(function () {
  'use strict';

  const bar = document.querySelector('.tab-bar');
  if (!bar) return;
  const tabs = Array.from(bar.querySelectorAll('[role="tab"][data-tab]'));
  const panelOf = (id) => document.querySelector(`[data-tab-panel="${id}"]`);

  // 空分頁：沒有任何未隱藏的子元素
  for (const tab of tabs) {
    const panel = panelOf(tab.dataset.tab);
    const visible = panel && Array.from(panel.children).some((el) => !el.hidden);
    if (!visible) tab.hidden = true;
  }
  const usable = () => tabs.filter((t) => !t.hidden);

  function select(id, { focus = false, writeHash = false } = {}) {
    const list = usable();
    const target = list.find((t) => t.dataset.tab === id) || list[0];
    if (!target) return;
    for (const tab of tabs) {
      const on = tab === target;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      const panel = panelOf(tab.dataset.tab);
      if (panel) panel.hidden = !on;
    }
    if (focus) target.focus();
    if (writeHash && location.hash !== '#' + target.dataset.tab) {
      // replaceState：切分頁不塞瀏覽紀錄，上一頁不會在分頁間來回跳
      history.replaceState(null, '', '#' + target.dataset.tab);
    }
    // 捲到下面才切分頁時，把新分頁的開頭帶回分頁列底下
    const panel = panelOf(target.dataset.tab);
    if (panel) {
      const barBottom = bar.getBoundingClientRect().bottom;
      if (panel.getBoundingClientRect().top < barBottom) {
        window.scrollTo(0, 0);
      }
    }
  }

  bar.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"][data-tab]');
    if (tab) select(tab.dataset.tab, { writeHash: true });
  });

  bar.addEventListener('keydown', (e) => {
    const list = usable();
    const cur = list.indexOf(document.activeElement);
    if (cur < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (cur + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (cur - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(list[next].dataset.tab, { focus: true, writeHash: true });
  });

  window.addEventListener('hashchange', () => select(location.hash.slice(1)));

  select(location.hash.slice(1));
})();
