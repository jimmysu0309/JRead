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

describe('reader-article: createBackButton', () => {
  it('產出 #__jread-reader-back 固定箭頭鈕（只箭頭無文字）、aria-label 保留語意、click 觸發回呼', () => {
    const document = freshDoc();
    let clicked = false;
    const btn = ARTICLE.createBackButton(document, () => { clicked = true; }, 'light');
    assert.strictEqual(btn.id, '__jread-reader-back');
    assert.strictEqual(btn.textContent, '←', 'v1.0.25：只留箭頭、不含文字（Jimmy 回報文字干擾閱讀）');
    assert.ok(!/Reader/.test(btn.textContent), '不可再含 Reader 文字');
    assert.strictEqual(btn.getAttribute('aria-label'), '返回 Reader', 'aria-label 保留語意給輔助技術');
    assert.match(btn.style.cssText, /position:\s*fixed/, '必須 fixed 定位');
    assert.match(btn.style.cssText, /z-index:\s*2147483640/, '高 z-index 蓋在版面上');
    btn.click();
    assert.ok(clicked, 'click 必須觸發回呼（回 feed）');
  });

  it('配色融入主題背景：bg 用該主題卡片底色、無白底框影（融入背景，Jimmy 要求）', () => {
    const document = freshDoc();
    // sepia：bg 應為 sepia 卡片色 #eee2cb，不可是白色 / 不可有 border / box-shadow
    const sepia = ARTICLE.createBackButton(document, () => {}, 'sepia');
    assert.match(sepia.style.background, /#eee2cb|238,\s*226,\s*203/i, 'sepia bg 應融入卡片底色');
    assert.ok(!/box-shadow/i.test(sepia.style.cssText), '不可有 box-shadow（會凸出）');
    assert.ok(!/255,\s*255,\s*255|#fff/i.test(sepia.style.background), 'sepia 不可是白底');
    // dark：深色卡片底
    const dark = ARTICLE.createBackButton(document, () => {}, 'dark');
    assert.match(dark.style.background, /#4a494d|74,\s*73,\s*77/i, 'dark bg 應為深色卡片底');
  });

  it('themeButtonColors 對映四主題、預設 light', () => {
    assert.strictEqual(ARTICLE.themeButtonColors('dark').bg, '#4a494d');
    assert.strictEqual(ARTICLE.themeButtonColors('sepia').bg, '#eee2cb');
    assert.strictEqual(ARTICLE.themeButtonColors('gray').bg, '#ededed');
    assert.strictEqual(ARTICLE.themeButtonColors('light').bg, '#ffffff');
    assert.strictEqual(ARTICLE.themeButtonColors(undefined).bg, '#ffffff', '未知主題退 light');
  });

  it('__setTheme 即時更新配色（主題切換時返回鈕跟著變）', () => {
    const document = freshDoc();
    const btn = ARTICLE.createBackButton(document, () => {}, 'light');
    btn.__setTheme('dark');
    assert.match(btn.style.background, /#4a494d|74,\s*73,\s*77/i, '切 dark 後 bg 應更新為深色');
  });

  it('backButtonPosition：窄螢幕貼角(4/4)、寬螢幕對齊卡片往下往右', () => {
    // 窄（手機，卡片滿版 cardLeft≈0）
    assert.deepStrictEqual(ARTICLE.backButtonPosition(0), { top: '4px', left: '4px' });
    assert.deepStrictEqual(ARTICLE.backButtonPosition(20), { top: '4px', left: '4px' }, '<=20 仍算窄');
    // 寬（iPad/桌面，卡片置中、左緣有留白）→ 往下(14)往右(對齊卡片左緣+8)
    assert.deepStrictEqual(ARTICLE.backButtonPosition(190), { top: '14px', left: '198px' });
    const wide = ARTICLE.backButtonPosition(300);
    assert.strictEqual(wide.top, '14px');
    assert.strictEqual(wide.left, '308px');
  });
});

describe('reader-feed: SOURCES（Inbox / Later / JRead 分頁）', () => {
  it('三來源對映正確：new=location new、later=location later、jread=tag jread', () => {
    assert.deepStrictEqual(FEED.SOURCES.new.query, { location: 'new' });
    assert.deepStrictEqual(FEED.SOURCES.later.query, { location: 'later' });
    assert.deepStrictEqual(FEED.SOURCES.jread.query, { tag: 'jread' }, 'JRead 分頁用 tag=jread');
  });
  it('每個來源都有空清單訊息', () => {
    for (const k of ['new', 'later', 'jread']) {
      assert.ok(FEED.SOURCES[k].empty && typeof FEED.SOURCES[k].empty === 'string');
    }
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
