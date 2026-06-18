// JRead — 編輯模式 block 邊界選取 + hide/restore（v0.8.108）
//
// 演算法 C（real-site probe 驗證：Substack 巢狀 dominant-wrapper + Wikipedia
// 扁平結構都正確）：
//   1. inline-level 正規化到所屬 block——點段落內連結選整段
//   2. tight-wrapper climb——純包裝 wrapper 合併、遇多子實質容器停手
//   3. dominant-wrapper guard——拒絕「字數 ≥ 主文 60% 且子 ≥ 3」的塊，避免直接
//      hover 大容器留白時誤選整篇（probe 抓到演算法 A 爬到 articleEl 直接子的
//      over-select 災難）
//
// 隱藏複用 NS.cleaner.hideElement(el, NS.state.hiddenEls)：inline display:none
// !important + data-jread-hidden；退出閱讀模式時既有 cleaner.restore 一併還原。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'editmode-blocks.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['cleaner', 'editMode'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
  const articleEl = env.document.getElementById('post');
  // enter() 設定 module-scope articleEl / articleLen，_chooseBlock 才有依據
  env.NS.editMode.enter(articleEl, {});
  return env;
}

describe('編輯模式 — block 邊界選取（演算法 C，v0.8.108）', () => {
  let env, doc, NS;
  before(() => { env = setup(); doc = env.document; NS = env.NS; });
  after(() => { if (NS && NS.editMode) NS.editMode.exit(true); });

  const choose = (id) => NS.editMode._chooseBlock(doc.getElementById(id));

  it('點段落內 inline 連結 → 選取整個段落（inline 正規化）', () => {
    assert.strictEqual(choose('link1'), doc.getElementById('para1'),
      'link1 應正規化到所屬 block <p id=para1>，而非只選到連結本身');
  });

  it('點段落 → 該段落，不會 over-select 爬到 dominant wrapper', () => {
    assert.strictEqual(choose('para1'), doc.getElementById('para1'),
      'para1 的 parent 是 dominant wrapper（多子、文字遠長）→ tight-climb 須停手，回 para1');
  });

  it('點單一子 wrapper 鏈內元素 → 爬到最外層純 wrapper', () => {
    assert.strictEqual(choose('promo'), doc.getElementById('wrap1'),
      'promo → wrap2 → wrap1 皆單一子（純包裝）應合併；wrap1 的 parent 是多子 dominant → 停在 wrap1');
  });

  it('點推薦 widget 內的項目 → 選該項目（不 over-select 整塊；v0.8.111 移除 +30 floor）', () => {
    // v0.8.111：移除 cLen+30 絕對 floor 後，rel1(短連結)→ul 的 ratio 50% 不再
    // tight（純 1.3× 下短的相異行各自獨立），停在 rel1 li。整塊 widget 仍可由
    // hover 容器區域選取（見下一條）。動機：restofworld 日期行被 +30 floor 併到
    // 整個 header 的 over-select bug（Jimmy 2026-06-18）。
    assert.strictEqual(choose('rel1'), doc.getElementById('rel1'),
      'rel1 短連結 inline 正規化到所屬 li；li → ul ratio 不足 1.3× → 停在 rel1（該項目）');
  });

  it('hover 推薦 widget 容器區域（ul）→ 仍選整塊（單一子 climb 到 #related）', () => {
    // 使用者 hover widget 自身留白（e.target = ul）時，ul 無直接文字、單一子
    // climb：ul → #related（#related 只含 ul）；#related parent 是多子 dominant
    // → 停在 #related。整塊移除仍可達成、只是改由 hover 容器而非點單一項目。
    assert.strictEqual(choose('related-list'), doc.getElementById('related'),
      'ul 單一子 climb 到 #related（整塊推薦 widget），不被 dominant guard 擋（#related 僅 1 子）');
  });

  it('直接 hover dominant wrapper 自身 → null（dominant guard，不選整篇）', () => {
    assert.strictEqual(choose('dominant'), null,
      'dominant：子 ≥ 3 且字數 ≥ 主文 60% → guard 回 null，避免誤選整篇主文');
  });

  it('article 本身 / 外部元素 → null', () => {
    assert.strictEqual(NS.editMode._chooseBlock(doc.getElementById('post')), null,
      'articleEl 自身不可選');
    assert.strictEqual(NS.editMode._chooseBlock(doc.body), null,
      'articleEl 外的元素不可選');
  });
});

describe('編輯模式 — 短的相異行不 over-select（v0.8.111，restofworld 日期行）', () => {
  let env, doc, NS;
  const ROW_FIXTURE = path.join(__dirname, 'fixtures', 'editmode-row-block.html');
  before(() => {
    env = loadFixtureWithScripts({
      fixturePath: ROW_FIXTURE,
      scripts: ['cleaner', 'editMode'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    doc = env.document; NS = env.NS;
    NS.editMode.enter(doc.getElementById('post'), {});
  });
  after(() => { if (NS && NS.editMode) NS.editMode.exit(true); });
  const choose = (id) => NS.editMode._chooseBlock(doc.getElementById(id));

  it('點日期行 → 選日期行本身（不爬併到含翻譯連結的 meta / 整個 header）', () => {
    // forcing：cLen+30 floor 還在時 dateline(38)→meta(50≤68)→header，dt 一路爬到
    // header；移除 floor 後純 1.3× → meta(50) > 38×1.3 → 停在 dateline。
    assert.strictEqual(choose('dt'), doc.getElementById('dateline'),
      'time「18 MAY 2026」inline 正規化到 dateline；dateline→meta ratio 不足 → 停在 dateline');
  });

  it('點 byline → 選 byline 本身（不與日期 / meta 合併）', () => {
    assert.strictEqual(choose('byline'), doc.getElementById('byline'),
      'byline 與日期是相異短行，不應被併成同一塊');
  });

  it('日期行與 byline 各自獨立成可選 block（markBlocks）', () => {
    assert.strictEqual(doc.getElementById('dateline').getAttribute('data-jread-edit-block'), '1', '日期行須有自己的框');
    assert.strictEqual(doc.getElementById('byline').getAttribute('data-jread-edit-block'), '1', 'byline 須有自己的框');
    assert.ok(!doc.getElementById('header').hasAttribute('data-jread-edit-block'), 'header 整塊不應被標（會 over-select）');
    assert.ok(!doc.getElementById('meta').hasAttribute('data-jread-edit-block'), 'meta 不應被標');
  });
});

describe('編輯模式 — 段落提示 markBlocks（v0.8.109，仿 Shinkansen）', () => {
  let env, doc, NS;
  before(() => {
    env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['cleaner', 'editMode'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    doc = env.document; NS = env.NS;
    NS.editMode.enter(doc.getElementById('post'), {});
  });
  after(() => { if (NS && NS.editMode) NS.editMode.exit(true); });

  it('collectBlocks 以 chooseBlock 把主文切成自然 block 分割（提示範圍 = 可選範圍）', () => {
    const ids = NS.editMode._collectBlocks().map(b => b.id).sort();
    assert.strictEqual(ids.join(','), 'para1,para2,para3,para4,rel1,rel2,wrap1',
      '可選 block = 各段 + 單一子 wrapper 鏈外層 wrap1 + 推薦 widget 各項目 rel1/rel2（v0.8.111 per-item，非整塊）');
  });

  it('進入編輯模式 → 每個可選 block 標 data-jread-edit-block', () => {
    for (const id of ['para1', 'para2', 'para3', 'para4', 'wrap1', 'rel1', 'rel2']) {
      assert.strictEqual(doc.getElementById(id).getAttribute('data-jread-edit-block'), '1',
        `${id} 應被標記為可選 block`);
    }
  });

  it('不可選的元素不標記：dominant wrapper / 已被合併的內層 / article 本身', () => {
    assert.ok(!doc.getElementById('dominant').hasAttribute('data-jread-edit-block'), 'dominant wrapper 不標（over-select guard）');
    assert.ok(!doc.getElementById('promo').hasAttribute('data-jread-edit-block'), 'promo 已合併進 wrap1、不單獨標');
    assert.ok(!doc.getElementById('post').hasAttribute('data-jread-edit-block'), 'article 本身不標');
  });

  it('toolbar host 掛 documentElement（<html>）而非 body——規避 cleaner 動態 observer 隱藏', () => {
    // 閱讀模式中 cleaner 的 dynamic-append observer 監看 body + article 子樹、會把
    // body 下新 append 的元素當動態雜訊 hide。toolbar 掛 body 會被整個藏掉（v0.8.110
    // 修法：改掛 <html>，與 space-scroll 焦點條 / paged 頁碼指示同款規避）。
    const host = doc.getElementById('__jread-editmode-host');
    assert.ok(host, '應建立 toolbar host');
    assert.strictEqual(host.parentNode, doc.documentElement,
      'host 必須掛在 documentElement（<html>）下，不可掛 body（會被 cleaner 動態 observer 藏掉、toolbar 不可見）');
  });

  it('注入提示 stylesheet（虛線外框 + hover 強化）', () => {
    const style = doc.getElementById('__jread-editmode-style');
    assert.ok(style, '應注入 __jread-editmode-style');
    assert.ok(/data-jread-edit-block/.test(style.textContent) && /dashed/.test(style.textContent),
      'stylesheet 須含 [data-jread-edit-block] 虛線外框規則');
    assert.ok(/:hover/.test(style.textContent), 'stylesheet 須含 hover 強化規則');
  });

  it('退出編輯模式 → 清除所有標記 + 移除提示 stylesheet', () => {
    NS.editMode.exit(true);
    assert.strictEqual(doc.querySelectorAll('[data-jread-edit-block]').length, 0, '標記須全清');
    assert.ok(!doc.getElementById('__jread-editmode-style'), '提示 stylesheet 須移除');
  });
});

describe('編輯模式 — hideElement / restore 整合（v0.8.108）', () => {
  let env, doc, NS, articleEl;
  before(() => {
    env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['cleaner', 'editMode'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    doc = env.document; NS = env.NS;
    articleEl = doc.getElementById('post');
  });

  it('hideElement 隱藏元素：inline display:none !important + data-jread-hidden，記錄入清單', () => {
    const arr = [];
    const para1 = doc.getElementById('para1');
    const rec = NS.cleaner.hideElement(para1, arr);
    assert.ok(rec, 'hideElement 應回傳還原記錄');
    assert.strictEqual(para1.style.display, 'none', 'inline display 須為 none');
    assert.strictEqual(para1.style.getPropertyPriority('display'), 'important', 'display 須帶 !important（勝過站點 stylesheet）');
    assert.strictEqual(para1.dataset.jreadHidden, '1', 'data-jread-hidden 標記（buildCleanHtml 送 Readwise 時據此剔除）');
    assert.strictEqual(arr.length, 1, '記錄須 push 進傳入清單（呼叫端傳 NS.state.hiddenEls）');
    assert.strictEqual(arr[0], rec, '回傳值即清單內記錄（供 undo 用）');
  });

  it('已隱藏元素重複 hideElement 回 null（不重複入清單）', () => {
    const arr = [];
    const promo = doc.getElementById('promo');
    NS.cleaner.hideElement(promo, arr);
    const again = NS.cleaner.hideElement(promo, arr);
    assert.strictEqual(again, null, '已 data-jread-hidden 的元素重複呼叫須回 null');
    assert.strictEqual(arr.length, 1, '清單不可重複加同一元素');
  });

  it('cleaner.restore 還原 hideElement 隱藏的元素（單一資料源，編輯模式不自寫還原）', () => {
    const arr = [];
    const rel1 = doc.getElementById('rel1');
    rel1.style.setProperty('display', 'list-item'); // 模擬站點原 inline display
    NS.cleaner.hideElement(rel1, arr);
    assert.strictEqual(rel1.style.display, 'none', 'hide 後為 none');
    NS.cleaner.restore(arr);
    assert.strictEqual(rel1.style.display, 'list-item', '還原回站點原 inline display');
    assert.ok(!rel1.dataset.jreadHidden, 'data-jread-hidden 須清除');
  });
});
