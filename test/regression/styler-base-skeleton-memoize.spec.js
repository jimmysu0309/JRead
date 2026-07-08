// JRead — styler base 骨架 memoize（v0.8.18 C6）
//
// 對應 code review C6：buildCss 的 ~800 行 base 骨架不含使用者變數（fontSize /
// lineHeight / fontFamily / fontWeight / titleFontSize / paragraphSpacing /
// pagedMode），只依賴 theme + contentWidth，卻每次 apply() 重組。改成以
// (theme, contentWidth) memoize、只算一次。
//
// 本 spec 的關鍵 forcing 是 anti-stale：memoize key 只有 (theme, contentWidth)，
// 所以 base 區段**絕不能**引用其他使用者變數——否則改 fontSize 等會回傳 stale
// base（cache 沒被那些變數 bust）。spec 直接掃 base template literal 區段，確認
// 無 opts.<使用者變數> 引用；那些必須住在 base 之外的 userOverrides。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const STYLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8'
);

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

describe('styler — base 骨架 memoize（C6）', () => {
  it('結構：memoize cache + accessor + buildCss 使用 baseSkeletonCacheGet', () => {
    assert.match(STYLER_SRC, /_baseSkeletonCache\s*=\s*new\s+WeakMap\(\)/, '必須有 _baseSkeletonCache WeakMap');
    assert.match(STYLER_SRC, /function\s+baseSkeletonCacheGet\s*\(/, '必須有 baseSkeletonCacheGet');
    assert.match(STYLER_SRC, /function\s+baseSkeletonCacheSet\s*\(/, '必須有 baseSkeletonCacheSet');
    // v1.6.24：readerHostPage 納入 cache key——base 內卡片上緣 padding 依它分流
    //（v1.5.3），key 沒帶會拿到 stale padding
    assert.match(STYLER_SRC, /base\s*=\s*baseSkeletonCacheGet\(theme,\s*contentWidth,\s*opts\.readerHostPage\)/, 'buildCss 必須以 (theme, contentWidth, readerHostPage) 查 cache');
    assert.match(STYLER_SRC, /baseSkeletonCacheSet\(theme,\s*contentWidth,\s*opts\.readerHostPage,\s*base\)/, 'cache miss 後必須以同一組 key 寫回 cache');
  });

  it('anti-stale：base template literal 區段不得引用 theme/contentWidth 以外的使用者變數', () => {
    // 抓 base 區段：`base = \`` 到對應的 baseSkeletonCacheSet 之前的 closing backtick
    const startMarker = 'base = `';
    const start = STYLER_SRC.indexOf(startMarker);
    assert.ok(start >= 0, '找不到 base template literal 起點');
    const setIdx = STYLER_SRC.indexOf('baseSkeletonCacheSet(theme, contentWidth, opts.readerHostPage, base);', start);
    assert.ok(setIdx > start, '找不到 base 區段結尾');
    const baseRegion = STYLER_SRC.slice(start, setIdx);

    // base 只允許 theme.* / contentWidth / readerHostPage（皆為 cache key 成員）
    // 三種動態插值；其餘使用者變數禁止出現
    const forbidden = ['opts.fontSize', 'opts.lineHeight', 'opts.fontFamily', 'opts.fontWeight', 'opts.titleFontSize', 'opts.paragraphSpacing', 'opts.pagedMode'];
    for (const tok of forbidden) {
      assert.ok(!baseRegion.includes(tok),
        `base 區段不得引用 ${tok}——memoize key 只有 (theme, contentWidth, readerHostPage)，引用它會回 stale base`);
    }
  });

  function injectedCss(settings) {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'detector 必須命中 fixture');
    env.NS.styler.apply(detected.el, settings);
    const styleEl = env.document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    return styleEl.textContent;
  }

  const DEF = { theme: 'light', fontSize: 0, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0, titleFontSize: 0, fontWeight: 400, pagedMode: false };

  it('行為：同 theme/width 改 fontSize 仍正確（base 命中 cache、輸出只差 userOverrides）', () => {
    const a = injectedCss({ ...DEF });
    const b = injectedCss({ ...DEF, fontSize: 24 });
    // base 段相同（progress bar / 卡片骨架），但 fontSize=24 多注入 font-size override
    assert.ok(a.includes('[data-jread-hidden="1"]'), 'base 骨架必須在輸出內');
    assert.ok(b.includes('[data-jread-hidden="1"]'), 'base 骨架必須在輸出內');
    assert.ok(!a.includes('font-size: 24px'), '預設 fontSize=0(Auto) 不應注入 font-size override');
    assert.ok(b.includes('font-size: 24px'), 'fontSize=24 必須注入 font-size override');
  });

  it('行為：不同 contentWidth 產生不同 base（cache 以 contentWidth 區分）', () => {
    const w720 = injectedCss({ ...DEF });
    const w900 = injectedCss({ ...DEF, contentWidth: 900 });
    assert.notStrictEqual(w720, w900, 'contentWidth 不同必須產生不同 CSS');
  });
});
