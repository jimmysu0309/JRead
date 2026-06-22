// JRead — extractAuthor / extractPublishedDate 行為 spec（v0.7.167）
//
// content/main.js 包在 IIFE 內、依賴 browser.runtime 訊息傳遞，無法直接
// require。本檔重現等價 helper 並用 jsdom 驗演算法效果——配 readwise-save.spec
// 的 forcing function 雙保:那邊保「實作存在 + 用對 selector」、這邊保
// 「不同 DOM 結構下回傳正確結果」。
//
// 覆蓋:
//   1. extractAuthor 一般站:JSON-LD Article.author.name(string / object /
//      array / @graph)、meta[name=author]、meta[property=article:author]
//      (filter URL)、byline 元素、找不到回空字串
//   2. extractAuthor FB:vanity username from URL(/<user>/posts/...);
//      reserved path(groups/story.php/permalink.php/share)fallback 到
//      reader card 內合成 header displayName
//   3. extractAuthor X / Twitter:URL pathname /<handle>/status/<id> → @handle
//   4. extractPublishedDate:JSON-LD datePublished → meta(各種變體)→
//      <time datetime> fallback;不同格式(純日期 / RFC 2822 / 含時區)正規化
//      為 ISO 8601 UTC

const assert = require('assert');
const { JSDOM } = require('jsdom');

// 等價 helper（與 main.js 同邏輯,jsdom 環境驗證）
function findJsonLdAuthor(data) {
  if (!data) return '';
  if (Array.isArray(data)) {
    for (const item of data) {
      const a = findJsonLdAuthor(item);
      if (a) return a;
    }
    return '';
  }
  if (typeof data !== 'object') return '';
  if (data['@graph']) {
    const a = findJsonLdAuthor(data['@graph']);
    if (a) return a;
  }
  if (data.author) {
    const v = data.author;
    if (typeof v === 'string') return v.trim();
    if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === 'string') {
          const t = x.trim();
          if (t) return t;
        } else if (x && typeof x === 'object' && x.name) {
          const t = String(x.name).trim();
          if (t) return t;
        }
      }
    } else if (typeof v === 'object' && v.name) {
      const t = String(v.name).trim();
      if (t) return t;
    }
  }
  return '';
}

function extractGenericAuthor(doc) {
  const ldNodes = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const node of ldNodes) {
    let data;
    try { data = JSON.parse(node.textContent || ''); }
    catch (_) { continue; }
    const a = findJsonLdAuthor(data);
    if (a) return a;
  }
  const m1 = doc.head && doc.head.querySelector('meta[name="author"]');
  if (m1) {
    const c = (m1.getAttribute('content') || '').trim();
    if (c && c.length < 200) return c;
  }
  const m2 = doc.head && doc.head.querySelector('meta[property="article:author"]');
  if (m2) {
    const c = (m2.getAttribute('content') || '').trim();
    if (c && c.length < 200 && !/^https?:\/\//i.test(c)) return c;
  }
  const sels = [
    '[itemprop="author"] [itemprop="name"]',
    '[itemprop="author"]',
    '[rel="author"]',
    '.byline-author',
    '.author-name',
    '.byline .author',
    '.byline'
  ];
  for (const sel of sels) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t && t.length < 100) return t;
  }
  // v0.8.73：og:site_name「刊物名 by 作者」尾段 fallback
  const fromSite = extractAuthorFromSiteName(doc);
  if (fromSite) return fromSite;
  return '';
}

// v0.8.73：與 main.js extractAuthorFromSiteName 等價 helper
function extractAuthorFromSiteName(doc) {
  const m = doc.head && doc.head.querySelector('meta[property="og:site_name"]');
  if (!m) return '';
  const site = (m.getAttribute('content') || '').replace(/\s+/g, ' ').trim();
  if (!site) return '';
  const match = site.match(/(?:^|\s)by\s+(.+?)\s*$/i);
  if (!match) return '';
  const name = match[1].trim();
  if (name.length < 2 || name.length > 60) return '';
  if (/[\/@]|https?:/i.test(name)) return '';
  if (!/[A-Za-z一-鿿]/.test(name)) return '';
  return name;
}

function extractXAuthorHandle(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    if (host !== 'x.com' && host !== 'twitter.com') return '';
    const m = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/\d+/);
    if (!m) return '';
    return '@' + m[1];
  } catch (_) {
    return '';
  }
}

function findJsonLdDate(data) {
  if (!data) return '';
  if (Array.isArray(data)) {
    for (const item of data) {
      const d = findJsonLdDate(item);
      if (d) return d;
    }
    return '';
  }
  if (typeof data !== 'object') return '';
  if (data['@graph']) {
    const d = findJsonLdDate(data['@graph']);
    if (d) return d;
  }
  if (typeof data.datePublished === 'string') return data.datePublished;
  if (typeof data.dateCreated === 'string') return data.dateCreated;
  return '';
}

function normalizeIsoDate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toISOString();
}

// v0.7.168: X / Twitter 合成 reader 容器內取主推文 time(最後一個 datetime)。
function extractXPublishedDate(doc) {
  const container = doc.querySelector('[data-jread-x-reader]');
  if (!container) return '';
  const firstArticle = container.querySelector(':scope > article');
  if (!firstArticle) return '';
  const times = firstArticle.querySelectorAll('time[datetime]');
  if (!times.length) return '';
  const last = times[times.length - 1];
  return normalizeIsoDate(last.getAttribute('datetime'));
}

function extractPublishedDate(doc) {
  if (doc.querySelector('[data-jread-fb-reader]')) return '';
  if (doc.querySelector('[data-jread-x-reader]')) return extractXPublishedDate(doc);
  const ldNodes = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const node of ldNodes) {
    let data;
    try { data = JSON.parse(node.textContent || ''); }
    catch (_) { continue; }
    const d = findJsonLdDate(data);
    if (d) {
      const iso = normalizeIsoDate(d);
      if (iso) return iso;
    }
  }
  const metaSels = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[name="DC.date"]',
    'meta[name="DC.date.issued"]',
    'meta[itemprop="datePublished"]'
  ];
  for (const sel of metaSels) {
    const m = doc.head && doc.head.querySelector(sel);
    if (!m) continue;
    const iso = normalizeIsoDate(m.getAttribute('content'));
    if (iso) return iso;
  }
  const times = doc.querySelectorAll('time[datetime]');
  for (const t of times) {
    const iso = normalizeIsoDate(t.getAttribute('datetime'));
    if (iso) return iso;
  }
  return '';
}

function makeDoc(html, url) {
  const dom = new JSDOM(html, { url: url || 'https://example.com/article' });
  return dom.window.document;
}

describe('extractAuthor — 一般站 JSON-LD', () => {
  it('Article.author.name(object)', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        'headline': 'X',
        'author': { '@type': 'Person', 'name': 'Jane Doe' }
      })}</script>
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Jane Doe');
  });

  it('Article.author(string)', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Article',
        'author': 'Plain Name'
      })}</script>
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Plain Name');
  });

  it('Article.author(array of objects)→ 取第一個', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Article',
        'author': [
          { '@type': 'Person', 'name': 'First Author' },
          { '@type': 'Person', 'name': 'Second Author' }
        ]
      })}</script>
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'First Author');
  });

  it('@graph 內含 Article(BBC / NYT 慣用)', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', 'name': 'Example' },
          { '@type': 'NewsArticle', 'author': { 'name': 'Graph Author' } }
        ]
      })}</script>
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Graph Author');
  });

  it('JSON-LD 內無 author → fallback meta[name=author]', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Article', 'headline': 'X' })}</script>
      <meta name="author" content="Meta Author">
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Meta Author');
  });

  it('JSON-LD 壞掉 → 不 throw,fallback meta', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">{ broken json `+`}</script>
      <meta name="author" content="From Meta">
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'From Meta');
  });
});

describe('extractAuthor — meta tag fallback', () => {
  it('meta[name=author] 純字串', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta name="author" content="John Smith">
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'John Smith');
  });

  it('meta[property=article:author] 不是 URL → 採用', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="article:author" content="Article Author">
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Article Author');
  });

  it('meta[property=article:author] 是 profile URL → 排除,fallback byline', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="article:author" content="https://facebook.com/john">
    </head><body>
      <div class="byline">By Byline Name</div>
    </body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'By Byline Name');
  });
});

describe('extractAuthor — byline 元素 fallback', () => {
  it('[itemprop="author"] [itemprop="name"]', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <span itemprop="author"><span itemprop="name">Schema Author</span></span>
    </body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Schema Author');
  });

  it('[rel="author"]', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <a rel="author" href="/u/abc">Rel Author</a>
    </body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Rel Author');
  });

  it('.byline 含巢狀(textContent merge whitespace)', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <p class="byline">  By   <a>Nested Author</a>  </p>
    </body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'By Nested Author');
  });

  it('找不到 → 空字串(不誤回 false / undefined)', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body><p>nothing</p></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), '');
  });

  it('byline textLen >= 100 → 拒絕(避免抓到段落)', () => {
    const longText = 'A'.repeat(150);
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <div class="byline">${longText}</div>
    </body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), '');
  });
});

// v0.8.73：og:site_name「刊物名 by 作者」最低優先序 fallback
describe('extractAuthor — og:site_name「X by Y」fallback', () => {
  it('sharptext 實例：Sharp Text by Andrew Sharp → Andrew Sharp', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="Sharp Text by Andrew Sharp" />
    </head><body><p>無任何 byline</p></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Andrew Sharp');
  });

  it('其他 newsletter 慣例：Stratechery by Ben Thompson / Money Stuff by Matt Levine', () => {
    const d1 = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="Stratechery by Ben Thompson" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(d1), 'Ben Thompson');
    const d2 = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="Money Stuff by Matt Levine" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(d2), 'Matt Levine');
  });

  it('中文站名也可：科技隨筆 by 王小明 → 王小明', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="科技隨筆 by 王小明" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), '王小明');
  });

  it('正規 byline 存在時不走 fallback（最低優先序）', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta name="author" content="Real Byline" />
      <meta property="og:site_name" content="Some Site by Wrong Person" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), 'Real Byline');
  });

  it('og:site_name 無「by」：不誤判（單純刊物名）', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="The New York Times" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), '');
  });

  it('「by」非獨立字（standby / rugby）不命中', () => {
    const d1 = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="Standby" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(d1), '');
    const d2 = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="Rugby" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(d2), '');
  });

  it('作者段含 URL / @ / 斜線：拒絕（排除把網址或 handle 當作者）', () => {
    const d1 = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="Site by https://x.com/foo" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(d1), '');
    const d2 = makeDoc(`<!doctype html><html><head>
      <meta property="og:site_name" content="Site by @handle" />
    </head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(d2), '');
  });

  it('無 og:site_name：回空字串', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body></body></html>`);
    assert.strictEqual(extractGenericAuthor(doc), '');
  });
});

describe('extractXAuthorHandle — URL 抽 @handle', () => {
  it('x.com/<handle>/status/<id> → @handle', () => {
    assert.strictEqual(extractXAuthorHandle('https://x.com/elonmusk/status/123456'), '@elonmusk');
  });

  it('twitter.com/<handle>/status/<id> → @handle', () => {
    assert.strictEqual(extractXAuthorHandle('https://twitter.com/jack/status/20'), '@jack');
  });

  it('www.x.com 子網域 → @handle', () => {
    assert.strictEqual(extractXAuthorHandle('https://www.x.com/user/status/1'), '@user');
  });

  it('x.com/<handle>/status/<id>/photo/1(URL 末段)→ @handle', () => {
    assert.strictEqual(extractXAuthorHandle('https://x.com/u/status/1/photo/1'), '@u');
  });

  it('非 status URL → 空', () => {
    assert.strictEqual(extractXAuthorHandle('https://x.com/explore'), '');
    assert.strictEqual(extractXAuthorHandle('https://x.com/u/'), '');
  });

  it('非 x / twitter 站 → 空(防 hostname 混淆)', () => {
    assert.strictEqual(extractXAuthorHandle('https://fakex.com/u/status/1'), '');
    assert.strictEqual(extractXAuthorHandle('https://example.com/u/status/1'), '');
  });
});

describe('extractPublishedDate — JSON-LD', () => {
  it('Article.datePublished ISO 8601 含時區 → ISO UTC', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'NewsArticle',
        'datePublished': '2026-05-22T10:00:00+08:00'
      })}</script>
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-05-22T02:00:00.000Z');
  });

  it('@graph 內 datePublished', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@graph': [
          { '@type': 'WebSite' },
          { '@type': 'Article', 'datePublished': '2026-01-15T12:00:00Z' }
        ]
      })}</script>
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-01-15T12:00:00.000Z');
  });

  it('dateCreated 作為 datePublished 缺漏時的 fallback', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Article',
        'dateCreated': '2025-12-01T00:00:00Z'
      })}</script>
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2025-12-01T00:00:00.000Z');
  });
});

describe('extractPublishedDate — meta tag fallback', () => {
  it('meta[property=article:published_time](OG)', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="article:published_time" content="2026-03-10T08:30:00Z">
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-03-10T08:30:00.000Z');
  });

  it('meta[name=pubdate]', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta name="pubdate" content="2026-03-10T08:30:00Z">
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-03-10T08:30:00.000Z');
  });

  it('meta[name=date] 純日期 → 補時間 00:00 UTC', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta name="date" content="2026-04-01">
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-04-01T00:00:00.000Z');
  });

  it('meta[name=DC.date.issued]', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta name="DC.date.issued" content="2026-02-14">
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-02-14T00:00:00.000Z');
  });

  it('JSON-LD 優先於 meta', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Article',
        'datePublished': '2025-01-01T00:00:00Z'
      })}</script>
      <meta property="article:published_time" content="2024-01-01T00:00:00Z">
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2025-01-01T00:00:00.000Z');
  });
});

describe('extractPublishedDate — <time> fallback', () => {
  it('<time datetime="..."> 第一個 parseable', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <article>
        <time datetime="2026-05-22T10:00:00+09:00">2026/5/22</time>
      </article>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-05-22T01:00:00.000Z');
  });

  it('<time datetime> 無效 → 跳到下一個', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <time datetime="not-a-date">x</time>
      <time datetime="2026-05-22">ok</time>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-05-22T00:00:00.000Z');
  });

  it('找不到任何日期 → 空字串', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>nothing</body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '');
  });
});

// v0.7.168: X / Twitter 合成 reader 主推文 time 抽取
describe('extractPublishedDate — X / Twitter 合成 reader', () => {
  it('主推文 article 只有 1 個 time(無 quoted tweet)→ 取該 time', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <article data-jread-x-reader="1">
        <article data-testid="tweet">
          <time datetime="2026-05-19T19:56:55.000Z">上午3:56 · 2026年5月20日</time>
        </article>
      </article>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-05-19T19:56:55.000Z');
  });

  it('主推文 article 含 quoted tweet(2 個 time)→ 取最後一個(主推文 timestamp)', () => {
    // 實機 cage probe 場景:@emissionite 主推文引用 2023 年舊推文,article 內
    // 第一個 time 是 quoted tweet 時間、最後一個是主推文 timestamp。
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <article data-jread-x-reader="1">
        <article data-testid="tweet">
          <div data-testid="tweetText">引用了一則舊推</div>
          <time datetime="2023-07-01T01:20:56.000Z">2023年7月1日</time>
          <time datetime="2026-05-19T19:56:55.000Z">上午3:56 · 2026年5月20日</time>
        </article>
      </article>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-05-19T19:56:55.000Z',
      '主推文 timestamp 慣例在 quoted tweet 之後 → 取最後一個 time');
  });

  it('合成容器內第二個 article(reply / sidebar)的 time 不可被取', () => {
    // cage probe 實證:document.querySelectorAll(time)[0] 抓到 @Scott_Wiener
    // reply 而非主推文(@emissionite)——這條 spec 守護「主推文必定是合成
    // 容器內第一個 :scope > article」的契約。
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <article data-jread-x-reader="1">
        <article data-testid="tweet">
          <time datetime="2026-05-19T19:56:55.000Z">main</time>
        </article>
        <article data-testid="tweet">
          <time datetime="2024-01-01T00:00:00.000Z">reply</time>
        </article>
      </article>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2026-05-19T19:56:55.000Z',
      '只能取第一個 article(主推文 clone),其他 article 是 thread 後續推文不算主推文時間');
  });

  it('合成容器內無 article → 空', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <article data-jread-x-reader="1"></article>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '');
  });

  it('合成容器 article 內無 time → 空(不退回 meta / JSON-LD)', () => {
    // X 合成 reader 啟動時,document.head 內 OG meta 不可能是「主推文時間」
    // (X 整站共用同一份 OG metadata,通常是 og:image / og:title 描述,不是
    // 個別推文時間)。若主推文 article 沒 time 就明確不送,避免抓到誤導值。
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="article:published_time" content="2024-01-01T00:00:00Z">
    </head><body>
      <article data-jread-x-reader="1">
        <article data-testid="tweet"><div>沒 time</div></article>
      </article>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '',
      'X 合成 reader 短路後不可回退到 document head meta');
  });

  it('time datetime 無效 → 空', () => {
    const doc = makeDoc(`<!doctype html><html><head></head><body>
      <article data-jread-x-reader="1">
        <article data-testid="tweet">
          <time datetime="not-a-date">x</time>
        </article>
      </article>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '');
  });
});

// v0.7.168: FB 合成 reader DOM 結構性沒絕對日期,明確不送
describe('extractPublishedDate — FB 合成 reader skip', () => {
  it('FB 合成 reader 命中 → 直接回空字串(不抓 document 內任何 fallback)', () => {
    // FB DOM 只有 aria-label="50分鐘前" 相對時間,沒 JSON-LD / meta / <time>;
    // 即便頁面剛好有同站某 meta(理論上不會,但防呆)也不該抓——FB 結構性
    // 沒精確發文時間,Jimmy 2026-05-22 明確選「跳過不送」。
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="article:published_time" content="2024-01-01T00:00:00Z">
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Article', 'datePublished': '2025-01-01T00:00:00Z'
      })}</script>
    </head><body>
      <article data-jread-fb-reader="1">
        <header><strong>作者</strong></header>
        <div>貼文文字</div>
        <time datetime="2026-01-01T00:00:00Z">假 time</time>
      </article>
    </body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '',
      'FB 合成 reader 必須短路回空,不可走任何 fallback');
  });

  it('FB 合成 reader 不在時(只有 marker 缺失)→ 走一般 fallback', () => {
    const doc = makeDoc(`<!doctype html><html><head>
      <meta property="article:published_time" content="2024-01-01T00:00:00Z">
    </head><body></body></html>`);
    assert.strictEqual(extractPublishedDate(doc), '2024-01-01T00:00:00.000Z',
      '沒 FB / X 合成 reader marker 時,extractPublishedDate 應該照舊走一般 fallback');
  });
});
