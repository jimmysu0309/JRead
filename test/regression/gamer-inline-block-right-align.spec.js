// JRead — regression spec: reader card display 正規化為 block（v0.7.210）
//
// Forcing function：styler 的 reader card rule（html [data-jread-active="1"]）
// 必須含 `display: block !important`。
//
// Trigger：巴哈姆特哈啦板（forum.gamer.com.tw）section.c-section 是
// text-align:right 的雙欄 layout，主內容 div.c-section__main 為 inline-block。
// reader card 被選中後若保留原站 inline-block，margin:auto 水平置中失效
// （auto margin 對非 block-level 元素算成 0）+ 受父 text-align:right 影響整塊
// 靠右——cage 實測 left=609 (=1329-720)，內容貼右邊界。
//
// jsdom 不算 layout，無法驗「置中」；本 spec 驗注入 CSS 字串含 display:block
// （結構正確層）。視覺置中由 Chrome harness / cage 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'gamer-inline-block-right-align.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

describe('styler — reader card display 正規化為 block（v0.7.210）', () => {
  let document, NS, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'styler']
    });
    document = env.document;
    NS = env.NS;
    const detected = NS.detector.detect();
    assert.ok(detected, 'detector 必須命中巴哈主內容');
    articleEl = detected.el;
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
  });

  it('(a) reader card rule 含 display: block !important', () => {
    const css = document.getElementById('__jread-style').textContent;
    // 抓 html [data-jread-active="1"] { ... } 這條 rule body
    const m = css.match(/html\s*\[data-jread-active="1"\]\s*\{([^}]*)\}/);
    assert.ok(m, 'reader card rule（html [data-jread-active="1"]）必須存在');
    const body = m[1];
    assert.ok(/display\s*:\s*block\s*!important/.test(body),
      'reader card rule 必須含 display: block !important（正規化 inline-block 主內容，' +
      '否則 margin:auto 置中失效靠右）');
  });

  it('(b) reader card rule 同時保留 margin auto 置中', () => {
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/html\s*\[data-jread-active="1"\]\s*\{([^}]*)\}/);
    // v0.7.226：垂直 margin 改 clamp() 響應式收斂——本 spec 只關心水平
    // auto 置中仍在（任意垂直值 + auto + !important）。
    assert.ok(/margin\s*:\s*[^;]*\bauto\s*!important/.test(m[1]),
      'reader card rule 必須保留 margin: <vertical> auto（配合 display:block 才能水平置中）');
  });
});
