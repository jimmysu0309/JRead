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

  // v0.8.37：預設值取自 settings-defaults 單一資料源（manifest 順序保證先載）；
  // `|| 50` 僅為極端 fallback（jsdom 局部載入等），改預設值請動 settings-defaults
  const DEFAULT_RATIO = (typeof globalThis !== 'undefined' &&
    globalThis.__JReadSettingsDefaults &&
    Number(globalThis.__JReadSettingsDefaults.spaceScrollRatio)) || 50;

  let installed = false;
  let ratio = DEFAULT_RATIO; // settings.spaceScrollRatio（% of viewport）
  let articleEl = null;
  let focusedBlock = null;
  let barEl = null;
  let animId = null;
  let scrollGuardTimer = null;

  // easeInOutCubic：實測 Readwise 軌跡為慢→快→慢的對稱 S 曲線
  function spaceScrollEase(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }

  // 使用者滾輪 / 觸控介入時立即取消進行中的平滑動畫 + 落點兜底（手動卷動優先，
  // 不被動畫或兜底覆寫）。
  function cancelSpaceScrollAnim() {
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    if (scrollGuardTimer !== null) {
      clearTimeout(scrollGuardTimer);
      scrollGuardTimer = null;
    }
  }


  // 內容圖片的最小高度——低於此視為 inline 小圖（emoji / icon），不當焦點單位
  const MEDIA_MIN_HEIGHT = 40;
  // 裸文字 block 焦點單位的最小直接文字長度——短標題 / 短句（如「一：上半部分大部分解」
  // 10 字）也算段落，但濾掉 wrapper 偶含的零星標籤字
  const MIN_TEXT_BLOCK = 4;
  // v0.8.81：行內 tag 集——計算 block 的「段落文字量」時，把包在這些 inline
  // 子元素內的文字一起算。WYSIWYG 編輯器（Draft.js / Lexical 等）把段落文字
  // 包成 <div><span>文字</span></div>，div 無直接 text node，只算 direct text
  // node 會漏收 → Space 焦點條跳過這些段落（Jimmy 2026-06-16 mirrormedia 回報）。
  // 與 styler markTextDivs 的 INLINE_TAGS 同款（兩處都在判「div 是不是段落」，
  // 平行邏輯——改一處時另一處一起檢視）。BR 不列入（無文字、且常用於排版斷行）。
  const INLINE_TEXT_TAGS = new Set(['SPAN', 'A', 'STRONG', 'EM', 'I', 'B', 'U', 'MARK', 'SMALL', 'SUP', 'SUB', 'CODE', 'TIME', 'ABBR', 'S', 'DEL', 'INS', 'WBR', 'FONT', 'Q', 'CITE', 'BDI', 'BDO']);

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

  // ---- br 分段虛擬焦點單位（v0.8.83）----------------------------------------
  // 老式 table 排版內容頁（Paul Graham essays / 早期手寫 HTML / newsletter）整篇
  // 主文是「一個 <p>/<font> 內用 <br><br> 分段」、沒有逐段 <p>，BLOCK_SEL 與裸
  // 文字 block 都只收到單一 block → Space 焦點條把全文視為一段（Jimmy 2026-06-16
  // 回報 boss.html）。把「br-paragraphed」block 就地展開成「每段一個虛擬焦點
  // 單位」：以 Range 量段落 rect（不動 DOM、不需 restore、不影響 styler/cleaner/
  // Readwise export）。虛擬單位以段落起始 text node 為 key 快取，跨 collectBlocks
  // 呼叫維持同一物件參照——advance() 的 blocks.indexOf(focusedBlock) 才找得到、
  // 焦點才能連續推進（每次重建 Range 物件會讓 indexOf 失效、Space 永遠跳回首段）。
  const BR_PARA_MIN_BR = 3;          // 至少 3 個 <br> 才視為 br 分段（排除單一換行）
  const BR_PARA_MIN_RUN_TEXT = 12;   // 每段最少文字（跳過 br 間空白 / 短碎片）
  const BR_PARA_SKIP_SEL = 'pre, figure, table, ul, ol';  // 程式碼 / 圖 / 表 / 列表不切
  const brUnitCache = new WeakMap(); // startNode → 虛擬焦點單位（穩定參照）

  // br 容器判定：用「直接 <br> 子數」（非後代 querySelectorAll('br')）。直接子
  // 計數天然只命中「實際裝 br 分段文字的那一層」——boss/todo 都是 <font>（brs
  // 是 font 的直接子）；外層 <p> / root <td> 的直接 br 子數低（boss <p> 直接子
  // 只有 font；todo <td> 直接 br 只有 2）自然被排除，免去 querySelectorAll('br')
  // 把後代 br 往上冒泡誤判祖先容器的問題。內嵌 block 子（blockquote / figure，
  // 如 PG todo「Don't ignore your dreams」blockquote）不影響判定——它自己仍由
  // BLOCK_SEL 收成獨立單位、splitBrRuns 把它當段落邊界跳過。
  function brDirectChildCount(el) {
    let n = 0;
    for (const c of el.childNodes) if (c.nodeType === 1 && c.tagName === 'BR') n++;
    return n;
  }
  function isBrParagraphed(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches && el.matches(BR_PARA_SKIP_SEL)) return false;
    return brDirectChildCount(el) >= BR_PARA_MIN_BR;
  }

  function makeBrUnit(startNode, range) {
    let unit = brUnitCache.get(startNode);
    if (!unit) {
      unit = {
        __jreadBrUnit: true,
        startNode,
        range,
        getBoundingClientRect() { return this.range.getBoundingClientRect(); },
        get isConnected() { return !!(this.startNode && this.startNode.isConnected); }
      };
      brUnitCache.set(startNode, unit);
    } else {
      unit.range = range;   // 同一 startNode、刷新 range（rect 即時重算）
    }
    return unit;
  }

  // 把 br 容器切成「每段一虛擬單位」：手動走訪子樹，以 <br>（連續視為單一邊界）
  // 與子 BLOCK_SEL（blockquote / figure 等內嵌 block）為段落邊界；inline 子
  // （a / i / font / span…）下探、文字計入當段；子 BLOCK_SEL 整顆跳過（它自己
  // 是獨立焦點單位）。每段以首/尾 text node 建 Range（虛擬單位、不動 DOM）。
  function splitBrRuns(container) {
    const doc = container.ownerDocument;
    const units = [];
    let runStart = null, runEnd = null, runText = '';
    const flush = () => {
      if (runStart && runText.trim().length >= BR_PARA_MIN_RUN_TEXT) {
        const range = doc.createRange();
        range.setStartBefore(runStart);
        range.setEndAfter(runEnd);
        if (range.getBoundingClientRect().height >= 4) units.push(makeBrUnit(runStart, range));
      }
      runStart = runEnd = null; runText = '';
    };
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {                       // text node
          if (!child.textContent.trim() && !runStart) continue;
          if (!runStart) runStart = child;
          runEnd = child; runText += child.textContent;
        } else if (child.nodeType === 1) {
          if (child.tagName === 'BR') flush();
          else if (child.matches && child.matches(BLOCK_SEL)) flush();  // 內嵌 block = 邊界、跳子樹
          else if (INLINE_TEXT_TAGS.has(child.tagName)) walk(child);    // inline 下探收文字
          // 其他（img / hr 等）忽略，不計入文字段
        }
      }
    };
    walk(container);
    flush();
    return units;
  }

  // 把 article 內的 br 容器（老式 <br><br> 分段、無逐段 <p>）切成「每段一虛擬
  // 單位」、取代外層包住容器的舊 block。容器可能是 block 級也可能是 inline
  // <font>（todo.html 的 font 直接掛 <td>、預設 display:inline、被裸文字 block 的
  // display:block 濾掉）——故直接掃全 DOM 找 br 容器、不靠 blocks 先收到。巢狀
  // 容器（祖先也是 br 容器）只取最外層、避免重複切。kept 只丟「包住容器」的舊
  // block（boss 外層 <p> 含 font → 丟，否則變成 <p> 整段 + 45 runs 重複）；
  // 「被容器包住」的舊 block（todo 的內嵌 blockquote）保留成獨立單位。最終以
  // getBoundingClientRect().top（文件 Y）排序：虛擬單位無 compareDocumentPosition，
  // 但閱讀順序＝由上到下，Y 座標排序對真元素 / 虛擬段落一致適用。
  function expandBrParagraphs(blocks, root) {
    let containers = [];
    // root 自身也可能是 br 容器：RSS reader（miniflux）/ 轉貼的 FB 貼文等把整篇
    // 正文當 text node + <br><br> 直接掛在偵測到的主文容器上、無逐段 wrapper。
    // querySelectorAll('*') 不含 root → 整篇正文漏收，焦點條只追得到標題 / header
    // 小區塊、無法在正文標示閱讀進度（Jimmy 2026-06-16 reader.miniflux.app 回報）。
    if (isBrParagraphed(root)) containers.push(root);
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('[data-jread-hidden="1"]')) continue;
      if (isBrParagraphed(el)) containers.push(el);
    }
    // 巢狀去重：只留最外層 br 容器（被其他容器包住的不獨立切）
    containers = containers.filter((c) => !containers.some((o) => o !== c && o.contains(c)));
    if (!containers.length) return blocks;
    // 丟掉「包住任一 br 容器」的舊 block（外層 wrapper）；其餘（標題圖、容器內
    // 嵌 blockquote / figure 等）保留
    const kept = blocks.filter((b) =>
      !(b.nodeType === 1 && containers.some((c) => b === c || b.contains(c)))
    );
    const out = kept.slice();
    for (const c of containers) {
      const runs = splitBrRuns(c);
      for (const u of runs) out.push(u);
    }
    out.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return out;
  }

  // v0.8.40：root 參數讓 position-memory（閱讀位置記憶）共用同一份段落收集
  // 規則（單一資料源——li 單位 / 圖庫拆圖 / 裸文字 block 等規則不雙實作）。
  // 不傳 root 時用模組自己的 articleEl（既有呼叫端行為不變）。
  function collectBlocks(rootEl) {
    const root = rootEl || articleEl;
    if (!root || !root.isConnected) return [];
    const blocks = [];
    // 一般 block 單位
    for (const el of root.querySelectorAll(BLOCK_SEL)) {
      // cleaner 隱藏的節點（含祖先被 hide）不收
      if (el.closest('[data-jread-hidden="1"]')) continue;
      // 巢狀 block 取最外層（blockquote > p / figure > table 等只收外層）
      const outer = el.parentElement && el.parentElement.closest(BLOCK_SEL);
      if (outer && root.contains(outer)) continue;
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
    for (const el of root.querySelectorAll('div, font, section, td')) {
      if (el.closest('[data-jread-hidden="1"]')) continue;
      // 段落文字量 = 直接 text node + inline 子元素（span/a/…）內的文字。
      // 只算 inline 子（block 子不算）確保 wrapper（子為 block div 的容器）
      // directLen 仍為 0、不誤收；leaf-most 段落（子為 span 的 DraftStyle block）
      // 才被收（v0.8.81 mirrormedia span-wrapped 段落修法，同 markTextDivs）。
      let directLen = 0;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) directLen += n.textContent.trim().length;
        else if (n.nodeType === 1 && INLINE_TEXT_TAGS.has(n.tagName)) directLen += n.textContent.trim().length;
      }
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
    for (const m of root.querySelectorAll('img, video')) {
      if (m.closest('[data-jread-hidden="1"]')) continue;
      if (m.getBoundingClientRect().height < MEDIA_MIN_HEIGHT) continue;
      let covered = false;
      let p = m.parentElement;
      while (p && p !== root) {
        if (blocks.indexOf(p) !== -1) { covered = true; break; }
        p = p.parentElement;
      }
      if (!covered) blocks.push(m);
    }
    // 兩個來源合併後依文件順序排序（焦點推進順序 = 閱讀順序）
    blocks.sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1
    );
    // br 容器（老式 <br><br> 分段、無逐段 <p>）展開成段落虛擬單位
    return expandBrParagraphs(blocks, root);
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

  // 卷到落點：rAF 平滑動畫（easeInOutCubic 450ms）+ **落點兜底保證**（v0.8.85）。
  //
  // 背景：純 rAF 動畫（v0.7.216~v0.8.83）在「分頁非 OS 焦點視窗 / 被瀏覽器節流」
  // 時，rAF callback **不發** → 動畫永遠到不了落點、頁面幾乎不卷，焦點段落停在
  // viewport 外 → 下次 advance 把它判成 offscreen 往回 re-anchor 到可視區第一段
  // → 焦點指示條在同一屏內往回循環跳（Jimmy 2026-06-16 實機 paulgraham.com/
  // boss.html 回報）。實證（隱藏分頁直接量）：rAF afterRaf=0、原生 scrollTo
  // ({behavior:'smooth'}) afterNative=0（背景 smooth 也被延遲）、**同步 scrollTop=X
  // afterSync=900**——只有同步寫入在任何情境即時生效。
  //
  // v0.8.84 曾全改同步瞬移，但 Jimmy 要平滑（瞬移不可接受）。v0.8.85 改回平滑
  // rAF + setTimeout 落點兜底：前景分頁 rAF 正常 → 拿到完整平滑動畫；rAF 被節流
  // 沒跑完時，動畫時長後 setTimeout（背景仍會 fire，雖節流）同步把 scrollTop 補
  // 到落點 + 清 animId（讓被 handler guard 吞掉的後續 Space 能繼續）→ 焦點段落
  // 必進可視區、不再循環。完成（rAF 正常跑完）時 step 內順手清掉兜底計時器。
  function startSpaceScrollAnim(delta) {
    const scroller = document.scrollingElement || document.documentElement;
    const from = scroller.scrollTop;
    const maxTop = Math.max(0, scroller.scrollHeight - window.innerHeight);
    const to = Math.max(0, Math.min(maxTop, from + delta));
    if (Math.abs(to - from) < 1) return; // 已在頂/底，無可卷
    cancelSpaceScrollAnim(); // 取消前一個未完成動畫 / 兜底（連按 Space retarget）
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / SPACE_SCROLL_DURATION_MS);
      scroller.scrollTop = from + (to - from) * spaceScrollEase(p);
      animId = p < 1 ? requestAnimationFrame(step) : null;
      // rAF 正常跑完落點 → 清兜底計時器（不需再同步補位）
      if (animId === null && scrollGuardTimer !== null) {
        clearTimeout(scrollGuardTimer);
        scrollGuardTimer = null;
      }
    };
    animId = requestAnimationFrame(step);
    scrollGuardTimer = setTimeout(() => {
      scrollGuardTimer = null;
      if (animId !== null) { cancelAnimationFrame(animId); animId = null; }
      if (Math.abs(scroller.scrollTop - to) > 1) scroller.scrollTop = to;
    }, SPACE_SCROLL_DURATION_MS + 80);
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
    // 元素歸屬找不到——br 段落是虛擬單位（非真元素），改用點擊 Y 命中段落 rect
    for (const b of blocks) {
      if (!b.__jreadBrUnit) continue;
      const r = b.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) { setFocus(b); return; }
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
    // v0.8.17：編輯/互動類 element 放行——共用 NS.isEditableTarget 單一資料源
    //（原本 paged-mode 另寫一份且漏 BUTTON，已合一）。
    if (NS.isEditableTarget(e.target)) return false;
    return true;
  }

  function spaceScrollHandler(e) {
    if (!shouldHandle(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (animId !== null) return; // 平滑動畫進行中：吞掉事件、不疊加
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
    ratio = Number.isFinite(raw) ? raw : DEFAULT_RATIO;
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

  // v0.8.40：閱讀位置記憶（position-memory.js）共用 API——
  //   getBlocks(el)：對指定容器跑 collectBlocks（段落收集規則單一資料源）
  //   currentAnchor(el)：「目前閱讀段落」最佳估計——焦點段落還在 viewport 內
  //     就用它（Space 閱讀的真實位置）；不在（手動捲遠 / 模組未啟用）退
  //     viewport 內第一個段落（與 advance 的 re-anchor 同準則）。回
  //     { el, index }（index 對應 getBlocks 同一份清單）或 null。
  //   anchorTo(block)：回復位置後把指示條移到該段（未 install 時 no-op——
  //     spaceScrollRatio = 0 停用時沒有指示條可移）。
  function currentAnchor(el) {
    const blocks = collectBlocks(el);
    if (!blocks.length) return null;
    let target = null;
    if (focusedBlock && focusedBlock.isConnected && blocks.indexOf(focusedBlock) !== -1) {
      const r = focusedBlock.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) target = focusedBlock;
    }
    if (!target) target = firstVisibleBlock(blocks);
    if (!target) return null;
    const index = blocks.indexOf(target);
    if (index === -1) return null;
    return { el: target, index };
  }

  function anchorTo(block) {
    if (!installed || !block || !block.isConnected) return;
    setFocus(block);
  }

  NS.spaceScroll = {
    sync,
    uninstall,
    isInstalled: () => installed,
    getBlocks: collectBlocks,
    currentAnchor,
    anchorTo
  };
})();
