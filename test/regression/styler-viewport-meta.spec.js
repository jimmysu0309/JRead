// JRead — viewport meta 正規化 regression spec（v0.8.139）
//
// 驗證：閱讀模式下把 <meta name="viewport"> 正規化成
// width=device-width, initial-scale=1，避免站點宣告 initial-scale < 1 或固定
// width（或根本沒宣告）時，reader card 在行動裝置被釘在縮小的初始縮放上，整張
// 卡看起來「縮小一半」；退出時還原（原有的還回原 content、自建的移除）。
//
// 觸發：Jimmy 2026-06-20 回報 daringfireball.net 在 iPhone 進閱讀模式後整頁
// 縮小一半。實際 viewport meta = `width=device, initial-scale=0.5, minimum-scale=0.45`
// （Gruber 故意讓寬版面在手機縮一半顯示）。
//
// 訊號層次：本 spec 驗「meta DOM 操作正確 + 可逆」。iOS Safari 是否真的據此
// 重算 layout viewport / 初始縮放是 WebKit 行為、Chromium harness 與 jsdom 都
// 驗不到，靠模擬器 / 真機驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

// READER_VIEWPORT 鏡像（styler.js 內部常數）——改 styler 預設 viewport 時這裡同步
const READER_VIEWPORT = 'width=device-width, initial-scale=1';

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中主文');
  return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
}

function metas(document) {
  return Array.from(document.head.querySelectorAll('meta[name="viewport"]'));
}

describe('styler — viewport meta 正規化', () => {
  it('站點宣告 initial-scale<1（daringfireball）：apply 正規化、restore 還原', () => {
    const { document, NS, articleEl } = setup();
    metas(document).forEach((m) => m.remove());
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', 'width=device, initial-scale=0.5, minimum-scale=0.45');
    document.head.appendChild(meta);

    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(meta.getAttribute('content'), READER_VIEWPORT, 'apply 後正規化成行動標準 viewport');

    NS.styler.restore(articleEl, snap);
    assert.strictEqual(meta.getAttribute('content'), 'width=device, initial-scale=0.5, minimum-scale=0.45', 'restore 後還原原 content');
    assert.strictEqual(metas(document).length, 1, '不應殘留多餘 meta');
  });

  it('站點固定 width（width=980）：apply 改成 device-width', () => {
    const { document, NS, articleEl } = setup();
    metas(document).forEach((m) => m.remove());
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', 'width=980');
    document.head.appendChild(meta);

    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(meta.getAttribute('content'), READER_VIEWPORT, '固定 width 被改成 device-width');
  });

  it('原站無 viewport meta：apply 自建、restore 移除', () => {
    const { document, NS, articleEl } = setup();
    metas(document).forEach((m) => m.remove());
    assert.strictEqual(metas(document).length, 0, '前置：無 viewport meta');

    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const after = metas(document);
    assert.strictEqual(after.length, 1, 'apply 自建一個 viewport meta');
    assert.strictEqual(after[0].getAttribute('content'), READER_VIEWPORT, '自建 content = 行動標準 viewport');

    NS.styler.restore(articleEl, snap);
    assert.strictEqual(metas(document).length, 0, 'restore 後移除自建 meta');
  });

  it('多個 viewport meta：全部正規化並各自還原', () => {
    const { document, NS, articleEl } = setup();
    metas(document).forEach((m) => m.remove());
    const m1 = document.createElement('meta');
    m1.setAttribute('name', 'viewport');
    m1.setAttribute('content', 'width=device, initial-scale=0.5');
    const m2 = document.createElement('meta');
    m2.setAttribute('name', 'viewport');
    m2.setAttribute('content', 'width=1024');
    document.head.appendChild(m1);
    document.head.appendChild(m2);

    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(m1.getAttribute('content'), READER_VIEWPORT, 'm1 正規化');
    assert.strictEqual(m2.getAttribute('content'), READER_VIEWPORT, 'm2 正規化');

    NS.styler.restore(articleEl, snap);
    assert.strictEqual(m1.getAttribute('content'), 'width=device, initial-scale=0.5', 'm1 還原');
    assert.strictEqual(m2.getAttribute('content'), 'width=1024', 'm2 還原');
  });
});
