// JRead — cinema / borderless 互斥（v0.7.143）
//
// 動機：v0.7.134 設計「borderless 跟 cinema 完全獨立、可同時開」，但兩者都對
// `#movie_player` 設互相衝突的 position 規則（cinema fixed center、borderless
// fullscreen），同時 active 時 CSS cascade 後贏的破版。popup UI 也沒擋互斥。
//
// v0.7.143 修法：改為「單一 active」軸——啟動其中一個自動退掉另一個。
// (a) enterCinemaMode 開頭：if NS.borderless.isActive() → toggle 退掉
// (b) TOGGLE_YT_BORDERLESS handler：若 willEnter && cinemaActive → exitReaderMode
//     退 cinema 再 toggle borderless
//
// 本 spec 是 forcing function：
//   - enterCinemaMode 必須含 NS.borderless.isActive check + toggle
//   - TOGGLE_YT_BORDERLESS handler 必須含 cinemaActive check + exitReaderMode

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8'
);

describe('cinema/borderless 互斥（v0.7.143）', () => {
  it('enterCinemaMode 入口必須 check NS.borderless.isActive', () => {
    const match = MAIN_SRC.match(/function enterCinemaMode\(\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(match, '必須能抓到 enterCinemaMode body');
    const body = match[1];
    assert.ok(/NS\.borderless[\s\S]{0,80}isActive/.test(body),
      'enterCinemaMode 入口必須 check NS.borderless.isActive()');
  });

  it('enterCinemaMode 在 borderless 啟動時必須 toggle 退掉', () => {
    const match = MAIN_SRC.match(/function enterCinemaMode\(\)\s*\{([\s\S]*?)\n  \}/);
    const body = match[1];
    assert.ok(/NS\.borderless\.toggle\s*\(/.test(body),
      'enterCinemaMode 必須呼 NS.borderless.toggle()（borderless active 時退掉再進 cinema）');
  });

  it('borderless toggle 之前的 isActive check 必須在 NS.cinema.enter 之前（順序保證）', () => {
    const match = MAIN_SRC.match(/function enterCinemaMode\(\)\s*\{([\s\S]*?)\n  \}/);
    const body = match[1];
    const borderlessIdx = body.indexOf('NS.borderless');
    const cinemaEnterIdx = body.indexOf('NS.cinema.enter');
    assert.ok(borderlessIdx !== -1 && cinemaEnterIdx !== -1);
    assert.ok(borderlessIdx < cinemaEnterIdx,
      `borderless mutex check 必須在 NS.cinema.enter() 之前（先退 borderless 才避免 CSS 打架）；borderless idx=${borderlessIdx}, enter idx=${cinemaEnterIdx}`);
  });

  it('TOGGLE_YT_BORDERLESS handler 必須 check cinemaActive', () => {
    const idx = MAIN_SRC.search(/msg\.type\s*===\s*NS\.MSG\.TOGGLE_YT_BORDERLESS/);
    assert.ok(idx >= 0, '必須找到 TOGGLE_YT_BORDERLESS handler');
    const handlerSlice = MAIN_SRC.slice(idx, idx + 1500);
    assert.ok(/cinemaActive/.test(handlerSlice),
      'TOGGLE_YT_BORDERLESS handler 必須 check NS.state.cinemaActive（borderless 啟動時若 cinema active 先退 cinema）');
  });

  it('TOGGLE_YT_BORDERLESS handler 必須呼 exitReaderMode（cinema 完整退出路徑）', () => {
    const idx = MAIN_SRC.search(/msg\.type\s*===\s*NS\.MSG\.TOGGLE_YT_BORDERLESS/);
    const handlerSlice = MAIN_SRC.slice(idx, idx + 1500);
    assert.ok(/exitReaderMode\s*\(/.test(handlerSlice),
      'TOGGLE_YT_BORDERLESS handler 必須在 cinema active 時呼 exitReaderMode 退 cinema（完整清狀態 + icon）');
  });

  it('TOGGLE_YT_BORDERLESS 必須只在 willEnter 時退 cinema（退 borderless 不踩）', () => {
    const idx = MAIN_SRC.search(/msg\.type\s*===\s*NS\.MSG\.TOGGLE_YT_BORDERLESS/);
    const handlerSlice = MAIN_SRC.slice(idx, idx + 1500);
    assert.ok(/willEnter/.test(handlerSlice),
      'TOGGLE_YT_BORDERLESS handler 必須宣告 willEnter 旗標——只在「即將啟動 borderless」場景才退 cinema，退 borderless 時不該觸發');
  });
});
