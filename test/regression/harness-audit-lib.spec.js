// JRead — harness audit-lib 單一資料源合約（v0.8.39）
//
// 背景：debug-harness.js 與 page-rounds-harness.js 各自 copy NOISE_AUDIT_KEYWORDS
// 與 audit 函式，實際發生 drift（keyword 名單不同步、debug 版名單內「貼文」
// 「訂閱」重複、isVisible 全 repo 11 份 copy）。v0.8.39 抽成 tools/audit-lib.js
// 單一資料源；本 spec 是 anti-drift forcing function。
//
// 訊號層次：本 spec 驗（1）keyword 名單無重複、（2）兩支 harness 不得再自帶
// keyword 名單 / isVisible 實作、（3）pageFns 每支函式自包含（toString round-trip
// 後在乾淨 scope 可重建——page.evaluate 序列化的前提，閉包引用會在瀏覽器端
// ReferenceError）、（4）auditResidualText 的文字判定行為（jsdom 可驗的部分）。
// 不驗：依賴 layout 的 audit 行為（gap / contrast / overflow / 寬度——jsdom 無
// layout engine，rect 全 0；這些由 harness 實跑真實站點驗收）、Playwright
// node-side runner（launchExtension 類，e2e 軌）。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const auditLib = require(path.join(TOOLS, 'audit-lib.js'));

describe('harness audit-lib — 單一資料源合約', () => {
  it('NOISE_AUDIT_KEYWORDS 非空且無重複項', () => {
    const kws = auditLib.NOISE_AUDIT_KEYWORDS;
    assert.ok(Array.isArray(kws) && kws.length > 20, '名單應為非空陣列');
    const dupes = kws.filter((k, i) => kws.indexOf(k) !== i);
    assert.deepStrictEqual(dupes, [], `keyword 名單有重複項: ${dupes.join(', ')}`);
  });

  describe('anti-drift：harness 不得自帶 audit 實作', () => {
    for (const file of ['debug-harness.js', 'page-rounds-harness.js']) {
      const src = fs.readFileSync(path.join(TOOLS, file), 'utf8');
      it(`${file} require audit-lib`, () => {
        assert.ok(/require\([^)]*audit-lib/.test(src), `${file} 應 require audit-lib.js`);
      });
      it(`${file} 不得自帶 NOISE_AUDIT_KEYWORDS 名單定義`, () => {
        assert.ok(!/NOISE_AUDIT_KEYWORDS\s*=\s*\[/.test(src),
          `${file} 內發現本地 keyword 名單定義——請改用 audit-lib.js 的單一資料源`);
      });
      it(`${file} 不得自帶 isVisible 實作`, () => {
        assert.ok(!src.includes('function isVisible'),
          `${file} 內發現 inline isVisible——audit 邏輯請放 audit-lib.js`);
      });
    }
  });

  describe('pageFns 自包含性（page.evaluate 序列化前提）', () => {
    // toString round-trip 後在 jsdom window scope 重建並呼叫。函式若引用
    // audit-lib module scope 的任何變數，這裡會 ReferenceError——等價於
    // page.evaluate 送進瀏覽器後炸掉的情境。
    function rebuildInWindow(window, fn) {
      return window.eval(`(${fn.toString()})`);
    }

    it('每支 pageFns 函式 toString round-trip 後可重建', () => {
      const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
      for (const [name, fn] of Object.entries(auditLib.pageFns)) {
        const rebuilt = rebuildInWindow(dom.window, fn);
        assert.strictEqual(typeof rebuilt, 'function', `pageFns.${name} 重建失敗`);
      }
    });

    it('文字類 pageFns 在「無 reader card」的 DOM 下跑不炸、回報 no article', () => {
      // 依賴 layout 的函式 rect 全 0 在 jsdom 下行為無意義，但「跑不炸」
      // 這層仍驗得到（自包含 + 無 jsdom 缺的 API）。
      const dom = new JSDOM('<!DOCTYPE html><body><p>plain page</p></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
      const { window } = dom;
      const textFns = ['auditResidualText', 'auditResidualLinks', 'auditGap', 'auditContrast',
        'auditTail', 'auditNarrowText', 'auditFigcaption', 'auditOverflow',
        'auditContentWidth', 'auditBodyWidthRatio'];
      for (const name of textFns) {
        const rebuilt = rebuildInWindow(window, auditLib.pageFns[name]);
        const res = name === 'auditResidualText' || name === 'auditResidualLinks'
          ? rebuilt(auditLib.NOISE_AUDIT_KEYWORDS)
          : rebuilt();
        assert.ok(res && res.error === 'no article' || res === null || typeof res === 'object',
          `pageFns.${name} 在無 card DOM 下應回報 no article / 安全結構`);
      }
    });

    it('auditResidualText：命中 keyword 的短文字列警告、hidden 與長段落不列', () => {
      const dom = new JSDOM(`<!DOCTYPE html><body>
        <article data-jread-active="1">
          <h1>正常文章標題字樣</h1>
          <p>${'主文長段落內容'.repeat(12)}</p>
          <div class="related-box">延伸閱讀專區</div>
          <span style="display:none">訂閱電子報</span>
          <span data-jread-hidden="1">追蹤我們</span>
        </article>
      </body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
      const rebuilt = dom.window.eval(`(${auditLib.pageFns.auditResidualText.toString()})`);
      const res = rebuilt(auditLib.NOISE_AUDIT_KEYWORDS);
      assert.ok(!res.error, 'reader card 應被找到');
      const warnTexts = res.warnings.map(w => w.text);
      assert.ok(warnTexts.some(t => t.includes('延伸閱讀')),
        `visible「延伸閱讀」應命中警告，實得: ${JSON.stringify(warnTexts)}`);
      assert.ok(!warnTexts.some(t => t.includes('訂閱電子報')), 'display:none 的元素不應列入');
      assert.ok(!warnTexts.some(t => t.includes('追蹤我們')), 'data-jread-hidden 的元素不應列入');
      assert.ok(!res.items.some(i => i.text.includes('主文長段落')), '> 60 chars 長段落不應進 outline');
      // 警告需附 ancestors 資訊（Claude 辨識 DOM 結構用）
      const hit = res.warnings.find(w => w.text.includes('延伸閱讀'));
      assert.ok(hit.parents && hit.parents.length > 0, '命中項應帶 parents ancestor 鏈');
    });

    it('auditResidualLinks：a/button 用 textContent 判定（icon+span 結構不漏）', () => {
      const dom = new JSDOM(`<!DOCTYPE html><body>
        <article data-jread-active="1">
          <p>${'主文長段落內容'.repeat(12)}</p>
          <a href="https://line.me/x"><svg></svg><span>分享給好友</span></a>
          <button class="css-x1y2z3">建立貼文</button>
        </article>
      </body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
      const rebuilt = dom.window.eval(`(${auditLib.pageFns.auditResidualLinks.toString()})`);
      const res = rebuilt(auditLib.NOISE_AUDIT_KEYWORDS);
      assert.ok(!res.error);
      const warnTexts = res.warnings.map(w => w.text);
      assert.ok(warnTexts.some(t => t.includes('好友')), '巢狀 span 文字應經 textContent 命中');
      assert.ok(warnTexts.some(t => t.includes('建立貼文')), 'emotion hash class 的 button 應由文字命中');
    });
  });

  describe('node-side API 形狀', () => {
    it('exports 齊全（兩支 harness 的 call site 依賴）', () => {
      const required = ['NOISE_AUDIT_KEYWORDS', 'pageFns',
        'runResidualText', 'runResidualLinks', 'runOutsideArticle', 'runGapAudit',
        'runContrastAudit', 'runContentWidthAudit', 'runBodyWidthAudit',
        'runOverflowAudit', 'runNarrowTextAudit', 'runFigcaptionAudit',
        'runTailAudit', 'runContentStats', 'captureOriginalHeroImages',
        'runHeroImageAudit', 'waitForReaderImagesLoaded',
        'takePagedScreenshots', 'setThemeAndVerify'];
      for (const name of required) {
        assert.ok(name in auditLib, `audit-lib 缺 export: ${name}`);
      }
    });
  });
});
