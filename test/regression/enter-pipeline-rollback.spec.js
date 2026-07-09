// JRead — enter pipeline rollback 缺口修法 regression spec（v1.6.27）
//
// 背景（v1.6.24 review 遺留 #3，Jimmy 2026-07-09 指示修）：enter 流水線中途
// throw 時「還原不完整」的兩個缺口——
//   (a) cleaner：舊契約「clean 做完才 return hidden 清單」，中途炸掉清單交不
//       出去 → 已 hide 的元素永遠掛著。修法：呼叫端先建空陣列掛上
//       NS.state.hiddenEls 再以 opts.out 傳入，cleaner 邊做邊 push——炸掉時
//       state 上已有做過的每一筆，exit 流程照樣還原。
//   (b) styler：apply 的快照物件最後才 return，中途炸掉 NS.state.originalStyles
//       拿不到 → 半套 attr / inline style / stylesheet 殘留。修法：快照欄位
//       提升宣告 + snapshotNow() 部分快照，apply 內 catch 自我還原後 rethrow。
//
// 訊號層次（驗 X、不驗 Y）：
//   驗：(1) cleaner out 累加器契約（同一陣列邊做邊填、回傳同 reference）；
//       (2) main.js 兩條路徑 state 先掛再 clean（靜態 forcing）；
//       (3) styler apply 中途炸掉後零殘留（行為——毒針多點注入）+ 原錯誤照拋；
//       (4) styler catch 結構存在（靜態 forcing）。
//   不驗：真實站上什麼會讓 apply / clean 炸（假設任意點可炸，多點毒針覆蓋）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'content', 'main.js'), 'utf8');
const STYLER_SRC = fs.readFileSync(path.join(ROOT, 'content', 'styler.js'), 'utf8');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup(scripts) {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中商周主文');
  return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
}

describe('rollback（v1.6.27）— cleaner opts.out 累加器契約', () => {
  it('傳 out 陣列：clean 邊做邊填同一 reference、回傳值 === out', () => {
    const { NS, articleEl } = setup(['detector', 'cleaner']);
    const out = [];
    const ret = NS.cleaner.clean(articleEl, { out });
    assert.strictEqual(ret, out, '回傳值必須是呼叫端傳入的同一個陣列');
    assert.ok(out.length > 0, '商周 fixture 應有雜訊被 hide、out 必須有內容');
    NS.cleaner.restore(out);
  });

  it('不傳 out：維持舊契約（內建陣列、return 交付），既有呼叫端不受影響', () => {
    const { NS, articleEl } = setup(['detector', 'cleaner']);
    const ret = NS.cleaner.clean(articleEl);
    assert.ok(Array.isArray(ret) && ret.length > 0);
    NS.cleaner.restore(ret);
  });

  it('靜態 forcing：main.js 兩條路徑都「先掛 state、再 clean(out)」', () => {
    // generic path
    const g = MAIN_SRC.indexOf('NS.state.hiddenEls = hiddenEls;');
    const gc = MAIN_SRC.indexOf('NS.cleaner.clean(result.el');
    assert.ok(g > 0 && gc > 0 && g < gc,
      'generic path 必須先 NS.state.hiddenEls = hiddenEls 再呼叫 clean');
    assert.match(MAIN_SRC, /out: hiddenEls/, 'generic path 必須傳 out 累加器');
    // x-thread path
    const x = MAIN_SRC.indexOf('NS.state.hiddenEls = xHiddenEls;');
    const xc = MAIN_SRC.indexOf('NS.cleaner.clean(container');
    assert.ok(x > 0 && xc > 0 && x < xc,
      'x-thread path 必須先掛 state 再 clean');
    assert.match(MAIN_SRC, /out: xHiddenEls/, 'x-thread path 必須傳 out 累加器');
  });
});

describe('rollback（v1.6.27）— styler apply 中途炸掉自我還原', () => {
  // 毒針：讓 window.getComputedStyle 在第 N 次呼叫時 throw 一次（之後恢復正常，
  // restore 自身照常運作）。apply 全程大量呼叫 getComputedStyle，N 取多點——
  // 至少一點落在「已做出部分 DOM mutation」的中段；每一點的後置不變式相同：
  // (1) apply rethrow 原錯誤；(2) 頁面零殘留（無 __jread-style、無 data-jread-*
  // attr、html class 已移除）。落在 mutation 前的點不變式自然成立、不弱化測試。
  function residue(document) {
    const out = [];
    if (document.getElementById('__jread-style')) out.push('#__jread-style 殘留');
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes || []) {
        if (a.name.startsWith('data-jread')) { out.push(`${el.tagName}[${a.name}]`); break; }
      }
      if (out.length > 5) break;
    }
    if (document.documentElement.classList.contains('__jread-active')) out.push('html class 殘留');
    return out;
  }

  for (const N of [10, 60, 200, 600]) {
    it(`毒針第 ${N} 次 getComputedStyle：rethrow 原錯誤 + 零殘留`, () => {
      const { window, document, NS, articleEl } = setup(['detector', 'styler']);
      const real = window.getComputedStyle.bind(window);
      let calls = 0;
      let fired = false;
      window.getComputedStyle = function (...args) {
        calls++;
        if (calls === N) { fired = true; throw new Error('POISON_' + N); }
        return real(...args);
      };
      let thrown = null;
      try { NS.styler.apply(articleEl, SETTINGS); } catch (e) { thrown = e; }
      window.getComputedStyle = real;
      if (!fired) {
        // apply 的 getComputedStyle 呼叫數少於 N（fixture/實作變動）——此點不變式
        // 空泛成立，改驗 apply 正常完成後可 restore（避免測試靜默失效不報）
        assert.strictEqual(thrown, null, `毒針未觸發（僅 ${calls} 次呼叫）時 apply 不應 throw`);
        return;
      }
      assert.ok(thrown && /POISON_/.test(thrown.message),
        'apply 必須把原始錯誤 rethrow（對 caller 語意不變）');
      const r = residue(document);
      assert.strictEqual(r.length, 0, `apply 中途炸掉後不可留殘留：${r.join(', ')}`);
    });
  }

  it('靜態 forcing：apply 內含 snapshotNow 部分快照 + catch 自我還原 + rethrow', () => {
    assert.match(STYLER_SRC, /const snapshotNow = \(\) => \(\{ articleEl, ancestors/,
      'apply 必須有 snapshotNow 部分快照 builder');
    assert.match(STYLER_SRC, /styler\.restore\(articleEl, snapshotNow\(\)\)/,
      'catch 必須以部分快照自我還原');
    assert.match(STYLER_SRC, /return snapshotNow\(\);/,
      '正常路徑 return 必須與 catch 共用同一 builder（防欄位 drift）');
    assert.match(STYLER_SRC, /throw err;/, '自我還原後必須 rethrow');
  });
});
