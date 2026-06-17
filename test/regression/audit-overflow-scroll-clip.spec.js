// JRead — regression spec: overflow audit scroll-clip 豁免（2026-06-17）
//
// 背景：page-rounds harness 的 auditOverflow 對「被 overflow-x:auto|scroll
// 內捲的祖先裁切」的超出元素過度敏感 → 把 code block / 寬表格內超出 code
// span 誤報為 overflow（rust-book hljs-comment、kubernetes YAML code、
// 全部在 card 內的 <pre>/<code> overflow-x:auto 裡，整頁無 H-scroll）。
// getBoundingClientRect 回報 layout 位置、不管 scroll 裁切 → 天真版誤報。
//
// 訊號層次：本 spec 驗 auditOverflow 的「scroll-clip 豁免」判定邏輯
// （mock rect + getComputedStyle；jsdom 無 layout）。不驗真實站點渲染
// （由 page-rounds harness 實跑驗收）。
//
// Forcing function：
//   (a) 被 overflow-x:auto 祖先（自身在 card 內）裁切的超出元素 → 豁免不報
//   (b) 無 scroll 祖先的超出元素 → 仍報（豁免不可過寬）
//   (c) 被 overflow-x:hidden / card 本身裁切的超出元素 → 仍報
//       （內容被切掉、看不到也捲不到 = 真破版，arxiv 寬公式實證）

const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const auditLib = require(path.join(TOOLS, 'audit-lib.js'));

// rect / overflowX 用 element 的 data-* 驅動 mock（jsdom 無 layout engine）
function setup(html) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`,
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  for (const el of w.document.querySelectorAll('*')) {
    const right = el.dataset.right;
    if (right !== undefined) {
      el.getBoundingClientRect = () => ({
        width: 200, height: 20, top: 0, bottom: 20, left: 0, right: +right });
    }
  }
  const realGCS = w.getComputedStyle.bind(w);
  w.getComputedStyle = (el) => {
    const base = realGCS(el);
    return {
      display: el.dataset.display || 'block',
      visibility: 'visible',
      overflowX: el.dataset.overflowX || 'visible',
      getPropertyValue: (p) => base.getPropertyValue(p)
    };
  };
  return w;
}

function runOverflow(w) {
  const fn = w.eval(`(${auditLib.pageFns.auditOverflow.toString()})`);
  return fn();
}

describe('auditOverflow — scroll-clip 豁免（2026-06-17）', () => {
  it('(a) 被 overflow-x:auto 祖先（在 card 內）裁切的超出元素不報', () => {
    // card right=1000；<code overflow-x:auto> right=940（在 card 內）；
    // 內部 span right=1080（超出 card 80px）→ 被 code 捲軸吸收 → 豁免
    const w = setup(`
      <article data-jread-active="1" data-right="1000" data-overflow-x="hidden">
        <pre data-right="940"><code data-right="940" data-overflow-x="auto">
          <span id="codespan" data-right="1080">// long code comment overflowing</span>
        </code></pre>
      </article>`);
    const res = runOverflow(w);
    assert.ok(!res.error, 'reader card 應被找到');
    assert.ok(!res.items.some(it => it.tag === 'SPAN'),
      `code 內被 overflow-x:auto 裁切的 span 應豁免，實得 items: ${JSON.stringify(res.items.map(i => i.tag))}`);
    assert.strictEqual(res.overflow, false, '無真實破版 → overflow=false');
  });

  it('(b) 無 scroll 祖先的超出元素仍報（豁免不可過寬）', () => {
    // <div overflow-x:visible> 內 span 超出 card → 無捲軸吸收 → 真破版
    const w = setup(`
      <article data-jread-active="1" data-right="1000" data-overflow-x="hidden">
        <div data-right="1080" data-overflow-x="visible">
          <span id="wide" data-right="1080">unbounded inline-block wider than card</span>
        </div>
      </article>`);
    const res = runOverflow(w);
    assert.ok(res.items.length > 0, '無 scroll 祖先的超出元素必須被報');
    assert.strictEqual(res.overflow, true, '真破版 → overflow=true');
  });

  it('(c) 被 overflow-x:hidden / card 本身裁切的超出元素仍報（arxiv 寬公式）', () => {
    // 寬公式 table right=1080，祖先只有 card(overflow-x:hidden) → 被切掉、
    // 使用者捲不到 → 真破版，不可豁免（arxiv ltx_equation 實證）
    const w = setup(`
      <article data-jread-active="1" data-right="1000" data-overflow-x="hidden">
        <table data-right="1080" data-overflow-x="visible" class="ltx_equation">
          <tbody data-right="1080"><tr data-right="1080"><td data-right="1080">wide math equation</td></tr></tbody>
        </table>
      </article>`);
    const res = runOverflow(w);
    assert.ok(res.items.some(it => it.tag === 'TABLE'),
      'card overflow:hidden 裁切的寬公式必須被報（看不到也捲不到）');
    assert.strictEqual(res.overflow, true, '內容被切掉 → overflow=true');
  });
});
