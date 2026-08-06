// JRead — styler T12：apply() pass 陣列 + buildCss BASE_SEGMENTS 順序 forcing
//
// T12（REVIEW-2026-08-05）把 apply() 的循序區塊抽成具名 pass closure、以
// APPLY_PASSES 陣列為執行順序單一資料源；buildCss 的 base 骨架 literal 拆成
// 具名 segment、以 BASE_SEGMENTS 陣列為 cascade 順序單一資料源。
//
// 本 spec 是 forcing function（與 cleaner-clean-rule-order.spec 同款）：
//   1. 完整性——每個定義的 pass / segment 都必須列進對應陣列（定義了卻沒列入
//      = 整段修法靜默失效，是本結構的新增風險，必須有 spec 接住）
//   2. 順序配對——「必須在 X 之前/之後」的依賴從註解升級為 assertion，
//      每組配對附依賴理由；調整順序前先讀這裡
//
// 訊號層次：本 spec 驗「原始碼結構」一層（陣列存在、成員完整、順序配對），
// 不驗各 pass 的行為正確性（由各自的 styler-*.spec 行為測試涵蓋）、也不驗
// join 輸出與拆分前逐字相等（拆分當下由一次性 probe 驗過 12 組合 identical，
// 之後 base 內容本來就會隨修法演進，逐字凍結反而錯）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8'
);

// ---- 抽取 APPLY_PASSES 陣列成員 ----
function extractArray(name) {
  const m = SRC.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `找不到 const ${name} = [...] 陣列`);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

describe('styler T12 — apply() pass 順序單一資料源', () => {
  const listed = extractArray('APPLY_PASSES');

  it('APPLY_PASSES 存在且以 for-of 迴圈依序執行', () => {
    assert.match(SRC, /for \(const p of APPLY_PASSES\) p\(\);/,
      'apply() 必須以 for (const p of APPLY_PASSES) p() 執行 pass');
  });

  it('完整性：每個定義的 pass 都列在 APPLY_PASSES（定義了沒列 = 靜默失效）', () => {
    const defined = [...SRC.matchAll(/const (pass[A-Za-z0-9]+) = \(\) => \{/g)].map((m) => m[1]);
    assert.ok(defined.length >= 30, `pass 定義數異常（找到 ${defined.length} 個）`);
    for (const name of defined) {
      assert.ok(listed.includes(name), `pass ${name} 已定義但未列入 APPLY_PASSES——整段修法不會執行`);
    }
    for (const name of listed) {
      assert.ok(defined.includes(name), `APPLY_PASSES 列了未定義的 ${name}`);
    }
    assert.strictEqual(new Set(listed).size, listed.length, 'APPLY_PASSES 有重複成員');
  });

  // 順序配對：[先, 後, 理由]。調整 APPLY_PASSES 順序前先讀對應理由；
  // 理由失效（該依賴已解除）才可移除配對。
  const ORDER_PAIRS = [
    ['passContrastProbePhase1', 'passInjectCss',
      'phase 1 要在注入前量「原始 effective bg」，注入後站點 bg 被 reader 樣式覆蓋量不到（v0.7.225）'],
    ['passClassifyImages', 'passSetArticleAttr',
      'inline emoji rect fallback 要量原站渲染尺寸；ARTICLE_ATTR 後 reader 圖片規則把 viewBox-only SVG 撐滿欄、永遠標不到 inline（v0.8.10 chicken-egg）'],
    ['passMarkTextDivs', 'passSetArticleAttr',
      '「div 當段落」主流字級判定要量原站 CSS 字級；ARTICLE_ATTR 後 BODY_TEXT_SEL 改寫繼承鏈（v0.8.49）'],
    ['passSetArticleAttr', 'passMarkEmbedHeadingAbsAnchors',
      'markAbsAnchors 要在 reader 規則生效後量 computed position——媒體子樹已被打回 static 者不標、只豁免仍 absolute/fixed 的錨定元素（v1.7.45）'],
    ['passMarkEmbedHeadingAbsAnchors', 'passMarkFillIframes',
      'EMBED_WRAP_ATTR 讓 static-flow 規則豁免 embed 子樹，FILL_IFRAME 的 getComputedStyle 才量得到 absolute（v1.6.30 #13）'],
    ['passSetArticleAttr', 'passMarkFillIframes',
      'FILL_IFRAME 要在 reader CSS 生效後量——placeholder 後代已被強制 static 者不標（v0.8.86）'],
    ['passInjectCss', 'passContrastGuardPhase2',
      'phase 2 以「CSS 全生效後」的 card bg 重算 effective bg，需 stylesheet 已注入（v0.7.225）'],
    ['passHtmlClassThemeMeta', 'passContrastGuardPhase2',
      'phase 2 需 HTML_CLASS 已就位（頁面背景 / 卡片底色鏈完整）才能算對 effective bg（v0.7.225）'],
    ['passMarkPlayers', 'passGalleryFlex',
      'galleryFlex 以 PLAYER_ATTR 豁免 player 結構，標記必須先存在（v0.8.45 ms.now JW Player 實證）'],
    ['passMarkTextDivs', 'passBylineKicker',
      'byline pass 撤銷 byline 子樹的 TEXT_DIV_ATTR，依賴 text-div 標記已存在（v1.7.5）'],
    ['passBylineKicker', 'passCjkDecorInlineFlowMarks',
      'markCjkParagraphs / markDecorativeInlines 的 closest(BYLINE/KICKER) 排除 guard 需標記已存在，否則中文 byline 被 justify（v1.6.24）'],
    ['passFirstInkTopMargin', 'passAncestorPaddingStrip',
      'ancestor padding strip 沿 firstInk 往上爬，firstInk 必須已找出（v0.7.179）'],
    ['passFirstInkTopMargin', 'passTitleFontOverride',
      'title override 優先用 firstInk 當 H1 錨點（v0.7.180）'],
    ['passFirstInkTopMargin', 'passHeroTitleFloor',
      'hero 字級下限的 heroEl fallback 引用 firstInk（v0.8.3）'],
    ['passCjkDecorInlineFlowMarks', 'passZeroHorizInsets',
      'zeroHoriz 以 INLINE_FLOW_P_ATTR 豁免 inline-flow p 的水平內距，標記必須先存在（v1.7.8 NYT byline 黏字）'],
    ['passGalleryFlex', 'passRatioBoxReset',
      'mediaAncestors 由 passGalleryFlex 建立，ratio reset 迭代它（v0.7.144 效能結構）'],
    ['passGalleryFlex', 'passFixedHeightReset',
      'fixed-height reset 迭代 mediaAncestors + 以 galleryFlex 的 inline height:auto 去重（v1.6.22）'],
    ['passGalleryFlex', 'passDecolumn',
      'decolumn 的 textColSeen 以 galleryFlex 已塌容器種子去重，避免 restore 雙重還原（v0.8.69）'],
  ];

  for (const [before, after, why] of ORDER_PAIRS) {
    it(`順序：${before} → ${after}`, () => {
      const bi = listed.indexOf(before);
      const ai = listed.indexOf(after);
      assert.ok(bi >= 0, `APPLY_PASSES 缺 ${before}`);
      assert.ok(ai >= 0, `APPLY_PASSES 缺 ${after}`);
      assert.ok(bi < ai, `${before} 必須排在 ${after} 之前——${why}`);
    });
  }
});

describe('styler T12 — buildCss BASE_SEGMENTS cascade 順序單一資料源', () => {
  const listed = extractArray('BASE_SEGMENTS');

  it('base 以 BASE_SEGMENTS join 組出（順序即 cascade：同 specificity 後出者勝）', () => {
    assert.match(SRC, /base = BASE_SEGMENTS\.map\(\(f\) => f\(\)\)\.join\(''\);/,
      'buildCss 必須以 BASE_SEGMENTS.map(f => f()).join("") 組 base');
  });

  it('完整性：每個定義的 segment 都列在 BASE_SEGMENTS、無重複', () => {
    const defined = [...SRC.matchAll(/const (seg[A-Za-z0-9]+) = \(\) => `/g)].map((m) => m[1]);
    for (const name of defined) {
      assert.ok(listed.includes(name), `segment ${name} 已定義但未列入 BASE_SEGMENTS——整段 CSS 不會注入`);
    }
    for (const name of listed) {
      assert.ok(defined.includes(name), `BASE_SEGMENTS 列了未定義的 ${name}`);
    }
    assert.strictEqual(new Set(listed).size, listed.length, 'BASE_SEGMENTS 有重複成員');
  });

  it('順序：陣列順序必須與 segment 原始碼定義順序一致（cascade 語意可讀性）', () => {
    // segment 定義順序（原始碼由上而下）= 原單一 literal 的閱讀順序；陣列若與
    // 定義順序不一致，讀 code 的人會用錯的 cascade 心智模型
    const definedOrder = [...SRC.matchAll(/const (seg[A-Za-z0-9]+) = \(\) => `/g)].map((m) => m[1]);
    assert.deepStrictEqual(listed, definedOrder,
      'BASE_SEGMENTS 順序必須與 segment 定義順序一致');
  });

  it('骨架起點 / 終點 segment 固定（page scaffold 開頭、misc 收尾）', () => {
    assert.strictEqual(listed[0], 'segPageScaffold',
      '第一段必須是 segPageScaffold（[data-jread-hidden] 補洞 + progress bar 等頁面級規則）');
    assert.strictEqual(listed[listed.length - 1], 'segColorBorderMisc',
      '最後一段必須是 segColorBorderMisc（color/border/寬度 cap 等後出覆蓋規則）');
  });
});
