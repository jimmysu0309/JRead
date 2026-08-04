// JRead — regression spec: floatingIconSize 預設值四處 drift（v1.7.37 修）
// -----------------------------------------------------------------------------
// Bug（v1.7.37 發現）：v0.8.166 把 floatingIconSize 預設從 'small' 改成 'medium'
//（settings-defaults.js + content/floating-icon.js applySize 都改了），但另外三處
// 沒跟上，形成 CLAUDE.md 工作流原則 5 講的「同一份事實多條 path 各自處理」：
//   1. options.js readFieldFromDom  ——「無勾選 / 非法值」硬寫退回 'small'
//   2. options.js applyFieldToDom   —— 同上
//   3. options.js updateOpacityDemo —— 預覽 icon 大小同上
//   4. options.html desc 文字       ——「小 = 16px（預設）」標錯了哪個是預設
//   （floating-icon.js 頂端註解也還寫著 small 是預設）
//
// 使用者可見後果：radio 群處於「全未勾選」的損壞狀態時（storage 存了非法值、
// 或 DOM 尚未 applyFieldToDom 就觸發 change），options 會把 small 寫回 storage，
// 而 content 端 applySize 對同一份損壞資料是退 medium——兩端對「預設多大」的
// 答案不一致。desc 文字則是直接對使用者說錯話。
//
// 修法：options 三處 fallback 一律走 DEFAULTS.floatingIconSize（不再有第二份
// 預設值 literal）、desc 與註解同步。本 spec 是防止再 drift 的 forcing function。
//
// 訊號層次：驗「options 讀寫 path 的 fallback 值」與「文件標示」兩層。
// 不驗真實瀏覽器裡 icon 的實際像素大小（那是 floating-icon.spec.js 的守備範圍）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { JREAD_DIR } = require('../helpers');

const OPTIONS_HTML = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.html'), 'utf8');
const OPTIONS_JS = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.js'), 'utf8');
const FLOATING_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'floating-icon.js'), 'utf8');
const SRC_DEFAULTS = fs.readFileSync(path.join(JREAD_DIR, 'content', 'settings-defaults.js'), 'utf8');
const SRC_DOMAIN = fs.readFileSync(path.join(JREAD_DIR, 'content', 'domain-match.js'), 'utf8');
const SRC_SHORTCUTS = fs.readFileSync(path.join(JREAD_DIR, 'content', 'shortcut-utils.js'), 'utf8');
const SRC_OPTIONS = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.js'), 'utf8');
const SHARED = require(path.join(JREAD_DIR, 'content', 'settings-defaults.js'));

// 尺寸值 → desc 裡的中文標籤（desc 用「小 / 中 / 大」，storage 用英文）
const SIZE_LABEL = { small: '小', medium: '中', large: '大' };

function _syncResolved(value) {
  return {
    then(onF) {
      if (typeof onF !== 'function') return _syncResolved(value);
      let r; try { r = onF(value); } catch (e) { return _syncResolved(undefined); }
      return (r && typeof r.then === 'function') ? r : _syncResolved(r);
    },
    catch() { return this; }
  };
}

function buildOptionsEnv(storeOverride) {
  const dom = new JSDOM(OPTIONS_HTML, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const setCalls = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.0.0-test' }),
      id: 'test-ext',
      getURL: () => 'chrome-extension://test-ext/'
    },
    storage: {
      sync: {
        get: (defaults) => _syncResolved({ ...defaults, ...(storeOverride || {}) }),
        set: (patch) => { setCalls.push(patch); return _syncResolved(undefined); }
      },
      onChanged: { addListener: () => {} }
    }
  };
  window.eval(SRC_DEFAULTS);
  window.eval(SRC_DOMAIN);
  window.eval(SRC_SHORTCUTS);
  window.eval(SRC_OPTIONS);
  return { window, document: window.document, setCalls };
}

describe('floatingIconSize 預設值 drift（v1.7.37）', () => {

  describe('前提：單一資料源的預設值', () => {
    it('DEFAULT_SETTINGS.floatingIconSize 是 medium（v0.8.166 起）', () => {
      assert.strictEqual(SHARED.floatingIconSize, 'medium');
    });

    it('content 端 applySize 對未知值退回 SIZE_MAP.medium', () => {
      assert.match(FLOATING_SRC, /const s = SIZE_MAP\[v\] \|\| SIZE_MAP\.medium;/,
        'content 端 fallback 必須是 medium（options 端要跟這個一致）');
    });
  });

  describe('options 讀寫 path 的 fallback 必須等於 DEFAULTS（不是硬寫 small）', () => {
    it('radio 全未勾選時觸發存檔 → 寫入 DEFAULTS 而非 small', () => {
      const { window, document, setCalls } = buildOptionsEnv();
      const group = document.getElementById('floatingIconSize');
      assert.ok(group, 'options.html 必須有 floatingIconSize radio 群');
      // 模擬損壞狀態：radio 全部取消勾選
      group.querySelectorAll('input[name="floatingIconSize"]').forEach((r) => { r.checked = false; });
      setCalls.length = 0;
      group.dispatchEvent(new window.Event('change', { bubbles: true }));

      const call = setCalls.find((c) => 'floatingIconSize' in c);
      assert.ok(call, 'change 必須觸發 floatingIconSize 存檔');
      assert.strictEqual(call.floatingIconSize, SHARED.floatingIconSize,
        `無勾選時必須退回 DEFAULTS（${SHARED.floatingIconSize}），不可硬寫 small`);
    });

    it('storage 存了非法值 → 載入時勾選 DEFAULTS 對應的 radio', () => {
      const { document } = buildOptionsEnv({ floatingIconSize: 'gigantic' });
      const checked = document.querySelector('input[name="floatingIconSize"]:checked');
      assert.ok(checked, '必須有一顆被勾選');
      assert.strictEqual(checked.value, SHARED.floatingIconSize,
        '非法值必須退回 DEFAULTS，不可退回 small');
    });

    it('合法值仍照常尊重（不被 fallback 蓋掉）', () => {
      for (const v of ['small', 'medium', 'large']) {
        const { document } = buildOptionsEnv({ floatingIconSize: v });
        assert.strictEqual(
          document.querySelector('input[name="floatingIconSize"]:checked').value, v);
      }
    });

    it('options.js 不得再有硬寫的 small fallback', () => {
      assert.ok(!/:\s*'small';/.test(OPTIONS_JS),
        "options.js 不可有 `= checked ? checked.value : 'small'` 這類硬寫 fallback");
      assert.ok(!/\?\s*v\s*:\s*'small'/.test(OPTIONS_JS),
        "options.js 不可有 `? v : 'small'` 這類硬寫 fallback");
      assert.match(OPTIONS_JS, /const FLOATING_ICON_SIZES = \['small', 'medium', 'large'\];/,
        '白名單應抽成常數，fallback 走 DEFAULTS.floatingIconSize');
    });
  });

  describe('文件標示必須與實際預設一致', () => {
    it('options.html desc 的「（預設）」必須標在 DEFAULTS 對應的尺寸上', () => {
      const m = OPTIONS_HTML.match(/<strong>([小中大])<\/strong> = \d+px（預設）/);
      assert.ok(m, 'desc 必須有且只有一處標示「（預設）」');
      assert.strictEqual(m[1], SIZE_LABEL[SHARED.floatingIconSize],
        `desc 標的預設（${m[1]}）與 DEFAULTS（${SHARED.floatingIconSize} = ${SIZE_LABEL[SHARED.floatingIconSize]}）不符`);
    });

    it('desc 內不可有第二處「（預設）」標示（drift 溫床）', () => {
      const all = OPTIONS_HTML.match(/= \d+px（預設）/g) || [];
      assert.strictEqual(all.length, 1, '尺寸 desc 只能有一處標預設');
    });

    it('floating-icon.js 頂端註解標的預設也必須是 medium', () => {
      const head = FLOATING_SRC.slice(0, 1200);
      assert.ok(/'medium'[^\n]*\n?[^\n]*（\*\*預設\*\*/.test(head) || /medium[\s\S]{0,120}\*\*預設\*\*/.test(head),
        'floating-icon.js 頂端註解必須標明 medium 是預設');
      assert.ok(!/footprint 32×32（預設）/.test(head),
        '註解不可還寫著 small（footprint 32×32）是預設');
    });
  });
});
