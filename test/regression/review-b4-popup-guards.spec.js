// JRead — 全面 review 批次 4：popup 防護（v1.7.42）
//
// R3：storage.sync.get resolve 前 current 仍是 DEFAULT_SETTINGS，stepper /
//     Auto 切換這類「以 current 為基準的相對操作」此時點擊會以預設值算絕對值
//     寫回（實際 fontSize 24 時按 + 卻寫回 20 = 倒退）。修法：settingsReady
//     gate——get resolve（含 reject）前相對操作 handler 一律 no-op。
// R4：autoDomainCb 寫入失敗完全靜默（.catch 吞掉），與 options 同欄位「儲存
//     失敗」提示不一致；autoEnableDomains 是唯一無上限成長的 sync 欄位
//     （QUOTA_BYTES_PER_ITEM 8KB），失敗是真實可達路徑。修法：失敗還原
//     checkbox + statusEl 訊息。
//
// 本 spec 是 forcing function（靜態原始碼斷言）：popup 事件時序需真 Chrome
// 才能完整重現，這裡守住「防護程式碼存在且未被改回舊寫法」這層。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const POPUP_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'), 'utf8'
);

describe('review-b4 R3 — popup stepper settingsReady gate（v1.7.42）', () => {
  it('必須宣告 settingsReady flag（初始 false）', () => {
    assert.match(POPUP_SRC, /let\s+settingsReady\s*=\s*false/,
      'popup.js 必須宣告 `let settingsReady = false`');
  });

  it('storage.sync.get(DEFAULT_SETTINGS) 的 then 與 catch 都必須解鎖', () => {
    const m = POPUP_SRC.match(
      /browser\.storage\.sync\.get\(DEFAULT_SETTINGS\)\.then\(\(values\) => \{([\s\S]*?)\}\)\.catch\(\(\) => \{([\s\S]*?)\}\)/
    );
    assert.ok(m, '必須能抓到 storage.sync.get(DEFAULT_SETTINGS) 的 then/catch 區塊');
    assert.match(m[1], /settingsReady\s*=\s*true/,
      'then 內必須設 settingsReady = true');
    assert.match(m[2], /settingsReady\s*=\s*true/,
      'catch 內也必須設 settingsReady = true——get 失敗時 stepper 不可永久卡死');
  });

  it('相對操作 handler 的 guard 至少 15 處（stepper ×10 + Auto ×4 + latin select）', () => {
    const count = (POPUP_SRC.match(/if \(!settingsReady\) return;/g) || []).length;
    assert.ok(count >= 15,
      `相對操作 guard 應 >= 15 處（font/title/lh/ps 各 dec+inc+auto、width dec+inc、latin select），實際 ${count}`);
  });
});

describe('review-b4 R4 — autoDomainCb 寫入失敗回饋（v1.7.42）', () => {
  it('必須宣告 revertAutoDomainCb（還原 checkbox + statusEl 提示）', () => {
    const m = POPUP_SRC.match(/function\s+revertAutoDomainCb\s*\(\s*wantOn\s*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, 'popup.js 必須宣告 revertAutoDomainCb(wantOn)');
    assert.match(m[1], /autoDomainCb\.checked\s*=\s*!wantOn/,
      '失敗時必須把 checkbox 還原成使用者操作前的狀態');
    assert.match(m[1], /statusEl\.textContent/,
      '失敗時必須在 statusEl 顯示提示（不可靜默）');
    assert.match(m[1], /statusEl\.hidden\s*=\s*false/,
      '必須把 statusEl 顯示出來');
  });

  it('autoDomainCb change handler 的 set 失敗與 get 失敗都必須走 revert', () => {
    const start = POPUP_SRC.indexOf("autoDomainCb.addEventListener('change'");
    assert.ok(start >= 0, '必須能定位 autoDomainCb change handler');
    const seg = POPUP_SRC.slice(start, start + 1200);
    const reverts = (seg.match(/revertAutoDomainCb\(wantOn\)/g) || []).length;
    assert.ok(reverts >= 2,
      `set 的 .catch 與外層 get 的 .catch 都必須呼叫 revertAutoDomainCb（實際 ${reverts} 處）`);
    assert.ok(!/p\.catch\(\(\) => \{\}\)/.test(seg),
      'change handler 內不可再有吞掉錯誤的空 catch（舊寫法）');
  });
});
