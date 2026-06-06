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

const EXPECTED_SERIF =
  '"Noto Serif TC", Georgia, "Times New Roman", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif';
const EXPECTED_LEGACY = '"Noto Serif TC", Georgia, "Times New Roman", serif';

function popupStack(key) {
  const m = POPUP_JS.match(new RegExp(key + ":\\s*'([^']+)'"));
  return m && m[1];
}

describe('襯線 stack CJK 字體（v0.7.221 forcing function）', () => {
  it('popup.js FONT_STACKS.serif 必須含 CJK 襯線字體（macOS Songti / iOS Hiragino Mincho）', () => {
    assert.strictEqual(popupStack('serif'), EXPECTED_SERIF,
      'FONT_STACKS.serif 與預期 stack 不一致——CJK 襯線字體缺席時 iOS 中文會 fallback 到 styler sans 後綴的 PingFang TC');
  });

  it('stack 結構：CJK 襯線字體必須在泛型 serif 之前、拉丁字型之後', () => {
    const s = popupStack('serif');
    const idx = (n) => s.indexOf(n);
    assert.ok(idx('Georgia') < idx('Songti TC'), '拉丁字型必須在 CJK 字體前（拉丁照走 Georgia/Times）');
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

  it('SW 必須有 LEGACY_SERIF_STACK → SERIF_STACK 遷移（fontFamily 存字面值、改常數不動舊使用者）', () => {
    const legacy = SW_SRC.match(/LEGACY_SERIF_STACK = '([^']+)'/);
    const next = SW_SRC.match(/\bSERIF_STACK = '([^']+)'/);
    assert.ok(legacy && next, 'SW 缺 LEGACY_SERIF_STACK / SERIF_STACK 常數');
    assert.strictEqual(legacy[1], EXPECTED_LEGACY, 'LEGACY 常數必須等於 v0.7.220 以前的襯線 stack（精準匹配才遷移，不能誤改使用者自選值）');
    assert.strictEqual(next[1], EXPECTED_SERIF, 'SW SERIF_STACK 必須與 popup FONT_STACKS.serif 同步');
    assert.match(SW_SRC, /merged\.fontFamily === LEGACY_SERIF_STACK\)\s*merged\.fontFamily = SERIF_STACK/,
      'onInstalled 必須做精準替換遷移');
  });
});
