// JRead — auto-enable 網域 forcing function（v0.7.155）
//
// 覆蓋四個層次：
// (A) matching helper unit test —— 直接 require domain-match.js，驗 Jimmy 指定
//     的匹配規則 'abc.com' 涵蓋 www.abc.com / 'www.abc.com' 不含 123.abc.com
//     等典型 case + 正規化（scheme / port / path / 大小寫）+ parseList / removeMatching
// (B) options.html / options.js wire-up —— textarea + section 字串 forcing check
// (C) popup.html / popup.js wire-up —— checkbox + helper 引入字串檢查
// (D) content/main.js auto-enter call site —— tryAutoEnableOnLoad 必須在
//     enterReaderMode 流程內呼叫 + 必須帶 silent: true（auto-enter 失敗不該彈
//     錯誤 toast）+ iframe guard（window.top === window.self）

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const DM = require(path.join(ROOT, 'content', 'domain-match.js'));
const OPTIONS_HTML = fs.readFileSync(path.join(ROOT, 'options', 'options.html'), 'utf8');
const OPTIONS_JS   = fs.readFileSync(path.join(ROOT, 'options', 'options.js'), 'utf8');
const POPUP_HTML   = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
const POPUP_JS     = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');
const MAIN_JS      = fs.readFileSync(path.join(ROOT, 'content', 'main.js'), 'utf8');
const MANIFEST     = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
// v0.8.16：options DEFAULTS 改 reference content/settings-defaults.js 單一資料源、
// 不再自帶 literal。正準值由 require shared 提供。
const SHARED       = require(path.join(ROOT, 'content', 'settings-defaults.js'));

describe('(A) matching helper — Jimmy 指定規則', () => {
  it('"abc.com" 命中 abc.com 本身', () => {
    assert.strictEqual(DM.matchHostname('abc.com', ['abc.com']), true);
  });
  it('"abc.com" 命中 www.abc.com（子網域）', () => {
    assert.strictEqual(DM.matchHostname('www.abc.com', ['abc.com']), true);
  });
  it('"abc.com" 命中 foo.bar.abc.com（深層子網域）', () => {
    assert.strictEqual(DM.matchHostname('foo.bar.abc.com', ['abc.com']), true);
  });
  it('"www.abc.com" 命中 www.abc.com 本身', () => {
    assert.strictEqual(DM.matchHostname('www.abc.com', ['www.abc.com']), true);
  });
  it('"www.abc.com" **不**命中 123.abc.com（兄弟子網域）', () => {
    assert.strictEqual(DM.matchHostname('123.abc.com', ['www.abc.com']), false);
  });
  it('"www.abc.com" **不**命中 abc.com（父網域）', () => {
    assert.strictEqual(DM.matchHostname('abc.com', ['www.abc.com']), false);
  });
  it('"abc.com" **不**命中 xabc.com（部分字串）', () => {
    assert.strictEqual(DM.matchHostname('xabc.com', ['abc.com']), false);
  });
  it('"abc.com" **不**命中 abc.com.tw（部分字串 + 後綴）', () => {
    assert.strictEqual(DM.matchHostname('abc.com.tw', ['abc.com']), false);
  });
  it('清單為空 → 永不命中', () => {
    assert.strictEqual(DM.matchHostname('abc.com', []), false);
  });
  it('hostname 為 null / undefined / "" → 不命中', () => {
    assert.strictEqual(DM.matchHostname(null, ['abc.com']), false);
    assert.strictEqual(DM.matchHostname(undefined, ['abc.com']), false);
    assert.strictEqual(DM.matchHostname('', ['abc.com']), false);
  });
  it('大小寫不敏感（hostname & pattern）', () => {
    assert.strictEqual(DM.matchHostname('WWW.ABC.COM', ['abc.com']), true);
    assert.strictEqual(DM.matchHostname('www.abc.com', ['ABC.COM']), true);
  });
  // v0.8.15：public-suffix / 單段 pattern 防 over-match。誤填 'com' 不該 match
  // 整個 .com eTLD；suffix 比對只在 pattern 含至少一個點時啟用。
  it('單段 pattern "com" **不**命中 anything.com（防 public-suffix over-match）', () => {
    assert.strictEqual(DM.matchHostname('anything.com', ['com']), false);
    assert.strictEqual(DM.matchHostname('example.com', ['com']), false);
  });
  it('單段 pattern "io" **不**命中 github.io（防 over-match）', () => {
    assert.strictEqual(DM.matchHostname('github.io', ['io']), false);
  });
  it('單段 pattern 只走 exact match（"localhost" 命中 localhost、不命中 foo.localhost）', () => {
    assert.strictEqual(DM.matchHostname('localhost', ['localhost']), true);
    assert.strictEqual(DM.matchHostname('foo.localhost', ['localhost']), false);
  });
  it('含點的 pattern 仍正常做 suffix（"abc.com" 命中 www.abc.com 不受影響）', () => {
    assert.strictEqual(DM.matchHostname('www.abc.com', ['abc.com']), true);
  });
});

describe('(A) matching helper — normalizeDomain 正規化', () => {
  it('去 scheme（https:// / http:// / ftp://）', () => {
    assert.strictEqual(DM.normalizeDomain('https://abc.com'), 'abc.com');
    assert.strictEqual(DM.normalizeDomain('http://abc.com'), 'abc.com');
    assert.strictEqual(DM.normalizeDomain('ftp://abc.com'), 'abc.com');
  });
  it('去 path / query / hash', () => {
    assert.strictEqual(DM.normalizeDomain('abc.com/foo/bar'), 'abc.com');
    assert.strictEqual(DM.normalizeDomain('abc.com?q=1'), 'abc.com');
    assert.strictEqual(DM.normalizeDomain('abc.com#frag'), 'abc.com');
  });
  it('去 port', () => {
    assert.strictEqual(DM.normalizeDomain('abc.com:8080'), 'abc.com');
  });
  it('去 userinfo（user:pass@）', () => {
    assert.strictEqual(DM.normalizeDomain('user:pass@abc.com'), 'abc.com');
  });
  it('去前後 dot + 前後空白 + 小寫', () => {
    assert.strictEqual(DM.normalizeDomain('  .ABC.COM. '), 'abc.com');
  });
  it('空 / 純空白 → ""', () => {
    assert.strictEqual(DM.normalizeDomain(''), '');
    assert.strictEqual(DM.normalizeDomain('   '), '');
    assert.strictEqual(DM.normalizeDomain(null), '');
    assert.strictEqual(DM.normalizeDomain(undefined), '');
  });
  it('https://www.abc.com/news/123 → www.abc.com（典型使用者貼整段 URL）', () => {
    assert.strictEqual(DM.normalizeDomain('https://www.abc.com/news/123'), 'www.abc.com');
  });
});

describe('(A) matching helper — parseList / serializeList / removeMatching', () => {
  it('parseList：多行 + 逗號分隔皆可、自動 dedupe + 正規化', () => {
    const r = DM.parseList('abc.com\nhttps://www.example.org\nABC.COM, news.foo.com:80');
    assert.deepStrictEqual(r, ['abc.com', 'www.example.org', 'news.foo.com']);
  });
  it('parseList：空白 / 空行被過濾', () => {
    assert.deepStrictEqual(DM.parseList('\n\n  \n'), []);
    assert.deepStrictEqual(DM.parseList(''), []);
    assert.deepStrictEqual(DM.parseList(null), []);
  });
  it('serializeList：每行一個正規化過的網域', () => {
    assert.strictEqual(DM.serializeList(['ABC.com', 'https://x.com/']), 'abc.com\nx.com');
  });
  it('removeMatching：移除清單中所有 match 此 hostname 的 entry（含更寬 pattern）', () => {
    const list = ['abc.com', 'def.com', 'www.abc.com'];
    // hostname=www.abc.com 應同時移除 'abc.com'（涵蓋）+ 'www.abc.com'（精確）
    assert.deepStrictEqual(DM.removeMatching('www.abc.com', list), ['def.com']);
  });
  it('removeMatching：兄弟子網域不影響（123.abc.com 不會掃掉 www.abc.com）', () => {
    const list = ['www.abc.com'];
    assert.deepStrictEqual(DM.removeMatching('123.abc.com', list), ['www.abc.com']);
  });
  it('removeMatching：與 matchHostname 同規則，單段 pattern 只 exact（"com" 不被 example.com 掃掉）', () => {
    const list = ['com', 'example.com'];
    // hostname=example.com 只該移除精確的 'example.com'，'com' 因不含點不做 suffix
    assert.deepStrictEqual(DM.removeMatching('example.com', list), ['com']);
  });
});

describe('(B) options.html / options.js wire-up', () => {
  it('options.html 含「自動啟動網域」.section-heading', () => {
    assert.match(OPTIONS_HTML,
      /<h2[^>]*class="section-heading"[^>]*>\s*自動啟動網域\s*<\/h2>/,
      'options.html 缺「自動啟動網域」.section-heading');
  });
  it('options.html 含 textarea#autoEnableDomains', () => {
    assert.match(OPTIONS_HTML, /<textarea[^>]*id="autoEnableDomains"/,
      'options.html 缺 textarea#autoEnableDomains');
  });
  it('options.html 描述段明確說明 "abc.com" 涵蓋 "www.abc.com"（規則文件化）', () => {
    assert.match(OPTIONS_HTML, /abc\.com/,
      'options.html 描述段必須舉 abc.com 為例（讓使用者一眼理解 matching 規則）');
    assert.match(OPTIONS_HTML, /www\.abc\.com/,
      'options.html 描述段必須含 www.abc.com（顯示涵蓋規則）');
  });
  it('options.html 引入 ../content/domain-match.js（parseList / serializeList 需用）', () => {
    assert.match(OPTIONS_HTML, /<script[^>]*src="\.\.\/content\/domain-match\.js"/,
      'options.html 必須在 options.js 之前引入 domain-match.js');
  });
  it('options.js DEFAULTS（reference shared）生效 autoEnableDomains === []', () => {
    // v0.8.16：options DEFAULTS 改 reference window.__JReadSettingsDefaults；
    // 正準值驗 shared 物件（options 生效值即此值）。
    assert.match(OPTIONS_JS, /const DEFAULTS = window\.__JReadSettingsDefaults\b/,
      'options.js DEFAULTS 必須取自 window.__JReadSettingsDefaults（單一資料源）');
    assert.deepStrictEqual(SHARED.autoEnableDomains, [],
      'shared DEFAULTS.autoEnableDomains 必須 === []');
  });
  it('options.js textarea change handler 走 browser.storage.sync.set', () => {
    // 確保 textarea 變動會寫回 sync.autoEnableDomains（不是只在 textarea 暫存）
    assert.match(OPTIONS_JS, /autoEnableDomains[\s\S]{0,200}?addEventListener\(['"]change['"]/,
      'options.js 必須對 #autoEnableDomains 綁 change listener');
    assert.match(OPTIONS_JS, /browser\.storage\.sync\.set\(\s*\{\s*autoEnableDomains/,
      'options.js change handler 必須 browser.storage.sync.set({ autoEnableDomains: ... })');
  });
});

describe('(C) popup.html / popup.js wire-up', () => {
  it('popup.html 含 #auto-domain-row + checkbox#auto-domain-cb', () => {
    assert.match(POPUP_HTML, /id="auto-domain-row"/, 'popup.html 缺 #auto-domain-row');
    assert.match(POPUP_HTML, /id="auto-domain-cb"[^>]*type="checkbox"|type="checkbox"[^>]*id="auto-domain-cb"/,
      'popup.html 缺 input#auto-domain-cb 為 checkbox');
  });
  it('popup.html 含 hostname 顯示 span#auto-domain-host', () => {
    assert.match(POPUP_HTML, /id="auto-domain-host"/,
      'popup.html 缺 #auto-domain-host span（顯示目前 hostname 給使用者確認）');
  });
  it('popup.html 引入 ../content/domain-match.js', () => {
    assert.match(POPUP_HTML, /<script[^>]*src="\.\.\/content\/domain-match\.js"/,
      'popup.html 必須在 popup.js 之前引入 domain-match.js');
  });
  it('popup.js DEFAULT_SETTINGS 含 autoEnableDomains: []', () => {
    assert.match(POPUP_JS, /autoEnableDomains:\s*\[\]/,
      'popup.js DEFAULT_SETTINGS 必須含 autoEnableDomains');
  });
  it('popup.js checkbox change handler 呼叫 helper（matchHostname / removeMatching）', () => {
    assert.match(POPUP_JS, /autoDomainCb\.addEventListener\(['"]change['"]/,
      'popup.js 必須對 #auto-domain-cb 綁 change listener');
    assert.match(POPUP_JS, /removeMatching/,
      'popup.js toggle off 必須走 removeMatching（清掉所有 match 此 hostname 的 entry）');
  });
  it('popup.js 只處理 http / https（chrome:// / file:// 等不顯示 row）', () => {
    assert.match(POPUP_JS, /protocol\s*!==\s*['"]http:['"]\s*&&\s*[^)]*protocol\s*!==\s*['"]https:['"]/,
      'popup.js 必須只認 http / https，其他 scheme row 隱藏');
  });
});

describe('(D) content/main.js auto-enter wire-up', () => {
  it('main.js 含 tryAutoEnableOnLoad IIFE', () => {
    assert.match(MAIN_JS, /tryAutoEnableOnLoad/,
      'main.js 必須含 tryAutoEnableOnLoad 啟動掛鉤');
  });
  it('main.js 呼叫 __JReadDomainMatch.matchHostname(location.hostname, ...)', () => {
    assert.match(MAIN_JS, /__JReadDomainMatch/,
      'main.js 必須引用 __JReadDomainMatch helper');
    assert.match(MAIN_JS, /matchHostname\s*\(\s*location\.hostname/,
      'main.js 必須用 location.hostname 比對');
  });
  it('main.js auto-enter 帶 silent: true（失敗不彈 toast）', () => {
    assert.match(MAIN_JS, /enterReaderMode\s*\(\s*\{\s*silent:\s*true/,
      'main.js auto-enter 呼叫必須帶 { silent: true }，避免偵測失敗時彈擾人 toast');
  });
  it('main.js 走 iframe guard（window.top === window.self）', () => {
    assert.match(MAIN_JS, /window\.top\s*!==\s*window\.self/,
      'main.js auto-enter 必須跳過 iframe（避免 iframe 內 hostname 命中時誤觸發）');
  });
  it('main.js enterReaderModeImpl 接受 opts.silent 參數', () => {
    assert.match(MAIN_JS, /const silent\s*=\s*!!\(opts && opts\.silent\)/,
      'main.js enterReaderModeImpl 必須接 opts.silent 參數');
    // silent=true 時不彈「此頁無法偵測主文」toast
    assert.match(MAIN_JS, /if\s*\(\s*!silent\s*\)\s*showToast/,
      'main.js 必須用 !silent guard 包住偵測失敗 toast');
  });
});

describe('(D) manifest content_scripts 載入順序', () => {
  it('content_scripts 必須含 content/domain-match.js', () => {
    const cs = MANIFEST.content_scripts && MANIFEST.content_scripts[0];
    assert.ok(cs && Array.isArray(cs.js), 'manifest 缺 content_scripts[0].js');
    assert.ok(cs.js.includes('content/domain-match.js'),
      'manifest content_scripts.js 必須含 content/domain-match.js');
  });
  it('content/domain-match.js 必須在 content/main.js 之前載入', () => {
    const js = MANIFEST.content_scripts[0].js;
    const i = js.indexOf('content/domain-match.js');
    const j = js.indexOf('content/main.js');
    assert.ok(i >= 0 && j >= 0, '兩個檔案都必須在 content_scripts.js 內');
    assert.ok(i < j,
      'domain-match.js 必須在 main.js 之前載入，否則 main.js tryAutoEnableOnLoad 拿不到 __JReadDomainMatch');
  });
});
