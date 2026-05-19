// JRead — detector.probe() 輕量探測（v0.7.143）
//
// Bug：popup GET_READER_STATE 開啟時呼 detect() 拿 siteMode flag，但 detect()
// 會跑完整 promote / narrow / ensureH1 + 走到 detectByShadowDomFallback **會
// `document.body.appendChild(replica)` 注入 shadow DOM 替身**。光是打開 popup
// 就在 page DOM 注入 article replica（副作用）+ 對 heuristic 站跑完整評分迴圈
// （效能浪費）。
//
// 修法：detector 加 probe()——read-only 輕量版只回 siteMode。skip promote /
// narrow / ensureH1 / shadow replica appendChild。main.js GET_READER_STATE
// handler 改用 probe()。
//
// 本 spec 是 forcing function：
//   - detector 必須 export probe() function
//   - probe 不呼叫 detectByShadowDomFallback（避免 appendChild 替身）
//   - probe 真實呼叫後 document.body.children.length 不變
//   - main.js GET_READER_STATE handler 必須呼 NS.detector.probe() 而非 detect()
//   - probe 在 article-tag fixture 回 siteMode='article'

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'), 'utf8'
);
const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8'
);

describe('detector.probe() — 輕量探測（v0.7.143）', () => {
  it('detector module 必須 export probe()', () => {
    // probe() 是 detector object 的 method，在 source 內以 `probe()` { 開頭
    assert.ok(/probe\(\)\s*\{/.test(DETECTOR_SRC),
      'detector.js 必須宣告 probe() method（輕量版 detect）');
  });

  it('probe() body 不可呼 detectByShadowDomFallback（會 appendChild 替身）', () => {
    // 用 bracket counting 切出 probe body
    const lines = DETECTOR_SRC.split('\n');
    let startLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*probe\(\)\s*\{/.test(lines[i])) {
        startLine = i;
        break;
      }
    }
    assert.notStrictEqual(startLine, -1, '必須找到 probe() 宣告行');
    // 從 startLine 開始計算 brace balance，找對應的 close brace
    let balance = 0;
    let endLine = -1;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      // 排除 comment 行
      const cleaned = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const ch of cleaned) {
        if (ch === '{') balance++;
        else if (ch === '}') {
          balance--;
          if (balance === 0) {
            endLine = i;
            break;
          }
        }
      }
      if (endLine !== -1) break;
    }
    assert.notStrictEqual(endLine, -1, '必須找到 probe() body 結束 }');
    const bodyLines = lines.slice(startLine, endLine + 1);
    // 排除 comment 行（單行 // 與 /* */ 區塊），剩 invocation 行不可含 detectByShadowDomFallback
    const codeLines = bodyLines.filter(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('//')) return false;
      if (trimmed.startsWith('*')) return false;
      if (trimmed.startsWith('/*')) return false;
      return true;
    });
    const codeBody = codeLines.join('\n');
    assert.ok(!/detectByShadowDomFallback\s*\(/.test(codeBody),
      `probe() body 不可呼 detectByShadowDomFallback() —— 該函式會 document.body.appendChild(replica) 注入替身、副作用。實際 invocation 行:\n${codeBody}`);
  });

  it('main.js GET_READER_STATE handler 必須呼 NS.detector.probe()', () => {
    assert.ok(/NS\.detector\.probe\s*\(/.test(MAIN_SRC),
      'main.js 必須呼 NS.detector.probe()（取代原 detect() call）');
  });

  it('main.js GET_READER_STATE handler 區段內不可呼 NS.detector.detect()', () => {
    // 切出 GET_READER_STATE handler 區段
    const match = MAIN_SRC.match(/msg\.type\s*===\s*NS\.MSG\.GET_READER_STATE[\s\S]*?return;\s*\/\/\s*sync/);
    assert.ok(match, '必須能切出 GET_READER_STATE handler 區段');
    assert.ok(!/NS\.detector\.detect\s*\(/.test(match[0]),
      'GET_READER_STATE handler 不可呼 NS.detector.detect() —— 必須走 probe() 輕量版避免 shadow replica appendChild 副作用');
  });
});

describe('detector.probe() — 行為驗證（用 fixture，v0.7.143）', () => {
  const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-title-sibling.html');

  it('probe() 對 article fixture 回 siteMode=article（或非 youtube-cinema/x-thread）', () => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const result = env.window.__JRead.detector.probe();
    assert.ok(result, 'probe() 必須回傳結果物件');
    assert.ok('siteMode' in result, 'probe() 結果必須含 siteMode 欄位');
    // article tag 或 heuristic 命中應回 'article'
    assert.notStrictEqual(result.siteMode, 'youtube-cinema',
      'eet-china fixture 不該被誤判為 youtube-cinema');
    assert.notStrictEqual(result.siteMode, 'x-thread',
      'eet-china fixture 不該被誤判為 x-thread');
  });

  it('probe() 不可在 document.body 注入新元素（副作用驗證）', () => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const before = env.document.body.children.length;
    const beforeHtml = env.document.body.innerHTML.length;
    env.window.__JRead.detector.probe();
    const after = env.document.body.children.length;
    const afterHtml = env.document.body.innerHTML.length;
    assert.strictEqual(after, before,
      `probe() 不可在 body 注入新 child（避免 shadow replica appendChild 副作用）；before=${before}, after=${after}`);
    assert.strictEqual(afterHtml, beforeHtml,
      `probe() 不可改動 body innerHTML（read-only 操作）；前 ${beforeHtml} chars、後 ${afterHtml} chars`);
  });
});
