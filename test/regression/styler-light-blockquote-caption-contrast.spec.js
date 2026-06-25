// JRead — light theme blockquote / summary 深底深字守門（v1.0.6）
// -----------------------------------------------------------------------------
// Bug（Page Rounds 2026-06-25 autocar.co.uk）：
//   hero 圖下的圖說被站點做成 <blockquote class="image-field-caption">、bg
//   rgb(48,48,48)（深色不透明）。light theme reader card 內變成一條黑條、圖說
//   文字看不見。contrast audit 命中 1.59:1（cage 量）。
//
// 根因（兩條 styler 決策在 light theme 互相矛盾）：
//   - BG_PRESERVE_NOT 排除 blockquote/summary → 保留站點背景（原意：引言框靠
//     padding + 底色撐視覺區隔，styler.js 行 1917 註解）
//   - COLOR_PRESERVE_NOT 不排除 blockquote/summary → 文字被 color: inherit 強制
//     成 reader 卡片深色（light theme）
//   站點若給 blockquote 設深色不透明底，保留深底 + 強制深字 = 深字 on 深底黑條。
//   與 figcaption v0.8.169 同款矛盾，只是換成 blockquote（見
//   styler-light-figcaption-bg-normalize.spec.js）。
//
// 為什麼用 contrast gate 而非比照 figcaption 無條件清背景：blockquote 引言框
// 可能有「淺底 + 深字」的合理設計，無條件清會弄丟正常引言框底色。修法以實際
// 對比 gate：只有「強制文字色對保留 effective bg < 3:1（占比 >= 40%）」才把背景
// 正規化為透明。runtime inline !important，restore 走 contrastBgSnap。
//
// 訊號層次：jsdom 驗 inline style 副作用（觸發 / 不觸發 / 還原 / dark 跳過）。
// jsdom 不解析 color: inherit cascade——fixture 用 inline color 模擬「注入後
// 強制文字色」；真實 Chrome cascade 由 page-rounds harness CONTRAST AUDIT 驗。
//
// 5 條 forcing function：
//   (a) light：深底深字 blockquote → 背景正規化 transparent + !important
//   (b) light：淺底深字（正常引言框）→ 不動（保守邊界）
//   (c) restore：inline bg 還回 fixture 原值、不殘留 !important
//   (d) dark：light pass 整段跳過（不加 runtime inline bg；dark blockquote bg
//       由 v0.7.154 靜態 CSS rule 接管，見 styler-dark-blockquote-bg.spec.js）
//   (e) light：summary 同條通則（同樣 bg 保留 + 文字強制的語意元素）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'autocar-blockquote-caption-contrast.html');

function setup(themeName) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler']
  });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 必須有 <article>');
  const settings = {
    theme: themeName,
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  };
  const snapshot = env.NS.styler.apply(articleEl, settings);
  return { env, articleEl, snapshot };
}

describe('styler — light theme blockquote/summary 深底深字守門 (v1.0.6)', () => {

  it('(a) light theme：深底深字 blockquote 背景正規化為透明', () => {
    const { env } = setup('light');
    const bq = env.document.querySelector('[data-test="dark-caption-bq"]');
    assert.strictEqual(bq.style.getPropertyValue('background-color'), 'transparent',
      'caption-as-blockquote（深底 rgb(48,48,48) + 強制深字 1.59:1）必須把背景設成 transparent，讓白卡透出、深字變可讀');
    assert.strictEqual(bq.style.getPropertyPriority('background-color'), 'important',
      'inline bg transparent 必須帶 !important（防站點 stylesheet 反覆寫）');
  });

  it('(b) light theme：淺底深字（正常引言框）不動', () => {
    const { env } = setup('light');
    const bq = env.document.querySelector('[data-test="light-quote-bq"]');
    // 淺底（rgb(245,245,245)）+ 深字對比本來就高（~18:1），contrast gate 不可
    // 觸發——fixture 原有的 inline bg 必須原封不動（不被改成 transparent、不加
    // !important），保留正常引言框底色（保守邊界）。
    assert.strictEqual(bq.style.getPropertyValue('background-color'), 'rgb(245, 245, 245)',
      'gate 不觸發時必須保留站點原本的淺底（不可改成 transparent）');
    assert.strictEqual(bq.style.getPropertyPriority('background-color'), '',
      'gate 不觸發時不可在正常引言框上加 !important');
  });

  it('(c) restore：blockquote inline bg 還回原值、不殘留 !important', () => {
    const { env, articleEl, snapshot } = setup('light');
    env.NS.styler.restore(articleEl, snapshot);
    const bq = env.document.querySelector('[data-test="dark-caption-bq"]');
    // fixture 原本 inline bg = rgb(48, 48, 48)，restore 必須還回
    assert.strictEqual(bq.style.getPropertyValue('background-color'), 'rgb(48, 48, 48)',
      'restore 必須把 blockquote inline bg 還回 fixture 原有的 rgb(48, 48, 48)');
    assert.strictEqual(bq.style.getPropertyPriority('background-color'), '',
      'restore 後不可殘留 !important priority');
  });

  it('(d) dark theme：light pass 整段跳過（不加 runtime inline bg）', () => {
    const { env } = setup('dark');
    const bq = env.document.querySelector('[data-test="dark-caption-bq"]');
    // dark theme 下 blockquote bg 由 v0.7.154 靜態 CSS rule 清成 transparent，
    // 本 runtime light pass（gated !theme.text）不該執行、不留 inline bg。
    assert.strictEqual(bq.style.getPropertyValue('background-color'), 'rgb(48, 48, 48)',
      'dark theme 下 light runtime pass 不執行，blockquote inline bg 維持 fixture 原值（dark bg 由靜態 CSS rule 接管，非 runtime inline）');
  });

  it('(e) light theme：summary 同條通則（深底深字也修）', () => {
    const { env, articleEl } = setup('light');
    // 動態加一個深底深字 summary 再重跑 apply，驗 selector 含 summary
    const summary = env.document.createElement('summary');
    summary.setAttribute('data-test', 'dark-summary');
    summary.setAttribute('style', 'background-color: rgb(40, 40, 40); color: rgb(0, 0, 0);');
    summary.textContent = 'A disclosure summary the site styles with a dark opaque background bar';
    articleEl.appendChild(summary);
    env.NS.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7
    });
    assert.strictEqual(summary.style.getPropertyValue('background-color'), 'transparent',
      'summary 與 blockquote 同為「bg 保留 + 文字強制」語意元素，深底深字必須同條 gate 修');
    assert.strictEqual(summary.style.getPropertyPriority('background-color'), 'important');
  });
});
