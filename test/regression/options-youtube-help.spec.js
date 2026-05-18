// JRead — options 頁 YouTube 模式說明 regression (v0.7.134)
//
// 動機：v0.7.133 / v0.7.134 連續加進影院模式 + 無邊模式兩個 YouTube watch page
// 沉浸功能後，options 頁加說明區塊讓使用者知道兩者差別 + 無邊模式如何自綁
// 快速鍵。本 spec 是 forcing function——將來若有人改 options.html 不小心把
// 區塊砍掉、或 strip 掉關鍵字（ESC / chrome://extensions/shortcuts）會立刻 fail。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const OPTIONS_HTML = fs.readFileSync(path.join(ROOT, 'jread', 'options', 'options.html'), 'utf8');

describe('options-youtube-help v0.7.134 — 區塊結構', () => {
  it('options.html 必須有「YouTube 模式」.section-heading', () => {
    assert.match(OPTIONS_HTML,
      /<h2[^>]*class="section-heading"[^>]*>\s*YouTube 模式\s*<\/h2>/,
      'options.html 缺「YouTube 模式」.section-heading——使用者打開 options 看不到 onboarding 入口');
  });

  it('options.html 必須有「影院模式」.subsection-heading', () => {
    assert.match(OPTIONS_HTML,
      /<h3[^>]*class="subsection-heading"[^>]*>\s*影院模式\s*<\/h3>/,
      'options.html 缺「影院模式」.subsection-heading——v0.7.133 功能說明遺失');
  });

  it('options.html 必須有「無邊模式」.subsection-heading', () => {
    assert.match(OPTIONS_HTML,
      /<h3[^>]*class="subsection-heading"[^>]*>\s*無邊模式\s*<\/h3>/,
      'options.html 缺「無邊模式」.subsection-heading——v0.7.134 功能說明遺失');
  });
});

describe('options-youtube-help v0.7.134 — 關鍵內容', () => {
  // 共通操作（ESC 退出、無邊模式自綁快速鍵的位置）放在 YouTube 模式 intro 段
  // ——即 .section-heading「YouTube 模式」與下一個 .subsection-heading
  // 「影院模式」之間的 <p>——而非分散到影院模式 / 無邊模式各自段落（Jimmy
  // 2026-05-18 反饋：操作說明集中、子段只描述視覺效果）。

  function getYouTubeModeIntro() {
    return OPTIONS_HTML.match(
      /<h2[^>]*>\s*YouTube 模式\s*<\/h2>\s*<p[^>]*>[\s\S]*?<\/p>/
    );
  }

  it('YouTube 模式 intro 段必須提到 ESC（共通退出方式）', () => {
    const m = getYouTubeModeIntro();
    assert.ok(m, '抓不到 YouTube 模式 intro 段（<h2> + <p>）');
    assert.match(m[0], /ESC/,
      'YouTube 模式 intro 段必須提到 ESC——共通退出操作說明應集中在大標下，而非分散到影院模式 / 無邊模式各自段落');
  });

  it('YouTube 模式 intro 段必須提到 chrome://extensions/shortcuts（無邊模式自綁快速鍵的位置）', () => {
    const m = getYouTubeModeIntro();
    assert.ok(m, '抓不到 YouTube 模式 intro 段');
    assert.match(m[0], /chrome:\/\/extensions\/shortcuts/,
      'YouTube 模式 intro 段必須提到 chrome://extensions/shortcuts——無邊模式無預設快速鍵，使用者要在哪自綁是核心 onboarding 資訊');
  });
});

describe('options-youtube-help v0.7.134 — CSS rule', () => {
  it('.subsection-heading CSS rule 必須存在（避免 h3 fallback 撐版面）', () => {
    assert.match(OPTIONS_HTML,
      /\.subsection-heading\s*\{/,
      'options.html 缺 .subsection-heading CSS rule——h3 會用瀏覽器 default 巨大字級撐破版面');
  });
});
