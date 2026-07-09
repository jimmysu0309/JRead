// JRead — Substack 平台文末互動 / 推薦嵌入雜訊整塊清（v1.7.1）
//
// 對應 bug（Jimmy 2026-07-09 culpium.com/p/what-sk-hynixs-ipo-prospectus-doesnt
// translate-first 實測「頁面尾端有許多雜訊」，接續 v1.6.31 訂閱 widget + 文字式
// reaction bar）：翻譯後文末殘留「更多來自 X：」推薦文章卡 + 讚 / 轉發反應列 + 分享
// CTA 說明。三塊全是 Substack 平台慣例語意 class，且與主文段落同層（body.markup
// 直接子、混在主文流裡）。
//
// 根因：
//   1. 「更多來自」heading 翻譯後不在 NOISE_HEADING_TEXT_RE（英文「More from」已被
//      `^more from` 命中，中文漏）；且 heading walk-up 第一層撞含主文的 body.markup、
//      被主文保護擋 → 只能 hide heading 自己，清不掉底下卡片。
//   2. digestPostEmbed 推薦卡 / post-ufi 反應列 class 是平台語意 + emotion hash，
//      NOISE_KEYWORD_RE 命中不到；反應列 button 被清後容器 + 讚數連結殘留。
//
// 修法：NOISE_HEADING_TEXT_RE 補「更多來自」；新增 SUBSTACK_PLATFORM_NOISE_SEL
// （.post-ufi / [class*="digestPostEmbed"] / .cta-caption）精確 hide（不 walk-up、
// 零主文誤殺，比照 RECOMMENDATION_WIDGET_SEL 平台語意先例）。非 hostname / 單站特判
// ——任何 Substack 站的平台角色 class 都清；翻譯不改 class → translate-first 同樣命中。
//
// 訊號層次（harness-verify §3）：本 spec 驗「命中 class / heading 的元素被標
// jreadHidden + 主文保留 + 可逆」（結構 / attribute 層），不驗真實 Chrome 視覺呈現
// （harness translate-first 覆蓋該層）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'culpium-platform-footer-noise.html');

describe('cleaner — Substack 平台文末互動 / 推薦雜訊整塊清（v1.7.1）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.getElementById('art');
    assert.ok(articleEl, 'fixture 必須有 #art');
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('「更多來自 Culpium：」推薦區 heading 被 hide（NOISE_HEADING_TEXT_RE 補「更多來自」）', () => {
    assert.strictEqual(document.getElementById('moreh').dataset.jreadHidden, '1',
      'H3「更多來自」heading 必須命中 heading text 規則被 hide');
  });

  it('digestPostEmbed 推薦文章卡全部被 hide（platform 語意 selector）', () => {
    for (const id of ['card1', 'card2']) {
      assert.strictEqual(document.getElementById(id).dataset.jreadHidden, '1',
        `推薦卡 ${id} 必須被 hide`);
    }
  });

  it('post-ufi 反應列容器被 hide（button 清後容器 + 讚數連結一併清）', () => {
    const ufi = document.getElementById('ufi');
    assert.strictEqual(ufi.dataset.jreadHidden, '1', 'post-ufi 容器必須被 hide');
    // 讚數連結在被 hide 的容器內（closest 命中）→ 不再 render
    assert.ok(document.getElementById('likecount').closest('[data-jread-hidden="1"]'),
      '「15 贊」連結必須在被 hide 的祖先內');
    assert.ok(document.getElementById('restackcount').closest('[data-jread-hidden="1"]'),
      '「1 重新堆疊」連結必須在被 hide 的祖先內');
  });

  it('文末 pencraft reaction bar（無 post-ufi class、整段「15 贊∙1 重新堆疊」）被 hide（REACTION_COUNT_RE 中文擴充）', () => {
    assert.strictEqual(document.getElementById('reactbar').dataset.jreadHidden, '1',
      'pencraft hash class 的 reaction bar 必須靠 isReactionCountBar 整段純計數訊號被 hide');
  });

  it('cta-caption 分享說明段被 hide', () => {
    assert.strictEqual(document.getElementById('cta').dataset.jreadHidden, '1',
      '.cta-caption 說明段必須被 hide');
  });

  it('主文章節 H4（同 header-anchor-post class）不得被誤殺（證明非 class 特判）', () => {
    assert.notStrictEqual(document.getElementById('section').dataset.jreadHidden, '1',
      '主文章節標題與推薦 heading 共用 header-anchor-post class，不可靠 class 清 → 不得誤殺');
  });

  it('主文段落 b1 / b2 / b3 全部保留', () => {
    for (const id of ['b1', 'b2', 'b3']) {
      assert.notStrictEqual(document.getElementById(id).dataset.jreadHidden, '1',
        `主文段 ${id} 不可被 hide`);
    }
  });

  it('可逆：restore 後 hide 標記與 inline display 全還原', () => {
    for (const id of ['moreh', 'card1', 'card2', 'ufi', 'cta']) {
      assert.strictEqual(document.getElementById(id).style.display, 'none',
        `${id} clean 後應為 display:none`);
    }
    window.__JRead.cleaner.restore(hidden);
    for (const id of ['moreh', 'card1', 'card2', 'ufi', 'cta']) {
      const el = document.getElementById(id);
      assert.notStrictEqual(el.dataset.jreadHidden, '1', `restore 後 ${id} jreadHidden 應清除`);
      assert.notStrictEqual(el.style.display, 'none', `restore 後 ${id} display 不應殘留 none`);
    }
  });
});
