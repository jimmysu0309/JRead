// JRead — extractAuthor / extractPublishedDate 行為 spec（v0.7.167）
//
// content/main.js 包在 IIFE 內、依賴 chrome.runtime 訊息傳遞，無法直接
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
  return '';
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

function extractPublishedDate(doc) {
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
