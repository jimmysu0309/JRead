// JRead — Reader feed / article 渲染 + 封存邏輯（v1.0.22）
// reader-feed.js / reader-article.js 的純函式：feed 卡片渲染、樂觀封存（成功移除 /
// 失敗插回原位 + toast）、article 容器組裝 + html_content 清理。
// 真實版型套用 / 即時重套 / 位置記憶由 Playwright harness + 真機驗。

const fs = require('fs');
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
  it('建卡片：連結導到 article.html?id=&meta=、含標題 / meta / 封存鈕', () => {
    const document = freshDoc();
    const card = FEED.createCard(sampleDocs[0], document);
    assert.strictEqual(card.getAttribute('data-doc-id'), 'a1');
    const link = card.querySelector('.jr-card-link');
    // v1.6.0：連結帶 meta query param（Instapaper 文章頁靠它補 byline）
    assert.ok(link.getAttribute('href').startsWith('article.html?id=a1&meta='),
      'href 必須是 article.html?id=a1&meta=…');
    assert.strictEqual(card.querySelector('.jr-card-title').textContent, '第一篇');
    assert.ok(card.querySelector('.jr-card-meta').textContent.includes('Stratechery'));
    const btn = card.querySelector('.jr-archive');
    assert.ok(btn, '必須有封存鈕');
    assert.strictEqual(btn.getAttribute('data-doc-id'), 'a1');
  });

  it('meta query param 可解回 title / author / site_name（v1.6.0）', () => {
    const document = freshDoc();
    const card = FEED.createCard(sampleDocs[0], document);
    const href = card.querySelector('.jr-card-link').getAttribute('href');
    const metaEnc = href.split('&meta=')[1];
    const meta = JSON.parse(decodeURIComponent(metaEnc));
    assert.strictEqual(meta.title, '第一篇');
    assert.strictEqual(meta.author, 'Ben');
    assert.strictEqual(meta.site_name, 'Stratechery');
  });

  it('只有 id（無 metadata）不帶 meta param、URL 保持精簡', () => {
    const document = freshDoc();
    const card = FEED.createCard({ id: 'x1' }, document);
    assert.strictEqual(card.querySelector('.jr-card-link').getAttribute('href'), 'article.html?id=x1');
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
    assert.ok(card.querySelector('.jr-card-link').getAttribute('href').startsWith('article.html?id=a%2Fb&meta='),
      'id 需 encode，且帶 meta param');
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

  it('所有圖片標記 loading=eager（退掉懶載，翻頁模式遠欄圖修法）', () => {
    const document = freshDoc();
    const article = ARTICLE.buildArticleContainer({ id: 'x', html_content: '<p>a</p><figure><img src="https://x/1.jpg"></figure><img src="https://x/2.jpg">' }, document);
    const imgs = article.querySelectorAll('img');
    assert.strictEqual(imgs.length, 2);
    for (const im of imgs) assert.strictEqual(im.getAttribute('loading'), 'eager');
  });
});

describe('reader-article: preloadImages（翻頁模式 WebKit 遠欄圖修法）', () => {
  it('對每張圖建 off-DOM Image 並設 src（預載進快取）', () => {
    const document = freshDoc();
    const article = ARTICLE.buildArticleContainer({ id: 'x', html_content: '<img src="https://x/1.jpg"><figure><img src="https://x/2.jpg"></figure><p>t</p><img src="https://x/3.jpg">' }, document);
    const made = [];
    function FakeImage() { this._src = ''; made.push(this); }
    Object.defineProperty(FakeImage.prototype, 'src', { set(v) { this._src = v; }, get() { return this._src; } });
    const n = ARTICLE.preloadImages(article, FakeImage);
    assert.strictEqual(n, 3, '三張圖應預載 3 個 Image');
    assert.deepStrictEqual(made.map(m => m.src), ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg']);
  });

  it('無 ImageCtor / 無 container 安全回 0', () => {
    assert.strictEqual(ARTICLE.preloadImages(null, function () {}), 0);
    const document = freshDoc();
    assert.strictEqual(ARTICLE.preloadImages(document.createElement('div'), null), 0);
  });
});

// v1.5.3：移除文章頁左上角返回箭頭鈕——與「點 JRead 工具列圖示 → 退出閱讀模式」
// 重複（兩者都走 NS.onReaderExit 導回 feed）。退出 hook 保留、箭頭 + 其配色 / 定位
// helper 全數移除。下面鎖住「不得復活」。
describe('reader-article: 返回箭頭已移除（v1.5.3）', () => {
  const ART_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'jread', 'reader', 'reader-article.js'), 'utf8');

  it('createBackButton / themeButtonColors / backButtonPosition 全數移除（不在 api，原始碼也不再宣告）', () => {
    assert.strictEqual(ARTICLE.createBackButton, undefined, 'createBackButton 不該再 export');
    assert.strictEqual(ARTICLE.themeButtonColors, undefined, 'themeButtonColors 不該再 export');
    assert.strictEqual(ARTICLE.backButtonPosition, undefined, 'backButtonPosition 不該再 export');
    assert.doesNotMatch(ART_SRC, /function\s+createBackButton/,
      'reader-article.js 不該再宣告 createBackButton——forcing：返回箭頭復活 = 與 JRead 圖示功能重複');
    assert.doesNotMatch(ART_SRC, /__jread-reader-back/,
      'reader-article.js 不該再出現 #__jread-reader-back id');
  });

  it('退出 hook NS.onReaderExit 仍保留（JRead 圖示 / ESC 退出仍導回 feed）', () => {
    assert.match(ART_SRC, /NS\.onReaderExit\s*=\s*backToFeed/,
      'NS.onReaderExit 必須仍設為 backToFeed——移除的是箭頭、不是退出能力');
    assert.match(ART_SRC, /reader\.html/,
      'backToFeed 必須仍導回 reader.html feed');
  });
});

describe('reader-feed: FEED_TABS（per-service 分頁，v1.6.0）', () => {
  it('readwise：Inbox=location new / Later=location later / JRead=tag jread', () => {
    const tabs = FEED.FEED_TABS.readwise;
    const byId = Object.fromEntries(tabs.map((t) => [t.id, t]));
    assert.deepStrictEqual(byId.new.query, { location: 'new' });
    assert.deepStrictEqual(byId.later.query, { location: 'later' });
    assert.deepStrictEqual(byId.jread.query, { tag: 'jread' }, 'JRead 分頁用 tag=jread');
  });
  it('instapaper：未讀 / 已加星 / 封存 走 folderId', () => {
    const tabs = FEED.FEED_TABS.instapaper;
    const byId = Object.fromEntries(tabs.map((t) => [t.id, t]));
    assert.deepStrictEqual(byId.unread.query, { folderId: 'unread' });
    assert.deepStrictEqual(byId.starred.query, { folderId: 'starred' });
    assert.deepStrictEqual(byId.archive.query, { folderId: 'archive' });
  });
  it('每個分頁都有 label 與空清單訊息', () => {
    for (const svc of ['readwise', 'instapaper']) {
      for (const t of FEED.FEED_TABS[svc]) {
        assert.ok(t.label && typeof t.label === 'string', `${svc}/${t.id} 需 label`);
        assert.ok(t.empty && typeof t.empty === 'string', `${svc}/${t.id} 需空清單訊息`);
      }
    }
  });
});

describe('reader-article: parseMeta（v1.6.0）', () => {
  it('解回 feed 帶入的 meta（encodeURIComponent(JSON)）', () => {
    const enc = encodeURIComponent(JSON.stringify({ title: '標題', author: 'A', source_url: 'https://s.com' }));
    const m = ARTICLE.parseMeta(enc);
    assert.strictEqual(m.title, '標題');
    assert.strictEqual(m.author, 'A');
    assert.strictEqual(m.source_url, 'https://s.com');
  });
  it('空 / 壞值 → null（不炸）', () => {
    assert.strictEqual(ARTICLE.parseMeta(''), null);
    assert.strictEqual(ARTICLE.parseMeta(null), null);
    assert.strictEqual(ARTICLE.parseMeta('%%%not-json'), null);
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

// v1.6.24：sanitizeHtml 硬化——事件屬性與 javascript: URL 也要清。
// article.html 是擴充頁（有 storage 憑證 + fetch 權限），html_content 來自任意
// 網頁經 readability 處理的內容；<img onerror> / <svg onload> / <a href="javascript:">
// 不清的話，安全性完全押在 MV3 預設 CSP 單層（Safari 轉換 / CSP 調整就裸奔）。
describe('reader-article: sanitizeHtml 事件屬性 / javascript: URL（v1.6.24）', () => {
  it('剝除所有 on* 事件屬性', () => {
    const document = freshDoc();
    const dirty = '<p>內文</p><img src="https://x/a.jpg" onerror="alert(1)"><svg onload="alert(2)"><rect onclick="x()"/></svg><div ONMOUSEOVER="y()">t</div>';
    const clean = ARTICLE.sanitizeHtml(dirty, document);
    assert.ok(!/on\w+\s*=/i.test(clean), 'on* 事件屬性必須全部剝除');
    assert.ok(clean.includes('<img'), '內容圖保留');
    assert.ok(clean.includes('內文'));
  });

  it('移除 javascript: 的 href / src（含控制字元繞法），一般連結保留', () => {
    const document = freshDoc();
    const dirty = '<a href="javascript:alert(1)">a</a><a href="java\tscript:alert(2)">b</a><a href="https://example.com/">c</a>';
    const clean = ARTICLE.sanitizeHtml(dirty, document);
    assert.ok(!/javascript:/i.test(clean), 'javascript: URL 必須移除');
    assert.ok(clean.includes('https://example.com/'), '一般 https 連結保留');
  });
});

// v1.6.24：併發封存——相鄰兩張都 in-flight、參照卡片已 detached 時，失敗還原
// 不可 throw（舊版 insertBefore 丟 NotFoundError → 卡片永久消失 + 無 toast）。
describe('reader-feed: archiveCard 併發參照失效（v1.6.24）', () => {
  it('nextSibling 已被移出 DOM 時失敗還原退回 append、不 throw、照樣 toast', async () => {
    const document = freshDoc();
    const listEl = document.querySelector('.jr-list');
    FEED.renderFeed(listEl, sampleDocs, () => {});
    const a1 = listEl.querySelector('[data-doc-id="a1"]');
    const a2 = listEl.querySelector('[data-doc-id="a2"]'); // a1 的 nextSibling
    let resolveA2;
    const a2Pending = new Promise((res) => { resolveA2 = res; });
    // a2 先進 in-flight（把自己移出 DOM、掛著等）
    const p2 = FEED.archiveCard(a2, 'a2', { archiveFn: () => a2Pending });
    let toasted = false;
    // a1 封存失敗——此刻它 captured 的 nextSibling（a2）已 detached
    const r1 = await FEED.archiveCard(a1, 'a1', {
      archiveFn: async () => ({ ok: false, error: 'NETWORK' }),
      toastFn: () => { toasted = true; }
    });
    assert.strictEqual(r1.ok, false);
    assert.ok(listEl.querySelector('[data-doc-id="a1"]'), 'a1 必須還原回清單（不可因參照失效消失）');
    assert.ok(toasted, '失敗必須 toast');
    resolveA2({ ok: true });
    await p2;
  });
});

// v1.6.24：loadList 世代 token——快速切分頁時慢回應晚到不可蓋掉新分頁內容。
// loadList 在 init() closure 內、無法直接單測，驗 source 結構（token 遞增 + 兩個
// callback 都先比對世代）。
describe('reader-feed: loadList 過期回應丟棄（v1.6.24）', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'jread', 'reader', 'reader-feed.js'), 'utf8');
  it('loadList 必須有世代 token 且 resolve/reject 兩側都比對', () => {
    assert.match(SRC, /let\s+loadGen\s*=\s*0/, '缺 loadGen 世代計數');
    assert.match(SRC, /const\s+gen\s*=\s*\+\+loadGen/, 'loadList 開頭必須遞增並 capture 世代');
    const guards = SRC.match(/if\s*\(\s*gen\s*!==\s*loadGen\s*\)\s*return/g) || [];
    assert.ok(guards.length >= 2, 'resolve 與 reject 兩個 callback 都必須丟棄過期回應（找到 ' + guards.length + ' 處）');
  });
});
