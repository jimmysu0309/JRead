// JRead — 全面 review 批次 4：styler 一致性收斂（v1.7.42）
//
// S3：作者行前綴 regex 兩處各寫一份（同一份事實雙實作）——LCA seed 的
//     authorEl 版有 \b、prevSib 相鄰作者列版漏 \b（「Bypass the noise…」開頭
//     誤命中 by）。修法：抽 BYLINE_AUTHOR_PREFIX_RE 常數兩處共用 + 拉丁
//     alternatives 收尾 \b。
// S4：byline root 硬寫 text-align:left，違反 v1.6.24 RTL 政策——RTL 頁 byline
//     應貼行起始側。修法：改 start（LTR 下 start === left、行為不變）。
// S5：themeOf 非法值 fallback 硬寫 THEMES.light，而 DEFAULTS.theme 是 gray——
//     storage 損壞時使用者拿到的主題與「從未設定過」不一致。修法：
//     THEMES[DEFAULTS.theme]。
//
// S3 的 regex 行為用「從原始碼抓出常數字面值再 eval」驗——spec 內不重抄一份
// pattern（重抄就失去 forcing 意義，兩份 pattern 又會 drift）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const STYLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8'
);

describe('review-b4 S3 — 作者行前綴 regex 合一（v1.7.42）', () => {
  it('必須宣告 BYLINE_AUTHOR_PREFIX_RE 共用常數', () => {
    assert.match(STYLER_SRC, /const\s+BYLINE_AUTHOR_PREFIX_RE\s*=/,
      '作者行前綴判定必須抽共用常數（原本兩處各寫一份、drift 出漏 \\b bug）');
  });

  it('兩個使用點都必須引用常數（不可殘留 inline regex）', () => {
    const uses = (STYLER_SRC.match(/BYLINE_AUTHOR_PREFIX_RE\.test\(/g) || []).length;
    assert.ok(uses >= 2,
      `authorEl 偵測與 prevSib 作者列兩處都必須用共用常數（實際 ${uses} 處）`);
    assert.ok(!/\/\^\(by\|words by\|written by\)/.test(STYLER_SRC),
      '不可殘留舊的 inline 作者前綴 regex（無 CJK 版）');
    assert.ok(!/\/\^\(by\|words by\|written by\|作者/.test(STYLER_SRC),
      '不可殘留舊的 inline 作者前綴 regex（漏 \\b 版）');
  });

  it('regex 行為：拉丁前綴需字界、CJK 前綴照收、Bypass 不誤中', () => {
    const m = STYLER_SRC.match(/const\s+BYLINE_AUTHOR_PREFIX_RE\s*=\s*(\/.+\/[a-z]*);/);
    assert.ok(m, '必須能抓到 BYLINE_AUTHOR_PREFIX_RE 字面值');
    // eslint-disable-next-line no-eval
    const re = eval(m[1]);
    assert.ok(re.test('By John Doe'), '「By John Doe」必須命中');
    assert.ok(re.test('Words by Jane'), '「Words by Jane」必須命中');
    assert.ok(re.test('作者王小明'), '「作者王小明」必須命中（CJK 不受 \\b 影響）');
    assert.ok(re.test('文／王小明'), '「文／王小明」必須命中');
    assert.ok(!re.test('Bypass the noise with this tool'),
      '「Bypass…」不可誤命中（漏 \\b 的原 bug——會把普通段落誤標成作者行）');
    assert.ok(!re.test('Byline styles vary'),
      '「Byline…」不可誤命中');
  });
});

describe('review-b4 S4 — byline root text-align RTL 相容（v1.7.42）', () => {
  it('byline root 必須用 text-align: start（不可硬寫 left）', () => {
    assert.match(STYLER_SRC, /text-align:\s*start\s*!important/,
      'byline root 必須用 start（RTL 頁貼行起始側；LTR 行為不變）');
    // 全檔不可再有 byline 情境的 text-align: left !important（v1.6.24 RTL 政策）
    assert.ok(!/text-align:\s*left\s*!important/.test(STYLER_SRC),
      'styler 注入 CSS 不可硬寫 text-align: left !important（違反 RTL 政策）');
  });
});

describe('review-b4 S5 — themeOf fallback 對齊 DEFAULTS.theme（v1.7.42）', () => {
  it('themeOf 非法值必須退 THEMES[DEFAULTS.theme]（不可硬寫 light）', () => {
    const m = STYLER_SRC.match(/function\s+themeOf\s*\(\s*name\s*\)\s*\{([\s\S]*?)\n\s*\}/);
    assert.ok(m, '必須能抓到 themeOf body');
    assert.match(m[1], /THEMES\[name\]\s*\|\|\s*THEMES\[DEFAULTS\.theme\]/,
      'fallback 必須走 DEFAULTS.theme 單一資料源——預設主題改版時 fallback 自動跟上');
    assert.ok(!/\|\|\s*THEMES\.light/.test(m[1]),
      '不可硬寫 THEMES.light（DEFAULTS.theme 已是 gray，兩者 drift）');
  });
});
