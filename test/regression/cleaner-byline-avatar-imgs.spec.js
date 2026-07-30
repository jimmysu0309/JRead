// JRead — regression spec: byline 作者頭像一律不顯示（v1.7.25）
// -----------------------------------------------------------------------------
// Jimmy 2026-07-30 需求：「作者欄的頭像都不要顯示，套用到所有網站」
// （wirecutter podcast 頁 4 張 50×50 作者頭像截圖）。
//
// 雙軌實作（同一份事實，改政策時兩處同改）：
//   - styler：`[data-jread-byline] img/picture { display:none }`——吃 byline
//     標記子樹內的頭像（styler-byline-oneline-normalize / avatar-picture-margin
//     兩 spec 已更新為新政策 forcing）
//   - cleaner `hideBylineAvatarImgs`（本 spec）——吃標記外的頭像列（wirecutter
//     實測：byline root 只標日期行，頭像 row + By 作者連結是獨立區塊）
//
// cleaner 判準（結構通則）：小圖（兩維 9–120px；rect → natural → width attr
// fallback）+ 近祖先（<= 6 hops）存在短 byline 文字區塊（<= 200 chars 且命中
// BYLINE_TEXT_RE，或區塊內存在文字與 img alt 全等的 <a>）。guard：figure 內
// 豁免（內容媒體；小 chart 圖 + 含日期圖說會誤中日期 pattern）、<= 8px 不碰
// （未載入 emoji / tracking pixel 範圍，udn v1.6.17 保護語意）、祖先文字一超
// 過 200 即 break。排在 author-bio 卡規則之後（bio 卡判準含頭像訊號，先藏
// 頭像會讓 bio 卡失去命中——medium-byline-header spec 負控制實證）。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

describe('cleaner — byline 作者頭像一律清除（v1.7.25）', () => {
  let window, document, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'byline-avatar-row.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.chrome = window.chrome || { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
    window.eval(SRC.namespace);
    window.eval(SRC.detector);
    window.eval(SRC.cleaner);
    const result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('作者列頭像（byline 標記外、alt 與作者連結全等）必須 hide', () => {
    for (const t of ['avatar-1', 'avatar-2']) {
      const img = document.querySelector(`[data-test="${t}"]`);
      assert.strictEqual(img.dataset.jreadHidden, '1',
        `${t} 必須清；forcing：移除 hideBylineAvatarImgs 或其 safeRun → fail`);
    }
  });

  it('作者名文字連結必須保留（只清頭像、不清名字）', () => {
    const row = document.querySelector('[data-test="authors-row"]');
    const nameLinks = [...row.querySelectorAll('p a')];
    assert.ok(nameLinks.length >= 2, 'fixture 前提：By 段落含作者連結');
    for (const a of nameLinks) {
      let covered = false;
      for (let p = a; p && p !== document.body; p = p.parentElement) {
        if (p.dataset && p.dataset.jreadHidden === '1') { covered = true; break; }
      }
      assert.ok(!covered, `作者連結「${a.textContent}」不可被藏（自身或祖先）`);
    }
  });

  it('figure 內小圖（含日期圖說）不可清（內容媒體豁免）', () => {
    const chart = document.querySelector('[data-test="small-chart"]');
    assert.notStrictEqual(chart.dataset.jreadHidden, '1',
      'figure 是 author-declared 內容媒體——小 chart + 日期圖說不可誤中日期 pattern');
  });

  it('內文大圖（超過頭像尺寸上限）不可清', () => {
    const big = document.querySelector('[data-test="big-photo"]');
    assert.notStrictEqual(big.dataset.jreadHidden, '1',
      '尺寸 gate：> 120px 的內容圖即使相鄰文字含日期也不可清');
  });
});
