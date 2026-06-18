// JRead — regression spec: 文中「本期雜誌」推廣區清除 (v0.8.113)
// -----------------------------------------------------------------------------
// The Atlantic 文章（meritocracy-college-admissions...）中段插入
// section.ArticleMagazinePromo_root：封面圖被 styler 撐成整頁大 + H2
// 「Explore the December 2024 Issue」+「View More」連到該期 TOC。
//
// 修法：NOISE_HEADING_TEXT_EXT_RE 加 ^explore\s+the\b.*\bissue$。heading
// 31 chars 走 EXT max_len（40），closest('section') 命中整個推廣 section
// 後一併 hide（封面圖 + heading + View More 連結都隨之消失）。
// 結構性通則——pattern 描述 CTA 句式而非綁站點 class（fixture class 全為
// 中性 emotion-hash、不含 NOISE_KEYWORD token，forcing function 單驗 heading
// 文字規則）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'explore-issue-magazine-promo.html');

describe('cleaner — 文中「本期雜誌」推廣區清除（v0.8.113）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.getElementById('post');
    articleEl.setAttribute('data-jread-active', '1');
    env.NS.cleaner.clean(articleEl, []);
  });

  function isHidden(el) {
    return !!(el && el.closest('[data-jread-hidden="1"]'));
  }

  it('「Explore the December 2024 Issue」推廣 section 整段必須被 hide', () => {
    const sec = document.querySelector('section.x7q_root__kenOr');
    assert.ok(sec, 'fixture 應有推廣 section');
    assert.ok(isHidden(sec),
      'EXT regex ^explore\\s+the\\b.*\\bissue$ 必須命中 heading，closest(section) 整段清除');
  });

  it('被撐大的封面圖必須隨 section 一併消失', () => {
    const img = document.querySelector('img.x7q_img__aAbsW');
    assert.ok(img, 'fixture 應有封面圖');
    assert.ok(isHidden(img), '封面圖在被 hide 的推廣 section 內');
  });

  it('「View More」CTA 連結必須隨 section 一併消失', () => {
    const a = document.querySelector('a.x7q_link__uOKjl');
    assert.ok(a, 'fixture 應有 View More 連結');
    assert.ok(isHidden(a), 'View More 在被 hide 的推廣 section 內');
  });

  it('主文長段落必須完整保留', () => {
    let visible = 0;
    for (const p of articleEl.querySelectorAll('p')) {
      if (p.closest('section.x7q_root__kenOr')) continue;
      if (p.textContent.replace(/\s+/g, '').length >= 50 && !isHidden(p)) visible++;
    }
    assert.ok(visible >= 3, `主文長段落必須保留（visible=${visible}，預期 >= 3）`);
  });
});
