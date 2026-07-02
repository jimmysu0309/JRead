// JRead — 退出閱讀模式捲回閱讀段落 regression（v1.0.21）
//
// 對應功能：捲動模式下退出閱讀模式時，把原網頁捲到「剛剛讀到的段落」，而不是
// 停在文章開頭附近（雜訊還原後版面變高、原 scrollTop 對到的內容偏移）。
//
// main.js 包在 IIFE 且依賴 browser.runtime API（無法直接 require），採三層策略：
//   (1) 純邏輯：computeExitScrollTop（position-memory.js module.exports）——
//       錨點 viewport 相對位置 → 還原後絕對 scrollTop 的換算，直接 require 測。
//   (2) Source-level forcing：grep main.js 確認 stash settings、退出前抓 anchor、
//       還原後 scrollTo 的關鍵接線都存在（任一被誤刪 → 退化）。
//   (3) Behavior-level 重現：複製 capture→restore→scroll 序，jsdom 模擬
//       getBoundingClientRect + scrollTo，驗最終捲動目標正確。
//
// 不驗（geometry 真值靠 Playwright harness）：真實 Chrome 下 currentAnchor 選到
// 哪一段、styler/cleaner.restore 後版面真實高度——jsdom getBoundingClientRect
// 恆回 0、量不到。本 spec 驗「換算數學 + 接線存在 + 序正確」，視覺真值走
// `/harness-verify`。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'content', 'main.js'), 'utf8');
const DEFAULTS = require(path.join(ROOT, 'content', 'settings-defaults.js'));
const posMem = require(path.join(ROOT, 'content', 'position-memory.js'));

// ── (1) 純邏輯：computeExitScrollTop ──────────────────────────────────────
describe('position-memory.computeExitScrollTop — 退出捲動目標換算', () => {
  it('錨點在 viewport 中段：目標 = scrollTop + rectTop − innerHeight × margin', () => {
    // scrollTop=1000, rectTop=300, innerHeight=800, margin=0.12 → 1000+300-96 = 1204
    assert.strictEqual(posMem.computeExitScrollTop(1000, 300, 800, 0.12), 1204);
  });

  it('預設 margin（不傳）= 0.12', () => {
    assert.strictEqual(posMem.computeExitScrollTop(1000, 300, 800), 1204);
  });

  it('上方留呼吸空間：margin 越大目標越小（段落不頂死最上緣）', () => {
    const small = posMem.computeExitScrollTop(1000, 300, 800, 0.05);
    const big = posMem.computeExitScrollTop(1000, 300, 800, 0.30);
    assert.ok(big < small, 'margin 越大 → 錨點段落離 viewport 頂越遠 → scrollTop 越小');
  });

  it('換算為負（接近頁頂）一律 clamp 到 0', () => {
    assert.strictEqual(posMem.computeExitScrollTop(0, -50, 800, 0.12), 0);
  });

  it('rectTop 為負（錨點已捲過 viewport 頂）仍正確回推絕對位置', () => {
    // 使用者讀到的段落頂端在 viewport 之上 100px：絕對位置 = 5000-100-96 = 4804
    assert.strictEqual(posMem.computeExitScrollTop(5000, -100, 800, 0.12), 4804);
  });
});

// ── 預設值 ────────────────────────────────────────────────────────────────
describe('settings-defaults — syncScrollOnExit 預設開', () => {
  it('DEFAULT_SETTINGS.syncScrollOnExit === true', () => {
    assert.strictEqual(DEFAULTS.syncScrollOnExit, true,
      'forcing：預設值被改掉 / 漏掉 → 退出同步功能靜默失效');
  });
});

// ── (2) Source-level forcing：main.js 接線 ────────────────────────────────
// 抓 exitReaderModeImpl 函式 body（call-site 順序驗證用）。
function exitBody() {
  const start = MAIN_SRC.search(/function\s+exitReaderModeImpl\s*\(/);
  assert.ok(start >= 0, '能找到 exitReaderModeImpl');
  // 下一個 top-level function 定義為 body 上限（buildCleanHtml 緊接其後）
  const rest = MAIN_SRC.slice(start + 1);
  const end = rest.search(/\n  function\s+\w/);
  return rest.slice(0, end >= 0 ? end : rest.length);
}

describe('main.js — 退出捲動同步接線存在', () => {
  it('finalizeEnter 必須 stash settings.syncScrollOnExit 到 NS.state', () => {
    assert.match(MAIN_SRC, /NS\.state\.syncScrollOnExit\s*=\s*!\(\s*settings/,
      'forcing：進場沒 stash → 退出讀不到設定 → 功能失效');
  });

  it('captureExitScrollAnchor：捲動模式走 currentAnchor、翻頁模式走 pagedMode.captureExitAnchor（v1.6.8）', () => {
    const start = MAIN_SRC.search(/function\s+captureExitScrollAnchor\s*\(/);
    assert.ok(start >= 0, 'forcing：captureExitScrollAnchor 函式必須存在');
    const region = MAIN_SRC.slice(start, start + 900);
    assert.match(region, /NS\.state\.syncScrollOnExit/,
      'forcing：設定關閉時不得抓錨點');
    assert.match(region, /NS\.pagedMode\.isInstalled\(\)/,
      'forcing：必須判斷翻頁模式（currentAnchor 在 multicol 下回報文章開頭不準）');
    assert.match(region, /NS\.pagedMode\.captureExitAnchor/,
      'forcing：翻頁模式必須走 fragment coverage 對映（v1.6.8），不得回退 null/currentAnchor');
    assert.match(region, /NS\.spaceScroll\.currentAnchor\(\s*NS\.state\.articleEl/,
      'forcing：捲動模式必須以 articleEl 抓目前閱讀段落（與閱讀位置記憶同一份事實）');
  });

  it('applyExitScrollAnchor 必須檢查 isConnected + 用 computeExitScrollTop + scrollTo', () => {
    const start = MAIN_SRC.search(/function\s+applyExitScrollAnchor\s*\(/);
    assert.ok(start >= 0, 'forcing：applyExitScrollAnchor 函式必須存在');
    const region = MAIN_SRC.slice(start, start + 600);
    assert.match(region, /\.isConnected/,
      'forcing：節點可能在還原中被移除，套用前須驗仍在 DOM');
    assert.match(region, /computeExitScrollTop\(/,
      'forcing：必須用 position-memory 單一資料源換算（與閱讀位置記憶共用 math）');
    assert.match(region, /scroller\.scrollTo\(/,
      'forcing：必須實際捲動原網頁');
  });

  it('exitAnchorRectTop：text node anchor 必須以 Range rect 量、不得退 parentElement（v1.6.8）', () => {
    const start = MAIN_SRC.search(/function\s+exitAnchorRectTop\s*\(/);
    assert.ok(start >= 0,
      'forcing：exitAnchorRectTop 必須存在——翻頁 anchor 是 text node，' +
      'element rect 對巨型單一容器站（整篇文章一個元素）會捲回文首（probe 實證假綠燈）');
    const region = MAIN_SRC.slice(start, start + 600);
    assert.match(region, /nodeType\s*===\s*3/,
      'forcing：必須分流 text node');
    assert.match(region, /createRange\(\)/,
      'forcing：text node 必須用 Range 量 line box rect');
    // applyExitScrollAnchor 必須實際採用這個量法
    const applyStart = MAIN_SRC.search(/function\s+applyExitScrollAnchor\s*\(/);
    assert.match(MAIN_SRC.slice(applyStart, applyStart + 600), /exitAnchorRectTop\(/,
      'forcing：applyExitScrollAnchor 必須經 exitAnchorRectTop 取 top');
  });

  it('退出流程：capture 必須在 styler.restore 之前呼叫（還原前版面才有閱讀段落）', () => {
    const body = exitBody();
    const captureIdx = body.search(/captureExitScrollAnchor\(\)/);
    const restoreIdx = body.search(/NS\.styler\.restore/);
    assert.ok(captureIdx >= 0, 'forcing：退出必須呼叫 captureExitScrollAnchor');
    assert.ok(restoreIdx >= 0 && captureIdx < restoreIdx,
      'forcing：capture 必須排在 styler.restore 之前（還原後 reader 段落結構已拆）');
  });

  it('退出流程：apply 必須在 cleaner.restore 之後呼叫（量還原後版面）', () => {
    const body = exitBody();
    const cleanerIdx = body.search(/NS\.cleaner\.restore/);
    const applyIdx = body.search(/applyExitScrollAnchor\(/);
    assert.ok(applyIdx >= 0, 'forcing：退出必須呼叫 applyExitScrollAnchor');
    assert.ok(cleanerIdx >= 0 && applyIdx > cleanerIdx,
      'forcing：捲動必須在還原雜訊之後——還原前 rect 是 reader 版面、會捲錯位置');
  });
});

// ── (3) Behavior-level 重現：capture → restore → scroll 序 ────────────────
describe('退出捲動同步 behavior-level（jsdom 模擬 rect + scrollTo）', () => {
  let dom, document, window;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
    window = dom.window;
  });

  // 複製 main.js 退出捲動同步的核心序：抓 anchor → restore（版面變化）→ 算目標 → scrollTo
  // v1.6.8：paged 不再是排除路徑——改走 pagedMode.captureExitAnchor（stub 以
  // pagedAnchor 餵入，模擬 fragment coverage 對映的回傳節點或 null）。
  function runExitSync({ syncOn, paged, anchorEl, pagedAnchor, scrollTopAfter, rectTopAfter, innerHeight }) {
    const NS = {
      state: { syncScrollOnExit: syncOn, articleEl: document.body },
      pagedMode: paged
        ? { isInstalled: () => true, captureExitAnchor: () => pagedAnchor || null }
        : { isInstalled: () => false },
      spaceScroll: { currentAnchor: () => (anchorEl ? { el: anchorEl, index: 0 } : null) },
      positionMemory: posMem
    };
    // capture（還原前）——同 main.js captureExitScrollAnchor 的分流
    let captured = null;
    if (NS.state.syncScrollOnExit && NS.state.articleEl) {
      if (NS.pagedMode && NS.pagedMode.isInstalled()) {
        captured = typeof NS.pagedMode.captureExitAnchor === 'function'
          ? NS.pagedMode.captureExitAnchor() : null;
      } else if (NS.spaceScroll && typeof NS.spaceScroll.currentAnchor === 'function') {
        const a = NS.spaceScroll.currentAnchor(NS.state.articleEl);
        if (a && a.el) captured = a.el;
      }
    }
    // restore 後的 scroller 狀態（模擬還原雜訊後版面）
    const scroller = {
      scrollTop: scrollTopAfter,
      scrolledTo: null,
      scrollTo(x, y) { this.scrolledTo = y; }
    };
    if (captured && captured.isConnected) {
      const rectTop = rectTopAfter; // 模擬 getBoundingClientRect().top
      const top = NS.positionMemory.computeExitScrollTop(scroller.scrollTop, rectTop, innerHeight);
      scroller.scrollTo(0, top);
    }
    return scroller.scrolledTo;
  }

  it('捲動模式 + 開啟：捲到 computeExitScrollTop 算出的目標', () => {
    const el = document.createElement('p');
    document.body.appendChild(el);
    const target = runExitSync({
      syncOn: true, paged: false, anchorEl: el,
      scrollTopAfter: 2000, rectTopAfter: 400, innerHeight: 800
    });
    assert.strictEqual(target, 2000 + 400 - 96, '= 2304');
  });

  it('設定關閉：不捲動（scrollTo 不被呼叫）', () => {
    const el = document.createElement('p');
    document.body.appendChild(el);
    const target = runExitSync({
      syncOn: false, paged: false, anchorEl: el,
      scrollTopAfter: 2000, rectTopAfter: 400, innerHeight: 800
    });
    assert.strictEqual(target, null, '關閉時保持還原預設行為、不主動捲動');
  });

  it('翻頁模式 + captureExitAnchor 回節點：捲到換算目標（v1.6.8）', () => {
    const p = document.createElement('p');
    p.textContent = '第 k 頁的段落';
    document.body.appendChild(p);
    const textNode = p.firstChild; // 翻頁 anchor 是 text node
    const target = runExitSync({
      syncOn: true, paged: true, pagedAnchor: textNode,
      scrollTopAfter: 2000, rectTopAfter: 400, innerHeight: 800
    });
    assert.strictEqual(target, 2000 + 400 - 96, '翻頁退出也捲回閱讀位置 = 2304');
  });

  it('翻頁模式 + captureExitAnchor 回 null（jsdom 等量不到環境）：不捲動', () => {
    const target = runExitSync({
      syncOn: true, paged: true, pagedAnchor: null,
      scrollTopAfter: 2000, rectTopAfter: 400, innerHeight: 800
    });
    assert.strictEqual(target, null,
      '量不到時維持原行為（pagedMode.uninstall 還原進場前位置）');
  });

  it('翻頁模式 + 設定關閉：不抓 anchor、不捲動', () => {
    const p = document.createElement('p');
    p.textContent = 'x';
    document.body.appendChild(p);
    const target = runExitSync({
      syncOn: false, paged: true, pagedAnchor: p.firstChild,
      scrollTopAfter: 2000, rectTopAfter: 400, innerHeight: 800
    });
    assert.strictEqual(target, null, 'syncScrollOnExit 關閉時翻頁路徑也不捲動');
  });

  it('currentAnchor 回 null（找不到段落）：不捲動', () => {
    const target = runExitSync({
      syncOn: true, paged: false, anchorEl: null,
      scrollTopAfter: 2000, rectTopAfter: 400, innerHeight: 800
    });
    assert.strictEqual(target, null);
  });

  it('錨點節點已從 DOM 移除（isConnected=false）：不捲動', () => {
    const el = document.createElement('p'); // 未 append → isConnected false
    const target = runExitSync({
      syncOn: true, paged: false, anchorEl: el,
      scrollTopAfter: 2000, rectTopAfter: 400, innerHeight: 800
    });
    assert.strictEqual(target, null, '節點不在 DOM 時不捲動（避免捲到 0/錯位）');
  });
});
