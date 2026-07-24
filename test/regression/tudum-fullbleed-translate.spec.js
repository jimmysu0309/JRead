// JRead — regression spec: full-bleed translateX 置中對殘留 reset（v1.7.16）
// -----------------------------------------------------------------------------
// Forcing function for styler 的 translateX reset pass（zeroHoriz 之後）。
//
// Trigger: Jimmy 2026-07-24 回報 Netflix Tudum reader 內文圖偏左且被截斷。
// probe 實證：圖 wrapper 在 reader 內殘留 computed transform
// matrix(1,0,0,1,-304,0)（自身寬 608 的 -50%）——站方 full-bleed 置中 idiom
// 「+50% 定位 ↔ translateX(-50%)」的 + 半邊被 reader 的 grid 塌平 / 寬度
// 正規化拆掉，-50% 殘留 → wrapper 左移半個圖寬掛出 card 被裁。
//
// 規則（結構通則）：純水平位移（|tx| > 8）+ 目前 rect 出框（±8px）+ 位移
// 歸零後回框（±4px）→ inline transform:none !important。carousel 滑軌
// （歸零後仍出框）、小裝飾位移、未出框位移皆不碰。
//
// 驗證層次：本 spec 驗 jsdom 端寫入 / guard / restore（rect 用 stubRect）。
// 真實 Chrome 端由 harness fullpage 截圖驗收（見 CHANGELOG v1.7.16）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tudum-fullbleed-translate.html');

const OPTS = {
  theme: 'light', fontSize: 18, contentWidth: 720,
  fontFamily: 'system-ui', lineHeight: 1.7
};

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
  const doc = env.document;
  const q = (sel) => doc.querySelector(sel);
  const articleEl = q('[data-test="article"]');
  articleEl.setAttribute('data-jread-active', '1');
  // 主場景：parent 內容框 336..944、wrapper 被 -304 位移到 32..640（出左框；
  // 歸零後 336..944 恰好回框）
  stubRect(q('[data-test="media-parent"]'), { left: 336, top: 1000, width: 608, height: 400 });
  stubRect(q('[data-test="shifted-wrap"]'), { left: 32, top: 1000, width: 608, height: 400 });
  // 負控制 A：carousel 軌寬 1216 > viewport 608；位移 -608 後 rect 336..1552
  // 出右框、歸零後 944..2160 仍出右框 → fits 不成立
  stubRect(q('[data-test="carousel-viewport"]'), { left: 336, top: 1500, width: 608, height: 200 });
  stubRect(q('[data-test="carousel-track"]'), { left: -272, top: 1500, width: 1216, height: 200 });
  // 負控制 B：小位移（|tx|=4 <= 8 門檻）——rect 隨意給出框值也不碰
  stubRect(q('[data-test="decor-nudge"]'), { left: 300, top: 1800, width: 608, height: 100 });
  // 負控制 C：位移 -40 但沒出框（parent 就是 article 全寬）
  stubRect(q('[data-test="inbox-shift"]'), { left: 400, top: 2000, width: 200, height: 100 });
  stubRect(articleEl, { left: 336, top: 0, width: 608, height: 3000 });
  return { env, articleEl };
}

describe('styler — full-bleed translateX 置中對殘留 reset（v1.7.16）', () => {
  it('(a) 出框的 -50% translate wrapper 被寫 transform:none !important', () => {
    const { env, articleEl } = setup();
    env.window.__JRead.styler.apply(articleEl, OPTS);
    const wrap = articleEl.querySelector('[data-test="shifted-wrap"]');
    assert.strictEqual(wrap.style.getPropertyValue('transform'), 'none',
      '殘留 translate 必須被 reset 為 none');
    assert.strictEqual(wrap.style.getPropertyPriority('transform'), 'important',
      'reset 必須帶 !important（蓋過站方 stylesheet）');
  });

  it('(b) 負控制：carousel 滑軌（歸零後仍出框）不可碰', () => {
    const { env, articleEl } = setup();
    env.window.__JRead.styler.apply(articleEl, OPTS);
    const track = articleEl.querySelector('[data-test="carousel-track"]');
    assert.strictEqual(track.style.getPropertyValue('transform'), 'translateX(-608px)',
      'carousel 軌的 inline transform 必須原樣保留');
  });

  it('(c) 負控制：小裝飾位移（|tx| <= 8）與未出框位移不可碰', () => {
    const { env, articleEl } = setup();
    env.window.__JRead.styler.apply(articleEl, OPTS);
    assert.strictEqual(
      articleEl.querySelector('[data-test="decor-nudge"]').style.getPropertyValue('transform'),
      'translateX(-4px)', '小位移不可碰');
    assert.strictEqual(
      articleEl.querySelector('[data-test="inbox-shift"]').style.getPropertyValue('transform'),
      'translateX(-40px)', '未出框位移不可碰');
  });

  it('(d) restore：退出後 wrapper inline transform 還原原值', () => {
    const { env, articleEl } = setup();
    const snap = env.window.__JRead.styler.apply(articleEl, OPTS);
    env.window.__JRead.styler.restore(articleEl, snap);
    const wrap = articleEl.querySelector('[data-test="shifted-wrap"]');
    assert.strictEqual(wrap.style.getPropertyValue('transform'), 'translateX(-304px)',
      'restore 必須還原原 inline transform（fixture 以 inline 模擬站方值）');
  });
});
