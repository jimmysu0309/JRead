// JRead — C9：collapse 讀寫分離 + 動態 hide 補掛 inline-restyle observer（v0.8.20）
//
// 對應 code review C9（兩部分）：
//   (1) collapseGridWithHiddenCell 迴圈內交錯「讀 computed/rect → 立刻 applyImportant
//       寫 style」——後續 candidate 的 getBoundingClientRect 讀到被前一個 candidate
//       mutate 過的 layout（forced reflow + read-after-write 污染）。改 phase1 純讀 +
//       決策、phase2 純寫。
//   (2) watchHiddenInlineRestyle 只在 clean() 末段 snapshot 當時的 hidden 清單掛
//       observer；checkDynamicNoise 之後動態 hide 的 SPA 雜訊不在 WeakSet、沒被
//       observe → 原站 JS 重設 style 清掉 !important 時無人補回（硬教訓十保護對動態
//       雜訊失效）。修法：hide() 在 observer active 時即時補掛（registerHiddenForRestyle）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

describe('cleaner C9 — collapse 讀寫分離（結構 forcing）', () => {
  it('collapseGridWithHiddenCell 必須 phase1 純讀 / phase2 純寫（writes worklist）', () => {
    const m = CLEANER_SRC.match(/function\s+collapseGridWithHiddenCell[\s\S]*?\n  \}/);
    assert.ok(m, '必須能抓到 collapseGridWithHiddenCell body');
    const body = m[0];
    assert.ok(/const\s+writes\s*=\s*\[\]/.test(body), '必須有 writes worklist');
    assert.ok(/writes\.push\(\s*\{\s*el,\s*decls:\s*containerDecls/.test(body),
      'container 寫入必須收進 writes（不在讀迴圈內直接 applyImportant）');
    assert.ok(/writes\.push\(\s*\{\s*el:\s*c,\s*decls:\s*CHILD_DECLS\s*\}\)/.test(body),
      'child 寫入必須收進 writes');
    // phase2：for (const w of writes) applyImportant(w.el, w.decls)
    assert.ok(/for\s*\(const\s+w\s+of\s+writes\)[\s\S]{0,160}applyImportant\(w\.el,\s*w\.decls\)/.test(body),
      '必須有 phase2 純寫 loop（for w of writes → applyImportant）');
    // 讀迴圈內不得直接對 container/child applyImportant（只能 push writes）
    assert.ok(!/applyImportant\(el,\s*containerDecls\)/.test(body),
      '讀迴圈內不得直接 applyImportant(el, containerDecls)（read-after-write 污染源）');
    assert.ok(!/applyImportant\(c,\s*CHILD_DECLS\)/.test(body),
      '讀迴圈內不得直接 applyImportant(c, CHILD_DECLS)');
  });
});

describe('cleaner C9 — 動態 hide 補掛 inline-restyle observer', () => {
  it('hide() 必須呼叫 registerHiddenForRestyle；registerHiddenForRestyle 必須 observe', () => {
    const hideFn = CLEANER_SRC.match(/function\s+hide\s*\(el,\s*hidden\)[\s\S]*?\n  \}/);
    assert.ok(hideFn && /registerHiddenForRestyle\(el\)/.test(hideFn[0]),
      'hide() 必須呼叫 registerHiddenForRestyle(el)');
    const regFn = CLEANER_SRC.match(/function\s+registerHiddenForRestyle[\s\S]*?\n  \}/);
    assert.ok(regFn, '必須宣告 registerHiddenForRestyle');
    assert.ok(/styleRestoreObserver\.observe\(/.test(regFn[0]),
      'registerHiddenForRestyle 必須 styleRestoreObserver.observe 新元素');
  });

  it('行為：clean 後動態注入的雜訊被 hide 且其 inline 被原站清掉後會補回 !important', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><main>
      <article id="art"><h1>標題</h1>
      <p>這是一段夠長的主文內容，包含逗號、句號，足夠通過字數門檻與保護判定。</p>
      <p>第二段主文內容，繼續描述，維持足夠長度避免被當空容器。</p>
      </article></main></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
    window.eval(SRC.namespace);
    window.eval(SRC.cleaner);
    const doc = window.document;
    const art = doc.getElementById('art');
    const NS = window.__JRead;

    const hidden = NS.cleaner.clean(art);
    assert.ok(Array.isArray(hidden), 'clean 必須回傳 hidden 陣列');

    // 動態注入雜訊（class 命中 NOISE_KEYWORD_RE：related-news）
    const noise = doc.createElement('div');
    noise.className = 'related-news';
    noise.innerHTML = '<p>推薦文章清單</p>';
    art.appendChild(noise);

    // 等 dynamic-append MutationObserver callback 跑（checkDynamicNoise → hide）
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(noise.dataset.jreadHidden, '1', '動態注入的雜訊應被 hide');
    assert.strictEqual(noise.style.getPropertyPriority('display'), 'important',
      'hide 後 display 應是 none !important');

    // 模擬原站 JS 重設 style 清掉 !important（display:block 無 priority）
    noise.style.setProperty('display', 'block');
    assert.strictEqual(noise.style.getPropertyPriority('display'), '', '前置：原站已清掉 !important');

    // 等 inline-restyle observer callback 補回
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(noise.style.display, 'none',
      'inline-restyle observer 必須把動態雜訊的 display 補回 none');
    assert.strictEqual(noise.style.getPropertyPriority('display'), 'important',
      'inline-restyle observer 必須補回 !important priority（硬教訓十對動態雜訊也生效）');

    NS.cleaner.restore(hidden);
  });
});
