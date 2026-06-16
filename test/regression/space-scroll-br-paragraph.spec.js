// JRead — 焦點段落切 <br><br> 分段（v0.8.83 paulgraham.com/boss.html）
//
// Bug（Jimmy 2026-06-16 回報）：boss.html 進閱讀模式後，閱讀進度指示條把整篇
// 內文視為一段（Space 無法逐段定位）。
//
// 根因（real DOM probe 實證）：老式 table 排版內容頁整篇主文是「一個 <p>/<font>
// 內用 <br><br> 分段」、沒有逐段 <p>，collectBlocks 的 BLOCK_SEL 與裸文字 block
// 都只收到單一 block → 焦點條把全文視為一段。
//
// 修法：collectBlocks 結尾把「br 容器」（直接 <br> 子數 >= BR_PARA_MIN_BR）切成
// 「每段一虛擬焦點單位」（Range 量 rect、不動 DOM）。虛擬單位以段落起始 text node
// 為 key 快取（brUnitCache），跨 collectBlocks 呼叫維持同一物件參照——advance() 的
// blocks.indexOf(focusedBlock) 才找得到、焦點才能連續推進。內嵌 block 子（blockquote
// / figure）由 splitBrRuns 當段落邊界跳過、各自仍是獨立 BLOCK_SEL 單位。
//
// 本檔訊號層次（CLAUDE.md 工作流原則 3）：
//   驗 —— space-scroll.js source 結構（br 容器判定用直接 br 子數 + splitBrRuns 以
//          BR / BLOCK_SEL 為邊界 + brUnitCache 穩定參照 + expandBrParagraphs 接進
//          collectBlocks）。
//   不驗 —— 真實瀏覽器 layout / 指示條視覺位置 / Range rect（content script 在
//          isolated world、jsdom 的 getBoundingClientRect 與 Range rect 恆 0、無法
//          跑 collectBlocks runtime）；演算法已由 tools 下一次性 probe 對真實
//          boss.html / todo.html / avg.html DOM 驗證（units 1→45 / 1→6 / 1→61）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'space-scroll.js'), 'utf8');

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

describe('space-scroll v0.8.83 — <br><br> 分段焦點單位（paulgraham）', () => {
  it('br 分段常數必須存在', () => {
    assert.ok(/const\s+BR_PARA_MIN_BR\s*=\s*\d+/.test(SRC), '必須定義 BR_PARA_MIN_BR');
    assert.ok(/const\s+BR_PARA_MIN_RUN_TEXT\s*=\s*\d+/.test(SRC), '必須定義 BR_PARA_MIN_RUN_TEXT');
    assert.ok(/const\s+BR_PARA_SKIP_SEL\s*=/.test(SRC), '必須定義 BR_PARA_SKIP_SEL');
  });

  it('br 容器判定用「直接 <br> 子數」（非後代 querySelectorAll，避免祖先冒泡誤判）', () => {
    const body = extractFnBody(SRC, 'isBrParagraphed');
    assert.ok(body, '必須有 isBrParagraphed');
    // 走 brDirectChildCount（直接子計數），不可用 querySelectorAll('br')
    assert.ok(/brDirectChildCount\(/.test(body), 'isBrParagraphed 必須用 brDirectChildCount（直接 br 子數）');
    assert.ok(!/querySelectorAll\(\s*['"]br['"]\s*\)/.test(body),
      'isBrParagraphed 不可用 querySelectorAll(\'br\')——後代 br 冒泡會誤判祖先容器');
    const dc = extractFnBody(SRC, 'brDirectChildCount');
    assert.ok(dc && /nodeType\s*===\s*1\s*&&\s*c\.tagName\s*===\s*['"]BR['"]/.test(dc),
      'brDirectChildCount 必須只數直接子 <br>');
  });

  it('splitBrRuns 以 BR 與內嵌 BLOCK_SEL 為段落邊界、用 Range 建虛擬單位', () => {
    const body = extractFnBody(SRC, 'splitBrRuns');
    assert.ok(body, '必須有 splitBrRuns');
    assert.ok(/tagName\s*===\s*['"]BR['"]/.test(body), '必須以 <br> 為邊界');
    assert.ok(/matches\(BLOCK_SEL\)/.test(body), '必須以內嵌 BLOCK_SEL（blockquote / figure 等）為邊界跳過');
    assert.ok(/createRange\(\)/.test(body) && /setStartBefore/.test(body) && /setEndAfter/.test(body),
      '必須用 Range（setStartBefore / setEndAfter）量段落 rect');
    assert.ok(/INLINE_TEXT_TAGS\.has/.test(body), 'inline 子（a/i/font…）必須下探收文字');
  });

  it('虛擬單位以 startNode 為 key 快取（brUnitCache）維持跨呼叫穩定參照', () => {
    assert.ok(/const\s+brUnitCache\s*=\s*new\s+WeakMap\(\)/.test(SRC), '必須用 WeakMap brUnitCache');
    const body = extractFnBody(SRC, 'makeBrUnit');
    assert.ok(body && /brUnitCache\.get\(startNode\)/.test(body) && /brUnitCache\.set\(startNode/.test(body),
      'makeBrUnit 必須以 startNode 查 / 存快取（advance 的 indexOf 靠穩定參照）');
  });

  it('expandBrParagraphs 接進 collectBlocks 出口、取最外層 br 容器、丟外層 wrapper', () => {
    const collect = extractFnBody(SRC, 'collectBlocks');
    assert.ok(collect && /expandBrParagraphs\(\s*blocks\s*,\s*root\s*\)/.test(collect),
      'collectBlocks 必須回傳 expandBrParagraphs(blocks, root)');
    const body = extractFnBody(SRC, 'expandBrParagraphs');
    assert.ok(body, '必須有 expandBrParagraphs');
    // 巢狀去重：只留最外層 br 容器
    assert.ok(/o\.contains\(c\)/.test(body), '必須巢狀去重（只留最外層 br 容器）');
    // kept 丟掉「包住容器」的舊 block（boss 外層 <p> 含 font）
    assert.ok(/b\.contains\(c\)/.test(body), 'kept 必須丟掉包住 br 容器的外層 block（避免重複焦點單位）');
    // Y 座標排序（虛擬單位無 compareDocumentPosition）
    assert.ok(/getBoundingClientRect\(\)\.top\s*-\s*b\.getBoundingClientRect\(\)\.top/.test(body),
      '必須用 getBoundingClientRect().top 排序（虛擬單位無 compareDocumentPosition）');
  });
});
