// JRead — 主文內訂閱表單（無 form 包裝）+ heading 社群 CTA regression spec（v1.7.13）
// 對應 fixture：test/regression/fixtures/gvm-inarticle-cta.html
//
// Bug 來源（city.gvm.com.tw/article/130682，multi-block 吸收修法後 harness
// RESIDUAL AUDIT 揪出）：
// 1. 「👉 加入城市學 LINE 官方帳號，追蹤 IG…」做成 <h4><strong> 純文字
//    heading——社群 join 句式在 NOISE_LINK_TEXT_RE 有、heading 層沒有，
//    載體不是 a/button 掃不到 → 修法把同款句式抄進 NOISE_HEADING_TEXT_EXT_RE
// 2. 「請訂閱《城市學》」訂閱表單用裸 div 包 email input（無 <form> tag）——
//    hideInsideArticleSubscribeForms 只掃 form → 修法補「email 輸入框」結構
//    訊號（type=email 或 type=text 且 name/id/placeholder 帶 mail token）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'gvm-inarticle-cta.html');

describe('cleaner — gvm 主文內 CTA（無 form 訂閱表單 + heading 社群 join）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.getElementById('art');
    assert.ok(articleEl, 'fixture 必須有 #art');
    env.NS.cleaner.clean(articleEl);
  });

  it('無 form 包裝的訂閱表單整塊被 hide（email input 結構訊號）', () => {
    const widget = document.getElementById('email-area');
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      'email input 命中後 findContentFreeCard 應把整個訂閱卡片 hide');
  });

  it('heading 載體的社群 join CTA 被 hide（NOISE_HEADING_TEXT_EXT_RE）', () => {
    const cta = document.getElementById('line-cta');
    const hiddenSelf = cta.dataset.jreadHidden === '1';
    const hiddenByAncestor = !!cta.closest('[data-jread-hidden="1"]');
    assert.ok(hiddenSelf || hiddenByAncestor,
      '「加入…LINE 官方帳號」heading CTA 必須被 hide（自身或祖先容器）');
  });

  it('主文段落 p1 / p2 全部保留', () => {
    for (const id of ['p1', 'p2']) {
      const p = document.getElementById(id);
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `主文段 ${id} 不可被 hide`);
      assert.ok(!p.closest('[data-jread-hidden="1"]'), `主文段 ${id} 的祖先不可被 hide`);
    }
  });
});
