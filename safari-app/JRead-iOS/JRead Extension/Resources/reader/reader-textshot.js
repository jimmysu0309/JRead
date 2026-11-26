// JRead — Textshot：把重點做成文字圖卡（v3.6.0，Jimmy 2026-11-26，參考 Readwise Reader 的 textshot）
// -----------------------------------------------------------------------------
// 已定（Jimmy 2026-11-26）：一律左右對齊；不分日夜模式；第一版兩種樣式（白底＋漸層字、漸層底＋白字）；
// 卡片底部放「JRead」字樣；按鈕用中文（「儲存圖片」「分享」）
//
// 架構：閱讀頁（article.html）點重點 →「圖卡」→ 在 <html> 直下掛全螢幕 iframe 開 reader/textshot.html，
// 由這支在 iframe 裡畫 UI 與 canvas。用 iframe 隔開：鍵盤、點擊、觸控都留在 iframe 文件裡，閱讀頁的
// 快速鍵（H 畫重點、E 封存、方向鍵翻頁、keyguard）、沉浸閱讀、styler 都碰不到它，content script 不必
// 為它開讓位的口。資料由父頁同源直接呼叫 iframe 裡的 __JReadTextshot.mount(data)。
//
// 圖是自己在 canvas 上排版畫的，不用「HTML 轉圖片」：WebKit 把含 foreignObject 的 SVG 畫進 canvas 後
// canvas 會被汙染、toBlob 失敗。斷行（中文逐字、拉丁逐詞、避頭尾標點懸掛）與左右對齊都在這裡算，
// 純函式（tokenize / layoutLines / justifyLine / fitQuote）供 jsdom spec 直接測。
// -----------------------------------------------------------------------------
(function (global) {
  'use strict';

  // 圖的像素尺寸（CSS 預覽縮小顯示，輸出用原尺寸）
  const RATIOS = {
    landscape: { w: 1600, h: 900, label: '橫式' },
    portrait: { w: 1080, h: 1350, label: '直式' },
    square: { w: 1080, h: 1080, label: '方形' }
  };
  const FONTS = {
    sans: { stack: '-apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif', label: '黑體' },
    serif: { stack: '"Songti TC", "Noto Serif TC", "Source Han Serif TC", "PMingLiU", Georgia, serif', label: '明體' }
  };
  // 兩種樣式。bg / quote 給 canvas 用的描述（漸層方向以圖寬高的比例表示），swatch 給選擇鈕的 CSS
  const STYLES = {
    gradientText: {
      label: '漸層字',
      bg: { type: 'solid', color: '#ffffff' },
      quote: { type: 'gradient', from: [0, 0], to: [1, 1], stops: [[0, '#e2703a'], [0.55, '#c13584'], [1, '#8a2be2']] },
      meta: '#6b7280',
      brand: '#9ca3af',
      swatch: 'linear-gradient(135deg, #e2703a, #c13584 55%, #8a2be2)'
    },
    gradientBg: {
      label: '漸層底',
      bg: { type: 'gradient', from: [0, 1], to: [1, 0], stops: [[0, '#93402a'], [0.5, '#5b3a63'], [1, '#33478f']] },
      quote: { type: 'solid', color: '#ffffff' },
      meta: 'rgba(255, 255, 255, 0.72)',
      brand: 'rgba(255, 255, 255, 0.55)',
      swatch: 'linear-gradient(45deg, #93402a, #5b3a63 50%, #33478f)'
    }
  };
  const DEFAULT_PREFS = { style: 'gradientText', font: 'sans', ratio: 'square' };
  const PREFS_KEY = 'jread-textshot-prefs';
  const BRAND = 'JRead';

  // ---- 斷行與對齊（純函式）----------------------------------------------------
  // 行首禁用（懸掛在上一行行尾）與行尾禁用（帶到下一行）
  const NO_START = '，。、；：？！）」』】》〉〕｝’”…‥・—～%,.;:?!)]}\'"';
  const NO_END = '（「『【《〈〔｛‘“([{';
  const isLatinChar = (c) => /[A-Za-z0-9À-ɏ'’\-_.@#&/:%+]/.test(c);

  // 文字 → token：連續拉丁（含數字與英文標點）成一詞、空白各自一個、其他字元（中日文、全形標點）逐字
  function tokenize(text) {
    const s = String(text || '').replace(/\r\n?/g, '\n').replace(/[\t\f\v]/g, ' ');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\n') { out.push({ t: '\n', kind: 'br' }); i++; continue; }
      if (c === ' ' || c === ' ' || c === '　') {
        let j = i;
        while (j < s.length && (s[j] === ' ' || s[j] === ' ' || s[j] === '　')) j++;
        out.push({ t: ' ', kind: 'space' });
        i = j;
        continue;
      }
      if (isLatinChar(c)) {
        let j = i;
        while (j < s.length && isLatinChar(s[j])) j++;
        out.push({ t: s.slice(i, j), kind: 'word' });
        i = j;
        continue;
      }
      // surrogate pair（emoji、擴充區漢字）不拆
      const cp = s.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      out.push({ t: ch, kind: 'char' });
      i += ch.length;
    }
    return out;
  }

  // token → 行。measure(str) 回寬度。每行 { items: [{t, w, kind}], hang: 懸掛標點寬, last: 段落最後一行 }。
  // 規則：放不下就換行；行首禁用標點連同上一行最後一字帶到下一行（只剩一字才懸掛）；行尾禁用標點帶到下一行；
  // 行首行尾的空白丟掉；單一拉丁詞比整行還寬就逐字拆
  function layoutLines(tokens, measure, maxWidth) {
    const lines = [];
    let cur = [];
    let width = 0;
    const push = (last) => {
      while (cur.length && cur[cur.length - 1].kind === 'space') { width -= cur[cur.length - 1].w; cur.pop(); }
      lines.push({ items: cur, width, hang: 0, last: !!last });
      cur = [];
      width = 0;
    };
    const queue = tokens.map((x) => Object.assign({}, x));
    for (let k = 0; k < queue.length; k++) {
      const tok = queue[k];
      if (tok.kind === 'br') { push(true); continue; }
      if (tok.kind === 'space' && !cur.length) continue;
      const w = measure(tok.t);
      if (width + w <= maxWidth + 0.01 || !cur.length) {
        if (tok.kind === 'word' && !cur.length && w > maxWidth && tok.t.length > 1) {
          // 超長詞逐字拆：把字元放回佇列
          const chars = Array.from(tok.t).map((c) => ({ t: c, kind: 'word' }));
          queue.splice(k, 1, ...chars);
          k--;
          continue;
        }
        cur.push({ t: tok.t, w, kind: tok.kind });
        width += w;
        continue;
      }
      // 放不下
      if (tok.kind === 'space') { push(false); continue; }
      // 行首禁用標點：把這一行最後一個字一起帶到下一行（不懸掛——Jimmy 要求圖卡一律左右對齊，標點掛出版心
      // 右緣會參差）。這一行只剩一個字時才退而懸掛
      const carry = [];
      if (tok.t.length === 1 && NO_START.indexOf(tok.t) !== -1) {
        if (cur.length > 1 && cur[cur.length - 1].kind !== 'space') {
          const x = cur.pop();
          width -= x.w;
          carry.push(x);
        } else {
          cur.push({ t: tok.t, w, kind: tok.kind });
          width += w;
          lines.push({ items: cur, width, hang: w, last: false });
          cur = [];
          width = 0;
          continue;
        }
      }
      // 行尾禁用標點帶到下一行（整行只剩它就不帶）
      while (cur.length > 1 && cur[cur.length - 1].t.length === 1 && NO_END.indexOf(cur[cur.length - 1].t) !== -1) {
        const x = cur.pop();
        width -= x.w;
        carry.unshift(x);
      }
      push(false);
      for (const x of carry) { cur.push(x); width += x.w; }
      if (tok.kind === 'word' && w > maxWidth && tok.t.length > 1 && !cur.length) {
        const chars = Array.from(tok.t).map((c) => ({ t: c, kind: 'word' }));
        queue.splice(k, 1, ...chars);
        k--;
        continue;
      }
      cur.push({ t: tok.t, w, kind: tok.kind });
      width += w;
    }
    if (cur.length) push(true);
    else if (lines.length) lines[lines.length - 1].last = true;
    return lines;
  }

  // 一行的每個 token x 座標（相對行首）。非段落末行：把 maxWidth − 內容寬（懸掛標點不算）分給「伸縮點」——
  // 英文單字之間的空白權重 SPACE_WEIGHT、其他 token 之間（中文字之間、中英交界）權重 1；貼著空白的那兩個
  // 交界不另外撐（空白自己會撐）。只按 token 數平均分的話，夾英文單字的行中文字距會被拉得很鬆（Playwright
  // 截圖：「有 足 夠 的 內 容 。The quick」）。段落末行靠左不撐開
  const SPACE_WEIGHT = 3;
  function justifyLine(line, maxWidth) {
    const items = line.items;
    const xs = [];
    const n = items.length;
    const contentW = line.width - (line.hang || 0);
    const last = n - 1 - (line.hang ? 1 : 0);   // 撐開只算到懸掛標點之前那個 token
    const gapW = (i) => (items[i].kind === 'space' || items[i + 1].kind === 'space') ? 0 : 1;
    let total = 0;
    if (!line.last) {
      for (let i = 0; i < last; i++) {
        total += gapW(i);
        if (items[i].kind === 'space') total += SPACE_WEIGHT;
      }
    }
    const unit = total > 0 ? Math.max(0, maxWidth - contentW) / total : 0;
    let x = 0;
    for (let i = 0; i < n; i++) {
      xs.push(x);
      x += items[i].w;
      if (i < last && unit) x += unit * (gapW(i) + (items[i].kind === 'space' ? SPACE_WEIGHT : 0));
    }
    return xs;
  }

  // 找放得下的最大字級。measureAt(size) 回該字級的 measure 函式。從 maxSize 往下縮到 minSize；
  // 最小字級仍放不下就截斷：保留放得下的行數、最後一行尾端換成「…」
  function fitQuote(text, measureAt, box, opt) {
    const o = opt || {};
    const maxSize = o.maxSize || 60;
    const minSize = o.minSize || 28;
    const lh = o.lineHeight || 1.55;
    const tokens = tokenize(text);
    let size = maxSize;
    for (;;) {
      const m = measureAt(size);
      const lines = layoutLines(tokens, m, box.w);
      if (lines.length * size * lh <= box.h + 0.5) return { size, lines, truncated: false, lineHeight: size * lh };
      if (size <= minSize) break;
      size = Math.max(minSize, Math.floor(size * 0.93));
    }
    const m = measureAt(minSize);
    const lines = layoutLines(tokens, m, box.w);
    const keep = Math.max(1, Math.floor((box.h + 0.5) / (minSize * lh)));
    const kept = lines.slice(0, keep);
    const tail = kept[kept.length - 1];
    if (tail) {
      const ell = { t: '…', w: m('…'), kind: 'char' };
      while (tail.items.length && tail.width - (tail.hang || 0) + ell.w > box.w) {
        const x = tail.items.pop();
        tail.width -= x.w;
        tail.hang = 0;
      }
      while (tail.items.length && tail.items[tail.items.length - 1].kind === 'space') tail.width -= tail.items.pop().w;
      tail.items.push(ell);
      tail.width += ell.w;
      tail.hang = 0;
      tail.last = true;
    }
    return { size: minSize, lines: kept, truncated: true, lineHeight: minSize * lh };
  }

  // 單行文字超寬就截斷加「…」
  function ellipsize(text, measure, maxWidth) {
    const s = String(text || '');
    if (measure(s) <= maxWidth) return s;
    const chars = Array.from(s);
    while (chars.length && measure(chars.join('') + '…') > maxWidth) chars.pop();
    return chars.join('').replace(/\s+$/, '') + '…';
  }

  // ---- 畫圖 --------------------------------------------------------------------
  function paintFill(ctx, spec, x, y, w, h) {
    if (spec.type === 'solid') return spec.color;
    const g = ctx.createLinearGradient(x + spec.from[0] * w, y + spec.from[1] * h, x + spec.to[0] * w, y + spec.to[1] * h);
    for (const [at, c] of spec.stops) g.addColorStop(at, c);
    return g;
  }

  // 在 canvas 上畫一張圖卡。opts：{ text, title, byline, style, font, ratio }。回排版結果（spec 用）
  function render(canvas, opts) {
    const R = RATIOS[opts.ratio] || RATIOS.square;
    const S = STYLES[opts.style] || STYLES.gradientText;
    const F = FONTS[opts.font] || FONTS.sans;
    canvas.width = R.w;
    canvas.height = R.h;
    const ctx = canvas.getContext('2d');
    const W = R.w;
    const H = R.h;
    const base = Math.min(W, H);
    const pad = Math.round(base * 0.085);
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = paintFill(ctx, S.bg, 0, 0, W, H);
    ctx.fillRect(0, 0, W, H);

    const metaSize = Math.round(base * 0.03);
    const font = (size, weight) => (weight || 400) + ' ' + size + 'px ' + F.stack;
    const measurer = (f) => { ctx.font = f; return (s) => ctx.measureText(s).width; };
    const innerW = W - pad * 2;

    // 上方：文章標題（一行，超寬截斷）
    let top = pad;
    if (opts.title) {
      const m = measurer(font(metaSize, 500));
      ctx.fillStyle = S.meta;
      ctx.fillText(ellipsize(opts.title, m, innerW), pad, top + metaSize);
      top += metaSize * 1.4;
    }
    // 下方：作者 / 網站（左）＋ JRead（右）
    const bottom = H - pad;
    const brandSize = Math.round(metaSize * 0.9);
    const mb = measurer(font(brandSize, 700));
    const brandW = mb(BRAND);
    ctx.fillStyle = S.brand;
    ctx.fillText(BRAND, W - pad - brandW, bottom);
    if (opts.byline) {
      const m = measurer(font(metaSize, 400));
      ctx.fillStyle = S.meta;
      ctx.fillText(ellipsize(opts.byline, m, innerW - brandW - metaSize * 2), pad, bottom);
    }
    const footTop = bottom - metaSize * 1.2;

    // 中間：重點（左右對齊、垂直置中）
    const gap = Math.round(base * 0.06);
    const box = { x: pad, y: top + gap, w: innerW, h: Math.max(10, footTop - gap - (top + gap)) };
    const fit = fitQuote(opts.text, (size) => measurer(font(size, 600)), box,
      { maxSize: Math.round(base * 0.05), minSize: Math.round(base * 0.03), lineHeight: 1.55 });
    ctx.font = font(fit.size, 600);
    const blockH = fit.lines.length * fit.lineHeight;
    const y0 = box.y + Math.max(0, (box.h - blockH) / 2);
    ctx.fillStyle = paintFill(ctx, S.quote, box.x, y0, box.w, blockH);
    fit.lines.forEach((line, i) => {
      const xs = justifyLine(line, box.w);
      // 基線：行高中間偏下（字身約 0.8em 在基線上）
      const by = y0 + i * fit.lineHeight + (fit.lineHeight + fit.size * 0.72) / 2;
      line.items.forEach((it, k) => { if (it.kind !== 'space') ctx.fillText(it.t, box.x + xs[k], by); });
    });
    return { fit, box, W, H };
  }

  // ---- 偏好（這台裝置記住上次選的樣式 / 字體 / 比例）---------------------------
  function loadPrefs(store) {
    try {
      const raw = store && store.getItem(PREFS_KEY);
      const p = raw ? JSON.parse(raw) : {};
      return {
        style: STYLES[p.style] ? p.style : DEFAULT_PREFS.style,
        font: FONTS[p.font] ? p.font : DEFAULT_PREFS.font,
        ratio: RATIOS[p.ratio] ? p.ratio : DEFAULT_PREFS.ratio
      };
    } catch (_) { return Object.assign({}, DEFAULT_PREFS); }
  }
  function savePrefs(store, p) {
    try { if (store) store.setItem(PREFS_KEY, JSON.stringify(p)); } catch (_) { /* 私密模式 */ }
  }

  function fileName(title, index) {
    const base = String(title || 'JRead').replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 40) || 'JRead';
    return base + ' 圖卡' + (index > 0 ? ' ' + (index + 1) : '') + '.png';
  }

  // ---- UI（在 textshot.html 這個 iframe 文件裡）----------------------------------
  // data：{ items: [{ text }], index, title, byline, onClose(), saveImage?(blob, name), shareImage?(blob, name) }
  // saveImage / shareImage 由父頁依環境給（App 走原生、網頁 / 擴充走下載與系統分享）；沒給用預設
  function mount(data, deps) {
    const d = deps || {};
    const doc = d.document || global.document;
    const win = d.window || global;
    const store = d.storage !== undefined ? d.storage : (() => { try { return win.localStorage; } catch (_) { return null; } })();
    const items = (data.items || []).filter((x) => x && String(x.text || '').trim());
    if (!items.length) { if (data.onClose) data.onClose(); return null; }
    let index = Math.max(0, Math.min(items.length - 1, data.index | 0));
    const prefs = loadPrefs(store);
    const $ = (sel) => doc.querySelector(sel);
    const canvas = $('#ts-canvas');
    const nameEl = $('#ts-name');
    const status = $('#ts-status');
    let busy = false;

    const setStatus = (msg) => {
      if (!status) return;
      status.textContent = msg || '';
      status.classList.toggle('show', !!msg);
      if (msg) win.setTimeout(() => { if (status.textContent === msg) status.classList.remove('show'); }, 2200);
    };
    const draw = () => {
      render(canvas, { text: items[index].text, title: data.title, byline: data.byline, style: prefs.style, font: prefs.font, ratio: prefs.ratio });
      if (nameEl) nameEl.textContent = STYLES[prefs.style].label;
      const counter = $('#ts-count');
      if (counter) counter.textContent = items.length > 1 ? (index + 1) + ' / ' + items.length : '';
      for (const b of doc.querySelectorAll('[data-style]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-style') === prefs.style));
      for (const b of doc.querySelectorAll('[data-font]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-font') === prefs.font));
      for (const b of doc.querySelectorAll('[data-ratio]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-ratio') === prefs.ratio));
      const prev = $('#ts-prev');
      const next = $('#ts-next');
      if (prev) prev.disabled = index <= 0;
      if (next) next.disabled = index >= items.length - 1;
      fitCanvas();
    };
    // 預覽：canvas 依舞台大小等比縮小
    const fitCanvas = () => {
      const stage = $('#ts-stage');
      if (!stage || !canvas.width) return;
      const r = stage.getBoundingClientRect();
      const maxW = Math.max(80, r.width - 8);
      const maxH = Math.max(80, r.height - 8);
      const k = Math.min(maxW / canvas.width, maxH / canvas.height);
      canvas.style.width = Math.floor(canvas.width * k) + 'px';
      canvas.style.height = Math.floor(canvas.height * k) + 'px';
    };
    const toBlob = () => new Promise((resolve, reject) => {
      try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'); } catch (e) { reject(e); }
    });
    const name = () => fileName(data.title, index);

    const defaultSave = (blob, n) => {
      const url = win.URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = n;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 4000);
      return { ok: true, message: '已下載圖片' };
    };
    const defaultShare = async (blob, n) => {
      const nav = win.navigator;
      const File_ = win.File;
      const file = File_ ? new File_([blob], n, { type: 'image/png' }) : null;
      if (file && nav && typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
        try { await nav.share({ files: [file] }); return { ok: true }; } catch (e) {
          if (e && e.name === 'AbortError') return { ok: true, silent: true };
        }
      }
      // 不支援分享檔案（多數桌面瀏覽器）：複製圖片到剪貼簿
      const CI = win.ClipboardItem;
      if (CI && nav && nav.clipboard && typeof nav.clipboard.write === 'function') {
        try { await nav.clipboard.write([new CI({ 'image/png': blob })]); return { ok: true, message: '已複製圖片，可直接貼上' }; } catch (_) { /* */ }
      }
      return { ok: false, message: '這個瀏覽器不支援分享圖片，請改用「儲存圖片」' };
    };
    const act = async (fn, fallback) => {
      if (busy) return;
      busy = true;
      try {
        const blob = await toBlob();
        const r = await Promise.resolve((fn || fallback)(blob, name()));
        if (r && r.message && !r.silent) setStatus(r.message);
      } catch (e) {
        setStatus('圖片產生失敗');
      } finally {
        busy = false;
      }
    };

    const close = () => {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('resize', fitCanvas);
      if (data.onClose) data.onClose();
    };
    const go = (delta) => {
      const n = index + delta;
      if (n < 0 || n >= items.length) return;
      index = n;
      draw();
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    }
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('resize', fitCanvas);

    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#ts-close', close);
    on('#ts-prev', () => go(-1));
    on('#ts-next', () => go(1));
    on('#ts-save', () => act(data.saveImage, defaultSave));
    on('#ts-share', () => act(data.shareImage, defaultShare));
    // 點舞台空白處（卡片外）關閉
    const stage = $('#ts-stage');
    if (stage) stage.addEventListener('click', (e) => { if (e.target === stage) close(); });
    for (const b of doc.querySelectorAll('[data-style]')) b.addEventListener('click', () => { prefs.style = b.getAttribute('data-style'); savePrefs(store, prefs); draw(); });
    for (const b of doc.querySelectorAll('[data-font]')) b.addEventListener('click', () => { prefs.font = b.getAttribute('data-font'); savePrefs(store, prefs); draw(); });
    for (const b of doc.querySelectorAll('[data-ratio]')) b.addEventListener('click', () => { prefs.ratio = b.getAttribute('data-ratio'); savePrefs(store, prefs); draw(); });
    // 左右滑切換重點（觸控）
    let sx = null;
    if (stage) {
      stage.addEventListener('touchstart', (e) => { sx = e.touches && e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
      stage.addEventListener('touchend', (e) => {
        const t = e.changedTouches && e.changedTouches[0];
        if (sx == null || !t) return;
        const dx = t.clientX - sx;
        sx = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }, { passive: true });
    }
    // 樣式色票
    for (const b of doc.querySelectorAll('[data-style]')) {
      const st = STYLES[b.getAttribute('data-style')];
      if (st) { b.style.background = st.swatch; b.title = st.label; }
    }
    const fontsReady = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    draw();
    Promise.resolve(fontsReady).then(draw, () => {});
    // 焦點放在頁面本身（iframe 要有焦點才收得到 Esc / 方向鍵）；不放關閉鈕——程式設焦點會畫出焦點框
    try { doc.body.tabIndex = -1; doc.body.style.outline = 'none'; doc.body.focus(); win.focus(); } catch (_) { /* */ }
    return { draw, go, close, get index() { return index; }, prefs, toBlob };
  }

  const api = { tokenize, layoutLines, justifyLine, fitQuote, ellipsize, render, mount, loadPrefs, savePrefs, fileName, RATIOS, FONTS, STYLES, DEFAULT_PREFS, PREFS_KEY, BRAND, NO_START, NO_END };
  global.__JReadTextshot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
