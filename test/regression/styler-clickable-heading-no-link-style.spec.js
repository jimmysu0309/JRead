// JRead — clickable 標題維持原本標題樣式（v0.8.129）
//
// 對應需求（Jimmy 2026-06-19）：大標題若是 clickable（permalink 自連結等），
// 進閱讀模式後要維持原本標題顯示樣式，而不是被當成內文連結染色 + 加底線。
//
// 根因：styler body-link 規則
//   [data-jread-active="1"] a:not([player="1"]) { color: theme.link; text-decoration: underline }
// 對所有 <a> 生效。標題常是兩種結構：
//   1. <h1><a href=permalink>標題</a></h1>（連結在 heading 內）
//   2. <a href><h1>標題</h1></a>（heading 被連結包住）
// 兩者都會讓整個大標題變藍底線連結、看起來不像標題。
//
// 修法（結構通則，不綁站點 / class）：heading（h1-h6）內含或包住的 <a> 一律
// 回退成 color: inherit + text-decoration: none，維持原站標題視覺。
//
// 本 spec 驗注入的 stylesheet 含中和規則，並驗一般內文連結仍保留 link 樣式。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-title-sibling.html');

function buildCss(titleFontSize) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  const articleEl = env.window.document.querySelector('.article-text-con');
  assert.ok(articleEl);
  env.window.__JRead.styler.apply(articleEl, {
    theme: 'light', fontSize: 18, contentWidth: 720,
    fontFamily: 'system-ui', lineHeight: 1.7,
    titleFontSize: titleFontSize || 0
  });
  return env.window.document.getElementById('__jread-style').textContent;
}

describe('styler — clickable 標題維持標題樣式（v0.8.129）', () => {
  it('注入 CSS 含「heading 內 <a>」中和規則（color: inherit + text-decoration: none）', () => {
    const css = buildCss();
    // heading 後代連結 selector：:is(h1,h2,h3,h4,h5,h6) a
    assert.ok(/:is\(h1,h2,h3,h4,h5,h6\)\s+a:not/.test(css),
      'CSS 必須含 :is(h1..h6) a 後代連結 selector');
    // 中和區塊內必須同時有 color: inherit 與 text-decoration: none
    const block = css.match(/:is\(h1,h2,h3,h4,h5,h6\)\s+a:not\([^)]*\)[^{]*\{[^}]*\}/);
    assert.ok(block, '找不到 heading-link 中和區塊');
    assert.ok(/color:\s*inherit\s*!important/.test(block[0]),
      'heading-link 中和區塊必須 color: inherit');
    assert.ok(/text-decoration:\s*none\s*!important/.test(block[0]),
      'heading-link 中和區塊必須 text-decoration: none（移除底線）');
  });

  it('注入 CSS 含「<a> 包住 heading」中和規則（heading-link marker，v1.6.30）', () => {
    // v1.6.30（#13 insertion invalidation）：原 a:has(:is(h1..h6)) 的「 *」後代
    // 變體是整頁 recalc 放大器，訊號載體改 apply() 期 markHeadingLinks 標
    // data-jread-heading-link（標記行為 forcing 在 insertion-invalidation.spec）。
    const css = buildCss();
    assert.ok(/a\[data-jread-heading-link="1"\]:not\([^)]*\)/.test(css),
      'CSS 必須含 a[data-jread-heading-link="1"] selector（heading 被連結包住的結構）');
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/a:not\([^)]*\):has\(:is\(h1/.test(stripped),
      '舊 a:has(:is(h1..h6)) selector 不得回歸（#13 放大器）');
  });

  it('一般內文連結仍保留 link 樣式（body-link 規則未被破壞）', () => {
    const css = buildCss();
    // body-link 規則：[data-jread-active="1"] a:not([player]) { color: link; underline }
    const bodyLink = css.match(/\[data-jread-active="1"\]\s+a:not\([^)]*\)\s*\{[^}]*\}/);
    assert.ok(bodyLink, '找不到 body-link 規則');
    assert.ok(/text-decoration:\s*underline/.test(bodyLink[0]),
      'body-link 規則仍須保留 underline（一般內文連結不受影響）');
  });
});
