// JRead — 「標題去站名尾綴」單一資料源（v0.8.37）
//
// 原本全 codebase 6 份實作、分隔符集合各不相同（detector ×2：`/\s+[–—|]\s+/`
// 不含 -、·；main Readwise：`/\s+[|\-——–·]\s+/` 不含 ｜；cleaner ×3：
// `/[|｜\-—–]/` 無空白要求——「COVID-19 疫情」會被切成「COVID」）。
// 「Title - Site」某些 path 切得掉、某些切不掉，修分隔 bug 要改六處。
//
// 修法：收斂到 NS.stripSiteSuffix（namespace.js）。語意：
//   - 半形分隔符（| - — – ·）必須前後有空白才切（保護連字號複合詞）
//   - 全形 ｜ 不要求空白（中文站慣例「標題｜站名」常不加空白）
//
// 本 spec：(1) helper 行為功能測試（純函式抽出 eval）；(2) forcing——
// detector / cleaner / main 不得再各自手寫 title 分隔 split。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JREAD_DIR } = require('../helpers');

const NAMESPACE_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'namespace.js'), 'utf8');

describe('NS.stripSiteSuffix — 行為（v0.8.37）', () => {
  const m = NAMESPACE_SRC.match(/stripSiteSuffix\(title\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(m, 'namespace.js 必須有 stripSiteSuffix');
  // eslint-disable-next-line no-eval
  const stripSiteSuffix = eval('(function ' + m[0] + ')');

  it('半形分隔符要求前後空白', () => {
    assert.strictEqual(stripSiteSuffix('文章標題 | 中央社 CNA'), '文章標題');
    assert.strictEqual(stripSiteSuffix('文章標題 - 風傳媒'), '文章標題');
    assert.strictEqual(stripSiteSuffix('文章標題 — The Verge'), '文章標題');
    assert.strictEqual(stripSiteSuffix('文章標題 · Site'), '文章標題');
  });

  it('連字號複合詞不被誤切（舊 cleaner 版會把 COVID-19 切成 COVID）', () => {
    assert.strictEqual(stripSiteSuffix('COVID-19 疫情最新進展'), 'COVID-19 疫情最新進展');
    assert.strictEqual(stripSiteSuffix('e-mail 安全指南'), 'e-mail 安全指南');
  });

  it('全形 ｜ 不要求空白（中文站慣例）', () => {
    assert.strictEqual(stripSiteSuffix('文章標題｜風傳媒'), '文章標題');
  });

  it('無分隔符 / 空值回傳 trim 後原值', () => {
    assert.strictEqual(stripSiteSuffix('  純標題  '), '純標題');
    assert.strictEqual(stripSiteSuffix(''), '');
    assert.strictEqual(stripSiteSuffix(null), '');
  });
});

describe('stripSiteSuffix — 單一資料源 forcing（不得再各自手寫 split）', () => {
  it('detector / cleaner / main 的 document.title / og 切站名一律走 NS.stripSiteSuffix', () => {
    for (const file of ['content/detector.js', 'content/cleaner.js', 'content/main.js']) {
      const src = fs.readFileSync(path.join(JREAD_DIR, file), 'utf8')
        .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      // 舊實作的特徵 regex：split 引數含站名分隔符家族（| ｜ — – ·）
      const handRolled = src.match(/\.split\(\/[^/]*[｜—–·][^/]*\/\)/g) || [];
      assert.deepStrictEqual(handRolled, [],
        `${file} 不得手寫 title 分隔 split（${handRolled.join(' / ')}）——一律走 NS.stripSiteSuffix`);
    }
  });

  it('三個檔案都實際使用 NS.stripSiteSuffix', () => {
    for (const file of ['content/detector.js', 'content/cleaner.js', 'content/main.js']) {
      const src = fs.readFileSync(path.join(JREAD_DIR, file), 'utf8');
      assert.ok(/NS\.stripSiteSuffix\(/.test(src), `${file} 必須使用 NS.stripSiteSuffix`);
    }
  });
});
