// JRead — 連結延續閱讀模式 forcing function（v1.6.14）
//
// 需求（Jimmy 2026-07-07）：閱讀模式下點文內連結，目標頁（原分頁 / 新分頁）自動進入閱讀模式。
//
// 覆蓋層次（單一資料源在 content/link-follow.js，storage 副作用在 main.js）：
// (A) shouldRecord 決策 —— 只認左 / 中鍵 http(s) 整頁導航；排 SPA 攔截（defaultPrevented）/
//     下載 / 非導航 protocol / 同頁錨點 / alt-click
// (B) normalizeIntentUrl —— 去 hash、去結尾斜線、保留 search（redirect 邊界外的匹配一致性）
// (C) addIntent / pruneList / consumeMatch —— list 去重、過期剪枝、cap、命中消費
// (D) wire-up 字串 forcing —— manifest content_scripts 載入順序、settings-defaults 預設、
//     options 三處綁定、main.js click/auxclick 綁定 + consume 呼叫 + silent
//
// 這條驗「決策 + list 純邏輯 + wire-up 存在」；**不驗**真實 Chrome 的 click→storage.local
// →目標頁載入 timing（那層由 Playwright harness / iOS TestFlight 驗，storage 寫入是否趕在
// 同分頁 unload 前完成無法在 jsdom 重現）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const LF = require(path.join(ROOT, 'content', 'link-follow.js'));
const SHARED = require(path.join(ROOT, 'content', 'settings-defaults.js'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'content', 'main.js'), 'utf8');
const OPTIONS_HTML = fs.readFileSync(path.join(ROOT, 'options', 'options.html'), 'utf8');
const OPTIONS_JS = fs.readFileSync(path.join(ROOT, 'options', 'options.js'), 'utf8');

// shouldRecord 的 info 預設：閱讀模式下左鍵點一個外部文章連結（會被記錄）
function baseInfo(over) {
  return Object.assign({
    button: 0,
    altKey: false,
    defaultPrevented: false,
    href: 'https://site.com/article-b',
    currentHref: 'https://site.com/article-a',
    hasDownload: false
  }, over || {});
}

describe('(A) shouldRecord — 只認左/中鍵 http(s) 整頁導航', () => {
  it('左鍵點外部文章連結 → 記錄，url 為正規化後目標', () => {
    const r = LF.shouldRecord(baseInfo());
    assert.strictEqual(r.record, true);
    assert.strictEqual(r.url, 'https://site.com/article-b');
  });

  it('中鍵（button 1，開新分頁）→ 記錄', () => {
    assert.strictEqual(LF.shouldRecord(baseInfo({ button: 1 })).record, true);
  });

  it('cmd/ctrl 開新分頁（button 0 + 修飾鍵）→ 記錄（修飾鍵不影響、目標頁仍會載入）', () => {
    // shouldRecord 不看 meta/ctrl——新分頁一樣落在目標 URL、由目標頁 content 消費
    assert.strictEqual(LF.shouldRecord(baseInfo({ button: 0 })).record, true);
  });

  it('右鍵（button 2）→ 不記錄', () => {
    assert.strictEqual(LF.shouldRecord(baseInfo({ button: 2 })).record, false);
  });

  it('SPA router 已 preventDefault → 不記錄（交 wasActive 路徑）', () => {
    assert.strictEqual(LF.shouldRecord(baseInfo({ defaultPrevented: true })).record, false);
  });

  it('<a download> → 不記錄（檔案下載非導航）', () => {
    assert.strictEqual(LF.shouldRecord(baseInfo({ hasDownload: true })).record, false);
  });

  it('alt-click（下載慣例）→ 不記錄', () => {
    assert.strictEqual(LF.shouldRecord(baseInfo({ altKey: true })).record, false);
  });

  it('mailto: / tel: / javascript: → 不記錄（非 http(s)）', () => {
    assert.strictEqual(LF.shouldRecord(baseInfo({ href: 'mailto:a@b.com' })).record, false);
    assert.strictEqual(LF.shouldRecord(baseInfo({ href: 'tel:+123' })).record, false);
    assert.strictEqual(LF.shouldRecord(baseInfo({ href: 'javascript:void(0)' })).record, false);
  });

  it('擴充自有頁 chrome-extension:// → 不記錄', () => {
    assert.strictEqual(LF.shouldRecord(baseInfo({ href: 'chrome-extension://abc/reader/reader.html' })).record, false);
  });

  it('同頁錨點（只差 hash）→ 不記錄', () => {
    const r = LF.shouldRecord(baseInfo({
      href: 'https://site.com/article-a#section2',
      currentHref: 'https://site.com/article-a'
    }));
    assert.strictEqual(r.record, false);
  });

  it('無 href / 空 info → 不記錄、不炸', () => {
    assert.strictEqual(LF.shouldRecord(baseInfo({ href: '' })).record, false);
    assert.strictEqual(LF.shouldRecord(null).record, false);
  });
});

describe('(B) normalizeIntentUrl — 去 hash / 結尾斜線、保留 search', () => {
  it('去 fragment', () => {
    assert.strictEqual(LF.normalizeIntentUrl('https://s.com/a#x'), 'https://s.com/a');
  });
  it('去 pathname 結尾多餘斜線', () => {
    assert.strictEqual(LF.normalizeIntentUrl('https://s.com/a/'), 'https://s.com/a');
  });
  it('保留 query string（不同 query = 不同頁）', () => {
    assert.strictEqual(LF.normalizeIntentUrl('https://s.com/a?id=1'), 'https://s.com/a?id=1');
  });
  it('root path 正規化為 /', () => {
    assert.strictEqual(LF.normalizeIntentUrl('https://s.com/'), 'https://s.com/');
    assert.strictEqual(LF.normalizeIntentUrl('https://s.com'), 'https://s.com/');
  });
  it('無法解析 → 回原字串（best-effort，不炸）', () => {
    assert.strictEqual(LF.normalizeIntentUrl('not a url'), 'not a url');
    assert.strictEqual(LF.normalizeIntentUrl(null), '');
  });
});

describe('(C) addIntent / pruneList / consumeMatch', () => {
  const NOW = 1000000;

  it('addIntent 加一筆、consumeMatch 命中並消費', () => {
    let list = LF.addIntent([], 'https://s.com/b', NOW);
    assert.strictEqual(list.length, 1);
    const r = LF.consumeMatch(list, 'https://s.com/b#frag', NOW + 100);
    assert.strictEqual(r.matched, true);
    assert.strictEqual(r.nextList.length, 0, '命中後該 entry 被消費');
  });

  it('未命中的 URL → matched=false、list 不動（僅剪過期）', () => {
    const list = LF.addIntent([], 'https://s.com/b', NOW);
    const r = LF.consumeMatch(list, 'https://s.com/other', NOW + 100);
    assert.strictEqual(r.matched, false);
    assert.strictEqual(r.nextList.length, 1);
  });

  it('過期 intent（> MAX_AGE_MS）→ 不命中、被剪掉', () => {
    const list = LF.addIntent([], 'https://s.com/b', NOW);
    const r = LF.consumeMatch(list, 'https://s.com/b', NOW + LF.MAX_AGE_MS + 1);
    assert.strictEqual(r.matched, false);
    assert.strictEqual(r.nextList.length, 0, '過期 entry 被剪');
  });

  it('addIntent 去重同 url（更新 ts、不重複堆積）', () => {
    let list = LF.addIntent([], 'https://s.com/b', NOW);
    list = LF.addIntent(list, 'https://s.com/b', NOW + 500);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].ts, NOW + 500);
  });

  it('多分頁：兩筆不同 intent 並存、各自命中消費', () => {
    let list = LF.addIntent([], 'https://s.com/b', NOW);
    list = LF.addIntent(list, 'https://s.com/c', NOW);
    assert.strictEqual(list.length, 2);
    const r1 = LF.consumeMatch(list, 'https://s.com/b', NOW + 1);
    assert.strictEqual(r1.matched, true);
    assert.strictEqual(r1.nextList.length, 1, 'c 仍在、只消費 b');
    const r2 = LF.consumeMatch(r1.nextList, 'https://s.com/c', NOW + 1);
    assert.strictEqual(r2.matched, true);
    assert.strictEqual(r2.nextList.length, 0);
  });

  it('addIntent cap 上限 MAX_ENTRIES（防 storage 膨脹）', () => {
    let list = [];
    for (let i = 0; i < LF.MAX_ENTRIES + 5; i++) {
      list = LF.addIntent(list, 'https://s.com/p' + i, NOW + i);
    }
    assert.strictEqual(list.length, LF.MAX_ENTRIES);
    // 保留最新的、丟最舊的
    assert.ok(list.some(e => e.url === 'https://s.com/p' + (LF.MAX_ENTRIES + 4)));
    assert.ok(!list.some(e => e.url === 'https://s.com/p0'));
  });

  it('pruneList 容忍壞 entry（非物件 / 缺欄位）', () => {
    const dirty = [null, { url: 'https://s.com/b', ts: NOW }, { url: 'x' }, 42];
    const clean = LF.pruneList(dirty, NOW + 1);
    assert.strictEqual(clean.length, 1);
    assert.strictEqual(clean[0].url, 'https://s.com/b');
  });
});

describe('(D) wire-up forcing', () => {
  it('manifest content_scripts 載入 link-follow.js，且在 main.js 之前', () => {
    const js = MANIFEST.content_scripts[0].js;
    const iLF = js.indexOf('content/link-follow.js');
    const iMain = js.indexOf('content/main.js');
    assert.ok(iLF !== -1, 'manifest 必須載入 content/link-follow.js');
    assert.ok(iMain !== -1);
    assert.ok(iLF < iMain, 'link-follow.js 必須在 main.js 之前載入');
  });

  it('settings-defaults 預設 linkFollowReader = true', () => {
    assert.strictEqual(SHARED.linkFollowReader, true);
  });

  it('main.js 綁定 click 與 auxclick（中鍵）+ 消費 link intent + silent 進入', () => {
    assert.ok(/addEventListener\('click', onReaderLinkClick/.test(MAIN_JS), 'click 綁定');
    assert.ok(/addEventListener\('auxclick', onReaderLinkClick/.test(MAIN_JS), 'auxclick 綁定（中鍵）');
    assert.ok(/consumeLinkIntentForCurrentRoute/.test(MAIN_JS), 'tryAutoEnableOnLoad 必須消費 link intent');
    assert.ok(/window\.__JReadLinkFollow/.test(MAIN_JS), '必須經 link-follow 模組（單一資料源）');
  });

  it('main.js click handler 只在閱讀模式 active + 設定開時記錄', () => {
    // onReaderLinkClick 首兩行 guard：!NS.state.active / !_linkFollowReader
    assert.ok(/onReaderLinkClick\(e\)\s*{\s*\n\s*if \(!NS\.state\.active\) return;/.test(MAIN_JS));
    assert.ok(/if \(!_linkFollowReader\) return;/.test(MAIN_JS));
  });

  it('options 三處綁定 linkFollowReader（fields / readValue / applyFieldToDom）', () => {
    assert.ok(/'linkFollowReader'/.test(OPTIONS_JS), 'fields / case 需含 linkFollowReader');
    assert.ok(/id="linkFollowReader"/.test(OPTIONS_HTML), 'options.html 需有 checkbox');
  });

  it('options 說明段落句末不留句號（CLAUDE.md 硬規則 7）', () => {
    // 抓 linkFollowReader 那條 desc span，驗收尾非全形/半形句號
    const m = OPTIONS_HTML.match(/id="linkFollowReader"[\s\S]*?<span class="desc">([\s\S]*?)<\/span>/);
    assert.ok(m, '找得到 linkFollowReader 的 desc');
    const text = m[1].trim();
    assert.ok(!/[。.]$/.test(text), 'desc 段末不可是句號：' + text.slice(-12));
  });
});
