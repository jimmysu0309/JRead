// JRead — 焦點指示條單行 block 合併（v1.7.47，Jimmy 2026-08-06 指定行為）
//
// 需求：按空白鍵捲動時，內容只有一行的 block（短標題、單行段落）不獨立當
// 焦點停留點——指示條與下面一段合併成群組、Space 一次跳過整組。
//
// 實作層：呈現/推進層（isOneLineBlock + groupRange + positionBar + advance），
// collectBlocks 結果**不動**——position-memory 共用的段落索引與簽名
// （el.textContent）維持原粒度、儲存的閱讀位置不 drift。
//
// 群組規則：連續單行 block 一律向下依附到第一個非單行 block（terminal）；
// 文末孤懸單行（下面沒東西可依附）自成一組照舊停留；媒體/結構類
// （img / video / figure / table / pre）不參與單行判定。
//
// 本檔訊號層次（CLAUDE.md 工作流原則 3）：
//   驗 —— (a) source 結構（isOneLineBlock / groupRange 存在、advance / positionBar
//          接上群組、collectBlocks 未被改動粒度）；(b) groupRange / isOneLineBlock
//          純邏輯行為（抽出函式 + mock block 物件執行——分組數學不靠 layout）
//   不驗 —— 真實瀏覽器 line-height 量測 / 指示條視覺高度（jsdom 無 layout、
//          getBoundingClientRect 恆 0；由 Playwright harness 截圖補）

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const MODULE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'space-scroll.js'), 'utf8');

// 抓完整 function 宣告（含簽名與 body，brace counting）
function extractFn(src, fnName) {
  const m = src.match(new RegExp('function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) return null;
  const start = m.index + m[0].length;
  let balance = 1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') balance++;
    else if (src[i] === '}') { balance--; if (balance === 0) return src.slice(m.index, i + 1); }
  }
  return null;
}

describe('space-scroll v1.7.47 — 焦點指示條單行 block 合併', () => {

  describe('source 結構', () => {
    it('必須有 isOneLineBlock + groupRange function 與 ONE_LINE 常數', () => {
      assert.ok(extractFn(MODULE_SRC, 'isOneLineBlock'),
        '必須有 isOneLineBlock——forcing：缺判定函式整個合併功能不存在');
      assert.ok(extractFn(MODULE_SRC, 'groupRange'),
        '必須有 groupRange——forcing：缺群組計算，advance / positionBar 無從合併');
      assert.match(MODULE_SRC, /ONE_LINE_MAX_RATIO\s*=\s*1\.6\b/,
        '單行門檻必須 line-height × 1.6（一行 ≈ 1×、兩行 ≈ 2×，取中間值容納 padding 誤差）');
      assert.match(MODULE_SRC, /ONE_LINE_SKIP_SEL\s*=\s*'img, video, figure, table, pre'/,
        '媒體/結構類必須排除在單行判定外——forcing：低矮圖片會被吸進上方標題的群組');
    });

    it('isOneLineBlock 必須以 computed line-height 判定、normal fallback 用 fontSize 估算', () => {
      const body = extractFn(MODULE_SRC, 'isOneLineBlock');
      assert.match(body, /parseFloat\s*\(\s*cs\.lineHeight\s*\)/,
        '必須讀 computed line-height——forcing：用固定 px 門檻會誤判大字級標題（h2 一行就超過）');
      assert.match(body, /parseFloat\s*\(\s*cs\.fontSize\s*\)/,
        "line-height: normal（Chromium 原樣回傳字串）必須以 fontSize 估算 fallback——forcing：parseFloat('normal')=NaN、判定恆 false 功能靜默失效");
      assert.match(body, /__jreadBrUnit/,
        'br 虛擬段落必須以 startNode.parentElement 當樣式宿主——forcing：Range 無 computed style、br 分段文章整個功能失效');
    });

    it('groupRange 必須「向下找 terminal、向上收攏連續單行」', () => {
      const body = extractFn(MODULE_SRC, 'groupRange');
      assert.match(body, /end\s*<\s*blocks\.length\s*-\s*1\s*&&\s*isOneLineBlock\s*\(\s*blocks\[end\]\s*\)/,
        'terminal 掃描必須在清單尾停下——forcing：越界或文末孤懸單行變成 undefined terminal');
      assert.match(body, /start\s*>\s*0\s*&&\s*isOneLineBlock\s*\(\s*blocks\[start\s*-\s*1\]\s*\)/,
        '必須從 terminal 往上收攏連續單行——forcing：從中間成員推進時群組邊界不一致、Shift+Space 往上會漏掉群組內成員');
    });

    it('advance 必須以群組推進（end + 1 / start - 1）、焦點設 terminal、捲動用群組首 block', () => {
      const body = extractFn(MODULE_SRC, 'advance');
      assert.match(body, /groupRange\s*\(/,
        'advance 必須走 groupRange——forcing：沒接群組 = Space 仍逐一停在單行 block');
      assert.match(body, /cur\.end\s*\+\s*1\s*:\s*cur\.start\s*-\s*1/,
        '推進必須跨整組（往下 end+1、往上 start-1）——forcing：只跳一格會停在群組中段的單行成員');
      assert.match(body, /setFocus\s*\(\s*blocks\[group\.end\]\s*\)/,
        '焦點必須設群組 terminal（真實清單成員）——forcing：設虛構物件 position-memory 的 indexOf 找不到、閱讀位置記憶壞掉');
      assert.match(body, /maybeScroll\s*\(\s*blocks\[group\.start\]/,
        '捲動門檻/落點必須以群組首 block 計算——forcing：用 terminal 算，合併進來的單行標題會停在 viewport 外');
    });

    it('positionBar 必須讓指示條涵蓋整個群組（首 block top → terminal bottom）', () => {
      const body = extractFn(MODULE_SRC, 'positionBar');
      assert.match(body, /groupRange\s*\(/,
        'positionBar 必須走 groupRange——forcing：指示條只標 terminal、視覺上看不出「合併」');
      assert.match(body, /re\.bottom\s*-\s*rs\.top/,
        '高度必須 = terminal bottom - 群組首 top——forcing：只用單 block 高度，群組跨段的指示條斷裂');
    });

    it('collectBlocks 不可被改動粒度（合併只在呈現/推進層）', () => {
      const body = extractFn(MODULE_SRC, 'collectBlocks');
      assert.ok(!/groupRange|isOneLineBlock/.test(body),
        'collectBlocks 不可呼叫 groupRange / isOneLineBlock——forcing：改動清單粒度會讓 position-memory 儲存的段落索引/簽名 drift、舊閱讀位置全失準');
    });
  });

  describe('groupRange / isOneLineBlock 純邏輯行為（mock block 執行）', () => {
    // 抽出兩個函式 + 常數，用 mock block 物件執行——分組數學不靠 jsdom layout
    const harness = new Function('window', `
      const ONE_LINE_MAX_RATIO = 1.6;
      const ONE_LINE_SKIP_SEL = 'img, video, figure, table, pre';
      ${extractFn(MODULE_SRC, 'isOneLineBlock')}
      ${extractFn(MODULE_SRC, 'groupRange')}
      return { isOneLineBlock, groupRange };
    `)({});

    // mock block：height / lineHeight 可控、matches 依 skip 標記
    function mk(height, opts) {
      const o = opts || {};
      return {
        nodeType: 1,
        matches: () => !!o.media,
        getBoundingClientRect: () => ({ height, top: 0, bottom: height }),
        ownerDocument: { defaultView: { getComputedStyle: () => ({
          lineHeight: o.lineHeight || '24px', fontSize: o.fontSize || '16px'
        }) } }
      };
    }

    it('單行判定：height ≈ 1×lh 為單行、≈ 2×lh 非單行、media 一律非單行', () => {
      assert.strictEqual(harness.isOneLineBlock(mk(24)), true, '24px / lh 24px = 一行');
      assert.strictEqual(harness.isOneLineBlock(mk(48)), false, '48px / lh 24px = 兩行');
      assert.strictEqual(harness.isOneLineBlock(mk(24, { media: true })), false,
        'media block 不參與單行判定');
      // line-height: normal → fontSize × 1.2 估算：16px 字一行 ≈ 19px 單行、兩行 38px 非單行
      assert.strictEqual(harness.isOneLineBlock(mk(19, { lineHeight: 'normal' })), true,
        'normal fallback：一行判單行');
      assert.strictEqual(harness.isOneLineBlock(mk(38, { lineHeight: 'normal' })), false,
        'normal fallback：兩行不可誤判單行（門檻 16×1.2×1.6 = 30.7）');
    });

    it('單行標題 + 多行段落：任一成員算出同一群組 [標題, 段落]', () => {
      const blocks = [mk(24), mk(96)];
      assert.deepStrictEqual(harness.groupRange(blocks, 0), { start: 0, end: 1 });
      assert.deepStrictEqual(harness.groupRange(blocks, 1), { start: 0, end: 1 });
    });

    it('連續單行 chain：兩個單行 + 多行 = 一組三成員', () => {
      const blocks = [mk(24), mk(24), mk(96), mk(96)];
      assert.deepStrictEqual(harness.groupRange(blocks, 0), { start: 0, end: 2 });
      assert.deepStrictEqual(harness.groupRange(blocks, 1), { start: 0, end: 2 });
      assert.deepStrictEqual(harness.groupRange(blocks, 2), { start: 0, end: 2 });
      // 下一個多行段落自成一組（不被前面的群組吃掉）
      assert.deepStrictEqual(harness.groupRange(blocks, 3), { start: 3, end: 3 });
    });

    it('文末孤懸單行自成一組（下面沒東西可依附、照舊停留）', () => {
      const blocks = [mk(96), mk(24)];
      assert.deepStrictEqual(harness.groupRange(blocks, 0), { start: 0, end: 0 });
      assert.deepStrictEqual(harness.groupRange(blocks, 1), { start: 1, end: 1 });
    });

    it('單行標題 + 圖片：標題依附到圖片單位（圖片是 terminal、不再往下吃）', () => {
      const blocks = [mk(24), mk(300, { media: true }), mk(96)];
      assert.deepStrictEqual(harness.groupRange(blocks, 0), { start: 0, end: 1 });
      assert.deepStrictEqual(harness.groupRange(blocks, 2), { start: 2, end: 2 });
    });
  });
});
