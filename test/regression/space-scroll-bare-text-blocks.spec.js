// JRead — 焦點段落收裸文字 block 單位（v0.8.11 forum.gamer.com.tw）
//
// Bug：巴哈論壇文章進 reader mode 後，段落焦點指示條（#__jread-focus-bar）跳過
// 兩張圖之間的文字、只在圖與圖之間移動。
//
// 根因：collectBlocks 的 BLOCK_SEL 只收 p/h1-h6/li/blockquote/pre/figure/table。
// 巴哈論壇（BBS / 老站慣例）整篇本文是 display:block 的裸 <div> 直接含文字、不用
// <p>，與圖交錯 → BLOCK_SEL 全漏收 → 焦點單位幾乎只剩圖片，文字被跳過。
// 真實 DOM probe 實證：原本只收到 1 個 BLOCK_SEL block + 32 圖，新邏輯多收 87 個
// 本文段落 div（focus 單位 33 → 120）。
//
// 修法：collectBlocks 增收「block-level 且直接含 >= MIN_TEXT_BLOCK 字文字節點」的
// 元素為焦點單位，guard 確保只收 leaf-most 文字承載層（不含 BLOCK_SEL 後代、不含
// 其他候選、不巢狀於已收 block）。
//
// 本檔訊號層次（CLAUDE.md 工作流原則 3）：
//   驗 —— collectBlocks source 結構（裸文字 block 收集邏輯 + 三道 guard + 常數存在）
//   不驗 —— 真實瀏覽器 layout / 指示條視覺位置（content script 在 isolated world、
//          jsdom 的 getBoundingClientRect 恆 0 無法跑 collectBlocks runtime）；
//          演算法已由 tools 下一次性 probe 對真實 forum.gamer.com.tw DOM 驗證。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const MODULE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'space-scroll.js'), 'utf8');

function extractFnBody(src, fnName) {
  const m = src.match(new RegExp('function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) return null;
  const start = m.index + m[0].length;
  let balance = 1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') balance++;
    else if (src[i] === '}') { balance--; if (balance === 0) return src.slice(start, i); }
  }
  return null;
}

describe('space-scroll v0.8.11 — 焦點段落收裸文字 block（forum.gamer.com.tw）', () => {
  it('MIN_TEXT_BLOCK 常數必須存在', () => {
    assert.ok(/const\s+MIN_TEXT_BLOCK\s*=\s*\d+/.test(MODULE_SRC),
      'space-scroll.js 必須定義 MIN_TEXT_BLOCK 常數');
  });

  it('collectBlocks 必須掃 div/font/section/td 找裸文字承載層', () => {
    const body = extractFnBody(MODULE_SRC, 'collectBlocks');
    assert.ok(body, '必須找到 collectBlocks function body');
    assert.ok(/querySelectorAll\(\s*['"]div,\s*font,\s*section,\s*td['"]\s*\)/.test(body),
      'collectBlocks 必須 querySelectorAll(\'div, font, section, td\')——forcing：漏掉裸文字 block');
  });

  it('collectBlocks 必須以直接 text node 長度 >= MIN_TEXT_BLOCK 判定文字 block', () => {
    const body = extractFnBody(MODULE_SRC, 'collectBlocks');
    // 累計直接 text node 長度
    assert.ok(/nodeType\s*===\s*3/.test(body),
      'collectBlocks 必須檢查直接 text node（nodeType === 3）');
    assert.ok(/<\s*MIN_TEXT_BLOCK/.test(body),
      'collectBlocks 必須用 MIN_TEXT_BLOCK 過濾直接文字長度');
  });

  it('collectBlocks 必須只收 block-level display（排除 inline 行內片段）', () => {
    const body = extractFnBody(MODULE_SRC, 'collectBlocks');
    assert.ok(/getComputedStyle/.test(body),
      'collectBlocks 必須查 computed display');
    assert.ok(/block|list-item|table-cell|flow-root|table/.test(body),
      'collectBlocks 必須限定 block-level display 值');
  });

  it('collectBlocks 必須有三道 guard：不含 BLOCK_SEL / 不含其他候選 / 不巢狀於已收 block', () => {
    const body = extractFnBody(MODULE_SRC, 'collectBlocks');
    assert.ok(/querySelector\(\s*BLOCK_SEL\s*\)/.test(body),
      'guard 1：候選含 BLOCK_SEL 後代（= wrapper）必須跳過');
    assert.ok(/textCandidates\.some\(/.test(body),
      'guard 2：候選含另一個候選（= wrapper、保留 leaf-most）必須跳過');
    assert.ok(/blocks\.some\(/.test(body),
      'guard 3：候選巢狀於已收 block 必須跳過');
  });
});
