// JRead — options 說明文字段落句末不加句號 regression (v0.7.256)
//
// Jimmy 2026-06-08 規則：options 頁的中文說明文字（.desc 欄位提示 /
// .section-desc 區塊說明 / .license 段落）**段落句末不加句號**——句中分句的
// 句號保留，只有「段落最後一個字之後」不放句號。
//
// 本 spec 是 forcing function：偵測「段落結尾緊鄰 block 收尾標籤（</p> /
// </span>）前是句號」的情況。將來有人新增 desc / section-desc 順手在結尾打
// 句號就會 fail。只驗段落『句末』——句中（如 …儲存。Token 從…）的句號因為
// 後面接的是文字、不是 </p>/</span>，不會被本規則命中，正確保留。
//
// 訊號層次（驗 X、不驗 Y）：
//   驗：HTML 原始碼裡段落收尾標籤前不得是句號。
//   不驗：渲染後的視覺、句中句號是否正確、其他標點（？！）——只管段末句號。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const OPTIONS_HTML = fs.readFileSync(path.join(ROOT, 'jread', 'options', 'options.html'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));

describe('options 說明文字段落句末不加句號（v0.7.256）', () => {
  it('段落收尾 </p> 前不得是句號', () => {
    const m = OPTIONS_HTML.match(/。\s*<\/p>/g);
    assert.ok(!m, `有 ${m ? m.length : 0} 個段落以句號結尾（</p> 前）：\n${(m || []).join('\n')}`);
  });

  it('.desc / 段落收尾 </span> 前不得是句號', () => {
    const m = OPTIONS_HTML.match(/。\s*<\/span>/g);
    assert.ok(!m, `有 ${m ? m.length : 0} 個 .desc 段落以句號結尾（</span> 前）：\n${(m || []).join('\n')}`);
  });

  it('manifest description 句末不加句號（Jimmy 2026-07-09 裁定：manifest 描述算 UI 文字）', () => {
    // manifest description 顯示在 chrome://extensions/ 與商店頁，屬使用者
    // 面對的 UI 文字；commands 各項 description 同規則
    const FULL_STOP = '。';
    assert.ok(!MANIFEST.description.endsWith(FULL_STOP),
      'manifest.json description 句末不得是句號');
    for (const [name, cmd] of Object.entries(MANIFEST.commands || {})) {
      if (cmd && typeof cmd.description === 'string') {
        assert.ok(!cmd.description.endsWith(FULL_STOP),
          `manifest.json commands.${name}.description 句末不得是句號`);
      }
    }
  });

  it('句中句號保留（只擋段末，不擋分句）', () => {
    // 反向 sanity：確認規則不是把全部句號刪光。options 說明文字含句中句號
    // （分句用，例如 …儲存。Token 從… / …他說，然後）。純 ASCII…），這些必須
    // 仍在。判準不綁特定字串（避免改文案就 fail）：句號後接「非標籤字元」
    // = 句中句號（段末句號後接的是 </span> / </p>，已被前兩條擋掉）。
    assert.ok(/。[^<\s]/.test(OPTIONS_HTML),
      '所有句中句號都被誤刪——本規則只該移除段末句號');
  });
});
