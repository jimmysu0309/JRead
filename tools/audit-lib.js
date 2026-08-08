// JRead — harness audit 共用 library（單一資料源）
// -----------------------------------------------------------------------------
// debug-harness.js 與 page-rounds-harness.js 共用的 audit 邏輯。v0.8.39 之前
// 兩支 harness 各自 copy NOISE_AUDIT_KEYWORDS 與 audit 函式，已實際 drift
// （keyword 名單不同步、isVisible 全 repo 11 份 copy）——本檔是修法後的單一
// 資料源。anti-drift forcing function 見 test/regression/harness-audit-lib.spec.js：
// 兩支 harness 不得再自帶 keyword 名單 / isVisible 實作。
//
// 結構約定（重要）：
//   - `pageFns.*` 是 page-world 函式——由 page.evaluate(fn, arg) 序列化後送進
//     瀏覽器執行。**每支函式必須自包含**（不得引用本 module scope 的任何變數
//     或其他函式），所以 isVisible / norm 等 helper 在每支函式內各自 inline
//     一份。這不是疏忽：page.evaluate 只序列化函式本體，閉包引用會在瀏覽器端
//     ReferenceError。自包含性由 regression spec 用 re-eval 驗證。
//   - 對外 API 是 node-side runner（runResidualText(page, ...) 等），call site
//     不直接碰 pageFns。
//   - 訊號層次：各 audit 驗什麼 / 不驗什麼，見各函式頭註解。共通限制：
//     全部跑在 Chromium，綠燈不等於 WebKit（Safari）綠。
// -----------------------------------------------------------------------------

const path = require('path');

// 殘留偵測名單：reader card 內若出現這些字樣 = cleaner rule 漏網（雜訊殘留）。
// 規則：跨站常見的「推薦 / 相關 / 社群 / CTA / 訂閱 / 留言」等非主文字樣。
// 新增字樣請同步維護 cleaner.js 的 NOISE_*_RE regex。
//
// 兩層精度（page rounds verdict 依此分流，2026-06-11 誤報整治）：
//   - STRICT：CTA 專屬措辭，命中即近乎必為雜訊 → page rounds 計 fail 信號。
//   - CONTEXTUAL：常用詞（「最新」「加入」曾命中 36kr / wikipedia 正文，
//     歷史 5 站假陽性），只在可疑 context（短文字、keyword 占比高）下警告，
//     且只計 review 信號（要 Claude 看截圖確認）。「透過」誤報率過高已除名
//     （CTA 場景由「LINE 官方」「官方帳號」等 strict 詞覆蓋）。
//   - 兩層皆含英文詞——舊名單幾乎全中文，英文站 residual audit 形同空轉
//     （chinatalk Subscribe 區塊全靠肉眼，2026-05 報告實證）。拉丁字詞用
//     word-boundary 比對（'share' 不命中 'shareholders'）。
// 名單（合併後）不得有重複項（regression spec 驗）。
const NOISE_KEYWORDS_STRICT = [
  // 中文 CTA 專屬措辭
  '延伸閱讀', '相關文章', '相關新聞', '相關報導', '推薦閱讀', '推薦文章', '推薦新聞',
  '查看原始', '看更多', '看原文', '原始文章',
  // v1.7.57（2026-08-08 page rounds）：原本是裸詞 `其他人`，本意是「其他人也看了」，
  // 但翻譯後的正文裡「其他人」是極普通的詞——quantamagazine「但其他人也同意這一點」、
  // restofworld「和數千名其他人士齊聚」兩站翻譯輪都被誤判成 fail。cleaner.js 那邊
  // 用的是收斂過的 `其他人.{0,3}看`，audit 這條是 drift 出來的裸詞，收斂回 CTA 措辭。
  '其他人也看', '其他人還看', '其他人也在看',
  'LINE 官方', 'LINE官方', '官方帳號', '粉絲專頁',
  'AI 摘要', 'AI摘要', '網友貼文', '建立貼文', '繼續看下去',
  'Google新聞', 'Google 新聞',
  '訂閱電子報', '免費訂閱', '加入會員', '加入好友',
  '聽新聞', '聽書', '想成為', '玩問答', '拿課程', '抽獎', '免費領', '業配',
  // 英文 CTA 專屬措辭
  'subscribe', 'sign up', 'newsletter', 'sponsored', 'advertisement',
  'related articles', 'related stories', 'recommended for you',
  'you may like', 'you might like', 'most read', 'most popular',
  'read more', 'more from', 'read next', 'up next',
  'follow us', 'share this', "don't miss",
  // v0.8.102（Page Rounds 2026-06-18 訊號層補洞）：訂閱/註冊招攬卡高精度措辭。
  // chinatalk「Hundreds of paid subscribers」/ qiita「Register as a new user」
  // 原 residual audit 漏抓（只因 content-img-dropped 連帶進 review）。現 cleaner
  // 已清，這兩條當未來變體的安全網（bare 'subscribe' 已在名單、但這兩句更不會
  // 誤命中正文）。
  'paid subscribers', 'register as a new user',
  // v1.0.10（autocar heycar 文末廣告訊號層補洞）：贊助 / 商業合作推薦 widget 的
  // 品牌掛名措辭。autocar「USED CARS FOR SALE / in partnership with Autotrader」
  // 車輛推薦 carousel 是 client 端晚注入——**本 audit 當初沒抓到不是因為缺這些詞，
  // 而是 headless 時序下該 block 在 toggle 前已注入並被 cleaner 條件 C hide、
  // residual audit 只掃 visible 元素故看不到**（見下方 auditResidualText 的時序層
  // 次說明）。這些詞當「萬一 visible sponsored widget 逃過 cleaner」的安全網，
  // 不誤命中正文（短 direct text 才掃）。
  'in partnership with', 'presented by', 'brought to you by'
];
const NOISE_KEYWORDS_CONTEXTUAL = [
  // 中文常用詞（短文字 / 高占比才警告）
  '更多', '相關', '推薦', '最新', '延伸', '加入', '訂閱', '好友', '貼文', '分享',
  '轉發', '留言', '熱門', '回覆', '廣告', '贊助', '登入', '註冊', '追蹤', '關注',
  // 英文常用詞（<= 5 個字的短句才警告）
  // trending 自 strict 降級（2026-06-11 dev.to 實證：文章主題就是 trends 時
  // 內文 "What's trending now:" 命中 x4 假陽性——主題詞不可當 strict）
  'share', 'follow', 'comments', 'related', 'log in', 'sign in', 'popular', 'recommended',
  'trending',
  // v1.7.60（wikihow page rounds 訊號層補洞）：下載 / 列印 CTA。wikihow
  // 「Download Article」在 reader card 內殘留兩處（標題下 + 方法小標下），
  // **residual audit 完全沒報**——名單裡從來沒有 download 家族，是 Jimmy 看
  // 截圖才發現的（CLAUDE.md 工作流原則 3：該補的不是只修 bug，是補 missing
  // 的那一層 check）。
  // 為什麼放 contextual 不放 strict（與 trending 降級同一個理由）：download /
  // print 對 how-to 站是**主題詞**——wikihow 自己就有「How to Download PDFs on
  // Android」這種標題，strict 無 gate 會把合法 h1/h2 判成 fail。contextual 的
  // 短標籤 gate（拉丁詞 <= 5 個字、CJK <= 12 字或占比 >= 50%）正好做這個區辨：
  // 「Download Article」(2 字) 命中 → review 信號要 Claude 看截圖；
  // 「How to Download PDFs on Android」(6 字) 不命中。
  // 裸 'download' 已覆蓋 download article / pdf / image / the guide 全變體，
  // 不需逐一列舉。'print' 刻意不裸用——python-docs / rust-book 的 `print`
  // 是函式名，短 code span 會每頁誤報；改用多字的 'print this'。
  'download', 'print this', 'save as pdf', '下載', '列印'
];
const NOISE_KEYWORD_TIERS = { strict: NOISE_KEYWORDS_STRICT, contextual: NOISE_KEYWORDS_CONTEXTUAL };
// 合併名單（向後相容：舊 call site / 文件以這個名字引用全名單）
const NOISE_AUDIT_KEYWORDS = [...NOISE_KEYWORDS_STRICT, ...NOISE_KEYWORDS_CONTEXTUAL];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =============================================================================
// page-world 函式（每支自包含，不得引用 module scope——見檔頭註解）
// =============================================================================
const pageFns = {};

// ---- Residual audit（短 direct text 掃描）----
// 驗：reader card 內 visible element 的 direct textNode（<= 60 chars）是否命中
// keyword 名單；不驗：> 60 chars 的長文案雜訊（整段推薦文字會逃過，已知
// tradeoff——keyword 比對對長文誤報率太高）、圖片內文字、iframe 內部。
//
// 訊號層次限制（CLAUDE.md 工作流原則 3，2026-06-26 autocar heycar 廣告實證）：
// 本 audit 是 **visible-only**（isVisible 對祖先 data-jread-hidden=1 回 false），
// 且只驗「toggle + delayed 兩個時間點的 DOM 快照」。因此**驗不到**這兩類：
//   (a) cleaner 已 hide 的雜訊（正確：那就是已清乾淨）——但若該雜訊只在 headless
//       時序下被 hide、real Chrome 時序下沒被 hide，audit 的「乾淨」是 headless
//       DOM 的真值、不代表 real Chrome 乾淨；
//   (b) clean() 跑完之後才 lazy 注入的雜訊，且 headless 的內容載入節奏與 real
//       Chrome 不同——headless 可能在 toggle 前就注入完並被 cleaner 靜態規則 hide，
//       於是 audit 看到的是「已 hide」狀態，永遠抓不到 real Chrome 的 inject-after-
//       clean race（autocar heycar carousel：server 端只空殼、heading/多車 client
//       端注入；headless 注入在 toggle 前、被 sidebar-column 條件 C hide → audit 綠，
//       但 real Chrome 注入在 clean 後 → 殘留可見）。
// 這類「lazy 注入 race」的 forcing function 不在本視覺 harness，而在 jsdom 動態
// observer 重現 spec（如 sponsored-partnership-widget.spec.js 的動態案、
// dynamic-next-article-aside.spec.js）——deterministic 重現 + 斷言 checkDynamicNoise
// 兜底。本 harness 維持「視覺/整合層快照」定位、不嘗試重現非確定性時序。
// 入參 tiers = { strict, contextual }（NOISE_KEYWORD_TIERS）；傳純 array 視為
// 全 strict（向後相容）。命中分兩級 severity：
//   - strict：CTA 專屬措辭直接命中
//   - contextual：常用詞，僅在「短文字（<= 12 字）或 keyword 占比 >= 50%」
//     才算命中（拉丁詞改用「<= 5 個字的短句」判定）
// 命中元素若位於長文段落內（p/li/blockquote 等 ancestor 文字 >= 80 chars），
// 一律降為 contextual——內文裡合法提到「subscribe / 廣告」不該是 fail 信號。
pageFns.auditResidualText = function (tiers) {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article' };
  const strict = Array.isArray(tiers) ? tiers : (tiers.strict || []);
  const contextual = Array.isArray(tiers) ? [] : (tiers.contextual || []);
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function matchKw(text, lowText, kw) {
    if (/[a-z]/i.test(kw)) {
      // 拉丁詞：word-boundary 比對（允許複數 s），'share' 不命中 'shareholders'
      const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[^a-z])' + esc + 's?([^a-z]|$)').test(lowText);
    }
    return text.includes(kw);
  }
  function classify(el, text) {
    const lowText = text.toLowerCase();
    const hits = [];
    let severity = null;
    for (const kw of strict) {
      if (matchKw(text, lowText, kw)) { hits.push(kw); severity = 'strict'; }
    }
    for (const kw of contextual) {
      if (!matchKw(text, lowText, kw)) continue;
      const ok = /[a-z]/i.test(kw)
        ? lowText.split(/\s+/).length <= 5
        : (text.length <= 12 || kw.length / text.length >= 0.5);
      if (ok) { hits.push(kw); if (!severity) severity = 'contextual'; }
    }
    if (severity === 'strict') {
      // 長文段落內的命中降級（內文合法提及，不可計 fail）
      const block = el.parentElement && el.parentElement.closest('p, li, blockquote, figcaption, dd, dt');
      if (block && norm(block.textContent).length >= 80) severity = 'contextual';
    }
    return { hits, severity };
  }
  const items = [];
  // 掃 articleEl 內所有 element，列出「自身直接 textNode 有內容 <= 60 chars」
  // 的 element——這些是 heading / button / span / tag / meta 類短文字，
  // 最容易是非主文雜訊。p 含長段落會被 > 60 門檻過濾掉，不會污染 outline。
  for (const el of art.querySelectorAll('*')) {
    if (!isVisible(el)) continue;
    // SVG <title> / <desc> 是 accessibility 補充文字（tooltip），肉眼不可見，
    // audit 不列。HTML <style> / <script> 同理。
    const tagUpper = el.tagName.toUpperCase();
    if (tagUpper === 'TITLE' || tagUpper === 'DESC' || tagUpper === 'STYLE' ||
        tagUpper === 'SCRIPT' || tagUpper === 'NOSCRIPT') continue;
    // 只看 direct text（不抓子孫的），避免「包了主文的 wrapper」產生假 outline
    const direct = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent).join('');
    const text = norm(direct);
    if (!text || text.length > 60 || text.length < 2) continue;
    const { hits, severity } = classify(el, text);
    items.push({
      tag: el.tagName,
      text: text.slice(0, 60),
      hitKeywords: hits,
      severity,
      elCls: (el.className || '').toString().slice(0, 80),
      parents: hits.length > 0 ? (() => {
        const out = [];
        let p = el.parentElement;
        for (let i = 0; i < 3 && p; i++) {
          const c = ((p.className || '').toString().split(/\s+/).slice(0, 2).join('.')) || '(anon)';
          out.push(`${p.tagName}.${c}`);
          p = p.parentElement;
        }
        return out.join(' > ');
      })() : null
    });
    if (items.length >= 200) break;
  }
  const warnings = items.filter(it => it.severity);
  return {
    total: items.length,
    warnings,
    strictCount: warnings.filter(w => w.severity === 'strict').length,
    items: items.slice(0, 60)
  };
};

// ---- Residual audit（a/button 全量掃描）----
// 驗：reader card 內所有 visible a / button / [role=button]（含空 direct text
// 的 icon button）——用 textContent（整棵子樹）判定，LINE 分享這類
// `<a><svg/><span>分享</span></a>` 才不會漏；class / href 另以 share/social
// 慣用詞與社群網域比對。
// 入參 tiers 同 auditResidualText。長文段落內的 inline 連結（新聞內文常嵌
// 推文 / 社群連結）不做 class / href / contextual 判定——只有 strict keyword
// 才警告（2026-06-11：避免把合法內文連結記成殘留按鈕）。
pageFns.auditResidualLinks = function (tiers) {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article' };
  const strict = Array.isArray(tiers) ? tiers : (tiers.strict || []);
  const contextual = Array.isArray(tiers) ? [] : (tiers.contextual || []);
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function matchKw(text, lowText, kw) {
    if (/[a-z]/i.test(kw)) {
      const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[^a-z])' + esc + 's?([^a-z]|$)').test(lowText);
    }
    return text.includes(kw);
  }
  const items = [];
  for (const btn of art.querySelectorAll('a, button, [role="button"]')) {
    if (!isVisible(btn)) continue;
    const text = norm(btn.textContent).slice(0, 60);
    const lowText = text.toLowerCase();
    const cls = (btn.className || '').toString().slice(0, 60);
    const href = btn.getAttribute ? (btn.getAttribute('href') || '') : '';
    const block = btn.parentElement && btn.parentElement.closest('p, li, blockquote, figcaption, dd, dt');
    const inProse = !!(block && norm(block.textContent).length >= 80);
    const strictHits = strict.filter(kw => matchKw(text, lowText, kw));
    const ctxHits = inProse ? [] : contextual.filter(kw => {
      if (!matchKw(text, lowText, kw)) return false;
      return /[a-z]/i.test(kw)
        ? lowText.split(/\s+/).length <= 5
        : (text.length <= 12 || kw.length / text.length >= 0.5);
    });
    // byline 豁免（2026-06-11 調校）：作者社群連結（cnbc byline 的 @twitter
    // 連結 x3 實證誤報）是合法 metadata。結構判定：連結所在的近層 wrapper
    // 含 <time>（發布日期）或語意 author 標記 = byline 區。
    // 第五輪補：cnbc `A.Author-authorTwitter` 的 wrapper 無 <time> 仍誤報——
    // 「純 @handle 文字 + author/byline 命名容器內」也視為 byline metadata。
    const isHandle = /^@[a-z0-9_.]+$/i.test(text);
    const inByline = !!btn.closest('address, [rel="author"]') || (() => {
      const w = btn.closest('p, div, span, section, header, li');
      return !!(w && w.querySelector && w.querySelector('time'));
    })() || (isHandle && !!btn.closest('[class*="author" i], [class*="byline" i]'));
    const clsOrHrefHit = !inProse && !inByline &&
      (/share|social|subscribe|follow/i.test(cls) || /line\.me|twitter|facebook|x\.com/.test(href));
    items.push({
      tag: btn.tagName,
      text: text || '(no text)',
      cls, href: href.slice(0, 40),
      hitKeywords: [...strictHits, ...ctxHits],
      suspicious: strictHits.length > 0 || ctxHits.length > 0 || clsOrHrefHit
    });
    if (items.length >= 200) break;
  }
  return {
    total: items.length,
    warnings: items.filter(i => i.suspicious),
    items: items.slice(0, 60)
  };
};

// ---- Outside-article audit（翻譯後 body 層殘留）----
// 驗：article 外是否有 visible 短文字（翻譯 extension 在 body 層注入 / 重建
// 元素導致站名等殘留浮現）。v0.7.199 後 body 的非 ancestor 直接子元素應被
// CSS 隱藏，翻譯不該讓任何非主文內容重新可見。
pageFns.auditOutsideArticle = function () {
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  const items = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!isVisible(el)) continue;
    const tagUpper = el.tagName.toUpperCase();
    if (tagUpper === 'TITLE' || tagUpper === 'DESC' || tagUpper === 'STYLE' ||
        tagUpper === 'SCRIPT' || tagUpper === 'NOSCRIPT') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) continue;
    const direct = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent).join('');
    const text = norm(direct);
    if (!text || text.length > 60 || text.length < 2) continue;
    if (!el.closest('[data-jread-active="1"]')) {
      items.push({
        tag: el.tagName,
        text: text.slice(0, 60),
        rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
      });
    }
  }
  const translatedCount = document.querySelectorAll('[data-shinkansen-translated]').length;
  return { outsideArticle: items, translatedCount };
};

// ---- Gap audit（>= 80px 垂直留白）----
// 驗：content anchor（p/h*/figure/img/ul/ol/dl/blockquote/pre/table）按 y 排序
// 後相鄰兩 block 間 gap；>= 80px 警告（未清的 empty wrapper / 廣告 placeholder
// / 塌陷 figure 的型態，techbang 262px 實案）。非 forcing function——h2 前
// 60-80px 是合法 margin。div 故意不收：太通用、會納入 wrapper double-count。
// table / dl 必須收：wikipedia ambox 提示框是 TABLE，selector 漏掉時 H1→IMG
// 被量成 209px 假 gap（其實中間有內容，2026-06-11 實案）。
// 量測 scale 注意：rect 值隨 caller 當下的 body zoom 縮放——debug-harness 在
// zoom 1.0 跑（80px = 真實 80px）；page-rounds 在 zoom 0.5 跑（80/200 門檻
// ≈ 真實 160/400px，歷史校準如此，調門檻前先確認是哪支 harness 的尺度）。
pageFns.auditGap = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article', gaps: [], blockCount: 0 };
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  const blocks = [];
  for (const el of art.querySelectorAll('p, h1, h2, h3, h4, h5, h6, figure, img, ul, ol, dl, blockquote, pre, table')) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) continue;
    blocks.push({ top: r.top, bottom: r.bottom, tag: el.tagName,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
  }
  blocks.sort((a, b) => a.top - b.top);
  // gap 用 running max bottom 算，不是相鄰兩塊相減——較早出現的大容器
  // （wikipedia infobox table 包著 IMG）會往下延伸蓋住區間，相鄰相減會把
  // 「有內容、只是內容屬於前面容器」量成假 gap（2026-06-11 實案）
  //
  // 區間覆蓋檢查（2026-06-11 調校）：block 清單只認標準內容 tag，非標準
  // embed 容器（engadget DIV 卡片、ms.now JW Player 的 div/video absolute
  // 結構）的空間會被量成假 gap。gap 候選確立前掃「visible 且實際覆蓋區間
  // >= 50% 的任意元素」——有就代表空間被內容填著、不是真空白。
  // ink 檢查（2026-08-08 BBC 實案）：「有元素佔著這段空間」≠「這段空間有內容」。
  // BBC /news/articles/clyepyy82kxo 文中 `<div data-component="advertisement-block">`
  // 子層全被 cleaner 藏掉、外層自帶 `min-height: 293px` 仍撐著 → 高度 / 寬度 /
  // 重疊三條件全中、389px 純白被判成「有內容」，gap audit 兩輪都印 `gaps: []`。
  // 覆蓋判定改成要求該元素**自己看得到東西**：可見文字、有尺寸的媒體、或背景圖。
  // 空殼佔位不算填著空間。第二條（帶 direct text 的 leaf 聯集）本來就要求真文字、不受影響。
  function hasInk(el) {
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return true;
    const tagUp = el.tagName.toUpperCase();
    // 元素自身就是媒體（video / iframe / canvas / svg）——本體即 ink
    if (tagUp === 'VIDEO' || tagUp === 'IFRAME' || tagUp === 'CANVAS' || tagUp === 'SVG') return true;
    for (const m of el.querySelectorAll('img, video, iframe, canvas, svg, picture, object, embed')) {
      const mr = m.getBoundingClientRect();
      if (mr.width >= 8 && mr.height >= 8 && isVisible(m)) return true;
    }
    // 背景圖（bg-hero / 裝飾分隔）也算 ink：自身 + 子孫（掃描上限 300 個節點，
    // 避免大容器逐節點 getComputedStyle 拖慢 audit）
    let n = 0;
    for (const d of [el, ...el.querySelectorAll('*')]) {
      if (++n > 300) break;
      let dcs = null;
      try { dcs = window.getComputedStyle(d); } catch (_) { continue; }
      if (dcs && dcs.backgroundImage && dcs.backgroundImage !== 'none') return true;
    }
    return false;
  }
  function intervalCovered(top, bottom) {
    const span = bottom - top;
    if (span <= 0) return true;
    for (const el of art.querySelectorAll('div, video, iframe, section, aside, span, a, canvas, svg')) {
      const r = el.getBoundingClientRect();
      if (r.height < span * 0.5 || r.width < 50) continue;
      const overlap = Math.min(r.bottom, bottom) - Math.max(r.top, top);
      if (overlap < span * 0.5) continue;
      // wrapper 防誤判：元素高度遠大於區間（> 3x）代表它是跨區大容器、
      // 不是「填著這段空間的內容」
      if (r.height > span * 3) continue;
      if (!isVisible(el)) continue;
      if (!hasInk(el)) continue;
      return true;
    }
    // 裸 div 逐行文字聯集覆蓋（2026-06-11 第五輪調校）：巴哈論壇把每行文字
    // 放獨立裸 <div>（26px 小行），單一元素 >= 50% 覆蓋檢查對它們隱形 →
    // 圖與圖之間整段文字被量成假 gap。改對「帶 direct text 的 leaf rect」
    // 做聯集覆蓋，>= 30% 即視為有內容。
    const ranges = [];
    for (const el of art.querySelectorAll('div, span, p, a, li, td')) {
      const direct = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent).join('');
      if (!direct.replace(/\s+/g, ' ').trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8 || r.width < 50) continue;
      const t = Math.max(r.top, top), b = Math.min(r.bottom, bottom);
      if (b <= t) continue;
      if (!isVisible(el)) continue;
      ranges.push([t, b]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    let covered = 0, curT = null, curB = null;
    for (const [t, b] of ranges) {
      if (curB === null) { curT = t; curB = b; }
      else if (t > curB) { covered += curB - curT; curT = t; curB = b; }
      else if (b > curB) { curB = b; }
    }
    if (curB !== null) covered += curB - curT;
    if (covered >= span * 0.3) return true;
    return false;
  }
  const gaps = [];
  let maxBottom = blocks.length ? blocks[0].bottom : 0;
  let maxIdx = 0;
  for (let i = 1; i < blocks.length; i++) {
    const gap = blocks[i].top - maxBottom;
    if (gap >= 80 && !intervalCovered(maxBottom, blocks[i].top)) {
      gaps.push({
        gap: Math.round(gap),
        prev: `${blocks[maxIdx].tag} "${blocks[maxIdx].text}"`,
        next: `${blocks[i].tag} "${blocks[i].text}"`,
        y: Math.round(maxBottom)
      });
    }
    if (blocks[i].bottom > maxBottom) { maxBottom = blocks[i].bottom; maxIdx = i; }
  }
  return { gaps, blockCount: blocks.length };
};

// ---- Contrast audit（WCAG 對比）----
// 驗：reader card 內 visible 文字 vs effective bg（ancestor 爬升 + alpha 合成）
// 的 WCAG 對比，< 3:1（大字 / UI 元件下限）印 ⚠️。「東西在、看不見」類 bug
// （dark scheme 站的色被白卡吃掉）residual / gap audit 都抓不到。
// 不驗：圖片 / iframe 內部（DOM 摸不到）、::before/::after pseudo 文字、
// opacity / filter 造成的視覺淡化。修 styler / theme 類改動後驗收必看本段。
pageFns.auditContrast = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article' };
  function parseColor(s) {
    if (!s) return null;
    let m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) };
    m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/i);
    if (m) return { r: Math.round(+m[1] * 255), g: Math.round(+m[2] * 255), b: Math.round(+m[3] * 255), a: m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) };
    return null;
  }
  function lum(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function blend(fg, bg) {
    const a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function effBg(el) {
    const layers = [];
    let opaque = false;
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const c = parseColor(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) { opaque = true; break; } }
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    let base = opaque ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  }
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  const warnings = [];
  let scanned = 0;
  for (const el of art.querySelectorAll('*')) {
    if (warnings.length >= 20 || scanned >= 1500) break;
    const tag = el.tagName.toUpperCase();
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'TITLE' || tag === 'DESC') continue;
    let direct = '';
    for (const n of el.childNodes) if (n.nodeType === 3) direct += n.textContent;
    direct = direct.replace(/\s+/g, ' ').trim();
    if (direct.length < 4) continue;
    scanned++;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) continue;
    const fg = parseColor(getComputedStyle(el).color);
    if (!fg || fg.a < 0.5) continue;
    const bg = effBg(el);
    const ratio = contrast(fg, bg);
    if (ratio < 3) {
      warnings.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 40),
        text: direct.slice(0, 40),
        color: getComputedStyle(el).color,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        ratio: Math.round(ratio * 100) / 100
      });
    }
  }
  return { scanned, warnings };
};

// ---- Content width audit（內文段落寬 == 版心寬，px 級）----
// 驗「視覺幾何」層：頂層內文 p（非語意縮排容器內）的 content-box 寬若比 card
// 版心窄 > 2px → ⚠️（roomie.tw 中間 wrapper 帶水平 padding 壓窄內文實案；
// styler enforceContentWidth 的 forcing function）。翻頁模式 multicol 下
// clientWidth 含全部欄、量不準——caller 在 --paged 時跳過。
// 與 auditBodyWidthRatio 是同一份事實（內文寬度）的兩種精度：本條抓 px 級
// 微縮（>2px），ratio 版抓比例級縮窄（< 80% cardW）——改其中一條的判定
// 基準時先檢查另一條是否該同步。
pageFns.auditContentWidth = function () {
  const card = document.querySelector('[data-jread-active="1"]');
  if (!card) return { error: 'no card' };
  const ccs = getComputedStyle(card);
  const cardContentW = card.getBoundingClientRect().width
    - parseFloat(ccs.paddingLeft) - parseFloat(ccs.paddingRight)
    - parseFloat(ccs.borderLeftWidth) - parseFloat(ccs.borderRightWidth);
  const INDENT = new Set(['BLOCKQUOTE', 'UL', 'OL', 'DL', 'MENU', 'LI', 'DD', 'DT',
    'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'PRE']);
  const narrow = [];
  let checked = 0;
  for (const p of card.querySelectorAll('p')) {
    if (p.closest('[data-jread-hidden="1"]')) continue;
    if ((p.textContent || '').trim().length < 30) continue;
    const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.float !== 'none' || cs.display.includes('inline')) continue;
    // 在語意縮排容器內 → 縮排刻意，不驗
    let a = p.parentElement, skip = false;
    while (a && a !== card) { if (INDENT.has(a.tagName)) { skip = true; break; } a = a.parentElement; }
    if (skip) continue;
    const pw = p.getBoundingClientRect().width
      - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    checked++;
    if (cardContentW - pw > 2) {
      narrow.push({ text: (p.textContent || '').trim().slice(0, 16), pw: +pw.toFixed(1) });
    }
  }
  return { cardContentW: +cardContentW.toFixed(1), checked, narrow };
};

// ---- Body width audit（內文寬度比例，ratio 級）----
// 補 auditNarrowText（chars/line < 10 極端窄欄）抓不到的中度縮窄（每行字數
// 還正常但只佔 cardW 60-70%）。twreporter.org sidebar-style 雙欄 layout 實案
// （修法前 32/32 個 p 都是 480px = 67% cardW）。與 auditContentWidth 的
// 關係見該函式頭註解。
pageFns.auditBodyWidthRatio = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article', narrow: false };
  const cardRect = art.getBoundingClientRect();
  if (cardRect.width < 10) return { narrow: false, reason: 'card width invalid' };
  const ps = Array.from(art.querySelectorAll('p')).filter(p => {
    const text = (p.textContent || '').trim();
    if (text.length < 60) return false;
    const cs = window.getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (p.closest('[data-jread-hidden="1"]')) return false;
    // 排除 figcaption 內 p（有自己的 figcaption audit）
    if (p.closest('figcaption')) return false;
    // 排除 blockquote / aside / footer 內 p（這些有自己的窄寬語意）
    if (p.closest('blockquote, aside, footer')) return false;
    return true;
  });
  if (ps.length < 3) return { narrow: false, reason: 'too few main paragraphs (< 3)', totalP: ps.length };

  const NARROW_RATIO_THRESHOLD = 0.8;  // p width 必須 >= 80% cardW
  const samples = [];
  let narrowCount = 0;
  for (const p of ps) {
    const r = p.getBoundingClientRect();
    const ratio = r.width / cardRect.width;
    if (ratio < NARROW_RATIO_THRESHOLD) {
      narrowCount++;
      if (samples.length < 5) {
        samples.push({
          pWidth: Math.round(r.width),
          ratio: Math.round(ratio * 100),
          text: (p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)
        });
      }
    }
  }
  const narrowFraction = narrowCount / ps.length;
  return {
    narrow: narrowFraction > 0.5,
    cardWidth: Math.round(cardRect.width),
    totalP: ps.length,
    narrowCount,
    narrowFraction: Math.round(narrowFraction * 100),
    samples
  };
};

// ---- Overflow audit（水平溢出）----
// 驗：reader card 內元素 rect 是否超出 card 右緣 > 2px、整頁是否出現水平
// scrollbar。<source> 等非渲染 tag 排除（原站 CSS 可能把 display 改成非
// none 造成 rect 非零的 false positive，cna.com.tw 實測）。
//
// 2026-06-17 scroll-clip 豁免：code block / 寬表格慣例用 overflow-x:auto|scroll
// 內捲——超出內容被祖先的捲軸吸收、使用者捲得到、視覺無破版（rust-book /
// kubernetes 的 hljs code span、k8s YAML 實證：每個超出元素都在 card 內的
// <pre>/<code> overflow-x:auto 裡，docScrollWidth==docClientWidth 整頁無 H-scroll）。
// getBoundingClientRect 回報的是 layout 位置、不管 scroll 裁切，所以這類超出
// 元素會被天真版誤報。豁免條件嚴格限「auto|scroll」（使用者捲得到）且祖先
// 自身在 card 內——「hidden|clip」或被 card 本身裁切的情況不豁免（內容被切掉、
// 看不到也捲不到 = 真破版，arxiv 寬公式被 card overflow:hidden 切掉仍須報）。
pageFns.auditOverflow = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article', overflow: false, items: [] };
  const cardRect = art.getBoundingClientRect();
  const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
  const NON_RENDERING_TAGS = new Set(['SOURCE', 'TRACK', 'META', 'LINK', 'STYLE', 'SCRIPT', 'HEAD', 'TITLE', 'TEMPLATE', 'PARAM']);
  // 超出元素是否被一個「可捲到（auto|scroll）且自身在 card 內」的祖先裁切。
  // 從 el 父節點往上走到 card 外為止（含 card 本身）。
  function absorbedByScrollAncestor(el) {
    let cur = el.parentElement;
    while (cur && cur !== art.parentElement) {
      const ox = window.getComputedStyle(cur).overflowX;
      if (ox === 'auto' || ox === 'scroll') {
        if (cur.getBoundingClientRect().right <= cardRect.right + 2) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }
  const items = [];
  for (const el of art.querySelectorAll('*')) {
    if (NON_RENDERING_TAGS.has(el.tagName)) continue;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right > cardRect.right + 2) {
      if (absorbedByScrollAncestor(el)) continue;
      items.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 80),
        width: Math.round(r.width),
        cardWidth: Math.round(cardRect.width),
        overflowPx: Math.round(r.right - cardRect.right),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      });
    }
  }
  const unique = [];
  const seen = new Set();
  for (const it of items) {
    const key = `${it.tag}.${it.cls.split(' ')[0]}`;
    if (!seen.has(key)) { seen.add(key); unique.push(it); }
    if (unique.length >= 10) break;
  }
  return { overflow: docOverflow || unique.length > 0, docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth, cardWidth: Math.round(cardRect.width), items: unique };
};

// ---- Text-image overlap audit（圖疊文，2026-06-25 autocar 作者欄補洞）----
// 動機：reader mode 應是乾淨線性流，content 文字不該疊在圖片上。autocar 作者
// bio 區用 float 圓形頭像裁切容器（DIV.personality.clearfix），reader 攤平
// float 後 608px 頭像溢出 142px 裁切容器、bio 文字落到圖片上 100% 重疊（圖疊
// 文）——既有 overflow / gap / contrast / narrow audit 全測不到這層（文字 rect
// 在 card 內、無水平溢出、對比夠、寬度正常），只有「文字 rect 與 img rect 的
// 幾何重疊面積」能抓。Jimmy 2026-06-25 截圖揭穿（harness 判 review、實際嚴重
// 破版）。
//
// 訊號層次（明確標注，見 CLAUDE.md 工作流原則 3）：本 audit 驗「可見 block
// 文字元素 rect vs 可見大圖 rect 的幾何重疊比例」一層；不驗 z-order（文字疊上
// ＝讀起來髒、疊下＝直接看不見，兩者都是 bug，純幾何即可）、不驗祖孫包含
// （inline emoji / icon 在文字元素內＝合法，排除）、不驗 figcaption overlay
// （部分 hero 設計刻意把圖說疊在圖上，故文字選擇器不含 figcaption）。
// 高精度：reader mode 已清過 overlay，content 段落疊大圖近乎必為真破版。
pageFns.auditTextImageOverlap = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article', overlap: false, items: [] };
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  function rectOf(el) { return el.getBoundingClientRect(); }
  function overlapArea(a, b) {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x * y;
  }
  // 可見大圖（雙維 >= 80px，排除 icon / inline 小圖）
  const imgs = [];
  for (const img of art.querySelectorAll('img, picture, video')) {
    if (!isVisible(img)) continue;
    const r = rectOf(img);
    if (r.width < 80 || r.height < 80) continue;
    imgs.push({ el: img, r });
  }
  if (!imgs.length) return { overlap: false, overlapCount: 0, items: [] };
  const OVERLAP_FRAC = 0.5; // 文字 rect 過半面積落在圖片矩形內 = 圖疊文
  const items = [];
  for (const t of art.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote')) {
    if (items.length >= 8) break;
    if (!isVisible(t)) continue;
    // 只看自身有直接文字的元素（避免 wrapper 重複計數）
    const direct = Array.from(t.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
    if (direct.length < 4) continue;
    const tr = rectOf(t);
    if (tr.width < 10 || tr.height < 8) continue;
    const tArea = tr.width * tr.height;
    if (tArea <= 0) continue;
    for (const im of imgs) {
      // 排除祖孫包含（圖在文字元素內＝inline 合法；文字在圖容器內＝保險）
      if (t.contains(im.el) || im.el.contains(t)) continue;
      const frac = overlapArea(tr, im.r) / tArea;
      if (frac >= OVERLAP_FRAC) {
        items.push({
          text: direct.slice(0, 40),
          textEl: t.tagName + (t.className ? '.' + t.className.toString().split(' ').filter(Boolean)[0] : ''),
          img: im.el.tagName + (im.el.className ? '.' + im.el.className.toString().split(' ').filter(Boolean)[0] : ''),
          imgSize: Math.round(im.r.width) + 'x' + Math.round(im.r.height),
          frac: Math.round(frac * 100) / 100
        });
        break; // 一個文字元素命中一張圖即足夠
      }
    }
  }
  return { overlap: items.length > 0, overlapCount: items.length, items };
};

// ---- Narrow text audit（極端窄欄）----
// 用「平均每行字元數」偵測：正常段落每行 40+ 字元（英文）或 15+ 字元（中文）。
// 每行 < 10 字元 = 文字被壓成窄條。不受 zoom、box model、float 影響。
pageFns.auditNarrowText = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article', narrow: false, items: [] };
  const cardRect = art.getBoundingClientRect();
  const ps = Array.from(art.querySelectorAll('p')).filter(p => {
    const text = (p.textContent || '').trim();
    if (text.length < 60) return false;
    const cs = window.getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (p.closest('[data-jread-hidden="1"]')) return false;
    return true;
  });
  const items = [];
  for (const p of ps) {
    const r = p.getBoundingClientRect();
    if (r.height < 10) continue;
    const cs = window.getComputedStyle(p);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20;
    const lines = Math.max(1, Math.round(r.height / lh));
    const chars = (p.textContent || '').trim().length;
    const charsPerLine = chars / lines;
    if (charsPerLine < 10) {
      items.push({
        charsPerLine: Math.round(charsPerLine * 10) / 10,
        lines, chars,
        boxWidth: Math.round(r.width),
        text: (p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      });
    }
    if (items.length >= 5) break;
  }
  return { narrow: items.length > 0, cardWidth: Math.round(cardRect.width),
    narrowCount: items.length, totalP: ps.length, items };
};

// ---- Figcaption width audit（圖說過窄）----
// 偵測 figcaption 被原站 CSS 限制成遠比 figure/img 窄：可見寬 < 參考寬 50%。
pageFns.auditFigcaption = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article', cramped: false, items: [] };
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  const items = [];
  for (const fc of art.querySelectorAll('figcaption')) {
    if (!isVisible(fc)) continue;
    const fcRect = fc.getBoundingClientRect();
    if (fcRect.width < 1 || fcRect.height < 1) continue;
    const figure = fc.closest('figure');
    if (!figure) continue;
    const figRect = figure.getBoundingClientRect();
    if (figRect.width < 10) continue;
    const img = figure.querySelector('img');
    const imgRect = img ? img.getBoundingClientRect() : null;
    const refWidth = imgRect && imgRect.width > 10 ? imgRect.width : figRect.width;
    const ratio = Math.round(fcRect.width / refWidth * 100);
    if (ratio < 50) {
      items.push({
        fcWidth: Math.round(fcRect.width),
        refWidth: Math.round(refWidth),
        figWidth: Math.round(figRect.width),
        ratio,
        text: (fc.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      });
    }
    if (items.length >= 5) break;
  }
  return { cramped: items.length > 0, crampedCount: items.length, items };
};

// ---- Tail audit（文末元素 dump）----
// dump reader card 內按 y 排序後最後 20% 的 visible 元素——「內文以下殘留」
// 雜訊（延伸閱讀 / 訂閱 CTA）慣性聚集在文末，這段 outline 給 Claude 肉眼巡。
pageFns.auditTail = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article', items: [] };
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  const sel = 'p, h1, h2, h3, h4, h5, h6, figure, img, ul, ol, blockquote, pre, form, input, button, a, div, span, section, aside, nav, footer';
  const all = [];
  for (const el of art.querySelectorAll(sel)) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 5) continue;
    const direct = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
    if (!direct && !['IMG', 'FORM', 'INPUT', 'BUTTON', 'FIGURE'].includes(el.tagName)) continue;
    all.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 80), text: direct.slice(0, 60), top: Math.round(r.top) });
  }
  all.sort((a, b) => a.top - b.top);
  const cutoff = Math.floor(all.length * 0.8);
  return { total: all.length, items: all.slice(cutoff) };
};

// ---- Content stats（輔助信號）----
pageFns.auditContentStats = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return null;
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  const visibleEls = (sel) => [...art.querySelectorAll(sel)].filter(isVisible);
  const h1s = visibleEls('h1, h2');
  const imgs = visibleEls('img').filter(el => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 100; });
  const ps = visibleEls('p');
  const totalText = ps.reduce((sum, p) => sum + (p.textContent || '').trim().length, 0);
  const links = visibleEls('a[href]');
  const blockquotes = visibleEls('blockquote');
  const videos = visibleEls('video, iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="vimeo"]');
  let visibleTextLength = 0;
  const walker = document.createTreeWalker(art, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (isVisible(node.parentElement)) visibleTextLength += (node.textContent || '').trim().length;
  }
  return { h1Count: h1s.length, imgCount: imgs.length, pTextLength: totalText, visibleTextLength,
    linkCount: links.length, blockquoteCount: blockquotes.length, videoCount: videos.length };
};

// ---- 原頁文字量（toggle 前呼叫，B3 內文消失的基準）----
// 驗：原頁 visible <p> 文字總量。進 reader 後與 contentStats.pTextLength 比，
// retention ratio 過低 = detector 可能選錯容器 / cleaner 誤殺主文（B3，
// thenewslens pTextLength 偏低實案——舊 harness 對 B3 完全沒有 audit 信號，
// 只能靠 Claude 事後起疑）。不驗：主文不放 <p> 的站（論壇 div 排版）——
// 原頁 p 文字 < 800 chars 時 caller 跳過判定。留言 / 推薦段落也是 p，被
// cleaner 合法清掉會拉低 ratio，所以這條只能當 review 信號、不可 fail。
pageFns.collectOriginalTextStats = function () {
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  let pTextLength = 0;
  let pCount = 0;
  for (const p of document.querySelectorAll('p')) {
    if (!isVisible(p)) continue;
    const len = (p.textContent || '').trim().length;
    if (len < 20) continue;
    pTextLength += len;
    pCount++;
    if (pCount >= 800) break;
  }
  return { pTextLength, pCount };
};

// ---- Hero image：原頁擷取（toggle 前呼叫）----
// 雙重過濾：渲染 size + natural size 都要夠大（100x100 avatar 被 CSS 撐大
// 誤判 hero，newtalk 實測）；長寬比 >= 4:1 排除（裝飾性版頭 banner，cnbc
// 1497x160 實測——純閱讀本來就該清，不該當 hero 誤判 missing）。
pageFns.captureOriginalHeroImages = function () {
  const MAX_ASPECT = 4; // 寬/高 或 高/寬 超過此值視為裝飾性細長條，非 hero
  // promo / popup 圖排除（2026-06-11 twreporter 實證：會員推廣 popup 的圖
  // 被當 hero 候選，reader 正確清掉後誤報 missing）。src pattern 是 audit
  // 端 heuristic（非 extension 規則，誤放代價只是少一個 hero 候選）。
  const PROMO_SRC_RE = /promo|popup|membership|advert|banner|campaign/i;
  // CTA / widget 容器內的圖排除（2026-06-14 myartbroker 實證：頁面級「Buy/Sell
  // Hockney prints」促銷 widget `WidgetCta_base` 內含 3800x2800 藝術圖，src 是
  // CDN hash（無 promo/popup 關鍵字）躲過 PROMO_SRC_RE，reader 正確清掉 CTA 後
  // 被誤報 hero-missing）。promo 圖常見載體是 class 帶 cta/widget/promo/popup
  // 的容器——祖先 class 比 src 關鍵字更穩。同 src-pattern 一樣是 audit 端
  // heuristic（非 extension 規則，誤放代價只是少一個 hero 候選）。
  const CTA_WIDGET_SEL = '[class*="cta" i],[class*="widget" i],[class*="promo" i],[class*="popup" i],[class*="advert" i],[class*="banner" i]';
  const inCtaWidget = (img) => { try { return !!img.closest(CTA_WIDGET_SEL); } catch (e) { return false; } };
  // src 截 300（原 120）：dev.to 類 image proxy 把尺寸參數放 pathname、原圖
  // URL encode 在尾段，120 截斷讓變體比對的尾段全失效。
  return Array.from(document.querySelectorAll('img')).map(img => {
    const r = img.getBoundingClientRect();
    return { src: img.src ? img.src.slice(0, 300) : '', w: r.width, h: r.height,
      naturalW: img.naturalWidth, naturalH: img.naturalHeight, top: r.top,
      inCtaWidget: inCtaWidget(img) };
  }).filter(i => i.w >= 300 && i.h >= 150
    && i.naturalW >= 300 && i.naturalH >= 150
    && i.naturalW / i.naturalH < MAX_ASPECT
    && i.naturalH / i.naturalW < MAX_ASPECT
    && i.top < 800
    && !PROMO_SRC_RE.test(i.src)
    && !i.inCtaWidget)
    .sort((a, b) => a.top - b.top)
    .slice(0, 3);
};

// ---- Hero image：reader 內存活清單（與原頁清單比對在 node 側做）----
pageFns.collectReaderImages = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return [];
  // 兩類都收（2026-06-11 調校）：
  //   loaded — 已渲染的圖（natural + rect 過門檻），原行為
  //   present — 元素在 DOM、未被 jread hide、但尚未載入 / 渲染（lazy 時序）。
  //     hero audit 的目的是抓「cleaner 誤殺」（元素被 hide / 移除）；dev.to
  //     cover 在 harness 的 original 捲動 + zoom 序列下 lazyload 永不觸發，
  //     但元素完好、Jimmy 實機（cage 2026-06-11）confirmed 正常渲染——
  //     渲染狀態是時序問題，不可計 missing。
  return Array.from(art.querySelectorAll('img')).map(img => {
    const r = img.getBoundingClientRect();
    return { src: img.src ? img.src.slice(0, 300) : '', w: r.width, h: r.height,
      naturalW: img.naturalWidth, naturalH: img.naturalHeight,
      hidden: !!(img.closest('[data-jread-hidden="1"]')) };
  }).filter(i => !i.hidden && i.src)
    .map(i => ({ ...i,
      loaded: i.naturalW >= 200 && i.naturalH >= 100 && i.w >= 100 && i.h >= 50 }));
};

// ---- 內文掉圖 audit（高精度窄版，2026-06-14 myartbroker 修法後補洞）----
// 動機：hero audit 只驗頁面頂端 top<800 的前 3 張 hero，文章深處的內容圖被
// cleaner 誤殺抓不到（myartbroker「Christopher Isherwood and Don Bachardy」那
// 幅畫 y≈6800 被 hide，hero audit silent）。本 audit 補「文章內單張內容圖被
// 誤殺」這一層。
//
// 為何窄：實測通用「原頁 vs reader 大圖 diff」先天低精度——相關文章縮圖與
// 內容圖結構幾乎相同（同樣 img 包 <a>、標題在 <a> 外），myartbroker 天真版報
// 5 張其中 4 張是 RelatedArticles 卡片 FP。高精度靠「排除 widget / 推薦 / 卡片
// / 輪播 / 列表 / chrome 容器」把 FP 壓到 0（myartbroker 實測修好版 0 dropped、
// 破壞修法版正中 Isherwood 1 張）。
//
// 驗的訊號層：「原頁的單張內容圖（非 widget 容器內），toggle 後落在 reader
// article 內卻被標 data-jread-hidden / display:none」= cleaner 誤殺。
// 不驗：① widget / 推薦 / 卡片 / 輪播容器內的圖（reader 本來就該清，排除）；
// ② article 外被清的圖（正確行為，不算掉圖）；③ < 300×150 且無 srcset 的小圖
// （icon / avatar / spacer，非內容圖）；④ 圖「呈現是否正確」（尺寸 / 對齊 /
// lazy 載入時序）——那是 hero / gap / styler 層的事。
//
// 節點識別：reader 就地套用（NS.state.articleEl = 原 article 元素、非 clone），
// 原 img 節點留存 → 用 data-pr-cfig 標記回找同一節點（src 會因 srcset 變、節點
// identity 穩定）。data-pr-* 命名避開 cleaner 的 data-jread-* 處理。
// module 層級 const（非 pageFns——pageFns 命名空間只放 browser 端 evaluate
// 的函式，放陣列會踩「每支 pageFns 須 toString round-trip 成函式」的合約）。
// node runner 透過 page.evaluate 第二參數送進瀏覽器。
const CFIG_NOISE_TOKENS = ['related', 'recommend', 'swiper', 'slider', 'carousel',
  'card', 'preview', 'popular', 'trending', 'readnext', 'upnext', 'up-next',
  'widget', 'promo', 'popup', 'sidebar', 'share', 'social', 'author', 'byline',
  'comment', 'sponsor', 'advert', 'banner', 'cta', 'thumb', 'header', 'footer'];

// toggle 前呼叫：標記內容圖候選，回標記數。
pageFns.tagOriginalContentFigures = function (noiseTokens) {
  const MAX_ASPECT = 4;
  const SPACER_RE = /^data:|spacer|placeholder|blank\.|1x1\./i;
  const NOISE_SEL = noiseTokens.map(t => `[class*="${t}" i]`).join(',') +
    ',nav,aside,footer,header,li';
  let n = 0;
  for (const img of document.querySelectorAll('img')) {
    if (img.hasAttribute('data-pr-cfig')) continue;
    const src = img.src || '';
    if (SPACER_RE.test(src)) continue;
    // 內容尺寸訊號：已載入大圖 OR 有 srcset（lazy 內容圖，toggle 前常 0×0）
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const loadedBig = nw >= 300 && nh >= 150 && nw / nh < MAX_ASPECT && nh / nw < MAX_ASPECT;
    const hasSrcset = !!(img.getAttribute('srcset') || img.getAttribute('data-srcset'));
    if (!loadedBig && !hasSrcset) continue;
    // widget / 推薦 / 卡片 / 列表 / chrome 容器內 → 非內容圖
    try { if (img.closest(NOISE_SEL)) continue; } catch (e) {}
    img.setAttribute('data-pr-cfig', String(n));
    n++;
  }
  return n;
};

// toggle 後呼叫：分類每張 tagged 內容圖，回 dropped 清單。
pageFns.collectDroppedContentFigures = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  const res = { tagged: 0, insideVisible: 0, outside: 0, dropped: [] };
  for (const img of document.querySelectorAll('img[data-pr-cfig]')) {
    res.tagged++;
    const inside = art ? art.contains(img) : false;
    let hidden = false;
    try {
      hidden = !!(img.closest('[data-jread-hidden="1"]')) ||
        getComputedStyle(img).display === 'none';
    } catch (e) {}
    if (!inside) { res.outside++; continue; }
    if (hidden) res.dropped.push({
      id: img.getAttribute('data-pr-cfig'),
      alt: (img.alt || '').slice(0, 80),
      src: img.src ? img.src.slice(0, 120) : ''
    });
    else res.insideVisible++;
  }
  return res;
};

// ---- 誤殺長段落 audit（2026-06-23（v0.8.168 漏抓後補 harness），Miniflux 開頭段落消失修法後補洞）-----------
// 動機：retention ratio 是全域純量、位置盲——掉文末 RSS footer（正常）與掉文章
// 開頭標題+前三段（災難）同樣只是把 ratio 拉低，且留言/推薦也是 <p> 被合法清掉
// 會降 ratio，所以 retention 只能當 < 0.3 的粗 review 信號。v0.8.168 Miniflux
// Ineos 案：cleaner pre-title 規則誤殺開頭 502 chars 正文，retention 仍 76% 印綠燈
// 漏抓（Jimmy 2026-06-23 截圖打臉）。
//
// 本 audit 補「cleaner 誤殺 article 內長散文」這一層，高精度位置無關：
//   toggle 前標記「可見的 leaf 長散文塊」（own text >= 100 chars、無 >= 100 子塊、
//   非 chrome/comment/related 容器內）；toggle 後若該塊落在 reader article 內卻
//   被 data-jread-hidden / display:none = cleaner 誤殺主文。
// 門檻 100 與 cleaner 的 wrapperContainsMainContentP「單一 p >= 100」同源——
// cleaner 的職責是清雜訊不是清長散文，藏掉一塊 >= 100 字散文幾乎必是 bug。
//
// 為何低 FP：① 只標 toggle 前「可見」塊 → 站點響應式重複版（mobile/desktop 各一、
// 隱藏那份 display:none）天生被濾掉；② 排除 chrome/comment/related/sidebar 容器
// → 留言/推薦長段（合法清除）不誤報；③ leaf 限定（無 >= 100 子塊）→ 不數整個
// article wrapper、只數實際段落。
// 驗的訊號層：「cleaner 沒誤殺 article 內長散文」。不驗：styler 排版、視覺對齊。
pageFns.tagOriginalLongProse = function (noiseTokens) {
  function isVisible(el) {
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
      const cs = window.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return true;
  }
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const NOISE_SEL = noiseTokens.map(t => `[class*="${t}" i]`).join(',') +
    ',nav,aside,footer,header';
  let n = 0;
  for (const el of document.querySelectorAll('p, li, blockquote')) {
    if (el.hasAttribute('data-pr-prose')) continue;
    const t = norm(el.textContent);
    if (t.length < 100) continue;
    // leaf 限定：任一子元素自己就 >= 100 chars → 這是 wrapper、不是段落本身
    let hasLongChild = false;
    for (const c of el.children) {
      if (norm(c.textContent).length >= 100) { hasLongChild = true; break; }
    }
    if (hasLongChild) continue;
    if (!isVisible(el)) continue;
    try { if (el.closest(NOISE_SEL)) continue; } catch (e) {}
    el.setAttribute('data-pr-prose', String(n));
    n++;
  }
  return n;
};

// toggle 後呼叫：分類每塊 tagged 長散文，回 dropped 清單（reader article 內被 hide）。
pageFns.collectDroppedProse = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const res = { tagged: 0, insideVisible: 0, outside: 0, dropped: [] };
  for (const el of document.querySelectorAll('[data-pr-prose]')) {
    res.tagged++;
    const inside = art ? art.contains(el) : false;
    let hidden = false;
    try {
      hidden = !!(el.closest('[data-jread-hidden="1"]')) ||
        getComputedStyle(el).display === 'none';
    } catch (e) {}
    if (!inside) { res.outside++; continue; }
    if (hidden) res.dropped.push({
      id: el.getAttribute('data-pr-prose'),
      tag: el.tagName.toLowerCase(),
      text: norm(el.textContent).slice(0, 60)
    });
    else res.insideVisible++;
  }
  return res;
};

// ---- Byline（作者 + 日期）進 reader card audit（v1.5.1，Medium byline 消失修法後補洞）----
// 動機：v1.5 Medium 案文章頭部作者 + 日期被兩條 cleaner 規則（author-bio-card /
//   button-cluster）各自誤殺，Page Rounds 卻全綠漏抓——既有 audit 只覆蓋標題
//   （auditTitlePresence）與長散文（droppedProse，>= 80 chars），byline 是短文字、
//   兩層都不驗。命中 CLAUDE.md 工作流原則 3「綠燈 ≠ 品質沒問題，補 missing 那層 check」。
//
// 兩相位（比照 droppedProse 的 tag→toggle→collect）：
//   tagOriginalByline（toggle 前）：用 JSON-LD / meta 的作者名 + 發表日期當 ground
//     truth，在「首個長段落之前」的 masthead 區，找文字緊貼作者名 / 日期的最深 carrier
//     元素標記之。限定 masthead 是為了排掉文末作者 bio 卡——它在 body 之後、本就該被
//     清，不該誤判成 byline 掉失（負控制）。短文章無長段落基準 → 不標記、跳過（保守）。
//   collectDroppedByline（toggle 後）：某維度的 carrier 全部被 hide（data-jread-hidden
//     祖先 / 無 client rect / visibility hidden）→ 該維度判定掉失。
// review-tier（strict 字串存在性、meta 與頁面顯示用字可能差異）：由 Claude 看截圖確認。
//
// 為什麼用 ground truth + 最深 carrier 而非「名字有出現在可見文字」：作者名可能也
// 出現在內文句子裡（false negative）；鎖定 masthead 那顆 carrier 元素是否存活才精準。
pageFns.tagOriginalByline = function () {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  // 發表日期 → 頁面可能顯示的多種字面（meta 是 ISO、畫面常是 "Jun 3, 2026"）
  function dateForms(iso) {
    const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return [];
    const y = m[1], mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return [];
    const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return [
      MON[mo] + ' ' + d + ', ' + y,
      FULL[mo] + ' ' + d + ', ' + y,
      d + ' ' + MON[mo] + ' ' + y,
      d + ' ' + FULL[mo] + ' ' + y,
      y + '-' + m[2] + '-' + m[3],
      y + '年' + mo + '月' + d + '日'
    ];
  }
  // --- 1. ground truth：作者名 + 發表日期字面（來源在 <head>，toggle 後仍在）---
  let author = '';
  let forms = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data; try { data = JSON.parse(s.textContent); } catch (e) { continue; }
    const arr = Array.isArray(data) ? data : (data && data['@graph'] ? data['@graph'] : [data]);
    for (const node of arr) {
      if (!node || typeof node !== 'object') continue;
      if (!author && node.author) {
        const a = Array.isArray(node.author) ? node.author[0] : node.author;
        const name = a && (typeof a === 'string' ? a : a.name);
        if (name && typeof name === 'string') author = norm(name);
      }
      if (!forms.length && (node.datePublished || node.dateCreated)) {
        forms = dateForms(node.datePublished || node.dateCreated);
      }
    }
  }
  if (!author) {
    const m = document.querySelector('meta[name="author"], meta[property="article:author"]');
    if (m && m.content && !/^https?:/i.test(m.content)) author = norm(m.content);
  }
  if (!forms.length) {
    const m = document.querySelector('meta[property="article:published_time"], meta[itemprop="datePublished"]');
    if (m && m.content) forms = dateForms(m.content);
  }
  if (author && (author.length < 2 || author.length > 60 || /https?:|\/@/.test(author))) author = '';
  // --- 2. masthead 邊界：首個 >= 200 chars 的段落（lead paragraph）---
  let bodyStartEl = null;
  for (const el of document.querySelectorAll('p, li, blockquote')) {
    if (norm(el.textContent).length >= 200) { bodyStartEl = el; break; }
  }
  if (!bodyStartEl) return { tagged: 0, reason: 'no-body-anchor' };
  const isBeforeBody = el => el !== bodyStartEl && !el.contains(bodyStartEl) &&
    !!(el.compareDocumentPosition(bodyStartEl) & Node.DOCUMENT_POSITION_FOLLOWING);
  const tightlyContains = (el, needle) => {
    const t = norm(el.textContent);
    return t.includes(needle) && t.length <= needle.length + 40;
  };
  const SEL = 'a,span,p,h1,h2,h3,h4,h5,h6,div,header,address,time,em,strong,small,li,figcaption,b';
  // --- 3. 標記最深 carrier（任一後代也 tight → 讓後代來標）---
  function tagCarriers(needles, kind) {
    let count = 0;
    for (const el of document.querySelectorAll(SEL)) {
      if (!isBeforeBody(el)) continue;
      const hit = needles.find(n => n && tightlyContains(el, n));
      if (!hit) continue;
      let deeper = false;
      for (const c of el.querySelectorAll(SEL)) {
        if (tightlyContains(c, hit)) { deeper = true; break; }
      }
      if (deeper) continue;
      el.setAttribute('data-pr-byline', kind);
      count++;
    }
    return count;
  }
  let tagged = 0;
  if (author) tagged += tagCarriers([author], 'author');
  if (forms.length) tagged += tagCarriers(forms, 'date');
  return { tagged, author: author || null, dateExpected: forms.length > 0 };
};

// toggle 後呼叫：tagged byline carrier 哪些被 hide。某維度 carrier 全 hide → 該維度掉失。
pageFns.collectDroppedByline = function () {
  const res = { checked: false, author: { tagged: 0, dropped: 0 },
    date: { tagged: 0, dropped: 0 }, missing: false, authorDropped: false, dateDropped: false };
  const tagged = document.querySelectorAll('[data-pr-byline]');
  if (!tagged.length) return res;
  res.checked = true;
  for (const el of tagged) {
    const bucket = el.getAttribute('data-pr-byline') === 'date' ? res.date : res.author;
    bucket.tagged++;
    let hidden = false;
    try {
      if (el.closest('[data-jread-hidden="1"]')) hidden = true;
      else if (!el.getClientRects().length) hidden = true;
      else if (getComputedStyle(el).visibility === 'hidden') hidden = true;
    } catch (e) { hidden = true; }
    if (hidden) bucket.dropped++;
  }
  res.authorDropped = res.author.tagged > 0 && res.author.dropped === res.author.tagged;
  res.dateDropped = res.date.tagged > 0 && res.date.dropped === res.date.tagged;
  res.missing = res.authorDropped || res.dateDropped;
  return res;
};

// ---- 標題進 reader card audit（2026-06-23（v0.8.168 漏抓後補 harness），Miniflux 標題消失修法後補洞）---------
// 動機：v0.8.168 Ineos 案標題（feed 容器外的 .entry-title）整個沒進 reader card，
// harness 無任何信號。本 audit 驗「article 標題文字有出現在 reader 可見內容」。
//   baseTitle = og:title 或 stripSiteSuffix(document.title)；在 reader article 的
//   可見文字（排除 data-jread-hidden 子樹）裡找不到 → missing。
// review-tier（低 stakes、strict 字串存在性）：少數站 reader 刻意不重複標題、或
// og/doc title 與頁面標題用字不同 → 由 Claude 看截圖確認。為壓 FP，og 與 doc 兩個
// 候選任一命中即算 found。
// toggle（與翻譯）**之前**標記標題載體：用 og:title / document.title 去尾綴後的
// 字串找出承載它的 heading，掛 `data-jread-audit-title`。
// 動機（2026-08-07 非中文站雙輪驗收）：auditTitlePresence 是純字串比對，翻譯輪
// 的 DOM 文字已變中文、meta 仍是英文 → 每個翻譯輪都固定誤報 title-missing。
// 元素身份（標記）不隨翻譯改變，是翻譯無關的判定基礎；標記在 toggle 前打，
// JRead 若把標題 clone 進 card，clone 也會帶著這個 attr（cloneNode(true)）。
// v1.7.57（2026-08-08 page rounds）：比對前多做兩步正規化，否則真標題標不到、
// 反而標到站台 chrome 裡的重複標題：
//   1. 全形 ASCII 標點折半形——newtalk 實測 og:title 是半形 `!`、渲染 h1 是全形
//      `！`，squash 空白後兩邊仍互不 includes → 真標題 miss；同頁 <header> 內的
//      站台導覽 h1 文字與 og:title 逐字相同反而命中，被標成唯一載體，reader mode
//      藏 header 後就固定誤報 title-missing（12/106 站命中同款）。
//   2. 剝開頭的 `[站名]` / 【站名】 前綴（og:title 常帶、渲染標題不帶）。
// 兩步都只是放寬「同一標題的不同寫法」比對，不會讓不相干 heading 命中（length>=4
// 門檻 + 雙向 includes 仍在）。
pageFns.tagOriginalTitle = function () {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  // 全形 ASCII 標點（U+FF01-U+FF5E）→ 半形，並統一常見全形括號 / 引號的對應
  const foldWidth = s => (s || '').replace(/[！-～]/g,
    c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const stripSitePrefix = s => norm(s).replace(/^\s*[\[【(（][^\]】)）]{1,20}[\]】)）]\s*/, '');
  const squash = s => foldWidth(norm(s)).replace(/\s+/g, '');
  const stripSuffix = s => {
    let r = norm(s), prev;
    do { prev = r; r = r.replace(/\s*[|\-–—·»]\s*[^|\-–—·»]{1,40}$/, ''); }
    while (r !== prev && r.length >= 4);
    return r;
  };
  const og = document.querySelector('meta[property="og:title"]');
  const cands = [stripSuffix(og && og.content ? og.content : ''), stripSuffix(document.title || '')]
    .flatMap(c => [c, stripSitePrefix(c)])
    .filter(c => c && c.length >= 4).map(squash);
  if (!cands.length) return { tagged: 0 };
  let n = 0;
  for (const h of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
    const t = squash(h.textContent || '');
    if (!t || t.length < 4) continue;
    if (!cands.some(c => t.includes(c) || c.includes(t))) continue;
    h.setAttribute('data-jread-audit-title', '1');
    n++;
    if (n >= 3) break; // 同一標題常有響應式重複版本，標前幾個就夠
  }
  return { tagged: n };
};

pageFns.auditTitlePresence = function () {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  // 優先走「標記元素還在不在」——翻譯無關（見 tagOriginalTitle 註解）。
  // 任一標記元素可見即通過：原標題留在 card 內、或 JRead 把它 clone /
  // 搬進 card、或翻譯頁的外置 clone（data-jread-promoted-outside）都算。
  const tagged = Array.prototype.slice.call(
    document.querySelectorAll('[data-jread-audit-title="1"]'));
  // v1.7.57：tag 路徑改成**只做正向判定**。標記可能標錯載體（站台 chrome 裡與
  // og:title 逐字相同的重複標題），此時「標記元素不可見」不等於「標題沒進 card」
  // ——newtalk / bbc / cnbc 等 12 站實證。標記可見 → 直接 found；標記全不可見 →
  // **不下結論**，往下退回字串比對路徑再判一次（該路徑看的是 card 內可見文字，
  // 與標記元素身份無關）。
  if (tagged.length) {
    const artEl = document.querySelector('[data-jread-active="1"]');
    const visible = tagged.some(el => {
      if (el.closest('[data-jread-hidden="1"]')) return false;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      if (!artEl) return true;
      return artEl.contains(el) || !!el.closest('[data-jread-promoted-outside="1"]');
    });
    if (visible) {
      return { checked: true, missing: false, found: true, via: 'tag',
        taggedCount: tagged.length };
    }
  }
  // 站名 / 麵包屑尾綴剝除：反覆砍掉每一段 ` <sep> 短字串`（<=40 chars）尾綴。
  // 兩個修正（2026-07-02 page rounds title-missing 幾乎每站誤報）：
  //   1. 原本只砍「一段」，但很多站 document.title 是多段麵包屑
  //      （udn:「標題 | 賴總統暫緩出訪 | 要聞 | 聯合新聞網」）→ 砍一段還剩兩段。
  //   2. 原本只對 document.title 砍尾綴、og:title 只 norm 沒砍
  //      → og:title 帶「 | 聯合新聞網」永遠不 match。兩候選都必須砍。
  // 過度砍只會得到更短前綴，仍是完整可見標題的子字串 → 仍 found（安全）；
  // 只在低精度 review 層有極小誤配風險，length>=4 門檻擋掉。
  const stripSuffix = s => {
    let r = norm(s), prev;
    do { prev = r; r = r.replace(/\s*[|\-–—·»]\s*[^|\-–—·»]{1,40}$/, ''); }
    while (r !== prev && r.length >= 4);
    return r;
  };
  // v1.7.57：剝開頭的 `[站名]` / 【站名】 前綴（og:title 常帶、渲染標題不帶），
  // 與 tagOriginalTitle 同款。原字串也留著當候選（帶前綴的站仍能命中）。
  const stripSitePrefix = s => norm(s).replace(/^\s*[\[【(（][^\]】)）]{1,20}[\]】)）]\s*/, '');
  const og = document.querySelector('meta[property="og:title"]');
  const ogTitle = stripSuffix(og && og.content ? og.content : '');
  const docTitle = stripSuffix(document.title || '');
  const candidates = [ogTitle, docTitle]
    .flatMap(c => [c, stripSitePrefix(c)])
    .filter(c => c && c.length >= 4);
  if (!candidates.length) return { checked: false };
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { checked: false };
  // reader 可見文字：clone 後移除 data-jread-hidden 子樹（textContent 不管 display）
  const clone = art.cloneNode(true);
  for (const h of clone.querySelectorAll('[data-jread-hidden="1"]')) h.remove();
  const visText = norm(clone.textContent);
  // 比對時把兩邊所有空白去掉（2026-07-02 chinatimes 實測）：中文站的 rendered
  // H1 常用 pangu 式 CJK↔Latin/數字間距（「收紅 340 點」），但 og:title /
  // document.title 沒補空格（「收紅340點」）→ 一般 includes() 因空白差異永遠 miss。
  // 標題是長字串、去空白後跨字串碰撞風險可忽略；且只影響低精度 review 信號、
  // 目標是抓「標題整個沒進 card」。
  // v1.7.57：一併折全形 ASCII 標點（og:title 半形 `!` vs 渲染 h1 全形 `！`，
  // newtalk 實證），理由同 tagOriginalTitle。
  const foldWidth = s => (s || '').replace(/[！-～]/g,
    c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const squash = s => foldWidth(s).replace(/\s+/g, '');
  const vis = squash(visText);
  const found = candidates.some(c => vis.includes(squash(c)));
  return { checked: true, missing: !found, found,
    title: (ogTitle || docTitle).slice(0, 80) };
};

// =============================================================================
// node-side runner（對外 API——call site 用這層，不直接碰 pageFns）
// =============================================================================

const runResidualText = (page, keywords) => page.evaluate(pageFns.auditResidualText, keywords);
const runResidualLinks = (page, keywords) => page.evaluate(pageFns.auditResidualLinks, keywords);
const runOutsideArticle = (page) => page.evaluate(pageFns.auditOutsideArticle);
const runGapAudit = (page) => page.evaluate(pageFns.auditGap);
const runContrastAudit = (page) => page.evaluate(pageFns.auditContrast);
const runContentWidthAudit = (page) => page.evaluate(pageFns.auditContentWidth);
const runBodyWidthAudit = (page) => page.evaluate(pageFns.auditBodyWidthRatio);
const runOverflowAudit = (page) => page.evaluate(pageFns.auditOverflow);
const runTextImageOverlapAudit = (page) => page.evaluate(pageFns.auditTextImageOverlap);
const runNarrowTextAudit = (page) => page.evaluate(pageFns.auditNarrowText);
const runFigcaptionAudit = (page) => page.evaluate(pageFns.auditFigcaption);
const runTailAudit = (page) => page.evaluate(pageFns.auditTail);
const runContentStats = (page) => page.evaluate(pageFns.auditContentStats);
const captureOriginalHeroImages = (page) => page.evaluate(pageFns.captureOriginalHeroImages);
const collectOriginalTextStats = (page) => page.evaluate(pageFns.collectOriginalTextStats);
// 內文掉圖 audit：tag 在 toggle 前、collect 在 toggle 後（兩段呼叫）。
const tagOriginalContentFigures = (page) => page.evaluate(pageFns.tagOriginalContentFigures, CFIG_NOISE_TOKENS);
const runDroppedFigureAudit = (page) => page.evaluate(pageFns.collectDroppedContentFigures);
// 誤殺長段落 audit：tag 在 toggle 前、collect 在 toggle 後（兩段呼叫）。
// 共用 CFIG_NOISE_TOKENS 排除 chrome/comment/related 容器。
const tagOriginalLongProse = (page) => page.evaluate(pageFns.tagOriginalLongProse, CFIG_NOISE_TOKENS);
const runDroppedProseAudit = (page) => page.evaluate(pageFns.collectDroppedProse);
// 標題進 reader card audit（toggle 後單段呼叫）。
const runTitlePresenceAudit = (page) => page.evaluate(pageFns.auditTitlePresence);
// 標題載體標記（toggle / 翻譯前跑）——見 pageFns.tagOriginalTitle 註解
const tagOriginalTitle = (page) => page.evaluate(pageFns.tagOriginalTitle);
// Byline（作者 + 日期）audit：tag 在 toggle 前、collect 在 toggle 後（兩段呼叫）。
const tagOriginalByline = (page) => page.evaluate(pageFns.tagOriginalByline);
const runDroppedBylineAudit = (page) => page.evaluate(pageFns.collectDroppedByline);

// Hero image audit：原頁 top-3 大圖是否在 reader mode 中存活。
// 比對三軌：src 全等、URL pathname 相同（srcset / CDN 變體切換會換 query
// 或解析度後綴、natural 尺寸跟著變，twreporter 假 missing 實案）、natural
// 尺寸全等。
async function runHeroImageAudit(page, originalHeroImages) {
  const readerImgs = await page.evaluate(pageFns.collectReaderImages);
  const pathnameOf = (src) => {
    try { return new URL(src).pathname; } catch { return null; }
  };
  // pathname 尾段（檔名 / encoded 原圖 URL）——dev.to 類 image proxy 把尺寸
  // 參數放 pathname（width=1000,... 是 path segment），reader 縮窄後響應式
  // srcset 換變體 → src / pathname / naturalW 三條全 miss 誤報 missing
  // （2026-06-11 實證）。同一張圖的所有變體共享尾段（encoded 原圖 URL）。
  const lastSegOf = (src) => {
    const p = pathnameOf(src);
    if (!p) return null;
    const seg = p.split('/').filter(Boolean).pop();
    return seg && seg.length >= 8 ? seg : null; // 過短尾段（'1.jpg' 類）跨圖撞名，不採用
  };
  const missing = [];
  for (const orig of originalHeroImages) {
    const origPath = pathnameOf(orig.src);
    const origSeg = lastSegOf(orig.src);
    // src 系比對對 loaded / present 都成立（present = 元素在 DOM 未被 hide、
    // 只是 lazy 未載——不是誤殺）；natural 尺寸比對只對 loaded 有意義。
    const found = readerImgs.some(ri =>
      ri.src === orig.src ||
      (origPath && pathnameOf(ri.src) === origPath) ||
      (origSeg && lastSegOf(ri.src) === origSeg) ||
      (ri.loaded && ri.naturalW === orig.naturalW && ri.naturalH === orig.naturalH));
    if (!found) missing.push(orig);
  }
  return {
    originalCount: originalHeroImages.length,
    readerCount: readerImgs.filter(ri => ri.loaded).length,
    missing
  };
}

// 等 reader card 內 hero-sized img naturalWidth > 0。
// 解 lazy-load race：reader mode 重新 mount img 後 IntersectionObserver
// 還沒觸發、或網路慢時 naturalW=0 會被 audit filter 過濾掉誤判為 missing。
async function waitForReaderImagesLoaded(page, timeoutMs = 3000) {
  await page.evaluate(() => {
    const art = document.querySelector('[data-jread-active="1"]');
    if (!art) return;
    art.scrollIntoView({ block: 'start' });
    window.scrollTo(0, document.body.scrollHeight);
    window.scrollTo(0, 0);
  });
  try {
    await page.waitForFunction(() => {
      const art = document.querySelector('[data-jread-active="1"]');
      if (!art) return true;
      const imgs = Array.from(art.querySelectorAll('img')).filter(img => {
        const r = img.getBoundingClientRect();
        return r.width >= 100 && r.height >= 50
          && !img.closest('[data-jread-hidden="1"]');
      });
      return imgs.every(img => img.naturalWidth > 0);
    }, { timeout: timeoutMs, polling: 200 });
  } catch (e) { /* timeout — 留給 audit 自行判定 */ }
}

// ---- 分頁滾動截圖（共用版）----
// fullPage:true 對某些 SPA 站不可靠（cnyes：Next.js reconciliation 在 reader
// mode 下噴 NotFoundError、拍出整張白圖）。改每次滑 viewport × 0.9（留 10%
// 重疊）截一張。maxPages 上限防超長頁拍幾十張；截斷時明確 log 被丟掉的頁數
//（no silent caps——沉默截斷會被讀成「整頁都看過了」）。
// opts.ensure：每頁截圖前的非同步 callback（第五輪調校）。dark 分頁截圖時序
// bug——cnbc 實證 dark-page-02 起卡片回亮色（SPA 捲動觸發 re-render 把主題
// 弄掉），audit theme 欄位只在切換當下驗一次、之後各頁 silent 失真。caller
// 傳 ensure 在每頁前重驗 / 重套狀態（page-rounds dark phase 用）。
async function takePagedScreenshots(page, opts) {
  const { dir, prefix, maxPages = 40, ensure } = opts;
  const info = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight
  }));
  const step = Math.floor(info.viewportHeight * 0.9);
  const fullCount = Math.max(1, Math.ceil(info.docHeight / step));
  const count = Math.min(fullCount, maxPages);
  const paths = [];
  for (let i = 0; i < count; i++) {
    await page.evaluate(y => window.scrollTo(0, y), i * step);
    await sleep(400);
    if (ensure) {
      try { await ensure(i); } catch (_) { /* ensure 失敗不擋截圖 */ }
    }
    const p = path.join(dir, `${prefix}-page-${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: p });
    paths.push(p);
  }
  if (fullCount > count) {
    console.log(`  ⚠️ ${prefix}: 截圖頁數達上限 ${maxPages}，尾端 ${fullCount - count} 頁未拍（docHeight=${info.docHeight}）`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  console.log(`  ${prefix}: ${count}/${fullCount} pages`);
  return paths;
}

// ---- set-theme（dispatch + 驗證實際套上）----
// v0.8.36 起 set-theme 走 SW 中繼 + development install gate——dispatch 不保證
// 生效（gate 拒絕 / SW 掛掉 / storage race 都 silent）。本 helper dispatch 後
// poll reader card 的 computed background-color，變色才算 applied；逾時回報
// applied:false 讓 caller 決定 fail——防「dark 截圖 silently 拍成亮色」的
// 偽陰性（v0.8.39 harness review 抓到的盲點）。
async function setThemeAndVerify(page, theme, timeoutMs = 4000) {
  const readCardBg = () => page.evaluate(() => {
    const art = document.querySelector('[data-jread-active="1"]');
    return art ? getComputedStyle(art).backgroundColor : null;
  });
  const before = await readCardBg();
  await page.evaluate((t) => {
    window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'set-theme', theme: t } }));
  }, theme);
  if (!before) return { applied: false, reason: 'no reader card', before, after: null };
  try {
    await page.waitForFunction((prev) => {
      const art = document.querySelector('[data-jread-active="1"]');
      return !!art && getComputedStyle(art).backgroundColor !== prev;
    }, before, { timeout: timeoutMs, polling: 200 });
  } catch (e) { /* 逾時——下面以 before/after 比對回報 */ }
  const after = await readCardBg();
  return { applied: after !== before, before, after };
}

// ---------------------------------------------------------------------------
// 頁面語言判定 + Shinkansen 翻譯觸發（兩支 harness 共用單一資料源，2026-08-07）
//
// 動機（Jimmy 2026-08-07 規則）：**非中文網頁的驗收必須連 Shinkansen 翻譯後
// 一起測**——translate-first 是整整一個 bug family 的溫床（v1.6.12 iOS CJK
// justify / v1.7.38 CJK linkDensity / v1.7.52 CJK 標題 spacer / v1.7.56 canonical
// 文字比對），共同機制是「翻譯改寫 DOM 文字，但 meta / class / 門檻是按原文
// 校準的」。只驗英文原頁＝系統性漏掉這一整類。
// ---------------------------------------------------------------------------

// 判定「這頁是中文頁」——中文頁不需要跑翻譯輪。純函式（可單測、forcing 見
// page-rounds-translate-round.spec.js）。
//
// **內容才是權威，`<html lang>` 只當正向訊號**——站方的 lang 常常是樣板殘留：
// cw.com.tw（天下雜誌，全中文）實測宣告 `lang="en-US"`，若讓 lang 說了算就會
// 把中文站當非中文、每次多跑一輪沒意義的翻譯。判定順序：
//   1. lang 是 zh* → 中文（正向訊號可信）
//   2. lang 是 ja / ko → 非中文（日文站滿是漢字，字元比例法會誤判成中文，
//      這兩個語言碼要先攔）
//   3. 其餘（含錯誤 / 缺失的 lang）看字元組成：假名 / 諺文 → 非中文；
//      漢字比例 >= 0.2 → 中文；都不是 → 非中文
// 誤判成本不對稱：把中文站當非中文只是多跑一輪（浪費時間），把非中文站當中文
// 會漏掉整個翻譯驗收（違反規則）→ 拿不準時一律回 false。
function pageLooksChinese({ lang, sample } = {}) {
  const l = String(lang || '').trim().toLowerCase();
  if (/^zh\b|^zh-/.test(l)) return true;
  if (/^(ja|ko)\b|^(ja|ko)-/.test(l)) return false;
  const s = String(sample || '');
  if (!s) return false;
  if (/[぀-ヿ가-힯]/.test(s)) return false; // 假名 / 諺文 → 日文 / 韓文
  const han = (s.match(/[㐀-䶿一-鿿]/g) || []).length;
  return han / s.length >= 0.2;
}

// 從真實頁面取 lang + 內文樣本，回 { lang, isChinese }
async function runLangDetect(page) {
  const info = await page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang') || '',
    sample: (document.body ? document.body.innerText || '' : '')
      .replace(/\s+/g, '').slice(0, 2000)
  }));
  return { lang: info.lang, isChinese: pageLooksChinese(info) };
}

// 觸發 Shinkansen 翻譯（跨 extension custom event，Google MT 免 API key）並等穩定。
// 回傳翻譯元素數；0 = 沒翻到（呼叫端須當成訊號回報，不可靜默當成「翻過了」）。
async function triggerShinkansenTranslate(page, opts = {}) {
  const log = opts.log || console.log;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  const res = await page.evaluate(() => new Promise((resolve) => {
    const to = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 30000);
    window.addEventListener('shinkansen-debug-response', (e) => {
      clearTimeout(to);
      resolve({ ok: true, detail: e.detail });
    }, { once: true });
    window.dispatchEvent(new CustomEvent('__jread_debug', {
      detail: { type: 'translate', engine: 'google' }
    }));
  }));
  log('translate trigger: ' + JSON.stringify(res));
  log('waiting for translation to settle...');
  // poll 翻譯元素數，連續兩次（間隔 1.5s）非零且不再增加即視為穩定；上限 20s
  const start = Date.now();
  let n = 0, prev = -1, stable = 0;
  while (Date.now() - start < 20000) {
    await sleep(1500);
    n = await page.evaluate(() => document.querySelectorAll('[data-shinkansen-translated]').length);
    if (n > 0 && n === prev) {
      stable++;
      if (stable >= 2) break;
    } else {
      stable = 0;
    }
    prev = n;
  }
  log(`Shinkansen 翻譯元素數: ${n}（${((Date.now() - start) / 1000).toFixed(1)}s）`);
  return n;
}

module.exports = {
  pageLooksChinese,
  runLangDetect,
  triggerShinkansenTranslate,
  NOISE_AUDIT_KEYWORDS,
  NOISE_KEYWORDS_STRICT,
  NOISE_KEYWORDS_CONTEXTUAL,
  NOISE_KEYWORD_TIERS,
  CFIG_NOISE_TOKENS,
  pageFns,
  runResidualText,
  runResidualLinks,
  runOutsideArticle,
  runGapAudit,
  runContrastAudit,
  runContentWidthAudit,
  runBodyWidthAudit,
  runOverflowAudit,
  runTextImageOverlapAudit,
  runNarrowTextAudit,
  runFigcaptionAudit,
  runTailAudit,
  runContentStats,
  captureOriginalHeroImages,
  collectOriginalTextStats,
  runHeroImageAudit,
  tagOriginalContentFigures,
  runDroppedFigureAudit,
  tagOriginalLongProse,
  runDroppedProseAudit,
  runTitlePresenceAudit,
  tagOriginalTitle,
  tagOriginalByline,
  runDroppedBylineAudit,
  waitForReaderImagesLoaded,
  takePagedScreenshots,
  setThemeAndVerify
};
