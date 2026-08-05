// JRead — v1.7.41（review 批次 3 D5）：promoted-title 還原不洗掉站方 inline display
// -----------------------------------------------------------------------------
// 根因：detector 的 promote 標題 hide 原元素時直接 setProperty('display','none',
// 'important') 不 snapshot；main.js 退出還原一律 removeProperty('display')——
// 站方 JS 設過 `style="display:flex"` 的元素退出後退回 stylesheet 預設，原頁被
// 永久改變。cleaner hide() 一直有 snapshot，這條 path 是「退出完全還原」不變式
// 的缺口。
//
// 修法：detector hidePromotedTitleSource（兩個 hide 呼叫點共用）hide 前把原
// inline display（值 + priority）snapshot 進 data-jread-prev-display[-priority]；
// main.js restore 讀回寫回原值、沒 snapshot 才 removeProperty。
//
// 行為驗證借用 roomie fixture（markPromotedTitleIfMissing 既有重現環境）；
// main.js 還原側為 forcing（jsdom 全載 main.js 成本高、依既有 spec 慣例掃結構）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const JREAD_DIR = path.join(__dirname, '..', '..', 'jread');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'roomie-noise-heading-blocks-title.html');
const DETECTOR_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'detector.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'main.js'), 'utf8');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  return env;
}

describe('detector v1.7.41 — promote hide 前 snapshot 原 inline display（D5）', () => {
  it('站方設過 inline display 的標題載體：hide 後必須帶 prev-display snapshot', () => {
    const env = setup();
    const articleEl = env.document.querySelector('main');
    const carrier = env.document.querySelector('span.title');
    // 模擬站方 JS 設過 inline display（真實站 hydrate 後常見）
    carrier.style.setProperty('display', 'flex');
    env.NS.cleaner.clean(articleEl, []);
    env.NS.detector.markPromotedTitleIfMissing(articleEl);
    assert.strictEqual(carrier.getAttribute('data-jread-promoted-title-source'), '1',
      '前置條件：載體必須被 promote hide（fixture 環境變了要重查）');
    assert.strictEqual(carrier.getAttribute('data-jread-prev-display'), 'flex',
      'hide 前必須 snapshot 原 inline display 值——退出還原才能寫回、不洗掉站方設定');
    assert.match(carrier.getAttribute('style') || '', /display:\s*none/,
      'hide 本身仍必須生效');
  });

  it('原本無 inline display 的載體：不留 prev-display snapshot（restore 走 removeProperty）', () => {
    const env = setup();
    const articleEl = env.document.querySelector('main');
    const carrier = env.document.querySelector('span.title');
    env.NS.cleaner.clean(articleEl, []);
    env.NS.detector.markPromotedTitleIfMissing(articleEl);
    assert.strictEqual(carrier.getAttribute('data-jread-promoted-title-source'), '1');
    assert.strictEqual(carrier.getAttribute('data-jread-prev-display'), null,
      '無原值時不得留 snapshot attribute（restore 對 null 走 removeProperty）');
  });

  it('結構 forcing：兩個 hide 呼叫點共用 hidePromotedTitleSource（單一資料源）', () => {
    assert.match(DETECTOR_SRC, /function hidePromotedTitleSource\(el\)/,
      '必須宣告 hidePromotedTitleSource helper');
    const helper = DETECTOR_SRC.match(/function hidePromotedTitleSource[\s\S]*?\n  \}/)[0];
    assert.match(helper, /getPropertyValue\('display'\)/, 'helper 必須讀原 inline display');
    assert.match(helper, /getPropertyPriority\('display'\)/, 'helper 必須讀原 priority');
    const calls = DETECTOR_SRC.match(/hidePromotedTitleSource\(/g) || [];
    assert.ok(calls.length >= 3,  // 宣告 1 + 呼叫點 2
      `bestCand 與去重迴圈兩個呼叫點都必須走 helper（目前 ${calls.length - 1} 處呼叫）`);
    // 舊寫法不得殘留：promoted-title-source 標記後直接裸 setProperty display none
    assert.ok(!/data-jread-promoted-title-source', '1'\);\s*\n\s*if \(\w+\.style && typeof \w+\.style\.setProperty/.test(DETECTOR_SRC),
      '不得殘留「標記後裸 setProperty」的舊寫法（繞過 snapshot）');
  });
});

describe('main.js v1.7.41 — 還原側寫回 snapshot（D5，結構 forcing）', () => {
  it('promoted-title-source 還原必須讀 prev-display 寫回、無 snapshot 才 removeProperty', () => {
    const m = MAIN_SRC.match(/data-jread-promoted-title-source[\s\S]{0,900}?\}\);/);
    assert.ok(m, '抓不到 promoted-title-source 還原段');
    const body = m[0];
    assert.match(body, /getAttribute\('data-jread-prev-display'\)/, '必須讀 snapshot');
    assert.match(body, /setProperty\('display', prev/, '有 snapshot 必須寫回原值');
    assert.match(body, /removeProperty\('display'\)/, '無 snapshot 走 removeProperty');
    assert.match(body, /removeAttribute\('data-jread-prev-display'\)/, '還原後必須清掉 snapshot attribute');
  });
});
