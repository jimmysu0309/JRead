// JRead — 主文末「整塊就是一個多行連結」的招攬 banner（v0.8.118 eet-china）
//
// Bug（Jimmy 回報 + cage 揪出）：eet-china.com 文章用 Gemini flash lite 翻譯後，
// 文末穩定冒出「【6场直播，玩转瑞萨RA MCU开发实战】一键报名六场…」促銷區塊。
//
// 結構（cage probe 揭穿）：該促銷整塊就是 .article-text-con.article_text 內
// 接在結論段後的**單一** <a>（href 指 mbb.eet-china.com/member.php 會員頁），
// 內含 <strong> 標題 + 4×<br> 的 CTA 文字共 173 chars。
//
// 為什麼漏網：
//   · 173 > NOISE_LINK_TEXT_MAX_LEN(60) → link-text 規則 skip
//   · 「一键报名」無「立即/点击」前綴 → NOISE_LINK_TEXT_STRICT_RE 不命中
//   · 單一 anchor（內含 0 nested anchor）→ link-only block（需 >= 2）/ direct-child
//     link block（需 >= 5）都打不到
//   · class 全無語意（裸 <a>）→ keyword 規則 skip
//   純文字規則本可碰運氣命中 CTA 字樣，但翻譯後文字改變即失準（Jimmy「未翻譯
//   前沒有」）。
//
// 修法（hideInsideArticleBannerLinks，結構通則、翻譯無關）：一個 <a> 同時為
//   1) block-level standalone（不在 p/li/heading/figcaption/blockquote/表格/dl 內）
//   2) 自身含 <br>（多行 banner 排版，prose 連結不會）
//   3) 不含 content <img>（排除 figure/hero 圖片連結）
//   → 整個 anchor 視為塞進主文的招攬 banner，hide。
//
// 通則安全：prose 連結都嵌在段落 <p> 裡且不含 <br>；圖片連結有 <img> 豁免。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-tail-banner-link.html');

function isHidden(el) {
  return !!(el && el.closest && el.closest('[data-jread-hidden="1"]'));
}

describe('cleaner — 主文末單一多行 <a> 招攬 banner（v0.8.118 eet-china）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('.article-text-con.article_text');
    assert.ok(articleEl, 'fixture 必須有 .article-text-con.article_text');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('fixture 結構：banner 是單一 <a>（內含 <strong>+<br>、173 chars、0 nested anchor）', () => {
    const banner = [...articleEl.querySelectorAll('a')]
      .find(a => /玩转瑞萨RA MCU开发实战/.test(a.textContent || ''));
    assert.ok(banner, 'fixture 必須有瑞萨促銷 banner <a>');
    assert.ok(banner.querySelector('br'), 'banner 內必須有 <br>（多行排版）');
    assert.ok(banner.querySelector('strong'), 'banner 內必須有 <strong> 標題');
    assert.strictEqual(banner.querySelectorAll('a').length, 0, 'banner 是單一 anchor、無 nested anchor');
    const len = (banner.textContent || '').replace(/\s+/g, ' ').trim().length;
    assert.ok(len > 60, `banner 文字長度 ${len} 必須 > 60（證明逃過 link-text MAX_LEN）`);
  });

  it('招攬 banner <a> 必須被 hide', () => {
    const banner = [...articleEl.querySelectorAll('a')]
      .find(a => /玩转瑞萨RA MCU开发实战/.test(a.textContent || ''));
    assert.ok(isHidden(banner), '瑞萨促銷 banner <a> 必須被 cleaner hide');
  });

  it('主文段落與標題必須保留（不誤殺主文）', () => {
    const h1 = articleEl.querySelector('h1');
    assert.ok(h1 && !isHidden(h1), 'h1 標題必須保留');
    let longP = 0;
    for (const p of articleEl.querySelectorAll(':scope > p')) {
      const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 60) {
        assert.ok(!isHidden(p), `主文段落不可被誤殺：「${t.slice(0, 20)}…」`);
        longP++;
      }
    }
    assert.ok(longP >= 4, `主文長段落須保留 >= 4（實際 ${longP}）`);
  });

  it('prose 內嵌連結（段落裡的單行 <a>，無 <br>）不可被誤殺', () => {
    const inline = articleEl.querySelector('a.inline-prose-link');
    assert.ok(inline, 'fixture 必須有段落內行內連結');
    assert.ok(!isHidden(inline),
      'prose 段落內的行內連結不可被 banner 規則 hide（它在 <p> 內、無 <br>）');
  });
});
