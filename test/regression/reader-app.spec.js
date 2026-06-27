// JRead — Reader feed / article 渲染 + 封存邏輯（v1.0.22）
// reader-feed.js / reader-article.js 的純函式：feed 卡片渲染、樂觀封存（成功移除 /
// 失敗插回原位 + toast）、article 容器組裝 + html_content 清理。
// 真實版型套用 / 即時重套 / 位置記憶由 Playwright harness + 真機驗。

const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const FEED = require(path.join(__dirname, '..', '..', 'jread', 'reader', 'reader-feed.js'));
const ARTICLE = require(path.join(__dirname, '..', '..', 'jread', 'reader', 'reader-article.js'));

function freshDoc() {
  return new JSDOM('<!doctype html><html><body><div class="jr-list"></div></body></html>').window.document;
}

const sampleDocs = [
  { id: 'a1', title: '第一篇', author: 'Ben', site_name: 'Stratechery', word_count: 774, image_url: 'https://x.com/a.jpg' },
  { id: 'a2', title: '第二篇', site_name: 'sspai', word_count: 848 },
  { id: 'a3', title: '第三篇' }
];

describe('reader-feed: formatMeta', () => {
  it('作者 · 來源（不含字數，v1.0.24），空欄略過', () => {
    assert.strictEqual(FEED.formatMeta(sampleDocs[0]), 'Ben　·　Stratechery');
    assert.strictEqual(FEED.formatMeta(sampleDocs[1]), 'sspai');
    assert.strictEqual(FEED.formatMeta(sampleDocs[2]), '');
  });
  it('不顯示字數（word_count 不進 meta）', () => {
    assert.ok(!/字/.test(FEED.formatMeta(sampleDocs[0])), 'meta 不可含字數');
    assert.ok(!/774/.test(FEED.formatMeta(sampleDocs[0])));
  });
});

describe('reader-feed: createCard', () => {
  it('建卡片：連結導到 article.html?id=、含標題 / meta / 封存鈕', () => {
    const document = freshDoc();
    const card = FEED.createCard(sampleDocs[0], document);
    assert.strictEqual(card.getAttribute('data-doc-id'), 'a1');
    const link = card.querySelector('.jr-card-link');
    assert.strictEqual(link.getAttribute('href'), 'article.html?id=a1');
    assert.strictEqual(card.querySelector('.jr-card-title').textContent, '第一篇');
    assert.ok(card.querySelector('.jr-card-meta').textContent.includes('Stratechery'));
    const btn = card.querySelector('.jr-archive');
    assert.ok(btn, '必須有封存鈕');
    assert.strictEqual(btn.getAttribute('data-doc-id'), 'a1');
  });

  it('有 image_url（http）：含縮圖；沒有則無縮圖', () => {
    const document = freshDoc();
    assert.ok(FEED.createCard(sampleDocs[0], document).querySelector('.jr-thumb'), '有圖應有縮圖');
    assert.strictEqual(FEED.createCard(sampleDocs[1], document).querySelector('.jr-thumb'), null, '無圖不應有縮圖');
  });

  it('缺 id：回 null（不建卡片）', () => {
    const document = freshDoc();
    assert.strictEqual(FEED.createCard({ title: 'x' }, document), null);
  });

  it('id 放進 href 時 encode（避免特殊字元破 URL）', () => {
    const document = freshDoc();
    const card = FEED.createCard({ id: 'a/b', title: 't' }, document);
    assert.strictEqual(card.querySelector('.jr-card-link').getAttribute('href'), 'article.html?id=a%2Fb');
  });
});

describe('reader-feed: renderFeed', () => {
  it('渲染 N 張卡片、最多 MAX_ITEMS 篇', () => {
    const document = freshDoc();
    const listEl = document.querySelector('.jr-list');
    const many = Array.from({ length: 15 }, (_, i) => ({ id: 'd' + i, title: 't' + i }));
    const n = FEED.renderFeed(listEl, many, () => {});
    assert.strictEqual(n, FEED.MAX_ITEMS);
    assert.strictEqual(listEl.querySelectorAll('.jr-card').length, FEED.MAX_ITEMS);
  });

  it('封存鈕點擊呼叫 onArchive(card, id)', () => {
    const document = freshDoc();
    const listEl = document.querySelector('.jr-list');
    let got = null;
    FEED.renderFeed(listEl, [sampleDocs[0]], (card, id) => { got = { card, id }; });
    listEl.querySelector('.jr-archive').click();
    assert.ok(got);
    assert.strictEqual(got.id, 'a1');
    assert.strictEqual(got.card.getAttribute('data-doc-id'), 'a1');
  });
});

describe('reader-feed: archiveCard 樂觀封存', () => {
  function setup() {
    const document = freshDoc();
    const listEl = document.querySelector('.jr-list');
    FEED.renderFeed(listEl, sampleDocs, () => {});
    return { document, listEl };
  }

  it('成功：卡片從清單移除、不插回', async () => {
    const { listEl } = setup();
    const card = listEl.querySelector('[data-doc-id="a2"]');
    const r = await FEED.archiveCard(card, 'a2', { archiveFn: async () => ({ ok: true }) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(listEl.querySelector('[data-doc-id="a2"]'), null, '成功封存後卡片應消失');
    assert.strictEqual(listEl.querySelectorAll('.jr-card').length, 2);
  });

  it('失敗：卡片插回「原本位置」+ 觸發 toast', async () => {
    const { listEl } = setup();
    const card = listEl.querySelector('[data-doc-id="a2"]'); // 中間那張
    let toasted = null;
    const r = await FEED.archiveCard(card, 'a2', {
      archiveFn: async () => ({ ok: false, error: 'NETWORK' }),
      toastFn: (msg, kind) => { toasted = { msg, kind }; }
    });
    assert.strictEqual(r.ok, false);
    // 插回原位：順序仍是 a1, a2, a3
    const order = Array.from(listEl.querySelectorAll('.jr-card')).map(c => c.getAttribute('data-doc-id'));
    assert.deepStrictEqual(order, ['a1', 'a2', 'a3'], '失敗必須插回原本中間位置');
    assert.ok(toasted && toasted.kind === 'error', '失敗必須 toast error');
    // 封存鈕還原可用
    assert.strictEqual(card.querySelector('.jr-archive').disabled, false);
  });

  it('archiveFn throw：當失敗處理（插回 + toast）', async () => {
    const { listEl } = setup();
    const card = listEl.querySelector('[data-doc-id="a1"]');
    let toasted = false;
    await FEED.archiveCard(card, 'a1', {
      archiveFn: async () => { throw new Error('boom'); },
      toastFn: () => { toasted = true; }
    });
    assert.ok(listEl.querySelector('[data-doc-id="a1"]'), 'throw 後卡片應插回');
    assert.ok(toasted);
  });

  it('封存到清單空：呼叫 onEmpty', async () => {
    const document = freshDoc();
    const listEl = document.querySelector('.jr-list');
    FEED.renderFeed(listEl, [sampleDocs[0]], () => {});
    let empty = false;
    await FEED.archiveCard(listEl.querySelector('.jr-card'), 'a1', {
      archiveFn: async () => ({ ok: true }),
      onEmpty: () => { empty = true; }
    });
    assert.ok(empty, '最後一張封存後應呼叫 onEmpty');
  });
});

describe('reader-article: sanitizeHtml', () => {
  it('移除 script / style / iframe / noscript，保留主文', () => {
    const document = freshDoc();
    const dirty = '<p>內文</p><script>alert(1)</script><style>x{}</style><iframe src="x"></iframe><noscript>n</noscript><figure><img src="https://x/a.jpg"></figure>';
    const clean = ARTICLE.sanitizeHtml(dirty, document);
    assert.ok(clean.includes('內文'));
    assert.ok(clean.includes('<img'));
    assert.ok(!/<script/i.test(clean), 'script 必須移除');
    assert.ok(!/<style/i.test(clean), 'style 必須移除');
    assert.ok(!/<iframe/i.test(clean), 'iframe 必須移除');
  });
});

describe('reader-article: buildArticleContainer', () => {
  it('組裝 h1 標題 + byline + 清理後主文 body', () => {
    const document = freshDoc();
    const doc = {
      id: 'a1', title: '測試標題', author: 'Ben', site_name: 'Stratechery',
      published_date: '2026-06-25T00:00:00Z',
      html_content: '<p>第一段</p><script>bad()</script><h2>小標</h2><p>第二段</p>'
    };
    const article = ARTICLE.buildArticleContainer(doc, document);
    assert.strictEqual(article.tagName, 'ARTICLE');
    assert.strictEqual(article.getAttribute('data-jread-reader-doc'), 'a1');
    assert.strictEqual(article.querySelector('h1').textContent, '測試標題');
    const byline = article.querySelector('[data-jread-reader-byline]');
    assert.ok(byline && byline.textContent.includes('Ben') && byline.textContent.includes('Stratechery'));
    assert.ok(byline.textContent.includes('2026-06-25'), 'byline 應含格式化日期');
    const body = article.querySelector('[data-jread-reader-body]');
    assert.ok(body.textContent.includes('第一段') && body.textContent.includes('第二段'));
    assert.strictEqual(body.querySelectorAll('h2').length, 1, '主文結構保留');
    assert.strictEqual(body.querySelectorAll('script').length, 0, 'script 必須清掉');
  });

  it('無 title / byline 欄位：不建 h1 / byline，仍有 body', () => {
    const document = freshDoc();
    const article = ARTICLE.buildArticleContainer({ id: 'x', html_content: '<p>內文</p>' }, document);
    assert.strictEqual(article.querySelector('h1'), null);
    assert.strictEqual(article.querySelector('[data-jread-reader-byline]'), null);
    assert.ok(article.querySelector('[data-jread-reader-body]').textContent.includes('內文'));
  });
});

describe('reader-article: createBackButton', () => {
  it('產出 #__jread-reader-back 固定鈕、文字「← Reader」、click 觸發回呼', () => {
    const document = freshDoc();
    let clicked = false;
    const btn = ARTICLE.createBackButton(document, () => { clicked = true; });
    assert.strictEqual(btn.id, '__jread-reader-back');
    assert.ok(/Reader/.test(btn.textContent), '文字應含 Reader');
    assert.match(btn.style.cssText, /position:\s*fixed/, '必須 fixed 定位');
    assert.match(btn.style.cssText, /z-index:\s*2147483640/, '高 z-index 蓋在版面上');
    btn.click();
    assert.ok(clicked, 'click 必須觸發回呼（回 feed）');
  });
});

describe('reader-article: formatDate', () => {
  it('ISO 字串 → YYYY-MM-DD', () => {
    assert.strictEqual(ARTICLE.formatDate('2026-06-25T12:00:00Z'), '2026-06-25');
  });
  it('epoch 秒 / 毫秒 → YYYY-MM-DD', () => {
    assert.strictEqual(ARTICLE.formatDate(1782345600), ARTICLE.formatDate(1782345600 * 1000));
  });
  it('無效輸入 → 空字串', () => {
    assert.strictEqual(ARTICLE.formatDate('not-a-date'), '');
    assert.strictEqual(ARTICLE.formatDate(null), '');
  });
});
