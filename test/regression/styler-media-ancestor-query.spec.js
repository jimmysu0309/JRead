// JRead — styler gallery flex/grid 媒體祖先查找優化（v0.7.144 #13）
//
// Audit：styler.apply 內找「flex/grid 含媒體子的容器」原本 `for (el of articleEl
// .querySelectorAll('*'))` + 對每個後代跑 getComputedStyle。大頁面 500-2000 elements
// + 多次設定變更（每改一次字級都重 apply）= 數百 ms 級 jank。
//
// 修法：先 querySelectorAll('picture, img, figure') 收媒體節點 → 各自往上 walk
// parent 鏈到 articleEl 為止收集祖先 Set → 對 Set 內元素才跑 getComputedStyle。
// 從 O(全 DOM) → O(媒體節點 × 平均深度)；純文字主文 short-circuit 0 次 cs。
//
// 本 spec 是 forcing function：
//   - styler.apply 內必須宣告 mediaAncestors / mediaNodes 變數
//   - 必須先 querySelectorAll('picture, img, figure')
//   - 必須往上 walk parent 收集祖先
//   - 既有 v0.7.93/94 行為不變（substack gallery 修法 spec 已存在）

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const STYLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8'
);

describe('styler gallery flex/grid 媒體祖先查找優化（v0.7.144 #13）', () => {
  it('必須宣告 mediaAncestors Set（候選祖先集合）', () => {
    assert.ok(/mediaAncestors\s*=\s*new\s+Set/.test(STYLER_SRC),
      'styler.js 必須宣告 mediaAncestors = new Set() 累積媒體祖先（從 O(全 DOM) 降到 O(媒體 × 深度)）');
  });

  it('必須先 querySelectorAll(\'picture, img, figure\') 收媒體節點', () => {
    assert.ok(/querySelectorAll\(['"]picture,\s*img,\s*figure['"]\)/.test(STYLER_SRC),
      'styler 必須先 querySelectorAll("picture, img, figure") 拿媒體節點（而非全 articleEl.querySelectorAll("*")）');
  });

  it('媒體節點各自往上 walk parent 鏈累積祖先（while cur !== articleEl）', () => {
    // 找 mediaAncestors.add + parentElement walk 模式
    assert.ok(/mediaAncestors\.add/.test(STYLER_SRC),
      '必須 mediaAncestors.add(cur) 累積祖先');
    assert.ok(/while\s*\([\s\S]{0,80}!==\s*articleEl[\s\S]{0,200}mediaAncestors\.add/.test(STYLER_SRC),
      'parent walk 必須以 articleEl 為終點（while cur !== articleEl）+ 內部 mediaAncestors.add');
    assert.ok(/cur\s*=\s*cur\.parentElement/.test(STYLER_SRC),
      'walk 必須用 cur = cur.parentElement 往上爬');
  });

  it('原本 `articleEl.querySelectorAll(\'*\')` + computedStyle 不可再出現於 styler.apply 內 gallery 區段', () => {
    // gallery 區段（galleryFlex 變數附近）不可有 articleEl.querySelectorAll('*') for-loop
    // v1.6.27：galleryFlex 宣告提升到 apply 開頭（rollback 修法），區段改錨
    // mediaAncestors 掃描起點到第一個 galleryFlex.push
    // T12：mediaAncestors 宣告提升為跨 pass 共享（let），建立點是賦值不是 const
    const match = STYLER_SRC.match(/mediaAncestors\s*=\s*new Set\(\)[\s\S]*?galleryFlex\.push/);
    assert.ok(match, '必須找到 galleryFlex 區段');
    // 在 galleryFlex push 之前不可有 articleEl.querySelectorAll('*') 形式
    assert.ok(!/articleEl\.querySelectorAll\(['"]\*['"]\)/.test(match[0]),
      `styler gallery 區段不可使用 articleEl.querySelectorAll('*') 全樹掃；必須走 mediaAncestors Set。實際區段：\n${match[0].slice(0, 800)}`);
  });
});
