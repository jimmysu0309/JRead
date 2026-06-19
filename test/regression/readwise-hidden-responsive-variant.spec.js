// JRead — regression spec: Readwise 匯出移除 reader 內 display:none 子樹（v0.8.127）
//
// Trigger: Jimmy 2026-06-19 單語模式翻譯 theverge.com PopSockets 回報——送到 Readwise
// 後 dek 出現中英重複（"Low-Pro 在收合時..." + "The Low-Pro is about as thick as two
// stacked dimes when collapsed."）+ 隱藏 byline（作者 + 日期）殘留。
//
// 根因（cage 真實 reader DOM probe）：The Verge lede 用響應式重複版本把標題 / dek /
// byline 各渲染桌機 + 手機兩份、用 media query 顯示其一。reader 內非當前斷點那份是
// display:none、使用者看不到，但 buildCleanHtml 的 outerHTML 仍序列化它 → Readwise
// 無原站 CSS、把隱藏份也 render 出來。單語翻譯時 Shinkansen 只就地譯到可見份（中文）、
// 隱藏份留原文（英文）→ Readwise 同段中英重複。實測該頁 reader 內 10+ 個含文字的
// display:none 子樹。
//
// 修法（NS.stripHiddenForExport，結構通則、非站點/class 特判）：reader 顯示 display:none
// 的子樹 = 使用者不可見 = 不送 Readwise。標記 live（clone 無 layout 量不到 computed
// display）→ clone 後由共用 data-jread-rw-strip 移除 → 還原 live。排除 noscript/script/
// style。真實 Chrome 端到端（mark→clone→remove 後 English dek + 作者 移除、中文保留）
// 在 cage 上模擬驗過。本 spec 驗 NS 純函式（jsdom，inline display:none）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-hidden-responsive-variant.html');

function setup() {
  return loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: [],
    pretendToBeVisual: true
  });
}

describe('readwise — 移除 display:none 子樹（v0.8.127）', () => {
  it('NS.stripHiddenForExport 存在', () => {
    const { NS } = setup();
    assert.strictEqual(typeof NS.stripHiddenForExport, 'function');
  });

  it('display:none 的隱藏 dek 變體被標記', () => {
    const { document, NS } = setup();
    const marked = NS.stripHiddenForExport(document.getElementById('story'));
    assert.ok(document.getElementById('dek-hidden-wrap').hasAttribute('data-jread-rw-strip'),
      '隱藏 dek wrapper（display:none）必須被標記');
    assert.ok(marked.includes(document.getElementById('dek-hidden-wrap')));
  });

  it('display:none 的隱藏 byline（作者 + 日期）被標記', () => {
    const { document, NS } = setup();
    NS.stripHiddenForExport(document.getElementById('story'));
    assert.ok(document.getElementById('byline-hidden').hasAttribute('data-jread-rw-strip'),
      '隱藏 byline（display:none）必須被標記');
  });

  it('可見內容（中文 dek、內文段落）不被標記', () => {
    const { document, NS } = setup();
    NS.stripHiddenForExport(document.getElementById('story'));
    assert.ok(!document.getElementById('dek-visible').hasAttribute('data-jread-rw-strip'), '可見中文 dek 保留');
    assert.ok(!document.getElementById('body1').hasAttribute('data-jread-rw-strip'), '可見內文 body1 保留');
    assert.ok(!document.getElementById('body2').hasAttribute('data-jread-rw-strip'), '可見內文 body2 保留');
  });

  it('整棵 display:none 子樹標記在最上層、不重複標記子孫', () => {
    const { document, NS } = setup();
    const marked = NS.stripHiddenForExport(document.getElementById('story'));
    // 只標 wrapper / byline 兩個 top-level display:none、不標其內 p/span/time
    assert.ok(!document.getElementById('dek-hidden').hasAttribute('data-jread-rw-strip'),
      '隱藏子樹內的 p 不需單獨標記（整棵隨 wrapper 移除）');
    assert.ok(!document.getElementById('pub-time').hasAttribute('data-jread-rw-strip'));
    assert.strictEqual(marked.length, 2, '只標兩個 top-level display:none 子樹');
  });

  it('clone 移除標記節點後：英文 dek + 作者 byline 消失、中文 dek + 內文保留', () => {
    const { document, NS } = setup();
    const story = document.getElementById('story');
    const marked = NS.stripHiddenForExport(story);
    const clone = story.cloneNode(true);
    clone.querySelectorAll('[data-jread-rw-strip="1"]').forEach(n => n.remove());
    marked.forEach(el => el.removeAttribute('data-jread-rw-strip'));
    const txt = clone.textContent;
    assert.ok(!/two stacked dimes/.test(txt), '英文 dek 變體必須消失');
    assert.ok(!/作者/.test(txt), '隱藏 byline 作者必須消失');
    assert.ok(/兩枚 10 分錢/.test(txt), '可見中文 dek 保留');
    assert.ok(/thinnest MagSafe grip/.test(txt), '可見內文保留');
    // live DOM 還原（不影響閱讀模式顯示）
    assert.ok(!document.getElementById('dek-hidden-wrap').hasAttribute('data-jread-rw-strip'),
      'restore：live 標記必須還原');
  });

  it('無 display:none 內容時 no-op', () => {
    const { document, NS } = setup();
    const plain = document.createElement('div');
    plain.innerHTML = '<p>All visible content.</p>';
    document.body.appendChild(plain);
    const marked = NS.stripHiddenForExport(plain);
    assert.strictEqual(marked.length, 0);
  });
});
