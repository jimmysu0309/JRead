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
// v0.8.16（單一資料源整併）：DEFAULT_SETTINGS literal 收斂到
// content/settings-defaults.js。popup.js 改 `const DEFAULT_SETTINGS =
// window.__JReadSettingsDefaults`、options.js 改 `const DEFAULTS =
// window.__JReadSettingsDefaults`、SW 改 `const DEFAULT_SETTINGS =
// globalThis.__JReadSettingsDefaults`——三檔不再自帶 literal。本 spec 對這三檔
// 的守備改成「結構：確認 reference 取自單一資料源」+「正準值：require shared
// 物件後逐欄比對」兩條不變式（取代原本的逐檔字面值 grep）。styler.js 仍是獨立
// content script、自帶 fallback literal（shared 之外唯一合法第二份），維持字面
// 值校對。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const POPUP_SRC = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');
// v0.7.235：SW 的 DEFAULT_SETTINGS literal 搬到 content/settings-defaults.js
// 單一資料源（iOS background 掉包修法）——本 spec 對「SW 端 defaults」的
// 守備對象同步搬家。
const SHARED_SRC = fs.readFileSync(path.join(ROOT, 'content', 'settings-defaults.js'), 'utf8');
const STYLER_SRC = fs.readFileSync(path.join(ROOT, 'content', 'styler.js'), 'utf8');
const OPTIONS_SRC = fs.readFileSync(path.join(ROOT, 'options', 'options.js'), 'utf8');
// v0.8.16：正準值來源——require 單一資料源拿 shared 物件逐欄 assert（popup /
// options 直接 reference 它，shared 的值即三檔生效值）。
const SHARED = require(path.join(ROOT, 'content', 'settings-defaults.js'));

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
  // v0.8.16：結構不變式——popup / options / SW 必須 reference 單一資料源，
  // 不得再各自宣告 DEFAULT_SETTINGS / DEFAULTS literal（否則回到 drift 風險）。
  describe('單一資料源 reference（v0.8.16）', () => {
    it('popup.js DEFAULT_SETTINGS 取自 window.__JReadSettingsDefaults（不再有自己的 literal）', () => {
      assert.match(POPUP_SRC, /const DEFAULT_SETTINGS = window\.__JReadSettingsDefaults\b/,
        'popup.js DEFAULT_SETTINGS 必須 = window.__JReadSettingsDefaults（單一資料源）');
      assert.ok(!/const DEFAULT_SETTINGS = \{/.test(POPUP_SRC),
        'popup.js 不得再有 DEFAULT_SETTINGS literal');
    });
    it('options.js DEFAULTS 取自 window.__JReadSettingsDefaults（不再有自己的 literal）', () => {
      assert.match(OPTIONS_SRC, /const DEFAULTS = window\.__JReadSettingsDefaults\b/,
        'options.js DEFAULTS 必須 = window.__JReadSettingsDefaults（單一資料源）');
      assert.ok(!/const DEFAULTS = \{/.test(OPTIONS_SRC),
        'options.js 不得再有 DEFAULTS literal');
    });
    it('SW DEFAULT_SETTINGS 取自 globalThis.__JReadSettingsDefaults（不再有自己的 literal）', () => {
      assert.match(SHARED_SRC, /const DEFAULT_SETTINGS = \{/,
        '單一資料源 settings-defaults.js 必須是唯一持有 DEFAULT_SETTINGS literal 的檔');
    });
  });

  // v1.7.33（Jimmy 2026-08-03）：預設值改為 Jimmy 慣用組合——theme gray、
  // fontSize 17、titleFontSize 32、lineHeight 1.5、fontFamily 無襯線 stack、
  // latinSans sourceserif。本 spec 各欄期望值同步更新。
  describe('fontSize：popup / SW / styler / options 必須四邊一致', () => {
    it('shared DEFAULT_SETTINGS.fontSize === 17', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'fontSize');
      assert.strictEqual(v, '17', `shared DEFAULT_SETTINGS.fontSize 必須 === 17，實際 ${v}`);
    });
    it('styler DEFAULTS.fontSize === 17', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'fontSize');
      assert.strictEqual(v, '17', `styler DEFAULTS.fontSize 必須 === 17，實際 ${v}`);
    });
    it('options/popup 生效 fontSize === 17（取自 shared 單一資料源）', () => {
      assert.strictEqual(SHARED.fontSize, 17,
        `shared（即 options/popup reference 的）fontSize 必須 === 17，實際 ${SHARED.fontSize}`);
    });
    it('popup FONT_SIZE.default === 17', () => {
      const m = POPUP_SRC.match(/FONT_SIZE\s*=\s*\{[^}]*default:\s*(\d+)/);
      assert.ok(m, '必須能抓到 popup FONT_SIZE.default');
      assert.strictEqual(m[1], '17', `popup FONT_SIZE.default 必須 === 17，實際 ${m[1]}`);
    });
  });

  describe('contentWidth：四檔一致', () => {
    it('shared DEFAULT_SETTINGS.contentWidth === 720', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'contentWidth');
      assert.strictEqual(v, '720', `SW contentWidth 必須 === 720，實際 ${v}`);
    });
    it('styler DEFAULTS.contentWidth === 720', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'contentWidth');
      assert.strictEqual(v, '720', `styler contentWidth 必須 === 720，實際 ${v}`);
    });
    it('options/popup 生效 contentWidth === 720（取自 shared 單一資料源）', () => {
      assert.strictEqual(SHARED.contentWidth, 720,
        `shared contentWidth 必須 === 720，實際 ${SHARED.contentWidth}`);
    });
    it('popup CONTENT_WIDTH.default === 720', () => {
      const m = POPUP_SRC.match(/CONTENT_WIDTH\s*=\s*\{[^}]*default:\s*(\d+)/);
      assert.ok(m);
      assert.strictEqual(m[1], '720', `popup CONTENT_WIDTH.default 必須 === 720，實際 ${m[1]}`);
    });
  });

  describe('theme：四檔一致（v1.7.33 預設 gray）', () => {
    it('shared DEFAULT_SETTINGS.theme === gray', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'theme');
      assert.strictEqual(v, "'gray'", `SW theme 必須 === 'gray'，實際 ${v}`);
    });
    it('styler DEFAULTS.theme === gray', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'theme');
      assert.strictEqual(v, "'gray'", `styler theme 必須 === 'gray'，實際 ${v}`);
    });
    it('options/popup 生效 theme === gray（取自 shared 單一資料源）', () => {
      assert.strictEqual(SHARED.theme, 'gray',
        `shared theme 必須 === 'gray'，實際 ${SHARED.theme}`);
    });
    it('styler theme 注入判定不得再綁 DEFAULTS.theme（v1.7.33 sentinel 脫鉤）', () => {
      // 預設 theme 改 gray 後，「哪個 theme 注入文字色」必須由 theme.text 判定
      //（light 天生 null），不可再用「!== DEFAULTS.theme」——否則 gray 預設
      // 使用者拿不到文字色覆寫、theme 視覺半套。
      assert.ok(!/theme:\s*\(s\.theme\s*\|\|\s*DEFAULTS\.theme\)\s*!==\s*DEFAULTS\.theme/.test(STYLER_SRC),
        'styler overrides.theme 不可再與 DEFAULTS.theme 比對');
      assert.match(STYLER_SRC, /theme:\s*!!theme\.text/,
        'styler overrides.theme 必須由 theme.text 判定');
    });
  });

  describe('fontWeight：popup / SW / styler / options 必須四邊一致（v0.7.254 字重三段）', () => {
    // v0.7.254：取代 boldText（macOS-only smoothing）。真正的 font-weight：
    // 細 300 / 中 400（預設）/ 粗 700，全平台一致生效。預設 400（中）。
    it('shared DEFAULT_SETTINGS.fontWeight === 400', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'fontWeight');
      assert.strictEqual(v, '400', `SW fontWeight 預設必須 === 400 (中)，實際 ${v}`);
    });
    it('styler DEFAULTS.fontWeight === 400', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'fontWeight');
      assert.strictEqual(v, '400', `styler fontWeight 預設必須 === 400 (中)，實際 ${v}`);
    });
    it('options/popup 生效 fontWeight === 400（取自 shared 單一資料源）', () => {
      assert.strictEqual(SHARED.fontWeight, 400,
        `shared fontWeight 預設必須 === 400 (中)，實際 ${SHARED.fontWeight}`);
    });
    it('main.js storage.onChanged relevantKeys 必須含 fontWeight（reader mode 即時套用、不需 refresh）', () => {
      const fs = require('fs');
      const path = require('path');
      const MAIN_SRC = fs.readFileSync(
        path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'),
        'utf8'
      );
      const m = MAIN_SRC.match(/relevantKeys\s*=\s*\[([^\]]+)\]/);
      assert.ok(m, '必須能抓到 main.js relevantKeys 陣列');
      const keys = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      assert.ok(keys.includes('fontWeight'),
        `relevantKeys 必須含 fontWeight；否則 popup 切換字重後 content script 不會 reapply、使用者需 refresh 頁面才看到效果。實際 keys: ${JSON.stringify(keys)}`);
      assert.ok(!keys.includes('boldText'),
        `relevantKeys 不可再含已退役的 boldText。實際 keys: ${JSON.stringify(keys)}`);
    });
    it('SW onInstalled 必須含 boldText → fontWeight 一次性遷移（boldText:true → 600）', () => {
      // forcing function：舊使用者若曾設「粗」(boldText:true)，更新後必須換算成
      // fontWeight 600（粗 Semibold），否則靜默退回中（400）。遷移邏輯在 SW onInstalled。
      const fs = require('fs');
      const path = require('path');
      const SW_SRC = fs.readFileSync(
        path.join(__dirname, '..', '..', 'jread', 'background', 'service-worker.js'),
        'utf8'
      );
      assert.match(SW_SRC, /current\.fontWeight\s*===\s*undefined\s*&&\s*current\.boldText\s*===\s*true/,
        'SW onInstalled 必須有「未遷移過 + 舊 boldText:true」的條件判斷');
      // v0.8.15：onInstalled 改寫 diff patch（merged → patch），遷移仍保留
      assert.match(SW_SRC, /patch\.fontWeight\s*=\s*600/,
        'SW onInstalled 必須把舊 boldText:true 換算成 fontWeight 600');
    });
  });

  describe('blockPageShortcuts：popup / SW / options 三邊一致（styler 沒這欄）', () => {
    it('shared DEFAULT_SETTINGS.blockPageShortcuts === true', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'blockPageShortcuts');
      assert.strictEqual(v, 'true', `SW blockPageShortcuts 必須 === true，實際 ${v}`);
    });
    it('options/popup 生效 blockPageShortcuts === true（取自 shared 單一資料源）', () => {
      assert.strictEqual(SHARED.blockPageShortcuts, true,
        `shared blockPageShortcuts 必須 === true，實際 ${SHARED.blockPageShortcuts}`);
    });
  });

  describe('autoEnableDomains：popup / SW / options 三檔一致（v0.7.155 新增；styler 無此欄）', () => {
    it('shared DEFAULT_SETTINGS.autoEnableDomains === []', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'autoEnableDomains');
      assert.strictEqual(v, '[]', `SW autoEnableDomains 必須 === []，實際 ${v}`);
    });
    it('options/popup 生效 autoEnableDomains === []（取自 shared 單一資料源）', () => {
      assert.deepStrictEqual(SHARED.autoEnableDomains, [],
        `shared autoEnableDomains 必須 === []，實際 ${JSON.stringify(SHARED.autoEnableDomains)}`);
    });
  });

  describe('pangu：popup / SW / styler / options 四檔一致（v0.7.153 新增）', () => {
    it('shared DEFAULT_SETTINGS.pangu === true', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'pangu');
      assert.strictEqual(v, 'true', `SW pangu 必須 === true，實際 ${v}`);
    });
    it('styler DEFAULTS.pangu === true', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'pangu');
      assert.strictEqual(v, 'true', `styler pangu 必須 === true，實際 ${v}`);
    });
    it('options/popup 生效 pangu === true（取自 shared 單一資料源）', () => {
      assert.strictEqual(SHARED.pangu, true,
        `shared pangu 必須 === true，實際 ${SHARED.pangu}`);
    });
  });

  describe('fontFamily：popup / SW / styler 三邊一致（options 沒這欄；v1.7.33 預設無襯線）', () => {
    it('shared DEFAULT_SETTINGS.fontFamily === FONT_STACKS.sans（引用單一資料源）', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'fontFamily');
      assert.strictEqual(v, 'FONT_STACKS.sans',
        `shared fontFamily 必須引用 FONT_STACKS.sans（不重複字面值），實際 ${v}`);
      assert.strictEqual(SHARED.fontFamily, globalThis.__JReadFontStacks.sans,
        'shared fontFamily 生效值必須 === FONT_STACKS.sans');
    });
    it('styler DEFAULTS.fontFamily 字面值 === shared FONT_STACKS.sans', () => {
      // styler 是獨立 fallback literal（唯一合法第二份），逐字比對 shared sans
      // stack。extractField 對含逗號的 stack 字串會截斷，改直接 includes 比對。
      assert.ok(STYLER_SRC.includes(`fontFamily: '${globalThis.__JReadFontStacks.sans}'`),
        'styler DEFAULTS.fontFamily 必須逐字 === FONT_STACKS.sans');
    });
    it('styler fontFamily 注入判定用 system-ui sentinel（v1.7.33 與 DEFAULTS 脫鉤）', () => {
      // 預設 fontFamily 改無襯線後，「系統預設 = 不注入」必須綁 'system-ui'
      // 字面值，不可再用「!== DEFAULTS.fontFamily」——否則預設使用者拿不到
      // 無襯線注入、選系統預設反而被注入。
      assert.match(STYLER_SRC, /fontFamily:\s*opts\.fontFamily\s*!==\s*'system-ui'/,
        "styler overrides.fontFamily 必須與 'system-ui' sentinel 比對");
    });
    it('popup FONT_STACKS 取自 shared、shared FONT_STACKS.system === system-ui', () => {
      // v0.8.16：popup FONT_STACKS 改 reference window.__JReadFontStacks 單一資料源。
      assert.match(POPUP_SRC, /const FONT_STACKS = window\.__JReadFontStacks\b/,
        'popup.js FONT_STACKS 必須 = window.__JReadFontStacks（單一資料源）');
      assert.strictEqual(globalThis.__JReadFontStacks.system, 'system-ui',
        `shared FONT_STACKS.system 必須 === 'system-ui'，實際 ${globalThis.__JReadFontStacks.system}`);
    });
  });

  describe('lineHeight：popup / SW / styler 三邊一致（v1.7.33 預設 1.5）', () => {
    it('shared DEFAULT_SETTINGS.lineHeight === 1.5', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'lineHeight');
      assert.strictEqual(v, '1.5', `SW lineHeight 必須 === 1.5，實際 ${v}`);
    });
    it('styler DEFAULTS.lineHeight === 1.5', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'lineHeight');
      assert.strictEqual(v, '1.5', `styler lineHeight 必須 === 1.5，實際 ${v}`);
    });
    it('popup LINE_HEIGHT.default === 1.5', () => {
      const m = POPUP_SRC.match(/LINE_HEIGHT\s*=\s*\{[^}]*default:\s*([\d.]+)/);
      assert.ok(m, '必須能抓到 popup LINE_HEIGHT.default');
      assert.strictEqual(m[1], '1.5', `popup LINE_HEIGHT.default 必須 === 1.5，實際 ${m[1]}`);
    });
    it('styler lineHeight 注入判定只看 Auto sentinel（v1.7.33 與 DEFAULTS 脫鉤）', () => {
      // fontSize v0.7.140 同款修正：== 預設值不注入的隱晦語義去除，0 = Auto
      // 之外一律注入（popup 顯示值 = 實際生效值）。
      assert.match(STYLER_SRC, /lineHeight:\s*opts\.lineHeight\s*>\s*0/,
        'styler overrides.lineHeight 必須是 opts.lineHeight > 0');
    });
  });

  describe('titleFontSize：shared / styler / popup 三邊一致（v1.7.33 預設 32）', () => {
    it('shared DEFAULT_SETTINGS.titleFontSize === 32', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'titleFontSize');
      assert.strictEqual(v, '32', `shared titleFontSize 必須 === 32，實際 ${v}`);
    });
    it('styler DEFAULTS.titleFontSize === 32', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'titleFontSize');
      assert.strictEqual(v, '32', `styler titleFontSize 必須 === 32，實際 ${v}`);
    });
    it('popup TITLE_FONT_SIZE.default === 32', () => {
      const m = POPUP_SRC.match(/TITLE_FONT_SIZE\s*=\s*\{[^}]*default:\s*(\d+)/);
      assert.ok(m, '必須能抓到 popup TITLE_FONT_SIZE.default');
      assert.strictEqual(m[1], '32', `popup TITLE_FONT_SIZE.default 必須 === 32，實際 ${m[1]}`);
    });
  });

  describe('latin 英文字型：預設值（v1.7.33 latinSans 改 sourceserif）', () => {
    it('shared latinSerif === sourceserif、latinSans === sourceserif', () => {
      assert.strictEqual(SHARED.latinSerif, 'sourceserif',
        `shared latinSerif 必須 === 'sourceserif'，實際 ${SHARED.latinSerif}`);
      assert.strictEqual(SHARED.latinSans, 'sourceserif',
        `shared latinSans 必須 === 'sourceserif'，實際 ${SHARED.latinSans}`);
    });
  });

  describe('paragraphSpacing：popup / SW / styler 三邊一致（v0.7.162 新增）', () => {
    it('shared DEFAULT_SETTINGS.paragraphSpacing === 1.0', () => {
      const v = extractField(SHARED_SRC, 'DEFAULT_SETTINGS', 'paragraphSpacing');
      assert.strictEqual(v, '1.0', `SW paragraphSpacing 必須 === 1.0，實際 ${v}`);
    });
    it('styler DEFAULTS.paragraphSpacing === 1.0', () => {
      const v = extractField(STYLER_SRC, 'DEFAULTS', 'paragraphSpacing');
      assert.strictEqual(v, '1.0', `styler paragraphSpacing 必須 === 1.0，實際 ${v}`);
    });
    it('popup PARAGRAPH_SPACING.default === 1.0', () => {
      const m = POPUP_SRC.match(/PARAGRAPH_SPACING\s*=\s*\{[^}]*default:\s*([\d.]+)/);
      assert.ok(m, '必須能抓到 popup PARAGRAPH_SPACING.default');
      assert.strictEqual(m[1], '1.0', `popup PARAGRAPH_SPACING.default 必須 === 1.0，實際 ${m[1]}`);
    });
    it('main.js storage.onChanged relevantKeys 必須含 paragraphSpacing（reader mode 即時套用）', () => {
      const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'content', 'main.js'), 'utf8');
      const m = MAIN_SRC.match(/relevantKeys\s*=\s*\[([^\]]+)\]/);
      assert.ok(m, '必須能抓到 main.js relevantKeys 陣列');
      const keys = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      assert.ok(keys.includes('paragraphSpacing'),
        `relevantKeys 必須含 paragraphSpacing；否則 popup 切換段落間距後 content script 不會 reapply。實際 keys: ${JSON.stringify(keys)}`);
    });
  });

  // v1.7.43 T8：floating-icon / touch-gestures 原本各自 inline 硬寫預設值
  // （0.7 / pagedMode:false / threeFingerTap:false）、不受本 spec 校對。改讀
  // __JReadSettingsDefaults 後，這裡守：(1) 兩檔引用單一資料源 (2) 殘留的
  // fallback 字面值（settings-defaults 缺席時的防禦值）與正典一致。
  describe('floating-icon / touch-gestures 預設值單一資料源（v1.7.43 T8）', () => {
    const FLOATING_SRC = fs.readFileSync(path.join(ROOT, 'content', 'floating-icon.js'), 'utf8');
    const TG_SRC = fs.readFileSync(path.join(ROOT, 'content', 'touch-gestures.js'), 'utf8');
    it('floating-icon.js DEFAULT_OPACITY 取自 __JReadSettingsDefaults、fallback 與正典一致', () => {
      const m = FLOATING_SRC.match(/DEFAULT_OPACITY = SETTINGS_DEF\.floatingIconOpacity \?\? ([\d.]+)/);
      assert.ok(m, 'DEFAULT_OPACITY 必須讀 SETTINGS_DEF.floatingIconOpacity');
      assert.strictEqual(parseFloat(m[1]), SHARED.floatingIconOpacity,
        `fallback ${m[1]} 必須與正典 floatingIconOpacity ${SHARED.floatingIconOpacity} 一致`);
    });
    it('floating-icon.js togglePaged 的 pagedMode 預設取自 SETTINGS_DEF', () => {
      assert.match(FLOATING_SRC, /pagedMode: SETTINGS_DEF\.pagedMode \?\? false/,
        'togglePaged 的 storage.get 預設必須讀 SETTINGS_DEF.pagedMode');
      assert.strictEqual(SHARED.pagedMode, false, '正典 pagedMode 預設應為 false（fallback 一致性）');
    });
    it('touch-gestures.js threeFingerTap 預設取自 __JReadSettingsDefaults', () => {
      assert.match(TG_SRC, /__JReadSettingsDefaults && window\.__JReadSettingsDefaults\.threeFingerTap\) \?\? false/,
        'threeFingerTap 預設必須讀 __JReadSettingsDefaults');
      assert.ok(!/storage\.sync\.get\(\{ threeFingerTap: false \}/.test(TG_SRC),
        'storage.get 不得再 inline 硬寫 threeFingerTap: false');
      assert.strictEqual(SHARED.threeFingerTap, false, '正典 threeFingerTap 預設應為 false（fallback 一致性）');
    });
  });
});
