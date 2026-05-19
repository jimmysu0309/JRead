// JRead — DEFAULT_SETTINGS / DEFAULTS 四檔同步 forcing function（v0.7.143）
//
// Bug：popup.js / SW service-worker.js / styler.js / options.js 各檔自己宣告
// 一份預設值，v0.7.140 spec 只守 popup ↔ styler 的 fontFamily === 'system-ui'
// 一欄。其他欄位 / 其他檔的 default 全靠人工同步，未來改值忘了動其中一檔就 drift。
//
// 修法（v0.7.143 spec 層）：擴 forcing function 守 popup ↔ SW ↔ styler ↔ options
// 四檔對 fontSize / contentWidth / theme / blockPageShortcuts 四欄全欄位逐字一致。
// fontFamily / lineHeight 只 popup + styler 兩邊宣告（SW / options 沒這欄）。
//
// 本 spec 是 forcing function：任一檔字面值改動沒同步、spec 立刻 fail。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const POPUP_SRC = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');
const STYLER_SRC = fs.readFileSync(path.join(ROOT, 'content', 'styler.js'), 'utf8');
const OPTIONS_SRC = fs.readFileSync(path.join(ROOT, 'options', 'options.js'), 'utf8');

// 解析 source 中的 `key: value` 對（從給定 const 物件 body 內）
function extractField(src, constName, field) {
  // 抓 const NAME = { ... } 整個 body—— body 結束 `};` 可能縮排（IIFE 內）
  // 用 brace counting 找對應 close brace
  const declRe = new RegExp('const\\s+' + constName + '\\s*=\\s*\\{');
  const m = src.match(declRe);
  if (!m) return null;
  const startIdx = m.index + m[0].length;
  let balance = 1;
  let endIdx = -1;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') balance++;
    else if (ch === '}') {
      balance--;
      if (balance === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) return null;
  const body = src.slice(startIdx, endIdx);
  // 抓 field: value（value 可能是 number / string / 識別字），去掉 trailing comma
  const fieldRe = new RegExp('(?:^|\\n)\\s*' + field + '\\s*:\\s*([^,\\n]+)');
  const fm = body.match(fieldRe);
  return fm ? fm[1].trim().replace(/,$/, '') : null;
}

describe('DEFAULT_SETTINGS 四檔同步（v0.7.143 forcing function）', () => {
  describe('fontSize：popup / SW / styler / options 必須四邊一致', () => {
    it('SW DEFAULT_SETTINGS.fontSize === 18', () => {
      const v = extractField(SW_SRC, 'DEFAULT_SETTINGS', 'fontSize');
      assert.strictEqual(v, '18', `SW DEFAULT_SETTINGS.fontSize 必須 === 18，實際 ${v}`);
    });
    it('styler DEFAULTS.fontSize === 18', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'fontSize');
      assert.strictEqual(v, '18', `styler DEFAULTS.fontSize 必須 === 18，實際 ${v}`);
    });
    it('options DEFAULTS.fontSize === 18', () => {
      const v = extractField(OPTIONS_SRC, 'DEFAULTS', 'fontSize');
      assert.strictEqual(v, '18', `options DEFAULTS.fontSize 必須 === 18，實際 ${v}`);
    });
    it('popup FONT_SIZE.default === 18', () => {
      const m = POPUP_SRC.match(/FONT_SIZE\s*=\s*\{[^}]*default:\s*(\d+)/);
      assert.ok(m, '必須能抓到 popup FONT_SIZE.default');
      assert.strictEqual(m[1], '18', `popup FONT_SIZE.default 必須 === 18，實際 ${m[1]}`);
    });
  });

  describe('contentWidth：四檔一致', () => {
    it('SW DEFAULT_SETTINGS.contentWidth === 720', () => {
      const v = extractField(SW_SRC, 'DEFAULT_SETTINGS', 'contentWidth');
      assert.strictEqual(v, '720', `SW contentWidth 必須 === 720，實際 ${v}`);
    });
    it('styler DEFAULTS.contentWidth === 720', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'contentWidth');
      assert.strictEqual(v, '720', `styler contentWidth 必須 === 720，實際 ${v}`);
    });
    it('options DEFAULTS.contentWidth === 720', () => {
      const v = extractField(OPTIONS_SRC, 'DEFAULTS', 'contentWidth');
      assert.strictEqual(v, '720', `options contentWidth 必須 === 720，實際 ${v}`);
    });
    it('popup CONTENT_WIDTH.default === 720', () => {
      const m = POPUP_SRC.match(/CONTENT_WIDTH\s*=\s*\{[^}]*default:\s*(\d+)/);
      assert.ok(m);
      assert.strictEqual(m[1], '720', `popup CONTENT_WIDTH.default 必須 === 720，實際 ${m[1]}`);
    });
  });

  describe('theme：四檔一致', () => {
    it('SW DEFAULT_SETTINGS.theme === light', () => {
      const v = extractField(SW_SRC, 'DEFAULT_SETTINGS', 'theme');
      assert.strictEqual(v, "'light'", `SW theme 必須 === 'light'，實際 ${v}`);
    });
    it('styler DEFAULTS.theme === light', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'theme');
      assert.strictEqual(v, "'light'", `styler theme 必須 === 'light'，實際 ${v}`);
    });
    it('options DEFAULTS.theme === light', () => {
      const v = extractField(OPTIONS_SRC, 'DEFAULTS', 'theme');
      assert.strictEqual(v, "'light'", `options theme 必須 === 'light'，實際 ${v}`);
    });
    it('popup DEFAULT_SETTINGS.theme === light', () => {
      const v = extractField(POPUP_SRC, 'DEFAULT_SETTINGS', 'theme');
      assert.strictEqual(v, "'light'", `popup theme 必須 === 'light'，實際 ${v}`);
    });
  });

  describe('blockPageShortcuts：popup / SW / options 三邊一致（styler 沒這欄）', () => {
    it('SW DEFAULT_SETTINGS.blockPageShortcuts === true', () => {
      const v = extractField(SW_SRC, 'DEFAULT_SETTINGS', 'blockPageShortcuts');
      assert.strictEqual(v, 'true', `SW blockPageShortcuts 必須 === true，實際 ${v}`);
    });
    it('options DEFAULTS.blockPageShortcuts === true', () => {
      const v = extractField(OPTIONS_SRC, 'DEFAULTS', 'blockPageShortcuts');
      assert.strictEqual(v, 'true', `options blockPageShortcuts 必須 === true，實際 ${v}`);
    });
    it('popup DEFAULT_SETTINGS.blockPageShortcuts === true', () => {
      const v = extractField(POPUP_SRC, 'DEFAULT_SETTINGS', 'blockPageShortcuts');
      assert.strictEqual(v, 'true', `popup blockPageShortcuts 必須 === true，實際 ${v}`);
    });
  });

  describe('fontFamily：popup / SW / styler 三邊一致（options 沒這欄）', () => {
    it('SW DEFAULT_SETTINGS.fontFamily === system-ui', () => {
      const v = extractField(SW_SRC, 'DEFAULT_SETTINGS', 'fontFamily');
      assert.strictEqual(v, "'system-ui'", `SW fontFamily 必須 === 'system-ui'，實際 ${v}`);
    });
    it('styler DEFAULTS.fontFamily === system-ui', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'fontFamily');
      assert.strictEqual(v, "'system-ui'", `styler fontFamily 必須 === 'system-ui'，實際 ${v}`);
    });
    it('popup FONT_STACKS.system === system-ui', () => {
      const m = POPUP_SRC.match(/FONT_STACKS\s*=\s*\{[^}]*system:\s*'([^']+)'/);
      assert.ok(m);
      assert.strictEqual(m[1], 'system-ui', `popup FONT_STACKS.system 必須 === 'system-ui'，實際 ${m[1]}`);
    });
  });

  describe('lineHeight：popup（沒有）/ SW / styler 兩邊一致', () => {
    it('SW DEFAULT_SETTINGS.lineHeight === 1.7', () => {
      const v = extractField(SW_SRC, 'DEFAULT_SETTINGS', 'lineHeight');
      assert.strictEqual(v, '1.7', `SW lineHeight 必須 === 1.7，實際 ${v}`);
    });
    it('styler DEFAULTS.lineHeight === 1.7', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'lineHeight');
      assert.strictEqual(v, '1.7', `styler lineHeight 必須 === 1.7，實際 ${v}`);
    });
  });
});
