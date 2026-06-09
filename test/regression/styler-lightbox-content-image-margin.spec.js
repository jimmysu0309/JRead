// JRead — lightbox 大內容圖（a > img）margin / display rescue（v0.8.11）
//
// Bug：forum.gamer.com.tw 進 reader mode 後圖片與文字分隔太窄（圖文只隔 4px）。
//
// 根因：大內容圖被 a.photoswipe-image 包住（display:inline + 原站 4px margin），
// 命中 styler 既有 img:not(a > img) 排除（原為保護小 icon-link 而設）→ block +
// margin-bottom:24px 規則漏掉它，圖片維持 inline 緊貼文字。
//
// 修法：apply() runtime 量到 >= CONTENT_IMG_MIN(200px) 且祖先有 <a> 的 img 標
// [data-jread-content-img]，CSS 對它強制 block + 上下對稱 24px margin。
// 小 icon-link（< 200px）不標記、維持 inline 不受影響。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'gamer-lightbox-image-margin.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  const snapshot = env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return { env, snapshot, css: styleEl.textContent };
}

describe('styler — lightbox 大內容圖 margin / display rescue（v0.8.11 gamer）', () => {
  it('大內容圖（a > img、>= 200px）必須被標記 data-jread-content-img', () => {
    const { env } = setup();
    const bigImgs = Array.from(env.document.querySelectorAll('a.photoswipe-image:not(.lazy-no-dim) > img'));
    assert.strictEqual(bigImgs.length, 2, 'fixture 應有 2 張有尺寸屬性的 lightbox 大圖');
    for (const img of bigImgs) {
      assert.strictEqual(img.getAttribute('data-jread-content-img'), '1',
        `大內容圖必須標記 content-img（width=${img.getAttribute('width')}）；` +
        'forcing：apply() 漏標 → block/margin 規則仍把它當 icon-link 排除');
    }
  });

  it('小 icon-link（a > img、< 200px）不可被標記 content-img', () => {
    const { env } = setup();
    const icon = env.document.querySelector('a.icon-link > img');
    assert.ok(icon, 'fixture 應有 icon-link 小圖');
    assert.ok(!icon.hasAttribute('data-jread-content-img'),
      '小 icon-link 不可被標記 content-img（維持原 inline icon 行為）');
  });

  it('CSS 必須含 content-img block + 上下對稱 24px margin 規則', () => {
    const { css } = setup();
    const m = css.match(/img\[data-jread-content-img\]\s*\{([^}]*)\}/);
    assert.ok(m, 'CSS 必須含 img[data-jread-content-img] rule');
    const body = m[1];
    assert.ok(/display\s*:\s*block\s*!important/.test(body), 'rule 必須含 display: block');
    assert.ok(/margin-top\s*:\s*24px\s*!important/.test(body), 'rule 必須含 margin-top: 24px（解圖文太窄）');
    assert.ok(/margin-bottom\s*:\s*24px\s*!important/.test(body), 'rule 必須含 margin-bottom: 24px');
  });

  it('CSS 必須含 a:has(> img[content-img]) 包裝層 block 規則（圖置中、margin 生效）', () => {
    const { css } = setup();
    assert.ok(/a:has\(>\s*img\[data-jread-content-img\]\)/.test(css),
      'CSS 必須含 a:has(> img[data-jread-content-img]) selector');
  });

  it('自適應 lazy-load：apply 時無尺寸的 a>img 不立即標、load 後補標', () => {
    const { env } = setup();
    const lazy = env.document.querySelector('a.lazy-no-dim > img');
    assert.ok(lazy, 'fixture 應有無尺寸屬性的 lazy a>img');
    // apply 當下 naturalWidth=0、無 width 屬性、rect=0（jsdom）→ 不應被標
    assert.ok(!lazy.hasAttribute('data-jread-content-img'),
      'lazy 圖在 apply 當下尺寸未知、不應被標 content-img');
    // 模擬圖載入：設大尺寸 + dispatch load → load listener 補標
    lazy.setAttribute('width', '608');
    lazy.setAttribute('height', '456');
    lazy.dispatchEvent(new env.window.Event('load'));
    assert.strictEqual(lazy.getAttribute('data-jread-content-img'), '1',
      'lazy 圖載入後 load listener 必須補標 content-img（forcing：自適應 lazy-load）');
  });

  it('restore 後 content-img 標記必須清除', () => {
    const { env, snapshot } = setup();
    env.NS.styler.restore(null, snapshot);
    const marked = env.document.querySelectorAll('[data-jread-content-img]');
    assert.strictEqual(marked.length, 0, 'restore 必須移除所有 data-jread-content-img 標記');
  });
});
