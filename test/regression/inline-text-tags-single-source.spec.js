// v1.7.43 T2：INLINE_TEXT_TAGS 單一資料源 forcing spec
// -----------------------------------------------------------------------------
// 「div 是不是段落載體」的行內 tag 集，styler markTextDivs 與 space-scroll
// 段落文字量計算是同一份事實的兩個消費端。v1.7.36 同族 drift（markParagraphDivs
// vs markTextDivs）咬過一次；本輪盤點時兩份 Set 已再度分岔（space-scroll 多
// FONT/Q/CITE/BDI/BDO、styler 多 BR）。收斂到 namespace.js 的
// NS.INLINE_TEXT_TAGS 後，此 spec 掃原始碼確保：
//   1. namespace.js 的正典集合涵蓋兩端曾各自需要的 tag（BR 與 FONT 族）
//   2. 兩個消費端都引用 NS.INLINE_TEXT_TAGS，不得再各自 new Set 一份
// 此 spec 驗「原始碼層的單一資料源」、不驗 runtime 行為（段落標記行為由
// styler.spec.js / 各站 fixture spec 覆蓋）。
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../jread/content', p), 'utf8');

describe('INLINE_TEXT_TAGS 單一資料源（T2）', () => {
  it('namespace.js 正典集合涵蓋兩端歷史上各自需要的 tag', () => {
    const src = read('namespace.js');
    const m = src.match(/INLINE_TEXT_TAGS:\s*new Set\(\[([^\]]+)\]\)/);
    assert.ok(m, 'namespace.js 應定義 INLINE_TEXT_TAGS: new Set([...])');
    const tags = m[1].match(/'([A-Z]+)'/g).map((s) => s.replace(/'/g, ''));
    // styler 端必要：段落 div 常含 <br>
    assert.ok(tags.includes('BR'), '正典集合應含 BR');
    // space-scroll 端必要：老式頁面與語意標記行內載體
    for (const t of ['FONT', 'Q', 'CITE', 'BDI', 'BDO']) {
      assert.ok(tags.includes(t), `正典集合應含 ${t}`);
    }
    for (const t of ['SPAN', 'A', 'STRONG', 'EM', 'CODE', 'TIME']) {
      assert.ok(tags.includes(t), `正典集合應含 ${t}`);
    }
  });

  it('styler 與 space-scroll 都引用 NS.INLINE_TEXT_TAGS、不得自帶拷貝', () => {
    for (const file of ['styler.js', 'space-scroll.js']) {
      const src = read(file);
      assert.ok(src.includes('NS.INLINE_TEXT_TAGS'), `${file} 應引用 NS.INLINE_TEXT_TAGS`);
      assert.ok(!/new Set\(\[\s*'SPAN'/.test(src), `${file} 不得自帶行內 tag 集拷貝`);
    }
  });
});
