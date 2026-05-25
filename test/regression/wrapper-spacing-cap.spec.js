// JRead — wrapper spacing cap + empty block spacer collapse（v0.7.186）
//
// 三層修法驗證：
//   1. capWrapperSpacing：articleEl 內 wrapper 元素 margin/padding > 24px → cap 到 24px
//   2. collapseEmptyBlockSpacers：skip-list 中 display:block + 零文字的 spacer → hide
//   3. styler CSS：direct child header/footer/last-child spacing strip
//
// 本 spec 驗 cleaner 端邏輯（1 & 2）+ styler 端 CSS 注入（3）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);
const STYLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8'
);

describe('wrapper spacing cap（v0.7.186）', () => {

  // ---- cleaner: capWrapperSpacing ----

  it('cleaner 必須宣告 capWrapperSpacing 函式', () => {
    assert.ok(/function\s+capWrapperSpacing\s*\(/.test(CLEANER_SRC),
      'cleaner.js 必須宣告 capWrapperSpacing');
  });

  it('capWrapperSpacing 必須定義 WRAPPER_SPACING_CAP = 16', () => {
    assert.ok(/WRAPPER_SPACING_CAP\s*=\s*16/.test(CLEANER_SRC),
      'cap 閾值必須是 16px');
  });

  it('capWrapperSpacing 必須處理 DIV / SECTION / HEADER / FOOTER / ASIDE / NAV', () => {
    const tagsMatch = CLEANER_SRC.match(/WRAPPER_SPACING_TAGS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(tagsMatch, '必須用 WRAPPER_SPACING_TAGS Set');
    const tags = tagsMatch[1];
    for (const t of ['DIV', 'SECTION', 'HEADER', 'FOOTER', 'ASIDE', 'NAV']) {
      assert.ok(tags.includes(`'${t}'`), `WRAPPER_SPACING_TAGS 必須包含 ${t}`);
    }
  });

  it('capWrapperSpacing 必須檢查 margin-top / margin-bottom / padding-top / padding-bottom', () => {
    const propsMatch = CLEANER_SRC.match(/WRAPPER_SPACING_PROPS\s*=\s*\[([^\]]+)\]/);
    assert.ok(propsMatch, '必須用 WRAPPER_SPACING_PROPS 陣列');
    const props = propsMatch[1];
    for (const p of ['margin-top', 'margin-bottom', 'padding-top', 'padding-bottom']) {
      assert.ok(props.includes(`'${p}'`), `WRAPPER_SPACING_PROPS 必須包含 ${p}`);
    }
  });

  it('capWrapperSpacing 必須將結果存到 hidden.__cappedWrapperSpacing', () => {
    assert.ok(/hidden\.__cappedWrapperSpacing\s*=\s*capped/.test(CLEANER_SRC),
      '必須存到 hidden.__cappedWrapperSpacing 供 restore 用');
  });

  it('cleaner 必須宣告 restoreCappedWrapperSpacing 函式', () => {
    assert.ok(/function\s+restoreCappedWrapperSpacing\s*\(/.test(CLEANER_SRC),
      '必須有對應的 restore 函式');
  });

  it('restore() 必須呼叫 restoreCappedWrapperSpacing', () => {
    assert.ok(/restoreCappedWrapperSpacing\(hiddenEls\)/.test(CLEANER_SRC),
      'restore 流程必須呼叫 restoreCappedWrapperSpacing');
  });

  it('clean() 必須呼叫 capWrapperSpacing', () => {
    assert.ok(/capWrapperSpacing\(articleEl,\s*hidden\)/.test(CLEANER_SRC),
      'clean 流程必須呼叫 capWrapperSpacing');
  });

  // ---- cleaner: collapseEmptyBlockSpacers ----

  it('cleaner 必須宣告 collapseEmptyBlockSpacers 函式', () => {
    assert.ok(/function\s+collapseEmptyBlockSpacers\s*\(/.test(CLEANER_SRC),
      'cleaner.js 必須宣告 collapseEmptyBlockSpacers');
  });

  it('collapseEmptyBlockSpacers 必須檢查 display === block', () => {
    const fn = CLEANER_SRC.match(/function\s+collapseEmptyBlockSpacers[\s\S]*?\n  \}/);
    assert.ok(fn, '必須能抓到函式 body');
    assert.ok(/display\s*!==\s*'block'/.test(fn[0]) || /display\s*===\s*'block'/.test(fn[0]),
      '必須過濾 display !== block（只處理 block-displayed 元素）');
  });

  it('clean() 必須呼叫 collapseEmptyBlockSpacers', () => {
    assert.ok(/collapseEmptyBlockSpacers\(articleEl,\s*hidden\)/.test(CLEANER_SRC),
      'clean 流程必須呼叫 collapseEmptyBlockSpacers');
  });

  // ---- styler: header / footer / last-child CSS ----

  it('styler 必須注入 > header { margin: 0; padding: 0 } CSS', () => {
    assert.ok(/>\s*header\s*\{[^}]*margin:\s*0\s*!important/s.test(STYLER_SRC),
      'styler 必須對 direct child header 設 margin: 0');
    assert.ok(/>\s*header\s*\{[^}]*padding:\s*0\s*!important/s.test(STYLER_SRC),
      'styler 必須對 direct child header 設 padding: 0');
  });

  it('styler 必須注入 > footer { margin: 0; padding: 0 } CSS', () => {
    assert.ok(/>\s*footer\s*\{[^}]*margin:\s*0\s*!important/s.test(STYLER_SRC),
      'styler 必須對 direct child footer 設 margin: 0');
  });

  it('styler 必須注入 > *:last-child { margin-bottom: 0; padding-bottom: 0 } CSS', () => {
    assert.ok(/>\s*\*:last-child\s*\{[^}]*margin-bottom:\s*0\s*!important/s.test(STYLER_SRC),
      'styler 必須對 last-child 設 margin-bottom: 0');
    assert.ok(/>\s*\*:last-child\s*\{[^}]*padding-bottom:\s*0\s*!important/s.test(STYLER_SRC),
      'styler 必須對 last-child 設 padding-bottom: 0');
  });

});
