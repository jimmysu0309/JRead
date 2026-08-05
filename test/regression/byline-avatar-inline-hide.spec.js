// JRead — byline 頭像 runtime inline 隱藏（v1.7.39 全面 review S1）
// -----------------------------------------------------------------------------
// 對應 fixture：test/regression/fixtures/byline-avatar-inline-hide.html
//
// Bug（2026-08-05 全面 review 批次 1，真 Chromium probe 實證）：
// v1.7.25「byline 頭像一律不顯示」的 CSS 規則 specificity (0,2,1) 被同
// stylesheet 內兩條規則打穿：
//   - 裸 <img>（> inline 門檻）：MEDIA_CAP_SEL (0,3,3) 的 display:block 勝
//   - 小裸圖：inline-img 規則同 specificity、source order 在後 → display:inline 勝
// 真 Chrome 下只有 <picture> 包與 <a> 包的頭像真的藏得掉。jsdom cascade 不
// 完整、恰好解出 none——既有 byline spec 的 computed display 斷言因此偽綠，
// 抓不到這條。
//
// 修法：apply() 的 hideAvatarMedia 對 byline root 子樹所有 img / picture 設
// inline display:none !important（必贏所有 stylesheet 規則、終結 specificity
// 軍備）；snapshot/restore 走既有 bylineDispSnap。CSS 規則降級為動態插入頭像
// 的兜底。
//
// 訊號層次：本 spec 驗「inline style 通道」（jsdom 與真 Chrome 行為一致，
// 不受 jsdom cascade 缺陷影響）+ restore 對稱性；真實視覺由 /harness-verify 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'byline-avatar-inline-hide.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — byline 頭像 runtime inline 隱藏 (v1.7.39)', () => {

  it('byline root 有被偵測標記（前提 sanity）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'byline-root').getAttribute('data-jread-byline'), '1',
      'fixture 的 meta 區必須被標 byline root，否則後續斷言全是 vacuous truth');
  });

  it('裸 <img> 頭像拿到 inline display:none !important（MEDIA_CAP 打穿場景）', () => {
    const { env } = setup();
    const el = q(env, 'avatar-bare');
    assert.strictEqual(el.style.getPropertyValue('display'), 'none',
      '裸 img 在真 Chrome 被 MEDIA_CAP_SEL (0,3,3) display:block 打穿，必須走 inline 通道藏');
    assert.strictEqual(el.style.getPropertyPriority('display'), 'important');
  });

  it('<picture> 包與 <a> 包的頭像同樣拿到 inline display:none', () => {
    const { env } = setup();
    for (const t of ['avatar-picture', 'avatar-picture-img', 'avatar-anchor']) {
      const el = q(env, t);
      assert.strictEqual(el.style.getPropertyValue('display'), 'none', `${t} 必須 inline 藏`);
      assert.strictEqual(el.style.getPropertyPriority('display'), 'important', `${t} 必須 !important`);
    }
  });

  it('byline 外的內容圖不受影響', () => {
    const { env } = setup();
    assert.notStrictEqual(q(env, 'content-img').style.getPropertyValue('display'), 'none',
      'hideAvatarMedia 只作用於 byline root 子樹，主文 figure 圖不可被藏');
  });

  it('restore 後 inline display 完全還原（對稱性）', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    for (const t of ['avatar-bare', 'avatar-picture', 'avatar-picture-img', 'avatar-anchor']) {
      assert.strictEqual(q(env, t).style.getPropertyValue('display'), '',
        `${t} 的 inline display 必須被 bylineDispSnap 還原成原值（原本無 inline display）`);
    }
  });
});
