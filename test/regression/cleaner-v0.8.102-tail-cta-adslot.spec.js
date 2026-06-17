// JRead — 文末訂閱/註冊招攬卡片 + 廣告槽 placeholder 清除（v0.8.102）
//
// Page Rounds 2026-06-18 三筆真 bug：
//   1. chinatalk.media Quantum 101 — C2 Substack 訂閱卡（H4 被清、兄弟 pitch
//      div + <form> 殘留）
//   2. qiita.com — C2 註冊招攬卡（無 form、hit P 54 chars > heading MAX_LEN_EXT）
//   3. cw.com.tw — C4 內文廣告槽 placeholder「BPC > no fix」洩漏（cage 揪出）
//
// 修法（結構通則，不綁站點 / class hash / id）：
//   - hideInsideArticleSubscribeForms：主文 <form> → 往上走到「不含主文長 <p>」
//     最外層卡片整塊 hide
//   - hideInsideArticleSignupCtaCards：NOISE_SIGNUP_CTA_RE 命中文字 → 同 walk-up
//   - NOISE_INLINE_AD_TEXT_RE 加 ad-slot 指令格式（`XXX > no fix`）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

function isHidden(el) {
  return !!(el && el.closest && el.closest('[data-jread-hidden="1"]'));
}

function setup(fixtureName) {
  const env = loadFixtureWithScripts({
    fixturePath: path.join(__dirname, 'fixtures', fixtureName),
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  const detected = env.window.__JRead.detector.detect();
  assert.ok(detected && detected.el, `detector 應命中 ${fixtureName} 主文`);
  env.window.__JRead.cleaner.clean(detected.el);
  return { window: env.window, articleEl: detected.el };
}

// minLen：視為主文段落的 textContent 長度門檻。中文密度高、段落字元數較少
// （cw 真內文 69-75 chars），用 60；英日文用 80（同時排除 qiita 54-char 的
// 已隱藏「Register...」CTA p，避免它被當主文段落觸發誤判）。
function assertContentPreserved(articleEl, minLen = 80) {
  let longP = 0;
  for (const p of articleEl.querySelectorAll('p')) {
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= minLen) {
      assert.ok(!isHidden(p), `主文段落不可被誤殺：「${text.slice(0, 24)}…」`);
      longP++;
    }
  }
  assert.ok(longP >= 3, `應保留 >= 3 段主文 p（實際 ${longP}）`);
  const h1 = articleEl.querySelector('h1');
  assert.ok(h1 && !isHidden(h1), 'h1 標題必須保留');
}

describe('cleaner — 文末訂閱/註冊卡 + 廣告槽 placeholder（v0.8.102）', () => {
  describe('chinatalk Substack 訂閱卡（含 <form>）', () => {
    let articleEl;
    before(() => { articleEl = setup('chinatalk-subscribe-form-card.html').articleEl; });

    it('訂閱卡內 pitch / form / 條款全部被 hide', () => {
      const form = articleEl.querySelector('form');
      assert.ok(form && isHidden(form), '<form> 必須被 hide');
      const pitch = [...articleEl.querySelectorAll('div')]
        .find(d => /Hundreds of paid subscribers/.test(d.textContent || ''));
      assert.ok(pitch && isHidden(pitch), '「Hundreds of paid subscribers」必須被 hide');
      const consent = [...articleEl.querySelectorAll('label')]
        .find(l => /By subscribing, you agree/.test(l.textContent || ''));
      assert.ok(consent && isHidden(consent), '「By subscribing, you agree」必須被 hide');
      const h4 = [...articleEl.querySelectorAll('h4')]
        .find(h => /Subscribe to ChinaTalk/.test(h.textContent || ''));
      assert.ok(h4 && isHidden(h4), '「Subscribe to ChinaTalk」H4 必須被 hide');
    });

    it('主文段落（含 Further reading 段）與標題保留', () => {
      assertContentPreserved(articleEl);
      const fr = [...articleEl.querySelectorAll('p')]
        .find(p => /Further reading/.test(p.textContent || ''));
      assert.ok(fr && !isHidden(fr), '「Further reading」正文段不可被誤殺');
    });
  });

  describe('qiita 註冊招攬卡（無 form）', () => {
    let articleEl;
    before(() => { articleEl = setup('qiita-signup-cta-card.html').articleEl; });

    it('註冊卡（Register / signing up / Login）整塊被 hide', () => {
      const card = articleEl.querySelector('.style-rwy56f');
      assert.ok(card && isHidden(card), '註冊招攬卡容器必須整塊被 hide');
      const reg = [...articleEl.querySelectorAll('p')]
        .find(p => /Register as a new user/.test(p.textContent || ''));
      assert.ok(reg && isHidden(reg), '「Register as a new user」必須被 hide');
      const login = [...articleEl.querySelectorAll('a')]
        .find(a => /^Login$/.test((a.textContent || '').trim()));
      assert.ok(login && isHidden(login), '「Login」連結必須被 hide');
    });

    it('主文段落與標題保留', () => { assertContentPreserved(articleEl); });
  });

  describe('cw 廣告槽 placeholder（BPC > no fix，葉節點文字訊號，中文內文）', () => {
    let articleEl;
    before(() => { articleEl = setup('cw-adslot-placeholder.html').articleEl; });

    it('「BPC > no fix」廣告槽 placeholder 被 hide', () => {
      const slot = [...articleEl.querySelectorAll('div')]
        .find(d => /^BPC\s*>\s*no fix$/.test((d.textContent || '').replace(/\s+/g, ' ').trim()));
      assert.ok(slot, 'fixture 應有 ad-slot placeholder');
      assert.ok(isHidden(slot), '廣告槽 placeholder「BPC > no fix」必須被 hide');
    });

    it('主文段落與標題保留（中文門檻 60）', () => { assertContentPreserved(articleEl, 60); });
  });
});
