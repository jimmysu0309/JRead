// JRead — theme-color meta 覆蓋 regression spec（v0.8.24）
//
// 驗證：閱讀模式下把 <meta name="theme-color"> 覆蓋成 reader card 色
// （theme.articleBg），讓 iOS Safari 染狀態列 / 底部工具列的色與 reader card
// 一致；退出時還原（原有的還回原 content、自建的移除）。
//
// 觸發：Jimmy 2026-06-09 回報 chinatalk.media（theme-color #f9eedc 米色）分頁
// 模式螢幕上下端露出原站米色背景，要求代換為 JRead 色。
//
// 訊號層次：本 spec 驗「meta DOM 操作正確 + 可逆」。iOS Safari 是否真的用此
// meta 染 chrome 是 WebKit 行為、Chromium harness 與 jsdom 都驗不到，靠真機驗。

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

// THEMES.articleBg 鏡像（styler.js 內部常數）——bump theme 配色時這裡要同步
const ARTICLE_BG = { light: '#ffffff', dark: '#1a1a1a', sepia: '#f4ecd8' };

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
  return Array.from(document.head.querySelectorAll('meta[name="theme-color"]'));
}

describe('styler — theme-color meta 覆蓋', () => {
  it('原站已宣告 theme-color：apply 覆蓋成 reader card 色、restore 還原', () => {
    const { document, NS, articleEl } = setup();
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#f9eedc'); // chinatalk 米色
    document.head.appendChild(meta);

    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(meta.getAttribute('content'), ARTICLE_BG.light, 'apply 後 content = light articleBg');

    NS.styler.restore(articleEl, snap);
    assert.strictEqual(meta.getAttribute('content'), '#f9eedc', 'restore 後還原原色');
    assert.strictEqual(metas(document).length, 1, '不應殘留多餘 meta');
  });

  it('dark / sepia 主題覆蓋成各自 articleBg', () => {
    for (const t of ['dark', 'sepia']) {
      const { document, NS, articleEl } = setup();
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('content', '#abcdef');
      document.head.appendChild(meta);

      NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: t });
      assert.strictEqual(meta.getAttribute('content'), ARTICLE_BG[t], `${t} 主題覆蓋成 ${ARTICLE_BG[t]}`);
    }
  });

  it('多個 theme-color（light/dark media 變體）全部覆蓋', () => {
    const { document, NS, articleEl } = setup();
    const m1 = document.createElement('meta');
    m1.setAttribute('name', 'theme-color');
    m1.setAttribute('media', '(prefers-color-scheme: light)');
    m1.setAttribute('content', '#ffffff');
    const m2 = document.createElement('meta');
    m2.setAttribute('name', 'theme-color');
    m2.setAttribute('media', '(prefers-color-scheme: dark)');
    m2.setAttribute('content', '#000000');
    document.head.appendChild(m1);
    document.head.appendChild(m2);

    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(m1.getAttribute('content'), ARTICLE_BG.light, 'light 變體覆蓋');
    assert.strictEqual(m2.getAttribute('content'), ARTICLE_BG.light, 'dark 變體也覆蓋成同 JRead 色');

    NS.styler.restore(articleEl, snap);
    assert.strictEqual(m1.getAttribute('content'), '#ffffff', 'm1 還原');
    assert.strictEqual(m2.getAttribute('content'), '#000000', 'm2 還原');
  });

  it('原站無 theme-color：apply 自建、restore 移除', () => {
    const { document, NS, articleEl } = setup();
    // 確保 fixture head 內沒有殘留 theme-color
    metas(document).forEach((m) => m.remove());
    assert.strictEqual(metas(document).length, 0, '前置：無 theme-color');

    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const after = metas(document);
    assert.strictEqual(after.length, 1, 'apply 自建一個 theme-color');
    assert.strictEqual(after[0].getAttribute('content'), ARTICLE_BG.light, '自建 content = articleBg');

    NS.styler.restore(articleEl, snap);
    assert.strictEqual(metas(document).length, 0, 'restore 後移除自建 meta');
  });
});
