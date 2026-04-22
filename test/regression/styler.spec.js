// JRead — styler regression spec（v0.6.0 瘦身版）
// jsdom 不算 layout 與 CSS，所以本 spec 驗的是「注入結構」與「可逆性」，
// 不驗視覺效果。視覺效果由 Chrome harness 驗（見 CLAUDE.md）。
//
// v0.6.0 重構目標：styler 盡量不動原站內文排版（font / margin / heading /
// list / link 等），只套卡片容器 + 必要 reset + 使用者 override。因此本 spec
// 大量砍掉舊版對「CSS 內容細節」的斷言（font-size inherit / heading margin /
// link 色 / 媒體容器 margin / structural-link 標記等），改以行為斷言為主。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');
const STYLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'),
  'utf8'
);
const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
  'utf8'
);

function setup() {
  const html = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  window.__JRead = { state: {}, MSG: {} };
  window.eval(DETECTOR_SRC);
  window.eval(STYLER_SRC);
  const detected = window.__JRead.detector.detect();
  assert.ok(detected, 'detector 必須命中商周主文');
  return { window, document: window.document, NS: window.__JRead, articleEl: detected.el };
}

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7
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

  it('apply() 替主文容器的祖先鏈標 data-jread-ancestor="1"（到 body 為止）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const main = document.querySelector('main');
    assert.ok(main, 'fixture 應有 <main>');
    assert.strictEqual(main.getAttribute('data-jread-ancestor'), '1');
    assert.strictEqual(document.body.getAttribute('data-jread-ancestor'), null,
      'body 不應被標（祖先鏈到 body 為止）');
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

  it('CSS 含祖先鏈 reset（[data-jread-ancestor="1"] 清 max-width / margin / position）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/\[data-jread-ancestor="1"\][^}]*\{[^}]*max-width:\s*none/.test(css));
    assert.ok(/\[data-jread-ancestor="1"\][^}]*\{[^}]*margin:\s*0/.test(css));
    assert.ok(/\[data-jread-ancestor="1"\][^}]*\{[^}]*position:\s*static/.test(css));
  });

  // v0.6.14 起 styler **不再**有 `*:has(> img/picture/video)` 這條 blanket
  // reset——CSS level 無法區分「padding-bottom hack（Substack/Medium）」與
  // 「純 aspect-ratio 容器（Engadget 類 `aspect-ratio: 16/9` + img absolute
  // inset:0）」，誤傷後者會把主圖高度歸零。改由 cleaner.resetMediaPlaceholderPadding
  // 於 runtime 用 padding-bottom / width 比例判別再決定是否 reset。
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

    // picture 也必須有同等 rule
    const mp = css.match(/\[data-jread-active="1"\]\s+picture\s*\{([^}]*)\}|,\s*\[data-jread-active="1"\]\s+picture\s*\{([^}]*)\}/);
    assert.ok(/picture/.test(css), 'CSS 必須包含 picture selector');
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
  it('預設設定 → CSS 不注入 font-size / font-family / line-height 覆寫', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 卡片 rule 不得含這些 property（整個 CSS 都不得含）
    assert.ok(!/font-size:\s*\d+px/.test(css),
      '預設 fontSize 時不得注入 font-size（保留原站字級）');
    assert.ok(!/font-family:/.test(css),
      '預設 fontFamily 時不得注入 font-family（保留原站字體）');
    assert.ok(!/line-height:/.test(css),
      '預設 lineHeight 時不得注入 line-height（保留原站行高）');
  });

  it('非預設 fontSize → 注入 font-size', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 22 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(/font-size:\s*22px/.test(css));
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

  it('非預設 fontSize / fontFamily / lineHeight 的 rule 必須含 body text descendant selector（穿透 BBC / NYT 類站點 class rule）', () => {
    // BBC `.HooNV`、NYT article body class 等把 font-size / line-height /
    // font-family 鎖死在 `<p>` 身上——只對 `[data-jread-active="1"]` 自己下
    // rule 會被後代的 class rule 截斷 inheritance，override 失效。override
    // rule 必須列舉常見 body text 元素（p / li / blockquote / figcaption /
    // dd / dt）才能穿透站點 class specificity。heading h1-h6 不含（保留
    // 原站標題大小分級）。
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
      assert.ok(/\[data-jread-active="1"\]\s+figcaption\b/.test(selectorList),
        `${prop} 的 selector list 必須含 [data-jread-active="1"] figcaption`);
    }

    // 不得對 h1-h6 下 rule（保留原站標題分級）
    assert.ok(!/\[data-jread-active="1"\]\s+h[1-6]\b/.test(css),
      'override rule 不得包含 h1-h6 descendant（保留原站標題大小分級）');
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

  it('light theme（預設）→ 頁面底色 #ececec、不注入強制文字色', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#ececec'), 'light 頁面底色應為 #ececec');
    // light 預設 theme.text 為 null，不得注入 color override 到 body / article *
    assert.ok(
      !/color:\s*#1a1a1a/.test(css),
      'light theme 不得強制覆寫文字色（保留原站 color）'
    );
  });

  it('dark theme → 注入文字色 + 卡片底色', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'dark' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#0b0b0b'), 'dark 頁面底色');
    assert.ok(css.includes('#1a1a1a'), 'dark 卡片底色');
    assert.ok(/color:\s*#d4d4d4/.test(css), 'dark 文字色必須注入（覆蓋原站色）');
  });

  it('sepia theme → 注入文字色 + 卡片底色', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'sepia' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#cdb891'), 'sepia 頁面底色');
    assert.ok(css.includes('#f4ecd8'), 'sepia 卡片底色');
    assert.ok(/color:\s*#5b4636/.test(css), 'sepia 文字色');
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

  it('CSS 不得套 heading / p / ul / ol / li / blockquote / a 的排版 rule', () => {
    // v0.6.0 設計：這些 rule 在 v0.5.x 過度激進、互相打架，全部移除。
    // 原站的 heading margin / list style / link color / blockquote border 等
    // 由站點 CSS 自己生效。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(!/\]\s*h1\s*[,{]/.test(css), '不得對 h1 下 rule');
    assert.ok(!/\]\s*h2\s*[,{]/.test(css), '不得對 h2 下 rule');
    assert.ok(!/\]\s*p\s*\{/.test(css), '不得對 p 下 rule');
    assert.ok(!/\]\s*ul\s*[,{]/.test(css), '不得對 ul 下 rule');
    assert.ok(!/\]\s*ol\s*[,{]/.test(css), '不得對 ol 下 rule');
    assert.ok(!/\]\s*li\s*\{/.test(css), '不得對 li 下 rule');
    assert.ok(!/\]\s*blockquote\s*\{/.test(css), '不得對 blockquote 下 rule');
    assert.ok(!/\]\s*a\s*\{/.test(css), '不得對 a 下 rule（連結色保留原站）');
    assert.ok(!/font-size:\s*inherit/.test(css), '不得強制後代 font-size: inherit');
  });
});
