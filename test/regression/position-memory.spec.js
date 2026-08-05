// JRead — regression spec: 閱讀位置記憶（v0.8.40）
//
// 功能：文章看到一半離開時記住閱讀位置（捲動模式記段落簽名 + 進度比例、
// 翻頁模式記頁碼 + 總頁數，存 browser.storage.local），效期內
// （settings.positionMemoryDays，預設 3 天、上限 7、0 = 停用）重新進入
// 閱讀模式自動回到上次位置。
//
// 訊號層次（本 spec 驗 X、不驗 Y）：
//   驗：純邏輯（效期 / 淘汰 / 段落簽名比對 / 頁碼換算 / 該不該存 /
//       computeNextMap 算寫入 payload）、模組 API 形狀、main.js wiring 的
//       結構性順序（beginSession 在 installKeyguard 前、endSession 在
//       pagedMode.uninstall 前）、persistNow 同步寫入路徑的結構（memMap
//       分支的 set 在 localGet 之前）、manifest 載入順序、settings-defaults /
//       options 欄位接線、跨檔鏡像字面值（DEFAULT_DAYS / REST_FRACTION）。
//   不驗：真實瀏覽器的 storage.local 寫入 / scrollTop 回復 / goToPage 視覺
//       落點（jsdom 無 layout）——那層由 Playwright harness 驗；iOS Safari
//       背景化凍結 event loop 的真實時序只能真機 / TestFlight 觀察（本 spec
//       只驗「flush 的關鍵 set 不依賴 async 讀回」這個結構性前提）。

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

describe('position-memory — blockSignature 消毒孤兒 surrogate（v1.0.14 iOS 寫入卡死防護）', () => {
  it('合法代理對（emoji）保留', () => {
    assert.strictEqual(pm.blockSignature('a😀b'), 'a😀b');
  });
  it('孤兒高位 surrogate 移除', () => {
    assert.strictEqual(pm.blockSignature('ok\uD83D'), 'ok');
  });
  it('孤兒低位 surrogate 移除', () => {
    assert.strictEqual(pm.blockSignature('x\uDE00y'), 'xy');
  });
  it('slice 在第 120 字切斷代理對 → 孤兒高位被移除（不殘留非法 UTF-16）', () => {
    const s = 'a'.repeat(119) + '😀'; // slice(0,120) 會切到代理對中間
    assert.strictEqual(pm.blockSignature(s), 'a'.repeat(119));
  });
  it('消毒後再消毒為冪等（結果保證 well-formed）', () => {
    const sig = pm.blockSignature('hi\uD800中\uDC00文😀');
    assert.strictEqual(sig, pm.stripLoneSurrogates(sig));
  });
});

describe('position-memory — writeWithSelfHeal（整包寫入失敗自癒，v1.0.14）', () => {
  const KEY = 'https://x/a';
  const ENTRY = { ts: 1, mode: 'scroll', ratio: 0.5 };
  const FULL = { [KEY]: ENTRY, 'https://x/b': { ts: 2 } };

  it('寫入成功 → ok，只呼叫一次、payload 是整包 map', async () => {
    const calls = [];
    const setter = (obj) => { calls.push(obj); return Promise.resolve(); };
    const r = await pm.writeWithSelfHeal(setter, KEY, ENTRY, FULL);
    assert.strictEqual(r, 'ok');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { readingPositions: FULL });
  });

  it('整包失敗、最小寫入成功 → healed，第二次只寫當前這一筆（丟歷史 map）', async () => {
    const calls = [];
    const setter = (obj) => {
      calls.push(obj);
      return calls.length === 1 ? Promise.reject(new Error('serialize')) : Promise.resolve();
    };
    const r = await pm.writeWithSelfHeal(setter, KEY, ENTRY, FULL);
    assert.strictEqual(r, 'healed');
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[1], { readingPositions: { [KEY]: ENTRY } },
      '自癒只寫當前 entry——一筆壞歷史資料不再卡死後續存檔');
  });

  it('兩次都失敗 → failed', async () => {
    const setter = () => Promise.reject(new Error('wedged'));
    const r = await pm.writeWithSelfHeal(setter, KEY, ENTRY, FULL);
    assert.strictEqual(r, 'failed');
  });

  it('刪除情境（無當前 entry）整包失敗 → failed，不嘗試最小寫入', async () => {
    const calls = [];
    const setter = (obj) => { calls.push(obj); return Promise.reject(new Error('x')); };
    const r = await pm.writeWithSelfHeal(setter, KEY, null, FULL);
    assert.strictEqual(r, 'failed');
    assert.strictEqual(calls.length, 1);
  });
});

describe('position-memory — computeNextMap（記憶體 map 算寫入 payload，v1.5.9 iOS 同步寫入）', () => {
  const now = 1000 * DAY;
  it('shouldPersist 為 true → next 含當前 entry（帶 ts）、回該 entry', () => {
    const r = pm.computeNextMap({}, 'k', { mode: 'paged', page: 5, pages: 20 }, now, 3, 100);
    assert.deepStrictEqual(r.next.k, { ts: now, mode: 'paged', page: 5, pages: 20 });
    assert.strictEqual(r.entry, r.next.k);
  });
  it('回到開頭（shouldPersist false）→ 刪掉 key、回 null entry', () => {
    const r = pm.computeNextMap({ k: { ts: now - 1, mode: 'paged', page: 3 } }, 'k',
      { mode: 'paged', page: 0 }, now, 3, 100);
    assert.strictEqual(r.next.k, undefined, '第 1 頁清掉舊記錄');
    assert.strictEqual(r.entry, null);
  });
  it('順手 prune 過期 + 超量（沿用 pruneMap），不 mutate 原 map', () => {
    const src = { old: { ts: now - 9 * DAY }, fresh: { ts: now - 1 } };
    const r = pm.computeNextMap(src, 'k', { mode: 'paged', page: 2, pages: 5 }, now, 7, 100);
    assert.strictEqual(r.next.old, undefined, '過期 entry 被 prune');
    assert.ok(r.next.fresh, '新鮮 entry 保留');
    assert.ok(r.next.k, '當前 entry 寫入（prune 後才加，不被自己過期判定誤殺）');
    assert.ok(src.k === undefined && src.old, '原 map 不可被 mutate');
  });
  it('null map 安全（memMap 尚未 seed 的退化輸入）', () => {
    const r = pm.computeNextMap(null, 'k', { mode: 'scroll', ratio: 0.5 }, now, 3, 100);
    assert.ok(r.next.k);
  });
});

describe('position-memory — persistNow 同步寫入路徑（iOS 背景凍結防護，v1.5.9）', () => {
  it('persistNow 有 memMap 同步分支：先 computeNextMap + writeWithSelfHeal、才退 localGet', () => {
    const m = PM_SRC.match(/function persistNow\(\)[\s\S]*?\n  \}/);
    assert.ok(m, 'position-memory.js 必須有 persistNow');
    const body = m[0];
    assert.ok(/if \(memMap\)/.test(body), 'persistNow 必須有 memMap 同步分支');
    const firstWrite = body.indexOf('writeWithSelfHeal(rawSet');
    const firstGet = body.indexOf('localGet(');
    assert.ok(firstWrite !== -1, 'persistNow 必須呼叫 writeWithSelfHeal');
    assert.ok(firstGet !== -1, 'persistNow 必須保留 localGet 退路（memMap 未 seed 時）');
    assert.ok(firstWrite < firstGet,
      '同步 set 必須在 localGet 之前——flush 的關鍵寫入不可依賴 async 讀回（iOS 背景化會凍結 event loop、localGet 回呼永遠等不到）');
  });
  it('restore 會 seed memMap、endSession / setDays 停用會清回 null', () => {
    assert.ok(/function restore[\s\S]*?memMap = map/.test(PM_SRC),
      'restore 必須 seed memMap（之後寫入走同步路徑）');
    const end = PM_SRC.match(/function endSession\(\)[\s\S]*?\n  \}/);
    assert.ok(end && /memMap = null/.test(end[0]),
      'endSession 必須清 memMap（避免跨 session 用到舊快照）');
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
    // v1.7.41（P3b）：exit 路徑改傳 { deferScrollRestore: true }，比對不含引數
    const uninstall = body.indexOf('NS.pagedMode.uninstall(');
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
    // v0.8.158：number clamp case 起頭從 'fontSize' 改 'spaceScrollRatio'
    //（theme/fontSize/contentWidth/fontWeight 已移到 popup）
    const numCase = OPTIONS_SRC.match(/case 'spaceScrollRatio':[\s\S]*?return n;/);
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
