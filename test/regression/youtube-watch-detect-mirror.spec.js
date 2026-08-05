// v1.7.43 T10：isYouTubeWatch 三方鏡像 forcing spec
// -----------------------------------------------------------------------------
// YouTube /watch 頁判定有三份刻意獨立的拷貝（不抽共用的理由見 cinema-mode.js
// isYouTubeWatch 上方註解）：
//   1. cinema-mode.js isYouTubeWatch
//   2. youtube-borderless.js isYouTubeWatch
//   3. floating-icon.js isYouTubeWatchPage 的 URL fallback（NS.cinema 未載入時）
// v1.7.38 盤點發現鏡像註解只互指兩處、第三處漏標。本 spec 把「三處判定必須
// 同步」從口頭約束變 forcing function：抽出各份的 hostname regex 與 pathname
// 比對字面，逐字一致才過——未來改判定（如排除 music.youtube.com）漏改任一份
// 即 fail。
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../jread/content', p), 'utf8');

// 判定核心兩行的字面：hostname regex + pathname 等式
const HOSTNAME_RE = /if \(!\/(\S+)\/\.test\(u\.hostname\)\) return false;\s*\n\s*return u\.pathname === '([^']+)';/;

function extractPredicate(src, label) {
  const m = src.match(HOSTNAME_RE);
  assert.ok(m, `${label} 必須含「hostname regex + pathname」判定兩行`);
  return { hostRe: m[1], pathname: m[2] };
}

describe('isYouTubeWatch 三方鏡像（T10）', () => {
  it('cinema-mode / youtube-borderless / floating-icon fallback 判定逐字一致', () => {
    const a = extractPredicate(read('cinema-mode.js'), 'cinema-mode.js');
    const b = extractPredicate(read('youtube-borderless.js'), 'youtube-borderless.js');
    const c = extractPredicate(read('floating-icon.js'), 'floating-icon.js');
    assert.deepStrictEqual(b, a, 'youtube-borderless 與 cinema-mode 判定 drift');
    assert.deepStrictEqual(c, a, 'floating-icon fallback 與 cinema-mode 判定 drift');
  });

  it('三處鏡像註解都標明三方同步義務', () => {
    for (const f of ['cinema-mode.js', 'youtube-borderless.js', 'floating-icon.js']) {
      assert.ok(read(f).includes('三方互為鏡像'), `${f} 缺三方鏡像註解`);
    }
  });
});
