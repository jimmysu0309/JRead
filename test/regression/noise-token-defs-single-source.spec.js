// JRead — NOISE / STRONG keyword 單一 token 名單（v0.8.18 C4）
//
// 對應 code review C4：原本 NOISE_KEYWORD_RE / STRONG_NOISE_KEYWORD_RE 是兩條
// ~1.5K 字元的手寫單行 regex，strong token 全是 noise token 的子集卻靠人工抄
// 第二份維護——一邊加 token 另一邊忘了同步就 drift（v0.7.184 udn related-news
// 殘留即漏抄 strong 的後果）。
//
// 修法：單一 token 名單 NOISE_TOKEN_DEFS（每筆 `{ t, strong? }`），NOISE set 用
// 全部、STRONG set 由 `strong:true` 子集衍生，build-time 用 buildKeywordRe 組。
//
// 本 spec 是 anti-drift 的 forcing function：
//   1. 結構：兩 regex 必須由 buildKeywordRe(NOISE_TOKEN_DEFS...) 衍生，
//      不得各自手寫 literal
//   2. 從 source eval 出 NOISE_TOKEN_DEFS + buildKeywordRe，重建兩 regex，
//      驗 STRONG ⊆ NOISE（結構上不可能 drift）+ 關鍵 token 命中 / 安全負例不誤殺

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8');

describe('cleaner — NOISE/STRONG keyword 單一 token 名單（C4）', () => {
  it('結構：NOISE_TOKEN_DEFS + buildKeywordRe 存在，兩 regex 由其衍生（無手寫 literal）', () => {
    assert.match(SRC, /const\s+NOISE_TOKEN_DEFS\s*=\s*\[/, 'cleaner.js 必須有 NOISE_TOKEN_DEFS token 名單');
    assert.match(SRC, /function\s+buildKeywordRe\s*\(/, 'cleaner.js 必須有 buildKeywordRe');
    assert.match(SRC, /const\s+NOISE_KEYWORD_RE\s*=\s*buildKeywordRe\(/, 'NOISE_KEYWORD_RE 必須由 buildKeywordRe 衍生');
    assert.match(
      SRC,
      /const\s+STRONG_NOISE_KEYWORD_RE\s*=\s*buildKeywordRe\(\s*NOISE_TOKEN_DEFS\.filter\(\s*d\s*=>\s*d\.strong\s*\)/,
      'STRONG_NOISE_KEYWORD_RE 必須從 NOISE_TOKEN_DEFS 的 strong 子集衍生（同源，消 drift）'
    );
    // 不得殘留把整條 keyword alternation 手寫成 literal 指派給這兩個常數
    assert.doesNotMatch(
      SRC,
      /const\s+STRONG_NOISE_KEYWORD_RE\s*=\s*\/\(\^/,
      'STRONG_NOISE_KEYWORD_RE 不得再手寫 regex literal（會與 NOISE drift）'
    );
  });

  // 從 source eval 出 NOISE_TOKEN_DEFS（cleaner.js 是 IIFE 不可直接 require）
  function loadDefs() {
    const start = SRC.indexOf('const NOISE_TOKEN_DEFS = [');
    assert.ok(start >= 0, '找不到 NOISE_TOKEN_DEFS');
    const arrStart = SRC.indexOf('[', start);
    const arrEnd = SRC.indexOf('\n  ];', arrStart);
    assert.ok(arrEnd > arrStart, '找不到 NOISE_TOKEN_DEFS 結尾');
    const literal = SRC.slice(arrStart, arrEnd + 4); // 含 "  ]"
    // eslint-disable-next-line no-eval
    return eval('(' + literal + ')');
  }
  function buildKeywordRe(tokens) {
    return new RegExp('(^|[^a-z0-9])(' + tokens.join('|') + ')([^a-z0-9]|$)', 'i');
  }

  it('STRONG ⊆ NOISE：每個 strong token 都在 noise 名單內（結構上消 drift）', () => {
    const defs = loadDefs();
    const noiseSet = new Set(defs.map(d => d.t));
    const strong = defs.filter(d => d.strong).map(d => d.t);
    assert.ok(strong.length >= 30, `strong token 數應 >= 30，實際 ${strong.length}`);
    for (const t of strong) {
      assert.ok(noiseSet.has(t), `strong token "${t}" 不在 noise 名單——drift`);
    }
  });

  it('行為：關鍵 noise/strong class 命中、安全負例不誤殺', () => {
    const defs = loadDefs();
    const NOISE = buildKeywordRe(defs.map(d => d.t));
    const STRONG = buildKeywordRe(defs.filter(d => d.strong).map(d => d.t));

    // strong 家族（related/more/recommended/sidebar/menu）NOISE + STRONG 都命中
    for (const s of ['related-news', 'more-news', 'recommended-box', 'article-sidebar', 'sidebar-widget', 'menu', 'disqus_thread', 'taboola-below']) {
      assert.ok(NOISE.test(s), `NOISE 應命中 ${s}`);
      assert.ok(STRONG.test(s), `STRONG 應命中 ${s}`);
    }
    // noise-only（命中 NOISE、不在 strong）
    for (const s of ['paywall-banner', 'subscribe-form', 'comment-list']) {
      assert.ok(NOISE.test(s), `NOISE 應命中 ${s}`);
      assert.ok(!STRONG.test(s), `STRONG 不應命中 noise-only ${s}`);
    }
    // 安全負例：主文常見 class 不可誤殺
    for (const s of ['main-content', 'article-body', 'post-title', 'entry-content', 'sharepoint', 'headset', 'foobar']) {
      assert.ok(!NOISE.test(s), `NOISE 不應誤殺 ${s}`);
    }
  });
});
