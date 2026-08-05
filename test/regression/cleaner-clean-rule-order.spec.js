// v1.7.43 T13：clean() 規則順序依賴 forcing spec
// -----------------------------------------------------------------------------
// cleaner.clean() 依序跑 60+ 條規則，其中多組「順序不可對調」的依賴原本只靠
// 註解維繫（「必須在 X 之前/之後」至少 10 處）。本 spec 掃 clean() 原始碼中
// safeRun(...) 的函式名出現順序，把註解裡的每組配對變成 forcing function——
// 未來插入新規則或搬動舊規則打破依賴時直接 fail，錯誤訊息附上依賴理由。
//
// 此 spec 驗「原始碼層的呼叫順序」、不驗各規則行為（行為由各站 fixture spec
// 覆蓋）。新增順序依賴時：程式碼加註解 + 本檔 PAIRS 加一條，兩處同輪。
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../jread/content/cleaner.js'), 'utf8');

// 抓 clean(articleEl, opts) 方法本體（從宣告到下一個頂層方法宣告前）
function cleanBody() {
  const start = SRC.indexOf('clean(articleEl, opts) {');
  assert.ok(start !== -1, 'cleaner.js 必須有 clean(articleEl, opts)');
  const end = SRC.indexOf('\n    },', start);
  return SRC.slice(start, end);
}

// [先跑, 後跑, 理由（來自程式碼註解）]
const PAIRS = [
  ['hideDialogs', 'hideOutsideArticleSemantic',
    'dialog 語意最明確、放最前——先標掉避免後續規則把它的內部誤判'],
  ['hideInsideArticleClipCroppedContent', 'hideInsideArticleByKeyword',
    'v1.7.14：clip 裁切判斷依據原站幾何，必須在會位移 article 內部 layout 的規則之前'],
  ['hideInsideArticleClipCroppedContent', 'collapseGridWithHiddenCell',
    'v1.7.14：同上，collapse 會位移內部 layout、訊號失真'],
  ['hideInsideArticleInsetLinkCards', 'collapseGridWithHiddenCell',
    'v0.8.48：float / 寬度量測要反映原站 layout，須在 collapse 前'],
  ['hideInsideArticleFloatedPromoAsides', 'collapseGridWithHiddenCell',
    'v0.8.48：同上'],
  ['hideInsideArticleFigureWidgetIframes', 'collapseGridWithHiddenCell',
    'v0.8.48：iframe 高度量測要反映原站 layout，須在 collapse 前'],
  ['hideInsideArticleAuthorBioCards', 'hideBylineAvatarImgs',
    'v1.7.25：bio 卡判準含頭像訊號，頭像先被藏走會讓 bio 卡失去命中'],
  ['hideHeaderZoneDecorativeIcons', 'collapseGridWithHiddenCell',
    'header zone icon rect 量測要反映原站尺寸，須在 collapse 類（mutate layout）前'],
  ['hideInsideArticleAllButtons', 'hideAncestorSiblings',
    'hideAncestorSiblings 放最後：先讓精細規則標記，ancestor sibling 才跳過已隱藏者'],
  ['hideAncestorSiblings', 'hideInsideArticlePreTitleNoise',
    'v0.8.51：pre-title 雜訊放在精細規則之後（已 hidden 者 skip、不重複處理）'],
  ['hideInsideArticlePreTitleNoise', 'hidePreTitleDecorativeImages',
    'v0.8.91：walker 先靠未隱藏的 badge 保護同分支 kicker，再單獨清 img'],
  ['hideInsideArticlePreTitleNoise', 'collapseGridWithHiddenCell',
    'v0.8.51：collapse 類要能看到本條標的 hidden 狀態'],
  ['hideEmptiedFlexColumns', 'collapseGridWithHiddenCell',
    'flex-row 殘殼欄依賴「內部已被前置規則清空」，hide 殘殼後 collapse 才看得到 hidden child 條件'],
  ['collapseGridWithHiddenCell', 'collapseInnerGridFlex',
    '先清殘留空欄、再全面強制 block（範圍由窄而寬）'],
  ['collapseInnerGridFlex', 'collapseInnerFlexWrap',
    '既有兩條 collapse 規則漏網的 case 才輪到 flex-wrap 兜底'],
  ['restoreBgImageTwinHeroImgs', 'hideInsideArticleOriginallyHiddenImgs',
    'bg-image 雙胞胎先翻可見，釘死 pass 讀 computed display 才會自動跳過'],
  ['forceMediaContainerBlock', 'collapseEmptyWrappersAfterClean',
    'v0.7.124：empty wrapper 統清必須在所有 hide / collapse / media 規則之後'],
  ['collapseEmptyBlockSpacers', 'stripPhantomWhitespaceTextNodes',
    'v1.5.24：phantom 文字節點是 empty-spacer / collapse 之後遺留的最後一類垂直空白'],
  ['collapseGridWithHiddenCell', 'hydrateLazyImages',
    'hydrate 放在 reset / collapse 之後——被 hide 的 img 不用補 src（省 network / decode）'],
  ['promoteUniqueTitleH1Into', 'promoteArticleTitleClassHeadingInto',
    'v0.7.149：class-heading promote 是 h1 promote 的擴充 fallback，靠 articleHasPromotedTitle 去重'],
  ['hydrateLazyImages', 'startWatchingDynamicAppends',
    'dynamic observer 最後啟動——靜態規則全跑完後才開始攔 append'],
];

describe('cleaner clean() 規則順序依賴（T13 forcing）', () => {
  const body = cleanBody();
  // 依出現順序抓 safeRun 的函式名（首個參數）
  const order = [];
  for (const m of body.matchAll(/safeRun\((\w+)/g)) order.push(m[1]);

  it('clean() 至少 50 條 safeRun 規則（抓取健全性檢查）', () => {
    assert.ok(order.length >= 50, `只抓到 ${order.length} 條——cleanBody() 抽取可能壞了`);
  });

  for (const [before, after, why] of PAIRS) {
    it(`${before} 必須在 ${after} 之前`, () => {
      const i = order.indexOf(before);
      const j = order.indexOf(after);
      assert.ok(i !== -1, `clean() 找不到 ${before}（規則改名時本 spec 要同步）`);
      assert.ok(j !== -1, `clean() 找不到 ${after}（規則改名時本 spec 要同步）`);
      assert.ok(i < j, `順序依賴被打破：${why}`);
    });
  }
});
