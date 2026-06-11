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
// 新增字樣請同步維護 cleaner.js 的 NOISE_*_RE regex；此清單是 forcing
// function——harness 每次驗收必跑、任一命中都印 WARNING。
// 已知誤報：「透過」「更多」「貼文」是常用詞，翻譯後內文常以子字串命中——
// 看 ancestors 落在主文內文容器（body.markup / available-content）即誤報。
// 名單不得有重複項（regression spec 驗）。
const NOISE_AUDIT_KEYWORDS = [
  '更多', '相關', '其他人', '推薦', '最新', '延伸', '查看原始', '看更多', '看原文',
  '加入', '訂閱', 'LINE 官方', 'LINE官方', '官方帳號', '粉絲專頁', '好友',
  'AI 摘要', 'AI摘要', '網友貼文', '貼文',
  '轉發', '留言', '建立貼文', '熱門', '繼續看下去', '回覆',
  '廣告', '贊助', '業配',
  '登入', '註冊',
  '原始文章',
  '追蹤', '關注',
  'Google新聞', 'Google 新聞', '透過',
  '聽新聞', '聽書', '想成為', '玩問答', '拿課程', '抽獎', '免費領'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =============================================================================
// page-world 函式（每支自包含，不得引用 module scope——見檔頭註解）
// =============================================================================
const pageFns = {};

// ---- Residual audit（短 direct text 掃描）----
// 驗：reader card 內 visible element 的 direct textNode（<= 60 chars）是否命中
// keyword 名單；不驗：> 60 chars 的長文案雜訊（整段推薦文字會逃過，已知
// tradeoff——keyword 比對對長文誤報率太高）、圖片內文字、iframe 內部。
pageFns.auditResidualText = function (keywords) {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article' };
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
    const hitKws = keywords.filter(kw => text.includes(kw));
    items.push({
      tag: el.tagName,
      text: text.slice(0, 60),
      hitKeywords: hitKws,
      elCls: (el.className || '').toString().slice(0, 80),
      parents: hitKws.length > 0 ? (() => {
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
  const warnings = items.filter(it => it.hitKeywords.length > 0);
  return { total: items.length, warnings, items: items.slice(0, 60) };
};

// ---- Residual audit（a/button 全量掃描）----
// 驗：reader card 內所有 visible a / button / [role=button]（含空 direct text
// 的 icon button）——用 textContent（整棵子樹）判定，LINE 分享這類
// `<a><svg/><span>分享</span></a>` 才不會漏；class / href 另以 share/social
// 慣用詞與社群網域比對。
pageFns.auditResidualLinks = function (keywords) {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article' };
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
  for (const btn of art.querySelectorAll('a, button, [role="button"]')) {
    if (!isVisible(btn)) continue;
    const text = norm(btn.textContent).slice(0, 60);
    const cls = (btn.className || '').toString().slice(0, 60);
    const href = btn.getAttribute ? (btn.getAttribute('href') || '') : '';
    items.push({
      tag: btn.tagName,
      text: text || '(no text)',
      cls, href: href.slice(0, 40),
      hitKeywords: keywords.filter(kw => text.includes(kw) || cls.toLowerCase().includes(kw.toLowerCase()))
    });
    if (items.length >= 200) break;
  }
  return {
    total: items.length,
    warnings: items.filter(i => i.hitKeywords.length > 0 || /share|social|subscribe|follow/i.test(i.cls) || /line\.me|twitter|facebook|x\.com/.test(i.href)),
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
// 驗：content anchor（p/h*/figure/img/ul/ol/blockquote/pre）按 y 排序後相鄰
// 兩 block 間 gap；>= 80px 警告（未清的 empty wrapper / 廣告 placeholder /
// 塌陷 figure 的型態，techbang 262px 實案）。非 forcing function——h2 前
// 60-80px 是合法 margin。div 故意不收：太通用、會納入 wrapper double-count。
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
  for (const el of art.querySelectorAll('p, h1, h2, h3, h4, h5, h6, figure, img, ul, ol, blockquote, pre')) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) continue;
    blocks.push({ top: r.top, bottom: r.bottom, tag: el.tagName,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
  }
  blocks.sort((a, b) => a.top - b.top);
  const gaps = [];
  for (let i = 1; i < blocks.length; i++) {
    const gap = blocks[i].top - blocks[i - 1].bottom;
    if (gap >= 80) {
      gaps.push({
        gap: Math.round(gap),
        prev: `${blocks[i - 1].tag} "${blocks[i - 1].text}"`,
        next: `${blocks[i].tag} "${blocks[i].text}"`,
        y: Math.round(blocks[i - 1].bottom)
      });
    }
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
pageFns.auditOverflow = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return { error: 'no article', overflow: false, items: [] };
  const cardRect = art.getBoundingClientRect();
  const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
  const NON_RENDERING_TAGS = new Set(['SOURCE', 'TRACK', 'META', 'LINK', 'STYLE', 'SCRIPT', 'HEAD', 'TITLE', 'TEMPLATE', 'PARAM']);
  const items = [];
  for (const el of art.querySelectorAll('*')) {
    if (NON_RENDERING_TAGS.has(el.tagName)) continue;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right > cardRect.right + 2) {
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

// ---- Hero image：原頁擷取（toggle 前呼叫）----
// 雙重過濾：渲染 size + natural size 都要夠大（100x100 avatar 被 CSS 撐大
// 誤判 hero，newtalk 實測）；長寬比 >= 4:1 排除（裝飾性版頭 banner，cnbc
// 1497x160 實測——純閱讀本來就該清，不該當 hero 誤判 missing）。
pageFns.captureOriginalHeroImages = function () {
  const MAX_ASPECT = 4; // 寬/高 或 高/寬 超過此值視為裝飾性細長條，非 hero
  return Array.from(document.querySelectorAll('img')).map(img => {
    const r = img.getBoundingClientRect();
    return { src: img.src ? img.src.slice(0, 120) : '', w: r.width, h: r.height,
      naturalW: img.naturalWidth, naturalH: img.naturalHeight, top: r.top };
  }).filter(i => i.w >= 300 && i.h >= 150
    && i.naturalW >= 300 && i.naturalH >= 150
    && i.naturalW / i.naturalH < MAX_ASPECT
    && i.naturalH / i.naturalW < MAX_ASPECT
    && i.top < 800)
    .sort((a, b) => a.top - b.top)
    .slice(0, 3);
};

// ---- Hero image：reader 內存活清單（與原頁清單比對在 node 側做）----
pageFns.collectReaderImages = function () {
  const art = document.querySelector('[data-jread-active="1"]');
  if (!art) return [];
  return Array.from(art.querySelectorAll('img')).map(img => {
    const r = img.getBoundingClientRect();
    return { src: img.src ? img.src.slice(0, 120) : '', w: r.width, h: r.height,
      naturalW: img.naturalWidth, naturalH: img.naturalHeight,
      hidden: !!(img.closest('[data-jread-hidden="1"]')) };
  }).filter(i => i.naturalW >= 200 && i.naturalH >= 100
    && i.w >= 100 && i.h >= 50 && !i.hidden);
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
const runNarrowTextAudit = (page) => page.evaluate(pageFns.auditNarrowText);
const runFigcaptionAudit = (page) => page.evaluate(pageFns.auditFigcaption);
const runTailAudit = (page) => page.evaluate(pageFns.auditTail);
const runContentStats = (page) => page.evaluate(pageFns.auditContentStats);
const captureOriginalHeroImages = (page) => page.evaluate(pageFns.captureOriginalHeroImages);

// Hero image audit：原頁 top-3 大圖是否在 reader mode 中存活。
async function runHeroImageAudit(page, originalHeroImages) {
  const readerImgs = await page.evaluate(pageFns.collectReaderImages);
  const missing = [];
  for (const orig of originalHeroImages) {
    const found = readerImgs.some(ri =>
      ri.src === orig.src || (ri.naturalW === orig.naturalW && ri.naturalH === orig.naturalH));
    if (!found) missing.push(orig);
  }
  return { originalCount: originalHeroImages.length, readerCount: readerImgs.length, missing };
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
async function takePagedScreenshots(page, opts) {
  const { dir, prefix, maxPages = 40 } = opts;
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

module.exports = {
  NOISE_AUDIT_KEYWORDS,
  pageFns,
  runResidualText,
  runResidualLinks,
  runOutsideArticle,
  runGapAudit,
  runContrastAudit,
  runContentWidthAudit,
  runBodyWidthAudit,
  runOverflowAudit,
  runNarrowTextAudit,
  runFigcaptionAudit,
  runTailAudit,
  runContentStats,
  captureOriginalHeroImages,
  runHeroImageAudit,
  waitForReaderImagesLoaded,
  takePagedScreenshots,
  setThemeAndVerify
};
