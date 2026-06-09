// JRead — 襯線 stack CJK 字體 forcing function（v0.7.221）
//
// Bug（Jimmy 2026-06-06 iPad 回報）：iOS / iPadOS 選「襯線」與「無襯線」中文
// 渲染結果相同（都是無襯線 PingFang TC）。
//
// 根因（iOS simulator 三輪 probe page 實證）：styler 注入 font-family 時在
// 使用者 stack 後接 sans 系 fallback（`-apple-system, "Noto Sans TC",
// "PingFang TC", system-ui, sans-serif`）。iOS WebKit 對「清單中間」的泛型
// serif 只解析到拉丁字型（Times），CJK 字元繼續往後找 → 命中後綴的
// PingFang TC（無襯線）。桌面平台對中段泛型有 per-script fallback、沒事。
// iOS 唯一內建 CJK 襯線 = Hiragino Mincho ProN（runtime fonts 實查，無
// Songti）；macOS 有 Songti TC/SC。
//
// 修法：襯線 stack 在泛型 serif 之前、拉丁字型之後明寫 CJK 襯線字體——
// CJK 在進入 sans 後綴前命中。舊值已存進使用者 storage（fontFamily 存整串
// stack 字面值），SW onInstalled 做精準遷移。
//
// 訊號層次：本檔驗三檔字面值同步 + stack 結構順序。實際渲染（iOS WebKit
// fallback 行為）靠 simulator probe page / Jimmy 實機。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');
// v0.8.16：font stack 字面值收斂到 content/settings-defaults.js 單一資料源
//（globalThis.__JReadFontStacks / __JReadLegacyFontStacks）。popup.js / SW 都
// 改 reference，不再各自寫一份字面值。require shared 後從 globalThis 取正準值。
require(path.join(ROOT, 'content', 'settings-defaults.js'));
const FONT_STACKS = globalThis.__JReadFontStacks;
const LEGACY_FONT_STACKS = globalThis.__JReadLegacyFontStacks;

const EXPECTED_SERIF =
  'Georgia, "Times New Roman", "Noto Serif TC", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif';
// v0.8.25：LEGACY serif 為陣列（歷代舊值），命中任一即遷移到新值。
const EXPECTED_LEGACY = [
  '"Noto Serif TC", Georgia, "Times New Roman", serif',
  '"Noto Serif TC", Georgia, "Times New Roman", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif'
];

// v0.8.16：popup FONT_STACKS 改 reference 單一資料源——「popup 生效的 stack」
// 即 shared 的值。原本逐檔 grep popup literal 改成讀 shared font stacks。
function popupStack(key) {
  return FONT_STACKS[key];
}

describe('襯線 stack CJK 字體（v0.7.221 forcing function）', () => {
  it('popup.js FONT_STACKS / SW 字型常數取自單一資料源（v0.8.16 結構不變式）', () => {
    assert.match(POPUP_JS, /const FONT_STACKS = window\.__JReadFontStacks\b/,
      'popup.js FONT_STACKS 必須 = window.__JReadFontStacks（單一資料源）');
    assert.match(SW_SRC, /globalThis\.__JReadFontStacks/,
      'SW 的字型 stack 常數必須取自 globalThis.__JReadFontStacks');
    assert.match(SW_SRC, /globalThis\.__JReadLegacyFontStacks/,
      'SW 的舊字型 stack 常數必須取自 globalThis.__JReadLegacyFontStacks');
  });

  it('shared FONT_STACKS.serif 必須含 CJK 襯線字體（macOS Songti / iOS Hiragino Mincho）', () => {
    assert.strictEqual(popupStack('serif'), EXPECTED_SERIF,
      'FONT_STACKS.serif 與預期 stack 不一致——CJK 襯線字體缺席時 iOS 中文會 fallback 到 styler sans 後綴的 PingFang TC');
  });

  it('stack 結構：西文襯線在所有 CJK 字體之前（英文 fall back 到 Georgia）、CJK 字體在泛型 serif 之前', () => {
    const s = popupStack('serif');
    const idx = (n) => s.indexOf(n);
    // v0.8.25 核心：Georgia 在內嵌 "Noto Serif TC" 之前——英文/數字逐字命中
    // Georgia，中文穿到後面的內嵌 Noto Serif TC。
    assert.ok(idx('Georgia') < idx('Noto Serif TC'),
      '西文襯線（Georgia）必須在內嵌 Noto Serif TC 之前——否則英文吃 Noto Serif TC 拉丁字形，不會 fall back');
    assert.ok(idx('Georgia') < idx('Songti TC'), '拉丁字型必須在 CJK 字體前（拉丁照走 Georgia/Times）');
    assert.ok(idx('Noto Serif TC') < s.lastIndexOf('serif'), '內嵌 Noto Serif TC 必須在泛型 serif 前');
    assert.ok(idx('Songti TC') < s.lastIndexOf('serif'), 'Songti TC 必須在泛型 serif 前');
    assert.ok(idx('Hiragino Mincho ProN') < s.lastIndexOf('serif'), 'Hiragino Mincho ProN（iOS 唯一 CJK 襯線）必須在泛型 serif 前');
  });

  it('popup.html 襯線 option value 必須與 FONT_STACKS.serif 逐字一致', () => {
    const m = POPUP_HTML.match(/<option value="([^"]*)">襯線<\/option>/);
    assert.ok(m, '抓不到襯線 option');
    const htmlValue = m[1].replace(/&quot;/g, '"');
    assert.strictEqual(htmlValue, EXPECTED_SERIF,
      'popup.html 襯線 option value 與 popup.js FONT_STACKS.serif drift——select 比對 settings.fontFamily 會失配、UI 顯示錯誤選項');
  });

  it('SW 必須有 LEGACY serif → SERIF_STACK 遷移（fontFamily 存字面值、改常數不動舊使用者）', () => {
    // v0.8.16：SW 的字型 stack 常數改 reference 單一資料源
    //（SERIF_STACK = globalThis.__JReadFontStacks.serif 等），不再各自寫字面值。
    // 正準值改驗 shared font stacks；遷移邏輯 wiring 仍逐字校對。
    // v0.8.25：LEGACY serif 改陣列（歷代舊值），遷移用 .includes()。
    assert.match(SW_SRC, /\bSERIF_STACK = globalThis\.__JReadFontStacks\.serif\b/,
      'SW SERIF_STACK 必須取自 globalThis.__JReadFontStacks.serif');
    assert.match(SW_SRC, /\bLEGACY_SERIF_STACKS = globalThis\.__JReadLegacyFontStacks\.serif\b/,
      'SW LEGACY_SERIF_STACKS 必須取自 globalThis.__JReadLegacyFontStacks.serif');
    assert.deepStrictEqual(LEGACY_FONT_STACKS.serif, EXPECTED_LEGACY,
      'shared LEGACY 襯線陣列必須等於歷代舊襯線 stack（精準匹配才遷移，不能誤改使用者自選值）');
    assert.strictEqual(FONT_STACKS.serif, EXPECTED_SERIF,
      'shared SERIF_STACK 必須與 popup FONT_STACKS.serif 同步');
    // v0.8.15：onInstalled 改寫 diff patch（merged → patch、判定改讀 current）
    assert.match(SW_SRC, /LEGACY_SERIF_STACKS\.includes\(current\.fontFamily\)\)\s*patch\.fontFamily = SERIF_STACK/,
      'onInstalled 必須做精準替換遷移（命中任一歷代舊值）');
  });
});

// v0.7.254：無襯線 stack 系統 CJK 字型優先 forcing function
//
// Bug（Jimmy 2026-06-08 shoppingdesign 回報）：選「無襯線」時細/中字重渲染相同。
// 根因（harness @font-face probe 實證）：部分站點自己定義 @font-face 劫持
// 「Noto Sans TC」family 名、weight→檔案對映壞掉（shoppingdesign 把 weight 400
// 跟 300 都指到 NotoSansTC-Light.woff2）。舊 stack 領頭點名「Noto Sans TC」就吃
// 到站點那份壞字型 → font-weight 細(300)/中(400) 拿到同一個檔案、視覺相同。
// 對照：verse 不定義此 @font-face（fontFaceCount=0）→ 解析到本機完整 Noto Sans
// TC → 三段正常。
//
// 修法：無襯線 stack 改系統 CJK 字型（PingFang TC / Microsoft JhengHei）優先、
// 「Noto Sans TC」降到末段——CJK 逐字 fallback 先命中本機完整字重系統字型、
// 繞過站點劫持的 webfont。系統 CJK 字型字重齊全（PingFang Light/Regular/Medium/
// Semibold、JhengHei Light/Regular/Bold）。舊值已存進使用者 storage，SW
// onInstalled 精準遷移。
//
// 訊號層次：本檔驗三檔字面值同步 + stack 結構順序（系統 CJK 在 Noto Sans TC 前）。
// 實際渲染（站點 @font-face 劫持是否被繞過）靠 harness probe / Jimmy 實機。
const EXPECTED_SANS =
  '-apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Helvetica Neue", sans-serif';
const EXPECTED_LEGACY_SANS = '"Noto Sans TC", -apple-system, "Helvetica Neue", sans-serif';

describe('無襯線 stack 系統 CJK 字型優先（v0.7.254 forcing function）', () => {
  it('popup.js FONT_STACKS.sans 必須系統 CJK 字型優先、Noto Sans TC 降後', () => {
    assert.strictEqual(popupStack('sans'), EXPECTED_SANS,
      'FONT_STACKS.sans 與預期 stack 不一致——Noto Sans TC 領頭會被站點壞掉的 @font-face 劫持、字重失效');
  });

  it('stack 結構：系統 CJK 字型（PingFang TC / Microsoft JhengHei）必須在 Noto Sans TC 之前', () => {
    const s = popupStack('sans');
    const idx = (n) => s.indexOf(n);
    assert.ok(idx('PingFang TC') < idx('Noto Sans TC'),
      'PingFang TC（macOS/iOS CJK）必須在 Noto Sans TC 前——否則站點劫持「Noto Sans TC」時 CJK 先命中壞 webfont');
    assert.ok(idx('Microsoft JhengHei') < idx('Noto Sans TC'),
      'Microsoft JhengHei（Windows CJK）必須在 Noto Sans TC 前');
  });

  it('popup.html 無襯線 option value 必須與 FONT_STACKS.sans 逐字一致', () => {
    const m = POPUP_HTML.match(/<option value="([^"]*)">無襯線<\/option>/);
    assert.ok(m, '抓不到無襯線 option');
    const htmlValue = m[1].replace(/&quot;/g, '"');
    assert.strictEqual(htmlValue, EXPECTED_SANS,
      'popup.html 無襯線 option value 與 popup.js FONT_STACKS.sans drift——select 比對 settings.fontFamily 會失配');
  });

  it('SW 必須有 LEGACY_SANS_STACK → SANS_STACK 遷移', () => {
    // v0.8.16：同 serif——SW 字型 stack 常數改 reference 單一資料源。
    assert.match(SW_SRC, /\bSANS_STACK = globalThis\.__JReadFontStacks\.sans\b/,
      'SW SANS_STACK 必須取自 globalThis.__JReadFontStacks.sans');
    assert.match(SW_SRC, /\bLEGACY_SANS_STACK = globalThis\.__JReadLegacyFontStacks\.sans\b/,
      'SW LEGACY_SANS_STACK 必須取自 globalThis.__JReadLegacyFontStacks.sans');
    assert.strictEqual(LEGACY_FONT_STACKS.sans, EXPECTED_LEGACY_SANS,
      'shared LEGACY_SANS 常數必須等於 v0.7.253 以前的無襯線 stack（精準匹配才遷移）');
    assert.strictEqual(FONT_STACKS.sans, EXPECTED_SANS,
      'shared SANS_STACK 必須與 popup FONT_STACKS.sans 同步');
    // v0.8.15：onInstalled 改寫 diff patch（merged → patch、判定改讀 current）
    assert.match(SW_SRC, /current\.fontFamily === LEGACY_SANS_STACK\)\s*patch\.fontFamily = SANS_STACK/,
      'onInstalled 必須做精準替換遷移');
  });
});
