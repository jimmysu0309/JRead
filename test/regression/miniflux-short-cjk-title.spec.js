// JRead — Miniflux 短中文標題被最小長度門檻誤殺 regression（v0.8.141）
//
// 對應 bug：Miniflux「儲存空間」entry 進入閱讀模式後主文標題整個消失
// （Jimmy 2026-06-20 回報 /unread/category/2/entry/2030）。
//
// 根因：detector 選 article.entry-content 為 articleEl，主標題 h1（純 4 字
// 「儲存空間」）在外層 header.entry-header、被 cleaner 當 chrome hide。
// promoteUniqueTitleH1Into 本應把 h1 clone 進 reader card，但開頭的
// `h1Text.length < 5` / `baseTitle.length < 5` 門檻（按拉丁文字校準、用來過濾
// "Home" / "News" 類 site-logo 垃圾 h1）把 4 字中文標題誤殺 → 不 promote。
//
// 修法：門檻改用 titleTextWeight（CJK 字權重 2、其餘 1，門檻維持 5）。拉丁
// 行為不變（"Title" 5 字仍過、"News" 4 字仍被擋）；CJK 標題只需 ≥3 字即過，
// 「儲存空間」(4 字 = weight 8) 過關。
//
// 本 spec 是 forcing function：
//   - title clone 必須存在且含「儲存空間」
//   - 原 h1 仍被 hide（避免重複），但內容已被 promote 進 card

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'miniflux-short-cjk-title.html');

describe('cleaner — Miniflux 短中文標題（4 字「儲存空間」）仍被 promote 進 reader card（v0.8.141）', () => {
  let document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article.entry-content');
    hidden = [];
    env.window.__JRead.cleaner.clean(articleEl, hidden);
  });

  it('title clone 必須存在（4 字中文標題仍被 promote）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone, '4 字中文標題「儲存空間」應仍被 promote 進 reader card，不可被最小長度門檻誤殺');
    assert.ok(clone.textContent.includes('儲存空間'),
      `title clone 應含主標題「儲存空間」，實際: "${clone.textContent.trim().slice(0, 40)}"`);
  });

  it('title clone 不可帶入 entry-actions / byline chrome', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    const txt = clone ? clone.textContent : '';
    for (const label of ['標記為未讀', '昨天', 'Take', 'take.surf']) {
      assert.ok(!txt.includes(label),
        `title clone 不應含 chrome 文字「${label}」，實際: "${txt.replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
    }
  });

  it('主文段落完整保留', () => {
    let visible = 0;
    for (const p of articleEl.querySelectorAll(':scope > p')) {
      if (p.getAttribute('data-jread-hidden') !== '1') visible++;
    }
    assert.ok(visible >= 4, `entry-content 內應有 >= 4 個 visible <p>，實際 ${visible}`);
  });
});
