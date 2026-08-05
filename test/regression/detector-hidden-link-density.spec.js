// JRead — linkDensity 隱藏連結灌水（v1.7.39 全面 review D1）
// -----------------------------------------------------------------------------
// 對應 fixture：test/regression/fixtures/continuation-hidden-nav-density.html
//
// Bug（2026-08-05 全面 review 批次 1，真 Chromium probe 實證）：
// linkDensity 分母 textLen 來自 innerText（真瀏覽器排除 display:none 子樹），
// 分子逐一取 a.innerText——依 spec「非 render 元素的 innerText 直接回傳
// textContent」，候選容器內的隱藏導覽選單（mobile nav 常態）連結文字全數
// 計入分子、不在分母，density 被灌爆（可 > 1），誤觸 isLinkDirectory 0.5
// reject / looksLikeContinuationBlock 的 CONT_MAX_LD 0.3 / heuristic 乘法懲罰。
// 與 v1.7.38（CJK 譯文推高 linkDensity）同一敏感家族。
//
// 修法：linkDensity 分子計入前用 isAncestorChainHidden 排除隱藏子樹的 <a>。
//
// 可觀察通道：looksLikeContinuationBlock 的 CONT_MAX_LD gate——含隱藏選單的
// 接續區塊修法前被 reject（不吸收）、修法後照常吸收。jsdom 註記：getText 退
// 回 textContent（分母含隱藏文字），density 灌水幅度比真 Chrome 小但同向，
// fixture 連結量已把 bug 版 density 推過 0.3（sanity 破壞驗證過會 fail）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'continuation-hidden-nav-density.html');

describe('detector — linkDensity 排除隱藏子樹連結 (v1.7.39)', () => {
  let result;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector']
    });
    result = env.NS.detector.detect();
  });

  it('偵測成功且主容器為 article#main', () => {
    assert.ok(result && result.el, '偵測應成功');
    assert.strictEqual(result.el.id, 'main');
  });

  it('含 display:none 選單的接續區塊照常吸收（隱藏連結不得灌爆 density）', () => {
    const ids = Array.from(result.continuationEls || [], el => el.id);
    assert.ok(ids.includes('cont-quicklist'),
      `隱藏 nav 的連結文字不可計入 linkDensity 分子——bug 版 density > CONT_MAX_LD ` +
      `導致該塊被誤 reject、文章後半截斷。實際吸收清單 [${ids.join(', ')}]`);
  });

  it('控制組：無隱藏選單的接續區塊吸收（fixture 本身合格的 sanity）', () => {
    const ids = Array.from(result.continuationEls || [], el => el.id);
    assert.ok(ids.includes('cont-clean'), `實際吸收清單 [${ids.join(', ')}]`);
  });

  it('可見的純連結列仍不吸收（修法只豁免隱藏連結、不豁免可見連結）', () => {
    const ids = Array.from(result.continuationEls || [], el => el.id);
    assert.ok(!ids.includes('visible-link-list'),
      '可見連結照常計入 density，真連結目錄必須維持 reject');
  });
});
