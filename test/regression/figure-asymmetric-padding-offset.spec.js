// JRead — figure 不對稱水平 padding 定位 hack strip（v1.6.21）
//
// Bug（Jimmy 2026-07-08 回報 cn.nytimes.com/opinion/.../norway-nordic-social-democracy）：
//   小直幅照片整塊偏右、左側一大塊空白。根因 = 站點對 <figure> 設 padding-left
//   （= 欄寬 − 照片寬）把小於欄寬的照片在文字欄內靠右對齊（NYT-cn
//   figure.article-inline-photo 實測 padding-left:285px pr:0 → figure 內容區只剩
//   323px 靠在右緣、img wrapper width:auto 填滿的是那 323px）。reader mode 已把
//   figure 強制成滿版單欄媒體容器、其 img wrapper 走 width:auto + margin:auto 置中，
//   但沒清 figure 自身的水平 padding → 內容區被 padding 推偏。
//
// 修法（結構性通則，非站點特判）：single-column reader 內，figure 上「兩側不對稱」
//   的水平 padding 只可能是原站用來把窄媒體推離閱讀軸線的定位 hack，清為 0；對稱
//   水平 padding（合法框內縮 / 帶背景 inset）差值小、不命中，保留。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「styler 讀 figure computed 水平
//   padding + 不對稱判定 + snapshot/restore」的邏輯。真實 Chromium 幾何（照片是否
//   回填滿版心 608、左緣是否對齊）走 tools/debug-harness.js 截圖 + probe 量測。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'figure-asymmetric-padding-offset.html');

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

describe('styler — figure 不對稱水平 padding 定位 hack strip（v1.6.21）', () => {
  it('不對稱水平 padding 的 figure（padding-left:285 pr:0）被清為 0', () => {
    const { env } = setup();
    const fig = env.document.querySelector('.hack-offset');
    assert.ok(fig, 'fixture 必須有 .hack-offset figure');
    assert.strictEqual(fig.style.getPropertyValue('padding-left'), '0px',
      '不對稱 padding-left 必須被清為 0（照片才會回填版心靠左對齊）');
    assert.strictEqual(fig.style.getPropertyPriority('padding-left'), 'important',
      '清零必須用 !important（贏過原站 padding）');
    assert.strictEqual(fig.style.getPropertyValue('padding-right'), '0px',
      'padding-right 也一併清為 0');
  });

  it('對稱水平 padding 的 figure（padding:0 12px）不被清（保留合法框內縮）', () => {
    const { env } = setup();
    const fig = env.document.querySelector('.framed');
    assert.ok(fig, 'fixture 必須有 .framed figure');
    // 未被 strip → styler 不寫入 inline padding-left/right（維持 fixture 原值）
    assert.strictEqual(fig.style.getPropertyValue('padding-left'), '12px',
      '對稱水平 padding 不該被 strip');
    assert.strictEqual(fig.style.getPropertyValue('padding-right'), '12px',
      '對稱水平 padding 不該被 strip');
  });

  it('snapshot 的 figurePaddingSnap 只捕捉 .hack-offset、restore 還原原始 285px', () => {
    const { env, detected, snapshot } = setup();
    assert.ok(Array.isArray(snapshot.figurePaddingSnap), 'snapshot 必須含 figurePaddingSnap 陣列');
    assert.strictEqual(snapshot.figurePaddingSnap.length, 1,
      '只有不對稱那筆 figure 進 snapshot');
    const hit = snapshot.figurePaddingSnap[0];
    assert.ok(hit.el && hit.el.classList.contains('hack-offset'),
      'snapshot 命中的必須是 .hack-offset');

    env.NS.styler.restore(detected.el, snapshot);
    const fig = env.document.querySelector('.hack-offset');
    assert.strictEqual(fig.style.getPropertyValue('padding-left'), '285px',
      'restore 後 padding-left 還原為原始 285px');
    assert.strictEqual(fig.style.getPropertyValue('padding-right'), '0px',
      'restore 後 padding-right 還原為原始 0px');
  });
});
