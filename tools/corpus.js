#!/usr/bin/env node
// JRead — 凍結語料庫 + 指紋比對（2026-11-18）
// -----------------------------------------------------------------------------
// 要解的問題：cleaner / styler / detector 是互相影響的啟發式規則，改一條沒有便宜的
// 方法知道「別的站變了沒」。regression spec 的 fixture 是手寫最小重現，只驗「這個 bug
// 沒回來」；真站驗收（page rounds）跑線上頁面——慢、每次內容不同、事後才跑，回歸
// 都留到下一輪才發現。
//
// 做法：把真實頁面「凍結」成離線快照，每次改 code 後全部重放一遍、輸出每頁的指紋，
// 跟基準逐頁比對。結果是「這 N 頁變了、各變了什麼」，只需要看那 N 頁。
//
//   capture  開真站 → 存快照（載入後的 DOM、外部 CSS 內容、每張圖的原始尺寸）
//   check    用目前的 jread/ 重放全部快照 → 跟基準比 → 印差異（有差異 exit 1）
//   accept   把這次的結果收為新基準（確認差異都是預期的之後）
//   run      只重放、輸出指紋到指定目錄（比對兩個版本時用：--ext 指向舊版副本）
//   compare  比對兩個指紋目錄
//   shot     重放指定頁面並截圖（看差異長怎樣；--ext 指向舊版副本可拍舊版對照）
//   list     列出語料庫內容
//
// 用法：
//   node tools/corpus.js capture                  # 擷取站點清單裡還沒有快照的頁面
//   node tools/corpus.js capture --url <URL>      # 加一頁（修過的 bug 頁面收進來）
//   node tools/corpus.js capture --only bbc --force   # 重擷取（基準要跟著 accept）
//   node tools/corpus.js capture --url <URL> --html test/blocked-html/so.html
//                                                 # 擋 headless 的站：主文件改用存好的 HTML 快照
//                                                 #（子資源照樣從真站抓；可加 --translate）
//   node tools/corpus.js check                    # 日常：改完 code 跑這個
//   node tools/corpus.js check --only wiki        # 只跑 id 含 wiki 的頁面
//   node tools/corpus.js shot --only '=npr.org_f1767e,womany'   # 逗號分隔多個片段；=<id> 精確比對
//   node tools/corpus.js shot --only bbc           # 截圖在 ~/.jread-debug/corpus/shots/
//        （捲動／430 寬拍前 12 屏、翻頁拍前 40 頁，另拍最後 4 屏／頁；--shots N|all、--tail N 調整）
//   node tools/corpus.js accept [--only <片段>]
//   node tools/corpus.js run --ext /tmp/old/jread --out /tmp/fp-old
//   node tools/corpus.js compare /tmp/fp-old /tmp/fp-new
//   node tools/corpus.js run --out /tmp/census --after ./my-probe.js   # 普查：每頁重放後跑自訂量測
// 共用選項：--jobs N（並行瀏覽器數，預設 4）、--wait ms（進場後等多久才量，預設 4500＝
// 蓋過 1s / 3s 兩個重測計時器）、--variants scroll,paged,narrow（預設 scroll）
//
// 快照為什麼可重放、結果固定：
//   - 站方 script 全部停用（type 改掉、元素留在原位——DOM 結構與 JSON-LD 不變）
//   - 重放時不連網：主文件、CSS 由快照供應；圖片依擷取時記下的原始尺寸回一張同尺寸
//     的 SVG 佔位圖（naturalWidth / Height 與擷取時一致）；其餘請求一律中止
//   - 走真的 extension 載入路徑（isolated world、SW、storage），與 debug-harness 同款
//
// 這條驗 X、不驗 Y（工作流原則 3）：
//   驗——同一份凍結 DOM 上，JRead 的偵測（選哪個主文容器）、清除（哪些文字與媒體
//        還看得到）、排版（每個區塊的位置與尺寸）結果有沒有變
//   不驗——(a) 站方 script 的動態行為：lazy 載入（2026-11-24 起瀏覽器原生 `loading=lazy`
//        在重放時一律直接載入，站方 script 做的 lazy 仍不驗）、晚插入的 widget、SPA 導航、動態
//        observer 的時序——這層仍歸 debug-harness 真站與 page rounds
//        (b) 快照之後站方改版：語料庫是「當時的頁面」，不是今天的頁面
//        (c) 「基準本身對不對」：指紋只回答「變了沒」，基準的品質靠 accept 前看過
//        (d) WebKit / Safari、iOS、字型實際字寬（佔位圖沒有內容、站方 webfont 不載）
//        (e) 翻譯後的 DOM——除非該頁是用 capture --translate 擷取的翻譯後快照
// -----------------------------------------------------------------------------
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

const PROJECT_ROOT = path.join(__dirname, '..');
const CORPUS_DIR = process.env.JREAD_CORPUS_DIR || path.join(PROJECT_ROOT, 'test', 'corpus');
const PAGES_DIR = path.join(CORPUS_DIR, 'pages');
const BASELINE_DIR = path.join(CORPUS_DIR, 'baseline');
// 這次的結果放在專案外：專案目錄在 iCloud Drive 內，整批刪掉重寫會被同步機制複製出
// 「檔名 2.json」的衝突副本（實測 432 份裡冒出 36 份），被當成新頁面
const RUN_ROOT = path.join(os.homedir(), '.jread-debug', 'corpus');
const CURRENT_DIR = path.join(RUN_ROOT, 'current');
const SITES_MD = path.join(PROJECT_ROOT, 'docs', 'excluded', 'page-rounds-sites.md');
const EXTRA_URLS = path.join(CORPUS_DIR, 'urls.txt'); // 站點清單以外的頁面（修過的 bug 頁），一行一個

const VARIANTS = {
  scroll: { viewport: { width: 1280, height: 900 }, settings: { pagedMode: false } },
  paged: { viewport: { width: 1280, height: 900 }, settings: { pagedMode: true } },
  narrow: { viewport: { width: 430, height: 850 }, settings: { pagedMode: false } },
  // 2026-11-20：中等寬度（站方 < 1140 斷點的版面，如 Guardian 圖說排在標題後）。只供普查 /
  // 重放時用 --variants mid 指定，不在 check 的預設模式內、沒有基準
  mid: { viewport: { width: 1000, height: 900 }, settings: { pagedMode: false } }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// 純函式（test/regression/tools-corpus.spec.js 直接驗）
// ============================================================================

// 頁面 id：host + path 雜湊（與 page-rounds 的輸出目錄同一個命名法）
function pageId(url, suffix) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const hash = crypto.createHash('md5').update(u.pathname + u.search).digest('hex').slice(0, 6);
  return `${host}_${hash}${suffix || ''}`;
}

// 站點清單解析（與 batch-page-rounds.sh 同一份來源、同一條規則：cage 段之前的有編號列）
function parseSitesMd(md) {
  const urls = [];
  for (const line of md.split('\n')) {
    if (/^## cage 模式/.test(line)) break;
    if (!/^\| [0-9]+ \|/.test(line)) continue;
    const m = /\((https?:\/\/[^)]+)\)/.exec(line);
    if (m) urls.push(m[1]);
  }
  return urls;
}

// 最長共同子序列的配對（a、b 為 key 陣列），回傳 [ai, bi] 配對清單
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  // 頭尾相同的先剝掉——絕大多數頁面只有零星差異，DP 表因此很小
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
  const pairs = [];
  for (let i = 0; i < s; i++) pairs.push([i, i]);
  const A = a.slice(s, n - e), B = b.slice(s, m - e);
  if (A.length && B.length) {
    const w = B.length + 1;
    const dp = new Uint32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { pairs.push([s + i, s + j]); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < e; k++) pairs.push([n - e + k, m - e + k]);
  return pairs;
}

const blockKey = (b) => `${b.n}|${b.t}`;
const mediaKey = (m) => `${m.tag}|${m.src}`;

// 比對同一頁的兩份指紋。回傳 { level, lines }：
//   level  'same' | 'layout'（只有位置 / 尺寸變）| 'content'（看得到的文字 / 媒體 / 主文容器變）
//          | 'broken'（閱讀模式進不去、或重放出錯）
function diffFingerprint(base, cur, opts) {
  const tol = (opts && opts.tolerancePx) || 1;
  const lines = [];
  let level = 'same';
  const bump = (l) => {
    const rank = { same: 0, layout: 1, content: 2, broken: 3 };
    if (rank[l] > rank[level]) level = l;
  };
  if (cur.error || base.error) {
    if ((cur.error || '') !== (base.error || '')) {
      bump('broken');
      lines.push(`重放出錯：基準「${base.error || '無'}」→ 現在「${cur.error || '無'}」`);
    }
    if (cur.error) return { level, lines };
  }
  if (base.active !== cur.active) {
    bump('broken');
    lines.push(`閱讀模式：基準${base.active ? '有進' : '沒進'} → 現在${cur.active ? '有進' : '沒進'}`);
  }
  if ((base.root || '') !== (cur.root || '')) {
    bump('content');
    lines.push(`主文容器換了：${base.root || '(無)'} → ${cur.root || '(無)'}`);
  }
  for (const k of ['title', 'byline']) {
    if ((base[k] || '') !== (cur[k] || '')) {
      bump('content');
      lines.push(`${k === 'title' ? '標題' : '作者／日期列'}：「${base[k] || ''}」→「${cur[k] || ''}」`);
    }
  }
  // ---- 看得到的文字區塊 ----
  const bt = base.text || [], ct = cur.text || [];
  const pairs = lcsPairs(bt.map(blockKey), ct.map(blockKey));
  const inB = new Set(pairs.map((p) => p[0])), inC = new Set(pairs.map((p) => p[1]));
  let gone = bt.filter((_, i) => !inB.has(i));
  let added = ct.filter((_, i) => !inC.has(i));
  const chars = (xs) => xs.reduce((s, b) => s + b.n, 0);
  // 同一個區塊、文字只改了一部分（開頭相同、長度不同）：配成「改了」，不拆成一消失一出現
  const edited = [];
  for (const g of gone.slice()) {
    const k = added.findIndex((a) => a.tag === g.tag && a.t === g.t);
    if (k < 0) continue;
    edited.push({ g, a: added[k] });
    added.splice(k, 1);
    gone = gone.filter((x) => x !== g);
  }
  if (edited.length) {
    bump('content');
    lines.push(`文字長度變了的區塊 ${edited.length} 個：`);
    for (const { g, a } of edited.slice(0, 8)) lines.push(`  ~ <${a.tag}> ${g.n}→${a.n} 字「${a.t}」`);
    if (edited.length > 8) lines.push(`  …另有 ${edited.length - 8} 個`);
  }
  if (gone.length) {
    bump('content');
    lines.push(`消失的文字區塊 ${gone.length} 個（共 ${chars(gone)} 字）：`);
    for (const b of gone.slice(0, 8)) lines.push(`  － <${b.tag}> ${b.n} 字「${b.t}」`);
    if (gone.length > 8) lines.push(`  …另有 ${gone.length - 8} 個`);
  }
  if (added.length) {
    bump('content');
    lines.push(`新出現的文字區塊 ${added.length} 個（共 ${chars(added)} 字）：`);
    for (const b of added.slice(0, 8)) lines.push(`  ＋ <${b.tag}> ${b.n} 字「${b.t}」`);
    if (added.length > 8) lines.push(`  …另有 ${added.length - 8} 個`);
  }
  // ---- 同一區塊的尺寸、區塊之間的間距 ----
  const sizeChanged = [];
  const gapChanged = [];
  let prev = null;
  for (const [i, j] of pairs) {
    const b = bt[i], c = ct[j];
    if (Math.abs(b.x - c.x) > tol || Math.abs(b.w - c.w) > tol || Math.abs(b.h - c.h) > tol) sizeChanged.push({ b, c });
    if (prev && prev[0] === i - 1 && prev[1] === j - 1) {
      const gb = b.y - (bt[i - 1].y + bt[i - 1].h);
      const gc = c.y - (ct[j - 1].y + ct[j - 1].h);
      if (Math.abs(gb - gc) > tol) gapChanged.push({ c, gb, gc });
    }
    prev = [i, j];
  }
  if (sizeChanged.length) {
    bump('layout');
    lines.push(`尺寸／水平位置變了的區塊 ${sizeChanged.length} 個：`);
    for (const { b, c } of sizeChanged.slice(0, 5)) {
      lines.push(`  ~ 「${c.t.slice(0, 40)}」x ${b.x}→${c.x}　寬 ${b.w}→${c.w}　高 ${b.h}→${c.h}`);
    }
    if (sizeChanged.length > 5) lines.push(`  …另有 ${sizeChanged.length - 5} 個`);
  }
  if (gapChanged.length) {
    bump('layout');
    lines.push(`上方間距變了的區塊 ${gapChanged.length} 個：`);
    for (const { c, gb, gc } of gapChanged.slice(0, 5)) lines.push(`  ~ 「${c.t.slice(0, 40)}」上方間距 ${gb}→${gc}px`);
    if (gapChanged.length > 5) lines.push(`  …另有 ${gapChanged.length - 5} 個`);
  }
  // ---- 看得到的媒體 ----
  const bm = base.media || [], cm = cur.media || [];
  const mp = lcsPairs(bm.map(mediaKey), cm.map(mediaKey));
  const mB = new Set(mp.map((p) => p[0])), mC = new Set(mp.map((p) => p[1]));
  const mGone = bm.filter((_, i) => !mB.has(i)), mAdded = cm.filter((_, i) => !mC.has(i));
  if (mGone.length) {
    bump('content');
    lines.push(`消失的圖／影片 ${mGone.length} 個：` + mGone.slice(0, 5).map((m) => `${m.tag} ${m.w}×${m.h} ${m.src}`).join('；'));
  }
  if (mAdded.length) {
    bump('content');
    lines.push(`新出現的圖／影片 ${mAdded.length} 個：` + mAdded.slice(0, 5).map((m) => `${m.tag} ${m.w}×${m.h} ${m.src}`).join('；'));
  }
  const mSize = mp.map(([i, j]) => ({ b: bm[i], c: cm[j] })).filter(({ b, c }) => Math.abs(b.w - c.w) > tol || Math.abs(b.h - c.h) > tol);
  if (mSize.length) {
    bump('layout');
    lines.push(`尺寸變了的圖／影片 ${mSize.length} 個：` + mSize.slice(0, 5).map(({ b, c }) => `${c.src} ${b.w}×${b.h}→${c.w}×${c.h}`).join('；'));
  }
  if (Math.abs((base.docHeight || 0) - (cur.docHeight || 0)) > tol && level === 'same') {
    bump('layout');
    lines.push(`整頁高度 ${base.docHeight}→${cur.docHeight}px（文字區塊與媒體都沒變，多半是空白或看不見的元素）`);
  }
  if ((base.pages || 0) !== (cur.pages || 0)) {
    bump('layout');
    lines.push(`翻頁頁數 ${base.pages}→${cur.pages}`);
  }
  return { level, lines };
}

// 比對兩個指紋目錄。回傳 { rows, counts, missing }
function compareDirs(baseDir, curDir, only) {
  // 指紋檔名只認「<id>.<模式>.json」，同步衝突副本（檔名含空白）一律不看
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((n) => n.endsWith('.json') && !/\s/.test(n)) : []);
  const curFiles = list(curDir).filter((n) => matchOnly(fileId(n), only));
  const rows = [];
  const counts = { same: 0, layout: 0, content: 0, broken: 0, new: 0 };
  for (const f of curFiles.sort()) {
    const cur = JSON.parse(fs.readFileSync(path.join(curDir, f), 'utf8'));
    const bp = path.join(baseDir, f);
    if (!fs.existsSync(bp)) { counts.new++; rows.push({ file: f, level: 'new', lines: ['基準裡沒有這一頁（新擷取的頁面，看過結果後 accept）'], cur }); continue; }
    const base = JSON.parse(fs.readFileSync(bp, 'utf8'));
    const d = diffFingerprint(base, cur);
    counts[d.level]++;
    rows.push({ file: f, level: d.level, lines: d.lines, cur });
  }
  return { rows, counts, total: curFiles.length };
}

function formatReport(result, opts) {
  const out = [];
  const label = { broken: '壞掉', content: '內容變了', layout: '只有版面變', new: '新頁面' };
  for (const lv of ['broken', 'content', 'layout', 'new']) {
    const rs = result.rows.filter((r) => r.level === lv);
    if (!rs.length) continue;
    out.push(`\n===== ${label[lv]}（${rs.length} 頁）=====`);
    for (const r of rs) {
      out.push(`\n● ${r.file.replace(/\.json$/, '')}`);
      if (r.cur && r.cur.url) out.push(`  ${r.cur.url}`);
      for (const l of r.lines) out.push(`  ${l}`);
    }
  }
  const c = result.counts;
  out.push('\n==============================');
  out.push(`共 ${result.total} 頁：相同 ${c.same}｜壞掉 ${c.broken}｜內容變了 ${c.content}｜只有版面變 ${c.layout}｜新頁面 ${c.new}`);
  if (opts && opts.styleChanged) out.push('（注入的樣式表內容有變——改過 styler 屬正常，僅供參考）');
  out.push('==============================');
  return out.join('\n');
}

// ============================================================================
// 頁內函式（page.evaluate 序列化後執行，必須自包含）
// ============================================================================

// 擷取：把目前的 DOM 整理成可重放的 HTML，並回傳所有圖片的候選網址與原始尺寸
async function pageSerialize() {
  const roots = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { roots.push(el.shadowRoot); walk(el.shadowRoot); }
  };
  walk(document);
  const scopes = [document].concat(roots);
  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch (_) { return null; } };

  // ---- 圖片：每張圖所有可能被載入的網址 → 原始尺寸 ----
  const images = {};
  const pending = [];
  const srcsetUrls = (v) => (v || '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
  for (const scope of scopes) {
    for (const im of scope.querySelectorAll('img')) {
      const cands = new Set();
      for (const a of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url', 'data-hi-res-src']) {
        const v = im.getAttribute(a);
        if (v) cands.add(v);
      }
      if (im.currentSrc) cands.add(im.currentSrc);
      for (const a of ['srcset', 'data-srcset', 'data-lazy-srcset']) srcsetUrls(im.getAttribute(a)).forEach((u) => cands.add(u));
      const pic = im.parentElement && im.parentElement.tagName === 'PICTURE' ? im.parentElement : null;
      if (pic) for (const s of pic.querySelectorAll('source')) for (const a of ['srcset', 'data-srcset']) srcsetUrls(s.getAttribute(a)).forEach((u) => cands.add(u));
      const urls = Array.from(cands).map(abs).filter((u) => u && /^https?:/.test(u));
      if (!urls.length) continue;
      if (im.complete && im.naturalWidth > 0) {
        for (const u of urls) if (!images[u]) images[u] = [im.naturalWidth, im.naturalHeight];
      } else {
        pending.push(urls);
      }
    }
    for (const v of scope.querySelectorAll('video[poster]')) {
      const u = abs(v.getAttribute('poster'));
      if (u && /^https?:/.test(u)) pending.push([u]);
    }
  }
  // 擷取當下還沒載入的圖（lazy）：實際載一次量尺寸，重放時 JRead 把它換上來才有對的大小
  const probe = (u) => new Promise((resolve) => {
    const im = new Image();
    const to = setTimeout(() => resolve(null), 5000);
    im.onload = () => { clearTimeout(to); resolve([im.naturalWidth, im.naturalHeight]); };
    im.onerror = () => { clearTimeout(to); resolve(null); };
    im.src = u;
  });
  const todo = pending.filter((urls) => !urls.some((u) => images[u])).slice(0, 80);
  await Promise.all(todo.map(async (urls) => {
    for (const u of urls.slice(0, 3)) {
      const size = await probe(u);
      if (size && size[0] > 0) { for (const x of urls) if (!images[x]) images[x] = size; return; }
    }
  }));
  for (const urls of pending) {
    const hit = urls.find((u) => images[u]);
    if (hit) for (const u of urls) if (!images[u]) images[u] = images[hit];
  }

  // ---- 只存在 CSSOM 的規則寫回 <style>（styled-components / emotion 的 insertRule）----
  for (const scope of scopes) {
    for (const st of scope.querySelectorAll('style')) {
      try {
        if (!st.textContent.trim() && st.sheet && st.sheet.cssRules.length) {
          st.textContent = Array.from(st.sheet.cssRules).map((r) => r.cssText).join('\n');
        }
      } catch (_) { /* 讀不到就維持原狀 */ }
    }
    let adopted = [];
    try { adopted = Array.from(scope.adoptedStyleSheets || []); } catch (_) { /* */ }
    if (adopted.length) {
      const css = adopted.map((sh) => { try { return Array.from(sh.cssRules).map((r) => r.cssText).join('\n'); } catch (_) { return ''; } }).join('\n');
      if (css.trim()) {
        const st = document.createElement('style');
        st.setAttribute('data-corpus-adopted', '1');
        st.textContent = css;
        (scope === document ? document.head : scope).appendChild(st);
      }
    }
  }
  // ---- 停用 script：改 type、元素留在原位（JSON-LD 等資料型 script 不動）----
  let disabled = 0;
  for (const scope of scopes) {
    for (const s of scope.querySelectorAll('script')) {
      const t = (s.getAttribute('type') || '').trim().toLowerCase();
      if (!t || /javascript|ecmascript|module|babel|jsx/.test(t)) {
        if (t) s.setAttribute('data-corpus-type', t);
        s.setAttribute('type', 'text/x-corpus-disabled');
        disabled++;
      }
    }
    for (const el of scope.querySelectorAll('*')) {
      for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    }
    for (const m of scope.querySelectorAll('meta[http-equiv="refresh" i], meta[http-equiv="content-security-policy" i]')) m.remove();
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const de = document.documentElement;
  const attrs = Array.from(de.attributes).map((a) => ` ${a.name}="${esc(a.value)}"`).join('');
  const inner = typeof de.getHTML === 'function' ? de.getHTML({ shadowRoots: roots }) : de.innerHTML;
  const dt = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '<!DOCTYPE html>';
  return {
    html: `${dt}\n<html${attrs}>${inner}</html>`,
    images,
    stats: {
      scriptsDisabled: disabled, shadowRoots: roots.length,
      imgs: Object.keys(images).length, unprobed: pending.filter((urls) => !urls.some((u) => images[u])).length,
      textLen: document.body ? document.body.innerText.replace(/\s+/g, '').length : 0,
      title: document.title, lang: de.getAttribute('lang') || ''
    }
  };
}

// 重放後：量指紋。只看「使用者實際看得到的」文字區塊與媒體（rendered，不看 display 屬性）
function pageFingerprint() {
  const r0 = (n) => Math.round(n);
  const art = document.querySelector('[data-jread-active]');
  const out = { active: !!art, root: null, title: '', byline: '', text: [], media: [], hidden: 0, docHeight: 0, pages: 0, style: '' };
  const sy = window.scrollY, sx = window.scrollX;
  const desc = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 5; n = n.parentElement) {
      const cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      parts.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cls ? '.' + cls : ''));
    }
    return parts.join(' > ');
  };
  if (art) out.root = desc(art);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const tEl = document.querySelector('[data-jread-injected-title], [data-jread-promoted-title]');
  if (tEl) out.title = norm(tEl.textContent).slice(0, 160);
  out.byline = Array.from(document.querySelectorAll('[data-jread-byline]')).map((e) => norm(e.textContent)).join(' ｜ ').slice(0, 200);
  out.hidden = document.querySelectorAll('[data-jread-hidden]').length;
  const ind = document.getElementById('__jread-page-indicator');
  const pm = ind && /(\d+)\s*\/\s*(\d+)/.exec(ind.textContent || '');
  out.pages = pm ? parseInt(pm[2], 10) : 0;
  const st = document.getElementById('__jread-style');
  if (st) {
    let h = 0;
    const s = st.textContent || '';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    out.style = `${s.length}:${h}`;
  }
  const de = document.documentElement;
  out.docHeight = r0(Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0));

  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, TITLE: 1, META: 1, LINK: 1, OPTION: 1 };
  const MEDIA = { IMG: 1, VIDEO: 1, IFRAME: 1, CANVAS: 1 };
  // JRead 自己的浮動 UI（toast、頁碼、工具列）不算內容
  const isOwnUi = (el) => (el.id && el.id.indexOf('__jread') === 0) || el.hasAttribute('data-jread-toast-id') || el.hasAttribute('data-jread-sel-toolbar');
  const dispCache = new Map();
  const isBlock = (el) => {
    let d = dispCache.get(el);
    if (d === undefined) { d = getComputedStyle(el).display; dispCache.set(el, d); }
    return !/^(inline|inline-block|inline-flex|inline-grid|contents|ruby|ruby-text)$/.test(d);
  };
  const blocks = new Map(); // 區塊元素 → 文字片段
  const order = [];
  const visit = (node, blockEl) => {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      if (!t || !t.trim()) return;
      if (!blocks.has(blockEl)) { blocks.set(blockEl, []); order.push(blockEl); }
      blocks.get(blockEl).push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    if (SKIP[el.tagName] || isOwnUi(el)) return;
    // display:contents 的元素自己沒有框，checkVisibility() 一律回 false，但子孫照樣畫得出來
    // （toss.tech 內文包在 span(display:contents) 裡，整篇內文曾因此不在指紋內、變動抓不到）。
    // 這種元素不做可見性判定、直接往下走，由子孫各自判定。
    const elCs = getComputedStyle(el);
    const isContents = elCs.display === 'contents';
    if (isContents && elCs.visibility !== 'visible') return; // 直屬文字會繼承 visibility
    if (!isContents && typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return;
    if (MEDIA[el.tagName] || el.tagName === 'svg') {
      const r = el.getBoundingClientRect();
      if (r.width >= 40 && r.height >= 40) {
        // 2026-11-24：有 srcset 的圖用 src 屬性當身分、不用 currentSrc——lazy 圖改成直接載入後，
        // 瀏覽器從 srcset 挑哪個候選取決於載入當下的版面寬度（時序相關），同一份 code 重跑
        // 會在 742w / 1440w 之間跳（arstechnica、twz、github.blog）。尺寸照量，實際變大變小仍抓得到
        const hasSet = el.tagName === 'IMG' && (el.hasAttribute('srcset') || (el.parentElement && el.parentElement.tagName === 'PICTURE'));
        let src = (hasSet && el.getAttribute('src')) || el.currentSrc || el.getAttribute('src') || el.getAttribute('poster') || '';
        try {
          const u = new URL(src, document.baseURI);
          let h = 0;
          for (let i = 0; i < u.href.length; i++) h = (h * 31 + u.href.charCodeAt(i)) | 0;
          src = u.pathname.split('/').filter(Boolean).slice(-2).join('/').slice(-60) + (u.search ? '?' + (h >>> 0).toString(36) : '');
        } catch (_) { src = src.slice(-60); }
        out.media.push({ tag: el.tagName.toLowerCase(), src, x: r0(r.left + sx), y: r0(r.top + sy), w: r0(r.width), h: r0(r.height) });
      }
      if (el.tagName !== 'svg') return;
      return;
    }
    const nextBlock = isBlock(el) ? el : blockEl;
    if (el.shadowRoot) for (const c of el.shadowRoot.childNodes) visit(c, nextBlock);
    for (const c of el.childNodes) visit(c, nextBlock);
  };
  if (document.body) visit(document.body, document.body);
  for (const el of order) {
    const full = norm(blocks.get(el).join(' '));
    if (!full) continue;
    // 用 Range 量文字本身的框——區塊元素的框會包含子區塊，同一段文字改包一層就會變
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.text.push({ tag: el.tagName.toLowerCase(), t: full.slice(0, 90), n: full.length, x: r0(r.left + sx), y: r0(r.top + sy), w: r0(r.width), h: r0(r.height) });
  }
  return out;
}

// ============================================================================
// 瀏覽器端流程
// ============================================================================

function loadPlaywright() {
  return require(path.join(PROJECT_ROOT, 'node_modules', 'playwright')).chromium;
}

async function launch(opts) {
  const chromium = loadPlaywright();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jread-corpus-'));
  const exts = (opts.exts || []).join(',');
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: false,
    viewport: opts.viewport || { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    args: [
      ...(exts ? [`--disable-extensions-except=${exts}`, `--load-extension=${exts}`] : []),
      '--no-first-run', '--no-default-browser-check', '--window-position=-2400,-2400', '--headless=new',
      // 2026-11-24（Jimmy 裁定）：重放時關掉瀏覽器原生延遲載入，`loading=lazy` 的圖與 iframe
      // 不必捲到才載——整批並行時 lazy 圖常在量指紋前還沒載到，同一份 code 重跑結果不同
      // （netflix 偶發少圖）。只改瀏覽器行為、不動 DOM：`loading` 屬性照舊，JRead 看到的頁面不變
      ...(opts.eagerLazy ? ['--blink-settings=lazyLoadEnabled=false'] : [])
    ]
  });
  const close = async () => {
    try { await ctx.close(); } catch (_) { /* */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* */ }
  };
  return { ctx, close };
}

async function waitJreadSw(ctx) {
  const isJreadSw = (w) => /\/background\/service-worker\.js$/.test(w.url());
  let sw = ctx.serviceWorkers().find(isJreadSw);
  for (let i = 0; !sw && i < 60; i++) { await sleep(250); sw = ctx.serviceWorkers().find(isJreadSw); }
  if (!sw) throw new Error('JRead service worker 未啟動');
  // 等安裝初始化寫完預設設定，否則接下來寫的 pagedMode 會被蓋掉（見 audit-lib 註解）
  await require(path.join(__dirname, 'audit-lib.js')).waitSettingsInitialized(sw);
  return sw;
}

const archivePath = (id) => path.join(PAGES_DIR, `${id}.json.gz`);
const readArchive = (id) => JSON.parse(zlib.gunzipSync(fs.readFileSync(archivePath(id))).toString('utf8'));
// --only 比對（單一資料源）：片段比對 id；「=<id>」精確比對（原文頁 id 是翻譯後頁 id 的前綴，
// 片段比對會兩頁都中）；2026-11-27 起可用逗號一次指定多個，任一命中即收
const matchOnly = (id, only) => !only || only.split(',').some((o) => (o.startsWith('=') ? id === o.slice(1) : id.includes(o)));
// 指紋檔名 `<id>.<模式>.json` → id
const fileId = (n) => n.replace(/\.[^.]+\.json$/, '');
const listArchiveIds = (only) => (fs.existsSync(PAGES_DIR) ? fs.readdirSync(PAGES_DIR) : [])
  .filter((n) => n.endsWith('.json.gz')).map((n) => n.replace(/\.json\.gz$/, ''))
  .filter((id) => matchOnly(id, only)).sort();

function withTimeout(p, ms, label) {
  let to;
  return Promise.race([
    p,
    new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`${label} 超過 ${Math.round(ms / 1000)} 秒`)), ms); })
  ]).finally(() => clearTimeout(to));
}

// ---- capture ---------------------------------------------------------------
async function captureOne(ctx, url, opts) {
  const audits = require(path.join(__dirname, 'audit-lib.js'));
  const page = await ctx.newPage();
  const css = {};
  const jobs = [];
  page.on('response', (resp) => {
    const req = resp.request();
    if (req.resourceType() !== 'stylesheet' || resp.status() !== 200) return;
    jobs.push((async () => {
      try {
        const body = (await resp.body()).toString('utf8');
        let first = req;
        while (first.redirectedFrom()) first = first.redirectedFrom();
        css[first.url()] = body;
        css[resp.url()] = body;
      } catch (_) { /* 取不到內容（已被回收）就略過 */ }
    })());
  });
  try {
    // --html <檔案>（2026-11-20）：擋 headless 的站（Cloudflare 403）主文件改用 Jimmy 存的
    //「網頁，僅限 HTML」快照，與 debug-harness / page-rounds-harness 的 --html 同一支函式。
    // 快照沒有站方 script 的登入態結果，與真站對不上時以真站為準（cage 驗）
    if (opts.html) await audits.installHtmlSnapshotReplay(page, url, opts.html);
    try { await page.goto(url, { waitUntil: 'load', timeout: 60000 }); }
    catch (_) { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await sleep(2000);
    let translatedEls = null;
    // 翻譯後快照記下實際用的引擎（'gemini' / 'google'…）：Google MT 的譯文有佔位符外漏與
    // 簡體混入，會被誤當成 JRead 的問題；快照是哪個引擎翻的要查得到。原文快照為 null。
    let translateEngine = null;
    if (opts.translate) {
      const lang = await audits.runLangDetect(page);
      if (lang.isChinese) { const e = new Error('中文頁，不需要翻譯後快照'); e.skip = true; throw e; }
      const trReport = {};
      translatedEls = await audits.triggerShinkansenTranslate(page, { log: (m) => console.log('    ' + m), report: trReport });
      translateEngine = trReport.engine || null;
      if (!translatedEls) throw new Error('翻譯沒有生效（翻譯元素數 0）');
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);
    }
    await Promise.all(jobs);
    const finalUrl = page.url();
    const snap = await page.evaluate(pageSerialize);
    if (audits.looksLikeBotChallengeHtml(snap.html)) throw new Error('被 bot 驗證頁擋下');
    if (snap.stats.textLen < 400) throw new Error(`頁面文字只有 ${snap.stats.textLen} 字（空頁或被擋）`);
    return {
      v: 1, url, finalUrl, capturedAt: new Date().toISOString(), translated: !!opts.translate, translatedEls, translateEngine,
      htmlSource: opts.html ? path.relative(PROJECT_ROOT, path.resolve(opts.html)) : null,
      viewport: { width: 1280, height: 900 }, stats: snap.stats, html: snap.html, css, images: snap.images
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function cmdCapture(args) {
  const audits = require(path.join(__dirname, 'audit-lib.js'));
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  let urls;
  if (args.html && !args.url) { console.error('--html 要搭配 --url（快照對應的真站網址）'); return 2; }
  if (args.html && !fs.existsSync(args.html)) { console.error('找不到 HTML 快照：', args.html); return 2; }
  if (args.url) urls = [args.url];
  else {
    urls = parseSitesMd(fs.readFileSync(SITES_MD, 'utf8'));
    if (fs.existsSync(EXTRA_URLS)) urls = urls.concat(fs.readFileSync(EXTRA_URLS, 'utf8').split('\n').map((s) => s.trim()).filter((s) => /^https?:/.test(s)));
  }
  const suffix = args.translate ? '_translated' : '';
  let todo = urls.map((u) => ({ url: u, id: pageId(u, suffix) }));
  if (args.only) todo = todo.filter((t) => matchOnly(t.id, args.only));
  if (!args.force) todo = todo.filter((t) => !fs.existsSync(archivePath(t.id)));
  if (!todo.length) { console.log('沒有要擷取的頁面（都已有快照；要重擷取加 --force）'); return 0; }
  const exts = [];
  if (args.translate) {
    const sk = path.resolve(PROJECT_ROOT, '..', 'Shinkansen', 'shinkansen');
    if (!fs.existsSync(path.join(sk, 'manifest.json'))) { console.error('找不到 Shinkansen extension：', sk); return 2; }
    // 翻譯觸發走 JRead content script 的 __jread_debug bridge，所以 JRead 本體也要載
    //（它在 toggle 之前不動頁面）
    exts.push(path.join(PROJECT_ROOT, 'jread'), audits.resolveShinkansenExtPath(sk));
  }
  console.log(`擷取 ${todo.length} 頁${args.translate ? '（翻譯後）' : ''}，並行 ${args.jobs}`);
  let ok = 0;
  const failed = [];
  let next = 0;
  const worker = async () => {
    const { ctx, close } = await launch({ exts });
    try {
      for (;;) {
        const i = next++;
        if (i >= todo.length) break;
        const t = todo[i];
        try {
          const arc = await withTimeout(captureOne(ctx, t.url, { translate: args.translate, html: args.html }), args.translate ? 240000 : 120000, '擷取');
          fs.writeFileSync(archivePath(t.id), zlib.gzipSync(Buffer.from(JSON.stringify(arc))));
          ok++;
          const kb = Math.round(fs.statSync(archivePath(t.id)).size / 1024);
          console.log(`[${i + 1}/${todo.length}] ✅ ${t.id}（${kb}K，圖 ${arc.stats.imgs}，CSS ${Object.keys(arc.css).length}）`);
        } catch (e) {
          if (e && e.skip) { console.log(`[${i + 1}/${todo.length}] － ${t.id}：${e.message}`); continue; }
          failed.push({ id: t.id, url: t.url, err: String(e.message || e).split('\n')[0] });
          console.log(`[${i + 1}/${todo.length}] ⛔ ${t.id}：${String(e.message || e).split('\n')[0]}`);
        }
      }
    } finally { await close(); }
  };
  await Promise.all(Array.from({ length: Math.min(args.jobs, todo.length) }, worker));
  console.log(`\n擷取完成：成功 ${ok}、失敗 ${failed.length}`);
  for (const f of failed) console.log(`  ⛔ ${f.url} — ${f.err}`);
  if (ok) console.log('新快照還沒有基準：跑 `node tools/corpus.js check` 看結果，確認後 `accept`');
  return failed.length ? 1 : 0;
}

// ---- run（重放 + 指紋）------------------------------------------------------
function svgPlaceholder(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#c8ccd0"/></svg>`;
}

async function replayOne(ctx, sw, state, id, variant, waitMs, shotDir) {
  const arc = readArchive(id);
  const target = arc.finalUrl.split('#')[0];
  const net = { imgMiss: 0, aborted: 0 };
  state.current = { arc, target, net };
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 160)));
  try {
    await page.setViewportSize(variant.viewport);
    // --set key=value：普查 / 重放時另外寫入的設定（例：使用者字級 fontSize=20），蓋過模式預設
    await sw.evaluate((s) => Promise.all([chrome.storage.sync.set(s), chrome.storage.local.remove('readingPositions')]), { ...variant.settings, ...(state.extraSettings || {}) });
    await page.goto(arc.finalUrl, { waitUntil: 'load', timeout: 30000 });
    await sleep(700);
    const tabId = await sw.evaluate(async (u) => {
      const ts = await chrome.tabs.query({});
      return (ts.find((t) => (t.url || '').split('#')[0] === u) || {}).id;
    }, target);
    if (!tabId) throw new Error('找不到分頁');
    let toggled = null;
    for (let i = 0; i < 6; i++) {
      toggled = await sw.evaluate(async (tid) => {
        try { return { ok: true, res: await chrome.tabs.sendMessage(tid, { type: 'TOGGLE_READER_MODE' }) }; }
        catch (e) { return { ok: false, err: e.message }; }
      }, tabId);
      if (toggled.ok) break;
      await sleep(400); // content script 還沒就緒
    }
    if (!toggled.ok) throw new Error('閱讀模式觸發失敗：' + toggled.err);
    await sleep(waitMs);
    // 等畫面穩定：連兩次（間隔 800ms）量到相同的文字與媒體才算數，最多多等 4 次。
    // 晚到的 load 事件會觸發補跑的 pass（netflix 實測：432 次裡 1 次量到中間狀態）
    let fp = await page.evaluate(pageFingerprint);
    const sig = (f) => JSON.stringify([f.active, f.root, f.text, f.media, f.pages]);
    for (let i = 0; i < 4; i++) {
      await sleep(800);
      const again = await page.evaluate(pageFingerprint);
      const stable = sig(again) === sig(fp);
      fp = again;
      if (stable) break;
      if (i === 3) fp.unsettled = true;
    }
    fp.net = net;
    fp.pageErrors = errors.length;
    // --after <module.js>：量完指紋後跑自訂的頁內量測，結果記在指紋的 after 欄位。
    // 用途是普查——新規則動 code 之前，先看它在整個語料庫會命中哪些頁面的什麼元素。
    // module.exports = async (page) => 任何可序列化的結果
    if (state.afterModule) {
      try { fp.after = await require(state.afterModule)(page); } catch (e) { fp.after = { error: String(e && e.message || e) }; }
    }
    if (shotDir) {
      // 看差異用的截圖：先量完指紋再縮放（zoom 會把 rect 砍半）。捲動模式 zoom 0.5 分頁拍、
      // 翻頁模式 zoom 1.0 逐頁翻（專案截圖規則，實作在 audit-lib）
      const audits = require(path.join(__dirname, 'audit-lib.js'));
      fs.rmSync(shotDir, { recursive: true, force: true });
      fs.mkdirSync(shotDir, { recursive: true });
      // 2026-11-23：--shots N|all（前段拍幾屏／頁）＋ --tail N（另拍最後幾屏／頁，預設 4）——
      // 長文的文末原本完全沒拍到（KNOWN-ISSUES 2026-11-18 審查範圍註記）
      const sh = state.shotOpts || {};
      const tail = sh.tail === undefined ? 4 : sh.tail;
      if (variant.settings.pagedMode) await audits.takePageFlipScreenshots(page, { dir: shotDir, prefix: 'page', maxPages: sh.shots || 40, tailPages: tail });
      else {
        // 2026-11-19：縮放後補發 resize——html 固定高的站（note.com）尺寸監看不會觸發，段落焦點條停在縮放前的座標、截圖裡看起來離卡片很遠
        await page.evaluate(() => { document.body.style.zoom = '0.5'; window.dispatchEvent(new Event('resize')); });
        await sleep(300);
        await audits.takePagedScreenshots(page, { dir: shotDir, prefix: 'page', maxPages: sh.shots || 12, tailPages: tail });
      }
    }
    return fp;
  } finally {
    state.current = null;
    await page.close().catch(() => {});
  }
}

async function installReplayRoutes(ctx, state) {
  await ctx.route(/^https?:\/\//, (route) => {
    const cur = state.current;
    const req = route.request();
    if (process.env.CORPUS_LIVE === '1') return route.fallback();
    if (!cur) return route.abort();
    const url = req.url();
    const type = req.resourceType();
    if (type === 'document') {
      if (url.split('#')[0] === cur.target) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: cur.arc.html });
      }
      return route.abort(); // iframe 等其他文件
    }
    if (cur.arc.css[url] !== undefined) return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: cur.arc.css[url] });
    const size = cur.arc.images[url];
    if (size) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svgPlaceholder(size[0], size[1]) });
    if (type === 'image') {
      cur.net.imgMiss++;
      if (process.env.CORPUS_DEBUG === '1') console.log('    imgMiss:', url.slice(0, 140));
    }
    cur.net.aborted++;
    return route.abort();
  });
}

async function cmdRun(args, outDir, shotRoot, onlyFiles) {
  const ids = listArchiveIds(args.only);
  if (!ids.length) {
    console.error(args.only ? `沒有 id 含「${args.only}」的頁面（node tools/corpus.js list 可看全部）` : `語料庫是空的（${PAGES_DIR}）：先跑 capture`);
    return 2;
  }
  const ext = path.resolve(args.ext || path.join(PROJECT_ROOT, 'jread'));
  if (!fs.existsSync(path.join(ext, 'manifest.json'))) { console.error('找不到 extension：', ext); return 2; }
  const variants = args.variants.map((v) => {
    if (!VARIANTS[v]) throw new Error(`未知的 variant：${v}（可用：${Object.keys(VARIANTS).join(', ')}）`);
    return { name: v, ...VARIANTS[v] };
  });
  fs.mkdirSync(outDir, { recursive: true });
  // 清掉上一次的結果（--only 時只清符合的那幾頁，其他模式留下的舊檔也一併清，免得混進這次的比對）
  if (!onlyFiles) for (const f of fs.readdirSync(outDir)) if (f.endsWith('.json') && matchOnly(fileId(f), args.only)) fs.rmSync(path.join(outDir, f));
  const version = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version;
  let tasks = [];
  for (const id of ids) for (const v of variants) tasks.push({ id, v });
  if (onlyFiles) tasks = tasks.filter((t) => onlyFiles.has(`${t.id}.${t.v.name}.json`));
  console.log(onlyFiles ? `確認輪：重跑有差異的 ${tasks.length} 份` : `重放 ${ids.length} 頁 × ${variants.length} 種模式（${variants.map((v) => v.name).join(', ')}），JRead v${version}，並行 ${args.jobs}`);
  const t0 = Date.now();
  let next = 0, done = 0;
  const retried = [];
  const worker = async () => {
    let session = null;
    const open = async () => {
      const l = await launch({ exts: [ext], eagerLazy: true });
      const state = { current: null, afterModule: args.after ? path.resolve(args.after) : null, extraSettings: args.set, shotOpts: { shots: args.shots, tail: args.tail } };
      await installReplayRoutes(l.ctx, state);
      const sw = await waitJreadSw(l.ctx);
      for (const p of l.ctx.pages()) await p.close().catch(() => {});
      return { ...l, state, sw };
    };
    try {
      for (;;) {
        const i = next++;
        if (i >= tasks.length) break;
        const { id, v } = tasks[i];
        let fp;
        // 出錯、或該模式的前提沒成立（翻頁模式卻沒有頁數——根因是設定被安裝初始化蓋掉，
        // 已由 waitSettingsInitialized 解決，這裡留作保險）時，
        // 換一個全新的瀏覽器重試一次。重試不靜默：次數記在指紋的 retried、結尾統一列出
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (!session) session = await open();
            fp = await withTimeout(replayOne(session.ctx, session.sw, session.state, id, v, args.wait, shotRoot ? path.join(shotRoot, `${id}.${v.name}`) : null), shotRoot ? 180000 : 60000, '重放');
            if (v.settings.pagedMode && fp.active && !fp.pages) throw new Error('翻頁模式沒有生效（頁數 0）');
            if (attempt) fp.retried = attempt;
            break;
          } catch (e) {
            fp = { error: String(e.message || e).split('\n')[0] };
            // 出錯的瀏覽器不再重用（卡住的頁面可能拖累後面的頁）
            if (session) { await session.close(); session = null; }
            if (attempt === 0) retried.push(`${id}.${v.name}：${fp.error}`);
          }
        }
        fp.id = id; fp.variant = v.name;
        try { fp.url = readArchive(id).url; } catch (_) { /* */ }
        fs.writeFileSync(path.join(outDir, `${id}.${v.name}.json`), JSON.stringify(fp, null, 1));
        done++;
        console.log(`[${done}/${tasks.length}] ${fp.error ? '⛔' : (fp.active ? '·' : '○')} ${id}.${v.name}${fp.error ? '：' + fp.error : (fp.active ? '' : '（閱讀模式沒進）')}`);
      }
    } finally { if (session) await session.close(); }
  };
  await Promise.all(Array.from({ length: Math.min(args.jobs, tasks.length) }, worker));
  console.log(`重放完成：${tasks.length} 份指紋，${Math.round((Date.now() - t0) / 1000)} 秒 → ${outDir}`);
  if (retried.length) {
    console.log(`⚠️ 有 ${retried.length} 份第一次沒成功、重試過（偶發可忽略；同一頁每次都出現就要查）：`);
    for (const r of retried) console.log(`   ${r}`);
  }
  return 0;
}

// ============================================================================
// CLI
// ============================================================================
function parseArgs(argv) {
  const get = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
  return {
    cmd: argv[0],
    positional: argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && /^--(url|html|only|jobs|wait|ext|out|variants|after|set|shots|tail)$/.test(arr[i - 1]))),
    url: get('--url', null), html: get('--html', null), after: get('--after', null), only: get('--only', null), ext: get('--ext', null), out: get('--out', null),
    jobs: Math.max(1, parseInt(get('--jobs', '4'), 10) || 4),
    wait: parseInt(get('--wait', '4500'), 10) || 4500,
    variants: get('--variants', 'scroll').split(',').map((s) => s.trim()).filter(Boolean),
    shots: get('--shots', null) === 'all' ? Infinity : (parseInt(get('--shots', ''), 10) || null),
    tail: get('--tail', null) === null ? undefined : Math.max(0, parseInt(get('--tail', '0'), 10) || 0),
    force: argv.includes('--force'), translate: argv.includes('--translate'),
    set: argv.reduce((acc, a, i) => { if (a === '--set' && argv[i + 1]) { const [k, ...v] = argv[i + 1].split('='); let val = v.join('='); try { val = JSON.parse(val); } catch (_) { /* 字串 */ } acc[k] = val; } return acc; }, {})
  };
}

function styleChangedAcross(baseDir, curDir) {
  try {
    for (const f of fs.readdirSync(curDir).filter((n) => n.endsWith('.json'))) {
      const bp = path.join(baseDir, f);
      if (!fs.existsSync(bp)) continue;
      if (JSON.parse(fs.readFileSync(bp, 'utf8')).style !== JSON.parse(fs.readFileSync(path.join(curDir, f), 'utf8')).style) return true;
    }
  } catch (_) { /* */ }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const watchdog = require(path.join(__dirname, 'watchdog.js'));
  switch (args.cmd) {
    case 'capture':
      watchdog.install({ name: 'corpus capture', limitSec: 3600 });
      return cmdCapture(args);
    case 'run': {
      if (!args.out) { console.error('run 需要 --out <目錄>'); return 2; }
      watchdog.install({ name: 'corpus run', limitSec: 2400 });
      return cmdRun(args, path.resolve(args.out));
    }
    case 'check': {
      watchdog.install({ name: 'corpus check', limitSec: 2400 });
      const rc = await cmdRun(args, CURRENT_DIR);
      if (rc) return rc;
      let result = compareDirs(BASELINE_DIR, CURRENT_DIR, args.only);
      // 確認輪：有差異的頁面再跑一次。重跑後與基準相同＝偶發（時序），採用重跑的結果、
      // 另外列出，不算差異。真的改動兩次都會出現，不受影響
      const suspects = result.rows.filter((r) => ['broken', 'content', 'layout'].includes(r.level)).map((r) => r.file);
      const flaky = [];
      if (suspects.length) {
        const confirmDir = path.join(RUN_ROOT, 'confirm');
        fs.rmSync(confirmDir, { recursive: true, force: true });
        await cmdRun(args, confirmDir, null, new Set(suspects));
        for (const f of suspects) {
          const cp = path.join(confirmDir, f), bp = path.join(BASELINE_DIR, f);
          if (!fs.existsSync(cp) || !fs.existsSync(bp)) continue;
          const d = diffFingerprint(JSON.parse(fs.readFileSync(bp, 'utf8')), JSON.parse(fs.readFileSync(cp, 'utf8')));
          if (d.level === 'same') { fs.copyFileSync(cp, path.join(CURRENT_DIR, f)); flaky.push(f.replace(/\.json$/, '')); }
        }
        if (flaky.length) result = compareDirs(BASELINE_DIR, CURRENT_DIR, args.only);
      }
      let report = formatReport(result, { styleChanged: styleChangedAcross(BASELINE_DIR, CURRENT_DIR) });
      if (flaky.length) report += `\n偶發（第一次有差異、重跑後與基準相同，不計入）：${flaky.join(', ')}`;
      console.log(report);
      fs.writeFileSync(path.join(RUN_ROOT, 'report.txt'), report);
      const c = result.counts;
      return (c.broken || c.content || c.layout || c.new) ? 1 : 0;
    }
    case 'shot': {
      // 看某幾頁現在長怎樣（triage 差異時用）：重放 + 截圖，不動基準也不動 current
      if (!args.only) { console.error('shot 需要 --only <id 片段>（一次只看幾頁）'); return 2; }
      watchdog.install({ name: 'corpus shot', limitSec: 3600 }); // 2026-11-23：未巡範圍審查一批要拍數十頁 × 三模式
      const shotRoot = path.join(RUN_ROOT, 'shots');
      const rc = await cmdRun(args, path.join(shotRoot, '_fp'), shotRoot);
      console.log(`截圖在 ${shotRoot}/<id>.<模式>/`);
      return rc;
    }
    case 'accept': {
      if (!fs.existsSync(CURRENT_DIR)) { console.error('還沒有這次的結果：先跑 check'); return 2; }
      fs.mkdirSync(BASELINE_DIR, { recursive: true });
      const all = fs.readdirSync(CURRENT_DIR).filter((n) => n.endsWith('.json') && !/\s/.test(n) && matchOnly(fileId(n), args.only));
      const bad = all.filter((f) => JSON.parse(fs.readFileSync(path.join(CURRENT_DIR, f), 'utf8')).error);
      const files = all.filter((f) => !bad.includes(f));
      for (const f of files) fs.copyFileSync(path.join(CURRENT_DIR, f), path.join(BASELINE_DIR, f));
      if (bad.length) console.log(`⚠️ ${bad.length} 份是重放出錯的結果，沒有收進基準：${bad.join(', ')}`);
      // 語料庫已不存在的頁面，基準一併移除（只在全量 accept 時）
      if (!args.only) {
        const ids = new Set(listArchiveIds());
        for (const f of fs.readdirSync(BASELINE_DIR)) if (f.endsWith('.json') && !ids.has(f.split('.').slice(0, -2).join('.'))) fs.rmSync(path.join(BASELINE_DIR, f));
      }
      console.log(`已收為基準：${files.length} 份指紋 → ${BASELINE_DIR}`);
      return 0;
    }
    case 'compare': {
      const [a, b] = args.positional;
      if (!a || !b) { console.error('用法：compare <基準目錄> <比較目錄>'); return 2; }
      const result = compareDirs(path.resolve(a), path.resolve(b), args.only);
      console.log(formatReport(result, { styleChanged: styleChangedAcross(path.resolve(a), path.resolve(b)) }));
      const c = result.counts;
      return (c.broken || c.content || c.layout || c.new) ? 1 : 0;
    }
    case 'list': {
      const ids = listArchiveIds(args.only);
      let total = 0;
      for (const id of ids) {
        const size = fs.statSync(archivePath(id)).size;
        total += size;
        const a = readArchive(id);
        console.log(`${id}  ${Math.round(size / 1024)}K  ${a.capturedAt.slice(0, 10)}${a.translated ? `  翻譯後（${a.translateEngine || '引擎未記'}）` : ''}${a.htmlSource ? `  HTML 快照（${a.htmlSource}）` : ''}  ${a.url}`);
      }
      console.log(`共 ${ids.length} 頁，${(total / 1048576).toFixed(1)}M`);
      return 0;
    }
    default:
      console.error('用法：node tools/corpus.js <capture|check|accept|shot|run|compare|list> [選項]（詳見檔頭註解）');
      return 2;
  }
}

module.exports = { pageId, parseArgs, parseSitesMd, lcsPairs, diffFingerprint, compareDirs, formatReport, pageFingerprint, pageSerialize, VARIANTS };

if (require.main === module) {
  main().then((rc) => process.exit(rc || 0)).catch((e) => { console.error('ERR:', e && e.stack || e); process.exit(1); });
}
