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

  it('keyword 兩層分級存在且合併等於全名單（page rounds verdict 分流依賴）', () => {
    const tiers = auditLib.NOISE_KEYWORD_TIERS;
    assert.ok(tiers && Array.isArray(tiers.strict) && Array.isArray(tiers.contextual));
    assert.ok(tiers.strict.length > 10, 'strict 層應有實質名單');
    assert.ok(tiers.contextual.length > 10, 'contextual 層應有實質名單');
    assert.deepStrictEqual(
      auditLib.NOISE_AUDIT_KEYWORDS,
      [...tiers.strict, ...tiers.contextual],
      '合併名單必須 = strict + contextual（單一資料源）');
    // 兩層都要有英文詞——舊名單幾乎全中文，英文站 residual audit 形同空轉
    assert.ok(tiers.strict.some(k => /[a-z]/.test(k)), 'strict 層應含英文 CTA 詞');
    assert.ok(tiers.contextual.some(k => /[a-z]/.test(k)), 'contextual 層應含英文常用詞');
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
          ? rebuilt(auditLib.NOISE_KEYWORD_TIERS)
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
      const res = rebuilt(auditLib.NOISE_KEYWORD_TIERS);
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
      assert.strictEqual(hit.severity, 'strict', '「延伸閱讀」CTA 措辭應為 strict 級');
    });

    it('auditResidualText 分層：常用詞命中正文不警告、CTA 短文字警告（2026-05 假陽性整治）', () => {
      const dom = new JSDOM(`<!DOCTYPE html><body>
        <article data-jread-active="1">
          <p>${'主文長段落內容'.repeat(12)}</p>
          <!-- 歷史假陽性：常用詞落在正文句子（36kr「最新」/ wikipedia「加入」實案）-->
          <h2>DeepSeek 的最新模型再次震撼了整個產業圈</h2>
          <p>步驟三：加入珍珠即完成手搖珍珠奶茶喔</p>
          <!-- 真雜訊：短 CTA 文字（contextual 詞 + 短文字 / 高占比）-->
          <span class="tail-cta">看更多熱門文章</span>
          <h6>推薦文章</h6>
          <!-- 英文 CTA（舊名單全中文、英文站形同空轉）-->
          <h4>Subscribe to ChinaTalk</h4>
          <!-- 英文 word-boundary：shareholders 不可命中 share -->
          <div class="quote-box">Shareholders rallied today</div>
          <!-- 長文段落（>= 80 chars）內合法提及 strict 詞 → 降為 contextual -->
          <p>這篇報導花了很長的篇幅討論訂閱制媒體在過去十年間的營運模式轉變，<em>subscribe</em> 一詞在原文反覆出現了數十次，從報業的衰退談到 podcast 與電子報的興起，值得閱讀與思考其中的商業邏輯與未來走向。</p>
        </article>
      </body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
      const rebuilt = dom.window.eval(`(${auditLib.pageFns.auditResidualText.toString()})`);
      const res = rebuilt(auditLib.NOISE_KEYWORD_TIERS);
      const byText = (t) => res.warnings.find(w => w.text.includes(t));
      assert.ok(!byText('DeepSeek'), '「最新」落在長標題正文不應警告（占比低且 > 12 字）');
      assert.ok(!byText('珍珠'), '「加入」落在正文句子不應警告');
      assert.ok(byText('看更多'), '「看更多熱門文章」CTA 應警告');
      assert.ok(byText('推薦文章'), '「推薦文章」heading 應警告');
      const sub = byText('Subscribe to ChinaTalk');
      assert.ok(sub && sub.severity === 'strict', '英文 Subscribe CTA 應為 strict 級');
      assert.ok(!byText('Shareholders'), 'shareholders 不可被 share 子字串誤中（word boundary）');
      const prose = res.warnings.find(w => w.tag === 'EM' && w.text === 'subscribe');
      assert.ok(!prose || prose.severity === 'contextual',
        '長文段落內提及 strict 詞應降為 contextual（不可計 fail 信號）');
    });

    it('auditResidualLinks：a/button 用 textContent 判定（icon+span 結構不漏）、正文內連結不誤報', () => {
      const dom = new JSDOM(`<!DOCTYPE html><body>
        <article data-jread-active="1">
          <p>${'主文長段落內容'.repeat(12)}</p>
          <a href="https://line.me/x"><svg></svg><span>分享給好友</span></a>
          <button class="css-x1y2z3">建立貼文</button>
          <!-- 新聞內文常嵌社群連結：長段落內的 a 不做 href / class 判定 -->
          <p>${'報導內容'.repeat(20)}，據他在 <a href="https://x.com/foo/status/123">這則貼文</a> 中的說法，事件仍在發展中。</p>
        </article>
      </body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
      const rebuilt = dom.window.eval(`(${auditLib.pageFns.auditResidualLinks.toString()})`);
      const res = rebuilt(auditLib.NOISE_KEYWORD_TIERS);
      assert.ok(!res.error);
      const warnTexts = res.warnings.map(w => w.text);
      assert.ok(warnTexts.some(t => t.includes('好友')), '巢狀 span 文字應經 textContent 命中');
      assert.ok(warnTexts.some(t => t.includes('建立貼文')), 'emotion hash class 的 button 應由文字命中');
      assert.ok(!warnTexts.some(t => t.includes('這則貼文')),
        '長文段落內的社群 href 連結是合法內文連結，不應警告');
    });
  });

  describe('2026-06-11 page rounds 調校（誤報整治）', () => {
    it('trending 不得是 strict keyword（dev.to 主題文內文命中 x4 假陽性）', () => {
      assert.ok(!auditLib.NOISE_KEYWORDS_STRICT.includes('trending'),
        'trending 是主題詞、會命中合法內文，只能放 contextual');
      assert.ok(auditLib.NOISE_KEYWORDS_CONTEXTUAL.includes('trending'),
        'trending 應降級為 contextual（仍要看截圖判定）');
    });

    it('captureOriginalHeroImages 排除 promo / popup src（twreporter 誤報）', () => {
      const src = auditLib.pageFns.captureOriginalHeroImages.toString();
      assert.match(src, /promo\|popup/i, 'hero 候選必須排除 promo / popup src pattern');
    });

    it('runHeroImageAudit 含 pathname 尾段比對（dev.to 響應式變體誤報）', () => {
      // image proxy 把尺寸參數放 pathname：同一張圖的變體 src / pathname /
      // naturalW 三條全不同，只有尾段（encoded 原圖 URL）共享。
      const lib = fs.readFileSync(path.join(TOOLS, 'audit-lib.js'), 'utf8');
      const fn = lib.match(/async function runHeroImageAudit[\s\S]*?\n\}/);
      assert.ok(fn, '抓得到 runHeroImageAudit');
      assert.match(fn[0], /lastSegOf/, '必須有 pathname 尾段比對');
    });

    it('collectReaderImages 收 present（未載入但未被 hide）的 img——lazy 時序不算誤殺', () => {
      // dev.to cover 在 harness 的 original 捲動 + zoom 序列下 lazyload 永不
      // 觸發，元素完好（Jimmy cage 實機 2026-06-11 確認正常渲染）。hero audit
      // 的 missing 語意是「cleaner 誤殺」（hide / 移除），DOM 存在且未 hidden
      // 的 img 不可計 missing。
      const dom = new JSDOM(`<!DOCTYPE html><body>
        <article data-jread-active="1">
          <img src="https://cdn.example.com/img/width=1000/https%3A%2F%2Forigin%2Fabcdef123456.png">
        </article>
      </body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
      const rebuilt = dom.window.eval(`(${auditLib.pageFns.collectReaderImages.toString()})`);
      const imgs = rebuilt();
      // jsdom 無 layout：rect / natural 全 0 → loaded false，但元素必須在清單裡
      assert.strictEqual(imgs.length, 1, '未載入的 img 必須以 present 身分進清單');
      assert.strictEqual(imgs[0].loaded, false, 'rect / natural 不過門檻 → loaded false');
      assert.ok(imgs[0].src.includes('abcdef123456'), 'src 必須保留供比對');
    });

    it('auditGap 含區間覆蓋檢查（engadget embed 卡 / ms.now player 假 gap）', () => {
      const src = auditLib.pageFns.auditGap.toString();
      assert.match(src, /intervalCovered/, 'gap 候選必須先過區間覆蓋檢查');
      assert.match(src, /video, iframe/, '覆蓋掃描必須含非標準 embed 容器（div/video/iframe）');
    });

    it('auditResidualLinks byline 豁免（cnbc 作者社群連結誤報 x3）', () => {
      const dom = new JSDOM(`<!DOCTYPE html><body>
        <article data-jread-active="1">
          <p>${'主文長段落內容'.repeat(12)}</p>
          <div class="byline-wrap">
            <time datetime="2026-06-11">June 11</time>
            <a href="https://x.com/corystieg">@corystieg</a>
          </div>
          <a class="share-btn" href="https://x.com/intent/share">share</a>
        </article>
      </body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
      const rebuilt = dom.window.eval(`(${auditLib.pageFns.auditResidualLinks.toString()})`);
      const res = rebuilt(auditLib.NOISE_KEYWORD_TIERS);
      const warnTexts = res.warnings.map(w => w.text);
      assert.ok(!warnTexts.some(t => t.includes('@corystieg')),
        '與 <time> 同 wrapper 的作者社群連結是 byline metadata，不應警告');
      assert.ok(warnTexts.some(t => t.includes('share')),
        '非 byline 的 share 連結仍須警告（豁免不能過寬）');
    });
  });

  describe('node-side API 形狀', () => {
    it('exports 齊全（兩支 harness 的 call site 依賴）', () => {
      const required = ['NOISE_AUDIT_KEYWORDS', 'NOISE_KEYWORD_TIERS', 'pageFns',
        'runResidualText', 'runResidualLinks', 'runOutsideArticle', 'runGapAudit',
        'runContrastAudit', 'runContentWidthAudit', 'runBodyWidthAudit',
        'runOverflowAudit', 'runNarrowTextAudit', 'runFigcaptionAudit',
        'runTailAudit', 'runContentStats', 'captureOriginalHeroImages',
        'collectOriginalTextStats', 'runHeroImageAudit', 'waitForReaderImagesLoaded',
        'takePagedScreenshots', 'setThemeAndVerify'];
      for (const name of required) {
        assert.ok(name in auditLib, `audit-lib 缺 export: ${name}`);
      }
    });
  });
});
