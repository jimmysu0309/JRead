// JRead — regression spec: 閱讀位置記憶（v0.8.40）
//
// 功能：文章看到一半離開時記住閱讀位置（捲動模式記段落簽名 + 進度比例、
// 翻頁模式記頁碼 + 總頁數，存 chrome.storage.local），效期內
// （settings.positionMemoryDays，預設 3 天、上限 7、0 = 停用）重新進入
// 閱讀模式自動回到上次位置。
//
// 訊號層次（本 spec 驗 X、不驗 Y）：
//   驗：純邏輯（效期 / 淘汰 / 段落簽名比對 / 頁碼換算 / 該不該存）、
//       模組 API 形狀、main.js wiring 的結構性順序（beginSession 在
//       installKeyguard 前、endSession 在 pagedMode.uninstall 前）、
//       manifest 載入順序、settings-defaults / options 欄位接線、
//       跨檔鏡像字面值（DEFAULT_DAYS / REST_FRACTION）。
//   不驗：真實瀏覽器的 storage.local 寫入 / scrollTop 回復 / goToPage 視覺
//       落點（jsdom 無 layout）——那層由 Playwright harness 驗；pagehide
//       flush 的時序只能實機觀察。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const JREAD_DIR = path.join(__dirname, '..', '..', 'jread');
const pm = require(path.join(JREAD_DIR, 'content', 'position-memory.js'));

const PM_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'position-memory.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'main.js'), 'utf8');
const PAGED_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'paged-mode.js'), 'utf8');
const SPACE_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'space-scroll.js'), 'utf8');
const DEFAULTS = require(path.join(JREAD_DIR, 'content', 'settings-defaults.js'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(JREAD_DIR, 'manifest.json'), 'utf8'));
const OPTIONS_HTML = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.html'), 'utf8');
const OPTIONS_SRC = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.js'), 'utf8');

const DAY = 86400000;

describe('position-memory — clampDays（效期消毒）', () => {
  it('預設 3、上限 7、下限 0', () => {
    assert.strictEqual(pm.DEFAULT_DAYS, 3);
    assert.strictEqual(pm.MAX_DAYS, 7);
    assert.strictEqual(pm.clampDays(3), 3);
    assert.strictEqual(pm.clampDays(7), 7);
    assert.strictEqual(pm.clampDays(99), 7, '超過上限 clamp 到 7');
    assert.strictEqual(pm.clampDays(0), 0, '0 = 停用合法值');
    assert.strictEqual(pm.clampDays(-1), 0, '負值 clamp 到 0');
  });

  it('非數字 / 缺值回預設 3（升版舊 storage 沒這欄）', () => {
    assert.strictEqual(pm.clampDays(undefined), 3);
    assert.strictEqual(pm.clampDays(null), 3, 'Number(null)=0 不可誤判——null 是缺值不是停用');
    assert.strictEqual(pm.clampDays('abc'), 3);
    assert.strictEqual(pm.clampDays(NaN), 3);
  });

  it('小數四捨五入成整數天', () => {
    assert.strictEqual(pm.clampDays(2.6), 3);
  });
});

describe('position-memory — isFresh（效期判定）', () => {
  const now = 1000 * DAY;
  it('效期內 fresh、效期外過期', () => {
    assert.strictEqual(pm.isFresh({ ts: now - 2 * DAY }, now, 3), true);
    assert.strictEqual(pm.isFresh({ ts: now - 3 * DAY }, now, 3), false, '恰好滿 3 天 = 過期');
    assert.strictEqual(pm.isFresh({ ts: now - 1 }, now, 3), true);
  });
  it('days = 0（停用）一律不 fresh', () => {
    assert.strictEqual(pm.isFresh({ ts: now }, now, 0), false);
  });
  it('壞 entry（缺 ts / null）不 fresh', () => {
    assert.strictEqual(pm.isFresh(null, now, 3), false);
    assert.strictEqual(pm.isFresh({}, now, 3), false);
    assert.strictEqual(pm.isFresh({ ts: 'x' }, now, 3), false);
  });
});

describe('position-memory — pruneMap（過期 + 超量淘汰）', () => {
  const now = 1000 * DAY;
  it('過期 entry 淘汰、新鮮 entry 保留', () => {
    const out = pm.pruneMap({
      a: { ts: now - 1 * DAY },
      b: { ts: now - 9 * DAY }
    }, now, 7, 100);
    assert.ok(out.a, '1 天前的保留');
    assert.strictEqual(out.b, undefined, '9 天前的淘汰');
  });
  it('超量時舊的先丟', () => {
    const map = {};
    for (let i = 0; i < 5; i++) map['k' + i] = { ts: now - i * 1000 };
    const out = pm.pruneMap(map, now, 7, 3);
    assert.deepStrictEqual(Object.keys(out).sort(), ['k0', 'k1', 'k2'], '留最新 3 筆');
  });
  it('不 mutate 原 map、空 / null 輸入安全', () => {
    const map = { a: { ts: now - 9 * DAY } };
    pm.pruneMap(map, now, 7, 100);
    assert.ok(map.a, '原 map 不可被改');
    assert.deepStrictEqual(pm.pruneMap(null, now, 7, 100), {});
  });
});

describe('position-memory — findBlockIndex（段落簽名比對）', () => {
  const sigs = ['第一段', '第二段', '重複句', '第四段', '重複句'];
  it('簽名相符直接命中', () => {
    assert.strictEqual(pm.findBlockIndex(sigs, 1, '第二段'), 1);
  });
  it('簽名重複時取離儲存 index 最近者', () => {
    assert.strictEqual(pm.findBlockIndex(sigs, 5, '重複句'), 4);
    assert.strictEqual(pm.findBlockIndex(sigs, 1, '重複句'), 2);
  });
  it('簽名找不到（內容改版）退儲存 index', () => {
    assert.strictEqual(pm.findBlockIndex(sigs, 3, '已被改掉的段落'), 3);
  });
  it('簽名空（圖片單位）且 index 合法 → 用 index', () => {
    assert.strictEqual(pm.findBlockIndex(sigs, 2, ''), 2);
  });
  it('都不行回 -1（caller 退進度比例）', () => {
    assert.strictEqual(pm.findBlockIndex(sigs, 99, '不存在'), -1);
    assert.strictEqual(pm.findBlockIndex([], 0, ''), -1);
  });
  it('blockSignature collapse 空白 + 截斷', () => {
    assert.strictEqual(pm.blockSignature('  a\n  b\tc  '), 'a b c');
    assert.strictEqual(pm.blockSignature('x'.repeat(500)).length, 120);
    assert.strictEqual(pm.blockSignature(null), '');
  });
});

describe('position-memory — resolvePageIndex（頁碼回復）', () => {
  it('總頁數沒變 → 直接用儲存頁碼', () => {
    assert.strictEqual(pm.resolvePageIndex({ mode: 'paged', page: 5, pages: 20, ratio: 5 / 19 }, 20), 5);
  });
  it('總頁數變了（重新分頁）→ 按進度比例換算', () => {
    const n = pm.resolvePageIndex({ mode: 'paged', page: 10, pages: 21, ratio: 0.5 }, 41);
    assert.strictEqual(n, 20, 'ratio 0.5 × (41-1) = 20');
  });
  it('跨模式（捲動 entry 回到翻頁模式）→ 比例換算', () => {
    assert.strictEqual(pm.resolvePageIndex({ mode: 'scroll', ratio: 1 }, 10), 9);
  });
  it('退化輸入回 0（單頁 / 壞 ratio / null entry）', () => {
    assert.strictEqual(pm.resolvePageIndex({ mode: 'paged', page: 3, pages: 5 }, 1), 0);
    assert.strictEqual(pm.resolvePageIndex({ mode: 'scroll', ratio: 'x' }, 10), 0);
    assert.strictEqual(pm.resolvePageIndex(null, 10), 0);
  });
  it('儲存頁碼超界 clamp（lazy-load 縮頁後）', () => {
    assert.strictEqual(pm.resolvePageIndex({ mode: 'paged', page: 50, pages: 10, ratio: 1 }, 10), 9);
  });
});

describe('position-memory — shouldPersist（開頭不記）', () => {
  it('翻頁第 1 頁不記、第 2 頁起記', () => {
    assert.strictEqual(pm.shouldPersist({ mode: 'paged', page: 0 }), false);
    assert.strictEqual(pm.shouldPersist({ mode: 'paged', page: 1 }), true);
  });
  it('捲動開頭（ratio 低 + 段落 0）不記', () => {
    assert.strictEqual(pm.shouldPersist({ mode: 'scroll', ratio: 0.01, blockIndex: 0 }), false);
    assert.strictEqual(pm.shouldPersist({ mode: 'scroll', ratio: 0.5, blockIndex: 0 }), true);
    assert.strictEqual(pm.shouldPersist({ mode: 'scroll', ratio: 0, blockIndex: 3 }), true,
      '短文 maxTop=0 時 ratio 恆 0，段落 index 是唯一進度訊號');
    assert.strictEqual(pm.shouldPersist(null), false);
  });
});

describe('position-memory — 模組 API 形狀', () => {
  it('session API 齊備', () => {
    for (const fn of ['beginSession', 'endSession', 'setDays', 'isTracking']) {
      assert.strictEqual(typeof pm[fn], 'function', fn + ' 必須存在');
    }
  });
  it('paged-mode 提供 getPosition / goToPage（restore / flush 依賴）', () => {
    const paged = require(path.join(JREAD_DIR, 'content', 'paged-mode.js'));
    assert.strictEqual(typeof paged.getPosition, 'function');
    assert.strictEqual(typeof paged.goToPage, 'function');
  });
  it('space-scroll 提供 getBlocks / currentAnchor / anchorTo（段落收集單一資料源）', () => {
    // space-scroll 是 IIFE、無 module.exports——source 層驗 NS.spaceScroll
    // 匯出表含三個新 API（getBlocks 直接掛 collectBlocks reference）
    const exportBlock = SPACE_SRC.match(/NS\.spaceScroll\s*=\s*\{[\s\S]*?\};/);
    assert.ok(exportBlock, 'space-scroll.js 必須有 NS.spaceScroll 匯出表');
    for (const key of ['getBlocks', 'currentAnchor', 'anchorTo']) {
      assert.ok(exportBlock[0].includes(key), 'NS.spaceScroll 必須匯出 ' + key);
    }
    assert.ok(/function\s+collectBlocks\s*\(rootEl\)/.test(SPACE_SRC),
      'collectBlocks 必須接受 rootEl 參數（position-memory 對指定容器收段落）');
  });
});

describe('position-memory — main.js wiring（結構性順序）', () => {
  it('finalizeEnter：beginSession 在 syncPagedModeFromSettings 之後、installKeyguard 之前', () => {
    const m = MAIN_SRC.match(/function finalizeEnter[\s\S]*?\n  \}/);
    assert.ok(m, 'main.js 必須有 finalizeEnter');
    const body = m[0];
    const sync = body.indexOf('syncPagedModeFromSettings(settings)');
    const begin = body.indexOf('positionMemory.beginSession');
    const keyguard = body.indexOf('installKeyguard()');
    assert.ok(sync !== -1 && begin !== -1 && keyguard !== -1, '三個呼叫都必須在 finalizeEnter 內');
    assert.ok(sync < begin,
      'beginSession 必須在 syncPagedMode 之後（翻頁模組裝好、頁數算好才能 goToPage）');
    assert.ok(begin < keyguard,
      'beginSession 必須在 installKeyguard 之前（keydown listener 先於 keyguard 註冊——keyguard stopImmediatePropagation 會吃掉翻頁鍵）');
  });

  it('exitReaderModeImpl：endSession 在 pagedMode.uninstall 與 styler.restore 之前', () => {
    const m = MAIN_SRC.match(/function exitReaderModeImpl[\s\S]*?\n  \}/);
    assert.ok(m, 'main.js 必須有 exitReaderModeImpl');
    const body = m[0];
    const end = body.indexOf('positionMemory.endSession');
    const uninstall = body.indexOf('NS.pagedMode.uninstall()');
    const restore = body.indexOf('NS.styler.restore');
    assert.ok(end !== -1, 'exitReaderModeImpl 必須呼叫 endSession（flush 最後位置）');
    assert.ok(end < uninstall,
      'endSession 必須在 pagedMode.uninstall 之前（uninstall 把頁碼歸零，flush 會存到第 1 頁）');
    assert.ok(end < restore,
      'endSession 必須在 styler.restore 之前（restore 後捲動位置是原站排版、非 reader 位置）');
  });

  it('storage.onChanged：positionMemoryDays 走 setDays、不觸發 styler reapply', () => {
    assert.ok(/'positionMemoryDays' in changes[\s\S]{0,120}setDays/.test(MAIN_SRC),
      'onChanged 必須把 positionMemoryDays 餵給 NS.positionMemory.setDays');
    const relevantMatch = MAIN_SRC.match(/const relevantKeys = \[[^\]]*\]/);
    assert.ok(relevantMatch && !relevantMatch[0].includes('positionMemoryDays'),
      'positionMemoryDays 不可列入 reapply relevantKeys（純追蹤層、不影響排版）');
  });
});

describe('position-memory — 註冊與設定接線', () => {
  it('manifest content_scripts：position-memory.js 在 paged-mode.js 之後、main.js 之前', () => {
    const files = MANIFEST.content_scripts[0].js;
    const pmIdx = files.indexOf('content/position-memory.js');
    assert.ok(pmIdx !== -1, 'manifest 必須註冊 content/position-memory.js');
    assert.ok(files.indexOf('content/paged-mode.js') < pmIdx, '在 paged-mode.js 之後');
    assert.ok(pmIdx < files.indexOf('content/main.js'), '在 main.js 之前');
  });

  it('settings-defaults：positionMemoryDays 預設 3、與模組 DEFAULT_DAYS 同值', () => {
    assert.strictEqual(DEFAULTS.positionMemoryDays, 3);
    assert.strictEqual(DEFAULTS.positionMemoryDays, pm.DEFAULT_DAYS,
      'settings-defaults 與 position-memory DEFAULT_DAYS 是同一份事實的鏡像');
  });

  it('options：number input [0,7] + fields / readFieldFromDom 接線', () => {
    assert.ok(/id="positionMemoryDays"\s+min="0"\s+max="7"\s+step="1"/.test(OPTIONS_HTML),
      'options.html 必須有 positionMemoryDays number input（min 0 / max 7）');
    const fieldsMatch = OPTIONS_SRC.match(/const fields = \[[^\]]*\]/);
    assert.ok(fieldsMatch && fieldsMatch[0].includes('positionMemoryDays'),
      'options.js fields 必須含 positionMemoryDays（change 寫入 + onChanged 回灌）');
    const numCase = OPTIONS_SRC.match(/case 'fontSize':[\s\S]*?return n;/);
    assert.ok(numCase && numCase[0].includes("case 'positionMemoryDays'"),
      'readFieldFromDom 必須把 positionMemoryDays 走 number clamp case');
  });

  it('REST_FRACTION 與 space-scroll 鏡像字面值一致', () => {
    const m = SPACE_SRC.match(/const REST_FRACTION = ([\d.]+)/);
    assert.ok(m, 'space-scroll.js 必須有 REST_FRACTION');
    assert.strictEqual(pm.REST_FRACTION, Number(m[1]),
      '回復落點與 Space 卷動落點是同一份視覺事實（兩檔鏡像，改其一必同步）');
  });
});
