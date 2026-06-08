// JRead — styler regression spec（v0.6.0 瘦身版）
// jsdom 不算 layout 與 CSS，所以本 spec 驗的是「注入結構」與「可逆性」，
// 不驗視覺效果。視覺效果由 Chrome harness 驗（見 CLAUDE.md）。
//
// v0.6.0 重構目標：styler 盡量不動原站內文排版（font / margin / heading /
// list / link 等），只套卡片容器 + 必要 reset + 使用者 override。因此本 spec
// 大量砍掉舊版對「CSS 內容細節」的斷言（font-size inherit / heading margin /
// link 色 / 媒體容器 margin / structural-link 標記等），改以行為斷言為主。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中商周主文');
  return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
}

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

describe('styler — 骨架與可逆性', () => {
  it('apply() 注入 <style id="__jread-style"> 到 head', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    assert.strictEqual(styleEl.tagName.toLowerCase(), 'style');
    assert.ok(styleEl.textContent.length > 0, 'style 元素必須有內容');
  });

  it('apply() 替主文容器打上 data-jread-active="1"', () => {
    const { NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(articleEl.getAttribute('data-jread-active'), '1');
  });

  it('apply() 替主文容器的祖先鏈標 data-jread-ancestor="1"（含 body）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const main = document.querySelector('main');
    assert.ok(main, 'fixture 應有 <main>');
    assert.strictEqual(main.getAttribute('data-jread-ancestor'), '1');
    assert.strictEqual(document.body.getAttribute('data-jread-ancestor'), '1',
      'body 也應被標 ancestor（v0.7.199：堵翻譯 extension 在 body 層注入殘留）');
  });

  it('ancestor sibling hiding rule 排除 #__jread-toast-host（toast 掛在 body 下需可見）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    const re = /\[data-jread-ancestor="1"\]\s*>\s*\*:not[^{]*#__jread-toast-host[^{]*\{\s*display\s*:\s*none\s*!important/;
    assert.ok(re.test(css),
      'ancestor sibling hiding rule 必須含 :not(#__jread-toast-host) 排除');
  });

  it('apply() 替 <html> 加 class __jread-active（觸發頁面底色 reset）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.ok(document.documentElement.classList.contains('__jread-active'));
  });

  it('CSS 含卡片容器骨架（max-width / background / border-radius）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/max-width:\s*720px/.test(css), 'CSS 必須含 contentWidth 的 max-width');
    assert.ok(/background:\s*#ffffff/.test(css), 'CSS 必須含 light theme 的 articleBg');
    assert.ok(/border-radius:\s*8px/.test(css), 'CSS 必須含卡片 border-radius');
    assert.ok(/box-shadow:/.test(css), 'CSS 必須含卡片 box-shadow');
  });

  it('cardArticle rule selector 必須帶 html 前綴提升 specificity（贏過原站 .article-content 類單 class !important rule，v0.7.121 cn.nytimes 修法）', () => {
    // cn.nytimes /opinion/...apple-tim-cook-outsourcing-china/ 實測：
    // articleEl `<article class="article-content font-normal">`，原站 stylesheet
    // 含 `.article-content { max-width: 1040px !important }` 或類似 (0,1,0) +
    // !important rule。jread cardArticle 原 selector `[data-jread-active="1"]`
    // 同 specificity (0,1,0)，同 !important 下 cascade order 由原站勝 → reader
    // card max-width: 720px 被吃掉、articleEl 撐到 1040px 跨過 Bootstrap lg
    // breakpoint 992、`.col-lg-5` 觸發 50% 寬度、partial 內主文段落寬度被
    // 擠到 reader card 一半（instrument: para#0-15 都 x=275 w=490；para#16
    // 在 collapsed 後 x=15 w=1010）。
    // 修法：cardArticle selector 加 `html ` 前綴 → specificity (0,1,1)，贏過
    // 所有原站單 class rule。`html` 是 root selector 永遠 match、加成
    // specificity 不誤殺其他邏輯。其他 [data-jread-active="1"] X selector
    // 含 X tag/class 已 (0,1,1+) 夠強、不需動。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 找含 `max-width: ${contentWidth}px` 的 rule（必是 cardArticle）
    // 取它前面 selector list 確認含 `html [data-jread-active="1"]`
    const re = /([^}]*)\{[^}]*max-width:\s*720px[^}]*\}/;
    const m = css.match(re);
    assert.ok(m, 'CSS 必須含含 max-width: 720px 的 cardArticle rule');
    assert.ok(/html\s+\[data-jread-active="1"\]/.test(m[1]),
      'cardArticle rule selector 必須含 `html [data-jread-active="1"]` 前綴（提升 specificity 贏過原站單 class rule）；forcing function：拿掉 html 前綴 → cn.nytimes 類站點 articleEl max-width 失效、reader card 撐到 1040px 破版');
  });

  it('CSS 含祖先鏈 reset（[data-jread-ancestor="1"] 清 max-width / margin / position）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/\[data-jread-ancestor="1"\][^}]*\{[^}]*max-width:\s*none/.test(css));
    assert.ok(/\[data-jread-ancestor="1"\][^}]*\{[^}]*margin:\s*0/.test(css));
    assert.ok(/\[data-jread-ancestor="1"\][^}]*\{[^}]*position:\s*static/.test(css));
  });

  // v0.7.82 修法：Readwise Reader 類 SPA 站把 body / html 設 overflow: hidden、
  // 讓內層 div 接管 scroll。reader mode 注入 article card 後 body 高度被撐
  // 開、但 overflow-y:hidden 仍鎖住整個 viewport 沒法捲動。
  // 通則：reader mode 必須強制 html / body 兩者 overflow-y: visible，把 scroll
  // 還給 viewport。overflow-x: hidden 仍保留（避免主文超寬橫向拉條）。
  it('CSS 必須強制 html.__jread-active body overflow-y: visible（解開 SPA 站 body scroll lock）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/html\.__jread-active\s+body\s*\{([^}]*)\}/);
    assert.ok(m, 'styler 必須有 html.__jread-active body rule');
    const body = m[1];
    assert.ok(/overflow-y:\s*visible\s*!important/.test(body),
      'html.__jread-active body 必須含 overflow-y: visible !important（Readwise Reader 類 SPA 站 body overflow:hidden 會鎖住 reader mode 捲動）');
    assert.ok(/overflow-x:\s*hidden\s*!important/.test(body),
      'overflow-x: hidden 仍須保留（避免主文超寬橫向拉條）');
  });

  it('CSS 必須強制 html.__jread-active overflow-y: visible（解開 SPA 站 html scroll lock）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/html\.__jread-active\s*\{([^}]*)\}/);
    assert.ok(m, 'styler 必須有 html.__jread-active rule');
    const body = m[1];
    assert.ok(/overflow-y:\s*visible\s*!important/.test(body),
      'html.__jread-active 必須含 overflow-y: visible !important（原 SPA 若把 scroll lock 設在 html 而非 body 同樣會擋住 reader mode 捲動）');
  });

  // v0.6.14 起 styler **不再**有 `*:has(> img/picture/video)` 這條 blanket
  // reset——CSS level 無法區分「padding-bottom hack（Substack/Medium）」與
  // 「純 aspect-ratio 容器（Engadget 類 `aspect-ratio: 16/9` + img absolute
  // inset:0）」，誤傷後者會把主圖高度歸零。改由 cleaner.resetMediaPlaceholderPadding
  // 於 runtime 用 padding-bottom / width 比例判別再決定是否 reset。
  // v0.7.224：Jimmy iPhone 回報「版心調大段落也不變寬、浪費螢幕」。根因：
  // 窄 viewport 下 card max-width 被 viewport clamp，固定 56px×2 水平 padding
  // 吃掉 26% 可讀寬度（430pt 實測內文僅 318px）。改 min(56px, 6vw) 連續縮放：
  // viewport >= 933px 維持桌面 56px 不變、430pt → ~26px（內文 378px / 88%）。
  // v0.7.226：Jimmy iPhone 回報「頂端浪費一截空間」。根因：垂直 margin 40px
  // + 垂直 padding 48px 都是桌面卡片固定值，430pt probe 實測第一行字前
  // 共 88px 空白。垂直 padding 比照水平改 min(48px, 6vw)（窄 viewport 四邊
  // padding 等寬 ~26px）；垂直 margin 改 clamp(8px, calc(6.4vw - 19.2px), 40px)
  // 線性 ramp（min() 過原點直線收不夠陡，430pt 仍剩 ~18px 灰條）。
  it('CSS reader card padding 必須是 min(48px, 6vw) min(56px, 6vw)（窄 viewport 自動收斂）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/padding:\s*min\(48px,\s*6vw\)\s+min\(56px,\s*6vw\)\s*!important/.test(css),
      'reader card padding 必須是 min(48px, 6vw) min(56px, 6vw)——固定值會在手機上浪費寬度與頂部空間');
  });

  it('CSS reader card 垂直 margin 必須是 clamp(8px, calc(6.4vw - 19.2px), 40px)（手機收斂灰條）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/margin:\s*clamp\(8px,\s*calc\(6\.4vw\s*-\s*19\.2px\),\s*40px\)\s+auto\s*!important/.test(css),
      'reader card margin 必須是 clamp(8px, calc(6.4vw - 19.2px), 40px) auto——固定 40px 在手機頂端是浪費的灰條');
  });

  it('CSS 不得含 *:has(> img) padding-bottom:0 blanket rule（會誤傷純 aspect-ratio 容器）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(!/:has\(>\s*img\)[\s\S]{0,120}padding-bottom:\s*0/.test(css),
      'styler 不可注入針對 :has(> img) 的 padding-bottom: 0 blanket rule——會把 Engadget 類純 aspect-ratio 容器壓成 0 高度');
    assert.ok(!/:has\(>\s*img\)[\s\S]{0,120}aspect-ratio:\s*auto/.test(css),
      'styler 不可注入針對 :has(> img) 的 aspect-ratio: auto blanket rule——同樣會把純 aspect-ratio 容器打壞');
  });

  it('CSS 圖片容器限寬：img/video/picture max-width: 100% 且 height: auto', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/img[\s\S]*?\{[^}]*max-width:\s*100%/.test(css));
    assert.ok(/img[\s\S]*?\{[^}]*height:\s*auto/.test(css),
      'img/video/picture 有 intrinsic 尺寸，height: auto 能按比例算');
  });

  // v0.7.1 修法：a > img（link-wrapped icon / logo / UI 按鈕圖）不套
  // height: auto——原站常用 height: 32px 類 CSS 鎖 icon 高度、沒明確設
  // width，依賴 intrinsic aspect ratio 自動算 width。舊規則 height: auto
  // !important 吃掉原站 height 後，img 退回 naturalWidth x naturalHeight
  // 的大尺寸（upmedia 實測「辭」icon 從 32x32 被拉成 250x250），主文裡
  // 出現巨大 UI icon。
  //
  // 通則區分：`[data-jread-active] a > img` 只 cap 寬度、保留原站 height；
  // 其他 wrapper（figure / picture / p / div 等）下的 img 維持 shrink-fit
  // 行為（`img:not(a > img)` 繼續含 height: auto）。
  it('a > img 有獨立 rule：max-width: 100% 且絕不設 height: auto（icon-link 保留原站 height）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    const m = css.match(/\[data-jread-active="1"\]\s+a\s*>\s*img\s*\{([^}]*)\}/);
    assert.ok(m, 'a > img 必須有獨立 rule block（不得與 img:not(a > img) 共用 height: auto）');
    const body = m[1];
    assert.ok(/max-width:\s*100%/.test(body), 'a > img rule 必須 cap 寬度');
    assert.ok(!/height\s*:/.test(body),
      'a > img rule 絕不得設 height（會吃掉原站對 icon 設的合法 height，造成 icon 退回 natural size）');
  });

  it('img selector 必須排除 a > img（img:not(a > img)），否則 height: auto 會誤傷 icon-link', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // 找含 height: auto 的 rule block
    const matches = [...css.matchAll(/([^{}]+)\{([^}]*height\s*:\s*auto[^}]*)\}/g)];
    let hasImgNotRule = false;
    for (const m of matches) {
      const selectors = m[1];
      // naked img selector：img 前面不是 `:` 或 `(`（排除 `:not(a > img)` 裡的 img 與 `> img)` 的 img）、
      // img 後面是 `,`、`{` 或 selector 串結尾。naked img 會連 a > img 一起套 height:auto，
      // 重現 upmedia icon-link 被放大 bug。
      assert.ok(!/(?:^|[^(:])\bimg\s*(?:,|$)/m.test(selectors),
        `含 height: auto 的 rule 不得含 naked img selector（會誤傷 a > img 類 icon-link；找到：${selectors.trim()}）`);
      if (/img:not\(a\s*>\s*img\)/.test(selectors)) hasImgNotRule = true;
    }
    assert.ok(hasImgNotRule, '必須有一條 img:not(a > img) rule 帶 height: auto（figure/picture/p 下的 img 維持 shrink-fit）');
  });

  // v0.6.4 修法：iframe 無 intrinsic 尺寸，height: auto 會掉回 HTML spec
  // 預設 150px、打壞 wp-embed / Substack / Medium 等 aspect-ratio wrapper
  // 模式（wrapper 維 16:9，iframe position:absolute 填滿）。因此 iframe 單獨
  // 一條 rule，只 cap 寬度、絕不設 height。
  it('iframe 有獨立 rule：max-width: 100% 且絕不設 height: auto', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    const m = css.match(/\[data-jread-active="1"\]\s+iframe\s*\{([^}]*)\}/);
    assert.ok(m, 'iframe 必須有獨立 rule block（不得與 img/video/picture 共用 height: auto）');
    const body = m[1];
    assert.ok(/max-width:\s*100%/.test(body), 'iframe rule 必須 cap 寬度');
    assert.ok(!/height\s*:/.test(body),
      'iframe rule 絕不得設 height（auto 會掉回 150px、打壞 aspect-ratio wrapper）');
  });

  it('iframe 不得出現在 img/video/picture 的共用 selector list（會連帶套 height: auto）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 找含 height: auto 的 rule block，確認其 selector list 不含 iframe
    const matches = [...css.matchAll(/([^{}]+)\{([^}]*height\s*:\s*auto[^}]*)\}/g)];
    for (const m of matches) {
      const selectors = m[1];
      assert.ok(!/\biframe\b/.test(selectors),
        `含 height: auto 的 rule 不得把 iframe 列入 selector（找到：${selectors.trim()}）`);
    }
  });

  // v0.6.11 修法：cleaner.hide 只設 inline `style.display = 'none'` 無
  // !important，站點 JS（商周 .postnav.fixed scroll handler）主動
  // `el.style.display = 'block'` 會清掉 inline priority + 覆寫 value。
  // 擋不住 inline 對 inline 的對抗——唯一可靠方法是 stylesheet 層 !important，
  // 優先級 > inline 無 priority 值，browser 層級勝出。
  it('[data-jread-hidden="1"] 有 stylesheet 層 display: none !important rule（擋站點 JS scroll 覆寫 hide）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/\[data-jread-hidden="1"\]\s*\{([^}]*)\}/);
    assert.ok(m, 'CSS 必須有 [data-jread-hidden="1"] rule block');
    const body = m[1];
    assert.ok(/display\s*:\s*none\s*!important/.test(body),
      'rule 必須含 display: none !important（擋 inline 無 priority 覆寫）');
  });

  // v0.6.10 修法：reader mode 下某些站（例如商周 figure.articlephoto）原站
  // 靠「width: 800px」類固定寬 CSS 給 figure 顯式寬度的 rule 失效後（我們
  // 動了 ancestor reset / body layout），figure 退化成 shrink-to-fit + min-
  // width:0 → 被 figcaption 中文單字寬度夾死成 ~31px、img 跟著縮到幾乎看
  // 不見。修法：明示 figure / picture 為 block 預設寬度（100% of parent）。
  it('figure / picture 有強制 width: auto + max-width: 100% rule（修媒體容器塌縮）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // 必須存在一個 rule 其 selector list 同時涵蓋 figure 與 picture（可
    // 以是共用 block 也可以是分開兩條），body 必須同時有 width: auto
    // !important 與 max-width: 100% !important。
    // 先取任一含 figure 的 rule block 驗內容。
    const m = css.match(/\[data-jread-active="1"\]\s+figure\s*(?:,\s*\[data-jread-active="1"\]\s+picture\s*)?\{([^}]*)\}/);
    assert.ok(m, 'figure 必須有 rule block（修商周封面圖被壓成 31px）');
    const body = m[1];
    assert.ok(/width\s*:\s*auto\s*!important/.test(body),
      'figure rule 必須含 width: auto !important（block 預設行為 = 100% of parent）');
    assert.ok(/max-width\s*:\s*100%\s*!important/.test(body),
      'figure rule 必須含 max-width: 100% !important');
    // v0.7.99：BBC Culture 類站點 figure { margin: 0 } 把 figcaption 跟下方
    // 主文壓在一起，明示 1.5em margin-bottom 強制拉開（相對字級縮放）。
    assert.ok(/margin-bottom\s*:\s*1\.5em\s*!important/.test(body),
      'figure rule 必須含 margin-bottom: 1.5em !important（BBC Culture 類 figcaption 跟下方主文間距修法）；forcing：拿掉此 rule → 真實 BBC 站 figcaption 緊貼下方 p');
    // v0.7.100：figure 上方間距。BBC styled-components figure margin: 0 對稱
    // 問題——上一段 p 結尾跟 figure 頂端緊貼，加 margin-top: 1.5em 強制拉開。
    assert.ok(/margin-top\s*:\s*1\.5em\s*!important/.test(body),
      'figure rule 必須含 margin-top: 1.5em !important（BBC figure 與前段 p 間距）；forcing：拿掉 → 真實 BBC 站 p 結尾緊貼下方 figure');

    // picture 也必須有同等 rule
    const mp = css.match(/\[data-jread-active="1"\]\s+picture\s*\{([^}]*)\}|,\s*\[data-jread-active="1"\]\s+picture\s*\{([^}]*)\}/);
    assert.ok(/picture/.test(css), 'CSS 必須包含 picture selector');
  });

  // v0.7.100：BBC Culture 類站點 styled-components 把 h1-h6 margin 全砍光，
  // p → h2 → p 緊貼難辨章節。明示 h1-h6 上下 margin（相對字級縮放）。
  it('h1-h6 有強制 margin-top + margin-bottom clamp rule（BBC 章節分隔修法 + v0.7.171 CNBC big-h1 cap）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 必須存在一個 rule selector list 涵蓋 h1-h6（可全寫或共用）
    const m = css.match(/\[data-jread-active="1"\]\s+h1[\s\S]*?\[data-jread-active="1"\]\s+h6\s*\{([^}]*)\}/);
    assert.ok(m, 'h1-h6 必須有共用 rule block（v0.7.100 BBC 章節間距修法）');
    const body = m[1];
    // v0.7.171：原 1.5em / 0.5em 改 clamp() 上下限封頂——避免 CNBC h1
    // font-size:54px → 1.5em = 81px margin-top 撐出 LIFE 標籤跟標題間
    // 大段空白（dark mode 特別明顯）。clamp 中段 1em、上限 32px/16px。
    assert.ok(/margin-top\s*:\s*clamp\(\s*16px\s*,\s*1em\s*,\s*32px\s*\)\s*!important/.test(body),
      'h1-h6 rule 必須含 margin-top: clamp(16px, 1em, 32px) !important；forcing：拿掉 → BBC 標題緊貼上一段 p，或 CNBC big-h1 撐出 81px 空白');
    assert.ok(/margin-bottom\s*:\s*clamp\(\s*8px\s*,\s*0\.4em\s*,\s*16px\s*\)\s*!important/.test(body),
      'h1-h6 rule 必須含 margin-bottom: clamp(8px, 0.4em, 16px) !important；forcing：拿掉 → BBC 標題緊貼下一段 p');
  });

  it('apply() 把主文內第一個 h1/h2/h3/h4/p 的 margin-top 設為 0 !important（消除頂端留白）', () => {
    const { NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const firstInk = articleEl.querySelector('h1, h2, h3, h4, p');
    assert.ok(firstInk, 'fixture 主文內必須有 h1/h2/h3/h4/p');
    assert.strictEqual(firstInk.style.getPropertyValue('margin-top'), '0px');
    assert.strictEqual(firstInk.style.getPropertyPriority('margin-top'), 'important');
  });

  it('restore() 還原原本 inline margin-top（有值）', () => {
    const { NS, articleEl } = setup();
    const target = articleEl.querySelector('h1');
    assert.ok(target);
    target.style.setProperty('margin-top', '2em');
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(target.style.getPropertyValue('margin-top'), '2em');
  });

  it('restore() 在原本無 inline margin-top 時清空（避免留 "0px"）', () => {
    const { NS, articleEl } = setup();
    const target = articleEl.querySelector('h1');
    assert.ok(target);
    assert.strictEqual(target.style.marginTop, '', '前提：fixture 中 h1 無 inline margin-top');
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(target.style.marginTop, '');
  });

  it('restore() 移除 style 元素、所有 dataset 標記與 html class', () => {
    const { document, NS, articleEl } = setup();
    const snapshot = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snapshot);

    assert.strictEqual(document.getElementById('__jread-style'), null);
    assert.strictEqual(articleEl.getAttribute('data-jread-active'), null);
    assert.strictEqual(document.querySelectorAll('[data-jread-ancestor="1"]').length, 0);
    assert.strictEqual(
      document.documentElement.classList.contains('__jread-active'),
      false
    );
  });

  it('CSS 清 articleEl 內 block 裝飾 background（v0.7.16 theverge 修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // 找 `*:not(...)` universal selector rule
    const m = css.match(/\[data-jread-active="1"\]\s+\*:not\([^)]+\)(?::not\([^)]+\))*\s*\{([^\}]*)\}/);
    assert.ok(m, 'CSS 必須含 articleEl 內 `*:not(...)` background reset rule');
    const selector = m[0].split('{')[0];
    const body = m[1];

    // 必須含的 preserve 語意 tag
    const preserveTags = ['figure', 'figcaption', 'summary', 'blockquote', 'code', 'pre', 'table', 'th', 'td'];
    for (const tag of preserveTags) {
      assert.ok(selector.includes(`:not(${tag})`),
        `selector 必須 :not(${tag})——該 tag 的背景需保留（${tag} 視覺慣例需要背景區隔）`);
    }

    // declarations
    assert.ok(/background-color\s*:\s*transparent\s*!important/.test(body),
      'body 必須含 background-color: transparent !important');
    assert.ok(/background-image\s*:\s*none\s*!important/.test(body),
      'body 必須含 background-image: none !important');
  });

  // v0.7.46 修法：商業周刊 blog 主圖外 wrapper `<div class="Single-image Border-left">`
  // 套 border-left: 45px solid rgb(188, 40, 28)（商周品牌紅 accent bar）。reader
  // mode 下 border-width 計入 box 寬度，把圖片整體往右擠 45px、左側顯示 45px
  // 寬的紅色色塊——使用者回報「圖片破版且偏左」。修法：reader card 內非語意
  // 保留清單元素（div/section/p/img/a 等）的 border-width 強制為 0，讓裝飾性
  // border 不影響閱讀流。preserve 清單跟 background 清除一致 + hr：blockquote
  // 是引述慣例 / table 是資料分隔 / code 是程式碼框 / hr 本身就是 border 化身。
  it('CSS 清 articleEl 內裝飾性 border（v0.7.46 商周品牌紅 accent bar 修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // 找含 border-width: 0 的 *:not(...) rule block
    const m = css.match(
      /\[data-jread-active="1"\]\s+\*:not\([^)]+\)(?::not\([^)]+\))*\s*\{([^\}]*border-width\s*:\s*0[^\}]*)\}/
    );
    assert.ok(m, 'CSS 必須含 articleEl 內 `*:not(...)` border-width: 0 reset rule');
    const selector = m[0].split('{')[0];
    const body = m[1];

    // preserve 清單：跟 background 清除完全一致 + hr（border 化身）
    const preserveTags = [
      'figure', 'figcaption', 'summary', 'blockquote',
      'code', 'pre',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'mark', 'kbd',
      'hr'
    ];
    for (const tag of preserveTags) {
      assert.ok(selector.includes(`:not(${tag})`),
        `border reset selector 必須 :not(${tag})——該 tag 的 border 為語意/慣例需保留`);
    }

    assert.ok(/border-width\s*:\s*0\s*!important/.test(body),
      'rule body 必須含 border-width: 0 !important（清商周 div.Single-image 類紅色 accent bar）');

    // v0.7.48 修法：商周 div.Single-image 套 position:relative; left: -90px;
    // right: 90px（原站讓主圖向左溢出 col-md-7 邊界視覺擴張的 hack）。reader
    // mode 單欄 layout 不需要這個 offset、否則圖被推出 card padding 範圍。
    // 通則：reader card 內非保留清單元素的 left/right inset 一律清 auto。
    assert.ok(/left\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 left: auto !important（清商周 .Single-image 類 position:relative + left:-90px 視覺溢出 hack）');
    assert.ok(/right\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 right: auto !important（清商周 .Single-image 類 position:relative + right:90px 視覺溢出 hack）');
  });

  // v0.7.49 修法：原站常用 width: 1152px / 1080px 等寫死寬度給 article detail
  // layout wrapper（cna.com.tw .centralContent width: 1152px、原本給 article
  // main + sidebar 的固定寬 layout）。reader mode 下 article 已被 cap 到
  // contentWidth 720px max-width，但子元素若寫死 width > 720px 仍會 overflow
  // 出 card 邊界造成圖片/wrapper 偏右破版。max-width: 100% 強制所有後代不超
  // parent 寬度。
  it('CSS 含 articleEl 後代 max-width: 100% rule（v0.7.49 cna 主圖偏右破版修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // 找 `html [data-jread-active="1"] *` 後代 universal selector rule（v0.7.179 加 html prefix，可含 :not()）
    const m = css.match(/html\s+\[data-jread-active="1"\]\s+\*[^{]*\{([^\}]*)\}/);
    assert.ok(m, 'CSS 必須含 `html [data-jread-active="1"] *...` universal rule');
    const body = m[1];
    assert.ok(/max-width\s*:\s*100%\s*!important/.test(body),
      'rule body 必須含 max-width: 100% !important（cap 子元素寬度，避免 cna 類寫死 width:1152px wrapper overflow card）');
  });

  // v0.7.50 修法：cna.com.tw figure.floatImg.center 雖名字含 center 但原站 CSS
  // 套 float / 不對稱 margin 把主圖放到 sidebar 區，reader mode 單欄沒有
  // sidebar → 圖偏右破版。實機與 probe 數據不一致（probe 顯示對齊但實機
  // 偏右），相信實機截圖、強制 block flow 置中。
  // v0.7.105：margin-left/right: auto 從「* 全 wildcard」改成「只對媒體 tag」
  // ——避免 BBC byline 的 author wrapper width:458 span 被 auto-center 偏右
  // 跟 date 左對齊不一致。float: none 仍維持 wildcard。
  it('CSS 含 articleEl 後代 float: none rule + 媒體 tag margin auto rule（v0.7.50 cna .floatImg / v0.7.105 byline 對齊修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // (1) `* { float: none !important }` rule 必須存在（清 cna .floatImg 類偏移）
    const wildcardMatches = [...css.matchAll(/\[data-jread-active="1"\]\s+\*[^{]*\{([^\}]*)\}/g)];
    let hasFloatNone = false;
    for (const m of wildcardMatches) {
      if (/float\s*:\s*none\s*!important/.test(m[1])) { hasFloatNone = true; break; }
    }
    assert.ok(hasFloatNone,
      '`[data-jread-active="1"] *...` rule 必須含 float: none !important（清 cna .floatImg float-right 類偏移）');

    // (2) 媒體 tag rule 必須含 margin-left/right: auto（block 元素水平置中）
    // 媒體 selector 列表（img / picture / video / figure / iframe / table /
    // blockquote / pre）必須在 selector list 同時出現 margin auto 兩條。
    // 抽出該 rule block 驗 body。
    const mediaMatch = css.match(/\[data-jread-active="1"\]\s+img[\s\S]*?\[data-jread-active="1"\]\s+pre\s*\{([^}]*)\}/);
    assert.ok(mediaMatch,
      '必須有「img / picture / video / figure / iframe / table / blockquote / pre」共用 rule（v0.7.105 媒體 auto-center 修法）');
    const body = mediaMatch[1];
    assert.ok(/margin-left\s*:\s*auto\s*!important/.test(body),
      '媒體 tag rule 必須含 margin-left: auto !important（block 媒體水平置中）');
    assert.ok(/margin-right\s*:\s*auto\s*!important/.test(body),
      '媒體 tag rule 必須含 margin-right: auto !important');

    // (3) 反向 forcing：`*` rule body 不可含 margin auto（避免回歸到 v0.7.104 全
    // wildcard 套法、BBC byline 又被 auto-center 偏右）
    for (const m of wildcardMatches) {
      assert.ok(!/margin-left\s*:\s*auto\s*!important/.test(m[1]),
        '`* { margin-left: auto }` 已縮限到媒體 tag——forcing：避免回歸到全 wildcard、BBC byline author 又被偏右');
    }
  });

  // v0.7.52 修法：cna img 自身 position:absolute + left:304px + right:-304px
  // 把圖向版心外溢出做全寬 hero（v0.7.51 instrument log 在實機揭穿真兇）。
  // 強制 articleEl 內 img/video 自身 position:static + inset auto 退回正常
  // inline-block flow，跟著 figure/picture 容器置中。
  it('CSS 含 img/video position: static + inset auto rule（v0.7.52 cna img absolute hack 修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // 找含 img + video + position: static 的 rule block（可能含 :not() 排除）
    const allRules = [...css.matchAll(/\[data-jread-active="1"\]\s+img[^,]*,\s*\[data-jread-active="1"\]\s+video[^{]*\{([^\}]*)\}/g)];
    const m = allRules.find(r => /position\s*:\s*static/.test(r[1]));
    assert.ok(m, 'CSS 必須有 articleEl img + video position 強制 rule block');
    const body = m[1];
    assert.ok(/position\s*:\s*static\s*!important/.test(body),
      'rule body 必須含 position: static !important（清 cna img 類 absolute hack）');
    assert.ok(/left\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 left: auto !important');
    assert.ok(/right\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 right: auto !important');
    assert.ok(/top\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 top: auto !important');
    assert.ok(/bottom\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 bottom: auto !important');
  });

  // v0.7.53 修法：v0.7.52 把 img 強制 position:static 拉回 normal flow 後，
  // picture 容器若用 aspect-ratio 撐高度（cna 主圖 picture 套 aspect-ratio
  // 從 --aspect-ratio CSS variable 算出 4:3）會殘留為「空 box 撐 75% padding」
  // → 標題下方一大塊空白。picture 強制 aspect-ratio: auto + padding-bottom: 0
  // 讓高度由 img static 內容自然撐起。
  it('CSS 含 picture aspect-ratio: auto + padding-bottom: 0 rule（v0.7.53 cna 主圖空白修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // 找含 picture selector 的 rule（v0.7.68 起 picture 可能跟其他 selector
    // 共用 rule body，例如 picture, [class*="object-fit"]）
    const matches = [...css.matchAll(/\[data-jread-active="1"\]\s+picture\s*(?:,[^{]*)?\{([^\}]*)\}/g)];
    let hasReset = false;
    for (const m of matches) {
      const body = m[1];
      if (/aspect-ratio\s*:\s*auto\s*!important/.test(body) &&
          /padding-bottom\s*:\s*0\s*!important/.test(body)) {
        hasReset = true; break;
      }
    }
    assert.ok(hasReset,
      '必須有一條 picture rule 同時含 aspect-ratio: auto + padding-bottom: 0（清 cna 類 aspect-ratio 撐高 hack）');

    // v0.7.55 修法：v0.7.54 instrument 揭穿 cna picture 空白真兇——picture
    // 自己 computed height: 1159.56px（aspect-ratio 已 auto, padding-bottom
    // 已 0, min-height 已 0），但 picture **height 被原站 inline style 或
    // 高 specificity stylesheet 寫死**（cna lazy-load placeholder 系統慣用）。
    // picture 加 height: auto + min-height: 0，讓高度由 img 內容撐起。
    let hasHeightAutoMinH = false;
    for (const m of matches) {
      const body = m[1];
      if (/height\s*:\s*auto\s*!important/.test(body) &&
          /min-height\s*:\s*0\s*!important/.test(body)) {
        hasHeightAutoMinH = true; break;
      }
    }
    assert.ok(hasHeightAutoMinH,
      '必須有一條 picture rule 同時含 height: auto + min-height: 0（清 cna 類 inline height 寫死的 placeholder 高度）');

    // v0.7.68 修法：gvm.com.tw figure 內 <div class="object-fit"> wrapper 也用
    // aspect-ratio / padding-bottom hack 撐 lazy-load placeholder（同 picture），
    // 擴 selector 命中。object-fit 是 CSS property 名當 class 用的常見 pattern。
    assert.ok(/\[class\*="object-fit"\]/.test(css),
      'CSS 必須含 [class*="object-fit"] selector（gvm 類 figure 內 div.object-fit placeholder）');

    // v0.7.72 修法：today.line.me div.placeholder style="padding-top:75.25%"
    // 用 padding-top（不是 padding-bottom）撐 aspect-ratio placeholder。擴
    // selector 加 [class*="placeholder"] 並 reset padding-top: 0 第二維度。
    assert.ok(/\[class\*="placeholder"(\s*i)?\]/.test(css),
      'CSS 必須含 [class*="placeholder"] 或 [class*="placeholder" i] selector（line today 類 padding-top placeholder）');
    // 主 picture/figure/object-fit/placeholder rule 必須含 padding-top: 0
    const placeholderRule = css.match(/\[class\*="placeholder"(?:\s*i)?\][^{]*\{([^}]*)\}/);
    if (placeholderRule) {
      assert.ok(/padding-top\s*:\s*0\s*!important/.test(placeholderRule[1]),
        'placeholder rule body 必須含 padding-top: 0 !important（清 line today 類 padding-top hack）');
    }

    // v0.7.198 修法：placeholder 內部 wrapper 一併拉回 static flow——
    // padding-bottom hack 結構「placeholder relative + 子層 absolute」中，
    // img/video 已被 styler 強制 static，但中間 wrapper div 仍 absolute →
    // 不佔 flow 高度 → 文字疊在圖片上（CNBC imageContainer）。
    // case-insensitive flag 確保 imagePlaceholder（大寫 P）也命中。
    const phDescRule = css.match(/\[class\*="placeholder"\s*i\][^{]*\*[^{]*\{([^}]*)\}/);
    assert.ok(phDescRule,
      'CSS 必須含 [class*="placeholder" i] * descendant rule（placeholder 內所有子層回 static）');
    assert.ok(/position\s*:\s*static\s*!important/.test(phDescRule[1]),
      'placeholder descendant rule 必須含 position: static !important');

    // v0.7.70 修法：gvm div.object-fit::before pseudo 用 content:"" + display:block
    // + height:Npx 撐 placeholder（不是 padding-bottom 也不是 aspect-ratio），
    // v0.7.61 的 picture::before 修法只清 content + display + padding-bottom，
    // 沒處理 height 維度——擴 ::before/::after rule selector 涵蓋 object-fit
    // wrapper 並加 height: 0 維度。
    assert.ok(/\[class\*="object-fit"\]::before/.test(css),
      'CSS 必須含 [class*="object-fit"]::before pseudo selector');
    assert.ok(/\[class\*="object-fit"\]::after/.test(css),
      'CSS 必須含 [class*="object-fit"]::after pseudo selector');
    // 新增 height: 0 維度（cna picture::before 是 padding-bottom，gvm
    // object-fit::before 是直接 height 撐高度）
    const beforeRule = css.match(/picture::before[\s\S]*?\{([^}]*)\}/);
    if (beforeRule) {
      assert.ok(/height\s*:\s*0\s*!important/.test(beforeRule[1]),
        '::before pseudo rule body 必須含 height: 0 !important（清 gvm 類直接 height 撐高的 placeholder）');
    }
  });

  it('CSS 含 Bootstrap col-* wrapper reset（v0.7.15 esmchina width 修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;

    // 涵蓋 col-xs / col-sm / col-md / col-lg / col-xl 的 attribute selector
    const selectors = ['col-xs-', 'col-sm-', 'col-md-', 'col-lg-', 'col-xl-'];
    for (const s of selectors) {
      assert.ok(
        css.includes(`[class*="${s}"]`),
        `styler CSS 必須含 [class*="${s}"] selector（Bootstrap col-${s.split('-')[1]} reset）`
      );
    }

    // 驗 declarations：width auto + max-width none + float none + flex initial
    // 用 regex 找任一 col-X- selector 後面的 block
    const m = css.match(/\[class\*="col-md-"\][^\{]*\{([^\}]*)\}/);
    assert.ok(m, 'col-md- selector 必須有 rule block');
    const body = m[1];
    assert.ok(/width\s*:\s*auto\s*!important/.test(body),
      'col-* reset 必須含 width: auto !important');
    assert.ok(/max-width\s*:\s*none\s*!important/.test(body),
      'col-* reset 必須含 max-width: none !important');
    assert.ok(/float\s*:\s*none\s*!important/.test(body),
      'col-* reset 必須含 float: none !important（Bootstrap col 常帶 float）');
    // v0.7.122 forcing function：flex 從 `initial` 改 `1 1 auto`——cn.nytimes
    // 實測 article-body-item.col-lg-5 在 partial flex 父容器下，flex: initial
    // (= 0 1 auto) 走 content max-content 寬度只撐到 667px、不滿父寬 728px、
    // 前 16 段主文段落被卡在 reader card 約一半。改 grow:1 後 flex item 主動
    // 撐滿父剩餘空間。block 場景下無害（flex shorthand no-op）。
    assert.ok(/flex\s*:\s*1\s+1\s+auto\s*!important/.test(body),
      'col-* reset 必須含 flex: 1 1 auto !important（v0.7.122 修法：cn.nytimes col-lg-5 flex item 撐滿父寬，原 `flex: initial` grow:0 在中文段落 max-content 不到父寬時失效）');
    // v0.7.47 修法：商周 .Single-left-part.col-md-7 客製化 padding-right: 115px
    // 給右欄 sidebar 留白，reader mode sidebar 已砍但 padding 還在 → 圖片寬度
    // 卡在 col 寬度的子集（493px 而非完整 608px）。col 已退化成 block 流排，
    // Bootstrap gutter padding 已失意義，可清。
    assert.ok(/padding\s*:\s*0\s*!important/.test(body),
      'col-* reset 必須含 padding: 0 !important（清商周 col-md-7 padding-right: 115px 類客製化 padding，避免主圖寬度被擠在 col 子集）');
    // v0.7.123 forcing function：清 margin-left/right——cn.nytimes 對
    // `.col-lg-5` 設 `margin-left: 380px`（或縮窄 viewport 下 61px）做窄
    // 中欄 layout。即使 v0.7.122 flex-grow:1 撐滿父寬，margin 把 wrapper
    // 內容向內推 380px、article-body-item rect.x=380 w=606 in partial
    // x=0 w=1366。partial 完全失去自然 align、主文文字只佔 reader card
    // 中段一小區。reader card 單欄 layout 沒 row 結構支持 col offset，清掉。
    assert.ok(/margin-left\s*:\s*0\s*!important/.test(body),
      'col-* reset 必須含 margin-left: 0 !important（v0.7.123 修法：cn.nytimes 對 col-lg-5 設 margin-left: 380px 做窄中欄 layout、即使 flex-grow:1 撐滿父寬，margin 仍把 content 向內推、reader card 內主文偏移）');
    assert.ok(/margin-right\s*:\s*0\s*!important/.test(body),
      'col-* reset 必須含 margin-right: 0 !important（對稱清，避免原站對 col 右側設 margin 推回內側）');
  });

  it('重複 apply() 不重複注入 style 元素（更新同一個）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const allStyles = document.querySelectorAll('#__jread-style');
    assert.strictEqual(allStyles.length, 1, '只能有一個 __jread-style 元素');
  });

  it('apply / restore / apply 循環不累積殘留', () => {
    const { document, NS, articleEl } = setup();
    const s1 = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, s1);
    const s2 = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, s2);

    assert.strictEqual(document.getElementById('__jread-style'), null);
    assert.strictEqual(articleEl.getAttribute('data-jread-active'), null);
    assert.strictEqual(document.querySelectorAll('[data-jread-ancestor="1"]').length, 0);
    assert.strictEqual(document.documentElement.classList.contains('__jread-active'), false);
  });

  it('null / undefined articleEl 不拋錯，回傳 null', () => {
    const { NS } = setup();
    assert.strictEqual(NS.styler.apply(null, DEFAULT_SETTINGS), null);
    assert.strictEqual(NS.styler.apply(undefined, DEFAULT_SETTINGS), null);
  });

  it('restore(null) 不拋錯（snapshot 為 null 即 no-op）', () => {
    const { NS, articleEl } = setup();
    assert.doesNotThrow(() => NS.styler.restore(articleEl, null));
  });
});

// -----------------------------------------------------------------------------
// v0.6.0 核心行為：使用者設定 override——「改過才套，預設值不動原站」
// -----------------------------------------------------------------------------
// 設計理由：styler 目標是「盡量貼近原站點」（c 路線）。預設值等於「未設定」，
// 不注入對應 CSS，原站的 font / line-height / theme 色仍然生效。使用者主動
// 改過後才套 override。避免「使用者只想關雜訊、沒想換字體」卻被強制換字體。
// -----------------------------------------------------------------------------
describe('styler — 使用者設定 override（預設值不動原站）', () => {
  it('預設設定 → CSS 仍注入 font-size（v0.7.140 修正）、連帶 line-height、不注入 font-family', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // v0.7.140：fontSize == DEFAULT (18) 仍注入——使用者選 18 預期看到 18px
    //（substack reader hub 實機踩過：popup 顯示 18 但實際看到原站 source-serif-pro
    // 20px）。Auto = 0 是唯一「保留原站」sentinel。fontSize 注入時連帶注入
    // line-height（既有設計：字級改了行高必須等比縮放，避免原站 px 鎖死的
    // line-height 對小字級變過寬行距）。font-family 仍走「改過才注入」邏輯。
    assert.ok(/font-size:\s*18px/.test(css),
      '預設 fontSize 18 必須注入 font-size 18px（避免被原站樣式覆蓋造成 UX confusion）');
    assert.ok(/line-height:\s*1\.7/.test(css),
      'fontSize 注入時連帶注入 line-height（既有設計，DEFAULT lineHeight 1.7）');
    assert.ok(!/font-family:/.test(css),
      '預設 fontFamily 時不得注入 font-family（保留原站字體）');
  });

  it('非預設 fontSize → 注入 font-size', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 22 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/font-size:\s*22px/.test(css));
  });

  it('fontSize === DEFAULT (18) 必須注入 font-size 18px（v0.7.140 forcing function）', () => {
    // forcing function：避免回退到舊版「fontSize == DEFAULT 不注入」的 UX trap
    // —— popup 顯示 18 / 實際看到原站非 18px 的場景。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 18 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/font-size:\s*18px\s*!important/.test(css),
      'fontSize 18 必須以 !important 注入 (穿透原站 source-serif-pro / NYT body class 等規則)');
  });

  it('非預設 fontFamily → 注入 font-family', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontFamily: 'Georgia' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/font-family:\s*Georgia/.test(css));
  });

  it('非預設 lineHeight → 注入 line-height', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, lineHeight: 2.0 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/line-height:\s*2/.test(css));
  });

  it('非預設 fontSize / fontFamily / lineHeight 的 rule 必須含 body text descendant selector（穿透 BBC / NYT 類站點 class rule），但 figcaption 排除（保留原站 caption typography hierarchy）', () => {
    // BBC `.HooNV`、NYT article body class 等把 font-size / line-height /
    // font-family 鎖死在 `<p>` 身上——只對 `[data-jread-active="1"]` 自己下
    // rule 會被後代的 class rule 截斷 inheritance，override 失效。override
    // rule 必須列舉常見 body text 元素（p / li / blockquote / dd / dt）才能
    // 穿透站點 class specificity。heading h1-h6 不含（保留原站標題大小分級）。
    //
    // v0.7.120：figcaption 也排除——caption 原站設計普遍比 body 小（0.7-
    // 0.85em，BBC 12px vs body 18px）+ 較淡色，是 typography hierarchy
    // 的關鍵差異化。把 caption 拉到跟 body 同 fontSize 視覺上破壞「圖→
    // 說明」階層感。Jimmy 2026-05-13 BBC Culture 截圖回報：fontSize 非
    // 預設時 caption 跟內文同字級不該如此。保留 caption 原站 typography
    // 比「跟 body 等比例縮放」更尊重原站設計。
    const { document, NS, articleEl } = setup();
    // 同時改三項：一次驗完
    NS.styler.apply(articleEl, {
      ...DEFAULT_SETTINGS, fontSize: 22, fontFamily: 'Georgia', lineHeight: 2.0
    });
    const css = document.getElementById('__jread-style').textContent;

    // 切出「使用者 override block」（第一個含 font-size/family/line-height
    // 的 rule 群）驗證它含 descendant selector 列表
    for (const prop of ['font-size', 'font-family', 'line-height']) {
      // 找出該 property rule 所在 block（selector { ... prop: ... })；
      // 粗略抓 rule 前的 selector list
      const re = new RegExp('([^}]*)\\{[^}]*' + prop + '\\s*:', 'i');
      const m = css.match(re);
      assert.ok(m, `CSS 應包含 ${prop} rule`);
      const selectorList = m[1];
      // 核心 descendant：必含 [data-jread-active="1"] p
      assert.ok(/\[data-jread-active="1"\]\s+p\b/.test(selectorList),
        `${prop} 的 selector list 必須含 [data-jread-active="1"] p（穿透站點 p class rule）`);
      assert.ok(/\[data-jread-active="1"\]\s+li\b/.test(selectorList),
        `${prop} 的 selector list 必須含 [data-jread-active="1"] li`);
      assert.ok(/\[data-jread-active="1"\]\s+blockquote\b/.test(selectorList),
        `${prop} 的 selector list 必須含 [data-jread-active="1"] blockquote`);
      // v0.7.152 forcing function：span 必須在 selector list（穿透 WYSIWYG
      // 編輯器 Lexical / TipTap / ProseMirror 等對 span 自身寫 font-family
      // 的 rule。vocus.cc 實測：<p class="lexical__paragraph"><span>文字
      // </span></p>，vocus stylesheet 對 span 寫死 font-family，我們對 p
      // 的 override 不會 inherit 到 span，使用者「字型」設定失效。Jimmy
      // 2026-05-20 vocus /article/6a0d369c... 回報實機觸發）。
      assert.ok(/\[data-jread-active="1"\]\s+span/.test(selectorList),
        `${prop} 的 selector list 必須含 [data-jread-active="1"] span（v0.7.152 修法：穿透 WYSIWYG 編輯器對 span 自身 font-family rule；拿掉 span → vocus.cc 類站點字型設定無效）`);
      // v0.7.156 forcing function：td / th / caption 必須在 selector list（穿透
      // 站點對 table cell 字級的縮小規則，例 Wikipedia `table.infobox { font-size:
      // 0.88em }`）。Jimmy 2026-05-21 Wikipedia /Longchamp_(company) Chrome
      // 翻譯成 zh-TW 實測：body p = 18px ✓ / infobox td/th = 15.84px ✗（0.88em
      // 繼承）+ CJK 字型 metric 比 Latin 視覺再小一階 → 體感「中文特別小」。
      assert.ok(/\[data-jread-active="1"\]\s+td\b/.test(selectorList),
        `${prop} 的 selector list 必須含 [data-jread-active="1"] td（v0.7.156 修法：穿透 Wikipedia / 技術文件等 table 排版站點對 cell 字級的 0.88em 縮小規則；拿掉 td → infobox 字級永遠維持 0.88em，使用者字級設定形同失效）`);
      assert.ok(/\[data-jread-active="1"\]\s+th\b/.test(selectorList),
        `${prop} 的 selector list 必須含 [data-jread-active="1"] th（v0.7.156 修法：與 td 同源；table header cell）`);
      assert.ok(/\[data-jread-active="1"\]\s+caption\b/.test(selectorList),
        `${prop} 的 selector list 必須含 [data-jread-active="1"] caption（v0.7.156：table 標題與 cell 同樣是閱讀內容，不該被縮小）`);
      // v0.7.120 forcing function：figcaption **不得**列入 typography rule
      // selector——保留原站 caption hierarchy（fontSize / fontFamily /
      // lineHeight 都不覆寫 caption）。
      assert.ok(!/\[data-jread-active="1"\]\s+figcaption\b/.test(selectorList),
        `${prop} 的 selector list **不得**含 [data-jread-active="1"] figcaption（v0.7.120 修法：保留原站 caption typography hierarchy，避免把 caption 拉成跟 body 同字級破壞「圖→說明」階層感；BBC Culture 實測 caption 12px vs body 18px）`);
    }

    // userOverrides block（font-size / font-family / line-height）不得對
    // h1-h6 下 rule——保留原站標題大小分級。v0.7.100 後 styler 的 baseline
    // h1-h6 rule 只含 margin 不含 typography property，所以 css 整體可能
    // 包含 h1-h6 selector。改為精準檢查：含 font-size/font-family/line-height
    // 的 rule block 才禁止 h1-h6 descendant。
    for (const prop of ['font-size', 'font-family', 'line-height']) {
      // 找該 prop 所在 rule block 的 selector list
      const reBlock = new RegExp('([^}{]*)\\{[^}]*' + prop + '\\s*:[^;}]*[;}]', 'i');
      const mBlock = css.match(reBlock);
      if (!mBlock) continue;
      assert.ok(!/\[data-jread-active="1"\]\s+h[1-6]\b/.test(mBlock[1]),
        `含 ${prop} 的 rule block selector list 不得含 h1-h6（保留原站標題大小分級）`);
    }
  });

  it('fontSize = 0（Auto / 原站字級）→ CSS 不注入 font-size 也不注入 line-height（每站保留原字級與行高）', () => {
    // popup「自動」按鈕用 sentinel 0 代表「使用者明確選擇保留原站字級」。
    // styler 需: (1) 保留 0 值不被 `Number(0) || DEFAULT` 轉回 18；(2) override
    // 判斷加 `> 0` 保護、0 不視為「改過 DEFAULT」→ 不注入任何 font-size /
    // line-height 連帶 rule。每開一個站點都走原站原 typography。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 0 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(!/font-size:\s*\d+px\s*!important/.test(css),
      'fontSize = 0 (Auto) 不得注入 font-size override');
    assert.ok(!/line-height:\s*[\d.]+\s*!important/.test(css),
      'fontSize = 0 (Auto) 不得連帶注入 line-height（baseline 預設完全不動原站）');
  });

  it('非預設 fontSize 必須連帶注入 line-height（即使 lineHeight 是預設值）', () => {
    // Medium 實測：`.pi / .pc { line-height: 32px }` 把 p 行高鎖在 32px（原為
    // 20px 字級設計、ratio 1.6）。使用者把 fontSize 從 18 調到 16 時，若只
    // 覆寫 font-size 不動 line-height，行距變成 32/16 = 2.0（過寬）。
    // 修法：字級改過時連帶注入 `line-height: ${opts.lineHeight}` !important
    // （unitless，相對字級自動縮放）。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 16 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/font-size:\s*16px/.test(css),
      '非預設 fontSize → 注入 font-size（前提）');
    assert.ok(/line-height:\s*1\.7/.test(css),
      '非預設 fontSize 必須連帶注入 line-height（使用 opts.lineHeight 預設 1.7）' +
      '——否則站點用 px 鎖死的行高在字級被調小後變過寬行距');
    // 同時確認 line-height rule 命中 p descendant（v0.6.16 擴展）
    const re = /([^}]*)\{[^}]*line-height\s*:\s*1\.7/;
    const m = css.match(re);
    assert.ok(m, '應能找到 line-height: 1.7 的 rule block');
    assert.ok(/\[data-jread-active="1"\]\s+p\b/.test(m[1]),
      'line-height rule 必含 p descendant selector（穿透 Medium .pi/.pc class rule）');
  });

  // v0.7.162：lineHeight Auto sentinel = 0 + paragraphSpacing 可調 + Auto = -1
  it('lineHeight = 0（Auto）→ 即使 fontSize 改過也不注入 line-height', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 20, lineHeight: 0 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/font-size:\s*20px/.test(css),
      'fontSize 改過必須注入 font-size（前提）');
    assert.ok(!/line-height:\s*[\d.]+\s*!important/.test(css),
      'lineHeight = 0 (Auto) 不得注入任何 line-height !important（保留原站行距）');
  });

  it('lineHeight = 0（Auto）+ fontSize 預設 → 不注入 font-size 也不注入 line-height（baseline 保留原站）', () => {
    // 與 fontSize=0 Auto 的對稱情境：兩個都 Auto 等於完全 baseline。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 0, lineHeight: 0 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(!/font-size:\s*\d+px\s*!important/.test(css),
      'fontSize = 0 (Auto) 不得注入 font-size override');
    assert.ok(!/line-height:\s*[\d.]+\s*!important/.test(css),
      'lineHeight = 0 (Auto) 不得注入任何 line-height');
  });

  it('paragraphSpacing 預設 1.0 → 注入 p/ul/ol/blockquote margin-bottom: 1em', () => {
    // 對齊 v0.7.102 baseline 行為（舊版固定 1em margin-bottom 規則已搬到
    // userOverrides 條件注入；預設值仍應生效）。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/\[data-jread-active="1"\]\s+p[\s\S]*?\[data-jread-active="1"\]\s+blockquote\s*\{([^}]*)\}/);
    assert.ok(m, 'p / ul / ol / blockquote 必須有共用 rule block（paragraphSpacing 預設 1.0 注入）');
    assert.ok(/margin-bottom\s*:\s*1em\s*!important/.test(m[1]),
      'paragraphSpacing 預設 1.0 必須注入 margin-bottom: 1em !important');
  });

  it('paragraphSpacing = -1（Auto）→ 不注入 p/ul/ol/blockquote margin-bottom 規則（保留原站 typography）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, paragraphSpacing: -1 });
    const css = document.getElementById('__jread-style').textContent;
    // p/ul/ol/blockquote 共用 rule block 不得出現（base 已移除、userOverrides 不注入）
    assert.ok(!/\[data-jread-active="1"\]\s+p,[\s\S]*?\[data-jread-active="1"\]\s+blockquote\s*\{[^}]*margin-bottom/.test(css),
      'paragraphSpacing = -1 (Auto) 不得注入 p/ul/ol/blockquote 共用 margin-bottom 規則');
  });

  it('paragraphSpacing = 0（緊貼）→ 注入 margin-bottom: 0em（與 Auto 區隔，0 是合法值）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, paragraphSpacing: 0 });
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/\[data-jread-active="1"\]\s+p[\s\S]*?\[data-jread-active="1"\]\s+blockquote\s*\{([^}]*)\}/);
    assert.ok(m, 'paragraphSpacing = 0 仍須注入 rule block（與 -1 Auto 區隔）');
    assert.ok(/margin-bottom\s*:\s*0em\s*!important/.test(m[1]),
      'paragraphSpacing = 0 必須注入 margin-bottom: 0em（使用者顯式要求段落緊貼）');
  });

  it('paragraphSpacing 非預設值 → 注入對應 em 值', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, paragraphSpacing: 2.25 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/margin-bottom\s*:\s*2\.25em\s*!important/.test(css),
      'paragraphSpacing = 2.25 必須注入 margin-bottom: 2.25em');
  });

  // v0.7.163：FB div paragraph (data-jread-fb-para) 受 paragraphSpacing 控管
  // FB permalink fb-post.js 把段落 div 標 data-jread-fb-para=1。paragraphSpacing
  // 規則必須涵蓋此 selector，否則使用者調間距完全打不到 FB。
  it('paragraphSpacing >= 0 → 必須注入 [data-jread-fb-para] 規則（FB div 段落間距生效）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, paragraphSpacing: 1.5 });
    const css = document.getElementById('__jread-style').textContent;
    const re = /\[data-jread-active="1"\]\s+\[data-jread-fb-para="1"\]\s*\{([^}]*)\}/;
    const m = css.match(re);
    assert.ok(m, 'paragraphSpacing = 1.5 必須注入 [data-jread-fb-para] rule block（FB div paragraph 受設定控管）');
    assert.ok(/margin-top\s*:\s*1\.5em\s*!important/.test(m[1]),
      'fb-para 必須注入 margin-top: 1.5em（FB div 沒 p 的 user-agent margin、上下都得設）');
    assert.ok(/margin-bottom\s*:\s*1\.5em\s*!important/.test(m[1]),
      'fb-para 必須注入 margin-bottom: 1.5em');
  });

  it('paragraphSpacing = -1 (Auto) → 不注入 [data-jread-fb-para] 規則（fb-post inline fallback 1.2em 接手）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, paragraphSpacing: -1 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(!/\[data-jread-fb-para="1"\]\s*\{[^}]*margin/.test(css),
      'paragraphSpacing = -1 (Auto) 不得注入 fb-para margin 規則（保留 fb-post.js inline fallback）');
  });

  it('非預設 fontSize + 非預設 lineHeight：line-height 只注入一次（避免 CSS 重複 rule）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 16, lineHeight: 2.0 });
    const css = document.getElementById('__jread-style').textContent;
    // 使用者自設 lineHeight=2.0 應生效
    assert.ok(/line-height:\s*2/.test(css),
      '非預設 lineHeight=2.0 應生效');
    // line-height rule 只出現一次
    const matches = css.match(/line-height:/g) || [];
    assert.strictEqual(matches.length, 1,
      `line-height rule 應只注入一次（實際出現 ${matches.length} 次）` +
      '—— fontSize 已改時 lineHeight 連帶 inline 在同一 block，不走獨立分支避免重複');
  });

  it('light theme（預設）→ 頁面底色 #ececec、reader card 有 base text color、後代 color inherit', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#ececec'), 'light 頁面底色應為 #ececec');
    // v0.7.179：reader card 必須有 base text color（#1a1a1a），搭配後代
    // color: inherit 確保 CMS 彩色 banner 白字在 bg strip 後仍可讀。
    assert.ok(
      /color:\s*#1a1a1a/.test(css),
      'light theme reader card 需設 base text color #1a1a1a（v0.7.179 white-text fix）'
    );
    // 後代必須有 color: inherit 規則
    assert.ok(
      /color:\s*inherit\s*!important/.test(css),
      'light theme 後代需有 color: inherit（v0.7.179 white-text fix）'
    );
  });

  it('color inherit 規則排除 figcaption（v0.7.196 TWZ 圖說對比度修法）', () => {
    // figcaption 的背景被 background strip 規則的 :not(figcaption) 保留，
    // color inherit 也必須排除 figcaption，否則深色背景 + 深色繼承文字 = 不可讀。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // light theme：color: inherit 規則必須有 :not(figcaption)
    const colorInheritRule = css.match(/\[[^\]]*="1"\]\s*\*[^{]*\{[^}]*color:\s*inherit\s*!important/);
    assert.ok(colorInheritRule, 'CSS 必須有 color: inherit 規則');
    assert.ok(
      colorInheritRule[0].includes(':not(figcaption)'),
      'color: inherit 規則必須排除 figcaption（背景保留 ∴ 文字色也保留）'
    );
  });

  it('dark/sepia theme color 規則排除 figcaption（v0.7.196）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'dark' });
    const css = document.getElementById('__jread-style').textContent;
    // dark theme 的 [article] * { color: theme.text } 必須排除 figcaption
    const themeColorRules = css.match(/\[data-jread-active="1"\]\s*\*[^{]*\{[^}]*color:\s*#d4d4d4/g);
    assert.ok(themeColorRules, 'dark theme 必須有 * { color } 規則');
    const hasExclusion = themeColorRules.some(r => r.includes(':not(figcaption)'));
    assert.ok(hasExclusion, 'dark theme * { color } 規則必須排除 figcaption');
  });

  it('light theme → 顯式 link 色 #1a73e8 + underline（v0.7.197 TWZ 白字連結修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/color:\s*#1a73e8/.test(css), 'light theme 必須有 link 色 #1a73e8');
    assert.ok(
      /\[data-jread-active="1"\]\s*a[^{]*\{[^}]*text-decoration:\s*underline/.test(css),
      'light theme link 必須有 underline'
    );
  });

  it('dark theme → 注入文字色 + 卡片底色 + 可讀 link 色（避免連結與正文同色無法辨識）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'dark' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#0b0b0b'), 'dark 頁面底色');
    assert.ok(css.includes('#1a1a1a'), 'dark 卡片底色');
    assert.ok(/color:\s*#d4d4d4/.test(css), 'dark 文字色必須注入（覆蓋原站色）');
    assert.ok(/color:\s*#7fb5e6/.test(css), 'dark link 色必須是 #7fb5e6');
    assert.ok(/text-decoration:\s*underline/.test(css), 'dark link 必須有 underline（色 + 線雙通道差異化）');
  });

  it('sepia theme → 注入文字色 + 卡片底色 + 可讀 link 色', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'sepia' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#cdb891'), 'sepia 頁面底色');
    assert.ok(css.includes('#f4ecd8'), 'sepia 卡片底色');
    assert.ok(/color:\s*#5b4636/.test(css), 'sepia 文字色');
    assert.ok(/color:\s*#2c5282/.test(css), 'sepia link 色必須是 #2c5282（JRead primary-700）');
    assert.ok(/text-decoration:\s*underline/.test(css), 'sepia link 必須有 underline');
  });

  it('contentWidth 永遠注入（卡片骨架不可缺）', () => {
    // contentWidth 是卡片的 max-width——不注入卡片會散掉。因此不走
    // 「改過才套」邏輯，預設 720 也注入。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css720 = document.getElementById('__jread-style').textContent;
    assert.ok(/max-width:\s*720px/.test(css720));

    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, contentWidth: 880 });
    const css880 = document.getElementById('__jread-style').textContent;
    assert.ok(/max-width:\s*880px/.test(css880));
  });

  it('Auto (fontSize=0) 下 CSS 不得套 heading / p / ul / ol / li / blockquote / a 的「排版 typography」rule（font-size / color / line-height / font-family）', () => {
    // v0.6.0 設計：v0.5.x 對 heading / p 等下了 font-size / line-height /
    // color / font-family 排版 rule，在多站打架，baseline 全部移除——
    // typography 由原站 CSS 自己生效。
    // v0.7.100：放寬限制——允許 h1-h6 / figure 加 margin/padding（解 BBC
    // styled-components margin: 0 緊貼問題），但仍禁 typography 屬性。
    // v0.7.102：再放寬到 p / ul / ol / blockquote 加 margin/padding（同 BBC
    // p 緊貼問題），但仍禁 typography。li / a 維持完全不下 rule（避免列表
    // 內部結構 / 連結色被覆寫）。
    // v0.7.140：「fontSize > 0 一律注入 BODY_TEXT_SEL（含 p / li / blockquote
    // / dd / dt）穿透 BBC / NYT class rule」是必要設計——本條驗收必須用
    // fontSize=0 (Auto) 跑，確保「使用者明確選擇保留原站」時 styler 不主動
    // 對 p / li / blockquote 下 typography rule（baseline v0.6 精神）。
    // fontSize > 0 時的 BODY_TEXT_SEL rule 由另一條 spec 驗收。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 0 });
    const css = document.getElementById('__jread-style').textContent;

    // 可下 margin/padding rule 的 selector（v0.7.100 + v0.7.102 範圍）：
    // h1-h6 / p / ul / ol / blockquote。逐一驗其 rule block 不含 typography。
    // v0.7.254：font-weight 從本清單移除——字重三段是「明確控制項」，三段一律
    // 注入（含預設中 400），不走「Auto 保留原站」邏輯（原站若對內文設非 400 字重，
    // 中不注入會與細撞色，Jimmy cage 實證）。font-weight 的注入由本檔「fontWeight
    // 字重三段」describe 專驗。其餘 typography 屬性仍維持 Auto 不注入。
    const TYPO_PROPS = ['font-size', 'color', 'line-height', 'font-family', 'font-style'];
    function checkBlocks(re, label) {
      const blocks = css.match(re) || [];
      for (const block of blocks) {
        for (const prop of TYPO_PROPS) {
          const propRe = new RegExp('(?:^|[;{\\s])' + prop + '\\s*:', 'i');
          assert.ok(!propRe.test(block),
            `${label} rule 不得含 ${prop}（保留原站排版）；違反 block: ${block.slice(0, 120)}`);
        }
      }
    }
    checkBlocks(/\[data-jread-active="1"\]\s+h[1-6][^{]*\{[^}]*\}/g, 'h1-h6');
    checkBlocks(/\[data-jread-active="1"\]\s+p[\s,{][^{]*\{[^}]*\}/g, 'p');
    checkBlocks(/\[data-jread-active="1"\]\s+ul[\s,{][^{]*\{[^}]*\}/g, 'ul');
    checkBlocks(/\[data-jread-active="1"\]\s+ol[\s,{][^{]*\{[^}]*\}/g, 'ol');
    checkBlocks(/\[data-jread-active="1"\]\s+blockquote[\s,{][^{]*\{[^}]*\}/g, 'blockquote');

    // li / a 維持完全不下 rule（baseline 不動）
    assert.ok(!/\]\s*li\s*\{/.test(css), '不得對 li 下 rule');
    assert.ok(!/\]\s*a\s*\{/.test(css), '不得對 a 下 rule（連結色保留原站）');
    assert.ok(!/font-size:\s*inherit/.test(css), '不得強制後代 font-size: inherit');
  });

  // v0.7.102：BBC styled-components p / ul / ol / blockquote margin: 0 → 段落緊貼。
  // 明示 1em margin-bottom（相對字級縮放，貼近瀏覽器 user-agent 預設）。
  it('p / ul / ol / blockquote 共用 rule 含 margin-bottom: 1em（BBC 段落間距修法）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 必有 rule block 同時涵蓋 p / ul / ol / blockquote
    const m = css.match(/\[data-jread-active="1"\]\s+p[\s\S]*?\[data-jread-active="1"\]\s+blockquote\s*\{([^}]*)\}/);
    assert.ok(m, 'p / ul / ol / blockquote 必須有共用 rule block（v0.7.102 段落間距修法）');
    const body = m[1];
    assert.ok(/margin-bottom\s*:\s*1em\s*!important/.test(body),
      'p/ul/ol/blockquote rule 必須含 margin-bottom: 1em !important；forcing：拿掉 → BBC 三段 p 緊貼無視覺斷層');
  });
});

// -----------------------------------------------------------------------------
// v0.7.38 macstories.net icon container 修法
// Jimmy 2026-04-25 回報：reader mode 啟動後 PixyCAD app icon 從 160x160 變超大
// 圖（撐滿 reader card 寬度）。根因：原站對 .media-wrapper-icon 設 width:160
// + img 設 width/height:100% 達成小 icon 顯示；jread 的 img:not(a>img)
// { height: auto !important } 把 height:100% 蓋掉、img 退到 naturalSize（512x512）
// + wrapper shrink-to-fit 跟著膨脹。
// 修法：styler 加新 rule 對含「wrapper-icon / media-icon / app-icon / icon-wrapper」
// 等 CMS 命名 pattern 的 wrapper 內 img 套 max-width/max-height: 200px。
// -----------------------------------------------------------------------------
describe('styler — v0.7.38 icon container 限縮（macstories app icon 修法）', () => {
  it('CSS 必須含 [class*="wrapper-icon"] / [class*="app-icon"] / [class*="icon-wrapper"] 等 selector', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/\[class\*="wrapper-icon"\]\s+img/.test(css),
      'CSS 必須含 [class*="wrapper-icon"] img selector—— 命中 macstories media-wrapper-icon');
    assert.ok(/\[class\*="app-icon"\]\s+img/.test(css),
      'CSS 必須含 [class*="app-icon"] img selector—— 跨站 CMS 命名 pattern');
    assert.ok(/\[class\*="icon-wrapper"\]\s+img/.test(css),
      'CSS 必須含 [class*="icon-wrapper"] img selector—— 反向命名 pattern');
  });

  it('icon container rule 必須含 max-width / max-height: 200px（限縮 icon 不退到 naturalSize）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 找含 wrapper-icon 的 rule block
    const m = css.match(/\[class\*="wrapper-icon"\][^{]*\{([^}]*)\}/);
    assert.ok(m, '應有 wrapper-icon rule block');
    const body = m[1];
    assert.ok(/max-width:\s*200px/.test(body),
      'icon container rule 必須含 max-width: 200px；forcing：拿掉此限制 → macstories icon 仍變超大');
    assert.ok(/max-height:\s*200px/.test(body),
      'icon container rule 必須含 max-height: 200px');
  });

  it('icon container rule selector 必須用 :not(a > img) 排除 link-wrapped icon', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 抓含 wrapper-icon 的 selector list
    const m = css.match(/(\[data-jread-active="1"\]\s+\[class\*="wrapper-icon"\][^{]*)\{/);
    assert.ok(m, '應找到 wrapper-icon selector');
    const sel = m[1];
    assert.ok(/img:not\(a\s*>\s*img\)/.test(sel),
      'icon container selector 必須用 img:not(a > img)（與既有 a > img icon-link 例外協調）；' +
      'forcing：用 naked img 會誤打到 link-wrapped icon、且踩到 styler spec line 145 forcing');
  });
});

// -----------------------------------------------------------------------------
// v0.7.90：auto-hide scrollbar 注入 + scroll listener 生命週期
// -----------------------------------------------------------------------------
// 站點常用 `scrollbar-width: none` / `::-webkit-scrollbar { display: none }`
// 隱藏整個 scroll bar，reader mode 啟動後使用者捲動時看不到任何 indicator。
// styler 注入 thin scrollbar override + 自製 webkit-scrollbar，並在 apply 時
// install scroll listener（觸發 [data-jread-scrolling="1"] attr）、restore 時
// 移除。jsdom 不算 layout / 不 render scrollbar，本 spec 驗的是「CSS 字串
// 含 override」+「scroll 事件能正確觸發 attr」+「restore 後 attr 清除」。
// -----------------------------------------------------------------------------
describe('styler — v0.7.90 auto-hide scrollbar', () => {
  it('CSS 含 scrollbar-width: thin override（站點 scrollbar-width: none 反制）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/html\.__jread-active\s*\{[^}]*scrollbar-width:\s*thin\s*!important/.test(css),
      'CSS 必須含 html.__jread-active 的 scrollbar-width: thin !important（override 站點 scrollbar-width: none）');
  });

  it('CSS 含 ::-webkit-scrollbar 8px override（站點 ::-webkit-scrollbar { display: none } 反制）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/html\.__jread-active::-webkit-scrollbar\s*\{[^}]*width:\s*8px\s*!important/.test(css),
      'CSS 必須含 ::-webkit-scrollbar 的 width: 8px !important');
    assert.ok(/html\.__jread-active::-webkit-scrollbar\s*\{[^}]*display:\s*block\s*!important/.test(css),
      'CSS 必須含 ::-webkit-scrollbar 的 display: block !important（override 站點 display: none）');
  });

  it('CSS 預設 thumb transparent，scrolling attr 時切到 theme.scrollThumb 色（auto-hide 機制核心）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 預設 thumb 透明
    assert.ok(/html\.__jread-active::-webkit-scrollbar-thumb\s*\{[^}]*background-color:\s*transparent\s*!important/.test(css),
      'CSS 必須讓 scrollbar-thumb 預設 background-color: transparent（auto-hide 預設狀態）');
    // scrolling attr 觸發顯色（light theme thumb）
    assert.ok(/html\.__jread-active\[data-jread-scrolling="1"\]::-webkit-scrollbar-thumb\s*\{[^}]*rgba\(0,\s*0,\s*0,\s*0\.3\)/.test(css),
      'CSS 必須含 [data-jread-scrolling="1"] 觸發 light theme thumb rgba(0,0,0,0.3)');
  });

  it('CSS 含 transition（fade-in/out 順暢）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/transition:\s*background-color\s*0\.3s/.test(css),
      'CSS 必須含 thumb 的 transition: background-color 0.3s（fade 順暢度）');
  });

  it('dark theme 注入 light thumb（rgba(255,255,255,0.3)，避免黑底黑 thumb 不可見）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'dark' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/rgba\(255,\s*255,\s*255,\s*0\.3\)/.test(css),
      'dark theme 必須注入淺色 thumb rgba(255,255,255,0.3)（黑底不可見問題）');
  });

  it('apply 後 dispatch scroll event → html 帶 [data-jread-scrolling="1"]', () => {
    const { window, document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    // scroll 事件前 attr 不存在
    assert.strictEqual(document.documentElement.getAttribute('data-jread-scrolling'), null);
    // 觸發 scroll
    window.dispatchEvent(new window.Event('scroll'));
    // attr 立刻存在
    assert.strictEqual(document.documentElement.getAttribute('data-jread-scrolling'), '1',
      'scroll 事件觸發後 html 必須立刻帶 data-jread-scrolling="1"');
  });

  it('restore 後 dispatch scroll event 不再觸發 attr（listener 已移除）', () => {
    const { window, document, NS, articleEl } = setup();
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    // 確認 restore 後 attr 已清
    assert.strictEqual(document.documentElement.getAttribute('data-jread-scrolling'), null);
    // 觸發 scroll，attr 不應再被加上
    window.dispatchEvent(new window.Event('scroll'));
    assert.strictEqual(document.documentElement.getAttribute('data-jread-scrolling'), null,
      'restore 後 scroll listener 必須已被移除——再 dispatch scroll 不應重新加上 attr');
  });

  it('restore 立刻清除 [data-jread-scrolling="1"]（避免關閉閱讀模式後殘留 attr）', () => {
    const { window, document, NS, articleEl } = setup();
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    window.dispatchEvent(new window.Event('scroll'));
    assert.strictEqual(document.documentElement.getAttribute('data-jread-scrolling'), '1');
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(document.documentElement.getAttribute('data-jread-scrolling'), null,
      'restore() 必須同步清除 data-jread-scrolling attr');
  });
});

// -----------------------------------------------------------------------------
// v0.7.91：SPACE 鍵捲動（reader mode 啟動後 SPACE 可往下捲一頁、Shift+SPACE 反向）
// -----------------------------------------------------------------------------
// 原站攔截 keydown 或 focus 跑掉時瀏覽器原生 SPACE 捲動失效。styler 在 window
// 層級 capture phase 攔 keydown SPACE，自己呼叫 window.scrollBy。input /
// textarea / select / contenteditable focus 時放行（避免吃掉表單空白輸入）。
// jsdom 的 window.scrollBy 是 no-op 但存在；本 spec 用 spy 蓋掉驗呼叫參數。
// -----------------------------------------------------------------------------
describe('styler — v0.7.91 SPACE 捲動', () => {
  function spyScrollBy(window) {
    const calls = [];
    window.scrollBy = function (...args) { calls.push(args); };
    return calls;
  }

  function fireSpace(window, opts) {
    const ev = new window.KeyboardEvent('keydown', Object.assign({
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true
    }, opts || {}));
    window.dispatchEvent(ev);
    return ev;
  }

  it('apply 後 dispatch SPACE → preventDefault + scrollBy 往下捲 viewport*0.92', () => {
    const { window, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    const calls = spyScrollBy(window);
    const ev = fireSpace(window);
    assert.strictEqual(ev.defaultPrevented, true,
      'SPACE keydown 必須 preventDefault（攔截原站 / 預設行為）');
    assert.strictEqual(calls.length, 1, 'window.scrollBy 必須被呼叫一次');
    const arg = calls[0][0];
    assert.ok(arg && typeof arg === 'object', 'scrollBy 必須收 options 物件');
    assert.ok(arg.top > 0, 'top 必須為正（往下）');
    assert.strictEqual(arg.top, 920, 'top 必須等於 innerHeight * 0.92 = 920');
  });

  it('Shift+SPACE → scrollBy 往上捲（top 為負）', () => {
    const { window, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    const calls = spyScrollBy(window);
    const ev = fireSpace(window, { shiftKey: true });
    assert.strictEqual(ev.defaultPrevented, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0].top, -920, 'Shift+SPACE 必須讓 top 變負（往上）');
  });

  it('input focus 時 SPACE 放行（不攔、不 scroll）', () => {
    const { window, document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    assert.strictEqual(document.activeElement, input);
    const calls = spyScrollBy(window);
    const ev = fireSpace(window);
    assert.strictEqual(ev.defaultPrevented, false,
      'input focus 時 SPACE 不該被 preventDefault（讓使用者輸入空格）');
    assert.strictEqual(calls.length, 0, 'input focus 時不該呼叫 scrollBy');
  });

  it('textarea focus 時 SPACE 放行', () => {
    const { window, document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    const calls = spyScrollBy(window);
    const ev = fireSpace(window);
    assert.strictEqual(ev.defaultPrevented, false);
    assert.strictEqual(calls.length, 0);
  });

  it('contenteditable focus 時 SPACE 放行', () => {
    const { window, document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    div.focus();
    const calls = spyScrollBy(window);
    const ev = fireSpace(window);
    assert.strictEqual(ev.defaultPrevented, false,
      'contenteditable focus 時 SPACE 不該被 preventDefault（避免吃掉編輯空格）');
    assert.strictEqual(calls.length, 0);
  });

  it('Ctrl/Cmd/Alt + SPACE 不攔（保留瀏覽器/系統快速鍵）', () => {
    const { window, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const calls = spyScrollBy(window);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const ev = fireSpace(window, mod);
      assert.strictEqual(ev.defaultPrevented, false,
        `${JSON.stringify(mod)} + SPACE 不該被攔截（系統 / 瀏覽器快速鍵）`);
    }
    assert.strictEqual(calls.length, 0, 'modifier + SPACE 不該觸發 scrollBy');
  });

  it('非 SPACE 鍵不觸發（避免誤攔 a / Enter / Tab 等）', () => {
    const { window, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const calls = spyScrollBy(window);
    for (const k of ['a', 'Enter', 'Tab', 'ArrowDown', 'PageDown']) {
      const ev = new window.KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      assert.strictEqual(ev.defaultPrevented, false, `${k} 不該被攔截`);
    }
    assert.strictEqual(calls.length, 0);
  });

  it('restore 後 SPACE keydown 不再觸發 scrollBy（listener 移除）', () => {
    const { window, NS, articleEl } = setup();
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    const calls = spyScrollBy(window);
    const ev = fireSpace(window);
    assert.strictEqual(ev.defaultPrevented, false,
      'restore 後 SPACE 不該再被 jread 攔截（listener 已移除）');
    assert.strictEqual(calls.length, 0);
  });
});

// =============================================================================
// v0.7.93 substack imageRow flex gallery 修法
// 對應 fixture: substack-imagerow-flex-gallery.html
// Bug 來源 (2026-05-13 Jimmy 回報 synapseching.substack.com /p/17):
//   imageRow flex 子預設 align-items: stretch 把 picture 拉到固定 height 230,
//   IMG natural ratio 295 → IMG 從 imageRow 底部溢出 65px 蓋住下方段落文字。
// 修法 runtime: styler.apply() 掃 articleEl 內所有 flex/grid 容器 (含直接
//   picture/img/figure 子) 強制 display: block + height: auto + min-height: 0,
//   reader card 單欄閱讀情境下並列圖改成垂直堆疊,圖不再溢出。
// =============================================================================
describe('styler — v0.7.93 substack imageRow flex gallery', () => {
  const SUBSTACK_FIXTURE = path.join(__dirname, 'fixtures', 'substack-imagerow-flex-gallery.html');

  function setupSubstack() {
    const env = loadFixtureWithScripts({
      fixturePath: SUBSTACK_FIXTURE,
      scripts: ['detector', 'styler']
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'detector 必須命中 substack 主文');
    return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
  }

  it('apply() 把 .imageRow flex container display 改成 block (inline style + important)', () => {
    const { document, NS, articleEl } = setupSubstack();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const imageRow = document.querySelector('.imageRow-_Y6x8T');
    assert.ok(imageRow, 'fixture 必須含 imageRow');
    const inlineDisplay = imageRow.style.getPropertyValue('display');
    const inlinePriority = imageRow.style.getPropertyPriority('display');
    assert.strictEqual(inlineDisplay, 'block',
      `imageRow display 應改為 block, 實際="${inlineDisplay}"`);
    assert.strictEqual(inlinePriority, 'important',
      `imageRow display 必須有 !important, 否則打不過原站 stylesheet`);
  });

  it('apply() 把 .imageRow 的 height 改為 auto + min-height: 0 (inline !important)', () => {
    const { document, NS, articleEl } = setupSubstack();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const imageRow = document.querySelector('.imageRow-_Y6x8T');
    assert.strictEqual(imageRow.style.getPropertyValue('height'), 'auto',
      'imageRow height 應為 auto');
    assert.strictEqual(imageRow.style.getPropertyPriority('height'), 'important',
      'imageRow height 必須 !important');
    assert.strictEqual(imageRow.style.getPropertyValue('min-height'), '0',
      'imageRow min-height 應為 0');
  });

  it('restore() 後 .imageRow display/height/min-height 還原為原值', () => {
    const { document, NS, articleEl } = setupSubstack();
    const imageRow = document.querySelector('.imageRow-_Y6x8T');
    const beforeDisplay = imageRow.style.getPropertyValue('display');
    const beforeHeight = imageRow.style.getPropertyValue('height');
    const beforeMinHeight = imageRow.style.getPropertyValue('min-height');
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(imageRow.style.getPropertyValue('display'), beforeDisplay,
      `restore 後 inline display 必須還原 (原="${beforeDisplay}")`);
    assert.strictEqual(imageRow.style.getPropertyValue('height'), beforeHeight,
      `restore 後 inline height 必須還原 (原="${beforeHeight}")`);
    assert.strictEqual(imageRow.style.getPropertyValue('min-height'), beforeMinHeight,
      `restore 後 inline min-height 必須還原 (原="${beforeMinHeight}")`);
  });

  it('snapshot.galleryFlex 必須記錄被處理的 flex/grid 容器 (forcing function)', () => {
    const { NS, articleEl } = setupSubstack();
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.ok(Array.isArray(snap.galleryFlex),
      'snapshot 必須含 galleryFlex 陣列');
    assert.ok(snap.galleryFlex.length >= 1,
      `galleryFlex 應至少含一個 imageRow,實際 length=${snap.galleryFlex.length}`);
  });

  it('非含媒體 flex 容器不被改動 (避免誤殺 layout)', () => {
    const { document, NS, articleEl } = setupSubstack();
    // 注入一個 flex container 但不含 picture/img/figure 子, 應不被改動
    const flexWithoutMedia = document.createElement('div');
    flexWithoutMedia.style.display = 'flex';
    flexWithoutMedia.className = 'flex-without-media';
    flexWithoutMedia.innerHTML = '<span>A</span><span>B</span>';
    articleEl.appendChild(flexWithoutMedia);
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    // styler 後 inline display 應仍為 flex (沒被 runtime 改 block)
    assert.strictEqual(flexWithoutMedia.style.getPropertyValue('display'), 'flex',
      '非含媒體 flex 不該被 runtime 改成 block');
  });
});

// =============================================================================
// v0.7.94 gallery 子間距修法
// Jimmy 2026-05-13 回報 v0.7.93 並列圖改垂直後三張照片緊貼,沒間距。
// 修法 styler runtime: gallery container 內媒體直接子 (figure/picture/img/a/div)
// 強制 inline margin-bottom: 12px !important 補空白。restore 還原原 inline 值。
// =============================================================================
describe('styler — v0.7.94 gallery 子間距', () => {
  const SUBSTACK_FIXTURE = path.join(__dirname, 'fixtures', 'substack-imagerow-flex-gallery.html');

  function setupSubstack() {
    const env = loadFixtureWithScripts({
      fixturePath: SUBSTACK_FIXTURE,
      scripts: ['detector', 'styler']
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected);
    return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
  }

  it('apply() 對 gallery 內直接子 figure 設 inline margin-bottom: 12px !important', () => {
    const { document, NS, articleEl } = setupSubstack();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const figs = document.querySelectorAll('.imageRow-_Y6x8T > figure');
    assert.ok(figs.length >= 2, `fixture imageRow 應含 >= 2 figure (實際=${figs.length})`);
    for (const f of figs) {
      assert.strictEqual(f.style.getPropertyValue('margin-bottom'), '12px',
        `gallery 內 figure 必須有 margin-bottom 12px`);
      assert.strictEqual(f.style.getPropertyPriority('margin-bottom'), 'important',
        `gallery 內 figure margin-bottom 必須 !important`);
    }
  });

  it('restore() 後 gallery 內 figure margin-bottom 還原', () => {
    const { document, NS, articleEl } = setupSubstack();
    const figs = document.querySelectorAll('.imageRow-_Y6x8T > figure');
    const before = [...figs].map(f => f.style.getPropertyValue('margin-bottom'));
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    [...figs].forEach((f, i) => {
      assert.strictEqual(f.style.getPropertyValue('margin-bottom'), before[i],
        `restore 後 inline margin-bottom 應還原 (原="${before[i]}")`);
    });
  });

  it('非 gallery 內的 figure 不被加 margin-bottom (避免誤殺)', () => {
    const { document, NS, articleEl } = setupSubstack();
    // 注入一個自由 figure (非 gallery container 內), 應不被改
    const standaloneFig = document.createElement('figure');
    standaloneFig.id = 'standalone-fig';
    standaloneFig.innerHTML = '<img src="data:image/svg+xml,%3Csvg/%3E">';
    articleEl.appendChild(standaloneFig);
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(standaloneFig.style.getPropertyValue('margin-bottom'), '',
      'gallery 外的 figure 不該被 runtime 加 margin');
  });
});

describe('styler — vocus.cc Lexical span 字型穿透（v0.7.152）', () => {
  // 案例 / 修法：BODY_TEXT_SEL 加入 span（含 icon class :not exclusions），
  // 讓使用者「字型」設定能穿透 WYSIWYG 編輯器（Lexical / TipTap / ProseMirror /
  // Slate / Draft.js 等）對 span 自身寫 font-family 的 rule。同時保留 icon font
  // span（material-icons / font-awesome / emoji / badge）不被覆寫。
  function setupVocus() {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'vocus-lexical-span.html'),
      scripts: ['detector', 'styler']
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'vocus fixture detector 必須命中');
    return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
  }

  it('span selector 含 icon class :not exclusions（避免 material-icons / font-awesome / badge / emoji 等 icon font span 被覆寫 font-family）', () => {
    const { document, NS, articleEl } = setupVocus();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontFamily: 'Georgia' });
    const css = document.getElementById('__jread-style').textContent;
    // 找 font-family rule 所在 selector list
    const re = /([^}]*)\{[^}]*font-family\s*:/i;
    const m = css.match(re);
    assert.ok(m, 'CSS 應含 font-family rule');
    const selectorList = m[1];
    // 切出 span 條
    const spanCond = selectorList.split(',').map(s => s.trim()).find(s => /\bspan\b/.test(s));
    assert.ok(spanCond, 'selector list 必須含 span 條');
    // 必含 icon-related :not exclusions
    for (const token of ['icon', 'material-', 'fa-', 'emoji', 'badge']) {
      assert.ok(spanCond.includes(token),
        `span selector 必須含 :not(...) 排除 "${token}" class（避免 icon font / badge 被覆寫 font-family）；實際 spanCond="${spanCond}"`);
    }
  });

  it('注入的 span selector 命中 vocus 純 span（lexical__paragraph > span，無 class），但不命中 material-icons span', () => {
    // 用 styler 注入的 CSS rule selector 直接走 querySelectorAll 驗 DOM 命中。
    // 這條 spec 是 vocus 修法的核心 forcing function：純 span 必須被命中（讓
    // font-family override 生效），icon span 必須跳過。
    const { document, NS, articleEl } = setupVocus();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontFamily: 'Georgia' });
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/([^}]*)\{[^}]*font-family\s*:/i);
    const selectorList = m[1];
    const spanCond = selectorList.split(',').map(s => s.trim()).find(s => /\bspan\b/.test(s));
    assert.ok(spanCond, 'selector list 必須含 span 條');

    // 純 span（vocus pattern）：lexical__paragraph > span，無 class
    const plainSpan = articleEl.querySelector('p.lexical__paragraph > span');
    assert.ok(plainSpan, 'fixture 必有 vocus 純 span');
    assert.strictEqual(plainSpan.className, '', 'plainSpan 應無 class（vocus 真實 pattern）');

    // v0.7.164：剝掉 `:not(pre *)` / `:not(code *)` 子句後再丟 jsdom。jsdom
    // nwsapi CSS engine 不支援 Selectors 4 「:not() 內含 complex selector」
    // （Chrome 88+ runtime 完全支援）。spec 驗的是 vocus span 命中行為，跟
    // pre/code 排除無關——剝掉該子句不影響本 spec 邏輯。:not(pre *):not(code *)
    // 的存在性另由 styler-pre-code-monospace-preserve.spec.js 驗。
    const jsdomCompatSel = spanCond
      .replace(/:not\(pre\s*\*\s*\)/g, '')
      .replace(/:not\(code\s*\*\s*\)/g, '');
    const matched = [...articleEl.querySelectorAll(jsdomCompatSel)];
    assert.ok(matched.includes(plainSpan),
      `純 span 應被 selector "${jsdomCompatSel}" 命中（讓 vocus 類站點 font-family override 生效）`);

    // negative case：material-icons span 不該被命中
    const iconSpan = articleEl.querySelector('span.material-icons');
    assert.ok(iconSpan, 'fixture 必有 material-icons span 做 negative case');
    assert.ok(!matched.includes(iconSpan),
      `material-icons span 不該被 span selector 命中（保留 icon font 字型不被使用者「字型」設定覆寫成襯線/無襯線）`);
  });
});

describe('styler — Wikipedia infobox table 字級穿透（v0.7.156）', () => {
  // 案例 / 修法：BODY_TEXT_SEL 加入 td / th / caption，讓使用者字級設定能穿透
  // Wikipedia `table.infobox { font-size: 0.88em }` 類站點對 table cell 字級的
  // 縮小規則。Jimmy 2026-05-21 Wikipedia /Longchamp_(company) Chrome 翻譯成
  // zh-TW 實測：body p = 18px ✓ / infobox td/th = 15.84px ✗（0.88em 繼承）+
  // CJK 字型 metric 比 Latin 視覺再小一階 → 體感「中文特別小」。
  function setupWiki() {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'wikipedia-infobox-table.html'),
      scripts: ['detector', 'styler']
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'Wikipedia fixture detector 必須命中');
    return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
  }

  it('注入的 selector 命中 fixture 內所有 infobox td / th / caption', () => {
    const { document, NS, articleEl } = setupWiki();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 20 });
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/([^}]*)\{[^}]*font-size\s*:\s*20px/i);
    assert.ok(m, 'CSS 應含 font-size: 20px rule');
    const selectorList = m[1];
    // 切出 td / th / caption 各自的條
    const tdCond = selectorList.split(',').map(s => s.trim()).find(s => /\btd\b/.test(s));
    const thCond = selectorList.split(',').map(s => s.trim()).find(s => /\bth\b/.test(s));
    const capCond = selectorList.split(',').map(s => s.trim()).find(s => /\bcaption\b/.test(s));
    assert.ok(tdCond, 'selector list 必須含 td 條');
    assert.ok(thCond, 'selector list 必須含 th 條');
    assert.ok(capCond, 'selector list 必須含 caption 條');

    // fixture 內 4 個 td、4 個 th、1 個 caption 必須全被命中
    const tds = articleEl.querySelectorAll('td');
    const ths = articleEl.querySelectorAll('th');
    const caps = articleEl.querySelectorAll('caption');
    assert.strictEqual(tds.length, 4, 'fixture 應有 4 個 td');
    assert.strictEqual(ths.length, 4, 'fixture 應有 4 個 th');
    assert.strictEqual(caps.length, 1, 'fixture 應有 1 個 caption');

    const matchedTds = [...articleEl.querySelectorAll(tdCond)];
    const matchedThs = [...articleEl.querySelectorAll(thCond)];
    const matchedCaps = [...articleEl.querySelectorAll(capCond)];
    assert.strictEqual(matchedTds.length, 4,
      `td selector "${tdCond}" 應命中 fixture 內全部 4 個 td；實際命中 ${matchedTds.length}`);
    assert.strictEqual(matchedThs.length, 4,
      `th selector "${thCond}" 應命中 fixture 內全部 4 個 th；實際命中 ${matchedThs.length}`);
    assert.strictEqual(matchedCaps.length, 1,
      `caption selector "${capCond}" 應命中 fixture 內 caption；實際命中 ${matchedCaps.length}`);
  });

  it('font-family override 同樣命中 td / th / caption（穿透 Wikipedia infobox 字型 rule）', () => {
    // 動機等同字級：infobox 若用 stylesheet 設 font-family（少見但有），使用者
    // 「字型」設定不該對 cell 失效。
    const { document, NS, articleEl } = setupWiki();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontFamily: 'Georgia' });
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/([^}]*)\{[^}]*font-family\s*:/i);
    assert.ok(m, 'CSS 應含 font-family rule');
    const selectorList = m[1];
    for (const tag of ['td', 'th', 'caption']) {
      const cond = selectorList.split(',').map(s => s.trim()).find(s => new RegExp('\\b' + tag + '\\b').test(s));
      assert.ok(cond,
        `font-family selector list 必須含 ${tag} 條（v0.7.156：字型 override 與字級 override 同邊界）`);
    }
  });

  it('table 自己**不在** selector list（避免動 table-level layout：行高 / 邊框 / column 寬）', () => {
    // 設計選擇：只攔 cell 級避免破壞 table 整體 layout。table 上若有 font-size
    // override 會影響 em-based padding / border-spacing / col width 等。
    const { document, NS, articleEl } = setupWiki();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 20 });
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/([^}]*)\{[^}]*font-size\s*:\s*20px/i);
    const selectorList = m[1];
    // 各條 selector 結尾不得是純 'table'（前後有空白或 comma 邊界）
    const conds = selectorList.split(',').map(s => s.trim());
    for (const cond of conds) {
      assert.ok(!/\s+table$/.test(cond),
        `selector list 不得含尾端為 "table" 的條（避免動 table-level layout）；實際違規條："${cond}"`);
    }
  });
});

describe('styler — fontWeight 字重三段（v0.7.254）', () => {
  // v0.7.254：取代 v0.7.157 boldText（-webkit-font-smoothing 只在 macOS 有差異、
  // 與「全平台適用」需求衝突）。改用真正的 font-weight：細 300 / 中 400（預設）/
  // 粗 600（Semibold）。**三段一律注入**（含 400）——原站若對內文設非 400 字重
  // （shoppingdesign `.htmlview p {300}`），中(400) 不注入會退回原站值與細撞色，
  // 故 400 也強制注入。只套 BODY_TEXT_SEL（內文載體、不含 h1-h6）。
  function setup() {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'styler']
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected);
    return { document: env.document, NS: env.NS, articleEl: detected.el };
  }

  it('fontWeight: 400 (中，預設) → 仍注入 font-weight: 400 !important（強制蓋原站字重）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontWeight: 400 });
    const css = document.getElementById('__jread-style').textContent;
    assert.match(css, /font-weight\s*:\s*400\s*!important/i,
      '中（預設）也必須注入 font-weight: 400 !important——否則原站內文非 400 時中會退回原站值、與細撞成同色（shoppingdesign 案例）');
  });

  it('fontWeight: 600 (粗 Semibold) → 注入 font-weight: 600 !important', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontWeight: 600 });
    const css = document.getElementById('__jread-style').textContent;
    assert.match(css, /font-weight\s*:\s*600\s*!important/i,
      '粗模式必須注入 font-weight: 600 !important（Semibold，比 700 輕、跨平台不撞色）');
  });

  it('fontWeight: 300 (細) → 注入 font-weight: 300 !important', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontWeight: 300 });
    const css = document.getElementById('__jread-style').textContent;
    assert.match(css, /font-weight\s*:\s*300\s*!important/i,
      '細模式必須注入 font-weight: 300 !important（全平台真實字重）');
  });

  it('font-weight rule 必須 scoped 到 [data-jread-active]、且不套 h1-h6（保留標題階層）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontWeight: 600 });
    const css = document.getElementById('__jread-style').textContent;
    const m = css.match(/([^{}]+)\{\s*font-weight\s*:\s*600\s*!important/i);
    assert.ok(m, '應找得到 font-weight: 600 rule');
    assert.match(m[1], /data-jread-active/,
      'font-weight rule 必須 scoped 到 [data-jread-active]，不可全域套');
    // selector 不可「正向」選到 h1-h6（`="1"] h1` 這類後代選擇器）——標題字重
    // 交給原站 / UA bold 維持章節階層。注意 SPAN_TEXT_SEL 的 `:not(h1 *)` 是
    // 「排除」heading 後代、是保護機制，不算正向命中。
    assert.doesNotMatch(m[1], /="1"\]\s+h[1-6]\b/,
      'font-weight rule selector 不可正向命中 h1-h6（標題字重不受字重設定影響）');
    // 反向確認 heading 保護仍在（span 排除 heading 後代）
    assert.match(m[1], /:not\(h1 \*\)/,
      'BODY_TEXT_SEL 必須保留 :not(h1 *) 等 heading 後代排除（避免壓到標題內 span）');
  });

  it('非法 fontWeight（700 / 500 / 字串 / undefined）→ 回退中、注入 400（不注入 300/600）', () => {
    for (const bad of [700, 500, '600', undefined, null, 0]) {
      const { document, NS, articleEl } = setup();
      NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontWeight: bad });
      const css = document.getElementById('__jread-style').textContent;
      assert.match(css, /font-weight\s*:\s*400\s*!important/i,
        `非法值 ${JSON.stringify(bad)} 應回退中（400）並注入 400`);
      assert.doesNotMatch(css, /font-weight\s*:\s*(300|600|700|500)\s*!important/i,
        `非法值 ${JSON.stringify(bad)} 不可注入 300/500/600/700`);
    }
  });
});

describe('styler — font-smoothing antialiased（v0.7.157 商周中文字粗修法）', () => {
  // 動機：Jimmy 2026-05-21 回報 businessweekly.com.tw/Archive/Article?StrId=7014202
  // 閱讀模式下中文「字體比較粗」。probe：商周 stylesheet 沒設
  // `-webkit-font-smoothing`，macOS Chrome auto = subpixel-antialiased，PingFang
  // TC fallback render 視覺偏粗。Medium / NYT / Substack 等專業閱讀站普遍套
  // antialiased — reader card 統一套以對齊業界閱讀體驗。
  function setupBusinessweekly() {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'styler']
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'businessweekly fixture detector 必須命中');
    return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
  }

  it('注入的 CSS 必須含 `-webkit-font-smoothing: antialiased` 給 [data-jread-active]', () => {
    const { document, NS, articleEl } = setupBusinessweekly();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.match(css, /-webkit-font-smoothing\s*:\s*antialiased/i,
      'styler 必須給 reader card 注入 -webkit-font-smoothing: antialiased（修商周類沒設 smoothing 的站 macOS 上字粗）');
    assert.match(css, /-moz-osx-font-smoothing\s*:\s*grayscale/i,
      'styler 必須給 reader card 注入 -moz-osx-font-smoothing: grayscale（macOS Firefox 對應 property）');
  });

  it('font-smoothing rule 必須 scoped 到 [data-jread-active]（不影響原站視覺）', () => {
    const { document, NS, articleEl } = setupBusinessweekly();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 找 antialiased 那條 rule 的 selector
    const m = css.match(/([^{}]+)\{[^}]*-webkit-font-smoothing\s*:\s*antialiased/i);
    assert.ok(m, '應找得到 antialiased rule 區塊');
    const selectorList = m[1];
    assert.match(selectorList, /data-jread-active/,
      'antialiased rule 必須 scoped 到 [data-jread-active]，不可全域套（會污染原站）');
  });

  it('reader card 內後代必須 inherit smoothing（防站點 stylesheet 子層級重設 auto）', () => {
    const { document, NS, articleEl } = setupBusinessweekly();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // universal selector 區塊內必須含 inherit（合併進原 max-width: 100% 那條）
    assert.match(css, /-webkit-font-smoothing\s*:\s*inherit/i,
      'CSS 必須含 -webkit-font-smoothing: inherit—— 防站點 stylesheet 在子層級重設 auto 把 reader card 內某些元素拉回 subpixel');
    assert.match(css, /-moz-osx-font-smoothing\s*:\s*inherit/i,
      'CSS 必須含 -moz-osx-font-smoothing: inherit（Firefox 對應）');
  });
});
