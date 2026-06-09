// JRead — Space 段落焦點卷動（v0.7.216，仿 Readwise Reader）
// -----------------------------------------------------------------------------
// reader mode 下維護「目前閱讀段落」焦點：
//   - 左側 4px 主題色指示條（#__jread-focus-bar）標記目前段落（CSS rule 在
//     styler.js 注入的 stylesheet 內、跟 #__jread-progress 共用 theme.progressBar
//     色——單一資料源，主題切換時 styler 重建 stylesheet 自動跟色）
//   - Space：焦點跳到下一個段落；Shift+Space：跳回上一個
//   - 顯示門檻（Jimmy 2026-06-05 訂正語意）：settings.spaceScrollRatio（預設
//     50）= 焦點段落允許的最低位置（viewport 比例）。新焦點段落 top 還在
//     門檻內就**只移指示條、不卷動**；低於門檻 → 以 rAF 動畫（450ms
//     easeInOutCubic，實測 Readwise 曲線）卷動，讓段落 top 落到 REST_FRACTION
//     落點——卷距隨段落位置而定，保證卷完一定回到門檻內
//   - 反向（Shift+Space）：焦點段落 top 高過 viewport 上緣才往上卷、同樣落
//     到 REST 落點
//
// 放行條件與 keyguard 一致：IME composition / INPUT / TEXTAREA / SELECT /
// BUTTON / contenteditable focus 不攔。alt / ctrl / meta 不攔；shift 允許
// （反向觸發鍵）。動畫進行中吞掉事件不疊加（按住 Space = ~2 段/秒接續推進）。
//
// 焦點 resync：使用者手動滾輪卷遠（焦點段落完全離開 viewport）或焦點段落被
// SPA 移除後再按 Space，不從舊焦點推進、改重新錨定到 viewport 內第一個段落
// ——避免指示條在畫面外亂跳。
//
// 注意：listener 註冊順序由 main.js 控管（spaceScrollHandler 必須先於
// keyguardHandler——keyguard 對非 ESC 鍵 stopImmediatePropagation）。
// 設定 sentinel：spaceScrollRatio = 0 → 停用（不攔截、保留瀏覽器原生行為）。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const BAR_ID = '__jread-focus-bar';
  // 焦點段落候選：主文內的 block-level 內容元素。清單以 li 為單位（Jimmy
  // 2026-06-05 訂正：newsletter 類站點的 ol 每個 li 是完整段落，整個 ol 當
  // 一段會讓 Space 一次跳過三大段）——ul / ol 容器不收、li 收；li 內的 p /
  // 巢狀清單經 nesting filter 自動歸屬最外層 li。其餘巢狀（blockquote > p
  // 等）取最外層。
  const BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, table';
  const SPACE_SCROLL_DURATION_MS = 450;
  // 卷動後焦點段落的落點（viewport 比例）：段落 top 卷到離上緣 10% 處。
  // Readwise 實測卷距不固定（442 / 475px 同站不同段）——它是「卷到落點」
  // 模型，不是固定距離；落點固定在偏上位置，讓門檻內可容納多個後續段落、
  // 多數按壓只移指示條不卷動。
  const REST_FRACTION = 0.1;

  let installed = false;
  let ratio = 50;            // settings.spaceScrollRatio（% of viewport）
  let articleEl = null;
  let focusedBlock = null;
  let barEl = null;
  let animId = null;

  // easeInOutCubic：實測 Readwise 軌跡為慢→快→慢的對稱 S 曲線
  function spaceScrollEase(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }

  // 使用者滾輪 / 觸控介入時立即取消進行中的動畫——動畫每 frame 覆寫 scrollTop，
  // 不取消會跟使用者的手動卷動打架 450ms。
  function cancelSpaceScrollAnim() {
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  // 內容圖片的最小高度——低於此視為 inline 小圖（emoji / icon），不當焦點單位
  const MEDIA_MIN_HEIGHT = 40;
  // 裸文字 block 焦點單位的最小直接文字長度——短標題 / 短句（如「一：上半部分大部分解」
  // 10 字）也算段落，但濾掉 wrapper 偶含的零星標籤字
  const MIN_TEXT_BLOCK = 4;

  // 多圖容器（圖庫）判定：含 >= 2 張內容圖、且圖說以外幾乎沒有正文。
  // Jimmy 2026-06-05 訂正：照片以每張為單位——圖庫容器讓位給個別圖片；
  // 單圖 figure 仍整塊當單位（含 figcaption 一起標）；文字段落內的插圖
  // （正文 >= 100 字）不拆、整段當單位。
  function isMediaGallery(el) {
    if (el.matches('img, video')) return false;
    const media = Array.from(el.querySelectorAll('img, video')).filter((m) =>
      !m.closest('[data-jread-hidden="1"]') && m.getBoundingClientRect().height >= MEDIA_MIN_HEIGHT
    );
    if (media.length < 2) return false;
    const capLen = Array.from(el.querySelectorAll('figcaption'))
      .reduce((s, c) => s + c.textContent.trim().length, 0);
    const textLen = el.textContent.trim().length - capLen;
    return textLen < 100;
  }

  function collectBlocks() {
    if (!articleEl || !articleEl.isConnected) return [];
    const blocks = [];
    // 一般 block 單位
    for (const el of articleEl.querySelectorAll(BLOCK_SEL)) {
      // cleaner 隱藏的節點（含祖先被 hide）不收
      if (el.closest('[data-jread-hidden="1"]')) continue;
      // 巢狀 block 取最外層（blockquote > p / figure > table 等只收外層）
      const outer = el.parentElement && el.parentElement.closest(BLOCK_SEL);
      if (outer && articleEl.contains(outer)) continue;
      // 不可見 / 空段落（display:none rect 為 0）
      const r = el.getBoundingClientRect();
      if (r.height < 4) continue;
      // 多圖容器讓位給個別圖片（下方 media 迴圈收）
      if (isMediaGallery(el)) continue;
      blocks.push(el);
    }
    // 裸文字 block 單位：BBS / 老站把每段文字放裸 <div>/<font>、不用 <p>
    // （forum.gamer.com.tw 實測整篇本文是 display:block 的 <div> 直接含文字、與
    // 圖交錯，BLOCK_SEL 全漏收 → 焦點條只在圖與圖之間跳、跳過中間文字）。通則：
    // block-level 且「直接含 >= MIN_TEXT_BLOCK 字文字節點」的元素 = 段落等價焦點
    // 單位。guard 確保只收 leaf-most 文字承載層、不誤收 wrapper：
    //   - 直接 text node 長度 >= MIN_TEXT_BLOCK（whitespace-only wrapper directLen=0 排除）
    //   - computed display 為 block-level（排除 inline span/font 的行內片段）
    //   - 不含 BLOCK_SEL 後代（含 <p> 等語意 block = wrapper、讓 BLOCK_SEL 那層收）
    //   - 不含另一個文字候選（保留 leaf-most、避免大 wrapper 吃掉整篇變單一單位）
    //   - 祖先不是已收 block（巢狀於 figure/blockquote/已收文字 block 內 → 跳）
    const textCandidates = [];
    for (const el of articleEl.querySelectorAll('div, font, section, td')) {
      if (el.closest('[data-jread-hidden="1"]')) continue;
      let directLen = 0;
      for (const n of el.childNodes) if (n.nodeType === 3) directLen += n.textContent.trim().length;
      if (directLen < MIN_TEXT_BLOCK) continue;
      const disp = (el.ownerDocument.defaultView || window).getComputedStyle(el).display;
      if (!/^(block|list-item|table-cell|flow-root|table)$/.test(disp)) continue;
      if (el.getBoundingClientRect().height < 4) continue;
      textCandidates.push(el);
    }
    for (const el of textCandidates) {
      if (el.querySelector(BLOCK_SEL)) continue;                         // 含語意 block = wrapper
      if (textCandidates.some((o) => o !== el && el.contains(o))) continue; // 含其他候選 = wrapper
      if (blocks.some((b) => b !== el && b.contains(el))) continue;      // 巢狀於已收 block
      blocks.push(el);
    }
    // 圖片 / 影片單位：沒被任何已收 block 單位覆蓋的內容圖、每張獨立成單位
    // （圖庫容器在上面被 isMediaGallery 排除、不在 blocks 內 → 其圖片落到
    // 這裡逐張收；單圖 figure / 文字段落已是單位 → 其內圖片被覆蓋、不重複收。
    // 此規則保證任何內容圖都恰好屬於一個焦點單位、永不漏失）
    for (const m of articleEl.querySelectorAll('img, video')) {
      if (m.closest('[data-jread-hidden="1"]')) continue;
      if (m.getBoundingClientRect().height < MEDIA_MIN_HEIGHT) continue;
      let covered = false;
      let p = m.parentElement;
      while (p && p !== articleEl) {
        if (blocks.indexOf(p) !== -1) { covered = true; break; }
        p = p.parentElement;
      }
      if (!covered) blocks.push(m);
    }
    // 兩個來源合併後依文件順序排序（焦點推進順序 = 閱讀順序）
    blocks.sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1
    );
    return blocks;
  }

  function ensureBar() {
    if (barEl && barEl.isConnected) return;
    barEl = document.getElementById(BAR_ID);
    if (!barEl) {
      barEl = document.createElement('div');
      barEl.id = BAR_ID;
      // 掛 <html> 直下（body 外）——styler 對 body 內非主文鏈元素一律隱藏，
      // 跟 #__jread-progress 同樣的逃生位置
      (document.head ? document.head.parentElement : document.documentElement).appendChild(barEl);
    }
  }

  // 指示條左錨點：固定在主文欄（articleEl）左緣外側——**不**跟個別 block
  // 的左緣。Jimmy 2026-06-05 訂正：指示條水平位置必須恆定；跟 block 左緣
  // 會讓置中圖片 / 縮排元素把指示條拉到頁面中間左右漂移。固定錨在欄外側
  // 也天然避開 list marker（「1.」/「•」畫在欄內的 ul/ol padding 區）。
  function barAnchorLeft() {
    return articleEl ? articleEl.getBoundingClientRect().left : 0;
  }

  // position: absolute（文件座標）——卷動時指示條黏著段落移動，不需每 frame 更新
  function positionBar(block) {
    if (!barEl || !block) return;
    const r = block.getBoundingClientRect();
    barEl.style.top = (window.scrollY + r.top) + 'px';
    barEl.style.left = Math.max(0, window.scrollX + barAnchorLeft() - 14) + 'px';
    barEl.style.height = r.height + 'px';
  }

  // 單頁判定（Jimmy 2026-06-09）：整篇文章在 viewport 內裝得下、不需捲動時
  // 不顯示段落焦點指示條——指示條的作用是追蹤捲動閱讀位置，沒有捲動可追蹤
  // 時它只是視覺雜訊（X 短推文 / 短文章常見）。容差 +2px 吸收 sub-pixel
  // rounding（scrollHeight / innerHeight 取整誤差），避免恰好等高被誤判成多頁。
  function isSinglePage() {
    const scroller = document.scrollingElement || document.documentElement;
    if (!scroller) return false;
    return scroller.scrollHeight <= window.innerHeight + 2;
  }

  function onResize() {
    // resize 可能讓單頁 ↔ 多頁互換（視窗高度改變 / 字級調整）——重走 setFocus
    // 讓指示條依最新單頁判定顯示或隱藏
    if (focusedBlock && focusedBlock.isConnected) setFocus(focusedBlock);
  }

  function setFocus(block) {
    focusedBlock = block;
    // 單頁文章不顯示指示條——移除已建的 bar（涵蓋 resize 由多頁變單頁的情境）
    if (isSinglePage()) {
      if (barEl) { barEl.remove(); barEl = null; }
      return;
    }
    ensureBar();
    positionBar(block);
  }

  function firstVisibleBlock(blocks) {
    const vh = window.innerHeight;
    return blocks.find((b) => {
      const r = b.getBoundingClientRect();
      return r.bottom > 0 && r.top < vh;
    }) || blocks[0] || null;
  }

  function startSpaceScrollAnim(delta) {
    const scroller = document.scrollingElement || document.documentElement;
    const viewportH = window.innerHeight;
    const from = scroller.scrollTop;
    const maxTop = Math.max(0, scroller.scrollHeight - viewportH);
    const to = Math.max(0, Math.min(maxTop, from + delta));
    if (Math.abs(to - from) < 1) return; // 已在頂/底，無可卷
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / SPACE_SCROLL_DURATION_MS);
      scroller.scrollTop = from + (to - from) * spaceScrollEase(p);
      animId = p < 1 ? requestAnimationFrame(step) : null;
    };
    animId = requestAnimationFrame(step);
  }

  // 門檻判定（Jimmy 2026-06-05 訂正語意）：settings.spaceScrollRatio = 焦點
  // 段落允許的「顯示門檻」（top 不可低於 viewport × ratio%）。新焦點段落
  // 還在門檻內 → 只移指示條不卷動；超出門檻 → 卷動讓段落 top 回到 REST
  // 落點——卷距隨段落位置而定（非固定距離），保證卷完一定在門檻內，
  // 指示條永遠不會停留在頁面底部。
  function maybeScroll(block, dir) {
    const vh = window.innerHeight;
    const r = block.getBoundingClientRect();
    const threshold = vh * ratio / 100;
    // 落點不可高於門檻（極小 ratio 設定時退化成 typewriter 模式：落點 = 門檻）
    const rest = Math.min(vh * REST_FRACTION, threshold);
    if (dir > 0) {
      // 往下：焦點段落 top 在門檻內 → 不卷
      if (r.top <= threshold) return;
    } else {
      // 往上：焦點段落 top 仍在 viewport 內 → 不卷
      if (r.top >= 0) return;
    }
    // 卷到落點：delta 正 = 往下、負 = 往上，同一條式子雙向通用
    startSpaceScrollAnim(r.top - rest);
  }

  // 滑鼠點某段文字 / 圖片 → 指示條跳到那段（Jimmy 2026-06-05 指定行為）。
  // 歸屬解析直接對 collectBlocks() 結果找（單一資料源——li / 圖庫拆圖等
  // 規則自動一致）：從點擊目標往上走、第一個出現在 blocks 清單的祖先即焦點。
  // 只移指示條、不卷動、不 preventDefault（連結點擊 / 文字選取照常運作）。
  // capture phase：原站 JS stopPropagation 也攔不住純觀察的 listener。
  function onClickFocus(e) {
    if (!articleEl || !articleEl.isConnected) return;
    const t = e.target;
    if (!t || !t.closest || !articleEl.contains(t)) return;
    if (t.closest('[data-jread-hidden="1"]')) return;
    const blocks = collectBlocks();
    let el = t;
    while (el && el !== articleEl) {
      if (blocks.indexOf(el) !== -1) {
        setFocus(el);
        return;
      }
      el = el.parentElement;
    }
  }

  function advance(dir) {
    const blocks = collectBlocks();
    if (!blocks.length) return;
    let next = null;
    if (!focusedBlock || !focusedBlock.isConnected) {
      next = firstVisibleBlock(blocks);
    } else {
      const r = focusedBlock.getBoundingClientRect();
      const offscreen = r.bottom <= 0 || r.top >= window.innerHeight;
      const idx = blocks.indexOf(focusedBlock);
      if (offscreen || idx === -1) {
        // 手動卷遠 / 焦點塊被 SPA 移除：重新錨定，不從舊焦點推進
        next = firstVisibleBlock(blocks);
      } else {
        next = blocks[Math.max(0, Math.min(blocks.length - 1, idx + dir))];
      }
    }
    if (!next) return;
    setFocus(next);
    maybeScroll(next, dir);
  }

  // 共用 guard：回 true = 這個 Space 事件歸我們管（要攔）。
  // false = 放行（IME / 輸入框 / 修飾鍵 / 非 Space / 停用）。
  function shouldHandle(e) {
    if (ratio <= 0) return false;
    if (e.isComposing || e.keyCode === 229) return false;
    if (e.key !== ' ' && e.code !== 'Space') return false;
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    const t = e.target;
    if (t) {
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return false;
      if (t.isContentEditable) return false;
      const ce = t.getAttribute && t.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return false;
    }
    return true;
  }

  function spaceScrollHandler(e) {
    if (!shouldHandle(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (animId !== null) return; // 動畫進行中：吞掉事件、不疊加
    advance(e.shiftKey ? -1 : 1);
  }

  // 歷史教訓（2026-06-05 probe 抓 828px 幽靈卷動）：本模組啟用時 styler.js 的
  // v0.7.91 onSpaceScroll（SPACE = scrollBy 92% viewport）必須讓位——該 listener
  // 在 styler.apply 註冊、早於本模組、且不看 defaultPrevented，兩條 path 對同一
  // 個 SPACE 各卷各的會疊成雙重卷動。讓位 guard 在 styler.js onSpaceScroll 開頭
  // （檢查 NS.spaceScroll.isInstalled()），spaceScrollRatio = 0 停用本模組時
  // styler 舊行為自動回歸。

  function install() {
    if (installed) return;
    window.addEventListener('keydown', spaceScrollHandler, true);
    window.addEventListener('click', onClickFocus, true);
    window.addEventListener('wheel', cancelSpaceScrollAnim, { passive: true });
    window.addEventListener('touchmove', cancelSpaceScrollAnim, { passive: true });
    window.addEventListener('resize', onResize);
    installed = true;
  }

  function uninstall() {
    if (!installed && !barEl) return;
    window.removeEventListener('keydown', spaceScrollHandler, true);
    window.removeEventListener('click', onClickFocus, true);
    window.removeEventListener('wheel', cancelSpaceScrollAnim);
    window.removeEventListener('touchmove', cancelSpaceScrollAnim);
    window.removeEventListener('resize', onResize);
    installed = false;
    cancelSpaceScrollAnim();
    focusedBlock = null;
    articleEl = null;
    if (barEl) { barEl.remove(); barEl = null; }
  }

  // settings → 模組狀態同步：ratio > 0 且有 articleEl 才 install。settings
  // 缺欄位（升版舊 storage）/ getSettings 失敗（null）都 fallback 預設 50。
  // install 後立即把焦點錨定到 viewport 內第一個段落（指示條進場即可見，
  // 跟 Readwise 一致）。
  function sync(settings, el) {
    const raw = settings ? Number(settings.spaceScrollRatio) : NaN;
    ratio = Number.isFinite(raw) ? raw : 50;
    if (el) articleEl = el;
    if (ratio > 0 && articleEl) {
      install();
      if (!focusedBlock || !focusedBlock.isConnected) {
        const first = firstVisibleBlock(collectBlocks());
        if (first) setFocus(first);
      }
    } else {
      uninstall();
    }
  }

  NS.spaceScroll = {
    sync,
    uninstall,
    isInstalled: () => installed
  };
})();
