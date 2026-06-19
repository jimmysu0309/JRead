// JRead — full-bleed 負 margin 圖片置中 + 過小圖說可讀性（v0.8.123）
//
// Bug（Jimmy 2026-06-19 回報 theverge.com/.../logitech-mobi-fold-...）：
//   1. in-body 圖片包在 `div.duet--article--block-placement`（margin-left:-100px，
//      原站 full-bleed overhang）→ reader 單欄 card 下圖片被推到內文左側 100px、
//      未與文字欄對齊（「圖片沒置中而破圖」）。
//   2. 淺色模式 figcaption 原站 11px / #4a4a4a → 字太小 + 比內文淺，閱讀困難。
//
// 修法（結構性通則，非站點特判）：
//   1. contentWidthSnap 的 zeroHoriz 改用 Math.abs(margin) > 0.5 判定——既清正
//      margin（narrowing）也清負 margin（full-bleed overhang），圖片 wrapper 退回
//      column 起點對齊文字。
//   2. captionFsSnap：figcaption 字級下限 = max(14px, round(body*0.78))，只撐小於
//      floor 的 caption（不抹平正常階層）。light theme 另注入 figcaption 深灰 #333。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'neg-margin-image-tiny-caption.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function setup(settings) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  const snapshot = env.NS.styler.apply(detected.el, settings || DEFAULT_SETTINGS);
  return { env, detected, snapshot };
}

describe('styler — full-bleed 負 margin 圖片置中（v0.8.123）', () => {
  it('圖片 wrapper 的負 margin-left（full-bleed overhang）被清零', () => {
    const { env } = setup();
    const bp = env.document.querySelector('.block-placement');
    assert.ok(bp, 'fixture 必須有 .block-placement wrapper');
    assert.strictEqual(bp.style.getPropertyValue('margin-left'), '0px',
      '負 margin-left 必須被清零（圖片才會對齊文字欄）');
    assert.strictEqual(bp.style.getPropertyPriority('margin-left'), 'important',
      '清零必須用 !important（贏過原站負 margin）');
  });

  it('snapshot 的 contentWidthSnap 捕捉到負 margin、restore 還原為 -100px', () => {
    const { env, detected, snapshot } = setup();
    assert.ok(Array.isArray(snapshot.contentWidthSnap), 'snapshot 必須含 contentWidthSnap 陣列');
    const hit = snapshot.contentWidthSnap.some(s => s.el && s.el.classList && s.el.classList.contains('block-placement'));
    assert.ok(hit, 'contentWidthSnap 必須含 .block-placement 一筆');
    env.NS.styler.restore(detected.el, snapshot);
    const bp = env.document.querySelector('.block-placement');
    assert.strictEqual(bp.style.getPropertyValue('margin-left'), '-100px',
      'restore 後 margin-left 還原為原始 -100px');
  });
});

describe('styler — 過小圖說字級下限（v0.8.123）', () => {
  it('11px figcaption 被撐到 14px floor（body 18 → floor 14）', () => {
    const { env } = setup();
    const fc = env.document.querySelector('figcaption');
    assert.ok(fc, 'fixture 必須有 figcaption');
    assert.strictEqual(fc.style.getPropertyValue('font-size'), '14px',
      'figcaption font-size 必須被撐到 14px floor');
    assert.strictEqual(fc.style.getPropertyPriority('font-size'), 'important',
      'floor 必須用 !important（蓋站點 caption class rule）');
  });

  it('floor 隨 body 字級縮放：body 28 → floor round(28*0.78)=22px', () => {
    const { env } = setup(Object.assign({}, DEFAULT_SETTINGS, { fontSize: 28 }));
    const fc = env.document.querySelector('figcaption');
    assert.strictEqual(fc.style.getPropertyValue('font-size'), '22px',
      'body 字級放大時 caption floor 必須同步變大（保留階層）');
  });

  it('snapshot 含 captionFsSnap、restore 還原原始 11px', () => {
    const { env, detected, snapshot } = setup();
    assert.ok(Array.isArray(snapshot.captionFsSnap), 'snapshot 必須含 captionFsSnap 陣列');
    assert.ok(snapshot.captionFsSnap.length >= 1, '至少捕捉到 figcaption 一筆');
    env.NS.styler.restore(detected.el, snapshot);
    const fc = env.document.querySelector('figcaption');
    assert.strictEqual(fc.style.getPropertyValue('font-size'), '11px',
      'restore 後 font-size 還原為原始 11px');
  });
});

describe('styler — 淺色模式圖說顏色加深（v0.8.123）', () => {
  it('light theme 注入 figcaption 深灰 #333 規則', () => {
    const { env } = setup();
    const style = env.document.getElementById('__jread-style');
    assert.ok(style, '必須注入 __jread-style');
    const css = style.textContent;
    assert.ok(/figcaption[\s\S]*?color:\s*#333333/.test(css),
      'light theme CSS 必須含 figcaption color: #333333');
  });

  it('dark theme 不注入 light-only figcaption 深灰規則（交給 theme.text 接管）', () => {
    const { env } = setup(Object.assign({}, DEFAULT_SETTINGS, { theme: 'dark' }));
    const style = env.document.getElementById('__jread-style');
    const css = style.textContent;
    assert.ok(!/figcaption,\s*\[data-jread-active="1"\] figcaption \* \{\s*color:\s*#333333/.test(css),
      'dark theme 不應注入 light-only #333 figcaption 規則');
  });
});
