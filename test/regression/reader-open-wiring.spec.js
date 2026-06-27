// JRead — 「進入 Reader」開頁接線 + iOS web_accessible_resources（v1.0.23）
//
// (1) 懸浮按鈕長按選單「進入 Reader」→ content 送 OPEN_READER → SW tabs.create
//     reader/reader.html（content 無 tabs 權限，必走 SW）。
// (2) reader/reader.html + reader/article.html 必須列入 web_accessible_resources
//     ——iOS Safari 開出新分頁卻空白的修法（popup.html 在 WAR 可正常開、reader 頁
//     原本不在 WAR）。
//
// 純結構 forcing function：掃 namespace / service-worker source + manifest JSON。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const NS_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'background', 'service-worker.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));

describe('進入 Reader 開頁接線 v1.0.23', () => {
  it('namespace.js 必須定義 MSG.OPEN_READER', () => {
    assert.match(NS_SRC, /OPEN_READER\s*:\s*['"]OPEN_READER['"]/,
      'namespace.js MSG 必須含 OPEN_READER（content → SW 開 reader.html）');
  });

  it('service-worker.js 必須有 OPEN_READER handler → tabs.create reader/reader.html', () => {
    const m = SW_SRC.match(/case 'OPEN_READER':[\s\S]{0,400}?\}/);
    assert.ok(m, '抓不到 OPEN_READER case');
    assert.match(m[0], /tabs\.create\(\s*\{\s*url:\s*browser\.runtime\.getURL\(['"]reader\/reader\.html['"]\)/,
      'OPEN_READER 必須 tabs.create 開 reader/reader.html');
  });

  it('manifest web_accessible_resources 必須含 reader/reader.html + reader/article.html（iOS Safari 空白頁修法）', () => {
    const war = MANIFEST.web_accessible_resources || [];
    const all = war.flatMap((w) => w.resources || []);
    assert.ok(all.includes('reader/reader.html'),
      'reader/reader.html 必須列入 web_accessible_resources（iOS Safari 開擴充頁需要）');
    assert.ok(all.includes('reader/article.html'),
      'reader/article.html 必須列入 web_accessible_resources');
  });
});
