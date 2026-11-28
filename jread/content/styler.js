// JRead — 閱讀模式排版（瘦身版 / c 路線）
// 設計哲學：**盡量不動原站的內文排版**，只提供：
//   1. 讀者卡片容器（article card）——版心、背景、圓角、陰影、置中
//   2. 頁面 / 祖先鏈 reset——讓主文能脫離原 2-col layout 限制
//   3. 必要的「破壞站點 hack」——aspect-ratio placeholder、圖片超出版心
//   4. 使用者 override——依設定注入對應 CSS
// 「預設值＝不注入」原則的現況（v0.8.37 勘誤，舊敘述已過時）：theme /
// fontFamily / titleFontSize 仍維持「預設不動原站」；fontSize（v0.7.140 起，
// 預設 18 也注入、連帶 line-height）與 fontWeight（v0.7.254 起三段一律注入）
// 是刻意例外——理由見各注入點註解（原站非 400 字重 / px 鎖死行高等場景，
// 不注入會讓設定項看起來壞掉）。
// restore() 移除 style 元素與 attribute 即可完整還原，不動任何原 inline style
// （runtime inline override 都有 snapshot + priority 還原）。
(function () {
  'use strict';

  const NS = window.__JRead;

  // 2026-10-07 review B-07 / A-30：styler 對元素寫 inline display（prewrap 容器 /
  // byline flex / gallery、de-column、wide-scroll 的 block）一律走 NS.inlineSet 分層
  // 登記簿、還原走 NS.inlineRelease——cleaner.hide / 編輯模式對同一元素再寫
  // display 時，兩邊各自快照寫回會互踩（詳見 namespace.js inlineSet 註解與
  // review-b7-inline-display-owner.spec.js）。登記簿缺席（最小 NS 的 jsdom 環境）
  // 退回各 pass 自己的快照路徑，行為與舊版一致。
  function setInlineOwned(el, prop, value, priority, owner) {
    if (NS && typeof NS.inlineSet === 'function') NS.inlineSet(el, prop, value, priority, owner);
    else el.style.setProperty(prop, value, priority || '');
  }
  // 回 true = 登記簿已把該層還原 / 轉交；false = 沒登記，呼叫端走舊快照寫回
  function releaseInlineOwned(el, prop, owner) {
    return !!(NS && typeof NS.inlineRelease === 'function' && NS.inlineRelease(el, prop, owner));
  }
  if (!NS) return;

  // v2.5.9：ARIA 排的 div 表格（`role="row"` 底下一排 `role="cell"` / `columnheader`，
  // 不是真的 <table>）。GitBook 實證（gitbook.com/docs quickstart、docs.gitbook.com
  // blocks/table）：styler 有三處只認 TABLE / TR / TD / TH 標籤——passZeroHorizInsets
  // 把格子左右內距清成 0（表頭兩格黏成「Starting pointBest for」）、passDecolumn 把
  // 含長段落的那一列塌成上下堆疊、通用 `div { width:auto; min-width:0 }` 拿掉表頭格的
  // 欄寬（資料格靠站方 flex:1 1 0 等分、表頭縮成字寬，欄對不上）。
  // ARIA role 是語意結構訊號（不是站點 / class 身份）。判定：
  //   - 自己是 role=row、不是原生 <tr>
  //   - 直系子至少兩個格子類 role（防「role=row 掛在單一包裝上」）
  //   - 祖先有 role=table / grid / treegrid / rowgroup（ARIA 規範要求 row 必須被這些
  //     擁有；沒有表格祖先的 role=row 多半是誤用在互動清單上，不當表格）
  // 這條驗「是不是 ARIA 表格的一列」、不驗列內容是不是適合並排；等分欄寬的 CSS 規則
  // 在 segCardWidth（選擇器同一組 role，CSS 數不了格子數——單格列吃到 flex 也只是撐滿）
  // v2.5.11：判定本體上提到 namespace.js（cleaner 的空殼規則共用同一份）
  const ARIA_CELL_ROLES = NS.ARIA_CELL_ROLES;
  const ARIA_TABLE_ROLES = NS.ARIA_TABLE_ROLES;
  const ARIA_TABLE_SEL = ARIA_TABLE_ROLES.map((r) => `[role="${r}"]`).join(', ');
  const ARIA_CELL_SEL = ARIA_CELL_ROLES.map((r) => `[role="${r}"]`).join(', ');
  const isAriaTableRow = NS.isAriaTableRow;
  // el 自己是 ARIA 表格列、或位在某一列裡面（格子與格子內的段落 / 包裝）
  // v2.5.10：ARIA 表格格子「內容撐出格子」時的收窄值（passAriaNarrowCellInsets）。
  // 6px＝GitBook 站方格子內距 12px 的一半：相鄰兩欄文字之間仍有 12px 間距。
  // ARIA_TABLE_ROOT_SEL＝整張表的根（不含 rowgroup——rowgroup 只是表內分段，
  // 收窄要整張表一起，表頭與資料列的文字左緣才對得齊）
  const ARIA_CELL_NARROW_PAD_PX = 6;
  const ARIA_TABLE_ROOT_SEL = ARIA_TABLE_ROLES.filter((r) => r !== 'rowgroup').map((r) => `[role="${r}"]`).join(', ');
  // 不可換行是內容本身語意的載體（程式碼 / 鍵盤輸入 / 表單），不改它的 white-space
  const ARIA_CELL_KEEP_NOWRAP_SEL = 'pre, code, kbd, samp, textarea, input, select, svg, math';
  // v2.5.11：收窄過的表「只在空白處換行」要回 normal 的兩個屬性
  const ARIA_CELL_WORD_WRAP_PROPS = ['overflow-wrap', 'word-break'];
  // 「只在空白處換行」寫完後重量的時間點（ms）：400 蓋過站方常見的 transition
  //（100–300ms），1500 蓋過內嵌字型載入後的重排；另外掛 document.fonts.ready
  const ARIA_CELL_SETTLE_MS = [400, 1500];
  // v2.5.13：表頭單字放不下時整列表頭縮字級的下限（相對目前字級）。0.8＝內文 20px 時
  // 表頭最小 16px；再小就不縮、照舊退回站方斷法
  const ARIA_HEADER_FIT_MIN_RATIO = 0.8;
  // v2.5.13：翻頁模式表頭列「跟著下一列」的上限——下一列高超過視窗高這個比例就不綁
  const ARIA_HEADER_KEEP_MAX_VH = 0.6;
  // v2.5.12：翻頁模式「ARIA 表格列不跨頁」要塌成 block 的 flex 外殼標記
  //（passMarkAriaFlowShells 標、翻頁區塊的 CSS 讀；捲動模式不標也沒有對應規則）
  const ARIA_FLOW_SHELL_ATTR = 'data-jread-aria-flow-shell';
  // 「這個 flex 外殼塌成 block 版面不變」的純判定（輸入是 computed style 的值）：
  //   - display 是 flex / inline-flex（grid 不碰：欄軌可能就是表格的欄）
  //   - 主軸直向、不換行（子項本來就一個疊一個、各佔整寬）；或只有一個 in-flow 子
  //   - align-items 是 normal / stretch（子項撐滿整寬＝block 子的預設寬）
  //   - 列間距 0（block 沒有 gap；只有一個子時 gap 不作用）
  // 任何一項不成立就不塌——寧可那張表在 Safari 照舊被切，不改站方版面
  function ariaFlowShellCollapsible(f) {
    if (!f) return false;
    const display = String(f.display || '');
    if (display !== 'flex' && display !== 'inline-flex') return false;
    const single = f.inFlowChildren <= 1;
    const column = String(f.flexDirection || '') === 'column';
    if (!single && !column) return false;
    const align = String(f.alignItems || 'normal');
    if (align !== 'normal' && align !== 'stretch') return false;
    if (single) return true;
    const wrap = String(f.flexWrap || 'nowrap');
    if (wrap !== 'nowrap') return false;
    const gap = parseFloat(f.rowGap);
    return !(gap > 0);
  }
  function inAriaTableRow(el, stopAt) {
    for (let n = el; n && n !== stopAt && n.nodeType === 1; n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('role') === 'row' && isAriaTableRow(n)) return true;
    }
    return false;
  }

  const STYLE_ID = '__jread-style';
  const HTML_CLASS = '__jread-active';
  const ARTICLE_ATTR = 'data-jread-active';
  const ANCESTOR_ATTR = 'data-jread-ancestor';
  // v1.8.3：articleEl 的第一個 / 最後一個「可見」direct child 標記。頂 / 底端
  // 留白消除規則原本用 CSS `> *:first-child` / `> *:last-child`——但 CSS 的
  // structural pseudo-class **不會跳過被 cleaner 隱藏的元素**，主文首尾只要卡
  // 一個 display:none 的雜訊殼（NYT `#in-story-masthead`），規則就落在那個
  // 0 高度的殼上、真正的內容元素沒吃到（Jimmy 2026-09-03 回報 nytimes opinion
  // 標題上方多餘空白＝站方 `article` padding-top:40px 疊在卡片自身 48px 上）。
  // 由 JS 標記「第一個 / 最後一個可見 direct child」補上這個盲點。
  const EDGE_FIRST_ATTR = 'data-jread-first-child';
  const EDGE_LAST_ATTR = 'data-jread-last-child';
  const INLINE_IMG_ATTR = 'data-jread-inline-img';
  const INLINE_IMG_MAX = 48;
  // v0.8.90：作者刻意縮小的小圖（icon / 版面 badge / 作者頭像）標記。裸 img
  // （非 a 包）若原站把大來源圖「顯示縮小」到 < CONTENT_IMG_MIN，width:auto
  // 會退回 naturalWidth 反向放大成滿版巨圖（washingtonpost Opinion 區
  // lightbulb badge：HTML width=160 / CSS 顯示 56px / natural 1200 → 撐成 788px
  // 巨圖佔滿標題上方）。apply() 量 pre-reader rendered rect、natural 明顯大於
  // rendered 即標記並用 inline !important max-width 釘回原始顯示寬。
  const ICON_IMG_ATTR = 'data-jread-icon-img';
  // v2.5.5：被同層真圖蓋住的站方佔位圖（見 classifyImg 的 isCoveredPlaceholder）。
  // 站方把低解析佔位圖 position:absolute 疊在 in-flow 真圖的位置上；通用的
  // 「img position:static」規則會把它拉回 flow、與真圖上下直排，真圖還沒載入
  // （站方尚未移除佔位圖）時每張圖多出一塊佔位圖高的空白。標記後 display:none。
  const COVERED_PH_ATTR = 'data-jread-covered-ph';
  const PLAYER_ATTR = 'data-jread-player';
  // v1.9.15：站方自管視覺的 UI / 標註（底色與文字色成對由站方決定，主題文字色
  // 不接管）。值 'hl' / 'hl-tint'（半透明底，v2.4.6）= 行內高亮自訂元素（<rw-highlight> 等，見
  // markInlineHighlights）、'swatch'（v3.7.4）= 色塊（見 markColorSwatches）、'widget' = 使用者選取文字叫出的浮動工具列子樹
  //（cleaner allowSelectionToolbar 放行後轉呼 markSiteWidgetSubtree）。
  // 這些元素同時標 PLAYER_ATTR——bg / border / color strip 全走既有的
  // `:not([PLAYER_ATTR])` 豁免，不另外改那批 selector 的 specificity。
  const SITE_UI_ATTR = 'data-jread-site-ui';
  // v1.0.8：byline meta 區一行正規化標記（Jimmy 2026-06-25 autocar 作者欄要求）。
  // 站點 byline（kicker / 作者 / 日期 / 閱讀時間 / 小頭像）reader mode 下各自
  // block 散成多行、字級不一、頭像縮排。偵測「標題與第一段內文之間、含日期訊號」
  // 的 meta 區（結構訊號、非站點 class 特判），CSS flex 一行排列、字級統一、頭像
  // inline 對齊內容左緣、隱藏閱讀時間。BYLINE_ATTR=root（flex 容器）、
  // BYLINE_WRAP_ATTR=純 wrapper（display:contents 打平任意巢狀讓 leaf 升為 root 的
  // flex item）、BYLINE_ITEM_ATTR=可見 leaf（flex item）、BYLINE_RT_ATTR=閱讀時間
  // （CSS 隱藏）。
  const BYLINE_ATTR = 'data-jread-byline';
  // v2.5.32：byline climb 的圖說 guard 門檻（figcaption 文字 >= 這個長度＝照片說明，
  // 不是頭像下的作者名；見 apply() 內 bhasImageCaption）
  const BYLINE_CAPTION_MIN_LEN = 25;
  const BYLINE_WRAP_ATTR = 'data-jread-byline-wrap';
  const BYLINE_ITEM_ATTR = 'data-jread-byline-item';
  const BYLINE_RT_ATTR = 'data-jread-byline-rt';
  // v1.5.28：byline 內「時刻」（HH:MM AM/PM TZ）子元素標記。閱讀模式的日期訊號
  //   保留日期即可、發稿時刻是雜訊（Jimmy 2026-07-02 NPR「1:59 PM ET」要求拿掉）。
  const BYLINE_TIME_ATTR = 'data-jread-byline-time';
  // v1.5.28：廣播節目出處 chip（"Heard on / Aired on <節目>"）標記——閱讀模式
  //   非必要 metadata（Jimmy 2026-07-02 NPR「HEARD ON MORNING EDITION」要求清）。
  const BYLINE_PROGRAM_ATTR = 'data-jread-byline-program';
  const BYLINE_PROGRAM_RE = /^(heard|aired|broadcast(?:ed)?)\s+on\b/i;
  // 節目出處連結 URL 訊號（翻譯無關——href 不會被 Shinkansen 翻譯，英文文字
  //   regex 在譯後 DOM 失效時靠這條接住）。NPR「Heard on」連到 /programs/<節目>/。
  const BYLINE_PROGRAM_URL_RE = /\/(programs?|shows?|podcasts?|episodes?)\//i;
  // v1.5.28：日期 item 標記——CSS order:1 把日期推到 byline 最後，作者（及頭像等
  //   其餘 item）維持預設 order:0 排在前，達成「作者排在日期前」（Jimmy 2026-07-02）。
  //   v2.5.6：同一個 byline 的每個日期 item 與夾在兩個日期之間的分隔符都標（見標記處註解）。
  //   v2.5.8：日期所在那一層容器的其餘 item 也標（作者在容器外時；見標記處註解）。
  const BYLINE_DATE_ITEM_ATTR = 'data-jread-byline-date-item';
  // v1.5.28：分類 kicker / eyebrow 標記——標題「之前」、連到分類頁的短連結
  //   （NPR「BUSINESS」→ /sections/business/）。閱讀模式移除（Safari / Firefox
  //   Reader 同做法）。Jimmy 2026-07-02。SECTION_URL_RE：分類頁 URL 慣例（href
  //   不被翻譯，譯後 DOM 照樣命中）。
  const KICKER_ATTR = 'data-jread-kicker';
  const SECTION_URL_RE = /\/(sections?|category|categories|topics?)\//i;
  // 日期訊號（DD Mon YYYY / Mon DD, YYYY / YYYY-M-D / YYYY年M月D日）——byline root
  // 偵測的錨點。閱讀時間（N min(s) read / 閱讀時間 / N 分鐘閱讀）——byline 內隱藏。
  // v1.6.24：第二 alternative（Mon DD, YYYY）補開頭 \b——否則 "Demar 3, 2024"
  // 這類字串內的 "mar 3, 2024" 子字串會誤命中（與第一 alternative 對稱）。
  // v1.7.35：末段加無年份中文日期變體「M 月 D 日」（latepost「07 月 27 日
  // 16:07」實案——新聞站當年文章常省年份，原 regex 中文變體強制 \d{4}年 開頭
  // 全 miss → byline pass 不啟動、collapse 的破壞沒人接管）。誤命中風險受
  // byline zone 約束（掃描限標題與第一段內文之間、direct text < 40 chars）。
  const BYLINE_DATE_RE = /(\b\d{1,2}(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{4}\b)|(\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})|(\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b)|(\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日/i;
  // v1.7.4：相對日期訊號（"5 days ago" / "3 小時前"）——Medium 等站近期文章的
  // byline 只顯示相對日期（無 <time>、無絕對日期字串），BYLINE_DATE_RE 不命中 →
  // byline root 偵測整套 miss → 站點 byline 自帶的垂直 margin 留下（Medium 閱讀
  // 時間列 margin-bottom:18px），byline 下方比正常段距多一段空白（Jimmy 2026-07-10
  // levelup.gitconnected.com 回報）。錨定全字串（^…$，套在 direct text 上）比
  // BYLINE_DATE_RE 的子字串比對嚴——「N days ago」也會出現在內文敘述句裡，
  // 全字串比對 + beforeBody guard 雙保險避免誤標內文。
  const BYLINE_REL_DATE_RE = /^(updated|published|posted)?\s*(about\s+)?(\d+|an?)\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?\s+ago$|^(更新於?|發佈於?|發布於?)?\s*\d+\s*(秒|分鐘|小時|天|日|週|周|個月|年)前$/i;
  // v1.9.11：無年份英文日期（"Sep 20th" / "20 Sep" / "September 3"）——Readwise
  // Reader 對當年文件的 metadata row 只顯示「Sep 20th」（無 <time>、無年份、帶序數
  // 後綴），BYLINE_DATE_RE 強制 \d{4} 全 miss → byline root 偵測整套沒跑 → 閱讀
  // 時間沒藏、作者與閱讀時間黏字（Jimmy 2026-09-21 回報）。與 v1.7.35 中文無年份
  // 變體同一類缺口，但英文版**必須全字串錨定 + 月份名完整列舉**：子字串 + 寬鬆
  // 月份前綴（[a-z.]*）會讓 "Mark 2" / "May 5 people" 這類短文誤命中（帶年份的
  // 變體靠 \d{4} 收斂、無年份沒有這層保險）。比對走 brelDate 同一條切段路徑。
  const BYLINE_MONTH_SRC = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const BYLINE_YEARLESS_DATE_RE = new RegExp(
    '^(?:' + BYLINE_MONTH_SRC + '\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)?\\s+' + BYLINE_MONTH_SRC + '\\.?)$', 'i');
  // v1.7.4：相對日期比對前先按分隔符切段、任一段全字串命中即算——翻譯（Shinkansen
  // →Google MT）常把整列 byline 合併成單一 text node（「閱讀 15 分鐘·5 天前」，
  // 子元素結構消失），全字串錨定被閱讀時間前綴打敗。切段後「5 天前」獨立成段照樣
  // 命中；散文句（「我 3 天前測試過」）無分隔符、切不出純日期段，錨定保障不變。
  const BYLINE_SEG_SPLIT_RE = /[·•‧∙|／/—–]/;
  // v1.7.42：作者行前綴判定抽共用常數——原本 LCA seed 的 authorEl 偵測與相鄰
  // prevSib 作者列兩處各寫一份（同一份事實雙實作），prevSib 版漏 \b、「Bypass…」
  // 開頭誤命中 by。拉丁 alternatives 收尾 \b 防前綴誤中；CJK（作者 / 文／）不加
  // \b（JS \b 以 \w=[A-Za-z0-9_] 邊界定義，對 CJK 字元無意義）。
  const BYLINE_AUTHOR_PREFIX_RE = /^(?:(?:by|words by|written by)\b|作者|文[／/])/i;
  // v1.7.4：中文閱讀時間補 Google 翻譯語序「閱讀 N 分鐘」（原僅「N 分鐘閱讀」）
  // 與簡體形——翻譯後 DOM 的閱讀時間字面不受控，兩種語序 + 繁簡都收
  // v1.9.11：補「裸 N min(s) / N 分鐘」（無 read 後綴；Readwise Reader metadata row
  // 的「2 mins」）。**全字串錨定**（呼叫端一律餵 bnorm 過的整段 textContent）——
  // 子字串比對會誤中「10 minutes ago」「5 min walk」這類片語；byline 區內整顆 item
  // 只有「N mins」＝閱讀時間（或影音長度，同屬非必要 meta）。
  const BYLINE_RT_RE = /\b\d+\s*min(ute)?s?\s+read\b|^\d+\s*min(ute)?s?\.?$|^\d+\s*(分鐘|分钟)$|(閱讀|阅读)\s*(時間|时间)|(閱讀|阅读)\s*\d+\s*(分鐘|分钟)|\d+\s*(分鐘|分钟)(閱讀|阅读)/i;
  // v1.7.4：byline 內純分隔符 item（「·」「|」「—」…）。分隔符的語意是隔開兩個
  // 可見 item；相鄰 item 被隱藏（閱讀時間 / 發稿時刻 / 節目 chip）後分隔符變孤兒
  //（Medium「15 min read·5 days ago」藏掉閱讀時間 → 殘留「· 5 days ago」），
  // 標此 attr 用 CSS 隱藏。
  const BYLINE_SEP_ATTR = 'data-jread-byline-sep';
  // v2.5.52：作者列裡站方用 ::before / ::after 畫的分隔符（「/」「·」「|」…）與空字串裝飾殼。
  // 作者列統一把 wrapper 改成 display: contents、日期項目 order: 1 推到最後，pseudo 自己沒有
  // order（0）→ 留在原位、跟著被移走的項目脫節（ctee「/ / 工商時報 袁顥庭 _ 2026.04.24」：
  // li:not(:last-child)::after 的「/」排到最前；「_」是作者連結 a::after 的圖示字型字元，離線
  // 快照沒載到字型才畫成底線，不在此列）。
  // 標記值為 "before" / "after" / "before after"，CSS 對應那一側 content: none。
  // 只認內容是純分隔符字（BYLINE_SEP_RE）的 pseudo，而且依最終順序位置已經不對（判定見標記處）。
  // 空字串裝飾殼、空白、「By 」這類字、計數器、url()、圖示字型不動——語料庫第一版連這些一起
  // 拿掉，二十幾站作者列的圖示與位置正確的分隔符跟著消失
  // v3.7.11：同一個標記也收「root / wrapper 身上什麼都不畫的空 pseudo」——它們在作者列的
  // flex 容器裡各自是一個項目、白吃一格 gap（npr clearfix、theregister 透明方塊；判定見標記處，
  // 只認量得出來完全不畫東西的，有背景圖 / 底色 / 框線的圖示不動）
  const BYLINE_PSEUDO_SEP_ATTR = 'data-jread-byline-pseudo-sep';
  // 2026-10-07 review B-08：styler 以 CSS display:none 隱藏的標記集合（isVisiblyShown
  // 共用）——新增「標記即隱藏」的 attr 時要一併加進來，否則 firstInk / edge / 標題
  // 錨點會錨在看不見的元素上。
  const STYLER_HIDDEN_MARK_SEL = `[${KICKER_ATTR}], [${BYLINE_RT_ATTR}], [${BYLINE_TIME_ATTR}], [${BYLINE_PROGRAM_ATTR}], [${BYLINE_SEP_ATTR}]`;
  const BYLINE_SEP_RE = /^[·•‧∙|/／\\\-–—,、.。;；:：]+$/;
  // v2.5.9：「標記即隱藏」的元素身上若已有別人寫的 inline `display:… !important`
  // （cleaner 塌 flex / grid 時給窄 cell 的 `inline-block` 與 icon 釘寬、CHILD_DECLS
  // 之外任何 inline !important），樣式表的 `display:none !important` 贏不過它——
  // 標記在、元素照樣顯示（vocus「閱讀 N 分鐘」實測：inline-block !important、
  // rect 87×26）。標記當下把 display 接管成 none：走 NS.inlineSet 登記簿（owner
  // 'styler:hidden-mark'，蓋在 cleaner 那筆之上、restore 時先還回 cleaner 的值、
  // cleaner 再還回站方原值）。只在「inline display 有 !important」時動手
  // ——其餘情況樣式表規則本來就贏，不多寫 inline。
  // 修在隱藏端的理由：cleaner 塌欄跑在 styler 標記之前、當下不知道誰會被藏；
  // 標記點是所有隱藏標記的單一入口（靜態進場與 reapply 都經過）。
  // 這條驗 inline display、不驗站方以其他屬性（visibility / opacity）強制顯示。
  const HIDDEN_MARK_OWNER = 'styler:hidden-mark';
  function takeOverInlineDisplayForHiddenMark(el, snap) {
    const st = el && el.style;
    if (!st || typeof st.getPropertyValue !== 'function') return false;
    const v = st.getPropertyValue('display');
    if (!v || st.getPropertyPriority('display') !== 'important') return false;
    if (Array.isArray(snap)) snap.push({ el, prop: 'display', prev: v, prevP: 'important', owner: HIDDEN_MARK_OWNER });
    setInlineOwned(el, 'display', 'none', 'important', HIDDEN_MARK_OWNER);
    return true;
  }
  // kicker 不經 setMark（標記點自己呼叫 takeOverInlineDisplayForHiddenMark），不列在這裡
  const HIDDEN_MARK_ATTRS = [BYLINE_RT_ATTR, BYLINE_TIME_ATTR, BYLINE_PROGRAM_ATTR, BYLINE_SEP_ATTR];
  // v2.5.9：CSS 畫的分隔點（無文字、無子元素、非媒體、寬高都在 1–8px）。孤兒分隔符
  // 掃描原本只認文字分隔符（bisSep），站方用空 span 畫的小圓點接不到——相鄰 item
  // 被藏後留下懸空的點（vocus「發佈 · 閱讀 N 分鐘」藏掉閱讀時間後行尾剩一個點）。
  // 上限 8px：分隔點實測 3×3；icon（::before 字型圖示 15×26）與頭像遠大於此，不認
  const DOT_SHELL_MAX = 8;
  function isDotShellSep(el) {
    if (!el || el.children.length || (el.textContent || '').trim()) return false;
    if (/^(IMG|PICTURE|TIME|SVG|VIDEO)$/i.test(el.tagName)) return false;
    let r = null;
    try { r = el.getBoundingClientRect(); } catch (_) { return false; }
    return !!r && r.width > 0 && r.height > 0 && r.width <= DOT_SHELL_MAX && r.height <= DOT_SHELL_MAX;
  }
  // v1.7.12：多作者 inline 文字流 item（>= 2 條 <a> + 直接分隔文字、無媒體）。
  // 「A、B、C 以及 D」本質是一句話，byline-item 的 inline-flex（nowrap flex row）
  // 在名字夠寬時（translate-first 常保留英文人名不翻）會把每條連結擠到
  // min-content——名字折成兩行、CJK 分隔符直排（chinatalk Substack 實測）。
  // 此類 item 標本 attr → CSS 回歸 block + 子連結 inline，文字自然換行。
  const BYLINE_INLINE_ATTR = 'data-jread-byline-inline';
  // 時刻訊號：整段直接文字＝「HH:MM(:SS)? (AM/PM)? TZ?」（例 "1:59 PM ET"、
  //   "13:59"、"9:30 a.m. EST"）。冒號是關鍵——日期字串無冒號，故不誤殺日期。
  const BYLINE_TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*[a-z]{0,5}$/i;
  // v2.5.40：日期之後緊接的時刻（同一段文字）。可帶前導分隔符、上午 / 下午這類中文時段、
  //   am / pm、時區縮寫；整段比對，剩餘文字有其他東西（「更新」「· 5 分鐘閱讀」）就不切
  const BYLINE_TRAILING_TIME_RE = /^[,，·•|\-–—]?\s*(上午|下午|中午|晚上|凌晨|早上)?\s*\d{1,2}:\d{2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*([a-z]{1,5}([+-]\d{1,2}(:?\d{2})?)?)?$/i;
  // v0.8.86：responsive embed（relative wrapper + position:absolute iframe 填滿
  // 16:9 padding-bottom hack）的 iframe 標記。apply() 量到 computed
  // position:absolute 的 article iframe 標此 attr，CSS 把它 pin 回 inset:0
  // 填滿 wrapper——否則媒體置中規則的 margin:auto 對 abs-pos iframe 會解出
  // 非零 left/right 把 iframe 推出 wrapper 偏右破版（thenewslens 實證）。
  const FILL_IFRAME_ATTR = 'data-jread-fill-iframe';
  // v1.6.30（#13 insertion invalidation）：stylesheet 內「:has() 錨點選擇器
  // 接萬用後代尾巴（`X:has(...) *`）」是 Chromium style engine 的效能地雷——
  // 只要 stylesheet 內同時存在任一 :has 規則（觸發器）與任一「:has 錨點 + ` *`
  // 尾巴」規則（放大器），reader mode 下每次 DOM 插入都強制整頁 style recalc
  // （wiki 37K 節點實測 600 個中性節點插入 recalc 65s；拔掉放大器後 29ms，
  // 2000×）。SPA 站 hydration / lazy-load 持續插入時這是主要捲動卡頓源。
  // 結構性不變式：**buildCss 內禁止寫「含 :has 的複合選擇器 + 萬用後代尾巴」**
  // ——需要「錨點 + 後代」語意時，一律改成 apply() 期 JS 標記 attr（下列三個
  // marker）+ attr-keyed CSS，動態場景由 remarkDynamicMarkers 接（cleaner 的
  // dynamic-append observer 轉呼）。純錨點（無尾巴）的 :has 規則保留無妨
  // （殘餘成本 0.2ms/插入，換到晚 mount 媒體零 timing 風險）。
  //
  // 三個 marker：
  // 1. EMBED_WRAP_ATTR：aspect 容器（[class*=placeholder/ratio/object-fit]）
  //    內含 iframe = responsive 影片嵌入，豁免 static-flow 配套（取代原
  //    `:not(:has(iframe))` gate，v0.8.155 語意不變）。
  // 2. HEADING_LINK_ATTR：包住 heading 的 <a>（<a><h1>…</h1></a> permalink
  //    形），連結色規則回退 inherit（取代原 `a:has(:is(h1..h6))`，v0.8.129
  //    語意不變）。
  // 3. HIDDENMEDIA_WRAP_ATTR：直接子有被 cleaner 隱藏的 img / picture 的容器，
  //    min-height 解除（取代原 `*:has(> img[data-jread-hidden]) *`，v0.8.59
  //    語意不變）。設定端在 cleaner hide()（隱藏 img/picture 的當下標 parent，
  //    與原 :has 對 data-jread-hidden attr 的反應同刻生效）、cleaner restore()
  //    清除；本檔只負責 CSS 端。
  const EMBED_WRAP_ATTR = 'data-jread-embed-wrap';
  // v2.5.19：背景圖影片佔位殼的「殼」（NS.findBgFacadeFrame 回傳的那一層；播放鍵不標）。
  // 翻頁模式拿它當一張圖看待——不跨頁、單頁 cap（見 paged CSS）。由 markBgFacadeUi 標、
  // restore 與 SITE_UI_ATTR 同一個迴圈移除。
  const FACADE_FRAME_ATTR = 'data-jread-facade-frame';
  // 2026-10-07 review B-01：「class 帶 ratio token 的 aspect 容器」標記。原本四條
  // CSS（aspect-ratio / padding reset、後代 static-flow、::before/::after 中和、
  // > svg spinner 隱藏）與 EMBED_WRAP_CANDIDATE_SEL 共用 `[class*="ratio" i]`
  // **子字串**比對——illustration / decoration / duration / generation /
  // integration / configuration 全命中：`<figure class="illustration"><svg>`
  // 的內容 SVG 被整張藏掉、後代打回 static、站方 ::before 全滅（ltn / New
  // Yorker / CNBC / cna / GitHub 五頁注入 probe 實證：svg display none）。
  // CSS 沒有 token 邊界比對（`~=` 只認整個 class），改由 apply() 的
  // markRatioClassBoxes 用 RATIO_CLASS_TOKEN_RE 標 attr、CSS 改 attr-keyed，
  // 語意（aspect-ratio / ratio-16x9 / AspectRatioContainer / wp-has-aspect-ratio
  // 都命中）不變；晚 mount 的由 remarkDynamicMarkers 補標。placeholder /
  // object-fit 兩個字面不撞英文常用字、維持 CSS 子字串比對。
  const RATIO_CLASS_ATTR = 'data-jread-ratio-class';
  // token 邊界：ratio 前面是字首 / 非字母 / camelCase 大寫 R 前的小寫字母，後面
  // 不接小寫字母（接 -、_、數字、大寫或字尾）。illustration（前 t 後 n）、
  // duration（後 n）不中；aspect-ratio、ratio-16x9、ratio_box、AspectRatioContainer
  // 命中。
  const RATIO_CLASS_TOKEN_RE = /(?:^|[^A-Za-z]|[a-z](?=R))[Rr]atio(?![a-z])/;
  // v1.8.2：lazy 影片嵌入（iframe 尚未 mount）的 aspect 佔位框內、被 reader
  // 媒體 static 規則打回 flow 的縮圖 → 標此 attr 讓它恢復「absolute 填滿佔位
  // 框」。與 EMBED_WRAP_ATTR 成對：EMBED_WRAP 豁免祖先端 static-flow 配套
  // （wrapper / play 按鈕回到原站定位），EMBED_FILL 補媒體本體那條全域
  // `img/video { position: static }`（見 markEmbedWrapIframes 註解）。
  const EMBED_FILL_ATTR = 'data-jread-embed-fill';
  // v1.8.2：lazy 影片佔位框到 aspect 容器之間的中繼 wrapper 標記。縮圖恢復
  // absolute 後這些 wrapper 失去唯一的內容寬度來源，shrink-to-fit（原站慣例
  // display:inline-block）會塌成 0 寬 → 佔位框的 padding-bottom 百分比（相對
  // 寬度算）跟著歸零 → 整個影片框消失。強制 block + width:auto 讓寬度回到
  // 「填滿父容器」，佔位框才有比例高度可撐。
  const EMBED_FLOW_ATTR = 'data-jread-embed-flow';
  // v1.8.2：::before / ::after 用垂直 padding 撐 aspect 佔位的容器標記
  // （padding-bottom hack 的 pseudo 版）→ CSS 中和該 pseudo 的佔位高度。
  // 既有中和規則只認 class 含 placeholder / ratio 的容器，無語意 class 的
  // embed wrapper 漏網（見 passAspectPseudoReset 註解）。
  const ASPECT_PSEUDO_ATTR = 'data-jread-aspect-pseudo';
  // v3.7.4：媒體直接容器上的「圖示字型 pseudo」標記（值 'before' / 'after' / 'before after'）
  // → CSS 隱藏該 pseudo。站方把放大鏡 / 播放這類小圖示畫在包圖的外殼的 ::after 上、絕對
  // 定位在圖的角落；JRead 的媒體容器規則把外殼改成 position: static，圖示的定位基準換成
  // 外面某一層、掉到圖下方圖說那行（天下雜誌 span.imgzoom::after，cw_icon 字型 U+E93D，
  // v2.5.40 cage 真站量到）。見 passAspectPseudoReset 尾段
  const ICON_PSEUDO_ATTR = 'data-jread-icon-pseudo';
  // v3.7.13：圖說裡左右邊距不對稱的區塊（newrepublic 署名），見 markCaptionAsymMargins
  const CAP_ASYM_ATTR = 'data-jread-cap-asym';
  // v3.7.11：只靠背景圖畫圖示的空行內元素（plos 通訊作者 `span.email`），背景被清掉後整個
  // 不佔位（標記端見 markMaskedIconPseudos 第二段）
  const BG_ICON_EL_ATTR = 'data-jread-bg-icon';
  const BG_ICON_EL_MAX_PX = 48;
  // v1.8.4：標題自帶的「不可見 ::before / ::after 純間距佔位」標記 → CSS 歸零。
  // 站方常用 heading 的 pseudo 當版面間距 / 曾經的裝飾線（nytimes h1::before
  // { content:""; display:block; height:1px; margin:12px 0 28px } 完全透明、
  // 無 border、無背景），reader 卡片重排後那 41px 就是標題上方的純空白。
  // 只中和「量得出來確實看不見」的（見 passHeadingPseudoSpacerReset）。
  const HEADING_SPACER_BEFORE_ATTR = 'data-jread-heading-spacer-before';
  const HEADING_SPACER_AFTER_ATTR = 'data-jread-heading-spacer-after';
  // v2.5.31：標題自己的上下 padding 是純間距（看不見的盒子）→ 歸零（見 passHeadingPseudoSpacerReset）
  const HEADING_PAD_ATTR = 'data-jread-heading-pad';
  const HEADING_LINK_ATTR = 'data-jread-heading-link';
  const HIDDENMEDIA_WRAP_ATTR = 'data-jread-hiddenmedia-wrap';
  // v2.2.17：cleaner 拉回 flow 的標題覆蓋層內，pseudo 帶暗化遮罩 box-shadow 的元素
  const OVERLAY_PSEUDO_SHADOW_ATTR = 'data-jread-overlay-pseudo-shadow';
  // v2.5.28：cleaner 留文字、去殼的內文按鈕（keepButtonAsText）。attr 字串與 cleaner.js
  // 逐字一致（forcing：button-text-unwrap.spec.js）
  const BTN_TEXT_ATTR = 'data-jread-btn-text';
  // v1.9.16：翻頁模式下由 cleaner 接管位置的選取工具列（pinToolbarOverSelection）。
  // attr 與兩個自訂屬性名稱要跟 cleaner.js 逐字一致（forcing：
  // selection-toolbar-inline-highlight.spec.js）。
  const SEL_TOOLBAR_PIN_ATTR = 'data-jread-seltb-pin';
  const SEL_TOOLBAR_PIN_LEFT = '--jread-seltb-left';
  const SEL_TOOLBAR_PIN_TOP = '--jread-seltb-top';
  // v0.8.49：「div 當段落」標記。部分 CMS（upmedia 等）把主文段落輸出成無
  // class 的裸 <div>（不是 <p>），BODY_TEXT_SEL 列舉的段落 tag 都不命中 →
  // 使用者 fontSize / fontFamily / lineHeight / fontWeight 設定對主文整段失效、
  // 保留站點字級（upmedia 22px vs 設定 18px，體感「特別大」）。CSS 無法選
  // 「直接含文字的 div」，apply() 在 ARTICLE_ATTR 設定前（reader 規則尚未
  // 生效、量得到原站字級）runtime 標記，BODY_TEXT_CORE 把 marker 納入。
  const TEXT_DIV_ATTR = 'data-jread-text-div';
  // v2.5.34：比主流字級小、保留站方字級的段落 div（圖說級），而且 div 裡有 span 以外的
  // 文字（直屬文字或連結）——裡面的 span 不單獨套使用者字級（見 markTextDivs 註解）
  const SMALL_TEXT_DIV_ATTR = 'data-jread-small-text-div';
  // v1.6.12：CJK 為主的內文段落標記——套 text-align: justify（見 markCjkParagraphs）。
  const CJK_JUSTIFY_ATTR = 'data-jread-cjk-justify';
  // v2.5.21：右到左頁面的內文已經大多不是右到左文字（譯成中文後）→ 版面改回左到右
  //（見 evalDirOverride）。掛在 <html>，同時涵蓋 articleEl 與翻譯頁外置的標題 clone。
  const DIR_LTR_ATTR = 'data-jread-dir-ltr';
  // v1.9.12：引言（<blockquote>）視覺補強標記（Jimmy 2026-09-21，Readwise Reader
  // 文件頁「引言跟內文幾乎長一樣」）。JRead 對引言的既有立場是「保留站方設計」
  //（BORDER / BG preserve 清單含 blockquote），但站方若只給斜體 + 小縮排（Reader：
  // italic + padding-left 17px、無邊線無底色），字級 / 字重 / 顏色又被 reader 統一成
  // 內文值後，引言就只剩 17px 縮排可辨識。兩個標記各管一件事、互相獨立：
  //   BQ_PLAIN_ATTR   = 「量得出來沒有任何可見裝飾」的引言 → CSS 補主題色左邊線 +
  //                     1em 左內距。站方已有引言框設計（邊線 / 底色 / 陰影 / 引號
  //                     pseudo）的一律不標、完全不動。
  //   BQ_UPRIGHT_ATTR = CJK 為主、且 computed 為 italic / oblique 的引言 → 取消斜體。
  //                     中文字型沒有真斜體，瀏覽器是機械傾斜（faux oblique），辨識度
  //                     低又傷可讀性；英文引言保留斜體（真 italic 字型、排版慣例）。
  const BQ_PLAIN_ATTR = 'data-jread-bq-plain';
  const BQ_UPRIGHT_ATTR = 'data-jread-bq-upright';
  // v2.5.53：被標成 plain 的引言，站方上下內距大於 1em 的那一側歸零（值 "t" / "b" / "tb"）。
  // plain＝量過沒有框、底色、陰影、可見 pseudo——站方的大內距是留給被清掉的裝飾
  // （aljazeera：padding-top 115px 給絕對定位的引號圖示與波紋圖），剩下的只是空白
  const BQ_PAD_TRIM_ATTR = 'data-jread-bq-pad-trim';
  // v2.5.17：行內 code 不上底色的載體（標題與連結）。base 的歸透明規則與 v2.5.15
  // 非 light 主題的補底色規則共用這一份，避免兩處清單 drift。
  const INLINE_CODE_NO_BG_CARRIERS = 'h1, h2, h3, h4, h5, h6, a';
  // v1.6.23：內文裝飾性大寫 / 加寬字距標記——重設回一般（見 markDecorativeInlines）。
  const DECOR_RESET_ATTR = 'data-jread-decor-reset';
  // v2.5.30：站方用行內元素包起來的段首放大首字（見 markLeadLetterSpans）
  const LEAD_LETTER_ATTR = 'data-jread-lead-letter';
  // v2.5.34：站方用背景圖畫在連結一側的小圖示（外部連結箭頭等）＋同側 padding 留位。
  // 閱讀模式清掉背景圖後留位還在。值 "l" / "r"＝要歸零的那一側（見 markIconPadLinks）
  const ICON_PAD_ATTR = 'data-jread-icon-pad';
  // v1.7.8：inline-flow <p> 標記——豁免 v0.7.201 水平 padding reset（見
  // markInlineFlowParagraphs）。
  const INLINE_FLOW_P_ATTR = 'data-jread-inline-flow-p';
  // v1.7.45：absolute / fixed 定位元素標記——豁免 v0.7.48 的全域 left/right:auto
  // inset 清除（見 markAbsAnchors）。該清除的設計前提是「position:relative 保留、
  // 無 offset 時等於 static 視覺」，只對 relative 成立；absolute 元素的 left/right
  // 是錨點，清成 auto 會讓元素跳回 static position（WaPo 日期輪播實證：短日期
  // span absolute left:0 錨在 overflow:hidden 裁切窗左上、長日期 in-flow span 被
  // 站方 translateY(-110%) 移出窗——left 被清後短日期飛到窗外，日期整個消失）。
  const ABS_ANCHOR_ATTR = 'data-jread-abs-anchor';
  // v2.5.14：直向 flex 容器的直接子 <pre>（見 markFlexColumnPres）
  const PRE_FLEX_STRETCH_ATTR = 'data-jread-pre-flex-stretch';
  // v2.5.24：站方 float 的文字方塊（側欄補充、拉出的引文）在閱讀模式清掉 float 後
  // 留下站方釘的固定寬，變成半欄寬的一段——標記後寬度改回撐滿版心（見
  // markDefloatedTextBoxes）
  const DEFLOAT_TEXT_ATTR = 'data-jread-defloat-text';
  // v3.7.7：清單縮排不夠放外側項目符號（見 markListMarkerIndent）
  const LIST_INDENT_ATTR = 'data-jread-list-indent';
  // v3.7.7：站方 ::before / ::after 寫的操作提示字（「Tap or hover # to scale」），值 before / after /
  // both（見 markUiHintPseudo）
  const UI_HINT_PSEUDO_ATTR = 'data-jread-ui-hint';
  const DEFLOAT_TEXT_MIN_CHARS = 80;
  const DEFLOAT_TEXT_SEL = 'aside, div, section, blockquote';
  const DEFLOAT_TEXT_BLOCKER_SEL = 'img, picture, video, audio, iframe, canvas, object, embed, table, pre, figure';
  // v3.7.6：通用 `float: none` 的兩種副作用（見 markSiteFloatSideEffects）
  //   KEEP_FLOAT_ATTR（值 left / right）＝站方 float 的短字標記（腳註編號、參考文獻編號）
  //     → 保留站方 float，編號掛在文字旁、不黏字
  //   FLOAT_BLOCK_ATTR＝本來靠 float 變成區塊的行內元素（Docusaurus 程式碼 <code>）
  //     → display: block，內距照站方
  const KEEP_FLOAT_ATTR = 'data-jread-keep-float';
  const FLOAT_BLOCK_ATTR = 'data-jread-float-block';
  const SITE_FLOAT_SEL = 'span, a, b, strong, em, i, small, label, code, sup, dt';
  const KEEP_FLOAT_MAX_CHARS = 60;
  const KEEP_FLOAT_MAX_WIDTH_RATIO = 0.5;
  const KEEP_FLOAT_MAX_FS_RATIO = 1.5;  // 字比父層大這麼多＝首字放大（drop cap），不保留
  const FLOAT_BLOCK_MIN_WIDTH_RATIO = 0.7;
  const FLOAT_BLOCK_MIN_PARENT_W = 200; // 窄格裡的 float（arxiv 公式編號格 24px）不動
  // v2.5.23：橫向 flex 容器裡唯一的子層、裡面裝著程式碼區塊 → 撐滿（見 markFlexRowCodeShells）
  const CODE_FLEX_FILL_ATTR = 'data-jread-code-flex-fill';
  // v2.5.23：圖說與它上方那張圖的間距收緊（規則與標記見 buildCss / markCaptionMedia）
  const CAP_MEDIA_ATTR = 'data-jread-cap-media';   // 圖說上方的媒體，與它到共同容器之間的包裝
  const TABLE_FIT_ATTR = 'data-jread-table-fit';  // v2.5.25：被縮字級塞進卡片的表（值＝縮放比例）
  // 還原一張被縮字級的表（fitTableFont 的一筆紀錄）：反序寫回 inline、拿掉標記
  // v2.5.30：還原 passAbsFillShellFlow 寫在容器與外殼上的四個 inline 值
  //（pass 內量測不過時、與 restore() 共用）。
  const restoreAbsFillShell = (r) => {
    if (!r || !r.el || !r.shell) return;
    const put = (node, prop, v, pr) => {
      if (v) node.style.setProperty(prop, v, pr || '');
      else node.style.removeProperty(prop);
    };
    put(r.el, 'height', r.height, r.heightPriority);
    put(r.el, 'aspect-ratio', r.aspectRatio, r.aspectRatioPriority);
    put(r.shell, 'position', r.shellPosition, r.shellPositionPriority);
    put(r.shell, 'height', r.shellHeight, r.shellHeightPriority);
  };

  const restoreTableFitEntry = (f) => {
    if (!f || !f.table) return;
    const snaps = f.snaps || [];
    for (let k = snaps.length - 1; k >= 0; k--) {
      const a = snaps[k];
      if (!a || !a.el) continue;
      if (a.value) a.el.style.setProperty(a.prop, a.value, a.priority || '');
      else a.el.style.removeProperty(a.prop);
    }
    f.table.removeAttribute(TABLE_FIT_ATTR);
  };
  const CAP_BELOW_ATTR = 'data-jread-cap-below';   // 排在媒體下方的 figcaption（"1" / "pad"）
  // v2.5.36：不是 <figcaption> 的圖說（div 小字緊接在大圖下方，見 findDivCaption）。
  // 同時帶 CAP_BELOW_ATTR（間距規則）與本標記（置中 / 字級 / 顏色規則）
  const CAP_DIV_ATTR = 'data-jread-cap-div';
  const CAP_MEDIA_PAD_ATTR = 'data-jread-cap-media-pad'; // div 圖說上方包裝殼的下內距歸零
  // v2.5.16：主文內帶 shadow root 的自訂元素（見 markShadowHosts）
  const SHADOW_HOST_ATTR = 'data-jread-shadow-host';
  // v1.7.70：pre-wrap 硬換行切出的段落載體標記（見 splitPreWrapParagraphs）。
  const PREWRAP_PARA_ATTR = 'data-jread-prewrap-para';
  // v2.4.9：站方對 ::first-letter 設了與段落不同的顏色（drop cap 顯式色）的元素。
  // 主文 ::first-letter 顏色修正（v0.8.137）只套在帶這個標記的元素上，見
  // markFirstLetterColorBlocks。
  const FIRST_LETTER_ATTR = NS.FIRST_LETTER_ATTR; // 'data-jread-first-letter'（單一資料源在 namespace.js）
  // v2.5.24：站方放大首字（float 的 ::first-letter）在閱讀模式下墨跡壓到下一行時的
  // 重排標記。值 'c2'..'c5'（CJK 首字，佔 N 行）/ 'l2'..'l5'（拉丁首字）/ 'off'
  //（CJK 首字連同標點一起被放大 → 取消放大）。見 dropCapPlan。
  const DROP_CAP_ATTR = 'data-jread-drop-cap';
  // v2.5.24：站方對 ::first-line 下了與段落不同的字距 / 字體 / 顏色的元素。見
  // firstLineDiverges。
  const FIRST_LINE_ATTR = 'data-jread-first-line';
  // v3.7.7：站方放大首字外面畫了框線（float 的 ::first-letter 帶 border）的元素——框線與
  // 框內距拿掉、放大留著（nautil.us `is-style-drop-cap-with-border`，Jimmy 2026-11-27 裁定）。
  // 見 markDropCapBlocks
  const DROP_CAP_FRAME_ATTR = 'data-jread-drop-cap-frame';
  // v2.4.10：JRead 接手 ::selection 底色（站方底色不透明；v2.5.46 起含站方沒有選取
  // 底色）。標在 <html>，見 markSiteSelectionBg
  const SEL_BG_ATTR = 'data-jread-sel-bg';

  // v0.8.35：媒體 display/cap 規則的 selector 群——base（90vh cap）與翻頁模式
  // （單頁 cap 覆寫）共用同一份。翻頁模式覆寫靠「同 selector、同 specificity、
  // 同 stylesheet 後注入者勝」。原 bug：翻頁媒體規則用 html 前綴、specificity
  // (0,2,2)，輸給 base 的 (0,3,3)（:not(a > img) 依 Selectors 4 取引數最高
  // specificity 計入 2 個 type、加 3 個 attribute），兩邊都 !important →
  // specificity 高者勝、base 90vh 蓋掉翻頁單頁 cap——裸 img（非 a 包）站的
  // 直式長圖有效上限 90vh > 欄高、break-inside: avoid 對高於 fragmentainer
  // 的元素失效、圖被跨頁切割。a-wrapped 大圖走 content-img rule (0,2,1)、
  // 翻頁規則本來就贏，所以 Substack 類測試站全綠、裸 img 站才現形。
  // 抽常數讓兩處逐字同一份，杜絕 selector drift。
  const MEDIA_CAP_SEL =
    `[${ARTICLE_ATTR}="1"] img:not(a > img):not([${PLAYER_ATTR}="1"]):not([${INLINE_IMG_ATTR}]),
[${ARTICLE_ATTR}="1"] video:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] picture:not([${PLAYER_ATTR}="1"])`;

  // v0.8.37：preserve `:not()` 鏈由共用 tag 群組生成（原本三條鏈各自手寫、
  // 已實際 drift 過一次：v0.7.195 TWZ figcaption——bg strip 排除了 figcaption、
  // color inherit 沒跟上，圖說白字配深底變不可讀）。三條鏈的集合「刻意」不同：
  //   - bg / border strip 保留 figure/summary/blockquote 的原站背景與框線
  //   - color inherit 不排除它們（引述等文字要繼承 reader text color）、
  //     但排除 a（連結色另有顯式規則）與 figcaption（背景文字成對保留）
  // 改 tag 群組時三條鏈自動同步；要改單一鏈的集合請動下方組合、不要繞過群組。
  const TABLE_TAGS = ['table', 'thead', 'tbody', 'tr', 'th', 'td'];
  const CODE_TAGS = ['code', 'pre'];
  const INLINE_SEMANTIC_TAGS = ['mark', 'kbd'];
  const MEDIA_SEMANTIC_TAGS = ['figure', 'figcaption', 'summary', 'blockquote'];
  const BG_ICON_EL_KEEP_SEL = [...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS, ...INLINE_SEMANTIC_TAGS,
    'img', 'picture', 'video', 'svg', 'canvas', 'iframe', 'input', 'button', 'select', 'textarea'].join(', ');
  const notChain = (tags) => tags.map((t) => `:not(${t})`).join('');
  const BG_PRESERVE_NOT = notChain([...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS, ...INLINE_SEMANTIC_TAGS]);
  const BORDER_PRESERVE_NOT = notChain([...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS, ...INLINE_SEMANTIC_TAGS, 'hr']);
  const COLOR_PRESERVE_NOT = notChain(['a', ...CODE_TAGS, ...TABLE_TAGS, ...INLINE_SEMANTIC_TAGS, 'figcaption']);

  // v0.8.37：垂直 gutter 單一資料源——base 卡片 padding / 翻頁卡片「下緣」padding /
  // 翻頁媒體單頁 cap 的 calc 必須同一值（與 H_GUTTER 同款 drift 防護；v0.8.1
  // 事故：改了連續模式 gutter、翻頁漏改，兩模式行寬 drift）。
  // v1.5.2：翻頁卡片「上緣」改用 PAGED_TOP_GUTTER（較小）——其餘三處仍是 V_GUTTER。
  // v2.2.12：翻頁卡片「下緣」與媒體單頁 cap 改用 --__jread-paged-bottom（= max(V_GUTTER,
  // 頁碼離底 + 頁碼高 + 間隔)，見 pagedMode 區塊 _pagedBottomGutter），V_GUTTER 為其下限。
  const V_GUTTER = 'min(48px, 6vw)';
  // v1.5.2：分頁模式「上緣」gutter——比 V_GUTTER 收斂，把拿掉頂端進度條後騰出的
  // 區域讓給文章排版（文章往上長、每頁多容幾行；Jimmy 2026-06-27）。只收上緣、
  // 下緣維持 V_GUTTER 給底部頁碼指示器留呼吸空間（上下不對稱由底部頁碼平衡）。
  // 保留 ~16px 上緣不貼齊螢幕頂、避免首行壓到 Safari 工具列收合動態邊。
  const PAGED_TOP_GUTTER = 'min(16px, 2vw)';
  // v1.5.3：reader 文章頁（article feed 點進的單篇，NS.state.readerHostPage）拿掉
  // 左上角返回箭頭後，捲動模式卡片「上緣」同樣收斂——與翻頁上緣共用同一「頂端無
  // chrome 時的緊縮上緣」值（單一資料源、避免兩處 drift），標題往上移、每屏多容幾行。
  // 只套 reader 文章頁；一般網站閱讀模式維持 V_GUTTER（opts.readerHostPage gate）。
  const READER_HOST_TOP_GUTTER = PAGED_TOP_GUTTER;
  // 大內容圖（lightbox / photoswipe 等 `<a>` 包圖結構）標記：apply() runtime 量到
  // >= CONTENT_IMG_MIN 的 a-wrapped img 標 [CONTENT_IMG_ATTR]，讓 block + margin
  // 規則對它生效（一般 img:not(a > img) 排除把這類大圖當 icon-link 漏掉）。
  const CONTENT_IMG_ATTR = 'data-jread-content-img';
  const CONTENT_IMG_MIN = 200; // 任一維 >= 200px 視為內容照片、非 icon（icon 規則上限 200）
  // v0.8.112：bare img（非 a 包）來源解析度小於版心時的「放大填滿欄寬」標記。
  // 站點常把低解析配圖（natural < 版心寬）以原尺寸或小幅放大顯示——reader 的
  // img:not(a>img) 走 width:auto 退回 naturalWidth，這類圖在 720 版心裡顯得特別
  // 小、與 a 包大圖（填滿欄寬）視覺不一致（womany 卡蘿配圖 natural 285px portrait
  // 在 608px 欄中只佔半寬實證）。apply() 量到 content-size（>= CONTENT_IMG_MIN 一維）
  // 的 bare 圖標此 attr、CSS 強制 width:100% 撐滿欄寬。與 a 包 content-img 視覺一致
  // （Safari / Firefox 閱讀模式同款「內容圖一律填欄寬」）。capIcon（natural >> rendered
  // 的作者刻意縮小大圖）已在分類前攔截、不會落到這裡被反向放大成滿版。
  const UPSCALE_IMG_ATTR = 'data-jread-upscale-img';

  // 內嵌襯線 CJK 字型（Noto Serif TC 全 TC 集，woff2）。
  // 為什麼必須內嵌：iOS Safari「網頁路徑」的預設襯線字型缺「夠」「查」等常用字的
  // 字形，這些字 fall back 到蘋方黑體（iOS 模擬器實證）；且 Safari 網頁不理會
  // CSS 指定的系統字型名稱（"Songti TC" 等一律 resolve 到那套有缺漏的預設 serif），
  // 所以「只點名不載入」在 iOS 上無效。@font-face 把字型實體載進來、由 JRead 自己
  // 掌控覆蓋率，才能跟 iOS 內建閱讀模式一樣零缺字。family 名稱用 "Noto Serif TC"
  // 對齊 popup 襯線 stack 裡的 CJK family 名（v0.8.25 起西文襯線 Georgia/Times 排在
  // 前面、英文 fall back 到 Georgia；中文逐字 fallback 穿到此內嵌字型）。
  //
  // v0.7.257：三個真實字重各一個靜態字面（Light 300 / Regular 400 / SemiBold 600，
  // 同一份 6606 字覆蓋、由 Noto Serif TC 可變字型 pin 出）。為什麼不能沿用舊版
  // 單一 face + 一個涵蓋 100~900 整段範圍的 weight 宣告：那寫法告訴瀏覽器「這一個
  // 字面已涵蓋整段範圍」，於是使用者選的細(300)/中(400)/粗(600) 全被對映到同一字面、
  // 且關閉 faux-bold 合成——襯線字重三段渲染完全相同（Jimmy 2026-06-08 回報「襯線
  // 字重沒效果」的根因；無襯線走系統字 PingFang/JhengHei 有真實多字重故正常）。字重
  // 無法無中生有（瀏覽器只能合成較粗、不能變細），故三段都內嵌真實字面才能各有差別。
  // 三檔都用 font-display: swap + lazy-load——只有選「襯線」用到此 family 時才下載，
  // 預設無襯線使用者零成本。chrome.runtime.getURL guard：extension context 失效時退回
  // 空字串（不注入）。三個 @font-face 同 family 名、各自 font-weight 單值，瀏覽器依
  // BODY_TEXT_SEL 注入的 font-weight 精準命中對應字面。
  // v2.5.28：字重「粗」實際渲染的粗細（Jimmy 2026-11-19：「粗太粗，調到中和粗的中間」）。
  // 設定值不變——fontWeight 存的是「哪一段」（300 細 / 400 中 / 600 粗），不是 CSS 值；
  // 沿用 600 當「粗」的代號，既有使用者、設定檔、跨裝置同步都不用遷移，舊版裝置讀到
  // 也還是合法值。渲染時才換成 500（Medium）：
  //   - 蘋方（macOS / iOS）有真的 Medium 字面；Safari 的系統字是連續粗細。Chrome 上
  //     蘋方只有 300 / 400 / 500 / 600 四個字面，400 與 600 之間唯一的一階就是 500
  //     （550 會被合成成假粗體、比 600 還重，實測，不可用）
  //   - 內嵌襯線補了 Medium 500 字面；內嵌拉丁字型是可變字型
  //   - Windows 例外、維持 600：微軟正黑體沒有 500 字面，500 會落回 400、「粗」就
  //     跟「中」一樣（v0.7.254 當初選 600 的理由）
  const BOLD_RENDER_WEIGHT = 500;
  function isWindowsPlatform() {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (!nav) return false;
      const p = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '';
      return /^win/i.test(p);
    } catch (e) { return false; }
  }
  function renderWeightFor(settingWeight) {
    const w = Number(settingWeight);
    if (w === 600) return isWindowsPlatform() ? 600 : BOLD_RENDER_WEIGHT;
    return w;
  }

  let FONT_FACE_CSS = '';
  try {
    if (browser && browser.runtime && browser.runtime.id && browser.runtime.getURL) {
      const faces = [
        { weight: 300, file: 'noto-serif-tc-light.woff2' },
        { weight: 400, file: 'noto-serif-tc-regular.woff2' },
        // v2.5.28：Medium 500——字重「粗」實際渲染的粗細（見 BOLD_RENDER_WEIGHT）。
        // 同一份 6606 字、同一個可變字型來源 pin 出。SemiBold 600 留著：內文的
        // <strong> / <b>（bolder → 700）與 Windows 的「粗」仍落在它身上
        { weight: 500, file: 'noto-serif-tc-medium.woff2' },
        { weight: 600, file: 'noto-serif-tc-semibold.woff2' },
      ];
      FONT_FACE_CSS = faces.map((f) => `@font-face {
  font-family: "Noto Serif TC";
  font-style: normal;
  font-weight: ${f.weight};
  font-display: swap;
  src: url("${browser.runtime.getURL('assets/fonts/' + f.file)}") format("woff2");
}
`).join('');
    }
  } catch (e) {
    FONT_FACE_CSS = '';
  }

  // v0.8.146：內嵌拉丁可變字型（Latin-subset woff2，皆 OFL）。襯線群 Source Serif /
  // Piazzolla、無襯線群 Public Sans / Source Sans——由 popup「英文字型」
  // 選單選定（latinSerif / latinSans），composeFontStack 把選定 family 前接到 base
  // stack 前，故 opts.fontFamily 會含 "Family" 字面。family 名對齊 LATIN_FONTS 的值。
  //
  // 與 Noto 三靜態字面不同：這五支都是真·可變字型（wght 軸），單一 @font-face 用
  // weight range 即真實多字重（細 300 / 中 400 / 粗 600 各有差別），不會踩 v0.7.257
  // 那個「單一字面涵蓋整段 weight → 三段渲染相同」的坑（範圍是字面真實 fvar 軸、
  // 非假裝涵蓋的靜態 pin）。font-display: swap + lazy-load——@font-face 只在 stack
  // 實際引用該 family 時才下載，故只注入「被選到」的那一支（latinFontFaceFor 掃描
  // opts.fontFamily），不像 Noto 三檔同 family 必須一起宣告。
  const BUNDLED_LATIN_FACES = {
    'Source Serif': { file: 'source-serif.woff2', range: '200 900' },
    'Piazzolla':    { file: 'piazzolla.woff2',    range: '100 900' },
    'Public Sans':  { file: 'public-sans.woff2',  range: '100 900' },
    'Source Sans':  { file: 'source-sans.woff2',  range: '200 900' },
  };
  function latinFontFaceFor(fontStack) {
    if (!fontStack) return '';
    let css = '';
    try {
      if (browser && browser.runtime && browser.runtime.id && browser.runtime.getURL) {
        for (const family of Object.keys(BUNDLED_LATIN_FACES)) {
          if (fontStack.indexOf('"' + family + '"') === -1) continue;
          const def = BUNDLED_LATIN_FACES[family];
          css += `@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: ${def.range};
  font-display: swap;
  src: url("${browser.runtime.getURL('assets/fonts/' + def.file)}") format("woff2");
}
`;
        }
      }
    } catch (e) {
      css = '';
    }
    return css;
  }

  // 2026-10-07 review B-15：fontFamily 是唯一原樣內插進 stylesheet 的使用者字串
  //（數值欄位 v0.7.143 起都有 clamp）。storage.sync 若被外部寫入 / 損壞成
  // `x; } html { display:none } /*` 之類，會整頁壞版（CSS 無法執行 script、
  // injectCssText 走 textContent，無外洩面；但「設定同步進來就壞版」仍是洞）。
  // 第二道防線用 **font-family 值的文法**而不是字面清單：合法值只會是
  // 「逗號分隔、每項為引號字串或 ident 序列」（system-ui / -apple-system /
  // "PingFang TC" / Palatino, "Palatino Linotype" …），`; { } ( ) / \` 這些能
  // 改寫 CSS 結構的字元在合法 font-family 裡沒有位置。不用 FONT_STACKS 清單
  // 比對的理由：styler 在 reader 擴充頁 / 測試環境不一定載得到 settings-defaults
  // 的全域，而文法閘不依賴載入順序、也不會因 LATIN_FONTS 增刪而 drift（語意上
  // 「值是否在選單內」是 popup 的事，這裡只擋結構注入）。不合法一律退 DEFAULTS。
  const FONT_FAMILY_MAX_LEN = 512;
  const FONT_FAMILY_ITEM_RE = /^(?:"[^"\\\n]*"|'[^'\\\n]*'|[\w\u00a0-\uffff-]+(?:[ \t]+[\w\u00a0-\uffff-]+)*)$/;
  function sanitizeFontFamily(v) {
    if (typeof v !== 'string') return null;
    const str = v.trim();
    if (!str || str.length > FONT_FAMILY_MAX_LEN) return null;
    for (const raw of str.split(',')) {
      if (!FONT_FAMILY_ITEM_RE.test(raw.trim())) return null;
    }
    return str;
  }

  // 預設值。v1.7.33（Jimmy 2026-08-03）起預設值改為 Jimmy 慣用組合，「預設＝
  // 不注入」語意與預設值脫鉤——不注入改由明確 sentinel 判定：fontSize /
  // titleFontSize 0、lineHeight 0、paragraphSpacing -1、fontFamily 'system-ui'
  //（系統預設）、theme 由 theme.text 是否為 null 決定（light 天生不注入文字色）。
  // 見 apply 內 overrides 計算。
  const DEFAULTS = {
    theme: 'gray',
    fontSize: 17,
    contentWidth: 720,
    // 與 settings-defaults.js FONT_STACKS.sans 逐字一致（defaults-sync spec 校對）
    fontFamily: '-apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Helvetica Neue", sans-serif',
    // v0.7.254：字重三段。300 = 細 / 400 = 中（預設）/ 600 = 粗（Semibold）。改用
    // 真正的 font-weight（取代 v0.7.157 boldText 的 -webkit-font-smoothing——後者
    // 只在 macOS 有視覺差異，Windows / Linux / iOS 看不出來，與 Jimmy「全平台適用」
    // 需求衝突）。三段一律注入（含 400）——見 buildCss 內 font-weight 注入註解。
    fontWeight: 400,
    lineHeight: 1.5,
    // 段落間距（p / ul / ol / blockquote margin-bottom，em 為單位）。預設 1.0em
    // 對齊 user-agent stylesheet p margin，貼近大眾預期；多數新聞站本來就有此
    // margin、覆寫差別極小，BBC styled-components 把 p margin 砍光從 0 變 1em
    // 是明顯改善。popup 可調 0 ~ 3.0、auto sentinel = -1（不注入此規則保留原站）。
    paragraphSpacing: 1.0,
    // 中英文字之間自動補空白（盤古之白）。預設 true—— 大部分台灣 / 港澳 / 中文
    // 讀者習慣這種視覺節奏，原始網站常缺空格（特別是 CMS / SPA 編輯器寫入時）。
    // 使用者可到 options 取消。詳見下方 pangu module。
    pangu: true,
    // 標題字級（h1）。0 = Auto（保留原站標題大小）；非 0 = 強制覆寫 h1
    // font-size 為該 px 值。使用者 body fontSize 調到 40px+ 時原站 h1 常只有
    // 30-36px，標題反而比內文小——此設定讓使用者自訂標題大小。
    // v1.7.33：預設 32（0 仍是合法 Auto sentinel）。
    titleFontSize: 32,
    // v1.7.37：頂端進度條皮膚。'hairline' = 歷代行為（3px 純色實心條）。
    // v1.7.53：預設改 'gradient'（見 settings-defaults.js 註解）。
    // v2.3.0：左右對齊三段 'off' | 'cjk'（= v1.6.12 起既有行為）| 'all'。v2.5.45 預設改 'off'。
    // 語意見 settings-defaults.js DEFAULT_SETTINGS.textJustify 註解。
    textJustify: 'off',
    progressBarStyle: 'gradient'
  };

  // v1.7.37：合法皮膚白名單。正本在 content/settings-defaults.js（manifest
  // content_scripts 順序排在 styler.js 之前，實務上一定已掛上 globalThis）；
  // 這裡的 literal 只是 shared 缺席時的保險，兩份一致由 defaults-sync spec 守。
  const PROGRESS_BAR_STYLES =
    (typeof globalThis !== 'undefined' && globalThis.__JReadProgressBarStyles) ||
    ['gradient', 'hairline', 'outline', 'track', 'thick'];
  // v2.3.0：textJustify 合法值，同上（正本在 settings-defaults.js）
  const TEXT_JUSTIFY_MODES =
    (typeof globalThis !== 'undefined' && globalThis.__JReadTextJustifyModes) ||
    ['off', 'cjk', 'all'];

  // 主題配色：僅 dark / sepia 會注入文字 + 卡片底色覆寫；light 不碰原站色
  //   link：dark / sepia 下因 `* { color: X }` 吞掉原站 link 顏色，導致內文連結
  //   跟正文完全同色無法辨識。必須回補一個在該 theme 下夠對比的 link 色。
  //   light 不注入（light 連文字色都不注入，保留原站 link 色）。
  //   dark #7fb5e6：在 #1a1a1a 底對比 > 7:1
  //   sepia #2c5282（JRead primary-700）：在 #eee2cb 底對比 > 6:1
  //   scrollThumb：v0.7.90 auto-hide scrollbar 顯色用，配 page bg 對比夠辨識
  //   又不過度搶眼。dark theme 用淺色 thumb、light/sepia 用深色 thumb。
  const THEMES = {
    // v0.8.143：白色閱讀區內文段落字色對齊 Apple Books 純黑 #000000（Jimmy 截圖
    //   逐像素採樣：背景 #ffffff、內文 glyph core 主色 #000000）。light 維持
    //   text: null（仍是「保留原站色」主題、保留 pre/table 對比保護 + figcaption
    //   #333 機制），另用 proseText 只對內文段落容器（p / 標題 / li …）強制黑字，
    //   不碰 pre/code/table/figcaption/彩色 inline span（Jimmy 選折衷方案）
    light: { pageBg: '#ececec', articleBg: '#ffffff', text: null, proseText: '#000000', link: '#1a73e8', scrollThumb: 'rgba(0, 0, 0, 0.3)', inlineCodeBg: 'rgba(0,0,0,0.06)', codeBlockBg: 'rgba(0,0,0,0.05)', progressBar: '#4A90D9' },
    // v0.8.143：暗色閱讀區配色對齊 Apple Books——底 #4a494d、內文 #ecebf1
    //   （Jimmy 截圖逐像素採樣：背景主色 #4a494d 帶微冷調、內文 #ecebf1）。
    //   原 #1a1a1a/#d4d4d4 偏黑，Apple Books 是中性偏亮的深灰底 + 近白字
    dark:  { pageBg: '#0b0b0b', articleBg: '#4a494d', text: '#ecebf1', link: '#7fb5e6', scrollThumb: 'rgba(255, 255, 255, 0.3)', inlineCodeBg: 'rgba(255,255,255,0.1)', codeBlockBg: 'rgba(0,0,0,0.22)', progressBar: '#7fb5e6' },
    // v0.8.143：米色閱讀區配色對齊 Apple Books——底 #eee2cb、內文純黑 #000000
    //   （Jimmy 截圖逐像素採樣：背景 5 點皆 #eee2cb、內文 glyph core 主色 #000000）
    sepia: { pageBg: '#cdb891', articleBg: '#eee2cb', text: '#000000', link: '#2c5282', scrollThumb: 'rgba(60, 50, 38, 0.45)', inlineCodeBg: 'rgba(60,50,38,0.08)', codeBlockBg: 'rgba(60,50,38,0.1)', progressBar: '#2c5282' },
    // v0.8.143：灰色主題對齊 Apple Books 灰色配色——底 #ededed、內文純黑 #000000
    //   （Jimmy 截圖逐像素採樣：背景 #ededed、內文 glyph core 主色 #000000）。
    //   中性灰、無暖色；text 非 null 故比照 dark/sepia 注入文字 + 卡片色覆寫
    gray:  { pageBg: '#d8d8d8', articleBg: '#ededed', text: '#000000', link: '#2c5282', scrollThumb: 'rgba(0, 0, 0, 0.3)', inlineCodeBg: 'rgba(0,0,0,0.06)', codeBlockBg: 'rgba(0,0,0,0.08)', progressBar: '#2c5282' },
    // v2.3.0：夜藍主題（Jimmy 2026-11-07 截圖需求）——深藍黑底 + 淺藍灰字。卡片底
    //   #0f1821 = 截圖背景主色取樣；內文 #cdd5df = 截圖 glyph 最亮像素一帶（截圖
    //   282px 寬的 JPEG、抗鋸齒壓低亮度，取亮端）；頁面底比卡片再暗一階。link
    //   #6ea8e6 在 #0f1821 底對比 > 7:1。其餘欄位比照 dark（淺色 thumb / 白半透明
    //   inline code 底）。text 非 null → 與 dark / sepia / gray 同走注入路徑
    night: { pageBg: '#070b10', articleBg: '#0f1821', text: '#cdd5df', link: '#6ea8e6', scrollThumb: 'rgba(255, 255, 255, 0.28)', inlineCodeBg: 'rgba(255,255,255,0.08)', codeBlockBg: 'rgba(0,0,0,0.3)', progressBar: '#6ea8e6' }
  };

  // '#rrggbb' 兩色線性混色（w = a 的權重），回傳 '#rrggbb'
  function mixHex(a, b, w) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) * w + ((pb >> sh) & 255) * (1 - w));
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  // v2.5.47：#rrggbb → rgba(r, g, b, a)（選取底色要半透明，見 SEL_BG_ATTR 規則註解）
  function rgbaHex(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function themeOf(name) {
    // v1.7.42：非法值 fallback 對齊 DEFAULTS.theme（gray）——原本硬寫 light，
    // storage 損壞 / 外部寫入未知字串時使用者拿到的主題與「從未設定過」不一致
    return THEMES[name] || THEMES[DEFAULTS.theme];
  }

  // v0.8.24：覆蓋 <meta name="theme-color">——iOS Safari 拿這個 meta 的色去染
  // 狀態列與底部工具列（網頁背景以外的「瀏覽器 chrome」區域）。原站宣告的品牌色
  // （chinatalk.media #f9eedc 米色實測）在閱讀模式下會在螢幕上下端露出，與 reader
  // card 不一致（特別是分頁模式 card 滿版 inset:0、上下米條格外突兀）。閱讀模式下
  // 把所有 theme-color meta 的 content 改成 reader card 色（theme.articleBg），退出
  // 還原。通則：對任何有宣告 theme-color 的站一律生效，不綁站點。
  //
  // 站點可能宣告多個 theme-color（light / dark media 變體）——全部覆蓋成同一個
  // JRead 色（reader card 色不隨裝置 scheme 變，覆蓋後不論 Safari 選哪個都是 JRead
  // 色）。完全沒宣告時自建一個（Safari 預設用白底染 chrome，自建才染得到 reader 色）。
  // 回傳 snapshot 供 restore：created=true 的移除、其餘還原原 content。
  // v1.7.43 T11：meta tag 覆寫共用機制（theme-color / viewport 原兩段同構重複
  // 收斂）。站上同名 meta 全部覆寫成 content（多宣告全蓋）、完全沒宣告時自建
  // 一個；回傳 snapshot 供 restoreMetaTag：created=true 的移除、其餘還原原 content。
  function overrideMetaTag(name, content) {
    if (typeof document === 'undefined') return null;
    const head = document.head || document.documentElement;
    if (!head) return null;
    const snap = [];
    const existing = head.querySelectorAll('meta[name="' + name + '"]');
    if (existing && existing.length) {
      for (const m of existing) {
        snap.push({ el: m, prev: m.getAttribute('content'), created: false });
        m.setAttribute('content', content);
      }
    } else {
      const m = document.createElement('meta');
      m.setAttribute('name', name);
      m.setAttribute('content', content);
      head.appendChild(m);
      snap.push({ el: m, prev: null, created: true });
    }
    return snap;
  }
  function restoreMetaTag(snap) {
    if (!Array.isArray(snap)) return;
    for (const s of snap) {
      if (!s || !s.el) continue;
      if (s.created) {
        s.el.remove();
      } else if (s.prev === null) {
        s.el.removeAttribute('content');
      } else {
        s.el.setAttribute('content', s.prev);
      }
    }
  }

  function applyThemeColor(color) { return overrideMetaTag('theme-color', color); }
  function restoreThemeColor(snap) { restoreMetaTag(snap); }

  // v0.8.139：正規化 host 頁 viewport meta = width=device-width, initial-scale=1。
  // iOS Safari（與其他行動瀏覽器）拿 viewport meta 算 layout viewport 寬度與初始
  // 縮放。站點若宣告 initial-scale < 1（daringfireball `initial-scale=0.5`、故意讓
  // 寬版面在手機縮一半顯示）、width 為固定值（width=980）、或根本沒宣告（Safari
  // 預設用 980px layout viewport 再縮到螢幕寬），reader card 換成行動寬度後整張卡
  // 仍被釘在縮小的初始縮放上，視覺上「縮小一半」。閱讀模式下強制行動標準 viewport，
  // 退出還原。桌面瀏覽器忽略 viewport meta → 此覆寫對桌面 no-op。通則：對任何
  // viewport 非行動標準的站一律生效，不綁站點。
  //
  // 沒宣告 viewport meta 時自建一個（Safari 預設 980px layout viewport，不自建
  // 覆蓋不到）。多個 viewport meta（理論少見）全部正規化。回傳 snapshot 供 restore：
  // created=true 的移除、其餘還原原 content。
  const READER_VIEWPORT = 'width=device-width, initial-scale=1';
  function applyViewportFix() { return overrideMetaTag('viewport', READER_VIEWPORT); }
  function restoreViewport(snap) { restoreMetaTag(snap); }

  // ---------------------------------------------------------------------------
  // v0.7.225：保留原站色容器的對比守門（contrast guard）
  // Trigger：Jimmy 2026-06-07 回報 blog.tymscar.com（dark scheme）code block
  // 在 light theme reader card 內幾乎全白不可讀。
  //
  // Root cause（通則，非站點特例）：styler 刻意保留 pre / table 的原站文字色
  // （syntax highlight / 表格設計），但這些色是配合「原站 effective 背景」設計
  // 的。站點走 prefers-color-scheme: dark 時 token 色為淺色、背景常是
  // 「半透明白疊深色 body」（tymscar 實測 pre bg = srgb 5% 白、body #1a1a1a，
  // 對比 4.6~16.3:1）。reader card 強制白底後半透明 bg 疊白 = 白，token 色
  // 不變 → 對比掉到 1.07~3.79:1。
  //
  // 修法：apply() 注入 CSS 前先量每個 pre / table 的「原始 effective bg」
  // （往上爬 ancestor、半透明圖層 alpha 合成）+ 文字載體色與字數；注入後以
  // card bg 為基底重算新 effective bg。若「大部分文字對新 bg 不可讀（< 3:1
  // 占比 >= 40%）、但對原始 bg 可讀」→ 把原始 bg 用 inline !important 還給
  // 該容器，保留原站 syntax highlight 設計。restore() 對稱還原。
  //
  // 訊號層次（明確標注，見 CLAUDE.md 工作流原則 3）：
  //   本 guard 驗「pre / table 內文字 vs effective bg 的 WCAG 對比」一層；
  //   不驗 figcaption / mark / kbd（同樣保留原站色但無回報案例、修法形狀不同
  //   ——bg 還原對 caption 會出現突兀色塊，應改覆寫文字色）、不驗圖片 / iframe
  //   內部內容（jread 摸不到）。
  //   dark / sepia theme 不走本 guard——v0.8.45 起由 apply() 內獨立的
  //   「dark contrast 兜底層」（phase 3）負責：那層掃全 card 直接文字載體、
  //   對 effective bg 對比 < 3:1 才 inline 修文字色（2026-06-11 page rounds
  //   12 站 dark E1 整治；twz 站點 (0,3,0) !important rule 類 cascade 輸局
  //   只有 inline !important 能終結）。
  //
  // 保守邊界：站點「原本就低對比」（lowOrig >= 0.4）不觸發——那是站點自己的
  // 設計，jread 沒有破壞它就不該動；無 opaque bg 且靠 color-scheme: dark 讓
  // canvas 變深的站，origBg 會誤算成白 → lowOrig 高 → guard 保守不動（漏修
  // 但不誤傷）。
  const CONTRAST_GUARD_SEL = 'pre, table';
  const CONTRAST_MIN_RATIO = 3;       // < 3:1 視為不可讀（WCAG 大字 / UI 元件下限）
  const CONTRAST_LOW_FRACTION = 0.4;  // 低對比文字字數占比 >= 40% 才觸發
  const CONTRAST_MAX_TARGETS = 20;    // 每頁最多處理 20 個容器（效能上限）
  const CONTRAST_MAX_CARRIERS = 80;   // 每容器最多取 80 個文字載體
  // v2.5.23：code block 底色（phase 4）自己的上限。原本共用 CONTRAST_MAX_TARGETS（20，
  // 是 phase 1 / 2「逐容器收集文字載體」那種重量測的上限），phase 4 每個 <pre> 只讀
  // 一次 computed background——技術文件一頁 40–100 個程式碼區塊很常見，第 21 個起
  // 全部沒補底色、與內文融在一起（kubernetes 96 個、qiita 40 個、jestjs / vuejs 各
  // 30 多個，後半全數透明；真站與快照相同）
  const CODE_BG_MAX_SCAN = 2000;
  // v2.5.24：補了底色的 <pre> 內距不足這個值就補（見 passCodeBlockBgPhase4）
  const CODE_PAD_MIN = 4;
  const CODE_PAD_X = '16px';
  const CODE_PAD_Y = '12px';
  // v2.5.23：程式碼區塊內「只有空白的 token」底線清除，每頁最多看幾個 token
  const CODE_WS_MAX_SCAN = 20000;
  const TABLE_BG_MAX_SCAN = 3000;     // v2.5.18：light 表格系深色底守門每頁最多量 3000 個元素
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };

  // 解析 getComputedStyle 回傳的色字串。涵蓋 Chrome 兩種 serialization
  // （legacy comma rgb/rgba、wide-gamut color(srgb ... / a)——站點 CSS 用
  // color-mix / 相對色語法時 computed 會是後者，tymscar 實測命中）+ theme
  // 常數的 hex。解析失敗回 null（呼叫端視為 transparent / 跳過）。
  function parseCssColor(str) {
    if (!str) return null;
    const s = String(str).trim();
    let m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (m) {
      const a = m[4] === undefined ? 1
        : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/i);
    if (m) {
      const a = m[4] === undefined ? 1
        : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: Math.round(+m[1] * 255), g: Math.round(+m[2] * 255), b: Math.round(+m[3] * 255), a };
    }
    m = s.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    if (/^transparent$/i.test(s)) return { r: 0, g: 0, b: 0, a: 0 };
    return null;
  }

  // fg 疊在 bg 上的 alpha 合成（簡化：bg 視為 opaque 基底）
  function blendOver(fg, bg) {
    const a = fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1
    };
  }

  function relLuminance(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrastRatio(c1, c2) {
    const l1 = relLuminance(c1), l2 = relLuminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // 從 el 往上收集 background-color 圖層到 stopEl（exclusive）/ body 為止，
  // 由外而內疊在 baseColor 基底上 → 回傳該元素的 effective 背景色。
  // 遇 opaque 圖層提前停（更外層不影響視覺）。
  // skipFn（選填）：回傳 true 的層忽略其 bg——dark 兜底層用來按「jread 規則
  // 的目標狀態」計算（會被背景中和規則打 transparent 的層不計入），見
  // phase 3 註解的 SPA cascade 時序坑。
  function compositeBgOver(el, stopEl, baseColor, win, skipFn) {
    const layers = [];
    let opaqueFound = false;
    let cur = el;
    while (cur && cur !== stopEl && cur.nodeType === 1) {
      if (!(skipFn && skipFn(cur))) {
        const c = parseCssColor(win.getComputedStyle(cur).backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 0.999) { opaqueFound = true; break; }
        }
      }
      if (cur === win.document.body) break;
      cur = cur.parentElement;
    }
    let base = opaqueFound ? { r: 0, g: 0, b: 0, a: 1 } : { ...baseColor };
    for (let i = layers.length - 1; i >= 0; i--) base = blendOver(layers[i], base);
    return base;
  }

  // 收集容器內的文字載體：自身 direct textNode 有內容的元素 + 其 computed
  // color，字數作對比統計權重。direct text（不抓子孫）避免 wrapper 重複計數。
  // 保留 el reference——phase 2 必須**重新**讀注入後的 computed color，不能
  // 沿用此處量到的原始色：沒有自己 color 的元素（td 等）注入後自然繼承 card
  // 深字（color: inherit 規則的 :not(td) 排除只是「不強制」，自然繼承照走
  // 新 cascade）。用 phase 1 舊色判定會誤觸發——tymscar table 實測修壞：
  // guard 誤還原深 bg、td 實際已是深字 → 深底深字 1:1（CONTRAST AUDIT 抓到）。
  function collectTextCarriers(target, win, max) {
    const carriers = [];
    const els = NS.selfAndDescendants(target, '*'); // 2026-10-07 review C-10：不 spread
    for (const el of els) {
      if (carriers.length >= (max || CONTRAST_MAX_CARRIERS)) break;
      const tag = el.tagName.toUpperCase();
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'TITLE' || tag === 'DESC') continue;
      if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
      let len = 0;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) len += n.textContent.trim().length;
      }
      if (!len) continue;
      const col = parseCssColor(win.getComputedStyle(el).color);
      if (!col || col.a < 0.5) continue; // 透明文字不計
      carriers.push({ el, origColor: col, len });
    }
    return carriers;
  }

  // 低對比文字占比：對 bg 對比 < CONTRAST_MIN_RATIO 的字數 / 總字數。
  // colorKey 選用哪個時間點的色：'origColor'（phase 1 注入前）或
  // 'newColor'（phase 2 注入後重量、繼承已走新 cascade）。
  function lowContrastFraction(carriers, bg, colorKey) {
    let low = 0, total = 0;
    for (const c of carriers) {
      const col = c[colorKey];
      if (!col) continue;
      total += c.len;
      if (contrastRatio(col, bg) < CONTRAST_MIN_RATIO) low += c.len;
    }
    return total > 0 ? low / total : 0;
  }

  // v2.5.32：shadow 元件內文字的低對比占比（純函式）。samples：[{ fg, bg, len }]，
  // fg / bg 皆為 parseCssColor 結果（bg 已合成為不透明）。回傳低於 CONTRAST_MIN_RATIO
  // 的字數占比；總字數為 0 回 0
  function shadowTextLowFraction(samples) {
    let low = 0, total = 0;
    for (const s of samples || []) {
      if (!s || !s.fg || !s.bg || !(s.len > 0)) continue;
      total += s.len;
      if (contrastRatio(blendOver(s.fg, s.bg), s.bg) < CONTRAST_MIN_RATIO) low += s.len;
    }
    return total > 0 ? low / total : 0;
  }
  const SHADOW_FIT_MAX_TEXT_NODES = 600;
  // v2.5.32：量 shadow host 內（含巢狀 shadow root）每段可見文字的字色與實際底色。
  // 底色往上找：元素的 parentElement，到 shadow root 頂端改走它的 host，遇不透明圖層
  // 停；走到 stopEl（articleEl）都沒有不透明層時以 cardBg 為底
  function measureShadowHostText(host, stopEl, cardBg, win) {
    const samples = [];
    const up = (el) => el.parentElement || (el.getRootNode && el.getRootNode() !== win.document && el.getRootNode().host) || null;
    const bgOf = (el) => {
      const layers = [];
      let cur = el;
      let opaque = false;
      while (cur && cur !== stopEl && cur.nodeType === 1) {
        const c = parseCssColor(win.getComputedStyle(cur).backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) { opaque = true; break; } }
        cur = up(cur);
      }
      let base = opaque ? { r: 0, g: 0, b: 0, a: 1 } : { ...cardBg };
      for (let i = layers.length - 1; i >= 0; i--) base = blendOver(layers[i], base);
      return base;
    };
    let count = 0;
    const scan = (root) => {
      const tw = win.document.createTreeWalker(root, 4 /* SHOW_TEXT */);
      let n;
      while ((n = tw.nextNode()) && count < SHADOW_FIT_MAX_TEXT_NODES) {
        const len = (n.nodeValue || '').trim().length;
        if (!len) continue;
        const el = n.parentElement;
        if (!el) continue;
        const tag = el.localName;
        if (tag === 'style' || tag === 'script' || tag === 'template') continue;
        let cs;
        try { cs = win.getComputedStyle(el); } catch (_) { continue; }
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const fg = parseCssColor(cs.color);
        if (!fg || fg.a < 0.5) continue;
        count++;
        samples.push({ fg, bg: bgOf(el), len });
      }
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of all) {
        if (count >= SHADOW_FIT_MAX_TEXT_NODES) break;
        let sr = null;
        try { sr = el.shadowRoot; } catch (_) { sr = null; }
        if (sr) scan(sr);
      }
    };
    let sr = null;
    try { sr = host.shadowRoot; } catch (_) { sr = null; }
    if (sr) scan(sr);
    return samples;
  }

  // v2.5.18：light 主題表格系深色底守門的單層判定（純函式，passTableSiteBgContrast 用）。
  // carriers：直接落在這層底色上的文字載體 { len, isLink, color }；bg＝這層現在的
  // effective bg；behind＝這層清成透明後露出來的底色。
  //   'clear'       有非連結文字在這層底色上看不清楚（< CONTRAST_MIN_RATIO），且清掉後
  //                 沒有原本看得清楚的字變成看不清楚
  //   'keep'        文字都看得清楚（站方自己配的深底淺字），或清掉會弄壞看得清楚的字
  // 不設字數占比門檻：第二個條件已保證清掉不會讓任何字變差，只要有字救得回來就清。
  //   'no-own-text' 這層沒有非連結文字（空列 / 只有連結）——由同表其他層的結果決定
  function tableSiteBgVerdict(carriers, bg, behind) {
    let low = 0, total = 0, lost = 0;
    for (const c of carriers) {
      if (c.isLink || !c.color) continue;
      total += c.len;
      if (contrastRatio(c.color, bg) < CONTRAST_MIN_RATIO) low += c.len;
      else if (contrastRatio(c.color, behind) < CONTRAST_MIN_RATIO) lost += c.len;
    }
    if (!total) return 'no-own-text';
    if (low > 0 && lost === 0) return 'clear';
    return 'keep';
  }

  // v0.8.18 C6：base 骨架 memoize cache（theme 物件 → Map(key → base 字串)）。
  // base 依賴 theme + contentWidth + readerHostPage（v1.5.3 起卡片上緣 padding
  // 依 readerHostPage 分流、住在 base 模板內），THEMES（4 個，含 v0.8.143 gray）
  // 是穩定 module 物件、可當 WeakMap key。
  // v1.6.24：readerHostPage 納入 cache key——原本 key 只有 (theme, contentWidth)，
  // 同組合下 readerHostPage 變化會拿到 stale 的錯誤上緣 padding（cache 內容依賴
  // 它、key 卻沒有，invariant 破壞）。
  const _baseSkeletonCache = new WeakMap();
  function _baseSkeletonKey(contentWidth, readerHostPage) {
    return contentWidth + (readerHostPage ? ':reader' : '');
  }
  function baseSkeletonCacheGet(theme, contentWidth, readerHostPage) {
    const m = _baseSkeletonCache.get(theme);
    return m ? m.get(_baseSkeletonKey(contentWidth, readerHostPage)) : undefined;
  }
  function baseSkeletonCacheSet(theme, contentWidth, readerHostPage, base) {
    let m = _baseSkeletonCache.get(theme);
    if (!m) { m = new Map(); _baseSkeletonCache.set(theme, m); }
    m.set(_baseSkeletonKey(contentWidth, readerHostPage), base);
  }

  function buildCss(theme, opts, overrides) {
    const { contentWidth } = opts;

    // 水平 gutter（reader card 左右內距）單一資料源。連續滑動（base 卡片
    // padding）與翻頁模式（左 padding + 右 transparent border + column-gap +
    // column-width 扣除）必須用同一值，否則兩模式內文行寬會 drift——v0.8.1 把
    // 連續模式 gutter 從 min(56px,6vw) 改成 clamp(16px,…,56px)（390pt 內文對齊
    // 原站 16px 標準 gutter），但翻頁模式漏改、仍停在舊 min(56px,6vw)（390pt
    // 留 23.4px），導致「翻頁比捲動窄」（Jimmy 2026-06-09 roomie.tw 回報）。
    // 抽成常數讓兩條 path 共用、杜絕未來再 drift。clamp 線性段斜率對齊 933px
    // 桌面門檻（>= 933px 仍 56px、桌面卡片美學不變），floor 16px = 行動版主文
    // 業界標準左右 gutter。結構性條件（viewport 寬 + 標準 gutter 常數），不綁平台。
    const H_GUTTER = 'clamp(16px, calc(7.4vw - 12.8px), 56px)';

    // ---- 骨架：頁面 reset + 祖先鏈 reset + 卡片容器（永遠注入）----
    // v0.8.18 C6：base 骨架只依賴 theme + contentWidth + readerHostPage（不含
    // fontSize / lineHeight / fontFamily / pagedMode 等使用者變數），~800 行卻每次
    // apply() 重組。改成 memoize：同組合只算一次，使用者調字級 / 字型 / 行距
    // （只動 userOverrides）時 base 直接命中 cache、不再重建。輸出逐字相等
    // （tools/probe-c6-buildcss.js 驗過 27 組 snapshot identical）。
    let base = baseSkeletonCacheGet(theme, contentWidth, opts.readerHostPage);
    if (base === undefined) {
      // 「媒體直接容器」selector 清單單一資料源——height reset 與 position reset
      // 兩個 rule block 共用（v1.6.24 抽常數；原本兩份手寫清單逐字相同，是
      // MEDIA_CAP_SEL 註解記錄過的同型 drift 候選）。
      const MEDIA_DIRECT_WRAP_SEL = `[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> img:not([${INLINE_IMG_ATTR}])),
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> picture),
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> video)`;
      const segPageScaffold = () => `
/* 補 cleaner hide 漏洞：cleaner 只設 inline style.display = 'none' 無
   !important，站點 JS（例如商周 .postnav.fixed 的 scroll handler 主動
   el.style.display = 'block'）會把 inline display 整個覆寫掉、priority
   被清除。stylesheet 的 !important 優先級 > inline 無 priority 值，是
   browser 層級的勝利機制，擋得住 JS 再次覆寫。通則對付任何站點
   scroll / resize / timer 類 handler 重設 hide 過元素 display 的情境。 */
[data-jread-hidden="1"] {
  display: none !important;
}
#${PROGRESS_ID} {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  width: 0%;
  background: ${theme.progressBar};
  z-index: 2147483647;
  pointer-events: none;
}
/* v0.7.216：Space 段落焦點指示條（space-scroll.js 建立 / 定位元素，CSS rule
   放這裡跟 #__jread-progress 共用 theme.progressBar 色——單一資料源，主題
   切換 reapply 重建 stylesheet 自動跟色）。position: absolute 文件座標，
   卷動時黏著段落；top / height 加 transition，焦點換段落時平滑滑移。 */
#__jread-focus-bar {
  position: absolute;
  width: 4px;
  border-radius: 2px;
  background: ${theme.progressBar};
  z-index: 2147483646;
  pointer-events: none;
  transition: top 0.25s ease, height 0.25s ease;
}
/* SPA 站（Readwise Reader / Notion / Gmail 等）常把 html / body 設
   overflow: hidden、scroll 交給內層 div。reader mode 注入 article card 後
   body 高度被撐開、但 overflow-y:hidden 仍鎖住整個 viewport 無法捲動。
   通則：reader mode 強制 html / body 兩者 overflow-y: visible，scroll
   回到 viewport 層級。overflow-x:hidden 保留避免主文超寬橫向拉條。 */
html.${HTML_CLASS} {
  background: ${theme.pageBg} !important;
  overflow-y: visible !important;
}
html.${HTML_CLASS} body {
  background: ${theme.pageBg} !important;
  margin: 0 !important;
  padding: 0 !important;
  max-width: none !important;
  width: auto !important;
  min-width: 0 !important;
  overflow-x: hidden !important;
  overflow-y: visible !important;
}
/* v0.7.90：auto-hide scrollbar——SPA 站常用 scrollbar-width: none /
   ::-webkit-scrollbar display: none 隱藏整個 scroll bar，reader mode
   啟動後使用者捲動時看不到任何 indicator。對策：
     1. scrollbar-width: thin override 站點 hide
     2. webkit ::-webkit-scrollbar 自製 8px 細條
     3. thumb 預設 transparent，html 帶 [data-jread-scrolling="1"] 時顯色
     4. styler 端攔 scroll event 加 attr、800ms idle 後移除
     5. transition 0.3s 達到 fade-in/out，不打擾閱讀
   thumb 色按主題：light/sepia 用深色（rgba 黑/sepia text）、dark 用淺色。 */
html.${HTML_CLASS} {
  scrollbar-width: thin !important;
  scrollbar-color: transparent transparent !important;
  transition: scrollbar-color 0.3s ease !important;
}
html.${HTML_CLASS}[data-jread-scrolling="1"] {
  scrollbar-color: ${theme.scrollThumb} transparent !important;
}
/* v1.6.29（#12 效能）：scrollbar-color 是 inherited property——捲動 flash 在
   <html> 上 toggle attribute 改變它時，繼承傳播會強制整份文件 style recalc
   （Chromium 實測 wiki 37K 節點每次 toggle ~50ms、連續捲動累計數秒＝捲動 jank
   主兇；stub A/B：5 輪捲動 recalc 3930ms → 74ms）。body 釘明確值讓傳播止於
   body（recalc 範圍縮到 html+body）。唯一視覺差：頁面捲動 flash 時內層
   scroller（code block 等）thumb 不再連帶顯色——它們自身捲動本就不觸發 flash
   （scroll 事件不 bubble 到 window），無感知差異。Safari 不支援 scrollbar-color
   （走下方 ::-webkit-scrollbar pseudo 軌），行為不變。 */
html.${HTML_CLASS} body {
  scrollbar-color: transparent transparent !important;
}
html.${HTML_CLASS}::-webkit-scrollbar {
  width: 8px !important;
  height: 8px !important;
  display: block !important;
  background: transparent !important;
}
html.${HTML_CLASS}::-webkit-scrollbar-track {
  background: transparent !important;
}
html.${HTML_CLASS}::-webkit-scrollbar-thumb {
  background-color: transparent !important;
  border-radius: 4px !important;
  transition: background-color 0.3s ease !important;
}
html.${HTML_CLASS}[data-jread-scrolling="1"]::-webkit-scrollbar-thumb {
  background-color: ${theme.scrollThumb} !important;
}`;
      const segAncestorReset = () => `
/* 祖先鏈激進 reset——讓主文容器脫離原站的多欄 layout / 版心限制 / sticky。
   不碰主文本身 [data-jread-active]，所以原站的 h1-h6 / p / list / link 等
   樣式仍由原 class / style 生效。 */
[${ANCESTOR_ATTR}="1"] {
  max-width: none !important;
  width: auto !important;
  min-width: 0 !important;
  min-height: 0 !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  background-image: none !important;
  float: none !important;
  position: static !important;
  transform: none !important;
  display: block !important;
  box-shadow: none !important;
  border: 0 !important;
}
/* v2.5.32：body 的 position 要贏過站方「彈窗開著時鎖捲動」的 body 規則。同意視窗
   （Sourcepoint 類 CMP）開著時站方注入 \`.sp-message-open body { position: fixed
   !important }\`（0,1,1），比上一條祖先 reset（0,1,0）高；JRead 把同意視窗當彈窗藏
   掉了，鎖卻留著：body 釘在視窗上、window 捲不動，Space 捲動、End、閱讀進度都失效，
   只剩滑輪捲到內層（theguardian 全新瀏覽器真站實測，scrollHeight＝視窗高）。按過
   同意的瀏覽器沒有這個 class、不受影響。提高到 (0,3,2) 只為了 position 這一項，意圖
   與上一條相同（祖先一律 static）。 */
html.${HTML_CLASS} body[${ANCESTOR_ATTR}="1"][${ANCESTOR_ATTR}="1"] {
  position: static !important;
}
/* ancestor 的直接子元素若不在 ancestor 鏈上、也不是主文容器，一律隱藏。
   v0.7.199：body 也納入 ancestor 鏈，body 直接子樹若非 ancestor / article
   / JRead UI 一律隱藏——堵住翻譯類 extension（Shinkansen 等）在 body 層級
   注入或重建元素導致站名殘留的通道（chinatalk.media h1#wordlogo）。
   #__jread-toast-host 是 JRead toast 通知 host，position:fixed 掛在 body
   下，必須排除。
   v0.8.131：[data-jread-promoted-outside] 是翻譯頁標題 clone——promote 進
   articleEl 會被翻譯擴充（Shinkansen 等）content guard 每秒清掉，改放
   articleEl 外（前一個 sibling）才存活；故須排除在本隱藏規則外。 */
[${ANCESTOR_ATTR}="1"] > *:not([${ANCESTOR_ATTR}="1"]):not([${ARTICLE_ATTR}="1"]):not(#__jread-toast-host):not([data-jread-promoted-outside="1"]) {
  display: none !important;
}`;
      const segCardTitle = () => `
/* 讀者卡片：版心、置中、背景、圓角、陰影。刻意不設 font-family / font-size
   / line-height / color——保留原站字體與排版。
   v0.7.121：selector 加 'html ' 前綴提升 specificity 從 (0,1,0) → (0,1,1)，
   贏過原站任何單 class rule（例：cn.nytimes '.article-content { max-width:
   1040px !important }'）。同 specificity + 同 !important 下，原站 stylesheet
   依 cascade order 後注入勝出、吃掉 jread max-width: 720px → articleEl 撐
   寬到 1040px 跨過 Bootstrap lg breakpoint 992px、'.col-lg-5' 類觸發 50%
   寬度、partial 內主文段落被擠到只佔 reader card 一半（cn.nytimes
   /opinion/...apple-tim-cook-outsourcing-china 實測 articleEl computed
   maxWidth=none 證實）。html element 是 root selector、永遠 match、加成
   specificity 不誤殺其他 selector 邏輯。其他 [data-jread-active="1"] X
   selector 因含 X tag/class 已有 specificity (0,1,1+) 夠強、不需動。 */
html [${ARTICLE_ATTR}="1"] {
  box-sizing: border-box !important;
  max-width: ${contentWidth}px !important;
  width: auto !important;
  min-height: 0 !important;
  height: auto !important;
  /* v0.7.226：垂直 margin 40px → clamp(8px, calc(6.4vw - 19.2px), 40px)。
     窄 viewport（手機）下 card 已撐滿水平空間、40px 灰條純屬桌面卡片美學
     殘留（Jimmy iPhone 回報頂端浪費一截）。線性 ramp：viewport >= 925px
     維持 40px 桌面不變（與水平 padding 的 933px 門檻一致）、430pt → ~8px。
     min(40px, Nvw) 過原點直線在 430pt 只能收到 ~18px、不夠陡，改用
     calc 截距版。結構性條件（viewport 寬度），不綁平台。 */
  margin: clamp(8px, calc(6.4vw - 19.2px), 40px) auto !important;
  /* v0.7.210：display 正規化為 block——原站若把主內容容器設成
     inline-block / inline / table-cell（巴哈姆特 .c-section__main 是
     inline-block，父 section text-align: right 雙欄 layout），margin auto
     水平置中會失效（auto margin 對非 block-level 元素算成 0）、且 inline-block
     受父層 text-align 影響靠右/靠左。float/position/transform 已在正規化容器，
     display:block 是同群最後一塊拼圖，確保 reader card 永遠水平置中。 */
  display: block !important;
  /* v0.7.224：水平 padding 56px → min(56px, 6vw)。窄 viewport（手機）下
     max-width 被 viewport clamp，固定 56px×2 吃掉 26% 可讀寬度（430pt 實測
     內文僅 318px、版心調大也無感——Jimmy iPhone 回報）。min() 連續縮放：
     viewport >= 933px 維持 56px 桌面卡片美學不變；越窄 padding 越收
     （430pt → ~26px、內文 378px）。結構性條件（viewport 寬度），不綁平台。
     v0.8.1：水平 padding 改 clamp(16px, calc(7.4vw - 12.8px), 56px)。
     原 min(56px, 6vw) 在 390pt iPhone 留 23.4px×2 → 內文僅 343px，比原站
     行動版主文窄（probe 實測 BBC/Wikipedia/Verge 原站內文 358-362px = 16px
     gutter，JRead 反而窄 15px——Jimmy 回報「閱讀模式常比原本網頁內文還窄」）。
     16px 是行動版主文業界標準左右 gutter（多數新聞/知識站採用），floor 設
     16px 讓 390pt 內文 = 358px 對齊原站、不再更窄。線性段斜率對齊原 933px
     桌面門檻（>= 933px 仍 56px、桌面卡片美學不變）。結構性條件（viewport
     寬度 + 標準 gutter 常數），不綁平台。
     垂直 padding 維持 min(48px, 6vw)（v0.7.226）——頂部空白是縱向體感、與
     水平可讀寬無關，不需同步收到 16px。
     v0.8.14：水平 gutter 值抽成 H_GUTTER 常數，與翻頁模式共用同一資料源。 */
  padding: ${opts.readerHostPage ? `${READER_HOST_TOP_GUTTER} ${H_GUTTER} ${V_GUTTER} ${H_GUTTER}` : `${V_GUTTER} ${H_GUTTER}`} !important;
  background: ${theme.articleBg} !important;
  background-image: none !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
  float: none !important;
  position: static !important;
  transform: none !important;
  /* reader card 不應有水平溢出——Swiper / carousel 類 JS library 常把
     slide 寬度設為原始 viewport 寬而非 card content width，圖片隨之超出
     card 右邊界。overflow-x:hidden 是 fallback clip（防溢出可見），搭配
     constrainOverwideDescendants() runtime 修正超寬後代使圖片等比縮放。 */
  overflow-x: hidden !important;
  /* v0.7.179：reader card 顯式設 text color（所有 theme）。搭配下方
     後代 color: inherit 規則，確保 CMS 彩色 banner 內白字不會在背景
     被 strip 後殘留不可見。light theme 之前不設 color（交給原站），但
     原站 color 常配合已被 strip 的 background 設計，留下等於留 bug。 */
  color: ${theme.text || theme.proseText || '#1a1a1a'} !important;
  /* WordPress Gutenberg constrained layout override：WP 用 CSS custom
     property 限制 content width（通常 560-650px），在 reader card 內多
     餘且讓內文過窄。override 到 100% 讓內文撐滿 card 版心。 */
  --wp--style--global--content-size: 100% !important;
  --wp--style--global--wide-size: 100% !important;
  /* v0.7.157：font-smoothing 統一 antialiased（macOS）/ grayscale（macOS Firefox）。
     站點未自行設定時，macOS Chrome 預設 -webkit-font-smoothing 為 auto（subpixel-
     antialiased），中文字渲染明顯偏粗（businessweekly.com.tw 等中文新聞站 stack
     "Microsoft JhengHei", "Noto Sans TC", "PingFang TC" fallback 到 PingFang TC
     後字重雖 400 但視覺偏粗）。Medium / NYT / Substack 等專業閱讀站 stylesheet
     普遍套 antialiased。reader-card scoped 不影響原站視覺，是業界閱讀體驗最佳實踐。 */
  -webkit-font-smoothing: antialiased !important;
  -moz-osx-font-smoothing: grayscale !important;
}
/* v0.8.131：翻譯頁標題 clone 對齊讀者卡片。promote 進 articleEl 會被翻譯擴充
   （Shinkansen 等）content guard 每秒清掉，改放 articleEl 外（前一個 sibling）
   才存活（cage 實證）；放外面後不在卡片內，須自己對齊：同版心、置中、背景、
   上圓角；padding / margin 去底，與下方主文卡片合併成單一張卡片。
   刻意排在 cardArticle rule 之後——避免本 rule 的 max-width: 720px 被
   styler.spec「第一個 max-width:720px 必是含 html 前綴的 cardArticle」forcing
   function 先比中。 */
[${ANCESTOR_ATTR}="1"] > [data-jread-promoted-outside="1"] {
  box-sizing: border-box !important;
  /* v2.5.40：flow-root（不是 block）——搬出來的整塊頁首最後一個子元素常帶站方
     margin-bottom（telefoncek 翻譯後 h1 15px），block 會讓它穿出標題塊、在標題塊與
     主文卡之間撐出一條灰底縫；flow-root 把它留在標題塊的底色裡 */
  display: flow-root !important;
  max-width: ${contentWidth}px !important;
  width: auto !important;
  margin: clamp(8px, calc(6.4vw - 19.2px), 40px) auto 0 !important;
  padding: ${V_GUTTER} ${H_GUTTER} 0 !important;
  background: ${theme.articleBg} !important;
  background-image: none !important;
  border: 0 !important;
  border-radius: 8px 8px 0 0 !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
  float: none !important;
  /* static 不可改成 relative（v1.7.51 試過並撤回）：兩塊接合後，下方主文卡的
     box-shadow 上緣會往外散射 ~4px 落在標題塊背景上，留下一道 5 階灰的淡影
     （probe 實測 237 → 232）。改 relative 雖讓標題塊背景蓋掉那道淡影，卻換成
     標題塊自己的下投陰影蓋在主文卡背景上，接縫反而更深（225 vs 237、12 階）。
     兩塊各自獨立的 box-shadow 無法做出方向性裁切，static 是較輕的一邊。 */
  position: static !important;
  transform: none !important;
  color: ${theme.text || theme.proseText || '#1a1a1a'} !important;
}
/* 標題 clone 內的連結（permalink 自連結 <h1><a> 或 <a><h1>）回退繼承色 +
   無底線，維持原站標題視覺（與 articleEl 內 v0.8.129 同效；本元素在 articleEl
   外故需獨立一份）。用 :is()/marker 寫法、刻意不寫裸 a 選擇器——避開 styler.spec
   「Auto 下不得對 a 下 rule」forcing function。
   v1.6.30：<a><h1> 形原用 a:has(:is(h1..h6))，#13 效能改 HEADING_LINK_ATTR
   marker（markHeadingLinks 的掃描範圍含 promoted-outside clone）。 */
[data-jread-promoted-outside="1"] :is(h1,h2,h3,h4,h5,h6) a,
[data-jread-promoted-outside="1"] a[${HEADING_LINK_ATTR}="1"] {
  color: inherit !important;
  text-decoration: none !important;
}
/* v2.5.40：標題塊內的後代文字色跟主文卡同一條（v0.7.179 後代 color inherit）。標題塊在
   articleEl 外、吃不到那條，站方給標題的淡灰色（telefoncek .post-title rgb(160,154,146)，
   對比 2.6:1）就原樣留著；排除清單與主文卡同一份（連結、程式碼、表格、語意行內元素、圖說） */
[data-jread-promoted-outside="1"] *${COLOR_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"]) {
  color: inherit !important;
}
/* 標題在前時，下方主文卡片去掉上圓角 + 上 margin，兩塊接成同一張卡片。
   (0,2,0) > 卡片規則 html [data-jread-active] (0,1,1)，且 source order 在後。
   v1.7.51：margin-top 補上——原本只清圓角、漏了 margin，卡片規則的垂直
   margin（clamp 8-40px）上緣仍在（標題 clone 自己 margin-bottom 已是 0，
   相鄰 margin collapse 後取 max = 主文卡的上 margin），
   桌面寬度下標題塊與主文卡之間空出 40px 灰底 → 視覺上多出一塊獨立色塊
   （Jimmy 2026-08-06 Stratechery translate-first 截圖；窄 viewport 只有 8px
   所以行動裝置端一直沒露餡）。 */
[data-jread-promoted-outside="1"] + [${ARTICLE_ATTR}="1"] {
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
  margin-top: 0 !important;
}
/* 消除頂端留白：第一個**可見** direct child 清 padding-top。
   JS 端另外會對「第一個 h1-h4/p」設 margin-top: 0 inline（覆蓋深層 CMS 寫死的值）
   v1.8.3：選擇器由 '> *:first-child' 換成 EDGE_FIRST_ATTR 標記（同 specificity
   (0,2,0)）——CSS pseudo-class 不跳過 cleaner 隱藏的雜訊殼，見標記常數註解。 */
[${ARTICLE_ATTR}="1"] > [${EDGE_FIRST_ATTR}="1"] {
  padding-top: 0 !important;
}
/* 消除底端留白：最後一個**可見** direct child 清 margin-bottom / padding-bottom。
   原站常用最後一個 wrapper div 設大量 pb（例如 90px page-footer spacing），
   reader card 本身已有 48px bottom padding，不需 wrapper 額外貢獻。
   html 前綴提升 specificity 到 (0,2,1)，贏過原站 .class-name { pb: Xpx }。
   v1.8.3：同上換成 EDGE_LAST_ATTR 標記（原 '> *:last-child' 同盲點——文末卡一個
   被清掉的分享列 / 推薦區殼，規則就落在那個 0 高度的殼上）。 */
html [${ARTICLE_ATTR}="1"] > [${EDGE_LAST_ATTR}="1"] {
  margin-bottom: 0 !important;
  padding-bottom: 0 !important;
}
/* direct child <header> / <footer>：原站在 article 內部的 header（標題 + 副標
   + 主圖 cluster）和 footer（相關文章 / 分享 / credit）常設大量 margin 做視覺
   隔離。reader card 單欄 layout 不需這些 section-level spacing——content 元素
   本身的 margin（h1 / p / figure）已提供足夠間距。
   html 前綴 + double attribute selector 提升 specificity 到 (0,2,2)，贏過
   任何站點 .site-class .header-class 類 CSS rule。 */
html [${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"] > header {
  margin: 0 !important;
  padding: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}
html [${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"] > footer {
  margin: 0 !important;
  padding: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}`;
      const segCardWidth = () => `
/* v0.8.26：巢狀語意內容容器（article / main）水平 padding 清零——用注入式
   stylesheet 補強，不只靠 JS inline（zeroHoriz，見下方 contentWidthSnap）。
   根因：原站常對 <article> 設自身水平 padding（telefoncek.si 的
   article { padding: 3em }）。reader card 已提供卡片 padding，巢狀 article 的
   padding 疊上去 = 雙重內距把內文夾窄。zeroHoriz 進閱讀模式時用 inline !important
   清掉它，normal 模式正常；但「先翻譯（Shinkansen 等翻譯擴充）再進閱讀模式」時，
   翻譯擴充沉澱期的 re-render 會把 JRead 寫的 inline style 屬性整個洗掉（實測
   ~1s 後 article 的 style 被清空、原站 3em padding 復活、內文 608px→500px）。
   inline 擋不住跨擴充洗，改用注入式 stylesheet——#__jread-style 全程不被洗、
   退出時整張移除即完整還原（不動原網頁元素，比 inline snapshot 還乾淨）。
   只鎖 article / main：語意上「這就是主內容」的 landmark 容器，不會被當縮排
   callout box 用，水平 padding 清零安全；div / section 的縮排語意歧義仍交給
   zeroHoriz 的 indent-aware JS 處理。html 前綴提升 specificity 到 (0,1,2)
   贏過原站 article { padding } 類 rule。selector 要求 article/main 是
   [data-jread-active] 的「後代」——卡片本身若是 article/main 不受影響（它走
   卡片 rule 拿卡片 padding）。 */
html [${ARTICLE_ATTR}="1"] article,
html [${ARTICLE_ATTR}="1"] main {
  padding-left: 0 !important;
  padding-right: 0 !important;
}
/* 所有 block 後代不超出 card content area：原站 CSS 可能對 header /
   section / div 設固定 width 或 min-width（yamatomichi Next.js header
   等），reader card 縮窄後這些元素溢出右邊界被 overflow-x:hidden 截斷。
   通則：reader card 是單欄 layout，任何後代都不該比 parent 寬。
   2026-10-07 review 批 7（清單外觀察）：lazy 影片佔位框內的播放鍵 / 疊層
   （markLazyEmbedUi 標的 SITE_UI_ATTR="embed-ui"）豁免——它是 absolute 的空
   div、圖示畫在 background-image 上，站方給的 width 就是它唯一的尺寸來源；
   width:auto 會讓 absolute 空盒 shrink-to-fit 成 0 寬（合成 WP Rocket 舊版
   .play 72×72 → 0×72，播放鍵看不到）。它在佔位框（overflow:hidden）內、
   不可能撐破卡片，不需要這條單欄寬度正規化。用 :where() 包 :not，
   specificity 維持 (0,1,1) 不變、不影響與其他規則的層疊順序。 */
[${ARTICLE_ATTR}="1"] div:where(:not([${SITE_UI_ATTR}="embed-ui"])),
[${ARTICLE_ATTR}="1"] section,
[${ARTICLE_ATTR}="1"] ul,
[${ARTICLE_ATTR}="1"] ol,
[${ARTICLE_ATTR}="1"] h1,
[${ARTICLE_ATTR}="1"] h2,
[${ARTICLE_ATTR}="1"] h3,
[${ARTICLE_ATTR}="1"] h4,
[${ARTICLE_ATTR}="1"] h5,
[${ARTICLE_ATTR}="1"] h6,
[${ARTICLE_ATTR}="1"] p,
[${ARTICLE_ATTR}="1"] header,
[${ARTICLE_ATTR}="1"] footer,
[${ARTICLE_ATTR}="1"] nav {
  /* v0.7.209：加 width: auto——原站用 styled-components 對 p 設固定窄欄
     寬度（twreporter.org 「width: 480px」配 sidebar-style 圖說做雙欄 layout）。
     reader card 是 single-column、p 應跟容器同寬。max-width: 100% 只擋上限、
     擋不掉原站固定 480px 值，必須 width: auto 把 explicit width 清掉。 */
  width: auto !important;
  max-width: 100% !important;
  min-width: 0 !important;
  box-sizing: border-box !important;
}
/* v2.5.9：ARIA 排的 div 表格（role=row 底下的格子，不是原生 td / th）一律等分欄寬。
   上面那條把站方給格子的 width / min-width 清掉後，靠 width 定欄寬的表頭格縮成
   字寬、靠 flex 的資料格等分——表頭與資料欄對不上（GitBook 實證）。表頭格與資料格
   都給同一個 flex，欄一定對齊；窄卡片下也不會像站方固定欄寬那樣橫向溢出。列不是
   flex 容器時 flex 屬性不作用、無副作用。role 判定與 isAriaTableRow 同一組常數 */
[${ARTICLE_ATTR}="1"] :is(${ARIA_TABLE_SEL}) [role="row"]:not(tr) > :is(${ARIA_CELL_SEL}):not(td):not(th) {
  flex: 1 1 0 !important;
}`;
      const segMedia = () => `
/* 圖片 / 影片：不超出卡片寬度；不改 margin（交給原站或 figure）。
   height: auto 的作用是「原站 CSS 鎖死 height、不讓 max-width 觸發 aspect-
   ratio 自動縮放」時強制按比例算——但這條對 a > img 結構（link-
   wrapped icon / logo / UI 按鈕圖，例：upmedia「新聞摘要」「辭」AI 查詢
   入口）反向傷害：原站常用「height: 32px」類小尺寸 CSS 壓縮 icon、沒
   明確設 width，height:auto !important 吃掉 height 後 img 退回
   naturalWidth×naturalHeight（例：250×250 icon 圖被拉成 naturalSize），
   主文裡出現巨大 UI icon。
   通則區分：裸 a > img 視為 icon-link 結構，只 cap 寬度、保留原站
   height；其他 wrapper（figure / picture / p / div 等）下的 img 視為
   內文配圖，維持 shrink-fit 行為。 */
[${ARTICLE_ATTR}="1"] img:not(a > img),
[${ARTICLE_ATTR}="1"] video,
[${ARTICLE_ATTR}="1"] picture {
  max-width: 100% !important;
  height: auto !important;
  /* v0.8.89：width 一併歸 auto——kknews.cc 用 lazy library 把未進視窗的圖
     凍在 width:1px（cross-origin CDN sheet 的 placeholder 狀態，原站 JS
     載入後才解除；reader mode 下原站 lazy observer 不跑、狀態凍結）。原本只設
     max-width:100% 擋不住固定 width:1px → 整片內容圖縮成 1×1 視覺消失。與下方
     min-width:0 / min-height:0 / height:auto 同款：reader card 單欄 layout 一律
     按 intrinsic 比例算媒體尺寸、忽略站點施加的維度 CSS。a > img（icon-link）
     已被 selector 排除、不受影響。 */
  width: auto !important;
  /* v0.8.45：min-height 一併清——cw.com.tw 實測站點對 hero img 設
     min-height: 645px（為原站滿版寬的響應式設計），height:auto 被
     min-height 頂住、object-fit:contain 下影像 letterbox 置中 → 主圖
     上下各 ~118px 假空白。reader 縮窄後媒體高度一律按比例算。 */
  min-height: 0 !important;
  /* v0.8.75：min-width 一併清——0xkato.xyz（Ghost 站）對 .bigger-image 設
     min-width: 130%（讓配圖向版心外 bleed 成寬圖）。CSS 規範 min-width 勝過
     max-width，故 max-width:100% 壓不回去、圖被頂在 130% 寬（608→790px）衝出
     720px 卡片右緣 126px 爆版。reader card 單欄 layout 不需要 bleed，min-width
     歸零讓 max-width:100% 生效、媒體一律縮回版心寬。結構通則：任何站對媒體設
     min-width bleed 都被覆蓋（與上方 p 規則 min-width:0 同款）。 */
  min-width: 0 !important;
}
/* v0.7.93：picture 與含 img/picture 的容器強制不被 flex stretch / 不維持
   固定 height——substack imageRow 類 gallery 修法。
   案例（synapseching.substack.com /p/17 Jimmy 2026-05-13 回報）：
     IMG → PICTURE → DIV.imageRow（display:flex + height:230px）。
     imageRow flex 子預設 align-items: stretch 把 picture 拉到 height 230，
     IMG 自身 height:auto 跑 natural ratio = 295（aspect-ratio 算出來），
     IMG 295 > picture 230、IMG 295 > imageRow 230 → IMG 從容器底部
     溢出 65px、視覺覆蓋下方文字段落。
   修法兩條：
     1) picture / figure / [圖片 wrapper] 強制 flex: 0 0 auto + align-self:
        flex-start + min-height: 0 + height: auto——picture 不被 flex 父
        stretch，picture 自身高度跟 IMG aspect-ratio 一致。
     2) 任何「直接子含 img / picture」的容器（imageRow / captioned-image-
        container 類 figure wrapper）強制 height: auto + min-height: 0 +
        align-items: flex-start，容器自然撐到圖片實際高度、不再固定 230
        造成圖片溢出蓋下方段落。
   :has 通則 selector 不綁站點 class——任何站把 flex/grid wrapper 設固定
   height + 內含 img 都被覆蓋。:has Chromium 105+ 支援，jread 不支援 Firefox
   無相容問題。 */
/* 媒體 element 自身 position 強制 static：原站常用 picture > img 結構搭
   img 自身 position:absolute + left/right offset 把圖片向版心外延伸成全寬
   hero（cna.com.tw 主圖實機 instrument 揭穿：img position:absolute,
   left:304px, right:-304px → img 從 picture 內 x=304 起算 width 608 →
   溢出 picture 右側 304px 變偏右破版）。reader card 單欄 layout 不需要這
   類定位 hack——強制 img/video 自身 position:static 讓它退回正常 inline-
   block flow，跟著 figure/picture 容器置中。
   不影響合法用法：aspect-ratio wrapper 模式（WP / Substack / Medium 等
   wrapper aspect-ratio:16/9 + 內部 img absolute inset:0 填滿）的 absolute
   是 wrapper 用、不是 img 用——但等等，這條模式裡 img 也是 absolute！
   通則陷阱：避免誤殺，這條只強制最常見破版來源 img/video，inset 也清空；
   aspect-ratio 容器若靠這個模式，restore 後會破——但 jread cleaner 已對
   aspect-ratio padding-bottom hack 做 runtime 處理，CSS level 這層強制
   static 對 reader card 的視覺結果是「圖縮在原本位置、不溢出」反而更穩。
   實測：cna 索馬利蘭主圖修法後 img 從 absolute → static、left/right
   offset 失效，圖回到 picture 內正常 inline 位置 width=picture.width。 */
[${ARTICLE_ATTR}="1"] img:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] video:not([${PLAYER_ATTR}="1"]) {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
}
/* v1.8.2：lazy 影片嵌入佔位框內的縮圖 → 恢復「absolute 填滿佔位框」。
   上一條把媒體本體一律打回 static，對「容器 height:0 + padding-bottom hack
   撐 16:9 + 內容 absolute 填滿 padding box」這種 responsive embed 結構是致命
   的——static 的縮圖落進高度 0 的 content box，被容器 overflow:hidden 整張裁
   掉（pansci.asia WP Rocket lazy YouTube 實證：DIV.rll-youtube-player
   height:0 + padding-bottom:56.23% + overflow:hidden，內含 480×360 縮圖 img
   與填滿式 play 按鈕；reader 下影片框只剩空白 + 圖說，Jimmy 2026-09-01 回報）。
   已 mount iframe 的同款結構走 FILL_IFRAME_ATTR（v0.8.86）pin 回 inset:0，
   這條是它在「iframe 還沒 mount、佔位框內是縮圖」階段的對偶。
   標記端（結構訊號、非站點 / class 特判）見 markEmbedWrapIframes 的
   findLazyEmbedFrame；doubled attr 提 specificity 蓋過上一條 static。
   height:100% + object-fit:cover（而非原站的 height:auto 溢出後被 overflow
   裁掉）：縮圖比例常與佔位框不同（YouTube hqdefault 是 4:3、框是 16:9），
   讓 rect 精確等於框才不會被 TEXT-IMAGE OVERLAP audit 當成「圖疊文」誤報；
   視覺與原站的裁切結果一致。
   attribute 寫三次 = specificity (0,4,0)：要蓋過的除了媒體 static 規則，還有
   內容圖放大規則 img[UPSCALE][UPSCALE] (0,3,1) 的 width:100% + height:auto
   ——縮圖被 classifyImages 當成內容配圖標了 upscale，height:auto 會讓它回到
   原始比例、又溢出佔位框（實測 608×456 vs 框 608×342）。 */
[${ARTICLE_ATTR}="1"] [${EMBED_FILL_ATTR}="1"][${EMBED_FILL_ATTR}="1"][${EMBED_FILL_ATTR}="1"] {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  margin: auto !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  object-fit: cover !important;
}
/* v1.8.2：上一條把縮圖抽離 flow 後，佔位框與 aspect 容器之間的中繼 wrapper
   （WP 慣例 .wp-block-embed__wrapper { display: inline-block }）失去內容寬度
   → shrink-to-fit 塌成 0 寬 → 佔位框 padding-bottom 百分比（相對寬度）歸零
   → 影片框整個消失。強制 block + width:auto 讓寬度改由父容器決定。 */
[${ARTICLE_ATTR}="1"] [${EMBED_FLOW_ATTR}="1"] {
  display: block !important;
  width: auto !important;
}
/* v1.8.2：::before / ::after 的 aspect 佔位中和（padding-bottom hack 的
   pseudo 版）。既有中和只認 class 含 placeholder / ratio 的容器（line ~1470），
   無語意 class 的 embed wrapper 漏網——pansci.asia
   DIV.rve-embed-responsive-16by9::before { padding-top: 56.25% } 撐出 270px
   佔位，其下的影片框被整段往下推、佔位本身變成純死空間（原站靠 absolute 子
   填滿該框，reader 把子打回 static 後佔位就空了）。標記端見
   passAspectPseudoReset（含 collapse guard 與 iframe 子樹排除）。 */
[${ARTICLE_ATTR}="1"] [${ASPECT_PSEUDO_ATTR}="1"]::before,
[${ARTICLE_ATTR}="1"] [${ASPECT_PSEUDO_ATTR}="1"]::after {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  height: 0 !important;
  min-height: 0 !important;
  aspect-ratio: auto !important;
}
/* v3.7.4：媒體容器上的圖示字型 pseudo（放大鏡 / 播放鍵）隱藏——外殼被改成 static 後
   圖示失去定位基準、掉到圖外（標記端見 passAspectPseudoReset 尾段）
   v3.7.9：同一個標記也收「遮罩／背景圖畫的行內 pseudo 圖示」——pseudo 底色清除後看不見、
   位置還在（pmc 外部連結圖示；標記端見 markMaskedIconPseudos） */
[${ARTICLE_ATTR}="1"] [${ICON_PSEUDO_ATTR}~="before"]::before,
[${ARTICLE_ATTR}="1"] [${ICON_PSEUDO_ATTR}~="after"]::after {
  display: none !important;
}
/* v3.7.11：同型、載體是元素本身——沒有字也沒有子元素、只靠背景圖畫圖示的行內元素（plos
   作者名後的通訊作者信封圖示 span.email，15px），背景清除規則拿掉圖、位置還在，名字與逗號
   之間空一段（標記端見 markMaskedIconPseudos） */
[${ARTICLE_ATTR}="1"] [${BG_ICON_EL_ATTR}="1"] {
  display: none !important;
}
/* v1.8.4：標題自帶的不可見 pseudo 間距佔位歸零（標記端見
   passHeadingPseudoSpacerReset——只標「量得出來完全看不見」的 pseudo）。
   刻意不用 display:none：空的 block pseudo 是父層 margin collapse 的邊界，
   拿掉會讓標題的 margin 穿透到父容器、間距在別處變樣；歸零佔位保留該邊界。
   html 前綴把 specificity 提到 (0,1,2)，贏過站方 .class::before。 */
/* v2.5.31：標題自己看不見的上下 padding 歸零（標記端見 passHeadingPseudoSpacerReset）。
   attr 重複兩次＋html 前綴（0,2,1）贏過站方 .class 與 [ARTICLE] h1 這類規則 */
html [${HEADING_PAD_ATTR}="1"][${HEADING_PAD_ATTR}="1"] {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
html [${HEADING_SPACER_BEFORE_ATTR}="1"]::before,
html [${HEADING_SPACER_AFTER_ATTR}="1"]::after {
  height: 0 !important;
  min-height: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
/* v0.7.87：媒體 element 強制 display: block，避免 inline default 配 large
   naturalHeight + 父層 line-height baseline 對齊讓 IMG top 跑到負 y、視覺
   覆蓋上方標題。newtalk.tw 實測 IMG height 891 + inline default → rect_y=-9
   蓋住 promoted-title (rect_y=108)。
   :not(a > img) 仍排除 link-wrapped icon（icon-link 結構保留 inline），這
   條額外 :not(picture > img) / :not(figure > img) 不必加——picture / figure
   本身已是 block container、img 在內部 block 只是視覺正確、不影響原 layout。
   v0.7.214：加 :not([${INLINE_IMG_ATTR}]) 排除 inline emoji / icon——此條
   specificity (0,2,3) 高於 inline-img rule (0,2,1)，沒排除會把已標 inline 的
   emoji 強制 block、emoji 獨佔一行（x.com Twemoji 實機回報）。 */
${MEDIA_CAP_SEL} {
  display: block !important;
  margin-bottom: 24px !important;
}
/* v0.7.88：媒體 max-height 限制——避免站把主圖原始尺寸塞到 reader card
   後 height: auto 計算出超大值（newtalk.tw 實機主圖 height=891 / cna 等
   類似結構），佔滿整屏甚至蓋住 promoted-title。90vh 留給標題與下方文字
   一些縫隙、又不過度限縮（90% viewport 高仍是大圖視覺）。 */
${MEDIA_CAP_SEL} {
  max-height: 90vh !important;
  object-fit: contain !important;
}
/* 大內容圖被 a（lightbox / photoswipe）包住的 rescue：apply() runtime 已對
   >= CONTENT_IMG_MIN 的 a-wrapped img 標 content-img attr（見 apply 內註解）。
   上方 block / max-height 規則用 :not(a > img) 排除把這類大圖漏成 display:inline
   + 原站小 margin（巴哈 forum.gamer.com.tw 圖文只隔 4px 實測）。對標記過的
   content-img 強制 block + 上下對稱 24px margin（解「圖文分隔太窄」）+ max-width
   100% + height auto + max-height 90vh，與一般內容圖同排版。a 包裝層一併設 block
   讓圖置中、margin 生效（inline a 內的 block img 不會撐出區塊）。
   icon-link（< 200px）不會被標記、維持原 inline icon 行為不受影響。 */
[${ARTICLE_ATTR}="1"] img[${CONTENT_IMG_ATTR}] {
  display: block !important;
  margin-top: 24px !important;
  margin-bottom: 24px !important;
  max-width: 100% !important;
  height: auto !important;
  max-height: 90vh !important;
  object-fit: contain !important;
}
[${ARTICLE_ATTR}="1"] a:has(> img[${CONTENT_IMG_ATTR}]) {
  display: block !important;
}
/* v0.8.112：bare 內容圖（非 a 包、來源解析度 < 版心）放大填滿欄寬。width:100%
   覆寫一般 img:not(a>img) 規則的 width:auto（後者退回 naturalWidth → 低解析配圖
   在版心裡偏小、與 a 包大圖不一致）。specificity (0,2,1) > 一般規則 img:not(a>img)
   的 (0,1,3)（第二段 attribute 數 2 > 1）→ 兩邊皆 !important 時本條勝。display:block
   / margin / max-height:90vh / object-fit:contain 已由 MEDIA_CAP_SEL 對 bare img 提供，
   不重複；直式長圖被 90vh + contain 收斂、不溢出。 */
/* v1.5.5：補 height:auto + 提 specificity——站點若對 bare hero img 釘死 height
   （搭配 aspect-ratio: auto W/H）會反推壓垮寬度。The Atlantic ArticleLeadArt hero
   實證：img 因 width="960" height="540" 屬性自帶 aspect-ratio auto 960/540，站點
   stylesheet 又用一條 (0,2,1) specificity 的 height 規則把它釘成 36px → 寬度反推成
   64px（width:100% 只解析成 picture flex item 的 64px）；height:auto 解除釘高後
   width:100% 才撐回滿版心 608px。a 包 content-img 規則（上方 984）早有 height:auto，
   bare upscale 漏這條。
   為何 attribute 加倍：站點那條 height 規則 specificity 恰 (0,2,1)、與本規則原本相等，
   且站點 sheet 後注入（cascade tie → 後者勝）→ 單純加 height:auto 仍輸。把
   [UPSCALE] 寫兩次拉到 (0,3,1) 穩贏（與 byline doubled-attr 同手法）；width 同提一致。
   結構通則（非站點特判）：任何站對 bare 內容圖釘死 height + aspect-ratio → 寬度塌掉，
   height:auto 讓寬度由版心 width:100% 主導、高度依長寬比自然跟隨（90vh + contain 收斂）。 */
/* v2.5.27（Jimmy 2026-11-19 裁定，取代 v0.8.112 的「一律撐滿欄寬」）：內文圖顯示寬
   不超過它原本的尺寸。上限由 apply 的 setUpscaleCap 寫進 inline 自訂屬性
   --jread-upscale-max（＝max(來源解析度, 進 reader 前站方顯示寬)）；沒有上限
   （SVG、量不到）時 fallback 100%，行為同舊版。width 仍寫明確值而不是 auto：
   v1.5.5 的「站方釘死 height 反推壓垮寬度」要靠明確寬度＋height:auto 才救得回來。 */
[${ARTICLE_ATTR}="1"] img[${UPSCALE_IMG_ATTR}][${UPSCALE_IMG_ATTR}] {
  width: min(100%, var(--jread-upscale-max, 100%)) !important;
  height: auto !important;
}
/* v1.8.5：icon 圖（作者頭像 / badge / logo）釘寬的第二通道。capIconImg 原本只靠
   inline 的 max-width:Xpx !important，實測**不保證贏**——換日線 crossing.cw.com.tw
   作者頭像上，jread 自己那兩條 max-width:100% !important（img:not(a > img) 與
   html [ARTICLE] :not([PLAYER])）就壓過了 inline important（cage 實證：把兩條
   deleteRule 掉，頭像立刻從 300px 收回站方顯示的 150px）。
   修法：釘寬值同時寫進 inline custom property --jread-icon-max，由本規則消費。
   attribute 寫三次 = specificity (0,4,1)，高過上述兩條（(0,1,3) / (0,2,1)），
   同一張 sheet 內純 specificity 決勝、不受 inline vs stylesheet 的 important
   排序影響。沒有 custom property 時 fallback 100%（等同原本行為，無副作用）。
   width:auto 對稱補上：釘的是「不得比站方顯示更寬」，寬度仍由內容/容器決定。 */
[${ARTICLE_ATTR}="1"] img[${ICON_IMG_ATTR}][${ICON_IMG_ATTR}][${ICON_IMG_ATTR}] {
  max-width: var(--jread-icon-max, 100%) !important;
  width: auto !important;
}
/* v2.5.5：被同層 in-flow 真圖蓋住的 absolute 佔位圖——不佔版面（見 COVERED_PH_ATTR） */
[${ARTICLE_ATTR}="1"] img[${COVERED_PH_ATTR}][${COVERED_PH_ATTR}][${COVERED_PH_ATTR}] {
  display: none !important;
}
/* picture 容器 aspect-ratio + padding-bottom 重置：v0.7.52 把 img 強制
   position: static 拉回 normal flow 後，picture 容器若用 aspect-ratio
   或 padding-bottom hack 撐高度（cna.com.tw <picture style="--aspect-ratio:
   2000/1500"> 配合 stylesheet 算出 aspect-ratio），原本 absolute img 走
   後 picture 變成「空 box 撐 75% padding」殘留視覺空白（cna 標題下方一
   大塊空白實機顯現）。修法：picture 強制 aspect-ratio: auto + padding-
   bottom: 0，讓高度由 img static 內容自然撐起（picture inline 預設
   height = 子元素高度）。
   通則安全：picture 合法用法是 <source>+<img> 的 art-direction wrapper、
   不需要 aspect-ratio 撐自身；aspect-ratio 都是原站「padding-bottom hack
   的現代寫法」想撐 placeholder 空間，跟 v0.7.52 拆解 absolute hack 配套。
   不影響 figure/div/section 的 aspect-ratio（這些可能合法用於 embed
   container），只 picture 一個 tag。 */
[${ARTICLE_ATTR}="1"] picture,
[${ARTICLE_ATTR}="1"] [class*="object-fit" i],
[${ARTICLE_ATTR}="1"] [${RATIO_CLASS_ATTR}="1"],
[${ARTICLE_ATTR}="1"] [class*="placeholder" i] {
  aspect-ratio: auto !important;
  padding-bottom: 0 !important;
  padding-top: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}
/* placeholder / ratio / object-fit 內部 wrapper 一併拉回 static flow：
   padding-bottom hack 的配套結構是「容器 position:relative（或 aspect-ratio
   撐高）+ 子層 position:absolute inset:0 填滿」。styler 已把 img/video 強制
   static（line ~303），但 img 與容器之間若有中間 wrapper div 仍保持 absolute，
   該 div 不佔 flow 高度→文字疊在圖片上（CNBC DIV.imageContainer 結構實測）。
   清 padding hack / aspect-ratio 時一併清所有後代的 absolute positioning，讓
   圖片容器自然撐高度。
   v0.8.94：選擇器補 [class*="ratio"] / [class*="object-fit"]，與上方 aspect-
   ratio/height reset 的容器集合對齊（原本只 placeholder 有配套 static-flow，
   ratio/object-fit 漏網）。根因實證：New Yorker（Condé Nast）hero 用
   DIV.AspectRatioContainer（CSS aspect-ratio 撐高）> SPAN > DIV.aspect-ratio
   --overlay-container（position:absolute inset:0 + overflow:hidden）> picture
   > img。上方 reset 把 AspectRatioContainer 的 aspect-ratio 清成 auto → 容器
   失去高度來源；但 overlay 仍是 absolute（class 是 ratio 不是 placeholder、
   漏掉 static-flow 配套）→ 不佔 flow 高度 → 容器塌成 0 → overlay inset:0 隨之
   0 高 + overflow:hidden 把 166px picture 整個裁掉 → hero 整張不見（Jimmy
   2026-06-16 截圖回報）。把 ratio 容器後代拉回 static，overlay 正常 flow、
   height:auto 撐到 picture 實際高度，hero 重新顯示。
   v0.8.155→v1.6.30：三條選擇器各補 :not([EMBED_WRAP_ATTR])（原為
   :not(:has(iframe))，#13 效能改 marker attr——本規則帶「 *」萬用後代尾巴，
   與任一 :has 規則共存即觸發整頁 insertion invalidation，見檔頭 v1.6.30
   不變式註解；EMBED_WRAP_ATTR 由 apply() 的 markEmbedWrapIframes 標記、
   晚 mount iframe 由 remarkDynamicMarkers 補標，語意不變）——aspect 容器
   若內含 iframe 是
   responsive 影片嵌入（YouTube/Vimeo/TED 等 WP wp-embed / Substack / Medium
   慣例：wrapper position:relative + ::before padding-top 16:9 hack 撐高 + iframe
   position:absolute inset:0 填滿）。這條 static-flow 配套是給「圖片塌陷容器」
   （New Yorker AspectRatioContainer / CNBC imageContainer）用的，套到影片嵌入
   子樹會把 wrapper（relative→static）+ iframe（absolute→static）一起打回 static
   → iframe 失去 absolute 後 height 掉回 HTML 預設 150px（reader iframe 規則只
   cap 寬不動高）、wrapper 的 ::before aspect box 仍在 → 上方一塊空白 + 下方被
   壓扁的影片（militaryrealism.blog wp-has-aspect-ratio YouTube 嵌入實證）。且
   FILL_IFRAME 偵測在量 computed position 時看到 static→不標記→修不到。排除
   :has(iframe) 子樹後 wrapper 維持 relative、iframe 維持 absolute，下方
   FILL_IFRAME 機制接手 pin 回 inset:0 填滿 aspect box。圖片塌陷容器無 iframe、
   不受此排除影響；圖片本身另有 :has(>img) static 配套（line ~1062）兜底。 */
[${ARTICLE_ATTR}="1"] [class*="placeholder" i]:not([${PLAYER_ATTR}="1"]):not([${EMBED_WRAP_ATTR}="1"]) *,
[${ARTICLE_ATTR}="1"] [${RATIO_CLASS_ATTR}="1"]:not([${PLAYER_ATTR}="1"]):not([${EMBED_WRAP_ATTR}="1"]) *,
[${ARTICLE_ATTR}="1"] [class*="object-fit" i]:not([${PLAYER_ATTR}="1"]):not([${EMBED_WRAP_ATTR}="1"]) * {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
}
/* 媒體直接容器不可塌陷：原站慣例用「固定 / 零 height 容器 + JS 注入播放器」
   做影片嵌入 placeholder（CNBC InlineVideo-inlineThumbnailContainer height:0
   + 內含 342px 縮圖 img，Jimmy 2026-06-09 截圖揭穿縮圖溢出疊在內文上）。
   reader mode 播放器 JS 不跑、容器維持塌陷高度，img overflow:visible 溢出蓋住
   後續段落。既有 height:auto reset 只綁 placeholder/ratio/object-fit/picture
   class，這類影片嵌入 wrapper class（InlineVideo-*）無語意、全 miss。
   通則：任何「直接子為 img / picture / video」的容器強制 height:auto +
   min-height:0，容器自然撐到媒體實際高度（不綁 class，與既有 placeholder /
   ratio / imageRow flex 修法同精神）。
   排除：inline emoji img（不撐其 p 容器）、已標記 player 的容器。:has 不命中
   時（無媒體直接子）規則不套，對純文字段落零影響。
   v0.8.59：補 max-height:none——原站常用「固定 height + max-height 容器 +
   object-fit:cover」把圖裁成 banner（myartbroker MagazineImage_imageWrap
   height/max-height:460px，Jimmy 2026-06-14 截圖揭穿）。reader mode 把圖片
   object-fit 改成 contain 顯示全圖（rendered 607 > 容器 460），height:auto 被
   殘留 max-height:460 頂死、圖片 overflow:visible 溢出蓋住下方圖說。height
   reset 必須連 max-height 一起解除，容器才撐到圖片實際高度。圖片本體自身
   仍有 90vh / 翻頁單頁 cap（在 img 選擇器上）、不會無限長。 */
${MEDIA_DIRECT_WRAP_SEL} {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
}
/* v0.8.105：含媒體的直接容器若自身 position:absolute / fixed，脫離 normal flow
   →不貢獻高度給 in-flow 祖先→祖先塌陷→絕對定位的圖疊在後續文字上（wikiHow
   Tie-a-Tie 影片步驟 DIV.video-container.content-fill position:absolute、
   父 DIV.video-player / DIV.mwimg.whvid 因此塌成 0/16px，圖壓住右側 step 文字，
   Jimmy 2026-06-18 寬版心截圖揭穿）。上面 height:auto reset 把容器高度解開了，
   但 absolute 容器自己不參與流、祖先仍量不到它 → 必須把含媒體的容器一併拉回
   static，圖回到正常 inline-block flow、祖先才撐得到它的高度。
   通則（硬規則 3，非站點/class 特判）：與既有「媒體 img/video 自身 static」
   （line ~760）、「placeholder/ratio 容器後代 static」（line ~851）同精神，
   差別是此條 keyed on「直接含媒體」的結構事實、補到無語意 class 的影片嵌入
   wrapper。排除已標記 player（responsive embed 靠 absolute 填滿 relative 框，
   見 PLAYER_ATTR 段）與 inline emoji。 */
${MEDIA_DIRECT_WRAP_SEL} {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
}
/* v1.5.16：站點寬版面把 figure 內圖片塞進一個比版心窄的 sub-column wrapper
   （width 設死 + margin-left:auto 靠右），在 reader 單欄版面下圖片被推到右側、
   左邊留一段空白（New Republic data-center oral history 實證：figure > div >
   DIV.image[width:481px; margin-left:auto] > .img-responsive-wrapper > img，608
   版心內圖片靠右、左側 127px gap，Jimmy 2026-06-29 截圖揭穿。與同頁 scrollytelling
   側欄 caption（v1.5.15）同根源——站點 2 欄寬版面以 viewport 寬判斷、量不到
   JRead 收窄的版心）。
   通則（硬規則 3，純結構 + 語意標籤判定、非站點/class 特判）：reader scope 內
   figure 是「配圖區塊」語意，其內任何「含圖片」的 wrapper 都應撐滿版心單欄、不被
   站點 sub-column 寬度與單側 auto margin 推偏——一律 width:auto（回填版心寬）+
   水平 margin auto（內層若仍有 max-width 限制則置中、不靠單側），圖片回到版心
   左右對齊。:has(img) 用 descendant 匹配（offset wrapper 常隔一層 responsive
   wrapper、非直接父）。排除被標記的 inline 小圖（icon-link）與 player 容器。
   退出移除整張 stylesheet 即還原。 */
[${ARTICLE_ATTR}="1"] figure *:not([${PLAYER_ATTR}="1"]):has(img:not([${INLINE_IMG_ATTR}])),
[${ARTICLE_ATTR}="1"] figure *:not([${PLAYER_ATTR}="1"]):has(picture) {
  width: auto !important;
  margin-left: auto !important;
  margin-right: auto !important;
}
/* v1.5.15：figcaption 內被站點「寬版面 scrollytelling 側欄 caption」拉成
   position:absolute 的圖說文字 wrapper，脫離 normal flow → 在寬 viewport + 窄版心
   組合下塌成 0 寬、文字一字一行疊在主文上（New Republic data-center oral history
   實證：.caption-text-wrapper position:absolute、computed width 0；站點 media query
   以 viewport 寬為準、量不到 JRead 把版心收成 720 → 進寬版 side-caption 模式，
   Jimmy 2026-06-29 版心寬 720 + 灰主題截圖揭穿、Chromium 寬 viewport probe 重現）。
   通則（硬規則 3，純結構 + 語意標籤判定，非站點/class 特判）：reader scope 內
   figcaption 語意是「圖說文字塊」，其本體與後代都應在 normal flow 內排版於圖片
   附近；任何被站點定位 hack（position:absolute/fixed）拉出流的 caption 子樹一律
   打回 static，並解除其塌陷寬度（width:auto）讓圖說文字回到圖片正常位置。窄版
   flex 版面（display:flex column-reverse、子層本就 static）不受影響——relative→static
   與既有 width 皆等效。退出移除整張 stylesheet 即還原。

   v1.6.20（twreporter 圖說跑到圖右側破版）：position hack 之外再補 transform:none。
   twreporter.org 用 transform 的 translateX(100%) 把 multimedia__Caption 推進圖片
   右側 sidebar（原站 caption 180px、位移 180px；reader 下 width:auto 拉成版心寬
   608px → 位移隨寬度變 608px 把整條圖說推到圖片右緣外，Jimmy 2026-07-08 截圖 +
   Chromium probe 實證 computed translate x 為 608px）。position 重置到 static 只
   還原 offset 定位，殘留的 translate 仍把已在流內的 caption 平移出去。通則同上：
   被站點 transform 位移拉出正常位置的圖說子樹一律打回 transform:none。 */
[${ARTICLE_ATTR}="1"] figcaption,
[${ARTICLE_ATTR}="1"] figcaption * {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
  width: auto !important;
  transform: none !important;
}
/* v3.7.13：圖說裡左右邊距不對稱的區塊清成 0（newrepublic 署名偏右 51px）。站方把圖框與署名
   寫在同一條規則（margin-left 20.83%、署名另有 margin-right 4.17%）讓兩者對齊同一欄；閱讀
   模式把圖框重置成滿欄，署名留著不對稱邊距，置中就偏到一邊。標記見 markCaptionAsymMargins */
[${ARTICLE_ATTR}="1"] figcaption [${CAP_ASYM_ATTR}="1"] {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
/* v0.8.106：inline 自動播放示範影片的 redundant <video> overlay 隱藏。
   wikiHow Tie-a-Tie 步驟在同一容器內放 poster <img> + <video>（video 是 absolute
   overlay，原站靠精準疊放讓兩者重合）。v0.8.105 把容器拉回 normal flow 後，static
   的 poster img 與仍 absolute 的 video 兩者都顯示且偏移 → 看到「兩張疊圖」（Jimmy
   2026-06-18 截圖）。
   通則（硬規則 3，純 CSS :has 結構判定，非站點/class 特判）：容器若同時直接含
   <img> 與 <video>（poster + overlay 慣例結構），隱藏其 <video>、只留 in-flow 的
   poster img 顯示單張。用純 CSS :has 而非 apply() JS 標記——wikiHow poster img 是
   lazy/JS 注入、apply() 標記當下常還不在 DOM；:has live 求值，img 一進 DOM 規則
   即生效、無 timing 競態。無 poster img 的步驟 :has(> img) 不命中 → video 照常
   顯示（唯一內容不誤殺）。退出移除整張 stylesheet 即還原 video 顯示。
   排除真 player root（:not([player])）——JW 式 player 的 video 包在 jw-media 內、
   非 img+video 直接兄弟、本不命中，:not([player]) 再保險一層。 */
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> img:not([${INLINE_IMG_ATTR}])):has(> video) > video {
  display: none !important;
}
/* v0.8.116：可播放原生 <audio controls> 被站方自訂播放器 flex wrapper 擠成 0 寬。
   原站「聽取本文音訊」類 podcast 區塊慣例：用一組 flex wrapper（title-container
   flex-column 等）把原生 <audio> 寬度壓成 0、改由自訂 JS player UI 呈現播放鍵 /
   進度軸（Stratechery passport-podcast-player 實證，Jimmy 2026-06-18 cage 真實
   DOM probe 量到 audio rectW=0、外層 flex 容器 width:0）。reader mode 清掉自訂 JS
   player 的 UI 元素後，只剩這個 0 寬的裸 <audio> + 一行短標籤 → 看起來是一大塊空白。
   但 <audio> 本身有 controls + 有效 src，本來就可播放。
   通則（硬規則 3，純 CSS :has 結構判定，非站點/class 特判）：reader scope 內任何
   含「使用者可播放」原生媒體（audio[controls] / video[controls]）的祖先鏈，解除
   flex/0 寬壓縮（display:block + width:auto + min-width:0），媒體本體還原可用寬度
   （min-width 兜底，避免父鏈塌陷時再被擠回 0），讓原生控制條正常渲染。
   只命中 [controls]——無 controls 的純 JS-driven <audio>/<video>（裝飾 / 背景音）
   不是使用者可播放介面，不在此列、不誤撐。display 不下在媒體本體上（會把原生
   replaced 元素的控制條高度壓成 0，probe 實證）；只放寬尺寸。退出移除整張
   stylesheet 即還原。 */
[${ARTICLE_ATTR}="1"] *:has(audio[controls]),
[${ARTICLE_ATTR}="1"] *:has(video[controls]) {
  display: block !important;
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
  height: auto !important;
}
[${ARTICLE_ATTR}="1"] audio[controls],
[${ARTICLE_ATTR}="1"] video[controls] {
  width: 100% !important;
  min-width: min(100%, 320px) !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
/* v0.8.59：被隱藏的 hero / header 圖殘留 min-height → 標題上方一大截空白。
   原站把「標題疊在 hero 圖上」的 header 容器設 min-height = hero 圖高（撐到等高
   再 flex 把標題靠底對齊）。cleaner 隱藏 hero img（data-jread-hidden）後，那層
   min-height 還在 → 標題被頂到框底、上方留一大截空白（myartbroker
   ArticleHeader_base min-height:240px + 同 header 內 hero img 被隱藏，Jimmy
   2026-06-14 截圖揭穿）。上面 :has(> img) 規則只 reset「直接含媒體的容器」自身，
   但 min-height 是掛在「標題疊圖層」這個 sibling 子樹的 descendant 上、漏網。
   通則：任何「直接子是被隱藏媒體」的容器，其自身與後代都不該再為那張不存在的
   圖保留 min-height。keyed on JRead 自己的 hidden marker——只在 hero
   真的被隱藏時觸發，不誤傷可見圖容器（可見圖容器走上面 :has(> img) 撐高）。
   v1.6.30（#13 效能）：原寫法「*:has(> img[data-jread-hidden="1"]) *」是
   probe 實測最重的單條放大器（wiki 600 節點插入單條 37s＝每次插入整頁
   recalc，見檔頭 v1.6.30 不變式註解）。改由 cleaner hide() 在隱藏 img /
   picture 的當下對 parentElement 標 HIDDENMEDIA_WRAP_ATTR（同刻生效、無
   timing 縫隙；動態階段的 hide 也走同一條 hide() path），restore() 清除。 */
[${ARTICLE_ATTR}="1"] [${HIDDENMEDIA_WRAP_ATTR}="1"],
[${ARTICLE_ATTR}="1"] [${HIDDENMEDIA_WRAP_ATTR}="1"] * {
  min-height: 0 !important;
}
/* v2.2.17：標題覆蓋層的 ::before / ::after 暗化遮罩（aeon h1::before 140px
   box-shadow）回到卡片底色後只剩灰色漸層塊。pseudo 無法 inline 覆寫，由 cleaner
   標 attr、這裡歸零。 */
[${ARTICLE_ATTR}="1"] [${OVERLAY_PSEUDO_SHADOW_ATTR}="1"]::before,
[${ARTICLE_ATTR}="1"] [${OVERLAY_PSEUDO_SHADOW_ATTR}="1"]::after {
  box-shadow: none !important;
}
/* v2.5.28：內文按鈕去殼後，站方掛在按鈕上的展開箭頭 / 圖示 pseudo（pmc 期刊名
   button[aria-expanded=false]::before { content: "▸ " }）一併拿掉。pseudo 無法 inline
   覆寫，由 cleaner 標 attr、這裡歸零。shadow root 內的按鈕吃不到這條（樣式不穿透），
   那邊維持站方的 pseudo。 */
[${ARTICLE_ATTR}="1"] [${BTN_TEXT_ATTR}="1"]::before,
[${ARTICLE_ATTR}="1"] [${BTN_TEXT_ATTR}="1"]::after {
  content: none !important;
}
/* v1.9.16：翻頁模式下的選取工具列由 JRead 釘位。翻頁卡片是 position:fixed 的
   橫向捲動多欄容器，站方照原本 containing block 算的 inline transform 會把工具列
   放到選取範圍旁邊幾百 px（第 N 頁還要再偏 N 個 stride），而且站方會讀工具列
   當下的 rect 重算、疊修正量會被抵銷。這裡用 stylesheet !important 蓋掉站方的
   inline position / inset / transform，座標由 cleaner 寫進自訂屬性
   （pinToolbarOverSelection）。只在 cleaner 標了 pin attr 的宿主生效。 */
html [${ARTICLE_ATTR}="1"] [${SEL_TOOLBAR_PIN_ATTR}="1"] {
  position: fixed !important;
  top: var(${SEL_TOOLBAR_PIN_TOP}, -10000px) !important;
  left: var(${SEL_TOOLBAR_PIN_LEFT}, -10000px) !important;
  right: auto !important;
  bottom: auto !important;
  transform: none !important;
  translate: none !important;
  margin: 0 !important;
  /* 2026-10-07 review B-19：層級不交給站方——翻頁卡片是 fixed 自成 stacking
     context，detector 注入的 H1 帶 z-index:10，站方工具列若是 z-index:auto 且被
     推到選取下方（fallback 分支）會被 H1 蓋住一角。2147483646 高於任何主文元素、
     低於頁碼 / scrubber / 進度條的 2147483647（那些掛 <html>、在根層，本就不同
     context；數值只為可讀的相對序）。 */
  z-index: 2147483646 !important;
}`;
      const segCarouselPseudo = () => `
/* ===== Carousel / slider 版面中和（v0.8.67）=====
   原站用 carousel/slider library（pure-react-carousel / slick / swiper /
   splide / flickity）做水平翻頁 widget。三層共通結構：
     1) slider 根：overflow:hidden + JS 寫死的 inline height，只露一張 slide
     2) slide track：display:flex（nowrap）+ transform:translateX(...) 平移
     3) 每張 slide：padding-bottom aspect hack 撐高度 + 內層 position:absolute
        inset:0 填滿（pure-react-carousel 的 inner-slide）
   reader mode 把 overflow / transform 拆掉後，JS 寫死的 height 與 slide 的
   absolute 內層仍在 → slide 內容（圖片）溢出自己被壓縮的 aspect box、疊到
   上一張 slide 的圖說上（christies stories「Auction Highlights」carousel，
   Jimmy 2026-06-14 截圖：圖蓋住「20TH & 21ST CENTURY ART | AUCTION
   HIGHLIGHTS」文字）。
   通則：carousel library 的 class 名是跨站共用的「結構慣例」（library 公開
   CSS API，非單一站點 hash class），與既有 [class*="ratio"] / .imageRow /
   placeholder hack 修法同精神。把 slider 根 / track / slide / inner 全部拉回
   normal vertical flow——height auto + transform none + display block +
   position static + 清 padding-bottom hack——slide 改成乾淨垂直堆疊、不再
   互相重疊。不移除內容（圖庫類 carousel 的每張 slide 仍可讀）。 */
[${ARTICLE_ATTR}="1"] [class*="carousel__slider"],
[${ARTICLE_ATTR}="1"] [class*="slick-list"],
[${ARTICLE_ATTR}="1"] [class*="splide__track"],
[${ARTICLE_ATTR}="1"] [class*="flickity-viewport"],
[${ARTICLE_ATTR}="1"] [class~="swiper"] {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
}
[${ARTICLE_ATTR}="1"] [class*="sliderTray" i],
[${ARTICLE_ATTR}="1"] [class*="slider-tray" i],
[${ARTICLE_ATTR}="1"] [class*="slick-track"],
[${ARTICLE_ATTR}="1"] [class*="swiper-wrapper"],
[${ARTICLE_ATTR}="1"] [class*="splide__list"],
[${ARTICLE_ATTR}="1"] [class*="flickity-slider"] {
  transform: none !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  white-space: normal !important;
}
[${ARTICLE_ATTR}="1"] [class*="carousel__slide"],
[${ARTICLE_ATTR}="1"] [class*="carousel__inner-slide"],
[${ARTICLE_ATTR}="1"] [class*="slick-slide"],
[${ARTICLE_ATTR}="1"] [class*="swiper-slide"],
[${ARTICLE_ATTR}="1"] [class*="splide__slide"],
[${ARTICLE_ATTR}="1"] [class*="carousel-cell"] {
  position: static !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  padding-bottom: 0 !important;
  float: none !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
  margin-right: 0 !important;
  transform: none !important;
}
/* [class*="placeholder"] 解釋：lazy-load wrapper 慣例命名（today.line.me
   實機 Jimmy 截圖揭穿 div.placeholder style="padding-top:75.25%" 撐
   aspect-ratio 4:3 placeholder）。padding-top 是 padding-bottom hack 的
   variant（兩者效果一樣，撐父寬度的固定比例高度）。為 padding-bottom hack
   配套加 padding-top:0 第二維度 reset，覆蓋兩種寫法。 */
/* object-fit 是 CSS property 名，當 class 用代表「給 img 套 object-fit
   的 wrapper」是常見 pattern（gvm.com.tw figure 內 div.object-fit
   2026-04-28 實機 Jimmy 截圖揭穿撐空白）。跟 picture 一樣可能用 aspect-ratio
   或 padding-bottom hack 撐 lazy-load placeholder。同 picture rule 處理。 */
/* picture::before / picture::after 強制不渲染——cna.com.tw 在
   <picture style="--aspect-ratio:2000/1500;"> 上掛 picture::before
   配 content: '' + display: block + padding-bottom: 75%（從 CSS variable
   --aspect-ratio 算出 4:3 比例）撐 picture 高度做 lazy-load placeholder。
   v0.7.55 picture 自身 aspect-ratio:auto + padding-bottom:0 沒清掉 ::before，
   ::before 仍在撐高度（Jimmy v0.7.60 截圖揭穿 picture > ::before 才是真兇，
   不是 source）。修法：reader card 內 picture::before / picture::after 強制
   content: none + display: none + padding-bottom: 0，禁止 pseudo-element
   撐空間。同時對 figure 與保險清單同樣處理。
   通則安全：picture 合法用法不需要 ::before pseudo-element 撐空間（圖片本身
   有 intrinsic 尺寸），::before 是 placeholder hack 的現代寫法。 */
[${ARTICLE_ATTR}="1"] picture::before,
[${ARTICLE_ATTR}="1"] picture::after,
[${ARTICLE_ATTR}="1"] figure::before,
[${ARTICLE_ATTR}="1"] figure::after,
[${ARTICLE_ATTR}="1"] [class*="object-fit" i]::before,
[${ARTICLE_ATTR}="1"] [class*="object-fit" i]::after,
[${ARTICLE_ATTR}="1"] [${RATIO_CLASS_ATTR}="1"]::before,
[${ARTICLE_ATTR}="1"] [${RATIO_CLASS_ATTR}="1"]::after,
[${ARTICLE_ATTR}="1"] [class*="placeholder" i]::before,
[${ARTICLE_ATTR}="1"] [class*="placeholder" i]::after {
  content: none !important;
  display: none !important;
  padding-bottom: 0 !important;
  height: 0 !important;
}
/* v1.0.5：lazy-load placeholder 容器的 ::before aspect 佔位補進中和清單——
   [class*="placeholder"] 之前只在 aspect-ratio/height reset（line ~989）與
   static-flow reset（line ~1027）兩條，漏掉本條 ::before 中和；object-fit/ratio
   都有、placeholder 沒有。fiaformulae.com 實機揭穿：DIV.w-embeddable-photo__
   image-container.o-placeholder 用 ::before { padding-bottom: 56.25% } 撐 aspect
   佔位 + 子層 DIV.js-lazy-load { position:absolute; inset:0 } 填滿。static-flow
   reset 把 js-lazy-load 打回 static → 圖掉出 overlay 堆到「仍存活的 ::before
   佔位」下方 → 標題下方一大塊空白（Jimmy 2026-06-25 截圖回報）。placeholder
   ::before 一併中和後佔位消失，static 化的圖以 intrinsic 高度自然撐起。 */
/* v1.0.5：lazy-load 容器內的 loading spinner <svg> 隱藏——placeholder / ratio /
   object-fit 這類 lazy-load wrapper 的 direct child <svg> 是載入動畫 spinner
   （fiaformulae js-lazy-load wrapper 內 <svg><use></use></svg>），reader mode 下
   原站 lazy observer 凍結、spinner 不會被站方 JS 隱藏。媒體 element display:block
   規則讓無 viewBox/height 的 svg 露出 replaced-element 預設 150px 高度，在圖片
   上方撐出空白。direct child <svg> 是「lazy 佔位 spinner」的結構訊號（內容用
   svg 圖表掛在 figure/content div、不會是 lazy wrapper 的 direct child）。 */
[${ARTICLE_ATTR}="1"] [class*="placeholder" i] > svg,
[${ARTICLE_ATTR}="1"] [${RATIO_CLASS_ATTR}="1"] > svg,
[${ARTICLE_ATTR}="1"] [class*="object-fit" i] > svg {
  display: none !important;
}
/* CSS side-bleed 裝飾 pseudo（::before / ::after + position:absolute + bg-color
   + transform: translate）—— 原站慣例用來把卡片底色「溢出」到 article 左右側，
   reader card 不需要這種裝飾。CNBC ArticleHeader-styles-makeit-wrapperHeroNoImage
   ::before 把 white bleed 到 header 左側 522×482px 大片白盒（v0.7.169 Jimmy
   2026-05-23 截圖揭穿；CDP DOM.getNodeForLocation 指認 transform:matrix(1,0,0,1,
   -522.578,0) + bg-color:white）。修法：reader card 內 *::before / *::after
   一律清掉 background-color 與 background-image，content + color 不動，list
   marker / drop cap 文字 pseudo 仍工作。
   通則安全：pseudo bg 在 reader card 沒有合法用途——pageWrapper 已有自己的
   bg，多餘 pseudo bg 只會在版心外漏出色塊（或誤覆蓋主文）。
   v3.7.4：清單項目的前置偽元素不清——站方關掉清單樣式、改用它以底色畫項目符號
   圓點（cnbc「Key Points」），清掉就沒有項目符號（細節見 SPEC「清單項目符號」） */
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):not(li)::before,
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"])::after {
  background-color: transparent !important;
  background-image: none !important;
}
/* v0.8.41：reader card / ancestor「自身」的 ::before / ::after 整顆關掉。
   上面那條只蓋 card 的「後代」pseudo、且只清 bg（border 畫的裝飾清不到）。
   foreignaffairs.com 在整頁 wrapper .base::before 掛 position:absolute +
   inset:0 + border:15px solid 的整頁裝飾框；該 wrapper 被選為 card（或落在
   ancestor 鏈）後 position 被 reset 成 static，inset:0 改以 viewport 大小的
   initial containing block 定位，渲染成「第一頁位置一個 viewport 大小的框」
   （site 邊框色跟 color-scheme 走：dark 黑框 / light 灰框）。
   通則安全：card = 主文容器、ancestor = 純 layout 通道，reader mode 下兩者
   自身的 pseudo 只可能是站方版面裝飾（frame / side-bleed / overlay）；drop cap
   / list marker / 引號這類合法文字 pseudo 都掛在後代元素上，不受影響。
   直接 content:none 比逐項清 paint 屬性（bg / border / shadow）徹底。 */
[${ARTICLE_ATTR}="1"]::before,
[${ARTICLE_ATTR}="1"]::after,
[${ANCESTOR_ATTR}="1"]::before,
[${ANCESTOR_ATTR}="1"]::after {
  content: none !important;
}`;
      const segWrapperIconFigcaption = () => `
/* Body wrapper margin reset：原站慣例用 div 包 paragraph cluster / heading /
   list 並設 margin-left/right 形成 grid offset 或 narrow-column 視覺（CNBC
   ArticleBody 內 div.group margin-left:91px 把內文 p 整段推向版心右側 91px；
   v0.7.169 Jimmy 截圖揭穿 p rect.left=587 vs caption rect.left=496）。
   reader card 單欄版心、這些 wrapper margin 失意義、把主文擠成偏右窄條。
   通則：含 direct content child（p / h1-h6 / ul / ol / blockquote）的 div =
   body content wrapper、reader mode 不需橫向位移、清掉 margin-left/right。
   其他媒體 block（figure / blockquote / pre）有自身 margin auto-center 邏輯
   不受影響（這條 selector 命中的是 div，不是 figure/blockquote 本身）。
   CSS :has() Chrome 105+ 支持、Manifest V3 用戶實機均可用；jsdom 不支持
   :has() 語意但只驗 CSS 字串注入即可（不依賴 layout 計算）。 */
[${ARTICLE_ATTR}="1"] div:has(> p),
[${ARTICLE_ATTR}="1"] div:has(> h1, > h2, > h3, > h4, > h5, > h6),
[${ARTICLE_ATTR}="1"] div:has(> ul, > ol),
[${ARTICLE_ATTR}="1"] div:has(> blockquote) {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
[${ARTICLE_ATTR}="1"] a > img {
  max-width: 100% !important;
}
/* Icon container wrapper 內的 img 限縮到合理 icon 尺寸：原站常用 wrapper-icon
   / media-icon / app-icon / thumb-icon 等 CMS 命名作為「inline 小圖容器」，
   靠 stylesheet 對 wrapper 設 width:160px + img 設 width/height:100% 達成
   小尺寸顯示。reader mode 下 jread 對 img 套 height:auto !important 會把
   原站的 height:100% 蓋掉，img 退到 naturalWidth×naturalHeight（icon 通常
   512×512）+ wrapper shrink-to-fit 跟著撐大 → 小 icon 變超大圖。
   通則依據：「wrapper-icon / media-icon / app-icon」是跨站 CMS 命名 pattern
   （WordPress block themes / Squarespace / 自製 design system 普遍用），用
   attribute substring selector 命中含此 token 的 wrapper、對其內 img 限縮
   max-width/max-height 200px（一般 icon < 200px、超過視為配圖不該套此規則）。
   實測：macstories.net 的 PixyCAD app icon 從 512px 壓回 < 200px 顯示。 */
[${ARTICLE_ATTR}="1"] [class*="wrapper-icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="wrapper_icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="media-icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="media_icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="app-icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="app_icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="thumb-icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="icon-wrapper"] img:not(a > img),
/* v0.7.207：avatar 是跨站通用 pattern（Medium / Substack / WordPress / CMS
   類「作者頭像」「來源圖示」），命名慣例 author-avatar / avatar-wrapper /
   avatar_image / user-avatar 等。reader mode 下這類 img 應保持 icon 尺寸、
   不該因 flex layout 被撐到全寬。命中 wrapper class 或 img class 含 avatar
   token 都套 200px 上限。thenewslens.com 「中央通訊社」author-avatar 在
   ratio wrapper 內被撐到 496×496 實機 bug 觸發。 */
[${ARTICLE_ATTR}="1"] [class*="avatar" i] img:not(a > img),
[${ARTICLE_ATTR}="1"] img[class*="avatar" i]:not(a > img) {
  width: auto !important;
  height: auto !important;
  max-width: 200px !important;
  max-height: 200px !important;
}
/* iframe 特例：有 intrinsic 高度這件事對 iframe 不成立——height: auto 會
   掉回 HTML spec 預設的 150px，打壞 aspect-ratio wrapper（WP wp-embed /
   Substack / Medium 等「wrapper 維 16:9 + iframe position:absolute 填滿」
   模式）。只 cap 寬度、不動高度。 */
[${ARTICLE_ATTR}="1"] iframe {
  max-width: 100% !important;
}
/* figure / picture 媒體容器撐滿父寬度：reader mode 下原站 DOM 結構被我們
   改動（ancestor reset / body 解除原 layout），某些站（例如商周
   figure.articlephoto）原本靠「width: 800px」類固定寬 CSS 給 figure
   顯式寬度的 rule 失效後，figure 退化成 shrink-to-fit + min-width:0 →
   被 figcaption 中文單字寬度夾死成 ~31px、img 跟著縮到幾乎看不見。
   通則：display:block 的媒體容器預設行為就是 100% of parent，reader
   mode 下強制明示這個預設、不依賴原站殘留 CSS。picture 同理避免類似
   退化。不碰字體/字級/行高，只處理媒體容器的寬度退化。 */
[${ARTICLE_ATTR}="1"] figure,
[${ARTICLE_ATTR}="1"] picture {
  width: auto !important;
  max-width: 100% !important;
  /* v0.7.99：figure 與下方主文內容拉開間距。BBC Culture 類站點原站 CSS
     '.bOanuU' 之類 styled-components hash class 把 figure margin 砍光，
     reader mode 下 figcaption 正下方緊貼下一段 p、視覺壓在一起。
     1.5em 相對字級縮放（讓使用者調字級時間距同步），不寫死 px 避免
     「字小時間距過寬 / 字大時間距太擠」。 v0.7.100 加 margin-top 同樣
     1.5em，解 figure 上方緊貼前一段 p 的對稱問題。 */
  margin-top: 1.5em !important;
  margin-bottom: 1.5em !important;
}
/* v0.7.209：figcaption 固定寬度退回 auto。原站可能對 figcaption 設固定窄寬
   做 sidebar-style 圖文並排 layout（twreporter.org figcaption width: 180px
   配主文 480px 雙欄）。reader mode 下 figure 已被強制 block，圖說殘留固定
   180px 窄寬會被擠成「每行 1-2 字」的窄欄。
   width: auto（拉回 block-level 預設 = 100% of parent）由上方 v1.6.20 position
   hack 規則統一注入（figcaption 與後代全蓋，v1.7.43 移除此處重複宣告）；本條
   專責 max-width: 100% 防上限超出 figure。不碰 background/color/font——保留
   原站 typography hierarchy。 */
[${ARTICLE_ATTR}="1"] figcaption {
  max-width: 100% !important;
}${!theme.text ? `
/* v0.8.123：light theme 圖說顏色加深。dark / sepia 下 figcaption 已由
   userOverrides 的 *-color-theme.text 規則強制接管文字色（v0.8.45）、
   對比足夠；但 light theme 不注入文字色（theme.text 為 null），figcaption
   保留原站灰（theverge.com 實測 #4a4a4a / 8.86:1——對比其實不差，但比內文
   #1a1a1a 淺一截、配 11px 小字視覺上偏淡，Jimmy 2026-06-19 回報「淺色模式
   圖說對比不夠、閱讀困難」）。不同站原站 caption 灰深淺不一（部分站 #999
   ~ 2.8:1 確實低對比）→ light theme 統一強制深灰 #333（白底 12.6:1，比
   原站 #4a4a4a 更深、又仍比內文近黑淺一階，保留 caption < body 的階層）。
   figcaption * 一併覆寫——photo credit 常包在 figcaption 內的 <em> / <span>
   （theverge 實測），inline 子元素自身若有色規則不靠 inherit、需顯式覆寫。
   結構通則（非站點特判）：light theme 所有 figcaption 一律套此可讀深灰。

   v0.8.169（TWZ 圖說黑條修法）：一併把 figcaption 背景正規化為透明。bg-preserve
   邏輯（v0.7.195，BG_PRESERVE_NOT 排除 figcaption）原意是保留站點「淺字 + 深底」
   成對的可讀圖說；但本條 light theme 規則已強制圖說文字為卡片色深灰 #333，與
   「保留深底」直接矛盾——站點若給 figcaption 設深色背景（twz.com
   .article-featured-image-caption 深底 #2a3439 + 站點圖說字 #333 = 1.01:1），
   深字落深底＝整條黑條、credit 文字完全看不見。既然 light theme 已決定圖說用卡片色
   文字，背景就必須跟著卡片走（透明讓白卡透出）。dark / sepia 不受影響（gated 在
   !theme.text、theme bg/text 另由 *-color-theme 規則接管）。 */
[${ARTICLE_ATTR}="1"] figcaption,
[${ARTICLE_ATTR}="1"] figcaption * {
  color: #333333 !important;
  background-color: transparent !important;
}` : ''}`;
      const segHeadingAlign = () => `
/* v0.7.100：h1-h6 上下 margin。BBC Culture 類站點原站 CSS 把 heading 的
   margin 全砍光（styled-components hash class 預設 margin: 0），reader mode 下
   段落 p 結束 → h2 標題 → 下一段 p 三者直接接壤、無視覺斷層、難辨章節。
   通則：h2-h6 加大 margin-top（章節分隔）+ 較小 margin-bottom（標題與其
   描述 / 首段較緊密）。h1 主標題已由 first-child rule 強制 margin-top: 0
   不衝突，這條對 h1 加 margin-top 也不傷（first-child rule specificity 較高）。
   v0.7.171：原 1.5em / 0.5em 在「font-size 巨大的 h1」站點(CNBC h1.headline
   font-size:54px → 1.5em = 81px margin-top)會撐出 80-90px 的「LIFE 標籤跟標題
   中間大段空白」、dark mode 卡片底色深、空白特別明顯。Jimmy 2026-05-23 CNBC
   blob 截圖揭穿。改用 clamp() 上下限封頂：margin-top 介於 16px..32px、
   margin-bottom 介於 8px..16px。CNBC h1 81px → 32px;BBC h1 ~48px → 32px;
   一般 h2-h6 (font 24-30px) 1em 在 24-30px 落入 clamp 中段、近似原 1.5em
   效果但不會無限放大。clamp 中段值用 1em 而非 1.5em、配合 cap 後 medium-h1
   也夠視覺分隔。 */
[${ARTICLE_ATTR}="1"] h1,
[${ARTICLE_ATTR}="1"] h2,
[${ARTICLE_ATTR}="1"] h3,
[${ARTICLE_ATTR}="1"] h4,
[${ARTICLE_ATTR}="1"] h5,
[${ARTICLE_ATTR}="1"] h6 {
  margin-top: clamp(16px, 1em, 32px) !important;
  margin-bottom: clamp(8px, 0.4em, 16px) !important;
}
/* v3.7.13：攤開的 <details>，摘要列是標題區時，標題區後面的留白只算一次（react.dev「DEEP DIVE」
   方塊：摘要列裡「<h5>Deep Dive</h5><div><h4>Props vs State</h4></div>」，標題到內文之間疊了
   摘要列底內距 32＋包層下邊距 16＋內容框頂內距 16＋段落上邊距 16＝80px；方塊頂內距 32＋第一個
   標題上邊距 16 也疊成 48px。Jimmy 2026-11-28 裁定：連續標題留白只算一次）。
   收法：摘要列底內距歸 0（標題區的下邊距穿過摘要列、與內容框之間只剩一次）、內容框第一個
   子元素的上邊距歸 0、摘要列第一個標題的上邊距歸 0（方塊頂內距已經隔開）。內容框的頂內距
   由 cleaner capWrapperSpacing 以 inline 壓到 16px（這裡蓋不過、也不去動它），量到的結果：
   標題到內文 80 → 32px、方塊頂到第一個標題 48 → 32px。
   範圍：details[open] > summary 直接或隔一層包著標題——攤開收合區塊（expandCollapsedSections）
   之後才有的版面；語料庫 182 頁裡 summary 包標題的只有 react.dev 原文、翻譯後 */
[${ARTICLE_ATTR}="1"] details[open] > summary:has(> :is(h1, h2, h3, h4, h5, h6), > * > :is(h1, h2, h3, h4, h5, h6)) {
  padding-bottom: 0 !important;
}
[${ARTICLE_ATTR}="1"] details[open] > summary:has(> :is(h1, h2, h3, h4, h5, h6), > * > :is(h1, h2, h3, h4, h5, h6)) > :is(h1, h2, h3, h4, h5, h6):first-child {
  margin-top: 0 !important;
}
[${ARTICLE_ATTR}="1"] details[open] > summary:has(> :is(h1, h2, h3, h4, h5, h6), > * > :is(h1, h2, h3, h4, h5, h6)) + * > :first-child {
  margin-top: 0 !important;
}
/* v1.6.18：閱讀模式主文一律靠左對齊（Jimmy 2026-07-08）。原本未指定對齊、繼承站點
   ——站點置中的標題 / 副標 / 段落（Fox News header.article-header text-align:center
   → h1/h2/byline 置中）在閱讀模式維持置中、閱讀體感不一致。改成容器設預設左對齊 +
   逐 text 元素覆蓋站點「直接宣告 / 繼承」的置中。
   v1.6.24：left → start——LTR 內容行為完全相同（仍靠左），RTL 文章（阿拉伯文 /
   希伯來文，dir=rtl）start 解析為右對齊、不再被錯誤推去左緣。
   specificity 刻意保持 (0,1,1) 以下：
   CJK 段落 justify（data-jread-cjk-justify，0,2,0）與 byline 正規化（data-jread-byline，
   0,2,0）specificity 較高、仍優先，不受本規則影響。媒體 / 卡片置中靠 margin:auto（非
   text-align）不受影響；figure / figcaption / table cell 保留站點對齊（不列入 selector）。 */
[${ARTICLE_ATTR}="1"] {
  text-align: start !important;
}
[${ARTICLE_ATTR}="1"] :is(h1, h2, h3, h4, h5, h6, p, li, blockquote, dd, dt),
[${ARTICLE_ATTR}="1"] [${TEXT_DIV_ATTR}="1"] {
  text-align: start !important;
}
/* v2.5.46：標題斷行不沿用站方的 text-wrap: balance。balance 把標題平衡成等長
   幾行，中文長標題在卡片寬度一半左右就折行（Readwise Reader 的
   .document-content h1/h2/h3 { text-wrap: balance }，Jimmy 2026-11-23 回報副標題
   「在一半就折行」）。改用 pretty：第一行排滿、只避免末行剩孤字。先寫 auto 當退路
   ——不支援 pretty 的引擎（Safari 26 以前）丟掉第二條，仍會蓋掉站方的 balance。
   只管 text-wrap-style，不動 text-wrap-mode（站方 nowrap 另有用途，不在本規則）。 */
[${ARTICLE_ATTR}="1"] :is(h1, h2, h3, h4, h5, h6),
[data-jread-promoted-outside="1"] :is(h1, h2, h3, h4, h5, h6),
:is(h1, h2, h3, h4, h5, h6)[data-jread-promoted-outside="1"] {
  text-wrap-style: auto !important;
  text-wrap-style: pretty !important;
}`;
      const segByline = () => `
/* v1.0.8：byline meta 區一行正規化（標記由 apply() 結構偵測，見 BYLINE_ATTR
   常數註解）。root flex 一行、wrapper display:contents 打平任意巢狀讓 leaf 升為
   root 的 flex item、item 字級統一、頭像 inline 對齊內容左緣、隱藏閱讀時間。
   全 theme 適用（byline 文字色交給 reader 文字色 inherit、作者連結維持 link 色
   雙通道）。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}] {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: wrap !important;
  /* v1.5.28：align-items center → baseline。center 讓等高 item 中線對齊，但站點
     item 內容（date span / 含 <a> 的 program-block）盒內基線位置不一，中線對齊後
     文字看起來上下錯位（NPR「HEARD ON」比日期高 9px）。baseline 直接對齊各 item
     文字基線，文字齊一行；byline 以文字為主，基線對齊比中線穩（頭像 item 由下方
     img 規則控高、baseline 下對齊亦自然）。 */
  align-items: baseline !important;
  justify-content: flex-start !important;
  column-gap: 0.5em !important;
  row-gap: 0.2em !important;
  margin: 0.2em 0 0.8em 0 !important;
  padding: 0 !important;
  /* v1.7.42：left → start——RTL（阿拉伯文 / 希伯來文）頁面 byline 應貼行起始側，
     硬寫 left 違反 v1.6.24 RTL 政策；LTR 下 start === left、行為不變 */
  text-align: start !important;
}
[${ARTICLE_ATTR}="1"] [${BYLINE_WRAP_ATTR}] {
  display: contents !important;
}
[${ARTICLE_ATTR}="1"] [${BYLINE_ITEM_ATTR}] {
  display: inline-flex !important;
  align-items: center !important;
  /* v1.0.18：item 內若同時含直接文字 + 子元素（"By <a>作者</a>"、"published
     <time>…"、小頭像 + 名字），inline-flex 會把文字與元素變成相鄰 flex item、
     吃掉它們之間的空白（space.com byline 實測 "ByTereza" 黏在一起）。補一個
     正常字距 column-gap 還原詞距；純單一文字 / 單一媒體的 item 只有一個 flex
     child、gap 無作用故不受影響。 */
  column-gap: 0.25em !important;
  margin: 0 !important;
  padding: 0 !important;
  float: none !important;
  font-weight: 400 !important;
  letter-spacing: normal !important;
}
/* v1.7.12：多作者 inline 文字流 item（標記條件見 BYLINE_INLINE_ATTR 常數註解）。
   inline-flex 的 nowrap flex row 遇寬內容（translate-first 保留英文人名）會把每條
   連結壓到 min-content、名字折行＋分隔符直排；作者清單是一句話、回歸自然文字流。
   doubled attr (0,3,0) 壓過上方 byline-item inline-flex (0,2,0)。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_INLINE_ATTR}][${BYLINE_INLINE_ATTR}] {
  display: block !important;
}
[${ARTICLE_ATTR}="1"] [${BYLINE_INLINE_ATTR}] a {
  display: inline !important;
}
[${ARTICLE_ATTR}="1"] [${BYLINE_RT_ATTR}] {
  display: none !important;
}
/* v2.5.52：作者列裡站方 pseudo 畫的分隔符／空字串裝飾殼（見 BYLINE_PSEUDO_SEP_ATTR） */
[${ARTICLE_ATTR}="1"] [${BYLINE_PSEUDO_SEP_ATTR}~="before"]::before,
[${ARTICLE_ATTR}="1"] [${BYLINE_PSEUDO_SEP_ATTR}~="after"]::after {
  content: none !important;
}
/* v1.7.4：孤兒分隔符（相鄰 item 被隱藏後失去隔開對象的「·」「|」等）隱藏。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_SEP_ATTR}] {
  display: none !important;
}
/* v1.5.28：byline 內發稿時刻（HH:MM AM/PM TZ）隱藏，只留日期。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_TIME_ATTR}] {
  display: none !important;
}
/* v1.5.28：廣播節目出處 chip（"Heard on <節目>"）隱藏——閱讀模式非必要 metadata。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_PROGRAM_ATTR}] {
  display: none !important;
}
/* v1.5.28：日期 item order:1 推到最後 → 作者（預設 order:0）排在日期前。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_DATE_ITEM_ATTR}] {
  order: 1 !important;
}
/* v1.5.28：標題前的分類 kicker（連分類頁的短連結）隱藏。 */
[${ARTICLE_ATTR}="1"] [${KICKER_ATTR}] {
  display: none !important;
}
/* v1.7.25（Jimmy 2026-07-30）：byline 頭像一律不顯示——原 2em 圓形縮圖規則
   改為整個藏掉（img + picture wrapper 都藏，避免空 picture 殘留寬度）。
   與 cleaner hideBylineAvatarImgs（吃 byline 標記外的頭像列）是同一份事實
   的雙軌實作，改頭像顯示政策時兩處同改。
   v1.7.39：此規則 specificity (0,2,1) 會被 MEDIA_CAP_SEL (0,3,3) 的
   display:block 與 inline-img 規則（source order 在後）打穿——權威實作改在
   apply() 的 hideAvatarMedia（runtime inline !important），本規則降級為
   「apply 之後動態插入頭像」的兜底。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}] img,
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}] picture {
  display: none !important;
}
/* v1.0.19：byline 內頭像媒體（picture / img / video）margin reset。頭像在
   Substack 等站是 <picture> 包 <img>、flex item 是 picture（不是 img）。上方
   hero 媒體置中通則（[ARTICLE] picture { margin-left/right: auto }，specificity
   0,2,1）會把 byline 頭像 picture 也當區塊媒體置中——在 byline flex 一行內，
   auto margin 解析成「吃光自由空間」（culpium.com 實證頭像 margin 兩側各 190px、
   把頭像推到列中央），justify-content:flex-start 因無自由空間可分配而失效，頭像
   與作者/日期散開。doubled [BYLINE] attr 把 specificity 提到 (0,3,1) 壓過置中
   通則，鎖 byline 媒體 margin:0 + flex:0 0 auto，靠 root 的 flex-start 左排。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}][${BYLINE_ATTR}] picture,
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}][${BYLINE_ATTR}] img,
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}][${BYLINE_ATTR}] video {
  margin: 0 !important;
  flex: 0 0 auto !important;
}`;
      const segColorBorderMisc = () => `
/* v0.7.102：p / ul / ol / blockquote 段落間距已搬到 userOverrides 條件注入
   （v0.7.162 起 paragraphSpacing 可調）。預設 paragraphSpacing=1.0 + Auto 兩種
   切分後不再永遠注入，Auto 模式下完全保留原站 typography。注入點見 buildCss
   末段 paragraphSpacing >= 0 條件分支。 */
/* 注意：aspect-ratio / padding-bottom 的 placeholder hack 破解改由
   cleaner.resetMediaPlaceholderPadding 在 runtime 處理——因為 CSS :has() 無法
   區分「padding-bottom hack（Substack/Medium 類）」與「純 aspect-ratio
   容器（Engadget 類 aspect-ratio: 16/9 + img absolute inset:0）」：前者
   padding 留著會造成空白、需 reset；後者 aspect-ratio 是容器撐高的唯一來源、
   被 reset 就會把圖壓成 0 高度。runtime 檢查 computed padding-bottom 比例才
   分得出來，CSS level 做不到。 */
/* Bootstrap col-* 系列 column wrapper reset：原站用 col-md-9 / col-lg-6
   等 class 把內容鎖在固定寬度欄位（".col-md-9 { width: 75%; }" 或類似 CSS
   class rule）。Reader mode 下 single-column 視覺、這些 column constraint
   該拔掉讓主文撐滿 card 寬度。
   esmchina.com /news/14116.html 實測：主文 p 所在 col-md-9.article-left
   width 被鎖 288px、card 寬 720px 下主文只占 40%。
   通則依據：Bootstrap grid class 是跨 CMS 標準（WordPress / Django / Rails
   普遍用）、非站點特判。attribute selector [class*="col-X-"] 精準命中
   col-xs-* / col-sm-* / col-md-* / col-lg-* / col-xl-*，不誤殺 .color-X /
   .collapse 等無 "-" 分隔的類命名。 */
[${ARTICLE_ATTR}="1"] [class*="col-xs-"],
[${ARTICLE_ATTR}="1"] [class*="col-sm-"],
[${ARTICLE_ATTR}="1"] [class*="col-md-"],
[${ARTICLE_ATTR}="1"] [class*="col-lg-"],
[${ARTICLE_ATTR}="1"] [class*="col-xl-"] {
  width: auto !important;
  max-width: none !important;
  float: none !important;
  /* v0.7.122：flex: initial (= 0 1 auto) 改 1 1 auto——flex-grow: 1 讓
     col-* wrapper 在 flex container 內主動撐滿父剩餘空間。原 initial 走
     flex-basis: auto + grow:0、依 content max-content 寬度自然 size。 */
  flex: 1 1 auto !important;
  /* v0.7.123：清 margin-left/right——cn.nytimes 實測對 .col-lg-5 設
     'margin-left: 61px'（Bootstrap col offset），即使 flex-grow:1 撐滿父寬，
     margin 也會把 wrapper 內容向內推 61px、article-body-item.rect 為
     'x=380 w=667 right=1047' vs partial 'x=319 w=728 right=1047'——
     content 起點被 margin-left 推 61px、視覺上主文段落仍只佔 reader card
     content area 的部分寬度。Bootstrap col offset 在 reader card 單欄
     layout 失意義（沒 row 結構讓 offset 對齊），清掉。 */
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding: 0 !important;
}
/* padding: 0 解釋：原站 Bootstrap col 標準 gutter（padding-left/right: 15px）
   或客製化的 padding（businessweekly.com.tw .col-md-7 padding-right: 115px
   給右欄 sidebar 留白）在 reader mode 下會把 col 內容擠在 col 寬度的子集
   內，造成「主圖偏左、寬度不滿」破版。我們已 width: auto + float: none +
   flex: initial 把 col 退化成 block 流排、padding 已失 grid gutter 意義，可
   清。businessweekly blog 主圖（497px wide 卡在 col 內 padding-right 115px
   後）修法：清 padding 後圖回到 card 完整內寬 608px。 */
/* v0.7.201：內容 block 元素水平 padding reset。原站用 padding-left/right
   做多欄 layout 內縮（The Register 對 p 設 padding-left: 220px + padding-right:
   320px）。reader card 是 single-column、已有 56px 側邊 padding，原站
   的水平 padding 只會把文字擠窄（The Register 每行僅 6.7 字元）。
   只清 left/right，保留 top/bottom（站點可能用它做段落間距）。
   html 前綴提升 specificity。
   v1.7.8：inline-flow p 豁免（:not INLINE_FLOW_P_ATTR）——多欄內縮只可能發生
   在 block-level p（水平 padding 內縮的前提是元素撐滿容器寬）；inline /
   inline-block 流動的 p 其水平 padding 是「相鄰元素分隔」用途（NYT byline
   兩個相鄰 inline-block <p> 之間無空白 text node、分隔全靠 padding-right:
   12px，被本規則清掉 → 「By Ben SisarioVisuals by Ryan Lowry」黏字）。
   標記見 markInlineFlowParagraphs。 */
html [${ARTICLE_ATTR}="1"] p:not([${INLINE_FLOW_P_ATTR}="1"]) {
  padding-left: 0 !important;
  padding-right: 0 !important;
}
/* 2026-10-07 review B-14：這裡原有 v0.7.179 的 WordPress constrained layout
   對策「html [ARTICLE] p, h1-h6, ul, ol, dl { max-width: none !important }」
   (0,1,2)——但同版給 universal 規則加了 html 前綴成「html [ARTICLE] *:not([PLAYER])
   { max-width: 100% !important }」(0,2,1)，同為 !important 時 specificity 高者勝、
   不看 source order，這條自此永遠被蓋過（computed 恆為 100%；Chromium 合成 WP
   constrained 頁 probe 實證刪前刪後 p 的 max-width 都是 100%）。WP constrained 的
   實際解法就是那條 universal 規則（見其註解），死規則移除。 */
/* articleEl 內 block 裝飾 background 清除：原站常用彩色 wrapper
   block（accent bar、inset box、newsletter box、feature card）作為
   視覺裝飾。reader mode 下 card 本身已有統一底色，內部不該再有彩色
   block 打斷閱讀流。
   theverge.com 實測：duet--layout--entry-body-container 白底、
   _1wu3rm1 白色 inset、qnnwq1 綠色 accent、tly2fw0 紫色 block 等
   styled-components 裝飾 wrapper 全部清掉。
   preserve 清單：figure/figcaption/summary/blockquote 是 W3C 保留
   語意（主文媒體容器、引述）；code/pre/table/th/td 需要背景區隔
   （程式碼 block / 表格 row 交替色）；mark 是語意 highlight；kbd
   鍵盤按鍵視覺慣例白底。這些 tag 的原站背景保留。 */
[${ARTICLE_ATTR}="1"] *${BG_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"]) {
  background-color: transparent !important;
  background-image: none !important;
}
/* v0.7.179：後代 text color reset——搭配上面的 background strip。原站 CMS
   banner / hero header 常用「白字 + 彩色背景」設計（CNN opinion-header、
   BBC live-page-header 等），styler strip 背景後白字對白底不可見。
   color: inherit !important 讓所有後代繼承 reader card 顯式設的 text color
   （見 html [data-jread-active] 的 color 規則）。
   exclude：a（保留連結色）、code/pre（保留 syntax highlight）、mark/kbd
   （語意 inline 元素）、table 系（保留 cell 色彩）、figcaption（背景保留
   所以文字色也保留——見下方 v0.7.195 註釋）。
   dark/sepia theme 另有「[ARTICLE] *:where(:not([SITE_UI])) { color: theme.text }」
   (0,1,0)——specificity 低於本規則 (0,2,n)，cascade 上是**本規則勝出**、不是
   被蓋過；結果仍等價：inherit 鏈往上解到 articleEl 自身（主題規則對根元素
   設 theme.text），exclude 鏈上的元素則直接吃主題規則。2026-10-07 review B-14
   更正——B-02 同型「以為 * 規則會蓋過」的誤判曾讓 iframe 白底規則成死規則，
   設計新規則時別以「主題規則會蓋過這裡」為前提。
   v0.7.195：加 :not(figcaption)。background strip 規則已排除 figcaption
   （保留原站背景），但 color inherit 沒排除——導致 figcaption 原站深色
   背景 + reader card 深色繼承文字 = 對比度極低不可讀。TWZ (thewarzone.com)
   圖說白字 + 深灰底實測觸發。figcaption 背景與文字色必須成對保留，不能
   只保留一邊。dark/sepia theme 下 figcaption 走主題規則拿 theme.text（本規則
   exclude 它、不參與）。 */
[${ARTICLE_ATTR}="1"] *${COLOR_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"]) {
  color: inherit !important;
}
/* v0.8.137：drop cap（::first-letter）顏色跟隨主文文字色。原站常對首段
   ::first-letter 設顯式 color + -webkit-text-fill-color（The Verge 暗色站對
   首段設白字 96px float drop cap）。reader mode 把段落文字色覆寫成 theme.text，
   但 ::first-letter 是獨立 pseudo-element、不繼承我們對段落的 color override，
   站點顯式白字殘留 → 淺底白字 drop cap 隱形（float 仍占位 → 首字位置空一格、
   看似「段落首字不見了」，Jimmy 2026-06-20 The Verge 截圖回報）。
   通則（結構訊號、非 class / hostname 特判，符合硬規則 3）：任何主文
   ::first-letter 一律 color: inherit（跟隨已被 reader 覆寫的段落色）+
   -webkit-text-fill-color: currentColor（蓋過站點 text-fill）。exclude 鏈與上方
   color inherit 規則一致（a / code / figcaption 等不動）。dark/sepia theme 的
   全域 color 覆寫選不到 ::first-letter（pseudo-element 不被 * 選到），本規則補上。
   v2.4.9：只套在 [FIRST_LETTER_ATTR]（站方首字色與段落不同、JS 量測標記）。原本
   對主文每個元素都掛 ::first-letter，WebKit 會替每段首字建獨立 first-letter
   renderer；Safari 27.2 在翻頁 multicol 容器內對這種首字的 hit test 整字都回
   offset 1（caretRangeFromPoint 實測：字左半也回 1、第二字分界正常）→ 段首拖選
   永遠選不到第一個字（Jimmy 2026-11-12 Readwise Reader 回報；刪掉本規則即恢復）。 */
[${ARTICLE_ATTR}="1"] [${FIRST_LETTER_ATTR}="1"]${COLOR_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"])::first-letter {
  color: inherit !important;
  -webkit-text-fill-color: currentColor !important;
}
/* v0.7.197：顯式 link color（所有 theme）。v0.7.179 加 color: inherit 時排除
   <a>（保留原站 link 色），但原站 link 色常配合已被 strip 的深色背景設計——
   TWZ (thewarzone.com) 作者連結原色 rgb(248,248,248)（近白），strip 背景後
   白字對白底不可讀，只剩 byline separator 逗號（dark inherit）突兀可見。
   dark/sepia 早有顯式 link 色 + underline（v0.7.100）；light theme 沒有是
   設計疏漏。現在三個 theme 統一顯式 link 色 + underline 雙通道差異化。
   light #1a73e8：Material Design blue，on #ffffff 對比 5.2:1（AA），與
   body text #1a1a1a 明確可辨。:not([player]) 排除嵌入 player 內連結。 */
[${ARTICLE_ATTR}="1"] a:not([${PLAYER_ATTR}="1"]) {
  color: ${theme.link} !important;
  text-decoration: underline !important;
  text-underline-offset: 2px !important;
  text-decoration-thickness: 1px !important;
}
[${ARTICLE_ATTR}="1"] a:not([${PLAYER_ATTR}="1"]) * {
  color: ${theme.link} !important;
}
/* v0.8.129：clickable 標題維持原本標題樣式。標題本身常是連結（permalink 形
   <h1><a href>標題</a></h1>）或被連結整顆包住（<a href><h1>標題</h1></a>）；
   上方 body-link 規則會把整個大標題染成 theme.link 藍字 + 底線，看起來像一條
   連結而非標題。通則：heading（h1-h6）內含或包住的 <a> 一律回退成繼承色
   （inherit → reader text color，跟非連結標題同色）+ 無底線，維持原站標題視覺。
   純結構訊號（heading tag），不綁站點 / class。
   v1.6.30（#13 效能）：「包住 heading 的 <a>」原用 a:has(:is(h1..h6)) 選——
   其「 *」後代變體是放大器（見檔頭 v1.6.30 不變式註解），改由 apply() 的
   markHeadingLinks 標 HEADING_LINK_ATTR（晚 mount 由 remarkDynamicMarkers
   補標）。specificity：heading 內 a (0,2,2)、marker a (0,3,1)，均 >
   body-link 規則 (0,2,1) 且 source order 在後，穩定覆蓋。 */
[${ARTICLE_ATTR}="1"] :is(h1,h2,h3,h4,h5,h6) a:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] a[${HEADING_LINK_ATTR}="1"]:not([${PLAYER_ATTR}="1"]) {
  color: inherit !important;
  text-decoration: none !important;
}
[${ARTICLE_ATTR}="1"] :is(h1,h2,h3,h4,h5,h6) a:not([${PLAYER_ATTR}="1"]) *,
[${ARTICLE_ATTR}="1"] a[${HEADING_LINK_ATTR}="1"]:not([${PLAYER_ATTR}="1"]) * {
  color: inherit !important;
}
/* articleEl 內裝飾性 border 清除：原站常用 border / border-left 作為品牌 accent
   bar、callout 框、圖片框等視覺裝飾。reader card 本身已有圓角 + 陰影邊界，
   內部任何裝飾 border 都會打斷閱讀流，且會占空間（border-width 計入 box
   寬度）造成主文/媒體偏移。
   businessweekly.com.tw 實測：主圖外 wrapper div.Single-image.Border-left
   套 border-left: 45px solid rgb(188, 40, 28)（商周品牌紅 accent）→ 紅色
   色塊出現在主圖左方 + 圖片被往右擠 45px 看似破版。border-width:0 後 border
   視覺消失、wrapper 回到正常寬度、圖片置中。
   preserve 清單跟 background 清除一致 + hr：blockquote 的 border-left 是
   引述慣例；table/th/td 的 border 是資料分隔；code/pre 是程式碼框；
   figure/figcaption/summary 是 W3C 媒體語意；mark/kbd 是 inline 語意；
   hr 本身就是 border 化身（清掉等於消失）。
   只清 border-width 不動 border-style/color：影響範圍最窄、若原站日後改
   設計也容易 debug。 */
[${ARTICLE_ATTR}="1"] *${BORDER_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"]) {
  border-width: 0 !important;
}
/* left/right: auto 解釋（v0.7.48）：原站常用 position: relative + left/right 偏移做
   「圖片向左/右溢出版心做視覺擴張」hack（businessweekly.com.tw .Single-image
   套 position:relative; left: -90px; right: 90px）。reader mode 下單欄 card layout
   沒這需求、offset 反而把圖推出 card padding 範圍變成「圖片偏左 + 右側溢出」破版。
   清 inset 後 relative element 回到正常 layout 位置。top/bottom 不清（sticky 合法）。
   v1.7.45：拆出獨立規則 + :not([ABS_ANCHOR])——v0.7.48 的「清了等於 static 視覺」
   前提只對 relative 成立；absolute / fixed 元素 left/right 是錨點，清掉會跳回
   static position（WaPo 日期輪播 absolute left:0 span 被打飛出 overflow 裁切窗、
   日期消失實證）。markAbsAnchors 在 apply() 期標記 computed absolute/fixed 元素
   豁免；已被其他 reader 規則打回 static 的媒體類子樹量到 static、不標、照舊清。 */
[${ARTICLE_ATTR}="1"] *${BORDER_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"]):not([${ABS_ANCHOR_ATTR}="1"]) {
  left: auto !important;
  right: auto !important;
}
/* v1.9.12 無裝飾引言補左邊線（見 BQ_PLAIN_ATTR 常數註解）。attr 重複兩次是刻意
   提高 specificity 到 (0,3,1)：站點常見 blockquote.xxx / .post blockquote
   (0,1,1)~(0,2,1) 的 padding / border reset 不可贏。border 三個 longhand 分開寫、
   只動 left——其餘三邊維持站方值（本來就量過是不可見的）。 */
[${ARTICLE_ATTR}="1"] blockquote[${BQ_PLAIN_ATTR}="1"][${BQ_PLAIN_ATTR}="1"] {
  border-inline-start-width: 3px !important;
  border-inline-start-style: solid !important;
  border-inline-start-color: ${theme.link} !important;
  padding-inline-start: 1em !important;
}
/* v2.5.53：邊線與內縮改用邏輯屬性（inline-start）——右到左頁（aljazeera、fa / he 維基原文）
   落在右側；左到右頁計算結果與原本的 left 相同。plain 引言的站方大內距歸零見
   BQ_PAD_TRIM_ATTR 常數註解 */
[${ARTICLE_ATTR}="1"] blockquote[${BQ_PAD_TRIM_ATTR}*="t"][${BQ_PAD_TRIM_ATTR}*="t"] {
  padding-top: 0 !important;
}
[${ARTICLE_ATTR}="1"] blockquote[${BQ_PAD_TRIM_ATTR}*="b"][${BQ_PAD_TRIM_ATTR}*="b"] {
  padding-bottom: 0 !important;
}
/* v1.9.12 CJK 為主引言取消 faux 斜體（見 BQ_UPRIGHT_ATTR 常數註解）。子孫一併
   normal——站方斜體常掛在 blockquote p 而非 blockquote 自身；語意強調元素
   （em / i / cite / dfn / var）豁免，保留作者的強調標記。 */
[${ARTICLE_ATTR}="1"] blockquote[${BQ_UPRIGHT_ATTR}="1"][${BQ_UPRIGHT_ATTR}="1"],
[${ARTICLE_ATTR}="1"] blockquote[${BQ_UPRIGHT_ATTR}="1"][${BQ_UPRIGHT_ATTR}="1"] *:not(em):not(i):not(cite):not(dfn):not(var) {
  font-style: normal !important;
}
/* v0.7.190 inline code 底色統一：原站 inline <code>（不含 <pre> 內的）
   底色差異極大——MDN 用深灰近黑 rgb(45,48,52)、多數站用淺灰。reader
   card 白底上深灰 code badge 太突兀（D5）。統一覆寫為 theme 協調的
   半透明底色，保持 code 與主文的視覺區分但不喧賓奪主。
   不動 <pre> 內 code（程式碼 block 有自己的背景 + syntax color 體系）。*/
[${ARTICLE_ATTR}="1"] code:not(pre code) {
  background: ${theme.inlineCodeBg} !important;
  color: inherit !important;
}
/* v2.5.17：標題（h1–h6）與連結裡的行內 code 不上底色，五個主題一致（Jimmy
   2026-11-17 裁定）。gray / sepia / dark / night 本來就是透明（背景中和規則＋
   v2.5.15 補底色那條排除了標題與連結）；light 沒有中和規則、上面那條會把這兩類
   也塗上 inlineCodeBg——這裡補一條把它們歸透明。寫在 base、不分主題：其他四個
   主題下是 no-op。排除清單與 v2.5.15 那條共用 INLINE_CODE_NO_BG_CARRIERS。
   只寫 background-color，內距 / 圓角不碰；<pre> 內的 code 不動。 */
[${ARTICLE_ATTR}="1"] :is(${INLINE_CODE_NO_BG_CARRIERS}) code:not(pre code) {
  background-color: transparent !important;
}
/* 子元素寬度 cap：原站常用 width: 1152px / 1080px 等寫死寬度給 article
   detail layout wrapper（cna.com.tw 的 .centralContent 寫死 width: 1152px、
   原本給 article main + sidebar 的固定寬 layout）。reader mode 下 article
   已被 cap 到 contentWidth（720px）max-width，但子元素若寫死 width > 720px
   仍會 overflow 出 card 邊界造成「圖片/wrapper 偏右破版」（cna 索馬利蘭
   主圖 right=1488 超出 article right=1000 達 488px）。max-width: 100%
   強制所有後代不超過 parent 寬度，等於 cap 在 article content area 內。
   對 figure/blockquote/table/code 等保留語意也是合理 cap（不應超出版心）。
   不用 width: 100%（會把 inline-block / icon 等小元件強拉成滿寬）；只
   max-width 限縮上限，width:auto / 顯式 width 仍照原值算。
   v0.7.179：加 html 前綴把 specificity 從 (0,1,0) 升到 (0,1,1)——WordPress
   block theme 常用 .entry-content > p 寫死 max-width 560px !important
   （specificity 0,1,1 + !important），舊 (0,1,0) + !important 被打敗導致
   reader card 內文過窄。html 前綴不影響 match 語意（html 永遠 match）。
   2026-10-07 review B-14：這條 (0,2,1) 就是 WP constrained layout 的實際解法——
   同版另寫的「html [ARTICLE] p…dl { max-width: none }」(0,1,2) 永遠輸給它、
   已移除；別再為 content block tag 另開 max-width 規則。 */
html [${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]) {
  max-width: 100% !important;
  /* v0.7.157：font-smoothing 繼承——站點若在子層級重設 -webkit-font-smoothing
     為 auto，會把 reader card 內部分元素拉回 subpixel-antialiased（macOS）導致
     字粗。強制 inherit 鎖定子層走 reader card 套的 antialiased（grayscale）。
     合併進此 universal rule（不另開）—— spec 既有 regex 預期第一條 universal
     selector body 內含 max-width: 100%。 */
  -webkit-font-smoothing: inherit !important;
  -moz-osx-font-smoothing: inherit !important;
}
/* 強制 block flow + 媒體置中。
   float: none——對所有 reader card 後代——原站常用 float 把媒體放 sidebar
   或做文繞圖（cna.com.tw figure.floatImg.center 等），reader mode 單欄
   card 沒 sidebar、float 會把媒體推出版心。
   margin-left/right: auto——**只**對媒體元素（img / picture / video / figure
   / iframe / table / blockquote / pre）水平置中。v0.7.105 修法：原本對所有
   '*' 套 margin auto 太廣泛——BBC byline 的 author wrapper (width 458px
   span 在 608px 父) 被 auto-center 偏右、跟 date 的左對齊不一致。改成
   只對「該被置中的媒體 / 區塊內容」套，generic div/span/text wrapper 自然
   左對齊不被 auto-center。垂直 margin 仍交給原站 / styler 既有 first-child
   reset。 */
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]) {
  float: none !important;
}
[${ARTICLE_ATTR}="1"] img:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] picture:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] video:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] figure:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] iframe:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] table,
[${ARTICLE_ATTR}="1"] blockquote,
[${ARTICLE_ATTR}="1"] pre {
  margin-left: auto !important;
  margin-right: auto !important;
}
/* v2.5.22：「標籤＋值」兩格列的標籤格不逐字斷行。表格自動排版把欄寬壓到各格的最小
   內容寬，中日韓文字每個字之間都能斷 → 標籤欄被值欄擠成一個字寬、「母語姓名」直排
   成四行（el / he 維基資訊框譯成中文後；語料庫比對發現）。keep-all 讓中日韓文字只在
   空白與標點處換行，標籤維持一行；拉丁文字本來就不會從單字中間斷，不受影響。只收
   兩格列的第一格是 <th> 的形狀（資訊框、規格表）——多欄表的表頭不在此列，免得把
   寬表撐得更寬。 */
[${ARTICLE_ATTR}="1"] tr > th:first-child:nth-last-child(2) {
  word-break: keep-all !important;
}
/* v2.5.14：直向 flex 容器的直接子 <pre> 不置中（標記見 markFlexColumnPres）。block
   版面裡寬度 auto 的 <pre>，左右 auto margin 解成 0、照樣撐滿；但 flex item 的 auto
   margin 會吃掉全部剩餘空間並關掉 stretch → 整個程式碼框縮成內容寬、置中成一顆窄
   膠囊（docs.gitbook.com 的程式碼區塊外殼是 flex-col）。attr 重複兩次只為排在上面
   那條之後也穩贏。 */
[${ARTICLE_ATTR}="1"] pre[${PRE_FLEX_STRETCH_ATTR}="1"][${PRE_FLEX_STRETCH_ATTR}="1"] {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
/* v2.5.24：站方 float 的文字方塊撐滿版心（標記見 markDefloatedTextBoxes）。float 已被
   上面的 * { float: none } 清掉，但站方配 float 釘的寬度（quantamagazine
   .post__aside--right { width: 335px; max-width: 335px }）還在 → 方塊靠左、只有
   半欄寬，右邊空一大塊。單欄卡片裡沒有東西可以繞排，寬度改回 auto。 */
[${ARTICLE_ATTR}="1"] [${DEFLOAT_TEXT_ATTR}="1"] {
  width: auto !important;
  max-width: 100% !important;
  min-width: 0 !important;
}
/* v3.7.7：外側項目符號的清單補縮排（標記見 markListMarkerIndent）。requests 430 寬：站方窄版
   把 ul 的 margin-left 從 30px 歸 0、padding 也是 0，圓點掛到文字欄左邊外面。邏輯屬性，
   右到左頁落在右側 */
[${ARTICLE_ATTR}="1"] [${LIST_INDENT_ATTR}="1"] {
  padding-inline-start: 1.5em !important;
}
/* v3.7.7：站方 pseudo 寫的操作提示字拿掉（標記見 markUiHintPseudo）。閱讀模式沒有那個互動
  （thewoksoflife 份量調整鈕旁「tap or hover # to scale」） */
[${ARTICLE_ATTR}="1"] [${UI_HINT_PSEUDO_ATTR}="before"]::before,
[${ARTICLE_ATTR}="1"] [${UI_HINT_PSEUDO_ATTR}="both"]::before,
[${ARTICLE_ATTR}="1"] [${UI_HINT_PSEUDO_ATTR}="after"]::after,
[${ARTICLE_ATTR}="1"] [${UI_HINT_PSEUDO_ATTR}="both"]::after {
  content: none !important;
}
/* v3.7.6：通用 float: none 的兩種副作用（標記見 markSiteFloatSideEffects）。
   (1) 站方 float 的短字標記：plos 參考文獻編號 span.order { float: left; width: 1.875rem;
       margin-left: -2.25rem }、Sphinx 腳註 aside.footnote > span { float: left }。清掉
       float 後編號變成行內字、黏著後面的文字（「1.Jess T」）或獨佔一行——保留站方 float。
   (2) 本來靠 float 變成區塊的行內元素：Docusaurus code.codeBlockLines { float: left;
       min-width: 100%; padding: 16px }。float 會把 inline 元素變成區塊（CSS 規定），清掉後
       退回 inline，內距只在首尾行生效——字貼著灰底左緣。改成 display: block。
   attr 重複兩次：要排在上面 * { float: none }（0,2,0）之後也穩贏。 */
[${ARTICLE_ATTR}="1"] [${KEEP_FLOAT_ATTR}="left"][${KEEP_FLOAT_ATTR}="left"] {
  float: left !important;
}
[${ARTICLE_ATTR}="1"] [${KEEP_FLOAT_ATTR}="right"][${KEEP_FLOAT_ATTR}="right"] {
  float: right !important;
}
[${ARTICLE_ATTR}="1"] [${FLOAT_BLOCK_ATTR}="1"][${FLOAT_BLOCK_ATTR}="1"] {
  display: block !important;
}
/* v2.5.23：程式碼區塊的外殼撐滿版心（標記見 markFlexRowCodeShells）。react.dev 的
   範例外殼 div.sandpack 是橫向 flex、裡面只有一個子層；站方靠自己的寬度規則撐滿，
   閱讀模式把寬度歸成 auto 後，flex item 縮成內容寬——同一頁的程式碼框 282 / 421 /
   479 / 552 / 608px 各不相同（語料庫 probe 實測）。唯一的子層沒有別人要分空間，
   讓它長滿。 */
html [${ARTICLE_ATTR}="1"] [${CODE_FLEX_FILL_ATTR}="1"] {
  flex-grow: 1 !important;
  min-width: 0 !important;
}
/* v2.5.23：圖說貼近它說明的那張圖（Jimmy 2026-11-19 回報「圖片註解和圖片的距離太開」）。
   距離的來源是兩邊各加一份：上面 MEDIA_CAP_SEL / content-img 給每張圖 24px 下邊距、
   figure / picture 規則給 picture 1.5em 下邊距（那是「圖與下一段內文」的間距），圖說
   自己又帶站方的 margin-top / padding-top。語料庫普查 39 頁有圖說的頁面，圖底到圖說
   第一行字的距離中位數 26px、最大 87px（pmc：24 + 17 + 30）；圖說下方到內文反而只有
   figure 的 1.5em——圖說看起來不屬於任何一邊。
   做法：圖說上方那張圖（與它外面的包裝）下邊距歸零，圖說統一留 8px；圖與下一段的
   間距仍由 figure 的 1.5em 負責。只動 markCaptionMedia 標到的元素——沒有圖說的圖、
   圖說排在圖上方的 figure、一個 figure 多張圖時非最後一張的圖都不受影響。
   圖說自帶底色或框線時（值 "pad"）padding 是框內留白不歸零，並改成貼著圖不留縫。
   attr 重複三次（specificity 0,4,1）：要贏過 MEDIA_CAP_SEL 的 margin-bottom: 24px
   !important——那條帶三個 :not()，算下來是 (0,3,3)；重複兩次只有 (0,3,1) 會輸
   （bbc / pmc / twz 實測圖的 24px 還在）。 */
html [${ARTICLE_ATTR}="1"] [${CAP_MEDIA_ATTR}="1"][${CAP_MEDIA_ATTR}="1"][${CAP_MEDIA_ATTR}="1"] {
  margin-bottom: 0 !important;
}
html [${ARTICLE_ATTR}="1"] figcaption[${CAP_BELOW_ATTR}][${CAP_BELOW_ATTR}] {
  margin-top: 8px !important;
}
html [${ARTICLE_ATTR}="1"] figcaption[${CAP_BELOW_ATTR}="1"][${CAP_BELOW_ATTR}="1"] {
  padding-top: 0 !important;
}
/* 圖說自己是一個框（底色或任一邊框線）→ 貼著圖、不留縫：維基縮圖的圖說左右下三邊
   有框線、與圖的外框接成一體，留 8px 會讓框線斷開（zh.wikipedia 翻頁截圖實證） */
html [${ARTICLE_ATTR}="1"] figcaption[${CAP_BELOW_ATTR}^="pad"][${CAP_BELOW_ATTR}^="pad"] {
  margin-top: 0 !important;
}
/* 框貼著圖、但框自己沒有上內距（維基：padding 0 6px 6px）→ 字會直接碰到圖，補 6px */
html [${ARTICLE_ATTR}="1"] figcaption[${CAP_BELOW_ATTR}="padfix"][${CAP_BELOW_ATTR}="padfix"] {
  padding-top: 6px !important;
}
html [${ARTICLE_ATTR}="1"] figcaption[${CAP_BELOW_ATTR}][${CAP_BELOW_ATTR}] > :first-child {
  margin-top: 0 !important;
}
/* v2.5.36：div 圖說（CAP_DIV_ATTR，見 findDivCaption）同一組間距。另寫一份、不併進上面的
   figcaption 選擇器——figcaption 規則字串與權重維持原樣 */
html [${ARTICLE_ATTR}="1"] [${CAP_DIV_ATTR}][${CAP_BELOW_ATTR}][${CAP_BELOW_ATTR}] {
  margin-top: 8px !important;
}
html [${ARTICLE_ATTR}="1"] [${CAP_DIV_ATTR}][${CAP_BELOW_ATTR}="1"][${CAP_BELOW_ATTR}="1"] {
  padding-top: 0 !important;
}
html [${ARTICLE_ATTR}="1"] [${CAP_DIV_ATTR}][${CAP_BELOW_ATTR}^="pad"][${CAP_BELOW_ATTR}^="pad"] {
  margin-top: 0 !important;
}
html [${ARTICLE_ATTR}="1"] [${CAP_DIV_ATTR}][${CAP_BELOW_ATTR}="padfix"][${CAP_BELOW_ATTR}="padfix"] {
  padding-top: 6px !important;
}
html [${ARTICLE_ATTR}="1"] [${CAP_DIV_ATTR}][${CAP_BELOW_ATTR}][${CAP_BELOW_ATTR}] > :first-child {
  margin-top: 0 !important;
}
/* v2.5.16：shadow DOM 元件的配色跟著卡片走（標記見 markShadowHosts）。我們的樣式表
   進不了 shadow root：元件裡的底色留著站方依「系統深淺色」挑的那一組，但文字色是
   繼承來的、會吃到卡片的主題文字色——系統深色＋淺色主題時變成深底深字（MDN 的
   <mdn-code-example>：程式碼區塊 rgb(45,48,52) 底、字被改成 #000，對比 1.58；Copy /
   Run 按鈕白字落在淺色卡片上。Jimmy 2026-11-17 回報），系統淺色＋深色主題則反過來。
   color-scheme 會繼承進 shadow root：把 host 的 color-scheme 定成卡片的深淺，元件裡
   用 light-dark() / 系統色寫的底色、字色、語法色整組換成與卡片同一側（實測 1.58 →
   18.09、反向 1.28 → 8.95）。只影響跟著 color-scheme 走的元件；用 media query 或
   JS 自己判斷深淺的元件不受影響（也修不到）。 */
[${ARTICLE_ATTR}="1"] [${SHADOW_HOST_ATTR}="1"] {
  color-scheme: ${(() => { const c = parseCssColor(theme.articleBg); return (c && relLuminance(c) < 0.5) ? 'dark' : 'light'; })()} !important;
}
/* v2.5.32：元件內的字色不跟 color-scheme、而是站方 JS 依系統深淺挑的（MDN「Try it」的
   CodeMirror 語法色：系統淺色時是 #00f / #708 這組），套上一條之後反而落在相反那一側的
   底色上（編輯區底色透明＝卡片色）。passShadowHostSchemeFit 量到元件內多數文字看不清時
   改標 "flip"：整個元件翻到另一側，給該側的底色與文字色（淺側白底深字、深側深灰底
   淺字；寫死色值而不用 Canvas / CanvasText，量測與 jsdom 都讀得到），讓元件自成一塊
   與它的字色同一側的面板。selector 疊屬性墊高權重：要贏過卡片內通用的底色清除與
   文字色繼承規則（實測只寫一層時底色被清成透明、翻了等於沒翻） */
html [${ARTICLE_ATTR}="1"] [${SHADOW_HOST_ATTR}="flip"][${SHADOW_HOST_ATTR}="flip"][${SHADOW_HOST_ATTR}="flip"][${SHADOW_HOST_ATTR}="flip"] {
${(() => { const c = parseCssColor(theme.articleBg); return (c && relLuminance(c) < 0.5)
    ? '  color-scheme: light !important;\n  background-color: #ffffff !important;\n  color: #1a1a1a !important;'
    : '  color-scheme: dark !important;\n  background-color: #1e1f22 !important;\n  color: #e6e6e6 !important;'; })()}
}
/* v2.2.11 引言整塊內縮（Jimmy 2026-10-28）：邊線連同文字往右縮 1em、跟內文左緣
   明顯錯開；文字離線的距離交給站方 padding / BQ_PLAIN 的 1em。同 specificity、
   排在上面置中規則之後所以 margin-left 由這裡決定（blockquote 撐滿版心時 auto
   本來就解成 0，置中對它沒有作用）。max-width 扣掉內縮量，否則站方寫死
   width:100% 的引言會被推出版心 1em——selector 加 html 前綴與 :not(PLAYER) 到
   (0,2,2)，才贏得過通則 cap「html [ARTICLE] *:not(PLAYER) { max-width:100% }」(0,2,1)。 */
html [${ARTICLE_ATTR}="1"] blockquote:not([${PLAYER_ATTR}="1"]) {
  margin-inline-start: 1em !important; /* v2.5.53：邏輯屬性，右到左頁縮在右側 */
  max-width: calc(100% - 1em) !important;
}
/* v0.8.86：responsive embed 的 abs-pos iframe pin 回填滿 wrapper。
   原站慣例（thenewslens figure.video-responsive / WP wp-embed / Substack /
   Medium 等）用「wrapper position:relative + padding-bottom 16:9 hack +
   iframe position:absolute; left:0; width:100% 填滿」嵌入 YouTube/TED/Vimeo。
   上方置中規則對 iframe 套 margin-left/right:auto——但對 abs-pos 元素 margin
   auto 會依 CSS 定位方程式解出非零 left/right，把 iframe 推到 wrapper 寬一半
   的偏右位置破版（thenewslens.com/article/975 兩支影片 left=304px 實證）。
   apply() JS 量 computed position:absolute 標 [FILL_IFRAME_ATTR]（keyed on
   結構特徵非站點 class，placeholder reset 後變 static 的 iframe 不被標）、
   這條 pin 回 inset:0 + width/height:100% 填滿 wrapper，wrapper 自身仍走
   figure 置中規則對齊版心。
   selector 重複 [FILL_IFRAME_ATTR] 兩次是 v0.8.86 當時為了壓過 inset 清除通則
   （* 配 :not(tag) 保留鏈，當年 (0,2,15)）而提到 (0,3,1)。
   2026-10-07 review B-14 更正：v1.7.45 該通則加了 :not([ABS_ANCHOR]) 後已是
   (0,3,15) > (0,3,1)，雙 attr 本身早就贏不了它——現在不衝突的真正機制是
   markAbsAnchors 與 passMarkFillIframes 同樣以「ARTICLE_ATTR 後 computed
   position:absolute」為訊號，被標 FILL 的 iframe 必同時被標 ABS_ANCHOR、被通則
   的 :not() 排除。兩個標記來源是同一份事實；若改 markAbsAnchors 的量測條件
   讓兩者脫鉤，inset 通則會重新打中 FILL iframe（forcing：
   review-1007-b6-b-styler-drift.spec）。雙 attr 保留（仍需壓過其他單 attr 規則）。 */
[${ARTICLE_ATTR}="1"] iframe[${FILL_IFRAME_ATTR}][${FILL_IFRAME_ATTR}] {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
}
/* inline emoji / icon：naturalWidth <= ${INLINE_IMG_MAX}（或 natural 不可靠時
   rendered rect <= ${INLINE_IMG_MAX}，見 apply() 內 v0.7.214 註解）的小圖片由
   apply() JS 標記 [${INLINE_IMG_ATTR}]，保留 inline flow 不被 block + margin
   auto 推成獨立置中區塊。Facebook / LINE 等社群站 emoji 用 <img> 渲染
   （16~32px），forced block 會讓每個 emoji 換行置中破壞原文排版。 */
[${ARTICLE_ATTR}="1"] img[${INLINE_IMG_ATTR}] {
  display: inline !important;
  max-height: none !important;
  object-fit: initial !important;
  margin-left: 0.15em !important;
  margin-right: 0.15em !important;
  /* v1.7.29：垂直 margin 一併歸零——inline 圖的 margin-bottom 不產生流間距，
     只把圖沿 baseline 往上抬（margin box 底緣對齊 baseline）。站點給 icon 的
     margin 多為其原始 flex/block 版面設計（macstories club h1 flex-column icon
     margin-bottom:.75rem 實證：icon 高於標題文字 12px），進 inline flow 後是
     純錯位來源 */
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  vertical-align: -0.1em !important;
}
`;
      // T12：BASE_SEGMENTS 順序即 stylesheet cascade 順序（同 specificity
      // 後出者勝）。join 輸出與拆分前單一 literal 逐字相等（forcing：
      // styler-apply-pass-order.spec.js 的 buildCss segment 區）。
      const BASE_SEGMENTS = [
        segPageScaffold,
        segAncestorReset,
        segCardTitle,
        segCardWidth,
        segMedia,
        segCarouselPseudo,
        segWrapperIconFigcaption,
        segHeadingAlign,
        segByline,
        segColorBorderMisc,
      ];
      base = BASE_SEGMENTS.map((f) => f()).join('');
      baseSkeletonCacheSet(theme, contentWidth, opts.readerHostPage, base);
    }

    // ---- 使用者 override：僅在非預設值才注入 ----
    // body text selector list（不含 heading h1-h6——保留原站標題大小分級；
    // v0.6.0 baseline 精神「預設值保留原站」在此仍成立：DEFAULT 分支完全
    // 不走到這裡）。descendant 展開必要性：BBC / NYT / Guardian 等站點給
    // `<p>`、`<li>`、`<blockquote>` 用 class rule 直接鎖死 font-size /
    // line-height / font-family（例：BBC `.HooNV { font-size: 18px;
    // line-height: 26px; font-family: "BBC Reith Serif" }`）——只對 article
    // 本身設 font-size 會被後代自己的 rule 截斷 inheritance、override 失效。
    // 列舉常見 body text 元素才能穿透站點 class rule 的 specificity。
    // v0.7.120：figcaption 從 BODY_TEXT_SEL 移除——caption 是輔助說明，
    // 原站設計普遍比 body 小（0.7-0.85em，BBC 實測 12px vs body 18px）+
    // 較淡色，是 typography hierarchy 的關鍵差異化。把 caption 拉到跟
    // body 同 fontSize 視覺上等同於把圖說「升格」為主文段落，破壞「圖→
    // 說明」的階層感。Jimmy 2026-05-13 BBC Culture /article/...oxfords-
    // medieval-library 截圖回報：fontSize 非預設時 caption 跟內文同字級。
    // 保留 caption 原站 typography 比「跟 body 等比例縮放」更尊重原站設計。
    // v0.7.152：含 span。WYSIWYG 編輯器（Lexical / TipTap / ProseMirror /
    // Slate / Draft.js 等跨平台 rich-text 編輯器）輸出文章內文時普遍把每段
    // 文字包成 `<p><span style="white-space: pre-wrap">文字</span></p>`，並且
    // 站點 stylesheet 對 span 自身寫死 font-family（vocus.cc 實測：對所有
    // 文章內 span 套 `font-family: "Noto Sans TC", "Microsoft JhengHei fixed",
    // ...`）。p 上的 font-family override 不會 inherit 到 span（span 自己
    // 有 rule，截斷 inheritance），導致使用者「字型」設定完全失效。Jimmy
    // 2026-05-20 vocus.cc /article/6a0d369c... 回報「字型設定無效」實機觸發。
    //
    // :not exclusions 避免破壞 icon font span：material-icons / font-awesome
    // 等用 font-family 載 icon glyph，強制覆寫成襯線/無襯線會讓 icon 消失或
    // 變成奇怪字元。badge / emoji 同樣可能依賴特殊字型。實測 vocus 主文 0 個
    // icon span，這些 exclusion 是跨站保守防護不會影響 vocus 修法生效。
    // v0.7.164：再加 `:not(pre *):not(code *)`——pre / code 後代的 span 必須
    // 保留 monospace（程式碼框慣例）。Medium WYSIWYG 把 <pre> 內每行包成
    // <span class="...">，舊 SPAN_TEXT_SEL 把這些 span 套上使用者字型 stack
    // （sans-serif），讓站點 author CSS 對 pre 寫的 monospace 被 span 覆蓋
    // 失效。Jimmy 2026-05-22 Medium @ddsakura-blog M5 Max 評測文回報「框內
    // 等寬字型被代換」。利用 Selectors 4 complex selector in :not()（Chrome
    // 88+ 支援，Manifest V3 最低 88，全相容），pre / code 後代的 span 不命中
    // SPAN_TEXT_SEL → inherit 父元素字型（站點 pre author CSS 的 monospace
    // stack）。寫成兩個 :not()（不寫 :not(pre *, code *) selector list 形式）
    // 是為了 selector 字串內不含 comma——spec 程式用 split(',') 切 selector
    // list 驗證時不會誤把 :not() 內的 comma 當分隔切壞。
    // v0.7.175：加 :not(h1 *) ~ :not(h6 *)——heading 內的 span 不應被 body
    // text font-size 覆寫。CNA 等站 h1 文字包在 <span>，SPAN_TEXT_SEL 會
    // 把 span 字級壓成 body fontSize、打敗 h1 自身的 font-size。排除 heading
    // 後代讓 span 正確 inherit heading font-size。
    // v0.8.13：加 :not(time ~ span)——meta/日期列裡跟 `<time>` 同排的 bare span
    // （roomie.tw 實測：`<time class="post-date">2023/5/24</time><span>更新</span>`）
    // 是日期列標籤，不是主文內容。`<time>` 本身不在 BODY_TEXT_SEL、保留站點
    // 的小字（.post-date 11px），但相鄰 span 被 SPAN_TEXT_SEL 拉成 body 18px，
    // 同一條 meta 列出現 11px 日期 + 18px「更新」的字級斷層（Jimmy 2026-06-09
    // 回報「更新尺寸突兀」）。time 與其相鄰 span 是同一份「日期/meta 列」事實，
    // 兩條 path 不可 drift：span 跟著 time 一起保留站點 meta typography（如同
    // figcaption / caption 保留比 body 小的階層）。`time ~ span` 是結構訊號
    // （span 為 time 的後續兄弟），非站點/class 特判。複合 selector in :not()
    // 同 :not(pre *) 走 Selectors 4（Chrome 88+ 相容）。
    // v1.7.41（S2）：加 :not(figcaption *)——caption / photo credit 包 <span> 時
    // 命中內文字級注入，span 文字被拉成 body 字級（17px+）、figcaption 本體仍是
    // 站點小字（11px），同一條圖說字級分裂。figcaption 刻意不在 BODY_TEXT_CORE
    //（v0.7.120 決策：圖說保留比 body 小的階層），其後代 span 必須跟著豁免——
    // 與 :not(h1 *)（heading 內 span 跟 heading 走）同一原則。specificity 影響：
    // :not() 取引數中最高者，`figcaption *` 為 (0,0,1)、與既有 :not(h1 *) 同級
    // 純累加，無既有規則依賴 SPAN_TEXT_SEL 的精確 specificity 值。
    const SPAN_TEXT_SEL = `[${ARTICLE_ATTR}="1"] span` +
      `:not([class*="icon"])` +
      `:not([class*="material-"])` +
      `:not([class^="fa-"])` +
      `:not([class*=" fa-"])` +
      `:not([class*="emoji"])` +
      `:not([class*="badge"])` +
      `:not(pre *)` +
      `:not(code *)` +
      `:not(figcaption *)` +
      `:not(time ~ span)` +
      // :where 包起來＝權重 0：只加排除、不改這條規則跟其他規則的勝負（直接寫
      // :not([attr] *) 會多 (0,1,0)，語料庫 404media 作者名、thewoksoflife「Updated:」字級跟著變）
      `:not(:where([${SMALL_TEXT_DIV_ATTR}] *))` +
      `:not(h1 *)` +
      `:not(h2 *)` +
      `:not(h3 *)` +
      `:not(h4 *)` +
      `:not(h5 *)` +
      `:not(h6 *)`;
    // v0.7.156：加入 td, th —— Wikipedia / 技術文件 / Stack Overflow 等用 table
    // 排版 content 的站點普遍對 `table.infobox` / `.wikitable` 等寫死 `font-size:
    // 0.88em` 縮小 table 內字。Jimmy 2026-05-21 Wikipedia /Longchamp_(company)
    // Chrome 翻譯成 zh-TW 後實測：body p = 18px ✓ / infobox td/th = 15.84px ✗
    // （Wikipedia table.infobox 0.88em 規則繼承），CJK 字型 metric 比 Latin 視覺
    // 上又小一階 → 使用者體感「中文特別小」。td/th 加進 selector 後 infobox 內
    // 文字會強制套使用者字級。`<table>` 自己**不加**——只攔 cell 級而不動 table
    // 級避免破壞站點 table layout（行高 / 邊框 / column 寬等）；cell 級字級放大
    // 已足夠解決「看不清」核心痛點。`caption` 跟著 td/th 一起進 selector——是
    // table 的標題，跟 cell 同等重要的閱讀內容。
    // v0.8.49：加 [TEXT_DIV_ATTR]——CMS「div 當段落」站（upmedia 等）的主文
    // 段落載體由 apply() runtime 標記（見 markTextDivs），列舉 tag 攔不到的
    // 裸 div 段落才能吃到使用者字級/字型/行距/字重設定。
    // v0.8.83：加 font——老式 table 排版內容頁（Paul Graham essays / 早期手寫
    // HTML）整篇主文包在 `<font size="2">` 裡，`size` 是 HTML4 呈現屬性、會把
    // font-size 重設成固定 px（boss.html 實測 13px），截斷從 `<p>` 繼承的使用者
    // 字級（fontSize=24 設定下 p=24px ✓ 但 font 仍 13px ✗）。font 進 selector 後
    // 強制套使用者字級/字型/行距/字重。`<font>` 在現代主文罕見、且 cleaner 已清
    // 掉 noise font（短/高連結密度），保留的必是內文載體——零誤傷風險。
    const BODY_TEXT_CORE =
      `[${ARTICLE_ATTR}="1"],` +
      `[${ARTICLE_ATTR}="1"] p,` +
      `[${ARTICLE_ATTR}="1"] li,` +
      `[${ARTICLE_ATTR}="1"] blockquote,` +
      `[${ARTICLE_ATTR}="1"] dd,` +
      `[${ARTICLE_ATTR}="1"] dt,` +
      `[${ARTICLE_ATTR}="1"] td,` +
      `[${ARTICLE_ATTR}="1"] th,` +
      `[${ARTICLE_ATTR}="1"] font,` +
      `[${ARTICLE_ATTR}="1"] caption,` +
      `[${ARTICLE_ATTR}="1"] [${TEXT_DIV_ATTR}="1"],`;
    const BODY_TEXT_SEL = BODY_TEXT_CORE + SPAN_TEXT_SEL;
    // v2.5.48：記下來給 findDivCaption 用——被這條套上內文字級的元素，量到的字級是我們的、
    // 不是站方的，不能拿來判斷「站方把它排成小字」
    bodyTextSelInjected = BODY_TEXT_SEL;
    // 後備：完整版 SPAN_TEXT_SEL 的 :not() 鏈有些選擇器引擎解析不了（jsdom 的 nwsapi 會丟錯；
    // Chromium / WebKit 正常）——丟錯時改用不帶排除條件的寬鬆版
    bodyTextSelLoose = BODY_TEXT_CORE + `[${ARTICLE_ATTR}="1"] span`;
    // v0.8.36：font-weight 專用 selector——span 再排除 strong / b 後代。
    // 字級 / 字型注入對 strong 內 span 是正確的（粗體文字也要跟著使用者字級
    // 字型），但 font-weight 注入打在 strong 內的 span 會把粗體抹平成使用者
    // 字重：WYSIWYG 編輯器（Lexical / TipTap，vocus 類站）普遍輸出
    // `<strong><span style="...">粗體</span></strong>`，span 自己命中規則 →
    // 文字渲染 400、內文粗體全部消失（預設設定就觸發，不需使用者改字重）。
    // p 級注入不受影響——strong 有 UA 自身 font-weight（bolder），不靠 inherit。
    // v2.5.12：ARIA 表格的表頭格（role=columnheader、被 markTextDivs 標成內文的 div）
    // 不注入字重、留站方的——使用者字重 < 600 時。docs.gitbook.com 四欄表表頭站方是
    // 500、資料列 400，注入後整列被抹成 400、表頭不比資料列粗（v0.8.49 把 text-div
    // 收進字重注入起既有）。使用者選 600（粗）時照舊注入：站方表頭多半是 500–600，
    // 不注入反而會比內文細。只排除表頭格自己；格內另有 span / p 的照既有規則
    //（role=columnheader 的 div 本身就是 ARIA 表頭的語意，不另外驗它在不在表格列裡）
    const ARIA_HEADER_WEIGHT_KEEP = Number(opts.fontWeight) < 600
      ? ':not([role="columnheader"])'
      : '';
    const TEXT_DIV_SEL_TAIL = `[${TEXT_DIV_ATTR}="1"],`;
    const BODY_WEIGHT_CORE = BODY_TEXT_CORE.endsWith(TEXT_DIV_SEL_TAIL)
      ? BODY_TEXT_CORE.slice(0, -1) + ARIA_HEADER_WEIGHT_KEEP + ','
      : BODY_TEXT_CORE;
    const BODY_WEIGHT_SEL = BODY_WEIGHT_CORE + SPAN_TEXT_SEL +
      ':not(strong *):not(b *)';
    let userOverrides = '';
    // v0.7.162：lineHeight Auto sentinel = 0。Auto 時跳過所有 line-height 注入
    // （保留原站行距）；非 Auto 才把 lineHeight 串進 font-size rule 或獨立 rule。
    const lhAuto = opts.lineHeight === 0;
    if (overrides.fontSize) {
      // 同步注入 line-height：字級改了行高必須跟著縮放，否則原站用 px 鎖死的
      // 行高（例：Medium `.pi { line-height: 32px }` 配 20px 字級 = 1.6 倍）
      // 在字級被調小後變成過寬行距（32/16 = 2.0）。使用 opts.lineHeight
      // （預設 1.7 或使用者自調值），unitless 相對字級自動縮放。v0.6.0
      // baseline 「預設值不動原站」精神仍保留——使用者**完全沒改任何
      // override** 時 userOverrides 為空、DEFAULT 分支不走此路徑；只有
      // 使用者主動改字級才連帶動行高。
      // v0.7.162：使用者顯式選「行距 Auto」時跳過 line-height（即使 fontSize
      // 改過）—— 風險自負，原站若用 px 鎖死的 line-height 在字級縮小後會
      // 變成過寬行距，這是 Auto sentinel 的明確 trade-off。
      const lhClause = lhAuto ? '' : `
  line-height: ${opts.lineHeight} !important;`;
      userOverrides += `
${BODY_TEXT_SEL} {
  font-size: ${opts.fontSize}px !important;${lhClause}
}`;
    }
    if (overrides.titleFontSize) {
      // h1 * 必須一起覆寫：CNA 等站把 h1 文字包在 <span> 裡，SPAN_TEXT_SEL
      // 會把 span 字級壓成 body fontSize，即使 h1 本身 50px 也無效。
      // v1.7.14：同步注入 line-height——與上方 body fontSize 分支同一個坑：
      // 原站大標題常用 px 鎖死行高（NYT h1 64px 配 line-height:67px），
      // titleFontSize 縮到 32px 後 67px 行高留下＝每行之間空出一行、視覺像
      // 標題被拆成多段（Jimmy 2026-07-23 NYT Magazine 截圖）。值用固定 1.3
      // （標題慣用 1.2-1.4；不沿用 opts.lineHeight——那是內文行距，多行大標
      // 套 1.7 會過鬆）。unitless 相對字級自動縮放、h1 * 後代照常繼承。
      // lineHeight Auto sentinel（lhAuto）時一併跳過——尊重使用者「保留原站
      // 行距」的顯式選擇，與 body 分支同一 trade-off。
      const titleLhClause = lhAuto ? '' : `
  line-height: 1.3 !important;`;
      userOverrides += `
[${ARTICLE_ATTR}="1"] h1,
[${ARTICLE_ATTR}="1"] h1 * {
  font-size: ${opts.titleFontSize}px !important;${titleLhClause}
}`;
    }
    if (overrides.fontFamily) {
      userOverrides += `
${BODY_TEXT_SEL} {
  font-family: ${opts.fontFamily}, -apple-system, "Noto Sans TC", "PingFang TC", system-ui, sans-serif !important;
}`;
    }
    {
      // v0.7.254：字重三段（細 300 / 中 400 / 粗 600）一律注入，含預設中 400。
      // 為什麼連 400 也注入（不沿用其他 override 的「預設值不動原站」優化）：原站
      // 若對內文設了非 400 的字重（shoppingdesign `.htmlview p { font-weight: 300 }`，
      // Jimmy 2026-06-08 cage 實證），中(400) 不注入就會退回原站的 300、與細(300)
      // 撞成同一種粗細——使用者切細/中看不出差別。使用者既然有「字重」這個明確
      // 控制項，三段就一律強制套用、才是三個真實字重。用真正的 font-weight 全平台
      // 生效（取代 v0.7.157 boldText 的 macOS-only -webkit-font-smoothing）。只套
      // BODY_WEIGHT_SEL（p / li / blockquote / span 等內文載體），**不含 h1-h6**
      // ——標題字重由原站 / UA bold 維持、保留章節階層。strong / b 自身有 UA
      // font-weight 不受 p 級注入影響；strong / b **內的 span** 由 BODY_WEIGHT_SEL
      // 的 :not(strong *):not(b *) 排除（v0.8.36——span 直接命中規則不是 inherit，
      // 不排除會把 WYSIWYG 站的內文粗體抹平）。
      // v2.5.28：設定值 600（粗）實際渲染 500，見 renderWeightFor
      userOverrides += `
${BODY_WEIGHT_SEL} {
  font-weight: ${renderWeightFor(opts.fontWeight)} !important;
}`;
    }
    // v1.6.12：CJK 為主段落兩端對齊——修 WebKit(iOS Safari) 對 CJK 內文每行少填
    // 尾空間的內縮（見 markCjkParagraphs）。runtime 逐段標記 CJK_JUSTIFY_ATTR、
    // 純英文段落不命中。末行 text-align-last 預設 auto → 自動靠左，不需另設。
    // v2.3.0：textJustify 三段——'off' 把段落標 "0" 強制靠左（關 = 全部靠左，不是
    // 保留原站對齊；用 start 不用 left = RTL 政策，LTR / CJK 下即靠左）；'all' 另把非中文為主段落標 "2"，加自動斷字（hyphens: auto 依 lang
    // 屬性斷英文長字，壓 justify 拉出的字間空隙 rivers）。中文段落不加 hyphens
    //（對 CJK 無作用、留著只是多一條規則）。
    userOverrides += `
[${ARTICLE_ATTR}="1"] [${CJK_JUSTIFY_ATTR}="1"],
[${ARTICLE_ATTR}="1"] [${CJK_JUSTIFY_ATTR}="2"] {
  text-align: justify !important;
}
[${ARTICLE_ATTR}="1"] [${CJK_JUSTIFY_ATTR}="2"] {
  -webkit-hyphens: auto !important;
  hyphens: auto !important;
}
[${ARTICLE_ATTR}="1"] [${CJK_JUSTIFY_ATTR}="0"] {
  text-align: start !important;
}
/* v2.5.24：中文為主段落（標 "1"）的 word-break 還原成 normal。韓文站慣用
   word-break: keep-all（韓文靠空白斷行；toss.tech 掛在 html / body 與文字 span 上），
   頁面譯成中文後規則還在——keep-all 讓中文只能在空白與標點斷行，一行常常只排到
   一半就折，justify 再把這半行的字攤滿整行，字距被拉得很開（語料庫 toss.tech 翻譯後
   截圖，2026-11-18）。中文本來就是字字可斷，normal 才是對的；韓文原文段落漢字不到
   門檻、不會標 "1"，站方的 keep-all 照舊。後代一併設（站方把 keep-all 掛在段落內的
   span 上）；程式碼不動。 */
[${ARTICLE_ATTR}="1"] [${CJK_JUSTIFY_ATTR}="1"],
[${ARTICLE_ATTR}="1"] [${CJK_JUSTIFY_ATTR}="1"] *:not(pre):not(code):not(pre *):not(code *) {
  word-break: normal !important;
}`;
    // v2.5.21：右到左頁面譯成中文後版面改回左到右（evalDirOverride 判定、在 <html>
    // 掛 DIR_LTR_ATTR）。direction 蓋到每個後代：站方在內層容器另寫 dir="rtl" /
    // direction: rtl（維基的 .mw-content-rtl）不會被根節點的值帶過去。<bdo> 是刻意
    // 指定方向的行內覆寫，不動。文字區塊另給 unicode-bidi: plaintext——每一段依自己
    // 第一個強方向字元決定方向，還沒翻到的原文段落照樣右到左、靠右，不會被整頁
    // 拉成左到右後標點跑錯邊。
    userOverrides += `
html[${DIR_LTR_ATTR}="1"] [${ARTICLE_ATTR}="1"],
html[${DIR_LTR_ATTR}="1"] [${ARTICLE_ATTR}="1"] *:not(bdo),
html[${DIR_LTR_ATTR}="1"] [data-jread-promoted-outside="1"],
html[${DIR_LTR_ATTR}="1"] [data-jread-promoted-outside="1"] *:not(bdo) {
  direction: ltr !important;
}
html[${DIR_LTR_ATTR}="1"] [${ARTICLE_ATTR}="1"] :is(p, li, dd, dt, blockquote, figcaption, h1, h2, h3, h4, h5, h6, td, th, caption),
html[${DIR_LTR_ATTR}="1"] [data-jread-promoted-outside="1"] :is(h1, h2, h3, h4, h5, h6, p) {
  unicode-bidi: plaintext !important;
}`;
    // v1.6.23：內文裝飾性大寫 / 加寬字距中和——站方 lead-in 裝飾（uppercase +
    // letter-spacing）殘留會讓內文名字全大寫、字距拉開；疊上 CJK justify 後大寫
    // 長名字不可斷行，justify 把剩餘空間攤給整行字距 → 空隙忽大忽小（wired.com
    // 翻譯後首段實證）。runtime 逐元素標記 DECOR_RESET_ATTR（見 markDecorativeInlines）。
    userOverrides += `
[${ARTICLE_ATTR}="1"] [${DECOR_RESET_ATTR}="1"] {
  text-transform: none !important;
  letter-spacing: normal !important;
  font-variant-caps: normal !important;
}`;
    // v2.5.30：段首單一字母的行內元素（站方首字放大的載體）左右間隔歸零——字級與
    // float 已被內文規則歸回一般，剩下的 margin / padding 會在字母後留一個空格寬
    //（「T hey were born」）。runtime 逐元素標記（見 markLeadLetterSpans）。
    // v2.5.34：連結旁背景圖示被清掉後，留給圖示的那一側 padding 歸零（markIconPadLinks）
    userOverrides += `
[${ARTICLE_ATTR}="1"] [${ICON_PAD_ATTR}="l"] {
  padding-left: 0 !important;
}
[${ARTICLE_ATTR}="1"] [${ICON_PAD_ATTR}="r"] {
  padding-right: 0 !important;
}`;
    userOverrides += `
[${ARTICLE_ATTR}="1"] [${LEAD_LETTER_ATTR}="1"] {
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}`;
    if (overrides.lineHeight && !overrides.fontSize) {
      // fontSize 已改過時 line-height 已連帶注入；這裡只處理「只改 lineHeight
      // 沒改 fontSize」的獨立分支，避免 CSS 重複 rule。
      // v0.7.162：lhAuto 時 overrides.lineHeight 為 false（見 apply 內 overrides
      // 計算），這裡不會誤注入；保險再 guard 一層。
      userOverrides += `
${BODY_TEXT_SEL} {
  line-height: ${opts.lineHeight} !important;
}`;
    }
    // v0.7.162：段落間距條件注入。Auto sentinel = -1 跳過（保留原站 typography）；
    // 非 Auto（含 0 / 預設 1.0 / 使用者自調值）注入 p / ul / ol / blockquote
    // margin-bottom。預設 1.0em 行為等價於 v0.7.102 base 內舊版固定規則（已搬
    // 離 base、改放此處受 Auto sentinel 控制）。
    if (opts.paragraphSpacing >= 0) {
      // v1.5.24：div 當段落站（upmedia 等 CMS 用裸 <div> 而非 <p> 排段落）的主文
      // 段落由 markTextDivs runtime 標記 [TEXT_DIV_ATTR]，比照 <p> 套段落間距——
      // 否則 text-div 段落 margin 全 0、上下段緊貼、也緊貼下方圖片（Jimmy 2026-06-30
      // upmedia 回報「段落無間距 / 文末與圖片無間距」根因）。caption（.mbt-text 類）
      // 字級小於主流、markTextDivs 已排除、不會被誤套段距。text-div selector 排在
      // blockquote 之前、保持 blockquote 為 rule 末 selector（既有 spec 以
      // `blockquote {` 為錨比對此 rule block）。
      userOverrides += `
[${ARTICLE_ATTR}="1"] p,
[${ARTICLE_ATTR}="1"] ul,
[${ARTICLE_ATTR}="1"] ol,
[${ARTICLE_ATTR}="1"] [${TEXT_DIV_ATTR}="1"],
[${ARTICLE_ATTR}="1"] blockquote {
  margin-bottom: ${opts.paragraphSpacing}em !important;
}
/* v0.8.92：消除「站點用 <p> 垂直 padding 撐段距」與 reader margin 疊加的雙倍
   間距。washingtonpost article-body 對每個 <p> 設 padding-bottom: 24px（不是
   margin），與上面 reader margin-bottom 1em(16px) 疊成 40px 段距——cage 實測
   washingtonpost Opinion 文章「段落之間額外空白」根因。段落垂直間距改由 reader
   margin 單一決定（單一資料源原則）：清掉 <p> 的 padding-top/bottom。
   只清 <p>：list 縮排是 padding-left（垂直 padding 罕見）、blockquote 引言框
   常靠 padding 撐內距且 reader 保留其背景（BG_PRESERVE_NOT 含 blockquote），
   都不在此清除範圍。padding-left/right 不動（不影響水平版心）。 */
[${ARTICLE_ATTR}="1"] p {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
/* v0.8.120：消除「站點 flex/grid 容器 row-gap」與 reader 段落 margin 疊加的
   雙倍間距。autosport.com（Motorsport CMS）的 .ms-article-content 是
   display:flex; flex-direction:column; gap:32px，flex 的 row-gap(32px) 與上面
   reader 段落 margin-bottom 1em(~17px) 疊成 49px 段距——使用者調 paragraphSpacing
   只改 margin、改不動 flex gap → Jimmy 2026-06-19 回報「段落間距變很寬、沒尊重
   設定」。段落垂直間距改由 reader margin 單一決定（單一資料源原則）：清掉 reader
   內所有元素的 row-gap。row-gap 僅對 flex/grid/multicol 容器生效（一般 block 元素
   設了是 no-op）→ 非 flex/grid 容器零副作用。只清 row-gap、不清 column-gap：
   flex-column 下 column-gap 不貢獻垂直空間，且翻頁模式版心 column-gap 必須保留
   （styler 僅注入 column-gap、從不注入 row-gap，故零誤清）。Auto 模式（sentinel
   -1）不進此分支、保留原站 flex gap typography。結構通則、非站點/class 特判。 */
[${ARTICLE_ATTR}="1"],
[${ARTICLE_ATTR}="1"] * {
  row-gap: 0 !important;
}
[${ARTICLE_ATTR}="1"] [data-jread-fb-para="1"] {
  margin-top: ${opts.paragraphSpacing}em !important;
  margin-bottom: ${opts.paragraphSpacing}em !important;
}
/* v1.9.15：站方浮動工具列（SITE_UI_ATTR="widget"）內的清單 / 段落不吃段距。
   工具列常用 <ul><li><button> 排一列按鈕，上面的段距規則會在 ul 底下多長一截
   （Reader 選取工具列實測：原生 36px 高、吃到 1em 後變 53px，藥丸底部多出一塊
   空白）。specificity (0,2,1) 蓋過段距規則的 (0,1,1)。 */
[${ARTICLE_ATTR}="1"] :is(p, ul, ol, blockquote)[${SITE_UI_ATTR}="widget"] {
  margin-bottom: 0 !important;
}`;
    }
    if (overrides.theme && theme.text) {
      // dark / sepia：覆蓋文字色（light 的 text 是 null，不注入）
      //
      // v0.8.45：移除 `:not(figcaption)`。v0.7.195 排除 figcaption 的理由是
      // 「背景與文字色成對保留」——但那是 light theme 的設計（light 不注入
      // 文字色、preserve 背景合理）；dark / sepia 下本規則的語意是「theme
      // 接管全部文字色」，figcaption 排除後留下原站深灰（為原站白底設計），
      // 疊在 dark 卡 #1a1a1a 上 ratio 1.7-2.7 不可讀（2026-06-11 page rounds
      // A 群 8 站：bbc x2 / cna / ctee / propublica / shoppingdesign /
      // techcrunch / theverge）。dark / sepia 下 figcaption 的原站背景也已
      // 由下方 v0.8.45 背景中和規則清掉，「成對保留」改為「成對覆寫」，
      // 不再有單邊覆寫的低對比組合。light theme 行為不變（本區塊不注入）。
      userOverrides += `
html.${HTML_CLASS} body {
  color: ${theme.text} !important;
}
[${ARTICLE_ATTR}="1"],
[${ARTICLE_ATTR}="1"] *:where(:not([${SITE_UI_ATTR}])) {
  color: ${theme.text} !important;
}
/* v1.9.15：行內高亮（SITE_UI_ATTR="hl"）的底色與文字色成對保留站方值——上面
   的主題文字色規則用 :where(:not()) 排除它（specificity 不變，仍是 (0,1,0)），
   其後代（高亮內的 strong / em）繼承高亮自己的文字色，不吃主題色（dark 主題
   淺字疊在站方黃底上不可讀）。 */
[${ARTICLE_ATTR}="1"] [${SITE_UI_ATTR}="hl"] * {
  color: inherit !important;
}
/* v2.4.6：半透明高亮（SITE_UI_ATTR="hl-tint"，見 isTranslucentFill）底色透出主題
   卡片色，文字色改跟主題（(0,2,0) 贏上面的 (0,1,0)；後代沒有 SITE_UI_ATTR、
   本來就吃主題色）。底色照留站方值。 */
[${ARTICLE_ATTR}="1"] [${SITE_UI_ATTR}="hl-tint"] {
  color: ${theme.text} !important;
}
/* v2.4.10：選取文字色跟主題（站方 ::selection 多半配白頁設計深字，半透明底透出
   深色卡片後不可讀）。底色照留站方值；站方底色不透明時（SEL_BG_ATTR，JS
   量測）改成 JRead 的選取底色（v2.5.47 起連結色 40% 半透明，見下一條），避免淺字疊
   實心淺底。specificity (0,1,1)/(0,2,1)
   贏站方全域 ::selection 的 (0,0,1)。見 markSiteSelectionBg。
   v2.5.46：站方沒有選取底色時同樣標 SEL_BG_ATTR 補底色——只設字色的 ::selection
   規則會讓瀏覽器不畫預設選取底色，第一條規則單獨生效＝選取完全看不見。 */
html.${HTML_CLASS} ::selection {
  color: ${theme.text} !important;
}
/* v2.5.47：補上的選取底色改成半透明（連結色 40%）。v2.4.10–v2.5.46 用的是不透明
   「連結色 30% 混卡片色」，但 WebKit（Safari）會改寫不透明的 ::selection 底色
   （Color::blendWithWhite：換成「疊在白底上等於原色」的 60–80% 半透明色，太深換不過去
   就把 RGB 夾到 0）——深色卡片上算出來比卡片還暗：night 主題 rgb(43,67,92) 變成約
   rgba(0,20,51,.8)，疊在卡片上幾乎等於卡片色＝Safari 看起來沒反白（Jimmy 2026-11-23
   Safari 27.2 實機；同一張測試頁不透明列偏暗、半透明列正常）。半透明色 WebKit 不改寫，
   兩個引擎畫出來一致；Readwise 的半透明選取底在 Safari 一直正常也是這個原因。
   選取字對比（主題字色疊在合成後的底色上）：dark 4.0、night 5.5、gray 9.4、sepia 8.7:1。 */
html.${HTML_CLASS}[${SEL_BG_ATTR}="1"] ::selection {
  background-color: ${rgbaHex(theme.link, 0.4)} !important;
}
/* 2026-11-15 review B-07：不透明行內高亮（SITE_UI_ATTR="hl"）的文字色是站方值
   （上面 v1.9.15 成對保留），選取時也維持同一個字色——否則 dark / night 主題下
   選到高亮內的字會變成主題淺字疊站方實心淺底（合成頁 probe 兩引擎實證）。
   currentcolor 在 ::selection 的 color 上＝原元素的文字色。JRead 補了選取底色
   （SEL_BG_ATTR）時底色已換成主題連結色，沿用上面的主題字色才讀得到，故排除。
   specificity (0,3,1) 贏上面的 (0,1,1)。 */
html.${HTML_CLASS}:not([${SEL_BG_ATTR}="1"]) [${SITE_UI_ATTR}="hl"]::selection,
html.${HTML_CLASS}:not([${SEL_BG_ATTR}="1"]) [${SITE_UI_ATTR}="hl"] *::selection {
  color: currentcolor !important;
}`;
      // v0.7.151：iframe (chart embed) 強制白底。dark / sepia theme 下 reader
      // card bg 深、跨 origin iframe（datawrapper / flourish / tableau / plotly
      // 等 chart service）內容預設 transparent + 為 light theme 嵌入站設計
      // 的深色文字 → 跟 dark reader card bg 完全融在一起、chart title / legend /
      // axis labels 不可讀。Jimmy 2026-05-20 回報 healthsystemtracker dark
      // theme 下「圖表區塊也使用深底色，導致文字難以閱讀」截圖確認。
      // 強制 iframe background:#fff 讓 transparent 區域透出白色、deeper text 可見。
      // 跨 origin iframe 我們無法讀寫其 styles、只能對 iframe element 本身設背景。
      // 副作用：YouTube / Vimeo / Twitter 等 video / social embed 自身 player
      // 會用自己 bg 覆蓋 iframe transparent area、白底 fallback 對它們無視覺
      // 影響；對 chart embed 是核心保護。
      // 用 html.__jread-active + [data-jread-active] 提升 specificity 到
      // (0,2,2)——避免站點 `iframe.datawrapper` 類 (0,1,2) rule 勝出。
      //
      // v0.7.154：同邏輯擴到 <img>——businessweekly chart PNG 帶 transparent bg
      // + light theme 設計（黑字 + 橘柱 + 紅標題 + 白方框 callout），light card
      // 透出白底正常顯示；dark card 透出 #1a1a1a → 黑色 x 軸文字（亞馬遜 / 輝達
      // / Google / Meta / 蘋果等）+ 黑色註解（資料來源：Google Finance）全部
      // 對比 1:1 直接消失。Jimmy 2026-05-21 chrome-in-chrome 連登入 session
      // probe 確認 chart 是 `<img class="thumb">`、bg transparent + alt 含
      // chart 標題 + image bitmap 內部已固定設計、jread 無法 invert 內容。
      // 修法：dark/sepia 強制 `<img>` 白底，讓 PNG transparent 區域透出白色、
      // 黑字回復可讀。
      // 副作用：JPG 主圖完整覆蓋整圖、白底 fallback 看不到無影響；公司 logo /
      // icon PNG 透明 + light 設計者透白底反而與站點 light visual 一致；
      // 透明 GIF / 小裝飾少見、白底無明顯害處。
      userOverrides += `
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"] iframe,
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"] img:not([${INLINE_IMG_ATTR}]):not([${ICON_IMG_ATTR}]) {
  background-color: #fff !important;
}`;
      // v0.7.154：blockquote 強制清背景。dark / sepia theme 下站點原本為 light
      // theme 設計的 blockquote（淺灰底 + 深色文字）—— styler line 454 preserve
      // 清單刻意保留 blockquote 原 bg（W3C 引述語意視覺區隔），但 dark theme
      // 下 jread `* { color: theme.text }` 把文字色覆寫成淺色 → 淺灰底 +
      // 淺灰文字 = 對比 1.x:1 不可讀。Jimmy 2026-05-21 回報商周
      // /Archive/Article?StrId=7014078 dark theme「引文底色與文字對比太低很難
      // 閱讀」截圖確認。
      // Probe 數值:站點 blockquote.blockquote 套 bg #f5f5f5、styler 覆寫 color
      // #d4d4d4 → 對比 1.38:1（WCAG AA 需 4.5:1）；inject 修法 transparent 後
      // 透出 reader card #1a1a1a → 對比 11.74:1（AAA 通過）。
      // 副作用：light theme 不注入（既有 preserve 設計仍有效）。dark / sepia
      // 下 blockquote 失去「淺底突顯」視覺、但 border-left / padding / ::before
      // 引號圖示 contrast 都 >= 13:1 仍可辨識為引文。
      // selector specificity (0,2,1) > 站點常見 `blockquote.blockquote` (0,1,1)
      // / `.quote-block` (0,1,0) 等 rule。
      //
      // v0.7.164：同邏輯擴到 <pre> + <code>。Jimmy 2026-05-22 回報 Medium
      // M5 Max 評測文（@ddsakura-blog）dark theme 下「白底卡片內淺灰字閱讀
      // 困難」截圖確認。Probe 確認真兇是 <pre>（不是 blockquote——Medium 整篇
      // 沒用 blockquote tag）：站點 .pre 套 bg #f9f9f9、styler 覆寫 color
      // #d4d4d4 → 對比 1.04:1（比 blockquote 更糟）。inline <code> 同個雷：
      // 站點 .code 套 bg #f2f2f2 + dark text → 對比同樣 1.04:1。兩者都是
      // 「站點 light theme 設計的淺色程式碼框 + jread dark 覆寫文字色」的同類
      // 通則 bug，跟 blockquote 走同一條 transparent 修法。
      // pre / code 失去「淺底程式碼框」視覺、但 padding / font-family monospace
      // 仍保留可辨識為 code；inline code 變成跟主文同色但 monospace 字體仍
      // 可區分。
      //
      // v0.8.45：同邏輯擴到 figure / figcaption / summary + table 系。2026-06-11
      // page rounds B 群 4 站實證同類 bug：BG_PRESERVE 在 light theme 下合理
      // 保留的「元素自帶亮色背景」（Wikipedia figure thumb #f8f9fa、維護模板
      // mbox table、newtalk figcaption.mainpic #f0f0f0、sspai 表格 TH/TD
      // #f7f7f9），dark theme 把文字色覆寫成亮灰後變成「亮底亮字」ratio
      // 1.3-1.5；亮底上的 theme.link 亮藍連結也只剩 2.1-2.2。中和背景讓暗卡
      // 透出，文字 / 連結色回到為暗底設計的對比。tag 清單 = BG_PRESERVE 群組
      // 減 mark / kbd（語意高亮的黃底 / 鍵帽白底是內容語意、保留；其上若有
      // 低對比由 apply() 的 dark contrast 兜底層逐元素修文字色）。
      // 用群組常數生成、不手寫 selector（v0.8.37 drift 防護同款）。
      userOverrides += `
${[...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS]
    .map((t) => `html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] ${t}`).join(',\n')} {
  background-color: transparent !important;
  background-image: none !important;
}`;
      // v2.5.14：深色卡片（dark / night）上，站方為淺底設計的程式碼外框換成主題色。
      // 上面那條把 code / pre 的站方底色中和成透明之後，外框還留著站方的淺色——
      // docs.gitbook.com 行內 code 是 `ring-1`（box-shadow inset 1px rgb(217,217,217)），
      // 落在 #4a494d 卡片上變成一圈亮框（Jimmy 2026-11-17）；<pre> 的 1px 淺灰 border 同理。
      // 行內 code：拿掉 box-shadow 外框、border 顏色歸透明。**不補底色**——v2.5.13 以前
      // 深色主題的行內 code 在各站都是透明底（base 那條 `code:not(pre code)` 的
      // inlineCodeBg 輸給上面的中和規則），這裡補底色會改到所有站的畫面（MDN 標題裡的
      // code 變成一塊色塊），底色由下面 v2.5.15 那條另外補（排除標題與連結）。<pre>：只把 border 顏色換成低對比的亮色，
      // 寬度 / 樣式 / box-shadow 不動。判定用卡片底色亮度、不寫主題名；淺色卡片
      //（gray / sepia）上淺色外框本來就不刺眼，不動。
      const _cardBgForCode = parseCssColor(theme.articleBg);
      if (_cardBgForCode && relLuminance(_cardBgForCode) < 0.5) {
        userOverrides += `
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] code:not(pre code) {
  box-shadow: none !important;
  border-color: transparent !important;
}
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] pre {
  border-color: rgba(255, 255, 255, 0.14) !important;
}`;
      }
      // v2.5.15：行內 code 補回主題的淡色底（Jimmy 2026-11-17 裁定）。base 那條
      // `[ARTICLE] code:not(pre code)`（0,1,3）輸給上面背景中和規則
      // `html.CLASS [ARTICLE] code`（0,2,2），gray / sepia / dark / night 的 inlineCodeBg
      // 從未生效。這條寫在中和規則之後、ARTICLE_ATTR 重複兩次把 specificity 拉過去。
      // 排除：標題（h1–h6）與連結裡的 code——標題裡的色塊太重、連結已有連結色當訊號。
      // <pre> 內的 code 不動。只寫 background-color，站方的內距 / 圓角不碰。
      // light 不走這個分支（theme.text 為 null），沿用 base 規則、一個值都不變。
      userOverrides += `
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"] code:not(pre code):not(:is(${INLINE_CODE_NO_BG_CARRIERS}) code) {
  background-color: ${theme.inlineCodeBg} !important;
}`;
      // v0.7.197：連結色已移至 base CSS（所有 theme 統一注入）。
      // 此處不再重複注入。
    }

    // ===== 翻頁模式（v0.7.227）=====
    // 電子書式水平翻頁：reader card 改成 position:fixed 滿版容器 + CSS
    // multi-column overflow columns——「一頁一欄」+ column-fill: auto +
    // 高度約束，溢出內容自動長出等寬水平 column（= 頁）。翻頁由
    // content/paged-mode.js 程式控制 scrollLeft（stride = clientWidth，
    // 因 column-gap = 左右 padding 和，column 寬 + gap 恰為元素 clientWidth）。
    //
    // v0.7.230：「一頁一欄」必須用 column-width 表達、不可用 column-count: 1
    // ——WebKit（Safari macOS / iOS）對 column-count: 1 不建立 multicol
    // fragmentation context：不長 overflow columns、scrollWidth == clientWidth、
    // scrollLeft 永遠 clamp 0，翻頁完全失效（2015 年起的已知 engine bug，
    // Apple Developer Forums thread 22213；column-count >= 2 與 column-width
    // 路徑皆正常，safaridriver 真機 Safari probe 實證 count1 → pages=1 /
    // width 修法 → pages=12 可捲）。column-width: ${contentWidth}px 在
    // 「容器 content box 寬恆 <= contentWidth」前提下（max-width cap 保證），
    // 兩引擎都恰好算出 1 欄：N = max(1, floor((A + gap) / (W + gap)))，
    // A <= W → N = 1，used width 自動撐滿 A——窄視窗（手機）column 跟著
    // 縮、寬視窗 cap 在版心，與 column-count: 1 在 Chrome 的行為完全等價。
    // 此區塊**只在 settings.pagedMode = true 注入**——垂直卷動模式（預設）
    // 一行都不受影響。選擇器與 base 卡片規則同 specificity（html 前綴），
    // 同 stylesheet 內後注入者勝，覆寫卡片的 static / max-width / margin。
    //
    // v0.7.231：右側視覺內距必須用 border-right（transparent）表達、不可用
    // padding-right——WebKit（Safari 26.5 真機 + Playwright trunk 都實證）的
    // multicol scrollable overflow **不含尾端 inline-end padding**，
    // padding-right: 56px 會讓 max scrollLeft 比最後一頁的 stride 格點短 56px，
    // 翻到最後一頁被 clamp → 整頁右移 56px（文字貼死卡片右緣、左內距變兩倍，
    // 即「最後一頁版面寬度沒有尊重設定」症狀；其他頁目標值 < max 不受影響）。
    // border 不參與 scroll container 自身的 scrollable overflow，兩引擎
    // （Chromium 含尾端 padding / WebKit 不含）的 max scrollLeft 公式因此一致；
    // transparent border + 預設 background-clip: border-box 讓卡片底色照常
    // 鋪滿 border 區，視覺與 padding 完全相同。box-sizing: border-box（base
    // 卡片規則已設）下 max-width 720 = 56 padding + 608 content + 56 border
    //（v0.7.234 寬度一致後的桌面值），content box 寬 = column-width 算出值。
    if (opts.pagedMode) {
      // v0.8.166：頁碼指示器 / scrub-track 在 coarse-pointer 的底部抬升（24px，v0.8.162
      // 為 iPad 系統 bar / 縮放把手避讓而加）在 **iPhone** 上把頁碼推進內文造成重疊
      // （Jimmy 2026-06-23 截圖）。iPhone 沒有 iPad 的視窗縮放把手問題，回到接近底緣的
      // 低位即可。故 coarse 抬升的量依平台分流：iPhone 退回近底（6 / 30px，等同非 coarse
      // base），iPad / 其他 coarse 維持 24 / 48px。純 UA 結構訊號（iPhone / iPod），非站點特判。
      const _ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      // 2026-11-15 review C-01：UA 比對讀 settings-defaults.js __JReadPlatform.isIPhoneUA
      const _plat = (typeof globalThis !== 'undefined' && globalThis.__JReadPlatform) || null;
      const _isIPhone = !!(_plat && _plat.isIPhoneUA(_ua));
      // v2.2.12：iPhone 頁碼 6 → 10px（離螢幕底緣多一點呼吸），scrub-track 同步 +4 維持 24px 間距。
      const _indicatorCoarseBottom = _isIPhone ? '10px' : '24px';
      const _scrubTrackCoarseBottom = _isIPhone ? '34px' : '48px';
      // v2.2.12：翻頁卡片「下緣」gutter 由頁碼位置推算（單一資料源）——舊版下緣是
      // V_GUTTER = min(48px, 6vw)、與頁碼位置各自設定：iPhone 390 寬時 6vw ≈ 23px，
      // 頁碼卻佔離底 6–25px，內文末行跟頁碼重疊、貼底（Jimmy 2026-10-28 iPhone 截圖）。
      // 改成 max(V_GUTTER, 頁碼離底 + 頁碼高 + 間隔)：桌面寬視窗仍是 48px 不變，
      // 窄視窗 / iPhone / iPad 一律讓內文停在頁碼上方 PAGED_INDICATOR_GAP 處。
      // 以 custom property 承載：卡片 padding-bottom 與媒體單頁 cap 的 calc 共用同一值。
      // 2026-11-15 review B-10：頁碼的位置 / 尺寸原本在 #__jread-page-indicator 規則與這裡的
      // 推算常數各寫一次、只靠註解對齊。改成下面這組常數，CSS 規則與下緣推算都由它們組出
      //（改頁碼樣式只改這裡；等式由 review-1115-b5-plat.spec 鎖）。
      const PAGED_IND_BOTTOM_PX = 6;   // 頁碼離視窗底（非 coarse；coarse 見 _indicatorCoarseBottom）
      const PAGED_IND_PAD_Y_PX = 4;    // 頁碼上下 padding
      const PAGED_IND_PAD_X_PX = 12;   // 頁碼左右 padding（放大命中區）
      const PAGED_IND_FONT_PX = 11;    // 頁碼字級（line-height 1）
      const PAGED_IND_GAP_PX = 12;     // 頁碼頂與內文末行的間隔
      const PAGED_IND_HEIGHT_PX = PAGED_IND_FONT_PX + 2 * PAGED_IND_PAD_Y_PX; // 19px
      const PAGED_INDICATOR_CLEAR = `${PAGED_IND_HEIGHT_PX + PAGED_IND_GAP_PX}px`; // 31px = 頁碼高 + 間隔
      // v2.2.16：底部安全區域 = env() 與 iOS App 內 JReader 帶進來的 --__jread-app-safe-bottom 取大者。
      // App 頁面沒宣告 viewport-fit=cover，env() 恆為 0，但 WebView 畫到 Home 指示條底下，頁碼落進
      // 系統手勢區（Jimmy 2026-10-29 iPhone 回報）；變數只有 App shim 會設，Safari / Chrome 解析成 0、
      // 結果與 env() 單獨相同
      const SAFE_BOTTOM = 'max(env(safe-area-inset-bottom, 0px), var(--__jread-app-safe-bottom, 0px))';
      const _pagedBottomGutter = (indicatorBottom, safe) =>
        `max(${V_GUTTER}, calc(${indicatorBottom} + ${PAGED_INDICATOR_CLEAR}${safe ? ` + ${SAFE_BOTTOM}` : ''}))`;
      const PAGED_BOTTOM = `var(--__jread-paged-bottom, ${V_GUTTER})`;
      userOverrides += `
/* 翻頁模式：桌面鎖住文件垂直卷動（內容全在 fixed 容器內水平分頁）。
   overscroll-behavior 擋 macOS 觸控板水平 swipe 的歷史導航誤觸 +
   觸控裝置（下方 hack 放行垂直卷動後）擋頂端下拉的 rubber-band 把 fixed
   卡片帶出畫面、以及 pull-to-refresh 誤觸。 */
html.${HTML_CLASS}, html.${HTML_CLASS} body {
  overflow: hidden !important;
  height: 100% !important;
  overscroll-behavior: none !important;
}
/* v1.0.15：翻頁模式 WebKit（Safari macOS/iOS）整頁空白根治——祖先鏈 overflow
   還原 visible。reader card 在翻頁模式是 position:fixed；JRead 祖先 reset
   （ANCESTOR_ATTR 規則）把祖先 height 收成 auto、position 收 static，但**不動
   overflow**。Readwise Reader 這類「文件在內層 overflow:auto/hidden 捲動容器、
   非 window 捲動」的 SPA，祖先鏈多個節點帶 overflow:hidden/auto；reader mode
   下非主文兄弟被 display:none、祖先 height 全塌成 0（real page cage 實證：
   #document-reader-root / _appMain / appContent / #document-inbox / body 5 個
   overflow!=visible 的祖先全塌 0 高）。WebKit 會把 position:fixed 後代「裁切到
   帶非 visible overflow 的祖先 box」——祖先塌成 0 高 → 裁成空 → **整頁空白**
   （Chrome 對 containing block 為 viewport 的 fixed 後代不套祖先 overflow 裁切，
   故只在 Safari 炸；iOS 26.5 模擬器 standalone 重現 + 修法實證）。一般站祖先鏈
   overflow 多為 visible、不觸發，故捲動模式與多數站翻頁模式無此症狀。
   還原 visible 拿掉這個錯誤裁切；祖先此刻 height 0 且非主文兄弟 display:none，
   visible 不會多露任何內容（Chrome 端零視覺變化）。body 的 scroll-lock
   overflow:hidden 由上方 html 前綴規則（specificity 0,1,1 > 本規則 0,1,0）維持、
   不被覆蓋；body 為滿版 viewport 高、overflow:hidden 裁到 viewport 無害。
   結構性規則（描述「祖先帶 overflow 裁切」的 DOM 結構特徵 + 主文 fixed），
   不綁站點身份。 */
[${ANCESTOR_ATTR}="1"] {
  overflow: visible !important;
}
/* v2.5.41：翻頁卡片只有 64px 高——祖先變成 fixed 卡片的包含塊。position:fixed 的
   包含塊本該是 viewport，但祖先只要帶下列任一屬性就會「接走」fixed 後代：transform
   （含個別 translate / rotate / scale）、perspective、filter（連 blur(0px) 也算）、
   backdrop-filter、will-change 指到上述屬性、contain 含 layout / paint、
   container-type（隱含 layout containment）、content-visibility: auto（隱含 paint
   containment）、transform-style: preserve-3d。reader mode 下祖先高度塌成 0，卡片
   top/bottom: 0 錨在 0 高的盒子上 → 只撐出上下 padding（64px），一頁一行。實證：
   arxiv div.ltx_page_main 的 contain: layout（1,608 頁 → 53 頁）、mag.clab
   div.container 的 filter: blur(0px)（113 頁 → 6 頁）。上方基礎祖先 reset 已清
   transform，這裡把同家族一次清完；只在翻頁模式（捲動模式卡片不是 fixed，清掉
   container-type 反而會讓主文內的 container query 失效）。結構性規則，不綁站點。 */
[${ANCESTOR_ATTR}="1"] {
  transform: none !important;
  translate: none !important;
  rotate: none !important;
  scale: none !important;
  perspective: none !important;
  filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  will-change: auto !important;
  contain: none !important;
  container-type: normal !important;
  content-visibility: visible !important;
  transform-style: flat !important;
}
/* v0.7.238 iOS 工具列自動收合 hack：觸控裝置放行垂直卷動 + 略撐高 body。
   翻頁卡片是 position:fixed（視覺釘住、不隨 document 捲動），但底下 document
   可垂直捲——使用者垂直滑一下 → document 捲動 → iOS Safari 偵測到「真實手勢
   捲動」自動收合網址列工具列，多顯示一行內容（卡片 fixed inset:0 隨 layout
   viewport 變高、每欄多容一行）。程式捲動（window.scrollTo）無法觸發收合
   ——iOS 只認真實觸控手勢，simulator 對照實證——故只能半手動，使用者垂直滑一下觸發。
   限觸控裝置（(hover:none) and (pointer:coarse)）：桌面無此自動收合工具列，
   且撐高 body 會多一條無用垂直捲軸；桌面維持上方 overflow:hidden 鎖死。
   v0.7.244 min-height 500vh → 101vh（Jimmy 真機實測收尾，2026-06-08）：iOS 工具列
   收合**看「有沒有在捲動」、不看「捲多少」**——只要 body 比視窗略高、有一點點可捲
   空間（101vh ≈ 視窗高 +1%），使用者垂直滑一下就觸發收合（真機實測 101vh 收得了；
   先前以為要 ~280px 捲動距離是錯的）。**不可 <= 100vh**：body 不比視窗高就無可捲空間、
   完全收不了。為何縮到 101vh：500vh 的大捲動範圍讓第一頁左右滑被原生垂直 pan 搶走、
   不靈敏（Jimmy 最初回報「捲動範圍過高」）；101vh 把垂直捲動範圍壓到最低（捲軸幾乎
   看不到）→ 左右滑乾淨，又保留收合。**收合後不鎖死垂直卷動**——iOS 上「收合 + 鎖死」
   本質做不到（鎖死垂直時慣性捲動彈回頂端、工具列重展開；且使用者下滑必能叫回工具列，
   擋不住也不該擋，v0.7.240→243 燒四版 + 真機 instrument 實證）。第一頁放行垂直（可收合 /
   可自然叫回），第二頁起由 paged-mode.js onTouchMove preventDefault 鎖（純擋、不碰
   touch-action，無彈回問題）。垂直 scrollTop 不代表閱讀進度——onScrollProgress 在翻頁
   模式讓位（見該函式 guard）。 */
@media (hover: none) and (pointer: coarse) {
  html.${HTML_CLASS}, html.${HTML_CLASS} body {
    overflow-x: hidden !important;
    overflow-y: visible !important;
    height: auto !important;
  }
  html.${HTML_CLASS} body {
    min-height: 101vh !important;
  }
}
/* 滿版固定容器：left/right 0 + margin auto + max-width 讓桌面寬視窗時
   頁面寬度 cap 在版心（置中書頁感），手機窄視窗自然滿版。
   top/bottom 0 錨定取代 height: 100vh——iOS Safari 網址列收合時 fixed
   元素隨 layout viewport 調整，不吃 vh 單位的動態視窗誤差。
   水平內距：左 padding + 右 transparent border（不可用 padding-right，
   見上方 v0.7.231 註解）；column-gap = 左右內距和，維持
   「stride = column 寬 + gap = clientWidth − padding + gap」恆等式
   （paged-mode.js stride() 讀 computed style 算同一公式）。
   v0.7.234 寬度一致性（Jimmy 回報「翻頁與捲動模式頁面寬度不同」）：
   contentWidth 的語意以捲動模式 baseline 為準 = **卡片總寬**（含內距，
   border-box；內文 = contentWidth − 左右內距和）。翻頁模式必須同語意：
   max-width cap 在 contentWidth（不再 + 內距 ×2）、column-width =
   contentWidth − 左右內距和——兩模式卡片總寬與內文行寬才會逐 px 相等。
   「一頁一欄」invariant 不變：容器 content box 寬 A = min(viewport,
   contentWidth) − 內距和 <= W = calc(contentWidth − 內距和)，
   N = max(1, floor((A+gap)/(W+gap))) 恆 = 1（等寬時恰好 1）。 */
html [${ARTICLE_ATTR}="1"] {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: auto !important;
  height: auto !important;
  max-width: ${contentWidth}px !important;
  margin: 0 auto !important;
  --__jread-paged-bottom: ${_pagedBottomGutter(`${PAGED_IND_BOTTOM_PX}px`, false)};
  padding: ${PAGED_TOP_GUTTER} 0 ${PAGED_BOTTOM} ${H_GUTTER} !important;
  border-right: ${H_GUTTER} solid transparent !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  column-width: calc(${contentWidth}px - ${H_GUTTER} * 2) !important;
  column-count: auto !important;
  column-gap: calc(${H_GUTTER} * 2) !important;
  column-fill: auto !important;
  overflow: hidden !important;
  /* v0.7.238 iOS 工具列自動收合 hack 的關鍵：卡片 touch-action: pan-y——
     讓觸控裝置在這張 fixed 卡片上的「垂直 pan」冒泡去捲底下 document
     （→ iOS Safari 偵測到真實手勢捲動 → 自動收合工具列）。沒有這行時，
     fixed + overflow:hidden 卡片上的非被動 touchmove listener 會讓 WebKit
     對垂直 pan 的處置變曖昧、scrollY 卡死 0（iOS simulator 真機實證：
     document 明明可捲 scrollH 1508 > 714、mq matches，但垂直滑不捲——
     加 pan-y 後才捲、innerH 714→754 工具列收合）。水平翻頁不受影響：
     翻頁由 paged-mode.js JS 讀 touchstart/end 座標程式控 scrollLeft，
     touch-action 只管瀏覽器「原生手勢」回應、不影響 JS touch event；
     pan-y 同時讓瀏覽器不嘗試原生水平捲（卡片 overflow:hidden 本就不可
     原生水平捲），與 v0.7.237 onTouchMove 對水平 swipe 的 preventDefault
     （擋系統邊緣返回手勢）互補並存。
     v0.7.255：補 pinch-zoom token——純 pan-y 會關掉雙指捏合（iOS Safari 的
     「呼叫所有標籤頁」手勢 = 雙指捏合縮放系統手勢），翻頁模式下使用者捏不
     出標籤頁切換器（Jimmy 回報）。pan-y 只放行垂直 pan、pinch-zoom 放行雙指
     縮放，兩者並列不互斥；單指水平 swipe 仍由 onTouchMove preventDefault 擋
     （preventDefault 只在 touches.length === 1 觸發，雙指捏合不受影響）。 */
  touch-action: pan-y pinch-zoom !important;
}
/* 媒體單頁化：高度 cap 在「頁面內容高 − caption 餘裕 120px」、等比縮放，
   搭配 break-inside: avoid 整塊不跨頁切割（高於一頁的元素 spec fallback
   仍會切，但 max-height 已保證 img/video 本體不超頁）。120px ≈ 3 行圖說
   + margin——56px 實測不夠（chinatalk 直式書封圖 + 圖說的 figure 總高
   818 > 頁 796，break-inside 對「高於 fragmentainer 的元素」失效強制切割）。
   100vh 與 100dvh 雙宣告：支援 dvh 的引擎（iOS 16.4+）用動態視窗高，
   舊引擎 fallback vh。 */
/* v0.8.10：img 選擇器排除 [${INLINE_IMG_ATTR}]——inline emoji / icon 不可套
   「縮放至單頁」的 width:auto + max-width:100%，否則 viewBox-only SVG emoji
   （X Twemoji）被撐成滿欄（150 natural → 608px，Jimmy 翻頁模式實機回報）。
   與捲動模式 block-image rule（line ~585/595）同一排除準則。inline-img rule
   （line ~1027）只覆蓋 max-height/object-fit/display、未設 width，故此規則的
   width:auto 仍會命中 emoji——必須在選擇器層排除。 */
html [${ARTICLE_ATTR}="1"] img:not([${INLINE_IMG_ATTR}]),
html [${ARTICLE_ATTR}="1"] video {
  max-height: calc(100vh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
  max-height: calc(100dvh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
  width: auto !important;
  max-width: 100% !important;
  object-fit: contain !important;
}
/* v3.7.7：svg 不套上面那條的 width: auto——svg 的 width / height 屬性沒寫時沒有原始尺寸，
   width: auto 會掉回 300px 預設（與 v1.9.10 iframe 同理），蓋掉站方 CSS 給的寬。restofworld
   章節分隔符 span.chapter_break 裡三個 svg（內容是 use 參照）站方寫 22px，翻頁模式變成各
   300px、排成直排疊在下一個小標上（捲動模式 22px 橫排，語料庫 probe 實測）。svg 只留單頁 cap
   與寬度 cap；有寬度屬性的 svg 本來就照屬性的值 */
html [${ARTICLE_ATTR}="1"] svg {
  max-height: calc(100vh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
  max-height: calc(100dvh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
  max-width: 100% !important;
}
/* v1.9.10：iframe 不可套上面那條的 width: auto——iframe 是「沒有 intrinsic 尺寸」
   的替換元素，width: auto 不會像 img 那樣退回原始寬度、而是掉回 HTML spec 預設
   300px，高度卻仍吃站方 height 屬性 → 影片變成 300px 寬的直式窄框、poster 只露
   左半（Jimmy 2026-09-17 Stratechery VideoPress 翻頁模式截圖；harness 量到
   iframe 300×342 在 608 寬 wrapper 內）。捲動模式的 iframe 基準規則（上方
   「iframe 特例」）也是同一理由只 cap max-width、不動 width / height。
   翻頁模式對 iframe 只留單頁 cap（max-height）與寬度 cap；object-fit 對 iframe
   無效、不寫。abs-pos 的 responsive embed（FILL_IFRAME_ATTR 雙 attr (0,3,1)）
   specificity 高於本規則 (0,1,2)，維持 width/height:100% 填滿 wrapper 不受影響。 */
html [${ARTICLE_ATTR}="1"] iframe {
  max-height: calc(100vh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
  max-height: calc(100dvh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
  max-width: 100% !important;
}
/* v0.8.35：以「與 base 90vh cap 逐字相同的 selector（MEDIA_CAP_SEL）、同
   specificity、後注入勝」覆寫單頁 cap。上一條 html 前綴規則 (0,2,2) 在
   cascade 輸給 base 媒體 cap (0,3,3)——裸 img（非 a 包）的直式長圖在翻頁
   模式有效 max-height 變 90vh、超過欄高被跨頁切割。 */
${MEDIA_CAP_SEL} {
  max-height: calc(100vh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
  max-height: calc(100dvh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
}
html [${ARTICLE_ATTR}="1"] figure,
html [${ARTICLE_ATTR}="1"] picture,
html [${ARTICLE_ATTR}="1"] img,
html [${ARTICLE_ATTR}="1"] video,
html [${ARTICLE_ATTR}="1"] iframe {
  break-inside: avoid;
}
/* v2.5.49：翻頁模式主文內關掉站方 transition。paged-mode.js 的斷頁前處理是「寫一個值、
   同步量版面、再決定」（fitMediaToPages 先把圖壓成 max-height 1px 量自然起點），站方的
   transition 會讓同步量到的還是動畫起點值。404media 首圖 img 帶 transition: all .4s：
   max-height 從 716px 往 1px 動畫，量到的仍是 390px 高 → 判成本頁放不下、整張推到第 2 頁，
   第 1 頁導言後留 620px 空白（語料庫回放與真站 probe 同值）。height 從 auto 改不會動畫，
   所以只有 max-height 這類可內插的值中招。只在翻頁模式注入；捲動模式沒有這種量測 */
html [${ARTICLE_ATTR}="1"] * {
  transition: none !important;
}
/* v2.5.19：背景圖影片佔位殼（<lite-youtube> 這類，markBgFacadeUi 標的殼）當一張圖
   看待——不跨頁、高度 cap 在單頁內。殼沒有 <img> / <iframe>（縮圖是 background-image、
   高度來自 ::after 的 padding 或 aspect-ratio），上面那條選不到它，WebKit 把它當一般
   block 從中間切開（Jimmy 2026-11-18 iPhone 實機：縮圖上半在頁底、下半到下一頁；
   Playwright WebKit 420 寬字級 20 襯線在高 725 / 875 / 950 重現。Chromium 12 個高度
   都不切——殼帶 paint containment，Chromium 視為不可分割）。點播後殼內換成填滿的
   iframe，殼還是同一個元素、同一條規則照管。比一頁還高的殼（手機橫向）照媒體的
   單頁 cap 壓高，背景縮圖由站方的 cover 裁上下、與點播後 iframe 的 cap 同值。
   只在翻頁模式注入 */
html [${ARTICLE_ATTR}="1"] [${FACADE_FRAME_ATTR}="1"] {
  break-inside: avoid;
  max-height: calc(100vh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
  max-height: calc(100dvh - ${PAGED_TOP_GUTTER} - ${PAGED_BOTTOM} - 120px) !important;
}
/* v2.5.12：ARIA 排的 div 表格（role=row，不是原生 tr）一列不跨頁（GitBook quickstart
   11 列表：390×700 兩個引擎都把一列從中間切成兩半）。列自己加 break-inside: avoid
   ——Chromium 這樣就夠；WebKit 不照 flex item 的 break-*（v2.4.5 同一個毛病），
   列到表格根之間的 flex 外殼（GitBook：role=table > div > role=rowgroup 三層都是
   直向 flex）要一併塌成 block，列才回到可分頁的 block flow。外殼由
   passMarkAriaFlowShells 逐層判定後標記（只標「塌了版面不變」的 flex；表格是容器
   第一個子時連上一層外殼一起，理由見該 pass），列本身仍是橫向 flex、欄寬規則
   （segCardWidth 的 flex: 1 1 0）不受影響。
   比一頁還高的列照 spec 仍會切。原生 <table> 不在這條（WebKit 對 tr / td 的 avoid
   無效、沒有純 CSS 解）。只在翻頁模式注入，捲動模式零影響 */
html [${ARTICLE_ATTR}="1"] :is(${ARIA_TABLE_SEL}) [role="row"]:not(tr) {
  break-inside: avoid;
}
html [${ARTICLE_ATTR}="1"] [${ARIA_FLOW_SHELL_ATTR}="1"] {
  display: block !important;
}
/* v3.7.7：原生表格的列不跨頁（pmc 表 1「Complete response」那列的儲存格切在兩頁之間；
   Jimmy 2026-11-27 裁定表格超過半頁逐列切開——切在列與列之間，不切在列中間）。Chromium
   照 tr 的 break-inside: avoid；WebKit 不照（v2.5.12 註解），Safari 維持現狀。比一頁還高的
   列照 spec 仍會切。只在翻頁模式注入 */
html [${ARTICLE_ATTR}="1"] tr {
  break-inside: avoid;
}
/* v0.8.7：翻頁模式下 media / 連結禁用原生 drag + 補 touch-action——真機實證
   （Jimmy 2026-06-09 culpium/Substack）圖片 draggable=true，iPhone 上水平拖曳
   圖片會啟動 iOS 原生 drag-and-drop（lift）搶走左右滑手勢 → 「圖片上滑不翻頁、
   內文正常」。卡片設 touch-action: pan-y 但 touch-action **不繼承**，圖片預設
   auto 仍放行原生手勢。對 media 明確補 touch-action: pan-y pinch-zoom（同卡片，
   水平 swipe 不被瀏覽器原生攔）+ -webkit-user-drag/touch-callout: none（停掉圖片
   drag-lift 與長按選單），水平 swipe 一律交給 paged-mode.js JS 翻頁。
   只在翻頁模式注入（此 block 在 if(opts.pagedMode) 內）；垂直模式不影響長按存圖。 */
html [${ARTICLE_ATTR}="1"] img,
html [${ARTICLE_ATTR}="1"] picture,
html [${ARTICLE_ATTR}="1"] figure,
html [${ARTICLE_ATTR}="1"] video,
html [${ARTICLE_ATTR}="1"] svg {
  touch-action: pan-y pinch-zoom !important;
  -webkit-user-drag: none !important;
  -webkit-touch-callout: none !important;
}
/* v1.6.6：連結不套 -webkit-touch-callout: none——長按是靜止手勢，不與水平翻頁
   swipe 衝突，touch-action: pan-y pinch-zoom + -webkit-user-drag: none 已足夠保護
   翻頁手勢。callout 保留讓 iOS 長按連結仍能開「在新標籤頁開啟 / 拷貝連結」選單
   （Jimmy 2026-07-02 回報翻頁模式長按連結無此選單）。 */
html [${ARTICLE_ATTR}="1"] a {
  touch-action: pan-y pinch-zoom !important;
  -webkit-user-drag: none !important;
}
/* 頁碼指示（paged-mode.js 建立 / 更新文字）：固定底部置中。
   色用中性灰——白卡 / 黑卡 / 米卡上都可讀，不依賴 theme 欄位。
   v0.8.150：頁碼當 scrubber（按住拖曳快速跳頁）——必須 pointer-events: auto 才
   接得到 touch/mouse；touch-action: none 擋住 iOS 在指示器上的原生捲動/縮放/返回
   （翻頁由 JS 程式控）；padding 放大命中區好按；cursor ew-resize 暗示可左右拖。 */
#__jread-page-indicator {
  position: fixed;
  bottom: ${PAGED_IND_BOTTOM_PX}px;
  left: 50%;
  transform: translateX(-50%);
  padding: ${PAGED_IND_PAD_Y_PX}px ${PAGED_IND_PAD_X_PX}px;
  font: ${PAGED_IND_FONT_PX}px/1 ui-monospace, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  color: rgba(128, 128, 128, 0.95);
  z-index: 2147483647;
  pointer-events: auto;
  touch-action: none;
  cursor: ew-resize;
  user-select: none;
  -webkit-user-select: none;
  border-radius: 999px;
  transition: background-color 0.15s ease;
}
/* 拖曳中（paged-mode.js 加 class）：淡底回饋「已抓住」，不拖時看不出差異維持低調 */
#__jread-page-indicator.__jread-scrubbing {
  background: rgba(128, 128, 128, 0.18);
}
/* v0.8.151 scrub 進度條：按住頁碼起拖時才出現（paged-mode.js 加 .__jread-scrub-visible
   fade-in）、放手淡出。位置在頁碼指示器上方置中、fill 寬 = 目前頁占全文比例，
   讓使用者拖曳時看得到在全文的哪個位置。fill 用 theme.progressBar 與頂部進度條同色。 */
#__jread-scrub-track {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: min(72vw, 360px);
  height: 4px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.25);
  z-index: 2147483647;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
#__jread-scrub-track.__jread-scrub-visible {
  opacity: 1;
}
#__jread-scrub-fill {
  height: 100%;
  width: 0%;
  border-radius: 999px;
  background: ${theme.progressBar};
}
/* v0.8.162：觸控裝置把整組 scrubber（頁碼指示器 + scrub 進度條）往上抬離視窗
   底部——iPad 底部是視窗縮放把手 / 系統手勢區，頁碼停太低拖曳選頁會被 OS 攔走觸控
   （Jimmy 2026-06-22 iPad 截圖「頁碼太靠底部、拖不動」）。env(safe-area-inset-bottom)
   補 home indicator 高度（桌面為 0、不影響）。
   v0.8.166：抬升量依平台分流——iPhone 沒有 iPad 縮放把手問題，原 24px 抬升反而把頁碼
   推進內文重疊（Jimmy 2026-06-23 iPhone 截圖），故 iPhone 退回近底 6/30px；iPad / 其他
   coarse 維持 24/48px。指示器與 scrub-track 同抬同量、維持 24px 間距（track 在上方）。 */
@media (pointer: coarse) {
  html [${ARTICLE_ATTR}="1"] {
    --__jread-paged-bottom: ${_pagedBottomGutter(_indicatorCoarseBottom, true)};
  }
  #__jread-page-indicator {
    bottom: calc(${_indicatorCoarseBottom} + ${SAFE_BOTTOM});
  }
  #__jread-scrub-track {
    bottom: calc(${_scrubTrackCoarseBottom} + ${SAFE_BOTTOM});
  }
}`;
      // v0.8.153 觸覺回饋載體（#__jread-haptic）不再需要 styler CSS——比照實證可動的
      // ios-haptics 套件，paged-mode.js ensureHaptic 直接 inline display:none 建立
      // <label><input switch>] 並掛 document.body，觸覺由 label.click() 切換 switch
      // 狀態觸發、與渲染無關（v0.8.151/152 用 CSS 隱藏 + body 外掛載皆無觸覺）。
    }

    // 內嵌襯線 CJK 字型只在使用者實際選了自訂字型（overrides.fontFamily）時注入，
    // 與上方 font-family override rule 的觸發條件一致——預設無襯線時不污染 CSS。
    // 接在最末（user font-family rule 之後）：woff2 lazy-load、且不打亂「CSS 第一個
    // font-family block = user override rule」的既有結構（styler.spec 倚賴此順序）。
    // v0.8.146：再接「被選到的內嵌拉丁字型」@font-face（latinFontFaceFor 只在 stack
    // 含該 family 時回傳非空，故 latin = auto / 系統字時為空、不變 face 數）。
    // v1.0.20：byline 字體統一。站點常對作者連結與日期各設不同 font-family /
    // font-size（culpium.com Substack 實證：root/內文 SF Pro Display 18px，但作者
    // 與日期都被站點設成 SF Compact、且日期僅 11px——作者 18px、日期 11px，字體與
    // 字級都不一致）。翻譯後更明顯：CJK 日期 fallback 到系統 sans CJK、作者連結走
    // 站點 serif 顯示字體，視覺「作者與日期字體不同」（Jimmy 2026-06-26 回報）。
    // v1.0.8 byline 正規化只統一 font-weight / letter-spacing、漏了 family / size。
    // 修法（結構性、非站點特判）：byline 子樹所有元素用 `font: inherit` shorthand
    // 完整繼承上層字體（family / size / weight / style / line-height 全收斂），
    // 逐層繼承到 byline root 的 reader 字體與字級（root inherit 內文 = 使用者選的
    // reader 字型 + 字級），整條 byline 字體徹底一致。不碰 color（作者連結色雙通道
    // 由既有規則維持；font shorthand 不含 color）。
    // 兩個刻意決策：
    // (1) 接在 userOverrides（conditional typography 規則）之後、不放進 base
    //     skeleton——base 刻意不含 font-size 宣告（typography 字級全走 userOverrides），
    //     多站 typography spec 用「第一個 font-size 規則」的寬鬆 regex 取
    //     SPAN_TEXT_SEL，排前面會被誤抓；排後面 → first-match 仍命中 typography。
    // (2) 用 `font` shorthand 而非 font-family / font-size 兩條 longhand——byline 是
    //     「預設值仍正規化」的特例（一行 flex / 隱藏閱讀時間都在預設套用），但多站
    //     typography spec 守「預設不注入 font-family/font-size override」不變式（尊重
    //     原站內文 typography），用 longhand 會誤觸；shorthand 達成同樣完整繼承、語意
    //     正確（byline 要的就是全套字體繼承），且不撞那些 longhand 字面 regex。
    // v2.2.15：JReader 文章頁圖說預設樣式。一般網站閱讀模式刻意保留原站圖說 typography
    // （v0.7.120 起 figcaption 不吃使用者字級，見上方 BODY_TEXT_SEL 註解）；但 JReader 文章
    // 來自 Readwise html_content，沒有任何原站 CSS → 圖說直接繼承內文字體 / 字級 / 色，
    // 跟內文混成一團（Jimmy 2026-10-29 對照 Readwise Reader App 截圖回報）。reader 自有頁
    // 補上 Readwise 同款層級：無襯線、小一階、淡一階、置中（Jimmy 指定；文字色與卡片色 70/30 混色，
    // dark 實測對比約 4.6:1）。figcaption * 一併蓋——圖說內 <em> / <a> 等 inline 子元素
    // 不靠 inherit；specificity (0,1,1) 贏過主題文字色規則 (0,1,0)。
    // 只 gate 在 opts.readerHostPage（JRead 自有頁），一般網站不受影響
    //
    // v2.5.24：一般網站的圖說也一律套這份樣式（Jimmy 2026-11-19 裁定「所有站圖說一律
    // 置中縮小」，取代 v0.7.120 的「保留原站圖說 typography」）。起因是 Readwise Reader
    // 分享頁與登入版：站方圖說 16px、靠左，內文被使用者字級改成 17px 後圖說讀起來
    // 跟內文一樣大。試過兩種判定都不成立——跟使用者字級比，字級 20 時不命中、桌機與
    // 手機看到的不一樣；跟站方內文比，Readwise 站方其實有層級（20 / 16）完全不命中——
    // 所以不判定，全部統一。字級由 passCaptionFontFloor 寫 inline px（0.8em 是相對
    // 父層，父層字級各站不同、不可靠），這裡的 0.8em 只是該 pass 沒跑到時的後備。
    // 一般網站版與 JReader 自有頁版的差別只在後代選擇器：
    //   - 連結不蓋色（維基圖說滿是連結；蓋成灰色就看不出可以點）
    //   - 程式碼、公式、SVG 不蓋字體與字級（arxiv / distill 圖說裡有公式）
    // 選擇器 html [A="1"][A] figcaption 是 (0,2,2)：贏過 light 圖說色與主題文字色
    // 規則，但低於 v2.5.23「圖說貼近圖片」的 (0,3,2)（margin-top 仍由那條決定）
    // v2.5.25：圖說的後代也寫置中。圖說文字包在 <p> / <li> 裡時（aeon、Readwise 部分文章），
    //「主文段落一律靠左」規則（[A] :is(p, li, …)，(0,1,1)）與中文段落兩端對齊（(0,2,0)）
    // 直接命中那個 <p>，figcaption 自己的 center 繼承不下去——圖說看起來靠左
    //（WebKit 補驗時截圖發現，Chromium 相同）。選擇器多疊一個 [A] 讓兩種 scope 都高過
    // (0,2,0)；只寫 text-align，不影響上面各條的優先序
    const capText = mixHex(theme.text || theme.proseText, theme.articleBg, 0.7);
    // v2.5.36：div 圖說（CAP_DIV_ATTR，見 findDivCaption）一般網站版也套同一份——
    // 另產一份把 figcaption 換成屬性選擇器的規則，不用 :is() 併進來（:is 取最高權重，
    // 會改掉 figcaption 規則原本的 (0,2,2)）
    const captionDefaultCss = (scope, colorStar, fontStar, divCap) =>
      captionBlock(scope, colorStar, fontStar, 'figcaption') +
      (divCap ? captionBlock(scope, colorStar, fontStar, `[${CAP_DIV_ATTR}]`) : '');
    // v2.5.48：div 圖說版多一條 justify-content: center——圖說裡的 flex 列，text-align 管不到
    // 裡面的項目擺哪。shoppingdesign 實證：div.inf > div.inf-head（flex、space-between，
    // 只有一個可見項目）> 圖片來源，整行被推到左邊。justify-content 只對 flex / grid
    // 容器有作用，其他元素寫了也沒影響。另外圖說本身左右 margin: auto——gq.com.tw（與 Vanity
    // Fair 同一套 Condé Nast 版型）的 div.CaptionWrapper 站方設成跟字一樣寬（computed 84.75px），
    // 字在框裡置中、框本身貼左；寬度已撐滿的圖說 auto 算出來是 0，不受影響。
    // figcaption 版不加（規則字串維持原樣，要擴過去另普查）
    const captionBlock = (scope, colorStar, fontStar, C) => {
      return `
${scope} ${C} {
  font-family: -apple-system, "Noto Sans TC", "PingFang TC", system-ui, sans-serif !important;
  font-size: 0.8em !important;
  line-height: 1.5 !important;
  margin-top: 0.6em !important;
  text-align: center !important;
}
${scope} ${C},
${scope} ${C} ${colorStar} {
  color: ${capText} !important;
}
${scope} ${C} ${fontStar} {
  font-family: inherit !important;
  font-size: inherit !important;
}
${scope}[${ARTICLE_ATTR}] ${C} * {
  text-align: center !important;
}` + (C === 'figcaption' ? '' : `
${scope}[${ARTICLE_ATTR}] ${C},
${scope}[${ARTICLE_ATTR}] ${C} * {
  justify-content: center !important;
}
${scope}[${ARTICLE_ATTR}] ${C} {
  margin-left: auto !important;
  margin-right: auto !important;
}`);
    };
    // 公式渲染單元取 NS.MATH_RENDER_SEL（單一資料源；KaTeX 的 .katex 內全是帶專用字體的
    // span，被蓋成 inherit 後減號等符號字寬變了、語料庫 distill 量到 <mo> 消失）
    const mathNot = String(NS.MATH_RENDER_SEL || 'math, mjx-container, .katex').split(',')
      .map((x) => x.trim()).filter(Boolean).map((x) => `:not(${x}):not(${x} *)`).join('');
    const CAP_KEEP_FONT = ':not(code):not(pre):not(kbd):not(samp):not(code *):not(pre *):not(svg):not(svg *)' + mathNot;
    // 一般網站版不併進主 CSS、另放一張樣式表（CAPTION_STYLE_ID，passInjectCss 注入）：
    // 多支 typography spec 守「預設設定下主 CSS 不注入 font-family / line-height /
    // 後代 font-size: inherit」不變式（尊重原站內文 typography），用字串比對主 CSS；
    // 圖說樣式是另一件事，不該讓那些比對分不清。opts.captionOnly＝只要這張
    if (opts.captionOnly) {
      return opts.readerHostPage ? ''
        : captionDefaultCss(`html [${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}]`, '*:not(a):not(a *)', '*' + CAP_KEEP_FONT, true);
    }
    const readerCaption = opts.readerHostPage ? captionDefaultCss(`[${ARTICLE_ATTR}="1"]`, '*', '*') : '';
    const bylineFontNorm = `
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}] * {
  font: inherit !important;
}`;
    // Orion（Kagi）edge-to-edge top safe-area 補償。Orion 把頁面內容鑽進 Dynamic
    // Island / 狀態列下（捲動與翻頁兩模式都會，Jimmy 2026-06-30 實機回報），且不
    // 回報 env(safe-area-inset-*)（四向全 0）、UA 完全偽裝 Safari → env 與 UA 兩路
    // 皆無法分流。改由 content/orion-detect.js（world:MAIN）讀 window.kagi，在 <html>
    // 蓋 .jread-orion + 設 --jread-orion-top（依 screen.height 分檔的島/舊機高度）。
    // 本 CSS 只在 .jread-orion 命中時生效 → Safari 永遠不套、零回歸風險。
    //   捲動模式：body 補 top padding，scroll=0 時標題落在島下方。
    //   翻頁模式：fixed 卡片 top:0 → 下推 inset，標題清開島。
    // gating selector specificity (0,3,1) 贏過翻頁 base 的 html [data-jread-active] (0,1,1)。
    const orionSafeTop = opts.pagedMode
      ? `
html.${HTML_CLASS}.jread-orion [${ARTICLE_ATTR}="1"] {
  top: var(--jread-orion-top, 59px) !important;
}`
      : `
html.${HTML_CLASS}.jread-orion body {
  padding-top: var(--jread-orion-top, 59px) !important;
}`;
    // v1.7.37：頂端進度條皮膚（settings.progressBarStyle）。
    // 為什麼是覆寫段落而不是改 base 骨架裡的 #__jread-progress 規則：base 有
    // memoize cache，key 只含 theme + contentWidth + readerHostPage（_baseSkeletonKey）。
    // 把依賴 progressBarStyle 的宣告寫進 base，切換皮膚時會命中同 key 的舊 cache
    // 拿到 stale CSS——正是 line 614 註解記錄過的那類不變式破壞。接在後面覆寫則
    // 完全不碰 cache 契約（同 bylineFontNorm 的決策）。
    // 'hairline'（預設）回傳空字串 → 既有使用者的注入 CSS 逐字不變、零回歸面。
    //
    // 為什麼描邊是「黑 + 白」兩層而不是選一個更亮的顏色：進度條 position: fixed
    // 疊在捲動內容上，底下的背景是任意的（hero 圖、深色引言區、程式碼黑塊），
    // 任何單一顏色都會在某段背景上被吃掉。雙通道的不變式是「深底靠白邊、淺底
    // 靠黑邊」，兩側總有一邊有對比，與背景無關 → 不是站點特判。
    const PROGRESS_HALO =
      'box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.55), 0 1.5px 0 0 rgba(255, 255, 255, 0.65);';
    // v1.7.53 'gradient' 皮膚（v1.7.53 起的預設）。第三種背景無關機制：不靠外加
    // 輪廓，靠**條子自身同時含亮端與暗端**——任何底色最多吃掉其中一端，另一端仍
    // 有對比，所以「單一顏色會在某段背景上被吃掉」這個根因從色彩本身被解掉。
    //
    // 兩端相對亮度刻意跨過中點（#6FD6FF L=0.51 / #6D28D9 L=0.098）。以 JRead
    // 實際會出現在條子底下的背景實算「兩端較高者」的對比比：light 卡 #ffffff
    // 7.10、light 頁 #ececec 6.01、dark 卡 #4a494d 5.42、dark 頁 #0b0b0b 11.94、
    // sepia 頁 #cdb891 3.67、任意圖片中灰 #808080 2.40（最差）。中灰是任何雙色
    // 配對的理論最差點（兩端同時離它最近），2.40 仍優於 Readwise Reader 同款
    // 配方的 2.11（#43CBFF → #9708CC，Jimmy 2026-08-06 指名的參考實作）。
    //
    // 深端為何不取更深的靛（如 #3B2A8C，中灰能到 2.80）：漸層的**前緣**（= 進度
    // 位置，最需要被讀到的那一點）就是深端，更深的靛在 dark 頁 #0b0b0b 上只有
    // 1.78、進度末端會看不見，整條變成「不知道讀到哪」。#6D28D9 在 dark 頁有
    // 2.77，用中灰 0.4 的對比換前緣可讀性。誠實記錄限制：任何雙色配對都無法讓
    // 前緣在所有底色上都過 3:1（這正是 v1.7.37 記錄的「單一顏色必失守」的推論），
    // 本皮膚保證的是「整條永遠看得見」，不是「前緣永遠看得見」。
    //
    // 色相走青 → 藍紫，留在 JRead 品牌藍（#4A90D9）的家族內。
    //
    // 不加 PROGRESS_HALO：描邊是另一條皮膚的機制，兩者疊起來會讓 3px 細條旁多出
    // 兩圈輪廓、反而糊掉漸層本身的辨識度；要描邊的使用者選 'outline'。
    //
    // 為什麼不寫 background-size：**刻意**保持 auto，讓漸層畫在元素自己的 box 上，
    // 而 box 寬度就是進度值 → 漸層隨進度被拉開（左端恆亮青、前緣恆深靛，但每像素
    // 的色相變化率由陡變緩）。這不是副作用，是這款皮膚的動態訊號：使用者不必看
    // 條長就能從色彩分布感覺到讀了多少。鎖死 background-size 會讓它退化成純色平移。
    // 停在 25% / 75% 使前四分之一為純亮端、後四分之一為純深端，短條也保有兩端。
    const PROGRESS_GRADIENT =
      'background: linear-gradient(100deg, #6FD6FF 25%, #6D28D9 75%);';
    let progressSkin = '';
    if (opts.progressBarStyle === 'gradient') {
      progressSkin = `
#${PROGRESS_ID} {
  ${PROGRESS_GRADIENT}
}`;
    } else if (opts.progressBarStyle === 'outline') {
      progressSkin = `
#${PROGRESS_ID} {
  ${PROGRESS_HALO}
}`;
    } else if (opts.progressBarStyle === 'track') {
      // width: 100% 必須 !important——onScrollProgress 把百分比寫進 inline
      // style.width，inline 宣告贏過無 !important 的 stylesheet 規則。進度改由
      // linear-gradient 的硬色標（兩個 stop 同位置）表現，位置讀 setProgressPct
      // 同步寫入的 --jread-progress。軌道用中性灰半透明：深底顯淺、淺底顯深，
      // 不需要每個主題各配一個值。
      progressSkin = `
#${PROGRESS_ID} {
  width: 100% !important;
  background: linear-gradient(to right,
    ${theme.progressBar} var(--jread-progress, 0%),
    rgba(128, 128, 128, 0.42) var(--jread-progress, 0%));
  ${PROGRESS_HALO}
}`;
    } else if (opts.progressBarStyle === 'thick') {
      // 5px 是「還不至於吃到 iPhone 動態島 / 瀏海區安全距離」與「明顯比 3px 厚」
      // 的折衷；右端圓角讓進度末端有明確端點，drop-shadow 提供與背景的分離。
      progressSkin = `
#${PROGRESS_ID} {
  height: 5px;
  border-radius: 0 3px 3px 0;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
}`;
    }
    return base + userOverrides + bylineFontNorm + readerCaption + orionSafeTop + progressSkin +
      (overrides.fontFamily ? FONT_FACE_CSS + latinFontFaceFor(opts.fontFamily) : '');
  }

  // v0.7.90 auto-hide scrollbar：scroll 事件觸發後立刻 set
  // [data-jread-scrolling="1"] on html、800ms 無新事件後清除。CSS 端用此
  // attr 切換 thumb 色，搭配 0.3s transition 達到 fade-in/out。
  // 模組層級 timer + listener function，apply 時 install / restore 時 remove。
  // 同個 function reference 才能正確 add/remove，所以不能用 closure 重新建構。
  const SCROLLING_ATTR = 'data-jread-scrolling';
  const SCROLL_HIDE_DELAY = 800;
  let scrollHideTimer = null;

  const PROGRESS_ID = '__jread-progress';
  let progressEl = null;
  // v1.7.37：進度百分比的唯一寫入點。除了既有的 style.width，同步寫一份到
  // CSS 變數 --jread-progress——progressBarStyle 'track' 皮膚需要「同一個元素
  // 同時畫已讀段與未讀軌道」：軌道無法用 ::before 疊（父層 z-index 建立 stacking
  // context 後，負 z-index 子元素仍排在父層 background 之上，半透明軌道會蓋在
  // 條子顏色上把它濁掉），改用 width:100% + linear-gradient 硬色標在百分比處切
  // 開兩色。width 與變數必須同一個 setter 寫，否則兩個皮膚各讀一份會 drift。
  function setProgressPct(pct) {
    if (!progressEl) return;
    progressEl.style.width = pct + '%';
    progressEl.style.setProperty('--jread-progress', pct + '%');
  }
  function onScrollProgress() {
    if (!progressEl) return;
    // v0.7.238：翻頁模式下進度條由 paged-mode.js 依「頁比例」驅動。觸控裝置
    // 翻頁模式 document 可垂直捲動（iOS 工具列收合 hack），垂直 scrollTop 是
    // 「收合工具列用」的捲動量、不代表閱讀進度——讓位避免覆寫頁碼進度條
    //（與 onSpaceScroll 讓位 space-scroll 同準則：同一進度條兩條 path 各驅各的
    // 會打架）。
    if (NS.pagedMode && NS.pagedMode.isInstalled && NS.pagedMode.isInstalled()) return;
    const de = document.documentElement;
    const scrollTop = de.scrollTop || document.body.scrollTop;
    const scrollHeight = de.scrollHeight - de.clientHeight;
    if (scrollHeight <= 0) { setProgressPct(0); return; }
    const pct = Math.min(100, (scrollTop / scrollHeight) * 100);
    setProgressPct(pct);
  }
  function onScrollFlash() {
    const html = document.documentElement;
    if (html.getAttribute(SCROLLING_ATTR) !== '1') {
      html.setAttribute(SCROLLING_ATTR, '1');
    }
    if (scrollHideTimer) clearTimeout(scrollHideTimer);
    scrollHideTimer = setTimeout(() => {
      document.documentElement.removeAttribute(SCROLLING_ATTR);
      scrollHideTimer = null;
    }, SCROLL_HIDE_DELAY);
  }

  // v0.7.91：SPACE 鍵捲動。reader mode 啟動後，原站若攔截 keydown SPACE
  // 或 focus 不在 body 上（例如先前 focus 過某個被 cleaner hide 的元素），
  // 瀏覽器原生「SPACE = 往下捲一頁」會失效。對策：window 層級 capture phase
  // 攔 keydown SPACE 自己處理，比原站 bubble listener 早收到事件。
  // 例外：input / textarea / select / contenteditable focus 時放行（使用者
  // 在主文 input 留言或編輯時 SPACE 是輸入空格，不該被搶）。
  // viewport * 0.92 ≈ Chrome 預設 SPACE 捲動量；shift+SPACE 反向往上。
  // smooth scroll 視覺更舒服。
  const SPACE_SCROLL_FRACTION = 0.92;
  function onSpaceScroll(e) {
    // v0.7.216：space-scroll.js 段落焦點模組啟用時讓位——否則兩條 path 對同
    // 一個 SPACE 各捲各的（本 handler scrollBy 92% + 模組段落推進）疊成雙重
    // 捲動（2026-06-05 Playwright probe 實證 828px 幽靈捲動的根因）。模組
    // 停用（spaceScrollRatio = 0）時本 handler 自動回歸 v0.7.91 整頁捲動，
    // 維持「reader mode 下 SPACE 一定可捲」的原始動機。
    if (NS.spaceScroll && NS.spaceScroll.isInstalled && NS.spaceScroll.isInstalled()) return;
    // v2.5.27：圖片預覽開著時讓位
    if (NS.imageViewer && NS.imageViewer.isOpen()) return;
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // 2026-10-07 review B-13：原本自帶一份 INPUT / TEXTAREA / SELECT / contenteditable
    // 判定、漏 BUTTON——主文內 <button>（展開 / 播放）focus 後按 Space，本 handler
    // capture 階段 preventDefault 吃掉按鈕的鍵盤啟用（C7 v0.8.17 修 paged-mode 時的
    // 同一症狀）。改走 NS.isEditableTarget（含 BUTTON）單一資料源。
    if (NS.isEditableTarget(document.activeElement)) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = window.innerHeight * SPACE_SCROLL_FRACTION * (e.shiftKey ? -1 : 1);
    window.scrollBy({ top: dy, behavior: 'smooth' });
  }

  function markAncestors(articleEl) {
    const ancestors = [];
    let p = articleEl.parentElement;
    const stop = document.documentElement;
    while (p && p !== stop) {
      p.setAttribute(ANCESTOR_ATTR, '1');
      ancestors.push(p);
      p = p.parentElement;
    }
    return ancestors;
  }

  // ---- 「div 當段落」標記（v0.8.49）---------------------------------------
  // 結構訊號與 NS.markParagraphDivs（原 fb-post.js，review C-23 上提 namespace）同款：leaf paragraph div = 直接
  // child text node 有實質文字 + 沒有 block 子元素（只有 text node / inline
  // element）。upmedia 等 CMS 主文段落實測命中、巢狀 layout wrapper 不命中。
  //
  // caption 防護：圖說類 div（upmedia div.mbt-text 17px）也符合 leaf 條件，
  // 但依 figcaption 原則（v0.7.120——caption 比 body 小是 typography hierarchy
  // 的關鍵差異化）必須保留站點小字。結構訊號 = 字級階層本身：以「文字量加權
  // 最重的字級」為主文主流字級，只標記字級 >= 主流的 div——站點把 caption 設
  // 得比主文小，這個相對關係跨站成立（probe upmedia 實證：段落 22px ×5 段
  // 共 680 字 vs 圖說 17px ×2 共 76 字 → 主流 22px、圖說被排除）。
  // 文字量加權（不用 div 個數）：caption 短、段落長，個數多數決在「圖多文少」
  // 的相簿型文章會選錯邊，字數加權不會。
  // v1.7.43 T4：「元素在閱讀模式下可見」判定 + 第一個可見 h1 的單一資料源。
  // 原本三處各自實作、判定標準各異：firstInk 逐層 computed display、
  // titleFontSize 只查 data-jread-hidden attribute、kicker 錨點完全不查。
  // 以最嚴格版為正典：不在 data-jread-hidden 子樹內、且自身到 articleEl 之間
  // 無 display:none 祖先（站點原生隱藏的 heading / 分類標籤都不該當錨點）。
  function isVisiblyShown(el, articleEl) {
    if (el.closest && el.closest('[data-jread-hidden="1"]')) return false;
    // 2026-10-07 review B-08：styler 自己以 CSS `display:none !important` 藏掉的標記
    //（kicker / 閱讀時間 / 時刻 / 節目 chip / 孤兒分隔符）也算不可見——這些標記由
    // passBylineKicker 設在 firstInk / edge 判定之前，純看 computed display 在
    // jsdom（無 cascade）會漏判，attr 判定兩個環境一致。
    if (el.closest && el.closest(STYLER_HIDDEN_MARK_SEL)) return false;
    const win = articleEl.ownerDocument?.defaultView;
    // 2026-11-15 review 批 5 A-04＋B-05：站方原生隱藏的判定在 NS.isSiteHidden（這裡只
    // 認 computed display:none，el 自身到 articleEl 之前的每一層）
    if (win && win.getComputedStyle &&
        NS.isSiteHiddenInChain(el, NS.SITE_HIDDEN_SIGNALS.DISPLAY, { stop: articleEl, win })) return false;
    return true;
  }
  function firstVisibleH1(articleEl) {
    for (const h of articleEl.querySelectorAll('h1')) {
      if (isVisiblyShown(h, articleEl)) return h;
    }
    return null;
  }

  // ---- pre-wrap 硬換行 → 真段落（v1.7.70）--------------------------------
  // 根因（Jimmy 2026-08-10 回報 x.com/patrickc/status/2083931939673878592）：
  // 社群貼文（X / Threads / Mastodon / 論壇）的整篇文字是**一個 white-space:
  // pre-wrap 的 block 容器 + 底下幾個 inline span/a**，分段只靠文字節點裡的
  // `\n` 字元。DOM 裡連一個段落元素都沒有 → `<p>` / [TEXT_DIV_ATTR] 段距規則
  // 全部吃不到，reader 內整篇擠成一大塊（probe 實測該貼文：容器 5570 字、9 個
  // 段落、0 個段落元素）。純 CSS 無解——硬換行的行距由 line-height 決定，沒有
  // 任何屬性能只對「換行處」加間距，必須把 `\n` 切成真的段落載體。
  //
  // 修法（結構性通則，非站點特判）：對「computed white-space 是 pre 系 + block
  // 層級 + 後代文字含 `\n`」的容器，把內容依 `\n` 切成 N 個 <div>，標
  // PREWRAP_PARA_ATTR。切出的 div 直接含 inline 內容 → 排在 markTextDivs 之前
  // 就會被它標成 TEXT_DIV_ATTR，段距 / 字級 / 行距 / CJK justify 全部沿用既有
  // 段落規則（不另開一套 CSS —— 「哪些東西是段落」維持單一資料源）。
  //
  // 切法用 Range.extractContents 由後往前分裂，不是重排文字：mention `<a>`、
  // emoji `<img>`、粗體 span 等 inline 結構跟著各自的段落走（probe 實測 9 段、
  // 4 個 mention 連結各自落在正確段落、無殘留 `\n`）。
  //
  // `<br>` 也算硬換行——**翻譯後的同一份貼文長這樣**。probe 實測（合成 X 貼文
  // + Shinkansen/Google MT）：翻譯引擎把整塊 pre-wrap 文字送去翻，回填時把每個
  // `\n` 換成 `<br>`（翻譯後容器 0 個含 `\n` 的 text node、5 個 `<br>`）。只認
  // `\n` 的話「原文有段距、翻譯後又黏成一塊」——Jimmy 回報的第二張截圖正是這個
  // 狀態。兩者是同一份事實（這塊貼文的硬換行）的兩種載體，同一個入口處理才不會
  // 只修一半。
  //
  // ⚠ 這條驗的是「視覺上有沒有段距」，不驗語意分段正不正確——來源只有硬換行，
  // 站方若用單換行表達「同一段內的軟換行」（歌詞 / 地址 / 詩），切出來就是多個
  // 段落。下面四道 guard 是針對這個誤判面的收斂，不是萬無一失：
  //   1. pre（無自動折行）不納入——那是程式碼 / ASCII art 的載體，pre-wrap /
  //      pre-line / break-spaces 才是「會折行的散文」
  //   2. pre/code/textarea/kbd/samp 祖先鏈與等寬字型一律跳過（程式碼區塊）
  //   3. 容器總文字 >= PREWRAP_MIN_TOTAL 且平均段長 >= PREWRAP_MIN_AVG——
  //      歌詞 / 地址 / 標籤列這類「每行都很短」的結構不切（散文段落遠超此值）
  //   4. `<br>` **只在 pre-wrap 容器內**算切點。一般文章的 `<br>` 用途太雜
  //      （地址、簽名檔、表格內換行、圖說折行），無條件轉段落會到處誤傷；限定在
  //      「本來就以 pre-wrap 排版的文字塊」等於沿用同一個判定入口，範圍不擴散
  const PREWRAP_WS = new Set(['pre-wrap', 'pre-line', 'break-spaces']);
  const PREWRAP_CODE_TAGS = new Set(['PRE', 'CODE', 'TEXTAREA', 'KBD', 'SAMP', 'SCRIPT', 'STYLE']);
  const PREWRAP_BLOCK_DISPLAY = new Set(['block', 'flow-root', 'list-item']);
  const PREWRAP_MIN_TOTAL = 120;
  const PREWRAP_MIN_AVG = 40;
  // inline 層級的 pre-wrap 文字塊要達到的「主要文字載體」佔比（見 isPreWrapHost）
  const PREWRAP_INLINE_HOST_RATIO = 0.8;

  // block 層級是主要判定，但**不能只認 block**：X 貼文的 tweetText 在原頁量到
  // `display: block`，clone 進 x-thread 合成容器後掉回 `inline`（X 給它 block 的
  // 那條規則依賴原本的祖先結構，脫離後不再命中；cage 登入態實測 block → inline，
  // 修法第一版就是在這裡整批漏掉、Jimmy 回報「原文還是黏在一起」）。
  // inline 層級改用「是不是所在 block 容器的主要文字載體」判定：整塊貼文文字的
  // 佔比接近 1，句子中間的 inline span（WYSIWYG 的 `<span white-space:pre-wrap>`）
  // 佔比低、不會被切進句中。
  function isPreWrapHost(el, cs, win) {
    if (PREWRAP_BLOCK_DISPLAY.has(cs.display)) return true;
    if (cs.display === 'none' || cs.display === 'contents') return false;
    const myLen = (el.textContent || '').trim().length;
    if (!myLen) return false;
    let host = el.parentElement;
    while (host && !PREWRAP_BLOCK_DISPLAY.has(win.getComputedStyle(host).display)) {
      host = host.parentElement;
    }
    if (!host) return false;
    const hostLen = (host.textContent || '').trim().length;
    return !!hostLen && myLen / hostLen >= PREWRAP_INLINE_HOST_RATIO;
  }

  // 收集容器內所有硬換行載體（text node 內的 `\n` 字元 + `<br>` 元素）+ 攤平後
  // 的全文。gStart/gEnd 是全文座標，用來判斷切點前後有沒有實際文字、以及算段長
  // guard；`<br>` 在全文裡佔一個 `\n` 佔位字元，兩種載體的座標語意才一致。
  //
  // v2.5.14：容器**裡面**的程式碼子樹整棵跳過（FILTER_REJECT）——它的 `\n` 是程式碼
  // 的行、不是散文的段落，也不計入全文（段長 guard 只看散文）。`inPreWrapCodeContext`
  // 只擋「容器自己在程式碼裡」，擋不到「散文容器包著程式碼區塊」：docs.gitbook.com
  // 整篇文件容器是 `whitespace-pre-wrap`，唯一的硬換行全在 Markdown 範例的
  // `<pre><code>` 裡 → 一個程式碼區塊被沿每個換行切開、外殼逐段複製成五顆窄膠囊。
  // `includeCode`（只給下面「程式碼以外沒有硬換行」那條判定用）：照 v2.5.13 以前的
  // 算法把程式碼裡的換行也收進來。
  function collectPreWrapBreaks(el, includeCode) {
    const doc = el.ownerDocument;
    if (!doc || !doc.createTreeWalker) return { full: '', items: [] };
    const walker = doc.createTreeWalker(el, 1 | 4 /* SHOW_ELEMENT | SHOW_TEXT */, {
      acceptNode: (n) => (!includeCode && n.nodeType === 1 && n !== el && PREWRAP_CODE_TAGS.has(n.tagName)
        ? 2 /* FILTER_REJECT */ : 1 /* FILTER_ACCEPT */),
    });
    const items = [];
    let full = '';
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3 /* TEXT_NODE */) {
        const s = n.textContent || '';
        const base = full.length;
        // 同一 text node 內的連續 `\n` 合成一個 item——切段時用一次 splitText
        // 就能把整串換行搬出去（拆成多個 item 的話第一次 splitText 就會讓後面
        // 那些 item 的 offset 失效）
        for (let i = 0; i < s.length; i++) {
          if (s[i] !== '\n') continue;
          let j = i;
          while (j + 1 < s.length && s[j + 1] === '\n') j++;
          items.push({ kind: 'nl', node: n, start: i, end: j + 1, gStart: base + i, gEnd: base + j + 1 });
          i = j;
        }
        full += s;
      } else if (n.tagName === 'BR') {
        const g = full.length;
        full += '\n';
        items.push({ kind: 'br', node: n, gStart: g, gEnd: full.length });
      }
    }
    return { full, items };
  }

  // 把載體合併成「切點群組」：相鄰兩個載體之間沒有實際文字就是同一個群組
  // （`\n\n` / `<br><br>` / `\n<br>` 混排都只切一刀，不會多切出空段落），再濾掉
  // 首尾群組（切點前 / 後沒有任何文字——切了只會產生空段落）。落選的載體原地
  // 保留，pre-wrap 照樣 render 出原本的空行，視覺與原頁一致。
  function usablePreWrapBreaks(full, items) {
    const groups = [];
    for (const it of items) {
      const last = groups[groups.length - 1];
      if (last && !full.slice(last.gEnd, it.gStart).trim()) {
        last.items.push(it);
        last.gEnd = it.gEnd;
      } else {
        groups.push({ items: [it], gStart: it.gStart, gEnd: it.gEnd });
      }
    }
    const used = [];
    let prevEnd = 0;
    for (const g of groups) {
      if (!full.slice(prevEnd, g.gStart).trim()) continue;
      if (!full.slice(g.gEnd).trim()) continue;
      used.push(g);
      prevEnd = g.gEnd;
    }
    return used;
  }

  function inPreWrapCodeContext(el, root, win) {
    let cur = el;
    while (cur && cur !== root.parentElement) {
      if (PREWRAP_CODE_TAGS.has(cur.tagName)) return true;
      const ff = (win.getComputedStyle(cur).fontFamily || '');
      if (/mono/i.test(ff)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  // 總長與平均段長 guard：用全文座標切出的片段算平均（歌詞 / 地址 / 標籤列不切）
  function passesPreWrapLengthGuards(full, used) {
    if (full.trim().length < PREWRAP_MIN_TOTAL) return false;
    const segs = [];
    let prevEnd = 0;
    for (const g of used) { segs.push(full.slice(prevEnd, g.gStart).trim()); prevEnd = g.gEnd; }
    segs.push(full.slice(prevEnd).trim());
    const avg = segs.reduce((n, s) => n + s.length, 0) / segs.length;
    return avg >= PREWRAP_MIN_AVG;
  }

  // 對單一容器執行切段。回傳 record（`{ container, paras, styleSnap }`）或 null
  // （guard 未過）。`prevStyleSnap` 由重切路徑傳入——容器的 inline style 是第一輪
  // 就改好的，重切時再記一次會把「我們自己寫的值」當成原值、還原不回去。
  function splitOnePreWrapContainer(container, win, doc, prevStyleSnap) {
    const { full, items } = collectPreWrapBreaks(container);
    const used = usablePreWrapBreaks(full, items);
    if (!used.length) {
      // v2.5.14：散文沒有可切的硬換行、換行全在程式碼子樹裡（docs.gitbook.com 的文件
      // 容器）。v1.7.70–v2.5.13 這種容器會被沿程式碼的換行切開，同時被下面那行中和成
      // `display:block`——容器原本是直向 flex，子項的上下 margin 不合併（站方的區塊間距
      // ＋我們的段落下距相加，段距 20 → 36px）；中和成 block 後才合併成一份。切段是
      // 錯的、拿掉了；但那幾版驗過的段距是 block 狀態的，所以「照舊算法會被切」的容器
      // 仍中和成 block、不包段落載體（`blockOnly`）。直向 flex 容器的段距疊加是另一個
      // 更大的題目（別站同樣有），不在這裡處理。
      const legacy = collectPreWrapBreaks(container, true);
      const legacyUsed = usablePreWrapBreaks(legacy.full, legacy.items);
      if (!legacyUsed.length || !passesPreWrapLengthGuards(legacy.full, legacyUsed)) return null;
      const styleSnap = prevStyleSnap || {
        display: {
          prev: container.style.getPropertyValue('display'),
          prevP: container.style.getPropertyPriority('display'),
        },
      };
      setInlineOwned(container, 'display', 'block', 'important', 'styler:prewrap');
      return { container, paras: [], seams: [], styleSnap, blockOnly: true };
    }
    if (!passesPreWrapLengthGuards(full, used)) return null;

    {
      // 容器 display 中和成 block（inline style，記進 record 對稱還原）：inline
      // 層級的容器（X clone 後的 tweetText）塞進 block 段落載體會產生 anonymous
      // block box，行為隨瀏覽器實作漂移；中和成 block 才可預測。white-space
      // **不動**——翻譯引擎讀容器的 computed white-space 決定要不要保留換行語意
      // （Shinkansen `shouldPreserveTextNewlines`），改成 normal 會讓譯文的換行
      // 整個被 collapse 掉（真實 X 實測：譯文回來 0 個 `\n`、0 個 `<br>`）。
      const styleSnap = prevStyleSnap || {
        display: {
          prev: container.style.getPropertyValue('display'),
          prevP: container.style.getPropertyPriority('display'),
        },
      };
      setInlineOwned(container, 'display', 'block', 'important', 'styler:prewrap');

      // 先把容器內容整包移進第一個段落載體，再由後往前分裂出其餘段落——切出來
      // 的段落是容器的**子元素**而非兄弟，父層 layout（flex / grid / gap）完全
      // 不受影響。
      //
      // 載體用 `<p>` 而**不是** `<div>`，這點是翻譯路徑的關鍵：Shinkansen 的
      // `BLOCK_TAGS_SET`（P / H1-6 / LI / BLOCKQUOTE / …）**不含 DIV**，div 段落
      // 會被 `isInlineRunNode` 當成 inline run 併成**一個**翻譯單元 → 整包內容被
      // 譯文換掉、段落載體一起被沖走（真實 X 實測 `shinkansenNodes: 1`、段落歸零）。
      // 換成 `<p>` 之後每段各自是一個翻譯單元，翻譯只換段落**內容**、段落結構
      // 原封不動。`<p>` 同時也讓段落直接落進 BODY_TEXT_CORE（不必再借
      // TEXT_DIV_ATTR），Readwise 匯出端拿到的也是真段落。
      //
      // 段落載體帶 `white-space: normal`（容器維持 pre 系不動）：切點的 `\n`
      // **留在該段尾端**不刪除——翻譯引擎讀 DOM 文字，換行沒了就整篇當一段送翻，
      // 譯文回來連 `<br>` 都沒有（真實 X 登入態實測翻譯後容器 0 個 `\n` / 0 個
      // `<br>`，比修法前更糟，且動態重切也沒有載體可用）。段尾的 `\n` 在
      // `white-space: normal` 下被 collapse、不 render 成空行，而 `textContent`
      // 照樣含它：翻譯若以容器為單元，讀的是容器的 pre-wrap → 換行語意保留；
      // 若以 `<p>` 為單元，段落結構本來就不會被沖掉、不需要換行。兩條路都成立。
      const first = doc.createElement('p');
      first.setAttribute(PREWRAP_PARA_ATTR, '1');
      first.style.setProperty('white-space', 'normal');
      while (container.firstChild) first.appendChild(container.firstChild);
      container.appendChild(first);

      const paras = [first];
      const seams = [];
      for (let k = used.length - 1; k >= 0; k--) {
        const group = used[k];
        const tail = group.items[group.items.length - 1];
        const range = doc.createRange();
        // 切點之後才是下一段：`\n` 從該字元之後起算、`<br>` 從元素之後起算
        if (tail.kind === 'nl') range.setStart(tail.node, tail.end);
        else range.setStartAfter(tail.node);
        range.setEnd(first, first.childNodes.length);
        const frag = range.extractContents();
        const p = doc.createElement('p');
        p.setAttribute(PREWRAP_PARA_ATTR, '1');
        p.style.setProperty('white-space', 'normal');
        p.appendChild(frag);
        container.insertBefore(p, first.nextSibling);
        paras.splice(1, 0, p);

        // `\n` 留在原地（前一段尾端，被段落的 white-space:normal collapse 掉）。
        // `<br>` 不吃 white-space、留著就是實打實的一個空行，只能移除——它只出現
        // 在「譯文回填後重切」這條路上，此時內容已是譯文、不需要再留換行語意給
        // 下一輪翻譯。seam 存元素參照本身，還原時放回原件而不是新建。
        // ⚠ 同一切點同時混有 `\n` 與 `<br>`（極罕見）時，還原後兩者的**相對順序**
        // 可能對調（`\n` 留在原位、`<br>` 一律插在下一段之前）；文字內容不受影響。
        const brs = group.items.filter((it) => it.kind === 'br').map((it) => it.node);
        seams.unshift(brs);
        for (let m = brs.length - 1; m >= 0; m--) {
          if (brs[m].parentNode) brs[m].parentNode.removeChild(brs[m]);
        }
      }
      return { container, paras, seams, styleSnap };
    }
  }

  function splitPreWrapParagraphs(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    const doc = articleEl.ownerDocument;
    if (!win || !win.getComputedStyle || !doc || !doc.createRange) return [];

    // 候選：block 層級（或 inline 但是所在 block 的主要文字載體）+ pre 系
    // white-space + 內含硬換行。articleEl 自己也算（整篇主文就是一個 pre-wrap
    // 容器的站台）。
    const candidates = [];
    for (const el of NS.selfAndDescendants(articleEl, '*')) { // 2026-10-07 review C-10：不 spread
      const cs = win.getComputedStyle(el);
      if (!PREWRAP_WS.has(cs.whiteSpace)) continue;
      if (!isPreWrapHost(el, cs, win)) continue;
      if (el.isContentEditable) continue;
      if (inPreWrapCodeContext(el, articleEl, win)) continue;
      // 硬換行載體：文字裡的 `\n`（原文）或 `<br>`（翻譯回填後）
      if ((el.textContent || '').indexOf('\n') === -1 && !el.querySelector('br')) continue;
      candidates.push(el);
    }
    // 巢狀時只取最外層（內層的換行由外層那一輪一起切）
    const outer = candidates.filter((el) => !candidates.some((o) => o !== el && o.contains(el)));

    const records = [];
    for (const container of outer) {
      const rec = splitOnePreWrapContainer(container, win, doc, null);
      if (rec) records.push(rec);
    }
    return records;
  }

  // 兜底：容器內容被整包換掉後重新切段（v1.7.70）。段落載體用 `<p>` 之後，
  // Shinkansen 是逐段翻譯、段落結構不會被沖掉（見 splitOnePreWrapContainer 的
  // `<p>` 註解），但「站方 SPA 自己重繪那塊文字」「其他翻譯工具整包替換」等情境
  // 一樣會讓載體消失。翻譯 / 重繪完成沒有事件可聽，借既有的 dynamic-append 通道
  //（cleaner observer → `remarkDynamicMarkers`）：受影響的容器若「段落載體已不在」
  // 就重跑一次切段。
  //
  // idempotent：重切後容器內又有段落載體，下一次 mutation 進來直接短路，不會迴圈
  //（切段自身插入節點也會觸發 observer，靠的就是這道 guard）。
  function resplitPreWrapParagraphs(node, records) {
    if (!Array.isArray(records) || !records.length || !node) return;
    for (const rec of records) {
      const c = rec && rec.container;
      if (!c || !c.isConnected) continue;
      if (c !== node && !c.contains(node)) continue;
      if (rec.blockOnly) continue; // v2.5.14：只中和 display、沒有段落載體可重切
      if (rec.paras.some((p) => p && p.parentNode === c)) continue;
      const win = c.ownerDocument?.defaultView;
      const doc = c.ownerDocument;
      if (!win || !doc || !doc.createRange) continue;
      const fresh = splitOnePreWrapContainer(c, win, doc, rec.styleSnap);
      // paras 與 seams 必須成對換新——restore 用 seams[i-1] 補回段落之間的換行
      // 載體，只換一半會把舊接縫套到新段落上
      if (fresh) { rec.paras = fresh.paras; rec.seams = fresh.seams; }
    }
  }

  // 還原：段落載體原地 unwrap、接縫補回被刪掉的換行載體（`<br>` 放回原件），
  // 再把容器的 inline style 還回原值、normalize() 合併相鄰 text node。全程保留
  // 原始節點參照（不用 clone 替換），站點掛在那些節點上的 listener / React 綁定
  // 不受影響。
  function restorePreWrapParagraphs(records) {
    if (!Array.isArray(records)) return;
    for (const rec of records) {
      if (!rec || !rec.container || !Array.isArray(rec.paras)) continue;
      const container = rec.container;
      const doc = container.ownerDocument;
      const seams = Array.isArray(rec.seams) ? rec.seams : [];
      for (let i = 0; i < rec.paras.length; i++) {
        const p = rec.paras[i];
        if (!p || !p.parentNode) continue;
        const parent = p.parentNode;
        // `\n` 從未被刪、留在前一段尾端，unwrap 後自然回到原位；只有 `<br>` 需要
        // 插回（原件，不是新建）
        if (i > 0) {
          for (const br of (seams[i - 1] || [])) {
            if (br) parent.insertBefore(br, p);
          }
        }
        while (p.firstChild) parent.insertBefore(p.firstChild, p);
        parent.removeChild(p);
      }
      if (rec.styleSnap) {
        for (const prop of Object.keys(rec.styleSnap)) {
          if (releaseInlineOwned(container, prop, 'styler:prewrap')) continue;
          const s = rec.styleSnap[prop];
          if (s && s.prev) container.style.setProperty(prop, s.prev, s.prevP || '');
          else container.style.removeProperty(prop);
        }
      }
      if (container.normalize) container.normalize();
    }
  }

  function markTextDivs(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    if (!win || !win.getComputedStyle) return [];
    // v1.7.43：tag 集收斂到 NS.INLINE_TEXT_TAGS 單一資料源（與 space-scroll
    // 段落文字量計算共用；drift 史見 namespace.js 該常數註解）。
    // 2026-10-07 review B-20 / F-2：「子樹只含行內元素」的結構判定再上提為
    // NS.isLeafParagraphDiv（與 fb-post markParagraphDivs 共用，tag 集 / 判定
    // 邏輯不再各抄一份）；本端只看直系 children（deep:false，理由見 namespace.js
    // 該函式註解），其餘 gate（figure / contenteditable / 文字量 / 可見性 / 主流
    // 字級）仍在這裡。
    const candidates = [];
    for (const div of articleEl.querySelectorAll('div')) {
      // figure 內 div = 圖說/媒體結構；pre/code 內保留程式碼排版；
      // contenteditable 是使用者輸入區不動
      if (div.closest && div.closest('figure, pre, code')) continue;
      if (div.isContentEditable) continue;
      // 有 block 子元素＝容器、不標記
      if (!NS.isLeafParagraphDiv(div)) continue;
      let directLen = 0;
      for (const node of div.childNodes) {
        if (node.nodeType === 3 /* TEXT_NODE */) {
          directLen += node.textContent.trim().length;
        } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
          // v0.8.80：inline 子元素（span / a / strong…）內的文字也計入。WYSIWYG
          // 編輯器（Draft.js / Lexical 等）把段落文字包成 <div><span>文字</span></div>，
          // div 無直接 text node 但功能上就是段落——只看 direct text 會漏標，
          // line-height 只套到 inline span、parent block div 仍保留站點行高，block
          // strut（max(block lh, span lh)）壓過設定值（Jimmy 2026-06-16 mirrormedia
          // 行距不遵從設定的根因）。標記 block div 後 BODY_TEXT_SEL 把 line-height
          // 注到 div 自身、strut 跟著設定縮放。
          directLen += node.textContent.trim().length;
        }
      }
      // v2.5.11：ARIA 表格列（isAriaTableRow）裡的格子不套 4 字門檻——有字就算。
      // GitBook 實證（docs.gitbook.com blocks/table 四欄表）：表頭四格是同一種
      // `div[role=columnheader]`、站方都是 14px / 500；「Company / Status / Contact」
      // 過得了門檻被標成 text-div、吃到內文字級，「MRR」只有 3 個字被擋在外面、
      // 留在站方的 14px——同一列四格字級不一（v0.8.49 門檻上線起既有）。
      // 4 字門檻擋的是散在版面裡的零碎短 div（分隔點、計數、圖示字）；表格格子的
      // 短字（縮寫、數字、金額）本來就是內容，同一列的格子必須同進同出。
      // 這條驗「格子有沒有被當成內文」、不驗格子之間站方本來就不同的字級
      //（下面主流字級那一關照舊）
      if (directLen < (inAriaTableRow(div, articleEl) ? 1 : 4)) continue;
      const cs = win.getComputedStyle(div);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const fs = Math.round(parseFloat(cs.fontSize) || 0);
      if (!fs) continue;
      candidates.push({ div, fs, len: (div.textContent || '').trim().length });
    }
    if (!candidates.length) return [];
    // 主流字級 = 文字量加權最重的字級；同重取較大者（傾向段落、排除 caption）
    const weightByFs = new Map();
    for (const c of candidates) {
      weightByFs.set(c.fs, (weightByFs.get(c.fs) || 0) + c.len);
    }
    // v2.5.39：<p> 段落也算進主流字級。原本只看「當段落用的 div」，內文全是 <p>、
    // div 只剩圖說與攝影者署名的頁面，主流字級會落在圖說的小字上，圖說反被當成內文、
    // 套上使用者字級，div 圖說規則（findDivCaption，要求比容器字小）也跟著失效。
    // cnbc 真站實證（Jimmy 2026-11-22 iPhone 回報圖說沒貼圖）：內文 <p> 18px、div 候選
    // 是圖說 12px 約 580 字 vs 作者列 16px 約 50 字 → 主流 12、圖說被標 text-div。
    // 只參與「主流是幾 px」的計算，<p> 本身不標記（它們本來就吃 BODY_TEXT_SEL）。
    // figure / pre / code 內與已藏的 <p> 不算，與上面 div 候選同一組排除
    for (const p of articleEl.querySelectorAll('p')) {
      if (p.closest && p.closest('figure, pre, code, [data-jread-hidden="1"]')) continue;
      const len = (p.textContent || '').trim().length;
      if (len < 4) continue;
      const pcs = win.getComputedStyle(p);
      if (pcs.display === 'none' || pcs.visibility === 'hidden') continue;
      const pfs = Math.round(parseFloat(pcs.fontSize) || 0);
      if (!pfs) continue;
      weightByFs.set(pfs, (weightByFs.get(pfs) || 0) + len);
    }
    let dominantFs = 0;
    let maxWeight = -1;
    for (const [fs, w] of weightByFs) {
      if (w > maxWeight || (w === maxWeight && fs > dominantFs)) {
        maxWeight = w;
        dominantFs = fs;
      }
    }
    const marked = [];
    for (const c of candidates) {
      if (c.fs < dominantFs) {
        // 比主流小 = caption 類，保留站點階層。
        // v2.5.34：這種 div 的直屬文字留在站方小字，但裡面的 <span> 會被 SPAN_TEXT_SEL
        // 單獨套上使用者字級——同一行字級不一。Stack Overflow 實證（Jimmy 2026-11-20 實機，
        // 字級約 20）：貼文簽名「asked」12px、後面的日期 span 20px；「edited」連結 12px、
        // 日期 20px。div 有 span 以外的文字（直屬文字節點、或非 span 的行內元素帶字）時
        // 標 SMALL_TEXT_DIV_ATTR，SPAN_TEXT_SEL 排除它的後代，整行維持站方字級。
        // div 的字全在 span 裡時沒有「一行兩種字級」，不標（維持舊行為）
        let mixed = false;
        for (const node of c.div.childNodes) {
          if (node.nodeType === 3 && node.textContent.trim()) { mixed = true; break; }
          if (node.nodeType === 1 && node.tagName !== 'SPAN' && (node.textContent || '').trim()) { mixed = true; break; }
        }
        if (mixed) {
          c.div.setAttribute(SMALL_TEXT_DIV_ATTR, '1');
          marked.push(c.div);
        }
        continue;
      }
      c.div.setAttribute(TEXT_DIV_ATTR, '1');
      marked.push(c.div);
    }
    return marked;
  }

  // ---- CJK 為主內文段落標記（v1.6.12）------------------------------------
  // 根因：WebKit（iOS Safari）在 text-align: left 下對 CJK 內文每行少填約 4 個
  // 字、留 30-88px 尾空間；同一份 DOM / 同字級 / 同 fallback 字型，Chromium 會
  // 填滿。桌面版心寬看不出內縮比例，手機窄版心（~358px）就明顯「第二段起變窄」
  // （Jimmy 2026-07-03 om.co 翻譯後回報）。翻譯（Shinkansen）把幾乎每段都包上
  // inline 元素（<a>/<strong>/<em>），症狀遍及全文。
  //
  // 實測（Playwright WebKit 對照 Chromium）：word-break / line-break / overflow-wrap /
  // 去斜體全部無效，唯一有效解是 text-align: justify（分散對齊撐回滿版，末行
  // text-align-last 預設 auto → 自動靠左，不受影響）。justify 本就是中文排版慣例。
  //
  // 為什麼逐段落載體標記、不標整篇容器：text-align 會繼承，標容器會讓夾在中文
  // 文章裡的純英文段落也被 justify（英文 justify 產生字間空隙 rivers、可讀性差）。
  // 判定訊號是「CJK 佔比」——翻譯無關的純內容結構訊號（硬規則 3）：純英文段落
  // ratio≈0 不命中、完全不受影響；只有中文為主的段落才 justify。
  const CJK_HAN_RE = /[㐀-䶿一-鿿豈-﫿]/g;
  const LATIN_LETTER_RE = /[A-Za-z]/g;
  //
  // v2.3.0：mode = textJustify 設定（'off' | 'cjk' | 'all'，未給 = 'cjk' 既有行為）。
  //   'off'：所有段落標 "0"，CSS 強制靠左（Jimmy 2026-11-07 裁定：關 = 全部靠左，
  //          不是保留原站——原站 justify / 置中的內文段落也一起拉回靠左）
  //   'all'：中文為主段落照舊標 "1"；其餘段落（英文 / 中文太少）標 "2"——CSS 對
  //          "2" 另加 hyphens: auto。門檻：拉丁字母 + 漢字 >= 4，避開空殼 / 單字標籤
  //          （單行段落 justify 本來就沒有視覺效果，門檻只是少標無意義節點）
  //
  // 2026-11-15 review B-09：動態補標（scopeEl＝dynamic-append 的新增節點）。標記原本
  // 只在 apply 當下打一次，兩種情況會漏（probe 實證）：
  //   (a) 英文頁先進閱讀模式再翻譯：apply 時漢字 < 4 沒標（'all' 模式標成 "2"），
  //       譯文回填後段落已是中文卻沒有 "1" → 不 justify，iOS「第二段起變窄」回來
  //   (b) 晚 mount 的段落（站方 lazy 內容）完全沒標：'all' 模式下同一篇前面
  //       justify、後面靠左
  // 有 scopeEl 時只看「新增節點所在的段落載體＋新增子樹內的載體」，依當下文字
  // 重判；已標過的載體只改值、不重複進 marked（restore 清單）。譯文回填是把
  // inline 節點塞進既有 <p>，所以要往上找載體（closest），不能只掃子樹。
  const CJK_CARRIER_SEL = `p, li, blockquote, dd, dt, [${TEXT_DIV_ATTR}="1"]`;

  // v2.5.21：右到左頁面譯成中文後，版面仍是右到左——句號跑到行首、年份甩到行尾，
  // 每一段都這樣（語料庫 he / ar / fa.wikipedia、aljazeera.net 翻譯後截圖，
  // 2026-11-18）。站方在 <html dir="rtl"> 與內層容器標了方向，翻譯只換文字不改方向。
  //
  // 判定吃內容本身、不看是哪個翻譯工具：頁面基準方向是右到左，但內文的字母裡
  // 右到左文字（希伯來、阿拉伯、波斯…）不到三成 → 改回左到右。<pre> / <code> 的
  // 字不算（阿拉伯文的程式教學會有大量拉丁字母，那仍是右到左文章）。
  // 語料庫量到的占比：四頁原文 67% – 100%，翻譯後 1% – 21%，三成落在中間。
  // 字太少（不到 40 個字母）不判，維持站方方向。
  const RTL_SCRIPT_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/g;
  const NON_RTL_LETTER_RE = /[A-Za-z\u00C0-\u024F\u0370-\u052F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g;
  const DIR_LTR_MAX_RTL_SHARE = 0.3;
  const DIR_LTR_MIN_LETTERS = 40;
  function countMatches(txt, re) { const m = txt.match(re); return m ? m.length : 0; }
  function articleRtlShare(articleEl) {
    const txt = articleEl.textContent || '';
    let rtl = countMatches(txt, RTL_SCRIPT_RE);
    let other = countMatches(txt, NON_RTL_LETTER_RE);
    for (const el of articleEl.querySelectorAll('pre, code')) {
      if (el.parentElement && el.parentElement.closest('pre, code')) continue; // 巢狀只扣一次
      const t = el.textContent || '';
      rtl -= countMatches(t, RTL_SCRIPT_RE);
      other -= countMatches(t, NON_RTL_LETTER_RE);
    }
    const total = rtl + other;
    return { total, share: total > 0 ? rtl / total : 1 };
  }
  // rtlBase＝站方原本的方向是不是右到左（apply 當下、覆寫之前量的）。
  function evalDirOverride(articleEl, rtlBase) {
    const root = document.documentElement;
    let on = false;
    if (rtlBase && articleEl) {
      const r = articleRtlShare(articleEl);
      on = r.total >= DIR_LTR_MIN_LETTERS && r.share < DIR_LTR_MAX_RTL_SHARE;
    }
    if (on) root.setAttribute(DIR_LTR_ATTR, '1');
    else root.removeAttribute(DIR_LTR_ATTR);
    return on;
  }
  let dirOverrideTimer = null;
  // 先進閱讀模式再翻譯：譯文是一段一段回填的，等回填告一段落再重判一次。
  function scheduleDirOverride(s) {
    if (!s || !s.rtlBase) return; // 站方不是右到左的頁面完全不排程
    if (dirOverrideTimer) clearTimeout(dirOverrideTimer);
    dirOverrideTimer = setTimeout(() => {
      dirOverrideTimer = null;
      if (activeMarkState === s && s.articleEl && s.articleEl.isConnected) {
        evalDirOverride(s.articleEl, true);
      }
    }, 400);
  }
  function markCjkParagraphs(articleEl, mode, scopeEl, markedInto) {
    const off = mode === 'off';
    const all = mode === 'all';
    let carriers;
    if (scopeEl && scopeEl !== articleEl) {
      carriers = [];
      const host = scopeEl.closest ? scopeEl.closest(CJK_CARRIER_SEL) : null;
      if (host && articleEl.contains(host)) carriers.push(host);
      if (scopeEl.querySelectorAll) {
        for (const el of scopeEl.querySelectorAll(CJK_CARRIER_SEL)) carriers.push(el);
      }
    } else {
      carriers = articleEl.querySelectorAll(CJK_CARRIER_SEL);
    }
    const marked = markedInto || [];
    const setMark = (el, v) => {
      const had = el.hasAttribute(CJK_JUSTIFY_ATTR);
      if (had && el.getAttribute(CJK_JUSTIFY_ATTR) === v) return;
      el.setAttribute(CJK_JUSTIFY_ATTR, v);
      if (!had) marked.push(el);
    };
    for (const el of carriers) {
      // byline / kicker 是 meta 列（作者 / 日期 / 分類），有自己的對齊規則，不 justify
      if (el.closest(`[${BYLINE_ATTR}], [${KICKER_ATTR}]`)) continue;
      // v2.5.12：ARIA 表格列（isAriaTableRow）裡的格子不做兩端對齊，'off' 也不標——
      // 格子的對齊留給站方。格子只有幾十 px 寬，CJK 表頭一折行（docs.gitbook.com
      // 四欄表譯後 390 寬「公司簡介」→「公司簡 / 介」），justify 會把第一行三個字
      // 攤滿整格、字距被拉開成「公 司 簡」。段落的 justify 是為了補 WebKit 每行
      // 行尾的內縮，格子裡沒有那個問題
      if (inAriaTableRow(el, articleEl)) continue;
      if (off) {
        setMark(el, '0');
        continue;
      }
      const txt = el.textContent || '';
      const han = (txt.match(CJK_HAN_RE) || []).length;
      const latin = (txt.match(LATIN_LETTER_RE) || []).length;
      // CJK 佔「有意義字元（漢字 + 拉丁字母）」>= 0.3 = 中文為主段落。純英文段
      // 落 ratio≈0；中英混排（"使用 Aispire.ai 的…"）ratio 仍高、應 justify。
      // han < 4 太短（標籤 / 單字）不算中文段落，避免誤傷
      const cjk = han >= 4 && han / (han + latin) >= 0.3;
      if (cjk) {
        setMark(el, '1');
      } else if (all && han + latin >= 4) {
        setMark(el, '2');
      } else if (scopeEl && el.getAttribute(CJK_JUSTIFY_ATTR) === '1') {
        // 動態重判：先前是中文、現在不是（譯文被還原成原文）→ 撤標記
        el.removeAttribute(CJK_JUSTIFY_ATTR);
      }
    }
    return marked;
  }

  // ---- inline-flow <p> 標記：v0.7.201 水平 padding reset 的豁免（v1.7.8）----
  // 根因（Jimmy 2026-07-16 NYT mike-d-new-album「byline 黏字」回報）：NYT byline
  // 把「By Ben Sisario」「Visuals by Ryan Lowry」輸出成兩個相鄰 inline-block
  // <p>（React render、之間無空白 text node），視覺分隔完全靠站方
  // `.css-1xuzukf { padding-right: 12px }`。v0.7.201 的
  // `html [ARTICLE_ATTR] p { padding-left/right: 0 !important }`（The Register
  // 多欄內縮 220px 修法）把分隔 padding 一起清掉 → 兩段黏成
  // 「By Ben SisarioVisuals by Ryan Lowry」。
  // 通則訊號（硬規則 3——CSS computed 特徵，不綁站點 / class）：v0.7.201 要解的
  // 「多欄 layout 內縮」只可能發生在 block-level p（水平 padding 造成內縮的前提
  // 是元素撐滿容器寬）；computed display 為 inline / inline-block / inline-flex
  // 的 p 參與 inline 流動、其水平 padding 是「相鄰元素分隔」用途 → 標記
  // INLINE_FLOW_P_ATTR 豁免、保留原站 padding。與 v1.0.18 byline-item
  // column-gap 修法同一問題家族（容器 / 排版吃掉 inline 分隔），但載體不同：
  // 該輪是 JRead 自己把 byline item 改 inline-flex 吃掉空白、這輪是站方本來
  // 就無空白、JRead 清掉唯一的 padding 分隔。
  function markInlineFlowParagraphs(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    if (!win || !win.getComputedStyle) return [];
    const marked = [];
    for (const el of articleEl.querySelectorAll('p')) {
      let cs;
      try { cs = win.getComputedStyle(el); } catch (_) { continue; }
      if (!cs || !/^inline/.test(cs.display)) continue;
      el.setAttribute(INLINE_FLOW_P_ATTR, '1');
      marked.push(el);
    }
    return marked;
  }

  // ---- 內文裝飾性大寫 / 加寬字距中和（v1.6.23）----------------------------
  // 根因（Jimmy 2026-07-08 wired.com 翻譯後回報）：站方對首段套整段 lead-in
  // 裝飾 span（text-transform: uppercase + letter-spacing: 1.5px）。閱讀模式
  // 沿用原站 CSS，裝飾殘留 → 英文名字全大寫、字距拉開；疊上 CJK justify
  // （v1.6.12）後大寫長名字不可斷行，justify 把剩餘空間攤給整行字距，空隙
  // 忽大忽小、看起來像對齊壞掉。
  // 通則訊號（硬規則 3——CSS computed 特徵，不綁站點 / class）：內文段落載體
  // 與其 inline 後代若 computed 命中下列任一 → 標記重設：
  //   1. text-transform: uppercase（正文內整句大寫必為裝飾；縮寫詞本身就是
  //      大寫字元、不靠 transform，不受影響）
  //   2. font-variant-caps 非 normal（small-caps 是同一 lead-in 裝飾家族）
  //   3. letter-spacing >= 0.05em（裝飾級加寬；正文易讀性微調通常 < 0.03em，
  //      wired 實測 0.1px/18px ≈ 0.006em 不命中、裝飾 1.5px/18px ≈ 0.083em 命中）
  // 載體清單與 markCjkParagraphs 相同；標題不在清單、byline / kicker 明確排除
  // ——正當的大寫標題 / meta 列樣式不受影響。
  const DECOR_LS_EM = 0.05;
  function markDecorativeInlines(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    if (!win || !win.getComputedStyle) return [];
    const isDecorated = (el) => {
      const cs = win.getComputedStyle(el);
      if (cs.textTransform === 'uppercase') return true;
      if ((cs.fontVariantCaps || 'normal') !== 'normal') return true;
      const ls = parseFloat(cs.letterSpacing); // 'normal' → NaN → 不命中
      if (ls > 0) {
        const fs = parseFloat(cs.fontSize) || 16;
        if (ls / fs >= DECOR_LS_EM) return true;
      }
      return false;
    };
    const carriers = articleEl.querySelectorAll(
      `p, li, blockquote, dd, dt, [${TEXT_DIV_ATTR}="1"]`);
    const marked = [];
    for (const carrier of carriers) {
      if (carrier.closest(`[${BYLINE_ATTR}], [${KICKER_ATTR}]`)) continue;
      // 載體本身 + inline 後代逐一檢查——裝飾可能設在載體（p:first-child
      // uppercase）或內部 span（wired lead-in），各自有站方規則、要各自標記
      // （只標祖先時後代自己的站方規則仍會蓋回來）。code/pre 類不在清單：
      // 程式碼排版不可動。
      const els = [carrier, ...carrier.querySelectorAll(
        'a, span, strong, em, b, i, u, small, mark, abbr, time')];
      for (const el of els) {
        if (el.hasAttribute(DECOR_RESET_ATTR)) continue;
        if (isDecorated(el)) {
          el.setAttribute(DECOR_RESET_ATTR, '1');
          marked.push(el);
        }
      }
    }
    return marked;
  }

  // ---- 脫離型圖說搬回照片下方（v2.5.34）------------------------------------
  // 根因（theguardian < 1140 寬，2026-11-20 量測）：站方首圖的 <figure> 裡沒有圖說，
  // 圖說另放在標題之後的 `div[data-gu-name=caption] > span > figcaption`（寬版時排到
  // 側欄、窄版時排在標題下）。閱讀模式照 DOM 順序排：照片 → 標題 → 圖說，圖說離照片
  // 一整個標題遠。
  // 訊號（結構、不看 class）：可見、有字的 <figcaption>，不在「有可見媒體的 figure」裡；
  // 文件順序往前最近一個寬 > 100px 的可見媒體在某個 <figure> 裡；兩者之間隔著可見的
  // h1–h6，但沒有可見的內文段落（p / li / blockquote 有字）。→ 把圖說搬進那個 figure
  // 的尾端。媒體不在 figure 裡就不搬。退出時搬回原位。
  // Jimmy 2026-11-20 指定收窄版：只處理「figure 裡沒有媒體的脫離型圖說」；普查範圍見
  // CHANGELOG v2.5.34。不驗：圖說與照片之間的實際距離（harness 截圖）
  const DETACHED_CAP_MEDIA_SEL = 'img, picture, video, iframe, canvas, svg, object, embed';
  // v3.7.9：theguardian 1280 寬——站方把首圖圖說另放在作者列側欄（aside 裡的 figcaption），
  // 標題下那份被站方藏起來；側欄那份往前找照片會先經過導言 <p>（照片 → 標題 → 導言 → 側欄
  // 圖說），舊條件「中間不能有內文段落」擋掉。Jimmy 2026-11-27 裁定只做 guardian 1280 寬：
  // 標題與圖說之間容許**一段**短 <p>（導言，CJK 權重 ≤ 400），而且最靠近圖說的標題要是 h1（文章
  // 標題；「圖 → h2 → 一段內文 → 圖說」是內文小節，不搬）；標題與照片之間仍不可有內文；
  // 走這條的圖說自己不能在有媒體元素（含未載入的 lazy 圖）的 figure 裡——那是下一張圖的圖說
  const DETACHED_CAP_DEK_MAX = 400;
  function findDetachedCaptions(articleEl) {
    const out = [];
    const caps = articleEl.querySelectorAll ? Array.from(articleEl.querySelectorAll('figcaption')) : [];
    if (!caps.length) return out;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    for (const fc of caps) {
      if (!(fc.textContent || '').trim() || !vis(fc)) continue;
      if (fc.closest('[data-jread-hidden="1"]')) continue;
      const ownFig = fc.closest('figure');
      if (ownFig && articleEl.contains(ownFig) &&
          Array.from(ownFig.querySelectorAll(DETACHED_CAP_MEDIA_SEL)).some(vis)) continue;
      // 往前（文件順序）找最近的可見媒體；沿途記有沒有標題、內文段落
      const walker = articleEl.ownerDocument.createTreeWalker(articleEl, 1 /* SHOW_ELEMENT */);
      walker.currentNode = fc;
      // v3.7.9：標題與圖說之間容許一段短導言（見 DETACHED_CAP_DEK_MAX 註解）
      const noOwnMedia = !ownFig || !ownFig.querySelector(DETACHED_CAP_MEDIA_SEL);
      let media = null, sawHeading = false, sawProse = false, dekCount = 0, nearHeading = '', budget = 600;
      for (let n = walker.previousNode(); n && n !== articleEl && --budget > 0; n = walker.previousNode()) {
        if (n.contains(fc)) continue;
        if (n.matches(DETACHED_CAP_MEDIA_SEL)) {
          if (vis(n) && n.getBoundingClientRect().width > 100) { media = n; break; }
          continue;
        }
        if (/^H[1-6]$/.test(n.tagName) && vis(n) && (n.textContent || '').trim()) { if (!sawHeading) nearHeading = n.tagName; sawHeading = true; }
        else if (/^(?:P|LI|BLOCKQUOTE)$/.test(n.tagName) && vis(n) && (n.textContent || '').trim()) {
          // 還沒遇到標題（＝這段在標題與圖說之間）、圖說自己沒有媒體殼、只有一段、夠短 → 導言
          const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
          const w = NS && NS.cjkWeightedLen ? NS.cjkWeightedLen(t) : t.length;
          if (!sawHeading && noOwnMedia && n.tagName === 'P' && dekCount === 0 && w <= DETACHED_CAP_DEK_MAX) { dekCount += 1; continue; }
          sawProse = true; break;
        }
      }
      if (!media || !sawHeading || sawProse) continue;
      // 導言路徑只認文章標題（h1）：「圖 → h2 小節 → 一段內文 → 圖說」是內文，不是頁首
      if (dekCount && nearHeading !== 'H1') continue;
      const fig = media.closest('figure');
      if (!fig || !articleEl.contains(fig) || fig.contains(fc)) continue;
      out.push({ fc, fig });
    }
    return out;
  }

  // ---- 連結旁背景圖示的留位（v2.5.34）--------------------------------------
  // 根因（語料庫普查，en 維基參考文獻）：站方 `a.external { background-image: 外部連結
  // 箭頭; background-position: center right; no-repeat; padding-right: 1em }`。閱讀模式
  // 的背景清除規則（[A] * { background-image: none }）把箭頭拿掉，padding 還在——
  // 連結文字與後面的句點之間多一段空白。
  // 訊號（結構、不看 class）：行內連結、站方 computed 的背景是不重複的 url 圖、水平
  // 位置貼左（0%）或貼右（100%），而且同一側有 padding（≤ 32px，圖示大小）。要在
  // ARTICLE_ATTR 設定前量（之後背景已被清掉）；只標記、歸零由 CSS 做。
  // 語料庫普查（v2.5.33 基準）：各語版維基外部連結（en 380、fa 441、el 46、zh 74…，
  // 右到左語系是貼左＋padding-left）、wikihow 兩個連結；沒有別的形狀。
  // 不驗：背景圖不是圖示而是整塊底圖的連結（no-repeat 且貼邊、又帶同側 padding 的
  // 底圖連結沒看過；這種連結的背景本來就會被清，留位歸零只會讓它更緊）
  const ICON_PAD_MAX_PX = 32;
  function markIconPadLinks(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    if (!win || !win.getComputedStyle) return [];
    const marked = [];
    for (const a of articleEl.querySelectorAll('a[href]')) {
      let cs = null;
      try { cs = win.getComputedStyle(a); } catch (_) { cs = null; }
      if (!cs || !/url\(/.test(cs.backgroundImage || '')) continue;
      if (!String(cs.display || '').startsWith('inline')) continue;
      if (!/^no-repeat/.test(cs.backgroundRepeat || '')) continue;
      const x = String(cs.backgroundPositionX || '').split(',')[0].trim();
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      let side = '';
      // computed 值形如「100%」「0%」或「calc(100% - 1.44px)」（維基的鎖頭圖示往內縮一點）
      if (/^(?:100%|right|calc\(100%)/.test(x) && pr > 0 && pr <= ICON_PAD_MAX_PX) side = 'r';
      else if (/^(?:0%|0px|left|calc\(0%)/.test(x) && pl > 0 && pl <= ICON_PAD_MAX_PX) side = 'l';
      if (!side) continue;
      a.setAttribute(ICON_PAD_ATTR, side);
      marked.push(a);
    }
    return marked;
  }

  // ---- 圖說裡左右邊距不對稱的區塊（v3.7.13）------------------------------------
  // 根因（newrepublic 內文圖署名偏右 51px，2026-11-28 語料庫量測）：站方 CSS 把圖框與署名
  // `span.credit`（block）寫在同一條規則（margin-left: 20.83%; width: 66.67%），署名另有
  // margin-right: 4.17%，讓署名對齊圖框那一欄。閱讀模式把圖框重置成滿欄、figcaption 重置
  // 只清了 width / 定位，署名留著左 127px、右 25px 的邊距，再套上圖說置中 → 偏右。
  // 訊號（結構、不看 class）：figcaption 裡畫成區塊（display 不是 inline 系）的元素，左右
  // margin 相差超過 CAP_ASYM_MIN_PX。對稱的邊距（站方刻意內縮）不動；inline 元素（署名與說明
  // 之間的小間隔）不動。要在 ARTICLE_ATTR 設定前量（之後置中規則已生效、量到的是注入後的值）。
  // 普查（182 頁捲動模式）：只有 newrepublic 原文、翻譯後各 4 個署名命中
  const CAP_ASYM_MIN_PX = 8;
  function markCaptionAsymMargins(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    if (!win || !win.getComputedStyle) return [];
    const marked = [];
    for (const el of articleEl.querySelectorAll('figcaption *')) {
      let cs = null;
      try { cs = win.getComputedStyle(el); } catch (_) { cs = null; }
      if (!cs || /^(inline|contents|none)/.test(String(cs.display || ''))) continue;
      const ml = parseFloat(cs.marginLeft) || 0;
      const mr = parseFloat(cs.marginRight) || 0;
      if (Math.abs(ml - mr) <= CAP_ASYM_MIN_PX) continue;
      el.setAttribute(CAP_ASYM_ATTR, '1');
      marked.push(el);
    }
    return marked;
  }

  // ---- 遮罩／背景圖畫的行內 pseudo 圖示：底色清掉後整個不佔位（v3.7.9）--------
  // 根因（pmc 參考文獻「[DOI ]」，2026-11-27 語料庫量測）：站方外部連結圖示畫在
  // `a::after { content: ""; mask-image: url(launch.svg); background-color: currentColor;
  // width: 13.8px; margin-left: 2px }`——形狀靠 mask、顏色靠底色。閱讀模式的 pseudo 底色
  // 清除（v0.7.169 side-bleed 規則：[A] *::after { background-color: transparent;
  // background-image: none }）把底色清成透明，圖示看不見、位置留著，連結字與右括號之間
  // 多一段空白。與 v2.5.34 markIconPadLinks 同型、載體不同（那邊是連結自己的背景圖＋padding）。
  // Jimmy 2026-11-27 裁定：圖示不顯示、位置也不留。
  // 訊號（結構、不看 class）：行內元素的 ::before / ::after——content 是空字串（沒有文字）、
  // 在文流裡（static / relative）、沒有框線（框線畫的形狀清底色後還看得到）、畫法是
  // mask-image 或 background-image 的 url 圖（兩者在 pseudo 底色／背景圖被清掉後都看不見）。
  // 清單項目的 ::before 與播放器 pseudo 不在清除範圍（同那條 CSS 的排除），不標。
  // 要在 ARTICLE_ATTR 設定前量（之後背景圖已被清掉）；標記沿用 ICON_PSEUDO_ATTR（CSS display:none）。
  // 不驗：只靠底色、沒有 mask 也沒有背景圖的 pseudo（作者列的圓點分隔符這類，拿掉會讓
  // 項目間距變樣，刻意不收）
  function markMaskedIconPseudos(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    if (!win || !win.getComputedStyle) return [];
    const marked = [];
    for (const el of articleEl.querySelectorAll('*')) {
      let cs = null;
      try { cs = win.getComputedStyle(el); } catch (_) { cs = null; }
      if (!cs || !String(cs.display || '').startsWith('inline')) continue;
      if (el.closest && el.closest(`[${PLAYER_ATTR}="1"]`)) continue;
      const which = [];
      for (const pseudo of ['before', 'after']) {
        if (pseudo === 'before' && el.tagName === 'LI') continue;
        let ps = null;
        try { ps = win.getComputedStyle(el, '::' + pseudo); } catch (_) { ps = null; }
        if (!ps || ps.content !== '""') continue;
        if (ps.display === 'none') continue;
        if (ps.position !== 'static' && ps.position !== 'relative') continue;
        if ((parseFloat(ps.borderTopWidth) || 0) + (parseFloat(ps.borderRightWidth) || 0) +
            (parseFloat(ps.borderBottomWidth) || 0) + (parseFloat(ps.borderLeftWidth) || 0) > 0) continue;
        const mask = String(ps.maskImage || ps.webkitMaskImage || '');
        if (!/url\(/.test(mask) && !/url\(/.test(String(ps.backgroundImage || ''))) continue;
        which.push(pseudo);
      }
      if (which.length) {
        el.setAttribute(ICON_PSEUDO_ATTR, which.join(' '));
        marked.push(el);
      }
      // v3.7.11：元素本身就是背景圖示（見 BG_ICON_EL_ATTR）。條件：行內、沒有子元素、沒有字
      //（只有空白）、背景是 url 圖、沒有框線、不是背景會被保留的標籤（BG_PRESERVE 群組：figure、
      // code、表格、mark、kbd…）、寬高都在 BG_ICON_EL_MAX_PX 以內（圖示級，不收當佔位圖的大方塊）
      if (el.children.length || (el.textContent || '').trim()) continue;
      if (el.matches(BG_ICON_EL_KEEP_SEL)) continue;
      if (!/url\(/.test(String(cs.backgroundImage || ''))) continue;
      if ((parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0) +
          (parseFloat(cs.borderBottomWidth) || 0) + (parseFloat(cs.borderLeftWidth) || 0) > 0) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0) || r.width > BG_ICON_EL_MAX_PX || r.height > BG_ICON_EL_MAX_PX) continue;
      // pseudo 畫著字或計數器的不收（維基外部連結 `<a class="external autonumber"></a>` 本身沒字、
      // 有背景箭頭，「[1]」是 ::after 的 counter——語料庫 ko 維基比對抓到）
      let pseudoText = false;
      for (const side of ['before', 'after']) {
        let ps = null;
        try { ps = win.getComputedStyle(el, '::' + side); } catch (_) { ps = null; }
        const c = ps && ps.content;
        if (c && c !== 'none' && c !== 'normal' && c !== '""' && c !== "''") { pseudoText = true; break; }
      }
      if (pseudoText) continue;
      el.setAttribute(BG_ICON_EL_ATTR, '1');
      marked.push(el);
    }
    return marked;
  }

  // ---- 段首首字的行內載體：左右間隔歸零（v2.5.30）--------------------------
  // 根因（theguardian.com 2026-11-20 probe）：站方把段首字母包成 <span>，原站是
  // float:left、112px 的放大首字，帶 margin-right:4px 與旁邊的字隔開。閱讀模式把
  // 字級與 float 歸回一般（內文規則），margin 還在 → 「T hey were born」多一個空格寬。
  // aeon 的 `ld-dropcap`（margin-right:6px）是同一個形狀（「F irst」）。
  // 訊號（結構、不看 class）：<p> 的第一個節點（略過空白文字）是行內元素、文字剛好
  // 一個字母（\p{L}）、沒有子元素、後面緊接不以空白開頭的文字，而且它 computed 的
  // 左右 margin / padding 有非零值。語料庫 170 份普查：命中 6 個、全是 aeon 的首字
  //（原文與翻譯後各 3）；公式變數（<small>C</small>: cost…）在 <li>、行內 <code> 不是
  // 字母，都不中。只標記、歸零由 CSS 做（見 LEAD_LETTER_ATTR 規則）。
  // 不驗：::first-letter 的首字（那條走 dropCapPlan）、真實字型的字距（harness 截圖）。
  function markLeadLetterSpans(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    if (!win || !win.getComputedStyle) return [];
    const marked = [];
    for (const p of articleEl.querySelectorAll('p')) {
      let first = null;
      for (const n of p.childNodes) {
        if (n.nodeType === 3 && !n.nodeValue.trim()) continue;
        first = n;
        break;
      }
      if (!first || first.nodeType !== 1 || first.children.length) continue;
      if (!/^(SPAN|B|STRONG|EM|I|FONT)$/.test(first.tagName)) continue;
      if (first.hasAttribute(LEAD_LETTER_ATTR)) continue;
      if (!/^\p{L}$/u.test((first.textContent || '').trim())) continue;
      const next = first.nextSibling;
      if (!next || next.nodeType !== 3 || !next.nodeValue || /^\s/.test(next.nodeValue)) continue;
      let cs = null;
      try { cs = win.getComputedStyle(first); } catch (_) { cs = null; }
      if (!cs) continue;
      const nonZero = [cs.marginLeft, cs.marginRight, cs.paddingLeft, cs.paddingRight]
        .some((v) => Math.abs(parseFloat(v) || 0) > 0);
      if (!nonZero) continue;
      first.setAttribute(LEAD_LETTER_ATTR, '1');
      marked.push(first);
    }
    return marked;
  }

  // ---- Pangu spacing（中英文間自動補空白）---------------------------------
  // 規則：
  //   CJK ↔ ASCII 英數字（LEAD）→ 補空白
  //   ASCII 英數字 + 常見後綴單位 % °（TRAIL）→ CJK 補空白
  // CJK 範圍取常用漢字 + 擴充 A，標點 / 全形字元不計入（不會在「中文，AI」這
  // 種已有全形逗號邊界的位置誤補空白）。
  //
  // 跳過 tag：CODE / PRE / KBD / SAMP / VAR（程式碼風格不可動）、A（連結文字
  // 動了會破壞引用語意，且很多 ASCII URL fragment 在 anchor text 內）、
  // SCRIPT / STYLE / NOSCRIPT（非可見內容）、TEXTAREA / INPUT（表單值）、
  // contenteditable 元素（使用者輸入區）。
  const PANGU_CJK = '[\\u3400-\\u4dbf\\u4e00-\\u9fff]';
  // LEAD（緊接 CJK 之後）：英數字 + 半形 `(` —— CJK後面接 `(` 補空白
  //   例：威騰電子(Western Digital) → 威騰電子 (Western Digital)
  //   `(` 後面（括號內側）不補空白（緊貼括號內容才是視覺常規）
  // TRAIL（緊接 CJK 之前）：英數字 + % + ° + 半形 `)` —— `)` 後面接 CJK 補空白
  //   例：(Western Digital)獨立 → (Western Digital) 獨立
  // 全形括號 （）/ 方括號 「」/ 書名號 《》 都不在 ASCII 範圍，不誤動
  const PANGU_LEAD = '[A-Za-z0-9(]';
  const PANGU_TRAIL = '[A-Za-z0-9%\\u00b0)]'; // ° = °
  const PANGU_RE_CJK_ALNUM = new RegExp('(' + PANGU_CJK + ')(' + PANGU_LEAD + ')', 'g');
  const PANGU_RE_ALNUM_CJK = new RegExp('(' + PANGU_TRAIL + ')(' + PANGU_CJK + ')', 'g');
  const PANGU_SKIP_TAGS = new Set(['CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'A', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

  // 中文半形標點 → 全形標點對照（v0.7.158）。觸發條件：前或後緊鄰 CJK 邊界即
  // 轉，確保 example.com / Hello, world 這類純 ASCII 邊界不會被誤動。
  // 引號 ' " 不在此表（開/閉判斷複雜、誤殺風險高）。
  //
  // PUNCT_BOUNDARY_CJK 比 PANGU_CJK 寬：除漢字本範圍外另含 CJK 符號標點區段
  // U+3000-303F（、。「」『』《》〈〉【】〔〕 等）與全形 ASCII 區段
  // U+FF00-FFEF（，。：；？！（）［］ 與全形英數字 等）。理由：使用者反例
  // `「藍色連結」,Google` 中 `,` 前一字元是 `」`(U+300D)，原 PANGU_CJK 漢字
  // 範圍不含 CJK 標點，導致逗號不被視為「中文邊界」漏轉。pangu 補空白規則
  // 維持只看 PANGU_CJK（漢字本範圍），避免「全形標點 ↔ ASCII」之間誤補空白
  // ——全形標點自帶視覺分隔，補空白反而視覺破碎。
  const PUNCT_MAP = { ',': '，', '.': '。', ':': '：', ';': '；', '?': '？', '!': '！' };
  const PUNCT_BOUNDARY_CJK = '[\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]';
  const PUNCT_BOUNDARY_CJK_RE = new RegExp(PUNCT_BOUNDARY_CJK);
  // 命中順序：先「CJK 在前」（句尾 / 中文後接標點）、再「CJK 在後」（標點後
  // 接中文，如 Hello, 世界）。兩條獨立替換可同時覆蓋 `中文,Hello,中文` 內的
  // 兩個逗號（第一個前 CJK 觸發、第二個後 CJK 觸發）。
  const PUNCT_CHARS = '[,.:;?!]';
  const PUNCT_RE_CJK_BEFORE = new RegExp('(' + PUNCT_BOUNDARY_CJK + ')(' + PUNCT_CHARS + ')', 'g');
  const PUNCT_RE_CJK_AFTER = new RegExp('(' + PUNCT_CHARS + ')(?=' + PUNCT_BOUNDARY_CJK + ')', 'g');
  // 半形括號 ( ) 只在「兩側都緊鄰 CJK 邊界」時轉全形——避免 `中文 (English)`
  // 變成不對稱的 `中文（English)`；混合 ASCII 內容時保留半形交給 pangu 補空白。
  const PAREN_OPEN_RE = new RegExp('(' + PUNCT_BOUNDARY_CJK + ')\\((?=' + PUNCT_BOUNDARY_CJK + ')', 'g');
  const PAREN_CLOSE_RE = new RegExp('(' + PUNCT_BOUNDARY_CJK + ')\\)(?=' + PUNCT_BOUNDARY_CJK + ')', 'g');
  // 寬鬆規則：text node 整體含 CJK 邊界字元時，把剩餘 ASCII↔ASCII 邊界的半形
  // 逗號也轉全形。涵蓋 `叫 Google Alerts,2003 年就有了` 這類「英文片語接半形
  // 逗號接 ASCII 但整段為中文 prose」情境（Jimmy 2026-05-21 實機回報）。
  // 其他標點（. : ; ? !）不在寬鬆規則內：
  //   . 寬鬆轉會誤殺 example.com / 1.5 / Mr.Smith
  //   : 寬鬆轉會誤殺 http://  / 12:30 時間格式
  //   ; ? ! 寬鬆轉風險目前未實測，保留嚴格邊界 fallback 空間
  // tradeoff：中文 prose 內混 inline 英文 list（如「他列出 Apple, Banana, Cherry」）
  // 的逗號會被誤轉全形，但此情境在新聞 / 部落格 prose 內罕見，且 list 通常以
  // HTML 結構（<ul>/<ol>）或全形頓號 `、` 呈現，誤殺面小。

  // v2.5.28：編號後面的句點不轉全形（Jimmy 2026-11-19 回報：商周「1.日本調查顯示…」
  // 「2.三菱電機…」進閱讀模式變成「1。日本…」「2。三菱…」）。「1.」「2.」是編號的
  // 一部分、不是中文句號。判定只看字串形狀：句點前是 1–3 位數字（可為「1.2.」這類
  // 多層編號），而這串數字的前面是字串開頭、空白或標點——也就是數字自己起頭。
  // 數字前面緊貼漢字或英數字（「得分98.第二名」「成立於2003.後來」）＝句子以數字收尾，
  // 照舊轉全形。只管「句點後接 CJK」這條；「CJK 後接句點」那條的前一字不是數字、不受影響
  const LIST_NUMBER_HEAD_RE = /(?:^|[^A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff])(?:\d{1,3}\.)*\d{1,3}$/;
  function isListNumberDot(str, dotIdx) {
    return LIST_NUMBER_HEAD_RE.test(str.slice(Math.max(0, dotIdx - 24), dotIdx));
  }

  function fullwidthPunct(s) {
    return s
      .replace(PUNCT_RE_CJK_BEFORE, (m, cjk, p) => cjk + PUNCT_MAP[p])
      .replace(PUNCT_RE_CJK_AFTER, (m, p, offset, str) =>
        (p === '.' && isListNumberDot(str, offset)) ? m : PUNCT_MAP[p])
      .replace(PAREN_OPEN_RE, '$1（')
      .replace(PAREN_CLOSE_RE, '$1）');
  }

  // v3.7.11：全形標點前的空白收掉（zh 維基「…先聲[16]」後的句號單獨折到下一行；Jimmy
  // 2026-11-27 裁定查根因後依最佳解處理）。根因是原始碼在行內元素與標點之間留了換行
  //（`</sup>\n。`），渲染成一格空白、又是可斷行點——「。」可以被單獨折到下一行，不折也多
  // 一格空。語料庫普查同型 46 處／12 頁，多半是翻譯後頁面（譯文在 <a>／<strong>／<code>
  // 後面留空白再接「，」「。」）。全形標點本身帶字面留白，前面的空白一律收掉（只在 Pangu
  // 開著時；行首縮排之類的前導空白後面不是全形標點，不受影響）
  const PANGU_SPACE_BEFORE_FW_PUNCT_RE = /[ \t\n\r\f]+(?=[，。、；：！？）」』】〕》〉])/g;

  function panguize(s) {
    // 階段一：strict CJK boundary 標點全形化。
    // 標點轉全形後不再進 PANGU_LEAD/TRAIL 字元類，避免重複觸發補空白
    // （例如 `他說(嘿嘿)` → `他說（嘿嘿）` 後 pangu 不動）。
    // 混合情境（中文後接 ASCII 括號）標點保半形，由 pangu 補空白。
    let out = fullwidthPunct(s);
    // 階段二：text node 整體含 CJK boundary → 寬鬆模式，剩餘 ASCII↔ASCII 邊界
    // 的半形逗號也轉全形。
    if (PUNCT_BOUNDARY_CJK_RE.test(s)) {
      // 千分位分隔逗號（兩側都是數字，如 3,610 / 3,610,000）保半形——這是數字
      // 格式不是中文標點，轉全形會變成 `3，610` 明顯錯誤（Jimmy 2026-06-03 回報）。
      // 只轉「非數字夾住」的逗號：`(?<!\d),`（前非數字）或 `,(?!\d)`（後非數字），
      // 兩條件都不成立（=前後皆數字）才視為千分位、保半形。
      out = out.replace(/(?<!\d),|,(?!\d)/g, '，');
    }
    return out
      .replace(PANGU_RE_CJK_ALNUM, '$1 $2')
      .replace(PANGU_RE_ALNUM_CJK, '$1 $2')
      .replace(PANGU_SPACE_BEFORE_FW_PUNCT_RE, '');
  }

  // 從 text node 沿 parent 鏈走到 articleEl，判斷是否落在跳過 tag / contenteditable 內
  function panguShouldSkipNode(textNode, articleEl) {
    let p = textNode.parentElement;
    while (p && p !== articleEl.parentElement) {
      if (PANGU_SKIP_TAGS.has(p.tagName)) return true;
      const ce = p.getAttribute && p.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return true;
      if (p === articleEl) break;
      p = p.parentElement;
    }
    return false;
  }

  // 走訪 articleEl 下所有可見 text node、套 pangu 規則。改動的 node 連同原值
  // 紀錄回傳 array，供 restore 還原。對 ROOT 為 element 或 text node 都接。
  function panguApplyToTree(root, articleEl, changes) {
    const doc = articleEl.ownerDocument;
    if (root.nodeType === 3) {
      if (!/\S/.test(root.nodeValue)) return;
      if (panguShouldSkipNode(root, articleEl)) return;
      const before = root.nodeValue;
      const after = panguize(before);
      if (after !== before) {
        changes.push({ node: root, original: before });
        root.nodeValue = after;
      }
      return;
    }
    if (root.nodeType !== 1) return;
    // root element 自己若是 skip tag → 整棵跳過
    if (PANGU_SKIP_TAGS.has(root.tagName)) return;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (panguShouldSkipNode(node, articleEl)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      const before = n.nodeValue;
      const after = panguize(before);
      if (after !== before) {
        changes.push({ node: n, original: before });
        n.nodeValue = after;
      }
    }
  }

  // apply 入口：對 articleEl 一次性掃完 + 起 MutationObserver 接後續注入內容
  // （SPA / lazy-load 的留言、推薦、後到段落）。回傳 snapshot 供 restore。
  function panguInstall(articleEl) {
    const changes = [];
    panguApplyToTree(articleEl, articleEl, changes);

    // MutationObserver 只觀察 childList + subtree，避免 nodeValue 自寫又觸發
    // characterData 回環。原站若後續改既有 text node 的內容，本輪不重套——
    // 等下一次 reader mode 進入時會重新處理。
    const obs = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          panguApplyToTree(node, articleEl, changes);
        }
      }
    });
    obs.observe(articleEl, { childList: true, subtree: true });
    return { changes, observer: obs };
  }

  // restore：先停 observer、把 changes 內的 text node 還原為原值。已 detach
  // 的 node（site JS 移走的）跳過——還原也無意義。
  function panguRestore(snapshot) {
    if (!snapshot) return;
    if (snapshot.observer) {
      try { snapshot.observer.disconnect(); } catch {}
    }
    if (Array.isArray(snapshot.changes)) {
      for (const c of snapshot.changes) {
        if (!c || !c.node) continue;
        // 只有 nodeValue 仍為 panguize 過的字串才還原，避免覆蓋原站之後改動
        const after = panguize(c.original);
        if (c.node.nodeValue === after) {
          c.node.nodeValue = c.original;
        }
      }
    }
  }

  // v2.5.24：首字重排 / 首行歸回的 CSS。獨立一張 stylesheet、只在量到站方有
  // ::first-letter / ::first-line 規則的頁面才注入（markDropCapBlocks）——主 CSS
  // 不帶任何 pseudo 的 font-* 宣告，沒有站方首字規則的頁面完全不受影響
  const PSEUDO_SHAPE_STYLE_ID = '__jread-pseudo-shape-style';
  // v2.5.24：一般網站的圖說樣式（見 buildCss 的 captionOnly）
  const CAPTION_STYLE_ID = '__jread-caption-style';
  function buildPseudoShapeCss() {
    return `
/* v2.5.24：站方放大首字重排（DROP_CAP_ATTR，JS 量測標記，見 dropCapPlan）。
   站方首字的字級 / 行高 / 上下 margin 是 px、按站方自己的段落行高校準的；閱讀模式
   把段落改成設定的字級與行高後，首字的 float 框與旁邊的行數對不上，墨跡壓到下一行
   （grubstreet 譯文：97px 的「最」塞在 58px 行高的框裡，蓋住第 4 行行首；
   telefoncek 原文：121px 的 N 塞在 70px 的框）。CJK 字佔滿整個字框（拉丁大寫只佔
   約 0.7em），站方按拉丁大寫調的框一定裝不下。
   修法：首字框改成剛好 N 行高（lh 單位以段落自己的行高解析，使用者改字級 / 行距
   自動跟著變）；上下 margin / padding 歸零（站方的負 margin 就是讓下一行鑽進來的
   來源），左右留站方值。只套在量到「墨跡會壓到下一行」的首字，排得好的不動。 */
${[2, 3, 4, 5].map((n) => `[${ARTICLE_ATTR}="1"] [${DROP_CAP_ATTR}="c${n}"]::first-letter,
[${ARTICLE_ATTR}="1"][${DROP_CAP_ATTR}="c${n}"]::first-letter {
  font-size: calc(${n}lh - 2px) !important;
  line-height: 1 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
[${ARTICLE_ATTR}="1"] [${DROP_CAP_ATTR}="l${n}"]::first-letter,
[${ARTICLE_ATTR}="1"][${DROP_CAP_ATTR}="l${n}"]::first-letter {
  font-size: calc((${n}lh - 2px) / 0.8) !important;
  line-height: 0.8 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}`).join('\n')}
/* v3.7.7：放大首字的框線與框內距拿掉（DROP_CAP_FRAME_ATTR），字級、float、左右 margin 留站方值 */
[${ARTICLE_ATTR}="1"] [${DROP_CAP_FRAME_ATTR}="1"]::first-letter,
[${ARTICLE_ATTR}="1"][${DROP_CAP_FRAME_ATTR}="1"]::first-letter {
  border: 0 !important;
  border-radius: 0 !important;
  padding: 0 !important;
}
/* 'off'：CJK 首字前後帶標點（譯文以「《」「「」開頭）時，::first-letter 依規格連
   標點一起選進去，兩個全形字一起放大。拆不開（pseudo 沒辦法只選一個字），整個取消。 */
[${ARTICLE_ATTR}="1"] [${DROP_CAP_ATTR}="off"]::first-letter,
[${ARTICLE_ATTR}="1"][${DROP_CAP_ATTR}="off"]::first-letter {
  float: none !important;
  font-size: inherit !important;
  line-height: inherit !important;
  font-family: inherit !important;
  font-weight: inherit !important;
  font-style: inherit !important;
  letter-spacing: inherit !important;
  text-transform: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: none !important;
  initial-letter: normal !important;
  -webkit-initial-letter: normal !important;
}
/* v2.5.24：站方 ::first-line 樣式歸回段落本身（FIRST_LINE_ATTR，見 firstLineDiverges）。
   ::first-line 是獨立 pseudo，閱讀模式對段落的字體 / 字級 / 文字色覆寫都選不到它：
   telefoncek 首行留著站方的無襯線體、2px 字距與灰字，譯成中文後每個字被拉開，
   深色主題下灰字貼近底色。與上面首字色同一類（pseudo 不吃主題）。 */
[${ARTICLE_ATTR}="1"] [${FIRST_LINE_ATTR}="1"]::first-line,
[${ARTICLE_ATTR}="1"][${FIRST_LINE_ATTR}="1"]::first-line {
  font-family: inherit !important;
  font-size: inherit !important;
  font-weight: inherit !important;
  font-style: inherit !important;
  font-variant: inherit !important;
  letter-spacing: inherit !important;
  word-spacing: inherit !important;
  text-transform: inherit !important;
  color: inherit !important;
  -webkit-text-fill-color: currentColor !important;
}
`;
  }

  // ===== v1.6.30（#13）:has 放大器的 JS 標記端（見檔頭 v1.6.30 不變式註解）=====
  // aspect 容器（placeholder / ratio / object-fit class）內含 iframe = responsive
  // 影片嵌入 → 標 EMBED_WRAP_ATTR 豁免 static-flow 配套（v0.8.155 語意）。
  // 已標過的跳過（idempotent，動態 remark 重跑安全）；新標的 push 進 marked
  // 供 restore 移除。
  const EMBED_WRAP_CANDIDATE_SEL =
    '[class*="placeholder" i], [' + RATIO_CLASS_ATTR + '="1"], [class*="object-fit" i]';
  // v1.8.2：lazy 影片嵌入的 aspect 佔位框偵測（iframe 尚未 mount）。
  // 結構訊號（硬規則 3，非站點 / class 特判）——「padding hack 佔位框」四件套：
  //   1. 垂直 padding（top + bottom）撐出 > 40px 的高度
  //   2. content box 高度 ≈ 0（高度全部來自 padding，即 height:0 + padding%）
  //   3. overflow hidden / clip（原站靠這個把 absolute 子裁進佔位框）
  //   4. 子樹內有媒體（縮圖），且無 iframe（有 iframe 走既有 embed 路徑）
  // 命中 = 原站「容器撐 aspect 框 + 內容 absolute 填滿」的 responsive embed，
  // 只是播放器尚未 mount。reader 的 static-flow 配套會把內容打回 flow → 落進
  // 高度 0 的 content box → 被 overflow 整個裁掉（影片框只剩空白）。
  // v1.8.2：::before / ::after aspect 佔位的 padding 門檻（見 passAspectPseudoReset）
  const ASPECT_PSEUDO_MIN_PAD = 40;
  // v1.8.4：標題 pseudo 純間距佔位的淨垂直高度門檻（height + 上下 margin）。
  // 12px 以下是站方的細部間距微調（reader 內看不出來、動了反而風險大於收益）；
  // nytimes 那條淨佔位 41px。負 margin 相消的 anchor-offset hack（height:80px;
  // margin-top:-80px）淨值 0，自動落在門檻外、不會被動到。
  const HEADING_SPACER_MIN_NET = 12;
  // 子樹掃描上限：候選容器是 class 含 placeholder / ratio / object-fit 的
  // wrapper，正常 embed 子樹極小（個位數元素）。超過此數幾乎必是把整個版面
  // 包進來的 layout 容器，掃它只是白花 getComputedStyle。
  const LAZY_FRAME_MAX_SUBTREE = 80;
  function findLazyEmbedFrame(root) {
    const win = root.ownerDocument && root.ownerDocument.defaultView;
    if (!win || !win.getComputedStyle) return null;
    if (!NS || typeof NS.isAspectPlaceholderFrame !== 'function') return null;
    const els = root.querySelectorAll('*');
    if (els.length > LAZY_FRAME_MAX_SUBTREE) return null;
    for (const el of els) {
      if (el.getAttribute(PLAYER_ATTR) === '1') continue;
      // 佔位框判定的單一資料源在 NS（cleaner 的播放鍵豁免共用同一把尺）
      if (NS.isAspectPlaceholderFrame(el)) return el;
    }
    return null;
  }
  // 2026-10-07 review B-01：class 帶 ratio token 的容器標 RATIO_CLASS_ATTR（見
  // 常數註解）。純 classList 比對、不量 layout；scopeEl（選填）給動態補標只掃
  // 新增子樹（含自身）。必須在 passSetArticleAttr **之前**跑：attr-keyed CSS
  // 與 ARTICLE_ATTR 同刻生效，與原 class 子字串選擇器的時序一致（後續
  // passMarkPlayers / passMarkFillIframes 的 computed 量測依賴這些規則已套）。
  function markRatioClassBoxes(articleEl, marked, scopeEl) {
    const root = scopeEl || articleEl;
    const els = (root.matches && root.matches('[class*="ratio" i]'))
      ? [root, ...root.querySelectorAll('[class*="ratio" i]')]
      : root.querySelectorAll('[class*="ratio" i]');
    for (const el of els) {
      if (el.getAttribute(RATIO_CLASS_ATTR) === '1') continue;
      const list = el.classList;
      if (!list || !list.length) continue;
      let hit = false;
      for (const c of list) { if (RATIO_CLASS_TOKEN_RE.test(c)) { hit = true; break; } }
      if (!hit) continue;
      el.setAttribute(RATIO_CLASS_ATTR, '1');
      marked.push(el);
    }
  }
  // 2026-10-07 review B-16：lazy 佔位框內「非媒體、自帶 background-image（元素本身
  // 或 ::before / ::after）」的子元素＝站方畫在縮圖上的播放鍵 / 疊層（WP Rocket
  // `.play` 的 background:url(play.png)、或 ::before 畫三角）。v1.8.2 保住了縮圖與
  // 定位，但全後代 bg strip（`*:not([PLAYER]) { background-image:none }` 與 pseudo
  // 同款）照樣把圖示清掉——縮圖上沒有任何「這是影片」的提示（pansci live probe：
  // button.play 617×347 bg url(…play.png) → 進場後 none）。修法走 v1.9.15 同一機制：
  // 標 SITE_UI_ATTR="embed-ui" + PLAYER_ATTR，吃既有的 :not([PLAYER]) 豁免。
  // 判定要看站方原意：ARTICLE_ATTR 已就位、strip 規則生效後量到的 bg 永遠是 none，
  // 故用 NS.withInjectedCssDisabled 暫停注入樣式再量（同一 JS task、不 paint；
  // 只在真的有 lazy 佔位框時才付這筆 recalc）。範圍只限 findLazyEmbedFrame 命中的
  // 佔位框子樹（≤ LAZY_FRAME_MAX_SUBTREE 元素），框外任何裝飾 bg 照舊清。
  const EMBED_UI_SKIP_TAG_RE = /^(?:IMG|PICTURE|SOURCE|VIDEO|AUDIO|SVG|IFRAME|CANVAS)$/i;
  function markLazyEmbedUi(frames, uiMarked) {
    if (!frames.length || !Array.isArray(uiMarked)) return;
    const doc = frames[0].ownerDocument;
    const _win = doc && doc.defaultView;
    if (!_win || !_win.getComputedStyle) return;
    const cands = [];
    for (const frame of frames) {
      for (const el of NS.selfAndDescendants(frame, '*')) {
        if (EMBED_UI_SKIP_TAG_RE.test(el.tagName)) continue;
        if (el.hasAttribute(SITE_UI_ATTR) || el.getAttribute(PLAYER_ATTR) === '1') continue;
        cands.push(el);
      }
    }
    if (!cands.length) return;
    const bgOf = (el, pseudo) => {
      try {
        const cs = _win.getComputedStyle(el, pseudo || null);
        return cs ? (cs.backgroundImage || 'none') : 'none';
      } catch (e) {
        if (e && e.name === 'SyntaxError') return 'none';
        throw e;
      }
    };
    const measure = () => {
      const hits = [];
      for (const el of cands) {
        if (bgOf(el) !== 'none' || bgOf(el, '::before') !== 'none' || bgOf(el, '::after') !== 'none') hits.push(el);
      }
      return hits;
    };
    const hits = (NS && NS.withInjectedCssDisabled) ? NS.withInjectedCssDisabled(measure) : measure();
    for (const el of hits) {
      el.setAttribute(SITE_UI_ATTR, 'embed-ui');
      el.setAttribute(PLAYER_ATTR, '1');
      uiMarked.push(el);
    }
  }
  // v2.5.18：背景圖影片佔位殼（NS.findBgFacadeFrame，<lite-youtube> 這類）的殼與
  // 播放鍵保留站方配色——縮圖是殼的 background-image、播放圖示是按鈕的
  // background-image、標題漸層畫在殼的 ::before，全後代 bg strip 與 pseudo strip
  // 會把三樣一起清掉。走 markLazyEmbedUi 同一機制：標 SITE_UI_ATTR="embed-ui" +
  // PLAYER_ATTR，吃既有的 :not([PLAYER]) 豁免。候選只有「cleaner 沒藏掉的按鈕」
  //（按鈕一律清之後所剩無幾），判定與 cleaner 的播放鍵豁免同一把尺。
  // 幾何與背景都要量站方原值：ARTICLE_ATTR 就位後殼的背景被 strip 成 none、播放鍵的
  // 寬高被單欄正規化壓成一條線（真站實測 383×215 → 383×2），兩道 gate 都會落空——
  // 整段判定包進 NS.withInjectedCssDisabled（同一個 JS task、不 paint；只有還有
  // 沒被藏掉的按鈕時才付這筆 recalc）。
  // scopeEl（選填）：dynamic path 只掃新增子樹（含自身）。
  function markBgFacadeUi(articleEl, uiMarked, scopeEl) {
    if (!Array.isArray(uiMarked)) return;
    if (!NS || typeof NS.findBgFacadeFrame !== 'function') return;
    const root = scopeEl || articleEl;
    const btns = [];
    for (const btn of NS.selfAndDescendants(root, NS.FACADE_BTN_SEL)) {
      if (btn.dataset && btn.dataset.jreadHidden === '1') continue;
      if (btn.getAttribute(PLAYER_ATTR) === '1') continue;
      btns.push(btn);
    }
    if (!btns.length) return;
    const measure = () => {
      const pairs = [];
      for (const btn of btns) {
        const frame = NS.findBgFacadeFrame(btn);
        if (frame) pairs.push([frame, btn]);
      }
      return pairs;
    };
    const pairs = NS.withInjectedCssDisabled ? NS.withInjectedCssDisabled(measure) : measure();
    for (const pair of pairs) {
      // v2.5.19：殼另標 FACADE_FRAME_ATTR（翻頁模式不跨頁用）。已被別條標成 site-ui
      // 的殼也要標——下面的 continue 只是不重複登記還原
      if (!pair[0].hasAttribute(FACADE_FRAME_ATTR)) {
        pair[0].setAttribute(FACADE_FRAME_ATTR, '1');
        if (pair[0].hasAttribute(SITE_UI_ATTR) || pair[0].getAttribute(PLAYER_ATTR) === '1') uiMarked.push(pair[0]);
      }
      for (const el of pair) {
        if (el.hasAttribute(SITE_UI_ATTR) || el.getAttribute(PLAYER_ATTR) === '1') continue;
        el.setAttribute(SITE_UI_ATTR, 'embed-ui');
        el.setAttribute(PLAYER_ATTR, '1');
        uiMarked.push(el);
      }
    }
  }
  function markEmbedWrapIframes(articleEl, marked, fillMarked, uiMarked) {
    const lazyFrames = [];
    for (const el of articleEl.querySelectorAll(EMBED_WRAP_CANDIDATE_SEL)) {
      if (el.getAttribute(EMBED_WRAP_ATTR) === '1') continue;
      if (el.querySelector('iframe')) {
        el.setAttribute(EMBED_WRAP_ATTR, '1');
        marked.push(el);
        continue;
      }
      // v1.8.2：iframe 尚未 mount 的 lazy 影片嵌入也豁免 static-flow 配套
      // ——佔位框 / play 按鈕維持原站定位，框內縮圖另標 EMBED_FILL_ATTR 蓋掉
      // 全域「媒體本體 position:static」（見該 CSS 規則註解）。
      const frame = findLazyEmbedFrame(el);
      if (!frame) continue;
      const applied = [];
      // collapse guard 的基準：標記生效前的佔位框尺寸（見下方 guard）
      const frameBefore = frame.getBoundingClientRect();
      el.setAttribute(EMBED_WRAP_ATTR, '1');
      marked.push(el);
      applied.push([el, EMBED_WRAP_ATTR]);
      if (!fillMarked) continue;
      // 佔位框到 aspect 容器之間的中繼 wrapper：block + width:auto（見
      // EMBED_FLOW_ATTR 規則註解——縮圖抽離 flow 後這段鏈會 shrink 成 0 寬）
      for (let anc = frame.parentElement; anc && anc !== el; anc = anc.parentElement) {
        if (anc.getAttribute(EMBED_FLOW_ATTR) === '1') continue;
        anc.setAttribute(EMBED_FLOW_ATTR, '1');
        fillMarked.push(anc);
        applied.push([anc, EMBED_FLOW_ATTR]);
      }
      for (const media of frame.querySelectorAll('img, video')) {
        if (media.getAttribute(EMBED_FILL_ATTR) === '1') continue;
        media.setAttribute(EMBED_FILL_ATTR, '1');
        fillMarked.push(media);
        applied.push([media, EMBED_FILL_ATTR]);
      }
      // collapse guard（與 ratioBoxes / fixedHeightBoxes 同精神）：標記後佔位框
      // 若「本來有尺寸、現在塌成 0」（寬度來源不只中繼 wrapper 一條、或站點結構
      // 不同於預期）→ 整組撤回，寧可維持原本的破版也不要整塊影片框消失。
      // getBoundingClientRect 同步 flush 新 layout，量到的是標記生效後的結果。
      // 比對 before/after 而非只看 after：無 layout 的環境（jsdom）兩者皆 0，
      // 不會誤判成塌陷。
      const frameAfter = frame.getBoundingClientRect();
      if ((frameBefore.width > 1 && frameAfter.width <= 1) ||
          (frameBefore.height > 1 && frameAfter.height <= 1)) {
        for (const [node, attr] of applied) {
          node.removeAttribute(attr);
          const arr = attr === EMBED_WRAP_ATTR ? marked : fillMarked;
          const idx = arr.lastIndexOf(node);
          if (idx >= 0) arr.splice(idx, 1);
        }
        continue;
      }
      lazyFrames.push(frame);
    }
    // 2026-10-07 review B-16：佔位框內的播放鍵 / 疊層保留站方 bg（見 markLazyEmbedUi）
    markLazyEmbedUi(lazyFrames, uiMarked);
  }
  // 包住 heading 的 <a>（<a><h1>…</h1></a> permalink 形）→ 標 HEADING_LINK_ATTR
  // 讓連結色規則回退 inherit（v0.8.129 語意）。掃描範圍：articleEl 子樹 +
  // promoted-outside 標題 clone（v0.8.131 放 articleEl 外，cleaner 在 styler
  // apply 之前建立，此時已存在）。
  // v1.7.44 E11：scopeEl（選填）——dynamic path 只掃新增子樹。原本
  // remarkDynamicMarkers 對任何新 <a> 都全 article + promoted-outside 重掃；
  // apply() 靜態 path 不傳 scopeEl、行為不變。scopeEl 自身是 <a> 時一併檢查
  // （querySelectorAll 不含自身）。
  function markHeadingLinks(articleEl, marked, scopeEl) {
    const scopes = scopeEl
      ? [scopeEl]
      : [articleEl, ...document.querySelectorAll('[data-jread-promoted-outside="1"]')];
    for (const scope of scopes) {
      const anchors = (scope.matches && scope.matches('a'))
        ? [scope, ...scope.querySelectorAll('a')]
        : scope.querySelectorAll('a');
      for (const a of anchors) {
        if (a.getAttribute(HEADING_LINK_ATTR) === '1') continue;
        if (a.querySelector('h1,h2,h3,h4,h5,h6')) {
          a.setAttribute(HEADING_LINK_ATTR, '1');
          marked.push(a);
        }
      }
    }
  }
  // v1.7.45：absolute / fixed 定位元素標 ABS_ANCHOR_ATTR，豁免全域 left/right:auto
  // inset 清除（規則與動機見 buildCss 該規則註解）。必須在 ARTICLE_ATTR 設定**後**
  // 量（與 FILL_IFRAME 同精神）：媒體類子樹已被 reader 規則打回 static、量到
  // static 不標、照舊清；只豁免「reader CSS 未動其定位、仍 absolute/fixed」的
  // 元素（這些元素的 left/right 是錨點、不是 relative 視覺偏移 hack）。
  // 讀寫分離：先整輪量 computed、再整輪 setAttribute（避免 layout thrash）。
  // scopeEl（選填）：dynamic path 只掃新增子樹（含自身）；靜態 path 掃 articleEl
  // 後代 + promoted-outside 標題 clone（比照 markHeadingLinks 的掃描範圍）。
  function markAbsAnchors(articleEl, marked, scopeEl) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    if (!_win || !_win.getComputedStyle) return;
    const scopes = scopeEl
      ? [scopeEl]
      : [articleEl, ...articleEl.ownerDocument.querySelectorAll('[data-jread-promoted-outside="1"]')];
    const found = [];
    for (const scope of scopes) {
      const els = scope === articleEl
        ? scope.querySelectorAll('*')
        : NS.selfAndDescendants(scope, '*'); // 2026-10-07 review C-10：不 spread
      for (const el of els) {
        if (el.getAttribute(ABS_ANCHOR_ATTR) === '1') continue;
        // 只吞 SyntaxError：jsdom（nwsapi）對站點 <style> 內 parse 不了的 selector
        // 會讓 getComputedStyle 丟 SyntaxError（真瀏覽器不會）——該元素跳過即可。
        // 其他錯誤照拋，維持 apply「中途炸掉 → rollback + rethrow」語意
        // （enter-pipeline-rollback.spec 毒針 forcing）
        let pos = '';
        try {
          pos = _win.getComputedStyle(el).position;
        } catch (e) {
          if (e && e.name === 'SyntaxError') continue;
          throw e;
        }
        if (pos === 'absolute' || pos === 'fixed') found.push(el);
      }
    }
    for (const el of found) {
      el.setAttribute(ABS_ANCHOR_ATTR, '1');
      marked.push(el);
    }
  }
  // v2.5.24：站方 float 的文字方塊標 DEFLOAT_TEXT_ATTR（CSS 把寬度改回 auto）。
  // 場景：雜誌類站點把補充說明 / 拉出的引文做成 float 在內文旁的方塊、釘固定寬
  //（quantamagazine `aside.post__aside--right`：float right、width 335px）。閱讀模式
  // 清掉 float 後寬度還在 → 一段只有半欄寬（語料庫 quantamagazine 截圖，2026-11-18）。
  // 判定（全部成立才標）：
  //   1. 在閱讀模式下看得到，寬度比父層窄（v3.7.7 前要不到父層七成）
  //   2. 是文字方塊：文字 >= DEFLOAT_TEXT_MIN_CHARS，裡面沒有媒體 / 表格 / 程式碼
  //     （float 的縮圖框、資訊框的窄寬是跟著圖或表格走的，不動）
  //   3. 站方 cascade 下（停用注入 CSS 再量）computed float 是 left / right
  //      ——窄是 float 版面留下來的，不是別的原因（格狀卡片的欄寬等）
  // 巢狀命中只標最外層。先用幾何篩（條件 1、2，layout 是乾淨的、只讀 rect），剩下的
  // 少數候選才付一次 withInjectedCssDisabled。
  // 這條驗 X、不驗 Y：只做進場當下這一次，晚插入的方塊不補標；站方不是用 float
  //（absolute、grid 欄）排的窄方塊不在此列。
  function markDefloatedTextBoxes(articleEl, marked) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    if (!_win || !_win.getComputedStyle || !NS.withInjectedCssDisabled) return;
    const cands = [];
    for (const el of articleEl.querySelectorAll(DEFLOAT_TEXT_SEL)) {
      const par = el.parentElement;
      if (!par) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      const pr = par.getBoundingClientRect();
      // v3.7.7：不再要求「不到父層七成」，比父層窄就算（quantamagazine 430 寬：方塊 335px、
      // 父層 392px，超過七成沒撐滿、右邊留 57px；Jimmy 2026-11-27 裁定「站方是 float 就撐滿版心」）。
      // 窄是不是 float 留下來的，交給下面停用注入樣式後量的條件 3
      if (!(pr.width > 0) || r.width >= pr.width - 1) continue;
      if (el.closest(`[data-jread-hidden="1"], table, figure, [${BYLINE_ATTR}], [${KICKER_ATTR}]`)) continue;
      if (el.querySelector(DEFLOAT_TEXT_BLOCKER_SEL)) continue;
      if ((el.textContent || '').trim().length < DEFLOAT_TEXT_MIN_CHARS) continue;
      cands.push(el);
    }
    if (!cands.length) return;
    const readFloated = () => cands.filter((el) => {
      let f = '';
      try {
        f = _win.getComputedStyle(el).float;
      } catch (e) {
        if (e && e.name === 'SyntaxError') return false; // jsdom nwsapi 既知行為，同 markAbsAnchors
        throw e;
      }
      return f === 'left' || f === 'right';
    });
    const hits = NS.withInjectedCssDisabled(readFloated) || [];
    for (const el of hits) {
      if (hits.some((o) => o !== el && o.contains(el))) continue;
      el.setAttribute(DEFLOAT_TEXT_ATTR, '1');
      marked.push(el);
    }
  }
  // v3.7.8：前一個或後一個元素兄弟看得到、而且是 inline 層級（清水平內距 pass 的 inline 豁免用）
  function hasInlineSibling(win, el) {
    for (const sib of [el.previousElementSibling, el.nextElementSibling]) {
      if (!sib) continue;
      let d = '';
      try { d = win.getComputedStyle(sib).display || ''; } catch (_) { continue; }
      if (/^inline/.test(d) && (sib.textContent || '').trim()) return true;
    }
    return false;
  }
  // v3.7.7：元素的 ::before / ::after 是不是畫在左 / 右內距裡的絕對定位圖示（見上方清水平
  // 內距 pass 的註解）。content 不是 none / normal / 空字串、position absolute，水平位置
  // （left 或 right，px）落在那側內距之內
  function pseudoIconLane(win, el, pl, pr) {
    const out = { left: false, right: false };
    for (const ps of ['::before', '::after']) {
      let c;
      try { c = win.getComputedStyle(el, ps); } catch (_) { continue; }
      if (!c || c.position !== 'absolute') continue;
      const ct = c.content || '';
      if (!ct || ct === 'none' || ct === 'normal' || ct === '""' || ct === "''") continue;
      const l = parseFloat(c.left), r = parseFloat(c.right);
      if (pl > 0.5 && isFinite(l) && l >= 0 && l < pl) out.left = true;
      if (pr > 0.5 && isFinite(r) && r >= 0 && r < pr && !isFinite(l)) out.right = true;
    }
    return out;
  }
  // v3.7.7：外側項目符號放不下的清單（requests 430 寬，語料庫 KNOWN-ISSUES 第二節）。
  // 全部成立才標：清單看得到、list-style-position 是 outside、第一個看得到的 li 是 list-item 且
  // list-style-type 不是 none；清單＋li 在 inline-start 側的 margin＋padding 加總不到 li 字級的
  // 0.9 倍（放不下一個圓點，圓點掛到文字欄外面）。普查 182 頁 × 1280 / 430 寬只有 requests
  // 430 寬（原文、翻譯後）命中
  const LIST_INDENT_MIN_EM = 0.9;
  function markListMarkerIndent(articleEl, marked) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    if (!_win || !_win.getComputedStyle) return;
    const px = (v) => parseFloat(v) || 0;
    for (const u of articleEl.querySelectorAll('ul, ol')) {
      if (u.closest('[data-jread-hidden="1"]')) continue;
      let cs, li = null, lcs;
      try {
        if (!u.getClientRects().length) continue;
        cs = _win.getComputedStyle(u);
        if (cs.listStylePosition !== 'outside') continue;
        for (const c of u.children) { if (c.tagName === 'LI' && c.getClientRects().length) { li = c; break; } }
        if (!li) continue;
        lcs = _win.getComputedStyle(li);
      } catch (e) {
        if (e && e.name === 'SyntaxError') continue;
        throw e;
      }
      if (lcs.display !== 'list-item' || lcs.listStyleType === 'none') continue;
      const rtl = cs.direction === 'rtl';
      const side = rtl ? 'Right' : 'Left';
      const ind = px(cs['padding' + side]) + px(cs['margin' + side]) + px(lcs['padding' + side]) + px(lcs['margin' + side]);
      if (ind >= px(lcs.fontSize) * LIST_INDENT_MIN_EM) continue;
      u.setAttribute(LIST_INDENT_ATTR, '1');
      marked.push(u);
    }
  }
  // v3.7.7：站方 pseudo 寫的操作提示字（thewoksoflife 食譜卡份量鈕旁 `::after { content: "Tap or
  // hover # to scale" }`，語料庫 KNOWN-ISSUES 第二節）。閱讀模式沒有那個互動，提示字是雜訊；
  // pseudo 不在 DOM 裡，cleaner 藏不到。
  // 做法：走一遍站方樣式表（跨網域讀不到的跳過），規則的 selector 帶 ::before / ::after、
  // content 是 UI_HINT_RE 字樣的字串 → 拿掉 pseudo 部分的 selector 在主文裡找元素標記，CSS
  // content: none。字樣：tap / click / hover / swipe（整字）或「點擊／點按／輕觸／滑動」，
  // 字串 ≤ 60 字。pseudo 字串不會被翻譯，原文、翻譯後一致
  const UI_HINT_RE = /\b(?:tap|click|hover|swipe)\b|點擊|點按|輕觸|滑動/i;
  const UI_HINT_MAX_LEN = 60;
  function markUiHintPseudo(articleEl, marked) {
    const doc = articleEl.ownerDocument;
    if (!doc || !doc.styleSheets) return;
    const hits = []; // [baseSelector, 'before' | 'after']
    const walk = (rules) => {
      for (const r of rules) {
        const sel = r.selectorText || '';
        if (sel && /:(?::)?(?:before|after)\b/.test(sel) && r.style) {
          const c = r.style.getPropertyValue('content') || '';
          const m = /^\s*(["'])([\s\S]*)\1\s*$/.exec(c);
          if (m && m[2].length <= UI_HINT_MAX_LEN && UI_HINT_RE.test(m[2])) {
            for (const part of sel.split(',')) {
              const pm = /:(?::)?(before|after)\b/.exec(part);
              if (!pm) continue;
              const base = part.replace(/:(?::)?(?:before|after)\b/g, '').trim();
              if (base && base.indexOf('data-jread') < 0) hits.push([base, pm[1]]);
            }
          }
        }
        if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      }
    };
    for (const sh of doc.styleSheets) {
      let rules = null;
      try { rules = sh.cssRules; } catch (_) { rules = null; }
      if (rules) { try { walk(rules); } catch (_) { /* 單張表失敗不擋其他 */ } }
    }
    for (const [base, which] of hits) {
      let els;
      try { els = articleEl.querySelectorAll(base); } catch (_) { continue; }
      for (const el of els) {
        const prev = el.getAttribute(UI_HINT_PSEUDO_ATTR);
        const v = prev && prev !== which ? 'both' : which;
        el.setAttribute(UI_HINT_PSEUDO_ATTR, v);
        if (!prev) marked.push(el);
      }
    }
  }
  // v3.7.6：通用 `float: none` 的兩種副作用（規則與動機見 buildCss 該規則註解）。站方
  // cascade 的 float 要停用注入樣式才量得到（之後已被 float: none 蓋掉），在 ARTICLE_ATTR
  // 設定後量（同 markDefloatedTextBoxes）。
  //   KEEP：短字（1–KEEP_FLOAT_MAX_CHARS 字）、不含媒體、站方寬度小於父層一半、字級不比
  //         父層大很多（首字放大另有處理）、不在作者列 / kicker
  //   BLOCK：現在是 inline、站方寬度 >= 父層 70%、父層夠寬
  // 這條驗 X、不驗 Y：只看 SITE_FLOAT_SEL 這幾種行內標籤（區塊級的 float 文字方塊歸
  // markDefloatedTextBoxes、媒體 float 本來就該清）；只做進場當下這一次
  function markSiteFloatSideEffects(articleEl, marked) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    if (!_win || !_win.getComputedStyle || !NS.withInjectedCssDisabled) return;
    const gcs = (el) => {
      try { return _win.getComputedStyle(el); } catch (e) {
        if (e && e.name === 'SyntaxError') return null; // jsdom nwsapi 既知行為
        throw e;
      }
    };
    const cands = [];
    for (const el of articleEl.querySelectorAll(SITE_FLOAT_SEL)) {
      if (!el.parentElement) continue;
      if (el.closest(`[data-jread-hidden="1"], [${BYLINE_ATTR}], [${KICKER_ATTR}], [${PLAYER_ATTR}="1"]`)) continue;
      const cs = gcs(el);
      if (!cs || cs.display === 'none') continue;
      cands.push({ el, nowDisplay: cs.display });
    }
    if (!cands.length) return;
    const rows = NS.withInjectedCssDisabled(() => {
      const out = [];
      for (const c of cands) {
        const cs = gcs(c.el);
        if (!cs || (cs.float !== 'left' && cs.float !== 'right')) continue;
        const pcs = gcs(c.el.parentElement);
        const r = c.el.getBoundingClientRect();
        const pr = c.el.parentElement.getBoundingClientRect();
        out.push({ ...c, float: cs.float, w: r.width, pw: pr.width, fs: parseFloat(cs.fontSize) || 0, pfs: pcs ? (parseFloat(pcs.fontSize) || 0) : 0 });
      }
      return out;
    }) || [];
    for (const x of rows) {
      const t = (x.el.textContent || '').trim();
      const blocker = x.el.querySelector(DEFLOAT_TEXT_BLOCKER_SEL + ', svg');
      if (t.length >= 1 && t.length <= KEEP_FLOAT_MAX_CHARS && !blocker && x.w > 0 && x.pw > 0 &&
          x.w < x.pw * KEEP_FLOAT_MAX_WIDTH_RATIO && (!x.pfs || x.fs < x.pfs * KEEP_FLOAT_MAX_FS_RATIO)) {
        x.el.setAttribute(KEEP_FLOAT_ATTR, x.float);
        marked.push(x.el);
      } else if (x.nowDisplay === 'inline' && x.pw >= FLOAT_BLOCK_MIN_PARENT_W && x.w >= x.pw * FLOAT_BLOCK_MIN_WIDTH_RATIO) {
        x.el.setAttribute(FLOAT_BLOCK_ATTR, '1');
        marked.push(x.el);
      }
    }
  }
  // v2.5.14：直向 flex 容器的直接子 <pre> 標 PRE_FLEX_STRETCH_ATTR，豁免媒體置中規則
  // 的左右 auto margin（規則與動機見 buildCss 該規則註解）。在 ARTICLE_ATTR 設定後量
  // parent 的 computed display / flex-direction（翻頁模式把外殼塌成 block 的話量到
  // block、不標，auto margin 本來就解成 0）。只做進場當下這一次，晚到的 <pre> 不補標。
  function markFlexColumnPres(articleEl, marked) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    if (!_win || !_win.getComputedStyle) return;
    const found = [];
    for (const pre of articleEl.querySelectorAll('pre')) {
      const parent = pre.parentElement;
      if (!parent) continue;
      let cs;
      try {
        cs = _win.getComputedStyle(parent);
      } catch (e) {
        if (e && e.name === 'SyntaxError') continue; // jsdom nwsapi 既知行為，同 markAbsAnchors
        throw e;
      }
      if ((cs.display === 'flex' || cs.display === 'inline-flex') &&
          /^column/.test(cs.flexDirection || '')) found.push(pre);
    }
    for (const pre of found) {
      pre.setAttribute(PRE_FLEX_STRETCH_ATTR, '1');
      marked.push(pre);
    }
  }
  // v2.5.23：程式碼區塊往上 CODE_FLEX_CLIMB 層內，遇到「父層是橫向 flex、自己是父層
  // 唯一看得到的子元素」的那一層就標 CODE_FLEX_FILL_ATTR（規則與動機見 buildCss）。
  // 父層有兩個以上看得到的子元素（程式碼＋預覽並排）不標——那是站方的分欄。
  // 只做進場當下這一次
  const CODE_FLEX_CLIMB = 5;
  function markFlexRowCodeShells(articleEl, marked) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    if (!_win || !_win.getComputedStyle) return;
    const gcs = (el) => {
      try { return _win.getComputedStyle(el); } catch (e) {
        if (e && e.name === 'SyntaxError') return null; // jsdom nwsapi 既知行為
        throw e;
      }
    };
    for (const pre of articleEl.querySelectorAll('pre')) {
      if (pre.closest('[data-jread-hidden="1"]')) continue;
      let cur = pre;
      for (let i = 0; i < CODE_FLEX_CLIMB && cur && cur !== articleEl; i++, cur = cur.parentElement) {
        const parent = cur.parentElement;
        if (!parent || !articleEl.contains(parent)) break;
        if (cur.hasAttribute(CODE_FLEX_FILL_ATTR)) break;
        const pcs = gcs(parent);
        if (!pcs) continue;
        if (pcs.display !== 'flex' && pcs.display !== 'inline-flex') continue;
        if (!/^row/.test(pcs.flexDirection || 'row')) continue;
        let visible = 0;
        for (const sib of parent.children) {
          if (sib.getAttribute('data-jread-hidden') === '1') continue;
          const scs = gcs(sib);
          if (scs && scs.display === 'none') continue;
          visible += 1;
          if (visible > 1) break;
        }
        if (visible !== 1) continue;
        cur.setAttribute(CODE_FLEX_FILL_ATTR, '1');
        marked.push(cur);
      }
    }
  }
  // v2.5.23：圖說上方的媒體標 CAP_MEDIA_ATTR、圖說標 CAP_BELOW_ATTR（規則與動機見
  // buildCss 該規則註解）。
  // 「上方的媒體」用文件順序判定、不量尺寸：同一個 figure 內、不在圖說裡、文件順序
  // 排在圖說之前的最後一個媒體元素。lazy 圖還沒載入（高度 0）時照樣標得到，圖載入後
  // 間距就是對的。媒體到「它與圖說的共同容器」之間的包裝（<picture>、<a>、站方的
  // 比例殼）一併標：下邊距常常是掛在包裝上（picture 的 1.5em、pmc 的 p.img-box 17px）。
  // 不標的情況：
  //   - 圖說排在所有媒體之前（圖說在上的版型）→ 沒有「上方的媒體」
  //   - 行內小圖示（INLINE_IMG_ATTR）、播放器（PLAYER_ATTR）、已被 cleaner 藏掉的
  //   - 媒體與圖說之間還隔著別的文字區塊（圖 → 一段說明 → 圖說）：共同容器的直系
  //     分支裡，媒體那一支與圖說那一支之間有帶文字的兄弟
  // 這條驗 X、不驗 Y：這段只認語意上的 <figcaption>；div 圖說由開頭的 findDivCaption 段
  // 處理（v2.5.36），p / span 當圖說的站不處理。只做進場當下這一次，晚插入的 figure 不補標
  const CAP_MEDIA_SEL = 'img, picture, video, svg, canvas, iframe';
  // v2.5.36：用 div 當圖說的站（Jimmy 2026-11-21 回報 cnbc：圖說離圖很遠、沒置中）。
  // cnbc 結構：wrapper > [圖片殼（只有圖）, div > [div 圖說 12px, div 來源 12px]]，
  // 內文 17–18px；v2.5.23 / v2.5.24 的圖說規則只認 <figcaption>，整條沒套到。
  // 判定（全是結構訊號，不看 class）：
  //   1) 大圖：量得到寬度 >= DIV_CAP_MIN_MEDIA_W（擋頭像 / 圖示——作者列的頭像後面也
  //      常跟著小字名字）；圖不在已有 <figcaption> 的 figure 裡（那條走原路）
  //   2) 從圖往上爬（最多 DIV_CAP_MAX_CLIMB 層）：圖那一支沒有字；它後面第一個有字的
  //      兄弟就是候選，候選前面的兄弟沒有字、候選後面的兄弟也沒有字（容器裡只有
  //      「圖 + 一段說明」）；遇到有字但不合格的兄弟就停，不再往上
  //   3) 候選：不含其他媒體、標題、段落級長文（<= DIV_CAP_MAX_LEN 字）、不在作者列；
  //      每一個帶字的元素字級都小於容器字級 × DIV_CAP_FS_RATIO（站方把它排成小字＝
  //      說明文字，不是內文段落）
  // 這條驗 X、不驗 Y：只認「圖在上、小字在下、容器裡沒別的東西」；圖說在圖上方、
  // 與圖說同字級的 div、圖說與圖隔著其他區塊的都不處理。lazy 圖量不到寬度時不處理
  const DIV_CAP_MIN_MEDIA_W = 200;
  const DIV_CAP_MAX_CLIMB = 8;
  // v3.7.6：400 → 600。npr 的圖說殼是「圖說＋攝影署名」一起（470 字）；小字判定仍要過
  const DIV_CAP_MAX_LEN = 600;
  const DIV_CAP_FS_RATIO = 0.9;
  // v2.5.48：主題樣式表裡「套使用者內文字級」那條選擇器（BODY_TEXT_SEL，建樣式表時寫入）。
  // findDivCaption 量字級時，命中它的元素改看最近一個沒命中的祖先（最遠到候選本身）——
  // 那才是站方給的字級。Vanity Fair 實證（Jimmy 2026-11-23 回報圖說沒貼圖、沒縮小）：
  // 圖說 div.CaptionWrapper 站方 13px，字全包在 <span> 裡，span 被 SPAN_TEXT_SEL 拉成
  // 內文 17px → 判成「跟內文一樣大」、不認圖說。候選本身命中（例如候選就是 span）時
  // 照舊用它自己的字級＝不認，保守
  let bodyTextSelInjected = '';
  let bodyTextSelLoose = '';
  // <picture> 不列：從裡面的 <img> 往上爬會經過它（img 自己的下邊距也要歸零——cnbc
  // 的 img 帶 24px margin-bottom，穿出 picture 落在外層殼的 padding 裡）
  const DIV_CAP_MEDIA_SEL = 'img, video, canvas, iframe';
  // 舊快照（登記簿缺席的 jsdom 最小 NS 環境用）
  const capPadPrev = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  // v2.5.37：圖與圖說直接排在主文裡（前後都是內文段落）的站——圖後面緊接的第一個帶字
  // 兄弟，文字跟圖的 alt 一字不差（忽略空白）＝站方拿同一句當替代文字與圖說。upmedia
  // 首圖：div.news-box-text > [img(alt＝圖說), div.mbt-text 圖說, 內文 div…]，圖說字級
  // 與內文同為 17px，靠字級分不出來；Jimmy 2026-11-22 Safari 截圖回報（Chromium 同）。
  // alt 太短（< DIV_CAP_ALT_MIN 字）不認：「photo」「image」這類通用替代文字可能剛好
  // 等於下一行的短標籤
  const DIV_CAP_ALT_MIN = 6;
  const squash = (s) => (s || '').replace(/\s+/g, '');
  // v3.7.6：不算「字」的元素——<script type=application/ld+json> 這類的 textContent 不會畫
  // 出來，卻讓「後面第一個帶字的兄弟」停在它身上（grubstreet：圖與 div 圖說之間夾一段
  // JSON-LD，候選變成 script、字級判定失敗）
  const DIV_CAP_NONTEXT_SEL = 'script, style, noscript, template';
  // 元素看得到的字（扣掉 DIV_CAP_NONTEXT_SEL 子樹）
  function divCapText(e) {
    if (!e || (e.matches && e.matches(DIV_CAP_NONTEXT_SEL))) return '';
    if (!e.querySelector || !e.querySelector(DIV_CAP_NONTEXT_SEL)) return (e.textContent || '').trim();
    let out = '';
    for (const n of e.childNodes) {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.nodeType === 1) out += divCapText(n);
    }
    return out.trim();
  }
  // 回傳 null（不是圖說）或 { cap, common, fontCheck }。fontCheck 存在時還要過字級判定
  //（judgeDivCapFont）——結構判定與字級量測分開，呼叫端才能把整頁的字級量測集中在一次
  // 「停用注入樣式」裡做（每停用一次就是兩次 style recalc）
  function findDivCaption(media, articleEl, win) {
    const txt = divCapText;
    // v3.7.6：站方自己藏起來的兄弟（display:none 的燈箱圖說副本，arstechnica
    // div.pswp-caption-content）不算——它沒畫出來，看得到的圖說在它後面
    // （兄弟的父層看得到，所以只要看兄弟自己是不是 display:none；不用 getClientRects——
    // display:contents 的殼沒有自己的框、裡面的字照樣畫出來）
    const hidden = (e) => {
      if (e.getAttribute && e.getAttribute('data-jread-hidden') === '1') return true;
      if (!win || !win.getComputedStyle) return false;
      try { return win.getComputedStyle(e).display === 'none'; } catch (_) { return false; }
    };
    // 看得到的字：跳過沒畫出來的子孫（同 hidden）
    const visTxt = (e) => {
      if (!e.querySelector || !e.querySelector('*')) return txt(e);
      let out = '';
      for (const n of e.childNodes) {
        if (n.nodeType === 3) out += n.textContent;
        else if (n.nodeType === 1 && !hidden(n) && !n.matches(DIV_CAP_NONTEXT_SEL)) out += visTxt(n);
      }
      return out.trim();
    };
    const candOk = (cand) => {
      if (txt(cand).length > DIV_CAP_MAX_LEN) return false;
      // v3.7.6：<p> 也可以是圖說（telefoncek：`<div><img><p style="font-size:13px">`）；
      // 但只有一段——圖後面跟著段落，要嘛文字等於 alt、要嘛站方把它排成小字，才算
      if (cand.matches('figcaption, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol') ||
          cand.querySelector('h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol, figcaption, ' + DIV_CAP_MEDIA_SEL)) return false;
      if (cand.closest('[' + BYLINE_ATTR + ']') || cand.querySelector('[' + BYLINE_ATTR + ']')) return false;
      // v3.7.6：圖與文字同在一個連結裡＝連結卡片（標題＋說明），不是圖說
      const link = cand.closest('a[href]');
      if (link && link.contains(media)) return false;
      // v3.7.6：「粗體標題段＋說明段」＝卡片（gitbook 快速入門卡片沒包連結，翻頁模式量得到
      // 圖寬就被認成圖說）：候選有兩段以上帶字的子層、第一段的字全在 <strong>／<b> 裡
      const blocks = Array.from(cand.children).filter((c) => !hidden(c) && txt(c));
      if (blocks.length >= 2) {
        const b = blocks[0].querySelector('strong, b') || (blocks[0].matches('strong, b') ? blocks[0] : null);
        if (b && squash(txt(b)) === squash(txt(blocks[0]))) return false;
      }
      // v3.7.6：絕對定位的文字是疊在圖上的署名（bbc「Getty Images」），不是排在圖下的圖說
      if (win && win.getComputedStyle) {
        try { if (/^(?:absolute|fixed)$/.test(win.getComputedStyle(cand).position)) return false; } catch (_) {}
      }
      return true;
    };
    const alt = squash(media.getAttribute && media.getAttribute('alt'));
    let branch = media;
    for (let k = 0; k < DIV_CAP_MAX_CLIMB; k++) {
      const parent = branch.parentElement;
      if (!parent || parent === articleEl || !articleEl.contains(parent)) return null;
      if (visTxt(branch)) return null; // 圖那一支帶字（圖在段落裡）；沒畫出來的字不算（arstechnica 燈箱副本）
      let cand = null;
      let multi = false;
      for (let s = branch.nextElementSibling; s; s = s.nextElementSibling) {
        if (hidden(s) || !txt(s)) continue;
        if (cand) { multi = true; break; }
        cand = s;
      }
      // 圖那一支前面的兄弟有沒有字
      let prevText = false;
      for (let s = branch.previousElementSibling; s; s = s.previousElementSibling) {
        if (!hidden(s) && txt(s)) { prevText = true; break; }
      }
      // v2.5.37 alt 路徑：緊接的第一段字等於 alt → 不管前後還有沒有內文。
      // v3.7.6：候選是 <p> 時例外——內文流裡剛好等於 alt 的段落仍是內文（v2.5.37 對照 3），
      // 只有容器裡就是「圖＋這一段」才算圖說（telefoncek）
      if (cand && alt.length >= DIV_CAP_ALT_MIN && squash(txt(cand)) === alt &&
          !(cand.tagName === 'P' && (prevText || multi))) {
        return candOk(cand) ? { cap: cand, common: parent } : null;
      }
      if (multi) return null; // 第二個帶字的兄弟 → 不是「圖 + 一段說明」
      // 圖那一支前面的兄弟不能有字。v3.7.6 例外：候選緊接在圖那一支後面（中間沒有
      // 別的看得到的兄弟）、又是最後一個帶字的兄弟——arstechnica 頁首把標題、導言、
      // 作者列、首圖、圖說排成同一層兄弟。這條只放行到下面的小字判定，不走 alt 路徑
      let adjacent = false;
      if (prevText && cand) {
        let s = branch.nextElementSibling;
        // 沒畫出來的、沒字也沒媒體的兄弟跳過；隔著另一張圖就不算緊接
        while (s && s !== cand && (hidden(s) || (!txt(s) && !s.matches(DIV_CAP_MEDIA_SEL) && !s.querySelector(DIV_CAP_MEDIA_SEL)))) s = s.nextElementSibling;
        adjacent = s === cand;
      }
      if (prevText && !adjacent) return null;
      if (cand) {
        if (!candOk(cand)) return null;
        if (!win || !win.getComputedStyle) return null;
        // 每個直接帶字的元素都要是小字
        const els = [];
        for (const el of [cand, ...Array.from(cand.querySelectorAll('*'))]) {
          if (el.closest(DIV_CAP_NONTEXT_SEL)) continue;
          let own = false;
          for (const n of el.childNodes) { if (n.nodeType === 3 && n.textContent.trim()) { own = true; break; } }
          if (own) els.push(el);
        }
        return els.length ? { cap: cand, common: parent, fontCheck: { cap: cand, parent, els } } : null;
      }
      branch = parent;
    }
    return null;
  }
  // 字級判定：候選裡每個直接帶字的元素，字級都小於容器字級 × DIV_CAP_FS_RATIO。兩種量法
  // 任一成立就算小字：
  //   (a) 現在的 computed（v2.5.48：命中「套使用者內文字級」選擇器的元素改看最近一個
  //       沒命中的祖先）
  //   (b) v3.7.6：站方原始 cascade——停用 JRead 注入的樣式表後量（siteFs）。站方把小字級
  //       寫在 <p> / <span> 本身（foxnews `.caption p`、telefoncek 行內 13px）時，(a) 爬到
  //       的祖先是站方內文字級，量不出來
  // siteFs：Map(元素 → 站方字級)，呼叫端在一次停用裡量好；沒有就只走 (a)
  function judgeDivCapFont(fc, win, siteFs) {
    const limit = (parseFloat(win.getComputedStyle(fc.parent).fontSize) || 0) * DIV_CAP_FS_RATIO;
    let nowSmall = !!limit;
    if (nowSmall) {
      for (const el of fc.els) {
        let judge = el;
        if (bodyTextSelInjected) {
          const injected = (e) => {
            try { return e.matches(bodyTextSelInjected); } catch (_) {}
            try { return e.matches(bodyTextSelLoose); } catch (_) { return false; }
          };
          while (judge !== fc.cap && judge.parentElement && injected(judge)) judge = judge.parentElement;
        }
        if ((parseFloat(win.getComputedStyle(judge).fontSize) || 0) >= limit) { nowSmall = false; break; }
      }
    }
    if (nowSmall) return true;
    if (!siteFs) return false;
    const siteLimit = (siteFs.get(fc.parent) || 0) * DIV_CAP_FS_RATIO;
    if (!siteLimit) return false;
    return fc.els.every((el) => (siteFs.get(el) || Infinity) < siteLimit);
  }
  // 停用注入樣式、一次量完多組 fontCheck 的站方字級
  function measureSiteFontSizes(fcs, win) {
    if (!fcs.length || !NS.withInjectedCssDisabled) return null;
    const map = new Map();
    NS.withInjectedCssDisabled(() => {
      for (const fc of fcs) {
        for (const el of [fc.parent, ...fc.els]) {
          if (map.has(el)) continue;
          try { map.set(el, parseFloat(win.getComputedStyle(el).fontSize) || 0); } catch (_) { map.set(el, 0); }
        }
      }
    });
    return map;
  }
  function markCaptionMedia(articleEl, marked, loadCleanup, onLateCap) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    const DOC_POS_FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
    // v2.5.36：div 圖說（見 findDivCaption）。標記與 figcaption 共用下面的尾段（markCapPair）
    const tryDivCap = (m, fromLoad) => {
      if (m.hasAttribute(INLINE_IMG_ATTR) || m.hasAttribute(PLAYER_ATTR)) return;
      if (m.closest('[data-jread-hidden="1"], figcaption, [' + CAP_DIV_ATTR + ']')) return;
      const fig = m.closest('figure');
      if (fig && fig.querySelector('figcaption')) return;
      const r = m.getBoundingClientRect ? m.getBoundingClientRect() : null;
      if (!r || r.width < DIV_CAP_MIN_MEDIA_W || r.height <= 0) {
        // v2.5.48：lazy 圖進閱讀模式當下還沒載入、高度 0 → 載入後再判一次。Vanity Fair
        // 實證：首圖以外的圖都是 loading=lazy，apply 當下量到 608×0、全部漏判，圖說留在
        // 原位、維持內文字級。listener 交給呼叫端的清單，restore 時拆掉
        if (fromLoad || !loadCleanup || m.tagName !== 'IMG' || m.complete) return;
        const onLoad = () => tryDivCap(m, true);
        m.addEventListener('load', onLoad, { once: true });
        loadCleanup.push({ img: m, onLoad });
        return;
      }
      const hit = findDivCaption(m, articleEl, _win);
      if (!hit || hit.cap.hasAttribute(CAP_DIV_ATTR)) return;
      if (hit.fontCheck) {
        // 進場當下的候選先收集、最後一次量完站方字級（見 judgeDivCapFont）；載入後才判的
        // 單張圖自己量
        if (!fromLoad) { pendingFont.push({ m, hit }); return; }
        if (!judgeDivCapFont(hit.fontCheck, _win, measureSiteFontSizes([hit.fontCheck], _win))) return;
      }
      applyDivCap(m, hit, fromLoad);
    };
    const applyDivCap = (m, hit, fromLoad) => {
      if (hit.cap.hasAttribute(CAP_DIV_ATTR)) return;
      hit.cap.setAttribute(CAP_DIV_ATTR, '1');
      markCapPair(m, null, hit.cap, hit.common);
      // 載入後才認出來的圖說，字級那一步（passCaptionFontFloor）早就跑完了 → 補寫
      if (fromLoad && onLateCap) onLateCap(hit.cap);
      // 圖與圖說之間的包裝殼若帶下內距，那也是「圖與圖說之間的距離」→ 歸零。cnbc：
      // 站方圖片殼 inline `padding-bottom: 55.5%`（比例撐高），圖改回 in-flow 後 cleaner
      // capWrapperSpacing 把它壓成 16px !important（inline）——樣式表蓋不過，這裡也寫
      // inline（分層登記簿 owner 'styler:cap-media-pad'；styler.restore 先於
      // cleaner.restore，退出時先還成 16px、再由 cleaner 還成站方原值）。
      // 排除：殼自己有底色或下框線（內距是框內留白）、內容高度 0（padding-bottom 還在
      // 撐比例的殼，歸零會讓圖塌掉）。只做 div 圖說這條；figcaption 那條維持 v2.5.23
      // 行為（要擴過去得另外普查）
      if (_win && _win.getComputedStyle) {
        for (let cur = m.parentElement; cur && cur !== hit.common; cur = cur.parentElement) {
          const cs = _win.getComputedStyle(cur);
          const pb = parseFloat(cs.paddingBottom) || 0;
          if (pb <= 0) continue;
          const bg = parseCssColor(cs.backgroundColor);
          if ((bg && bg.a >= 0.1) || ((parseFloat(cs.borderBottomWidth) || 0) > 0 && cs.borderBottomStyle !== 'none')) continue;
          const contentH = (parseFloat(cs.height) || 0) - (cs.boxSizing === 'border-box' ? (parseFloat(cs.paddingTop) || 0) + pb : 0);
          if (contentH <= 1) continue;
          cur.setAttribute(CAP_MEDIA_PAD_ATTR, '1');
          capPadPrev.set(cur, { v: cur.style.getPropertyValue('padding-bottom'), p: cur.style.getPropertyPriority('padding-bottom') });
          setInlineOwned(cur, 'padding-bottom', '0px', 'important', 'styler:cap-media-pad');
          marked.push(cur);
        }
      }
    };
    const pendingFont = [];
    for (const m of articleEl.querySelectorAll(DIV_CAP_MEDIA_SEL)) tryDivCap(m, false);
    if (pendingFont.length && _win && _win.getComputedStyle) {
      const siteFs = measureSiteFontSizes(pendingFont.map((x) => x.hit.fontCheck), _win);
      for (const { m, hit } of pendingFont) {
        if (judgeDivCapFont(hit.fontCheck, _win, siteFs)) applyDivCap(m, hit, false);
      }
    }
    for (const cap of articleEl.querySelectorAll('figcaption')) {
      if (cap.closest('[data-jread-hidden="1"]')) continue;
      const fig = cap.closest('figure');
      if (!fig || !articleEl.contains(fig)) continue;
      let media = null;      // 文件順序最後一個
      let rendered = null;   // 文件順序最後一個「現在量得到尺寸」的
      for (const m of fig.querySelectorAll(CAP_MEDIA_SEL)) {
        if (cap.contains(m)) continue;
        if (!(m.compareDocumentPosition(cap) & DOC_POS_FOLLOWING)) continue; // 媒體在圖說之後
        if (m.hasAttribute(INLINE_IMG_ATTR) || m.hasAttribute(PLAYER_ATTR)) continue;
        if (m.closest('[data-jread-hidden="1"]')) continue;
        if (m.ownerSVGElement) continue; // svg 內部節點
        media = m;
        const r = m.getBoundingClientRect ? m.getBoundingClientRect() : null;
        if (r && r.height > 0 && r.width > 0) rendered = m;
      }
      if (!media) continue;
      // 共同容器：同時包住媒體與圖說的最近祖先
      let common = media.parentElement;
      while (common && !common.contains(cap)) common = common.parentElement;
      if (!common) continue;
      // 媒體那一支、圖說那一支（共同容器的直系子）
      let mediaBranch = media;
      while (mediaBranch.parentElement !== common) mediaBranch = mediaBranch.parentElement;
      let capBranch = cap;
      while (capBranch.parentElement !== common) capBranch = capBranch.parentElement;
      // 兩支之間隔著帶文字的兄弟 → 圖說不是緊接在圖下面
      let between = false;
      for (let sib = mediaBranch.nextElementSibling; sib && sib !== capBranch; sib = sib.nextElementSibling) {
        if (sib.getAttribute('data-jread-hidden') === '1') continue;
        if ((sib.textContent || '').trim().length > 0) { between = true; break; }
      }
      if (between) continue;
      markCapPair(media, rendered, cap, common);
    }
    function markCapPair(media, rendered, cap, common) {
      // 兩個都標：站方常在同一格放「佔位圖 + lazy 真圖」（bbc：img[aria-label=image
      // unavailable] 後面跟真圖）。進場當下真圖可能還沒載入（高度 0）、畫面上是佔位圖；
      // 載入後換成真圖。只標文件順序最後一個的話，佔位圖那 24px 會留在圖說上面
      for (const start of (rendered && rendered !== media ? [media, rendered] : [media])) {
        if (!common.contains(start)) continue;
        for (let cur = start; cur && cur !== common; cur = cur.parentElement) {
          if (cur.getAttribute(CAP_MEDIA_ATTR) === '1') continue;
          cur.setAttribute(CAP_MEDIA_ATTR, '1');
          marked.push(cur);
        }
      }
      // 圖說自帶看得見的底色或框線（上／左／右任一邊）→ 它是一個貼著圖的框：padding 是
      // 框內留白不動，與圖之間不留縫（見 buildCss）。只有下框線的不算——那是分隔線
      let boxed = false;
      let thinPad = false;
      if (_win && _win.getComputedStyle) {
        try {
          const cs = _win.getComputedStyle(cap);
          const bg = parseCssColor(cs.backgroundColor);
          const side = (w, st) => (parseFloat(w) || 0) > 0 && st !== 'none' && st !== 'hidden';
          boxed = !!((bg && bg.a >= 0.1) ||
            side(cs.borderTopWidth, cs.borderTopStyle) || side(cs.borderLeftWidth, cs.borderLeftStyle) ||
            side(cs.borderRightWidth, cs.borderRightStyle));
          thinPad = (parseFloat(cs.paddingTop) || 0) < 4;
        } catch (e) {
          if (!(e && e.name === 'SyntaxError')) throw e; // jsdom nwsapi 既知行為
        }
      }
      // 圖說那一支不是圖說本身（圖說外面還包一層）時，上邊距也可能掛在那層——
      // 只標圖說；外層的 margin 不動（外層可能還裝著別的東西）
      cap.setAttribute(CAP_BELOW_ATTR, boxed ? (thinPad ? 'padfix' : 'pad') : '1');
      marked.push(cap);
    }
  }
  // v2.5.16：主文內帶 shadow root 的自訂元素標 SHADOW_HOST_ATTR（規則與動機見 buildCss
  // 該規則註解）。只看 tag 名含連字號的元素（自訂元素的命名規定），再問 shadowRoot——
  // 整篇掃一次、每個元素只付一次字串比對。closed shadow root 讀不到、不標。只做進場
  // 當下這一次，進場後才升級 / 才插入的元件不補標。
  function markShadowHosts(articleEl, marked) {
    const all = articleEl.getElementsByTagName('*');
    const found = [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.localName.indexOf('-') === -1) continue;
      let sr = null;
      try { sr = el.shadowRoot; } catch (_) { sr = null; }
      if (sr) found.push(el);
    }
    for (const el of found) {
      el.setAttribute(SHADOW_HOST_ATTR, '1');
      marked.push(el);
    }
  }
  // v1.9.15：行內高亮自訂元素保留站方底色（Jimmy 2026-10-01：Readwise Reader
  // 文件頁進閱讀模式後，畫過的重點看不出來）。
  // 根因：BG_PRESERVE_NOT 只認 <mark> / <kbd> 這類 HTML 語意 tag；網頁標註工具
  // 不用 <mark>，而是自訂元素包住文字（Reader / Readwise 擴充功能 <rw-highlight>、
  // Hypothesis <hypothesis-highlight>），底色還常畫在 background-image（漸層）
  // 上——bg strip 把 color 與 image 一起清掉，重點完全隱形。
  // 結構訊號（不看 tag 名的字面、不綁站點）：
  //   - hyphen 自訂元素（HTML 沒有這個 tag，一定是站方 / 擴充功能自己造的）
  //   - 站方 cascade 下是 display:inline（包在文字流裡，不是區塊元件）
  //   - 自帶底色：background-color alpha >= 0.05 或 background-image 非 none
  //   - 有文字內容
  // 四項同時成立＝「行內文字上了底色」＝高亮。區塊型元件（<app-root> 之類的
  // 框架外殼）不是 inline、照舊清底色。
  // 量測要看站方原意：JRead 注入的 strip 規則生效後量到的永遠是透明，所以用
  // NS.withInjectedCssDisabled 暫停注入樣式再量（同一個 JS task，不 paint）；
  // 只在候選存在時才付這筆 recalc。讀寫分離：先整輪量、再整輪標。
  // scopeEl（選填）：dynamic path 只掃新增子樹（含自身）。
  // 訊號層次：驗「標了之後 bg / color strip 規則不再命中」；不驗高亮在各主題下
  // 的對比（站方配色成對保留，不由 JRead 重算）、不驗 <span style="background">
  // 這類非自訂元素的高亮（blast radius 大，另案）。
  // v2.4.6：半透明高亮底色（'hl-tint'）——底色透出的是 JRead 主題卡片色、不是
  // 站方原本的白頁，站方配給白頁的深字在深色主題下疊成「深字配暗橄欖底」不可讀
  //（Reader <rw-highlight>：底部 2px 實心黃 + 其餘 rgba(255,213,0,0.2) 漸層、
  // 文字 #000；Jimmy 2026-11-10 夜藍主題截圖）。填色 alpha 取 bg-color 與漸層
  // 各色標的最小值（文字底下鋪的是最淡那段，實心細線只是裝飾）；< 0.5 視為半
  // 透明。只有 url() 圖、讀不到色標的一律當不透明（維持成對保留，不猜）。
  // 標成 'hl-tint' 的高亮文字色改跟主題走、底色照留；不透明高亮行為不變。
  const HL_TINT_ALPHA_MAX = 0.5;
  function isTranslucentFill(bgc, bgImage) {
    const alphas = [];
    if (bgc && bgc.a >= 0.05) alphas.push(bgc.a);
    if (bgImage && bgImage !== 'none') {
      const stops = String(bgImage).match(/rgba?\([^)]*\)|color\(srgb[^)]*\)|#[0-9a-f]{3,6}\b|\btransparent\b/gi) || [];
      if (!stops.length) return false;
      for (const c of stops) {
        const p = parseCssColor(c);
        if (p) alphas.push(p.a);
      }
    }
    return alphas.length > 0 && Math.min(...alphas) < HL_TINT_ALPHA_MAX;
  }
  function markInlineHighlights(articleEl, marked, scopeEl) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    if (!_win || !_win.getComputedStyle) return;
    const scope = scopeEl || articleEl;
    const cands = [];
    const consider = (el) => {
      if (!el.localName || el.localName.indexOf('-') < 0) return;
      if (el.hasAttribute(SITE_UI_ATTR) || el.getAttribute(PLAYER_ATTR) === '1') return;
      if (!(el.textContent || '').trim()) return;
      if (el.closest('pre, code, [data-jread-hidden="1"]')) return;
      cands.push(el);
    };
    if (scope !== articleEl) consider(scope);
    for (const el of scope.querySelectorAll('*')) consider(el);
    if (!cands.length) return;
    const measure = () => {
      const hits = [];
      for (const el of cands) {
        let cs = null;
        try {
          cs = _win.getComputedStyle(el);
        } catch (e) {
          if (e && e.name === 'SyntaxError') continue;
          throw e;
        }
        // jsdom 對 inline 元素的 computed display 回空字串（真瀏覽器恆有值）
        if (!cs || (cs.display !== 'inline' && cs.display !== '')) continue;
        const bgc = parseCssColor(cs.backgroundColor);
        const hasBg = (bgc && bgc.a >= 0.05) ||
          (cs.backgroundImage && cs.backgroundImage !== 'none');
        if (hasBg) hits.push({ el, tint: isTranslucentFill(bgc, cs.backgroundImage) });
      }
      return hits;
    };
    const hits = (NS && NS.withInjectedCssDisabled) ? NS.withInjectedCssDisabled(measure) : measure();
    for (const { el, tint } of hits) {
      el.setAttribute(SITE_UI_ATTR, tint ? 'hl-tint' : 'hl');
      el.setAttribute(PLAYER_ATTR, '1');
      marked.push(el);
    }
  }
  // v3.7.4：色塊（color swatch）保留站方底色（語料庫 2026-11-23 審查：qiita「コードスパン
  // の中身が CSS の color 型」結果的 5 個顏色方塊全變透明）。站方在色碼後面放一個空的
  // `<span style="background-color: #ffce44">`、靠樣式表撐成 12×12 小方塊，方塊的顏色
  // 就是內容本身；bg strip（`*${BG_PRESERVE_NOT}`）把它跟裝飾底色一起清成透明。
  // 結構訊號（不看 class）：
  //   - 底色寫在元素自己的 style 屬性上（逐個元素給值＝資料，不是版型）
  //   - 沒有任何子元素、沒有字（方塊本身就是全部內容）
  //   - 畫面上是小方塊：寬高都在 SWATCH_MIN_PX–SWATCH_MAX_PX 之間（再大就是色帶 / 卡片底，
  //     照舊清）
  // 標成 SITE_UI_ATTR="swatch" ＋ PLAYER_ATTR，走 bg / border strip 既有的 `:not([PLAYER_ATTR])`
  // 豁免（同 markInlineHighlights）。scopeEl（選填）：dynamic path 只掃新增子樹。
  // 這條驗「方塊的站方底色不被清」，不驗方塊在深色主題下的對比（顏色就是內容，不改）
  const SWATCH_MIN_PX = 4;
  const SWATCH_MAX_PX = 48;
  function markColorSwatches(articleEl, marked, scopeEl) {
    const scope = scopeEl || articleEl;
    const cands = [];
    const consider = (el) => {
      if (!el.style || !el.getAttribute || el.children.length) return;
      if ((el.textContent || '').trim()) return;
      if (el.hasAttribute(SITE_UI_ATTR) || el.getAttribute(PLAYER_ATTR) === '1') return;
      const bg = parseCssColor(el.style.getPropertyValue('background-color'));
      if (!bg || !(bg.a >= 0.05)) return;
      if (el.closest('[data-jread-hidden="1"]')) return;
      cands.push(el);
    };
    if (scope !== articleEl && scope.nodeType === 1) consider(scope);
    if (scope.querySelectorAll) for (const el of scope.querySelectorAll('[style*="background"]')) consider(el);
    for (const el of cands) {
      let r;
      try { r = el.getBoundingClientRect(); } catch (_) { continue; }
      if (!(r.width >= SWATCH_MIN_PX && r.width <= SWATCH_MAX_PX && r.height >= SWATCH_MIN_PX && r.height <= SWATCH_MAX_PX)) continue;
      el.setAttribute(SITE_UI_ATTR, 'swatch');
      el.setAttribute(PLAYER_ATTR, '1');
      marked.push(el);
    }
  }
  // v2.4.9：drop cap 顏色修正的對象標記。純決策：首字 pseudo 的 color 或
  // -webkit-text-fill-color 與元素本身不同＝站方對 ::first-letter 下了顯式色，
  // 需要 v0.8.137 的 inherit 修正；相同就不必掛 ::first-letter（掛了反而讓
  // Safari 翻頁模式段首選不到第一個字，見 CSS 規則註解）。
  function firstLetterColorDiverges(cs, fl) {
    if (!cs || !fl) return false;
    const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
    if (norm(fl.color) && norm(fl.color) !== norm(cs.color)) return true;
    const ff = norm(fl.webkitTextFillColor);
    // 元素自身 text-fill 讀不到（未設＝currentColor）時以 color 為準
    const elFill = norm(cs.webkitTextFillColor) || norm(cs.color);
    return !!ff && ff !== 'currentcolor' && ff !== elFill;
  }
  // 量測必須在主題文字色已生效之後（passHtmlClassThemeMeta 之後）：比的是「JRead
  // 覆寫後的段落色」vs「站方首字色」——The Verge 暗色站原本兩者同為白字、要等段落
  // 被覆寫成深字才分得出來。只看非 inline 且有文字的元素（::first-letter 只作用於
  // block container）。scopeEl 給定時只掃該子樹（動態補標）。
  // 前置 gate：頁面樣式表完全沒有 first-letter 規則（JRead 自己那條除外）就不必
  // 逐元素量 pseudo——NS.pageHasSiteFirstLetterRule（2026-11-15 review B-02 起住
  // namespace.js、帶快取，與 paged-mode 的首字補上緣共用；::selection 量測走同一支
  // 底層 NS.pageMayStylePseudo）。
  function markFirstLetterColorBlocks(articleEl, marked, scopeEl) {
    const _win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
    if (!_win || !_win.getComputedStyle) return;
    if (!NS.pageHasSiteFirstLetterRule(articleEl.ownerDocument)) return;
    const scope = scopeEl || articleEl;
    const els = NS.selfAndDescendants(scope, '*');
    for (const el of els) {
      if (el.hasAttribute(FIRST_LETTER_ATTR)) continue;
      if (!(el.textContent || '').trim()) continue;
      let cs = null;
      let fl = null;
      try {
        cs = _win.getComputedStyle(el);
        if (!cs || String(cs.display || '').indexOf('inline') === 0 || cs.display === 'none') continue;
        fl = _win.getComputedStyle(el, '::first-letter');
      } catch (e) {
        if (e && e.name === 'SyntaxError') continue;
        throw e;
      }
      if (!firstLetterColorDiverges(cs, fl)) continue;
      el.setAttribute(FIRST_LETTER_ATTR, '1');
      marked.push(el);
    }
  }
  // v2.5.24：放大首字重排的純決策。text＝元素文字；elFsPx / elLhPx＝元素（閱讀模式
  // 覆寫後）的字級與行高；fl＝::first-letter 的 computed style（站方值，量的時候
  // DROP_CAP_ATTR 要先拿掉）。回 null（不是 float 放大首字，或排得好不必動）/
  // 'off' / 'c<N>' / 'l<N>'。
  // 判準是「墨跡底會不會壓到首字旁最後一行的下一行」：
  //   首字框（margin box）高 → 旁邊縮排的行數 lines = ceil(框高 / 行高)
  //   墨跡高：CJK 佔滿字框（1em）、拉丁大寫約 0.72em，在行框內垂直置中
  //   墨跡底 > 第 lines+1 行的文字頂（行頂 + 半行距）2px 以上 → 會重疊，要重排
  // 字型實際 metrics 讀不到，0.72 / 1.0 是估值；2px 容差擋掉剛好貼齊的（grubstreet
  // 原文 O 估值剛好差 1.9px、實際沒壓到）。
  // 訊號層次：驗「站方首字幾何 → 標記值」；不驗各字型實際墨跡（harness 截圖）、
  // 不處理 initial-letter 首字（瀏覽器自己對齊行數，翻頁的上緣墨跡歸 paged-mode）、
  // 不處理站方用 <span> 包起來的首字（不是 pseudo，內文規則照管）。
  const DROP_CAP_LEAD_RE = /^\s*([\p{P}\p{S}]*)([^\p{P}\p{S}\s])(\p{P}*)/u;
  const DROP_CAP_CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
  function dropCapPlan(text, elFsPx, elLhPx, fl) {
    if (!fl || !(elFsPx > 0) || !(elLhPx > 0)) return null;
    if (!fl.float || fl.float === 'none') return null;
    const fs = parseFloat(fl.fontSize) || 0;
    if (fs < elFsPx * 1.5) return null;
    const m = DROP_CAP_LEAD_RE.exec(String(text || ''));
    if (!m) return null;
    const cjk = DROP_CAP_CJK_RE.test(m[2]);
    if (cjk && (m[1] || m[3])) return 'off';
    const px = (v) => parseFloat(v) || 0;
    let lh = parseFloat(fl.lineHeight);
    if (!isFinite(lh)) lh = fs * 1.2; // 'normal'
    const top = px(fl.marginTop) + px(fl.borderTopWidth) + px(fl.paddingTop);
    const box = top + lh + px(fl.paddingBottom) + px(fl.borderBottomWidth) + px(fl.marginBottom);
    const lines = Math.max(1, Math.ceil((box - 0.5) / elLhPx));
    const ink = (cjk ? 1 : 0.72) * fs;
    const inkBottom = top + lh / 2 + ink / 2;
    const nextTextTop = lines * elLhPx + (elLhPx - elFsPx) / 2;
    if (inkBottom - nextTextTop <= 2) return null;
    return (cjk ? 'c' : 'l') + Math.max(2, Math.min(5, lines));
  }
  // v2.5.24：::first-line 的字距 / 字體 / 字級 / 字重 / 大小寫 / 顏色與元素本身不同
  // ＝站方對首行下了樣式。fl＝::first-line 的 computed style。
  function firstLineDiverges(cs, fl) {
    if (!cs || !fl) return false;
    const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
    for (const k of ['letterSpacing', 'fontFamily', 'fontSize', 'fontWeight', 'textTransform', 'fontVariantCaps', 'color']) {
      if (norm(fl[k]) && norm(cs[k]) && norm(fl[k]) !== norm(cs[k])) return true;
    }
    return false;
  }
  // 標記入口。scopeEl 給定時掃該子樹＋它到 articleEl 的祖先鏈（首字 / 首行規則
  // 常掛在段落的容器上——telefoncek 是 div.entry-content::first-letter；譯文回填
  // 只換了段落裡的 text node，要回頭重判掛規則的那一層）。重判時先拿掉自己的標記
  // 再量（標記生效後量到的是重排後的值，會誤判成「排得好」而把標記拿掉）。
  // 祖先鏈只重判「量過確定有站方 float 放大首字」的那幾層（dropCapCarriers，全掃時
  // 記下）：譯文回填一頁可能觸發上千次，不能每次都對整條祖先鏈量 pseudo。
  let dropCapCarriers = new WeakSet();
  function markDropCapBlocks(articleEl, marked, scopeEl) {
    const doc = articleEl.ownerDocument;
    const _win = doc && doc.defaultView;
    if (!_win || !_win.getComputedStyle) return;
    const hasLetter = NS.pageMayStylePseudo(doc, 'first-letter', 'data-jread-');
    const hasLine = NS.pageMayStylePseudo(doc, 'first-line', 'data-jread-');
    if (!hasLetter && !hasLine) return;
    if (!doc.getElementById(PSEUDO_SHAPE_STYLE_ID)) NS.injectCssText(PSEUDO_SHAPE_STYLE_ID, buildPseudoShapeCss());
    let els;
    if (scopeEl && scopeEl !== articleEl) {
      els = [];
      for (let e = scopeEl.parentElement; e && e.nodeType === 1; e = e.parentElement) {
        if (dropCapCarriers.has(e)) els.push(e);
        if (e === articleEl) break;
      }
      for (const e of NS.selfAndDescendants(scopeEl, '*')) els.push(e);
    } else {
      dropCapCarriers = new WeakSet();
      els = NS.selfAndDescendants(articleEl, '*');
    }
    const setMark = (el, attr, v) => {
      const had = el.hasAttribute(attr);
      if (v == null) { if (had) el.removeAttribute(attr); return; }
      if (had && el.getAttribute(attr) === v) return;
      el.setAttribute(attr, v);
      if (marked.indexOf(el) < 0) marked.push(el);
    };
    for (const el of els) {
      if (!(el.textContent || '').trim()) continue;
      let cs = null;
      try {
        cs = _win.getComputedStyle(el);
        if (!cs || String(cs.display || '').indexOf('inline') === 0 || cs.display === 'none') continue;
        if (hasLetter) {
          const prev = el.getAttribute(DROP_CAP_ATTR);
          if (prev != null) el.removeAttribute(DROP_CAP_ATTR);
          // v3.7.7：框線先判（量站方值要先拔自己的標記），標上後再量重排——
          // 框線與內距拿掉後首字框變矮，重排要按拿掉後的框算
          if (el.hasAttribute(DROP_CAP_FRAME_ATTR)) el.removeAttribute(DROP_CAP_FRAME_ATTR);
          const fl0 = _win.getComputedStyle(el, '::first-letter');
          const framed = !!(fl0 && fl0.float && fl0.float !== 'none' &&
            ['Top', 'Right', 'Bottom', 'Left'].some((k) =>
              (parseFloat(fl0['border' + k + 'Width']) || 0) > 0 && fl0['border' + k + 'Style'] !== 'none'));
          if (framed) setMark(el, DROP_CAP_FRAME_ATTR, '1');
          const fl = _win.getComputedStyle(el, '::first-letter');
          if (fl && fl.float && fl.float !== 'none') dropCapCarriers.add(el);
          const plan = dropCapPlan(el.textContent, parseFloat(cs.fontSize), parseFloat(cs.lineHeight), fl);
          if (prev != null && plan === prev) el.setAttribute(DROP_CAP_ATTR, prev);
          else setMark(el, DROP_CAP_ATTR, plan);
        }
        if (hasLine && !el.hasAttribute(FIRST_LINE_ATTR)) {
          const l1 = _win.getComputedStyle(el, '::first-line');
          if (firstLineDiverges(cs, l1)) setMark(el, FIRST_LINE_ATTR, '1');
        }
      } catch (e) {
        if (e && e.name === 'SyntaxError') continue;
        throw e;
      }
    }
  }
  // v2.4.10：站方 ::selection 底色是否不透明（Jimmy 2026-11-12 Readwise Reader
  // 夜藍主題截圖：選取的文字變成「黑字配暗橄欖底」看不清）。
  // 根因：站方 `::selection { background: 15% 半透明黃; color: #000 }` 是配站方
  // 白頁設計的；JRead 深色主題下半透明底透出深色卡片，黑字疊上去幾乎看不見。
  // 修法分兩層（CSS 在主題文字色區塊）：
  //   - 一律把選取文字色改成主題文字色（底色照留站方值——Readwise「放開就自動
  //     畫重點」的黃色選取提示得以保留）
  //   - 站方選取底色不透明（alpha >= HL_TINT_ALPHA_MAX）時，主題文字色疊在站方
  //     實心底上同樣可能看不清（例：實心亮黃底配淺字），此時底色一起改成主題
  //     連結色混卡片色。這一層靠本函式量測後在 <html> 標 SEL_BG_ATTR 啟用。
  //   - v2.5.46：站方沒有選取底色（沒有任何站方 selection 規則，或規則只設字色）
  //     也要標。只寫字色的 ::selection 規則一命中，Chromium 與 WebKit 都不再畫
  //     預設選取底色（computed 底色＝透明、截圖完全沒反白，兩引擎最小頁實測）——
  //     JRead 上面那條無條件字色規則本身就會觸發，於是站方沒自訂選取底色的站
  //    （上報，Jimmy 2026-11-23）在有文字色的主題下選取完全看不見。
  // 量的是文章內第一個有字段落的 ::selection（站方規則多半是全域 `::selection`）；
  // JRead 自家規則不設底色（補底色那條要等標記才生效，量前先拔標記），所以量到
  // 的就是站方值。與主題無關：任何主題都量，切到深色主題時標記已就位。
  // 樣式表沒有任何站方 selection 規則就不量、直接標（沒有站方底色可留）。
  // 訊號層次：驗「站方選取底色透明 / 不透明 / 沒有規則 → 標記」與 CSS 字串；不驗
  // 各主題下的實際對比（真實渲染要 harness / Safari 實機）、不處理站方 ::highlight()
  // 自訂高亮（名稱由站方自取，無法通用覆寫；選取層畫在其上，文字色以 ::selection 為準）。
  function markSiteSelectionBg(articleEl) {
    const doc = articleEl.ownerDocument;
    const _win = doc && doc.defaultView;
    if (!_win || !_win.getComputedStyle) return false;
    doc.documentElement.removeAttribute(SEL_BG_ATTR);
    if (!NS.pageMayStylePseudo(doc, 'selection', 'jread')) {
      doc.documentElement.setAttribute(SEL_BG_ATTR, '1');
      return true;
    }
    let probeEl = articleEl;
    for (const p of articleEl.querySelectorAll('p')) {
      if ((p.textContent || '').trim()) { probeEl = p; break; }
    }
    let sc = null;
    try {
      sc = _win.getComputedStyle(probeEl, '::selection');
    } catch (e) {
      if (e && e.name === 'SyntaxError') return false;
      throw e;
    }
    const raw = sc && String(sc.backgroundColor || '').trim().toLowerCase();
    const bg = raw === 'transparent' ? { a: 0 } : parseCssColor(raw);
    // 透明（站方規則只設字色）或不透明才補底色；半透明照留站方提示色；解析不了不動
    if (!bg || (bg.a > 0 && bg.a < HL_TINT_ALPHA_MAX)) return false;
    doc.documentElement.setAttribute(SEL_BG_ATTR, '1');
    return true;
  }
  // v1.9.15：站方浮動工具列子樹整支豁免（cleaner allowSelectionToolbar 放行
  // 選取工具列後轉呼）。工具列的底色 / 框線 / 圖示色全是站方自管，bg / border /
  // color strip 一清就變成「圖示直接浮在內文上」（Reader probe 截圖實證）。
  // root 自身 + 全部後代都標（strip 規則是逐元素 :not()，只標 root 沒用）。
  // 已帶 PLAYER_ATTR 的元素（真播放器）不碰——restore 才不會誤拔它的標記。
  function markSiteWidgetEls(root, marked) {
    const els = NS.selfAndDescendants(root, '*'); // 2026-10-07 review C-10：不 spread
    for (const el of els) {
      if (el.hasAttribute(SITE_UI_ATTR) || el.getAttribute(PLAYER_ATTR) === '1') continue;
      el.setAttribute(SITE_UI_ATTR, 'widget');
      el.setAttribute(PLAYER_ATTR, '1');
      marked.push(el);
    }
  }
  // 動態補標狀態：apply() 標記完成後填入、restore() 清空。cleaner 的
  // dynamic-append observer 對 articleEl 內新增節點轉呼 remarkDynamicMarkers
  // （晚 mount 的 responsive embed iframe / heading link / absolute 錨定元素）。
  let activeMarkState = null;

  const styler = {
    // v3.7.0：字型堆疊用到的內嵌字型 @font-face（Noto Serif TC 四字重＋被選到的拉丁可變字型）。列表頁（reader.html）
    // 的卡片也跟文章用同一套字型，用這支拿規則、不另抄一份字型清單（styleCss 同一份資料）
    sanitizeFontFamily,
    fontFaceCssFor(stack) {
      const s = sanitizeFontFamily(stack);
      if (!s) return '';
      return (s.indexOf('Noto Serif TC') !== -1 ? FONT_FACE_CSS : '') + latinFontFaceFor(s);
    },
    /**
     * 套用閱讀模式排版。
     * @param {Element} articleEl 主文容器
     * @param {object} settings { theme, fontSize, contentWidth, fontFamily, lineHeight }
     * @returns {object|null} snapshot，restore 時必須原樣回傳
     */
    apply(articleEl, settings) {
      // 2026-11-15 review B-02：pseudo 樣式表 gate 的快取以 apply 為單位
      if (typeof NS.resetPseudoMemo === 'function') NS.resetPseudoMemo();
      if (!articleEl || articleEl.nodeType !== 1) return null;

      const s = settings || {};
      // fontSize 特殊值 0 = "Auto / 原站字級"，代表使用者明確選擇不注入
      // 任何 font-size override（每站保留原字級）。Number(0) || DEFAULT 會把
      // 0 轉成 DEFAULT、sentinel 失效——需用 Number.isFinite + >= 0 判斷保留 0。
      //
      // v0.7.143：上限 clamp。popup UI 已 clamp [12, 32]、options 也有 HTML5
      // min/max，但儲存層完全沒驗——外部寫入或 storage 損壞時 `fontSize: 1e308`
      // / `0.001` 會被當合法值注入 CSS。clamp 是第二道防線。
      const rawFs = Number(s.fontSize);
      const rawCw = Number(s.contentWidth);
      const rawLh = Number(s.lineHeight);
      const rawPs = Number(s.paragraphSpacing);
      const opts = {
        // fontSize：保留 0 = Auto sentinel；其他 clamp [8, 200]px
        fontSize: Number.isFinite(rawFs) && rawFs >= 0
          ? (rawFs === 0 ? 0 : Math.min(200, Math.max(8, rawFs)))
          : DEFAULTS.fontSize,
        // contentWidth：clamp [300, 2000]px（300 是最窄可閱讀寬、2000 是大螢幕極限）
        contentWidth: Number.isFinite(rawCw) && rawCw > 0
          ? Math.min(2000, Math.max(300, rawCw))
          : DEFAULTS.contentWidth,
        // 2026-10-07 review B-15：文法閘（見 sanitizeFontFamily），不合法退預設
        fontFamily: sanitizeFontFamily(s.fontFamily) || DEFAULTS.fontFamily,
        // v0.7.254：字重三段 300（細）/ 400（中，預設）/ 600（粗 Semibold）。只接受
        // 這三個合法值，其餘（舊資料 / 損壞 / 外部寫入）一律回退 400。粗用 600 而非
        // 700：700 視覺太重（Jimmy 回報）；600 Semibold 比中明顯重、又不過粗，且
        // 跨平台不撞色（500 在 Windows 微軟正黑無 face 會退回 400 與中相同，故不用
        // 500）。舊 boldText 已退役、由 SW onInstalled 遷移到 fontWeight。
        fontWeight: (s.fontWeight === 300 || s.fontWeight === 600) ? s.fontWeight : 400,
        // lineHeight：v0.7.162 起新增 0 = Auto sentinel（保留原站行距、不注入
        // line-height）；非 0 clamp [1.0, 3.0]（unitless ratio；< 1 字會重疊、
        // > 3 段落破碎）。
        lineHeight: Number.isFinite(rawLh) && rawLh >= 0
          ? (rawLh === 0 ? 0 : Math.min(3.0, Math.max(1.0, rawLh)))
          : DEFAULTS.lineHeight,
        // paragraphSpacing：v0.7.162 新增；-1 = Auto sentinel（不注入 p/ul/ol/
        // blockquote margin-bottom），非 -1 clamp [0, 5]em（0 = 段落緊貼，是合
        // 法值；5 是極限上限避免外部 storage 損壞時注入 1e308em）。預設 1.0。
        paragraphSpacing: Number.isFinite(rawPs) && rawPs >= -1
          ? (rawPs === -1 ? -1 : Math.min(5, Math.max(0, rawPs)))
          : DEFAULTS.paragraphSpacing,
        titleFontSize: (() => {
          const raw = Number(s.titleFontSize);
          if (!Number.isFinite(raw) || raw < 0) return DEFAULTS.titleFontSize;
          return raw === 0 ? 0 : Math.min(200, Math.max(8, raw));
        })(),
        // v0.7.227：翻頁模式（電子書式水平翻頁）。boolean、預設 false——
        // 嚴格 === true 判定，storage 損壞 / 外部寫入非 boolean 值一律當關。
        pagedMode: s.pagedMode === true,
        // v1.5.3：本頁是否為 reader 文章頁（article feed 點進的單篇）——true 時
        // 卡片上緣用較緊縮的 READER_HOST_TOP_GUTTER（拿掉返回箭頭後文章往上長）。
        // 由 reader-article.js 在 enterFromContainer 前設 NS.state.readerHostPage。
        readerHostPage: !!(NS.state && NS.state.readerHostPage),
        // v1.7.37：頂端進度條皮膚。白名單驗證——舊資料（此 key 不存在）、storage
        // 損壞、外部寫入未知字串一律回退 'hairline'（= 歷代行為），與 fontWeight
        // 的「只接受三個合法值」同準則。CSS 端拿到未知值只會少注入覆寫段落、不會
        // 產出壞 CSS，但白名單讓回退行為明確而非碰巧安全。
        progressBarStyle: PROGRESS_BAR_STYLES.indexOf(s.progressBarStyle) >= 0
          ? s.progressBarStyle
          : DEFAULTS.progressBarStyle,
        // v2.3.0：左右對齊三段，白名單驗證（未知值 / 舊資料回退 'cjk' = 既有行為）
        textJustify: TEXT_JUSTIFY_MODES.indexOf(s.textJustify) >= 0
          ? s.textJustify
          : DEFAULTS.textJustify
      };
      const theme = themeOf(s.theme || DEFAULTS.theme);

      // 判斷哪些設定需要注入 override CSS。v1.7.33 起判定與「預設值」脫鉤
      //（預設值已改為 Jimmy 慣用組合、不再等於「不注入」）——不注入一律由
      // 明確 sentinel 表達：
      //   fontSize = 0 (Auto) → 不注入（保留原站字級的明確 sentinel）
      //   fontSize > 0 → 一律注入（含 == DEFAULT）。v0.7.140 修正：舊版
      //     「fontSize == DEFAULT → 不注入」造成 popup 顯示 18 但實際看到原站
      //     20px / 22px 的 UX confusion。lineHeight 同理（v1.7.33 起 0 = Auto
      //     之外的值一律注入，去除「== 預設值 → 不注入」的隱晦語義）。
      //   fontFamily = 'system-ui'（popup「系統預設」）→ 不注入；其餘 stack 注入
      //   theme → 由 theme.text 判定（light 的 text 為 null、天生不注入文字色；
      //     dark / sepia / gray 注入）
      const overrides = {
        theme: !!theme.text,
        fontSize: opts.fontSize > 0,
        fontFamily: opts.fontFamily !== 'system-ui',
        lineHeight: opts.lineHeight > 0,
        titleFontSize: opts.titleFontSize > 0
      };

      // v0.7.225 contrast guard phase 1：注入 CSS 前量「原始 effective bg」+
      // 文字載體色。必須在 styleEl.textContent 設定前跑——注入後 body / 祖先
      // bg 被 reader 樣式覆蓋，原始背景量不到。只在 light theme 跑（theme.text
      // 非 null 時 `* { color: theme.text }` 蓋掉 token 色 + v0.7.164 已清
      // pre/code bg transparent，結構上不存在此 bug）。
      // v2.5.40：「當標題用的段落」（pseudo heading）。Trigger：pudding.cool 標題與小標都是
      // 內文大小的小字（語料庫 KNOWN-ISSUES）——站方標題是 `<p class="opener-title">`
      //（198px）、小標是 `<p class="prose-head">`（31px 粗體），沒有任何 h 標籤；閱讀模式
      // 把所有 <p> 統一成使用者字級，標題和小標被壓成內文。
      // 判準（與站點、class 無關），量的是「注入 JRead 樣式之前」的站方字級：
      //   - p / div、短（<= PSEUDO_HEADING_MAX_LEN 字）、裡面沒有其他區塊、媒體、標題
      //   - 字級 >= 內文主流字級 × PSEUDO_HEADING_MIN_RATIO，且字重 >= PSEUDO_HEADING_MIN_WEIGHT（v3.7.7 前 600）
      //     ——摘要（dek）與引言（pull quote）也比內文大，但都不是粗體（普查：arstechnica /
      //     theverge / lawfare / kubernetes 的摘要 300–400、aeon 的引言 400）
      //   - 不在清單、表格、引言、圖說、連結、按鈕裡；不以句號結尾
      // 只量、做標記；注入樣式後由 passPseudoHeadingSize 判斷是不是真的被壓小了才改
      const pseudoHeadings = [];
      let pseudoBodyFs = 0;
      const PSEUDO_HEADING_MAX_LEN = 80;
      const PSEUDO_HEADING_MIN_RATIO = 1.5;
      const PSEUDO_HEADING_MIN_WEIGHT = 500;
      const passMarkPseudoHeadings = () => {
        const win = articleEl.ownerDocument?.defaultView;
        if (!win || !win.getComputedStyle) return;
        const cands = [];
        const tally = new Map();
        for (const el of articleEl.querySelectorAll('p, div')) {
          if (!isVisiblyShown(el, articleEl)) continue;
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!t) continue;
          if (el.tagName === 'P' && t.length >= 80) {
            const f = parseFloat(win.getComputedStyle(el).fontSize) || 0;
            if (f) tally.set(f, (tally.get(f) || 0) + t.length);
            continue;
          }
          if (t.length > PSEUDO_HEADING_MAX_LEN) continue;
          cands.push({ el, t });
        }
        let best = 0, bestN = 0;
        for (const [f, n] of tally) if (n > bestN) { best = f; bestN = n; }
        if (!best) return;
        pseudoBodyFs = best;
        for (const { el, t } of cands) {
          if (/[.。]$/.test(t)) continue;
          if (el.closest('li, td, th, blockquote, figcaption, caption, figure, a, button, [role="button"], h1, h2, h3, h4, h5, h6')) continue;
          if (el.querySelector('p, div, ul, ol, table, blockquote, figure, img, picture, video, iframe, svg, h1, h2, h3, h4, h5, h6')) continue;
          const cs = win.getComputedStyle(el);
          const fs = parseFloat(cs.fontSize) || 0;
          if (fs < best * PSEUDO_HEADING_MIN_RATIO) continue;
          // v3.7.7：門檻 600 → 500。pudding 430 寬站方窄版把小標字重降成 500（桌機 700），
          // 小標被壓成內文大小。摘要、引言的字重普查是 300–400，仍排除
          if ((parseInt(cs.fontWeight, 10) || 400) < PSEUDO_HEADING_MIN_WEIGHT) continue;
          pseudoHeadings.push({ el, fs });
        }
      };
      const contrastProbe = [];
      const passContrastProbePhase1 = () => {
        if (!theme.text) {
          const _win = articleEl.ownerDocument?.defaultView;
          if (_win && _win.getComputedStyle) {
            for (const el of articleEl.querySelectorAll(CONTRAST_GUARD_SEL)) {
              if (contrastProbe.length >= CONTRAST_MAX_TARGETS) break;
              // 嵌套容器（table 內 pre 等）只處理最外層，避免疊兩層 inline bg
              if (el.parentElement && el.parentElement.closest && el.parentElement.closest(CONTRAST_GUARD_SEL)) continue;
              const carriers = collectTextCarriers(el, _win);
              const totalLen = carriers.reduce((s2, c) => s2 + c.len, 0);
              if (totalLen < 10) continue; // 太短不具統計意義
              const origBg = compositeBgOver(el, null, WHITE, _win);
              contrastProbe.push({ el, carriers, origBg });
            }
          }
        }
      };

      // v0.8.130：改走 NS.injectCssText（CSP-safe）——嚴格 style-src nonce-only 站
      // （Miniflux 自架閱讀頁）在 WebKit 會擋掉注入 <style>，退回 adoptedStyleSheets。
      // 詳見 namespace.js injectCssText 註解。
      // ─── v1.6.27 rollback 缺口修法：快照欄位提升宣告 ───────────────────
      // 所有 snapshot 欄位在第一個 DOM mutation 之前先以中性值宣告，
      // snapshotNow() 隨時可組出「目前為止做了什麼」的部分快照。apply 中途
      // throw 時 catch 用它自我還原半套副作用後再拋（restore 對每個欄位都有
      // Array.isArray / null 防護，部分快照安全）；上層 main.js catch 接手
      // cleaner 側還原。各欄位的填入點仍在原位（宣告改為賦值）。
      // 漏轉一處會 redeclare SyntaxError,parse 即炸——自帶 forcing。
      let ancestors = [];
      let htmlHadClass = false;
      let firstInk = null;
      let firstInkPriorMt = '';
      let firstInkPriorMtPriority = '';
      const ancestorPaddingSnap = [];
      const negMarginSnap = [];
      const figurePaddingSnap = [];
      const contentWidthSnap = [];
      // v1.7.16：full-bleed translateX 置中對殘留 reset 的還原清單（見 zeroHoriz
      // 後方 pass 註解）
      const translateResetSnap = [];
      const captionFsSnap = [];
      // v2.5.48：passCaptionFontFloor 算出的圖說字級，給 lazy 圖載入後才認出的 div 圖說補寫
      let lateCapFs = 0;
      // v1.7.19：figcaption 靠尾端對齊 reset 的還原清單（見 caption 字級下限
      // pass 後方註解）
      const captionAlignSnap = [];
      let titleFsSnap = null;
      let heroFloorSnap = null;
      const titleLineSnap = [];
      const capReattachSnap = [];
      const galleryFlex = [];
      const ratioBoxes = [];
      const fixedHeightBoxes = [];
      const absFillShells = [];
      const minHeightBoxes = [];
      const textColFlex = [];
      const decolumnLoadCleanup = [];
      const wpConstrained = [];
      const wideScroll = [];
      const cellFloorSnap = [];
      const tableFitSnap = [];
      const ariaCellSnap = [];
      const ariaFlowShellMarked = [];
      const ariaHeaderKeepSnap = [];
      let panguSnap = null;
      const inlineImgs = [];
      const inlineImgPins = [];
      const contentImgs = [];
      const iconImgs = [];
      const upscaleImgs = [];
      const contentImgLoadCleanup = [];
      // v1.9.7：晚 mount img 的補分類入口（passClassifyImages 指派、remarkDynamicMarkers 呼叫）
      let classifyLateImg = null;
      const playerMarked = [];
      // v1.9.15：行內高亮 / 站方浮動工具列標記（SITE_UI_ATTR + PLAYER_ATTR）
      const siteUiMarked = [];
      // v2.4.9：drop cap 首字色修正對象（FIRST_LETTER_ATTR）
      const firstLetterMarked = [];
      let selBgMarked = false;
      const fillIframes = [];
      const embedWrapMarked = [];
      // 2026-10-07 review B-01：class ratio token 容器標記
      const ratioClassMarked = [];
      // v1.8.2：lazy 影片佔位框內的縮圖標記 / ::before aspect 佔位容器標記
      const embedFillMarked = [];
      const aspectPseudoMarked = [];
      const headingLinkMarked = [];
      const absAnchorMarked = [];
      const preFlexStretchMarked = [];
      const defloatTextMarked = [];
      const capMediaMarked = [];
      const shadowHostMarked = [];
      let textDivMarked = [];
      // v1.7.70：pre-wrap 切段記錄（還原用；見 splitPreWrapParagraphs）
      let prewrapParaSnap = [];
      const cjkJustifyMarked = [];
      let rtlBase = false;
      let decorResetMarked = [];
      let leadLetterMarked = [];
      let iconPadMarked = [];
      let inlineFlowPMarked = [];
      const contrastBgSnap = [];
      let themeColorSnap = null;
      let viewportSnap = null;
      const bylineMarks = [];
      const bylineDispSnap = [];
      // v2.5.40：日期與時刻同一段文字時切出來的時刻 span（restore 拆回原文字節點）
      const bylineTimeSplits = [];
      // v1.8.3：首 / 末「可見」direct child 標記（見 EDGE_FIRST_ATTR 註解）
      const edgeMarks = [];
      // v1.8.4：標題不可見 pseudo 間距佔位標記（見 passHeadingPseudoSpacerReset）
      const headingSpacerMarks = [];
      const quoteMarks = [];
      // T12：跨 pass 共享狀態（passGalleryFlex 建立；ratio / fixed-height
      // pass 讀取）——非 snapshot 欄位，restore 不經手
      let mediaAncestors;
      const snapshotNow = () => ({ articleEl, ancestors, htmlHadClass, firstInk, firstInkPriorMt, firstInkPriorMtPriority, ancestorPaddingSnap, negMarginSnap, figurePaddingSnap, contentWidthSnap, translateResetSnap, captionFsSnap, captionAlignSnap, titleFsSnap, heroFloorSnap, titleLineSnap, capReattachSnap, galleryFlex, ratioBoxes, fixedHeightBoxes, absFillShells, minHeightBoxes, textColFlex, decolumnLoadCleanup, wpConstrained, wideScroll, cellFloorSnap, tableFitSnap, ariaCellSnap, ariaFlowShellMarked, ariaHeaderKeepSnap, panguSnap, inlineImgs, inlineImgPins, contentImgs, iconImgs, upscaleImgs, contentImgLoadCleanup, playerMarked, siteUiMarked, fillIframes, embedWrapMarked, ratioClassMarked, embedFillMarked, aspectPseudoMarked, headingLinkMarked, absAnchorMarked, preFlexStretchMarked, defloatTextMarked, capMediaMarked, shadowHostMarked, textDivMarked, prewrapParaSnap, cjkJustifyMarked, decorResetMarked, leadLetterMarked, iconPadMarked, inlineFlowPMarked, contrastBgSnap, themeColorSnap, viewportSnap, bylineMarks, bylineDispSnap, bylineTimeSplits, edgeMarks, headingSpacerMarks, quoteMarks, firstLetterMarked, selBgMarked });

      const passInjectCss = () => {
        NS.injectCssText(STYLE_ID, buildCss(theme, opts, overrides));
        // v2.5.24：一般網站的圖說樣式（獨立樣式表，理由見 buildCss 的 captionOnly）
        {
          const capCss = buildCss(theme, Object.assign({}, opts, { captionOnly: true }), overrides);
          if (capCss) NS.injectCssText(CAPTION_STYLE_ID, capCss); else NS.removeCssText(CAPTION_STYLE_ID);
        }
      };

      const passClassifyImages = () => {
        // inline emoji / icon 標記必須在 ARTICLE_ATTR 設定**前**跑——標記用 rect
        // fallback（viewBox-only SVG / 高解析 emoji PNG 的 naturalWidth 不可靠時
        // 量 rendered 尺寸）必須對「原站 CSS 下的渲染尺寸」量。ARTICLE_ATTR 一旦
        // 設定，buildCss 的 reader 規則（特別是翻頁模式 `img { width: auto !important;
        // max-width: 100% }`）立即生效，會把 viewBox-only SVG emoji 撐成滿欄（150
        // natural → 608px rect）→ rect > INLINE_IMG_MAX → 永遠標不到 inline →
        // emoji 滿版（v0.8.10 翻頁模式 X Twemoji 實機回報、probe 實證 chicken-egg）。
        // 在 ARTICLE_ATTR 前量 = reader 規則尚未 active = 量到原站 inline 尺寸，
        // 標記後再設 ARTICLE_ATTR、img:not([INLINE_IMG_ATTR]) 規則才正確排除 emoji。
        // v0.8.98：viewBox-only SVG 的 inline emoji（WordPress wp-emoji 的國旗 SVG、
        // X Twemoji）naturalWidth 回報 Chrome 預設 150×150 不可靠——通用圖片規則的
        // width:auto 對「無 intrinsic size 的 SVG」解析成容器寬，把 emoji 撐成滿欄
        // （itsmicracing.xyz WordPress 站實測 17px → 603px）。inline-img CSS 規則只設
        // display:inline、未約束 width，救不了。修法：classifyImg 走 rect fallback
        // （natural 不可靠）標 inline 時，把量到的 rendered px 釘成 inline !important
        // width/height——分類在 ARTICLE_ATTR 設定前跑，rect 仍是原站 emoji 尺寸（1em ≈
        // 17px）。natural 可靠的 PNG emoji（natural ≈ rendered）走 width:auto 即正確、
        // 不需 pin。記 prev 供 restore 對稱還原（與 capIconImg 同款）。
        const pinInlineImg = (img, w, h) => {
          inlineImgPins.push({
            img,
            prevW: img.style.getPropertyValue('width'),
            prevWP: img.style.getPropertyPriority('width'),
            prevH: img.style.getPropertyValue('height'),
            prevHP: img.style.getPropertyPriority('height'),
          });
          img.style.setProperty('width', Math.round(w) + 'px', 'important');
          img.style.setProperty('height', Math.round(h) + 'px', 'important');
        };
        // v0.8.90：把作者刻意縮小的小圖釘回原始顯示寬。量到的 renderedW 以 inline
        // !important max-width 覆寫，杜絕 img:not(a>img) 的 width:auto 退回
        // naturalWidth 放大。記 prev 供 restore 對稱還原（與 titleFsSnap 同款）。
        // v1.8.5：inline !important 不是 cascade 的保證勝局——換日線實測，jread 自己
        // 的 `img:not(a > img) { max-width:100% !important }` 與 `html [ARTICLE]
        // :not([PLAYER]) { max-width:100% !important }` 就贏過 img 的 inline
        // `max-width:150px !important`（把這兩條 deleteRule 掉，頭像立刻收回 150px，
        // cage 實證）。因此釘寬同時走第二條通道：把值放進 inline custom property
        // `--jread-icon-max`，由下方 tripled-attr CSS 規則（specificity 0,4,1，
        // 高過上述兩條）消費。inline max-width 保留當第一通道（多數站有效、既有
        // spec 依賴），兩條同值、無視覺差。
        const capIconImg = (img, renderedW) => {
          if (img.hasAttribute(ICON_IMG_ATTR)) return;
          iconImgs.push({
            img,
            prevMw: img.style.getPropertyValue('max-width'),
            prevMwP: img.style.getPropertyPriority('max-width'),
            prevVar: img.style.getPropertyValue('--jread-icon-max'),
            prevW: img.style.getPropertyValue('width'),
            prevWP: img.style.getPropertyPriority('width'),
          });
          img.setAttribute(ICON_IMG_ATTR, '1');
          img.style.setProperty('max-width', Math.round(renderedW) + 'px', 'important');
          img.style.setProperty('--jread-icon-max', Math.round(renderedW) + 'px');
          // v1.8.5 第三通道：直接釘 width。換日線實測連 tripled-attr CSS 規則
          // （specificity 0,4,1、!important、確認 matches）都輸給 jread 自己那兩條
          // max-width:100%，但同一元素的 inline width !important 照樣生效（cage
          // 逐條實驗）——max-width 這個屬性在該頁被某個 cascade 位階鎖住，width 沒有。
          // min(Xpx, 100%) 而非 Xpx：容器比原顯示寬更窄時（手機版心）仍收斂，不溢出。
          img.style.setProperty('width', `min(${Math.round(renderedW)}px, 100%)`, 'important');
        };
        // v1.7.43 T11：content 尺寸量測（natural 優先、不可靠時 rect fallback，
        // 任一維 >= CONTENT_IMG_MIN）——tryMarkContentImg / tryMarkUpscaleImg
        // 共用（原兩份逐字重複）
        // v1.8.5：`!complete` 時 naturalWidth/Height 是**上一張 src 的殘值**，不是
        // 這張圖的尺寸——cleaner.hydrateLazyImages 把 data-src 換進 src 後、新圖
        // 載入前，naturalWidth 仍停在 lazy placeholder 的大小。換日線作者頭像實測：
        // placeholder 630×2（1px 佔位條）→ 630 >= CONTENT_IMG_MIN 直接判 content
        // size → 站方顯示 150×150 的頭像即時被標 upscale（width:100% 撐成 608×608
        // 圓形滿版蓋住 bio），連 load listener 補分類的機會都沒有。
        // 未載入時只信 `img.width`（HTML 屬性 / rendered 寬）與 rect——都是站方
        // CSS 決定的顯示尺寸，才是「這是不是一張內容配圖」的可靠訊號。
        const measureIsContentSize = (img) => {
          const natW = img.complete ? img.naturalWidth : 0;
          const natH = img.complete ? img.naturalHeight : 0;
          if ((natW || img.width) >= CONTENT_IMG_MIN ||
              (natH || img.height) >= CONTENT_IMG_MIN) return true;
          const r = img.getBoundingClientRect();
          return r.width >= CONTENT_IMG_MIN || r.height >= CONTENT_IMG_MIN;
        };
        // 量 img 尺寸 >= CONTENT_IMG_MIN 即標 content-img；回傳是否已標（含先前
        // 已標）。load listener 補標時重用。
        const tryMarkContentImg = (img) => {
          if (img.hasAttribute(CONTENT_IMG_ATTR)) return true;
          if (img.hasAttribute(INLINE_IMG_ATTR)) return false;
          if (measureIsContentSize(img)) { img.setAttribute(CONTENT_IMG_ATTR, '1'); contentImgs.push(img); return true; }
          return false;
        };
        // v0.8.112：bare 內容圖（非 a 包）放大填滿欄寬。量 content-size（natural 優先、
        // 不可靠時 rect fallback）>= CONTENT_IMG_MIN 即標 upscale；回傳是否已標。lazy
        // bare 圖 load 後補標重用（與 tryMarkContentImg 同款）。
        // v2.5.27：siteRect＝這張圖在站方 cascade 下的顯示 rect（即時路徑是當下 rect、
        // 補分類路徑是 preRect 快照），給 setUpscaleCap 算「不超過原尺寸」的上限。
        const tryMarkUpscaleImg = (img, siteRect) => {
          if (img.hasAttribute(UPSCALE_IMG_ATTR)) return true;
          if (img.hasAttribute(INLINE_IMG_ATTR) || img.hasAttribute(ICON_IMG_ATTR)) return false;
          if (measureIsContentSize(img)) {
            img.setAttribute(UPSCALE_IMG_ATTR, '1');
            upscaleImgs.push(img);
            setUpscaleCap(img, siteRect);
            return true;
          }
          return false;
        };
        // v2.5.27：內文圖顯示寬不超過原尺寸（Jimmy 2026-11-19；rss 文章 256px 斑馬圖
        // 被撐成 688px 實證）。上限＝max(naturalWidth, 進 reader 前站方顯示寬)——只擋
        // reader 造成的放大，站方自己就顯示得比來源大的圖維持原樣（與 v1.7.57 低解析
        // 上限同一條準則）。值寫進 inline 自訂屬性，由 UPSCALE CSS 規則的 min() 消費；
        // 不寫 inline width / max-width（v1.8.5：max-width 在部分頁面輸給自家規則）。
        // 還沒載入的圖（已靠 width 屬性 / 預留 rect 標記）natural 還不可信，載入後再寫。
        // SVG 不設上限（解析度無關，naturalWidth 是瀏覽器預設值）。
        function setUpscaleCap(img, siteRect) {
          const src = img.currentSrc || img.src || '';
          if (/\.svg(\?|#|$)/i.test(src) || /^data:image\/svg/i.test(src)) return;
          const siteW = siteRect ? Math.round(siteRect.width) || 0 : 0;
          const write = () => {
            if (!img.hasAttribute(UPSCALE_IMG_ATTR) || !(img.naturalWidth > 1)) return;
            const cap = Math.max(img.naturalWidth, siteW);
            img.style.setProperty('--jread-upscale-max', cap + 'px');
          };
          if (img.complete) { write(); return; }
          const onLoad = () => write();
          img.addEventListener('load', onLoad);
          contentImgLoadCleanup.push({ img, onLoad });
        }
        // img 分類（inline emoji / content-img）。抽成 classifyImg 供「即時」與
        // 「lazy 圖 load 後補分類」共用。
        // v0.7.214：natural 尺寸對「無 intrinsic size 的 SVG」不可靠——Chrome 對
        // 只有 viewBox 的 SVG 回報 CSS replaced element 預設 150×150（X/Twitter
        // 的 Twemoji emoji SVG 實測命中），高解析 emoji PNG（Twemoji PNG 原檔
        // 72×72）也會超過上限。rendered 尺寸才是「這張圖在文中是 icon / emoji」的
        // 視覺事實：natural 判定 miss 時 fallback 量 rect，兩維皆 > 0 且 <=
        // INLINE_IMG_MAX 即標 inline。只在 miss 時量、避免對每張內容圖都 force layout。
        // v0.8.89：natural 兩維皆 <= 1 = lazy library 的 1×1 blank gif placeholder
        // 簽名（kknews.cc 實測），**不可**據此判 inline——否則整片未載入的內容照片
        // 被當 inline emoji 標記、載入後維持 inline 不被 media block 規則撐開（全圖
        // 1×1 視覺消失）。此時跳過 natural 判定、一律改用 rect（站點通常已用
        // padding-bottom sizer 預留 reserved 尺寸，rect 可信）。
        // v1.8.5：`preRect` = 這張 img 在「reader CSS 尚未套用」時的 rendered rect
        // 快照，只由 lazy 圖的 load listener 補分類路徑傳入（見下方兩處 onLoad）。
        // 動機：下面兩條防放大 gate（capIcon / v1.7.57 低解析上限）判的是「站方
        // 自己把這張圖顯示成多大」，必須量原站 CSS 下的尺寸；補分類發生在圖載入
        // 之後，那時 ARTICLE_ATTR 早已設定、reader stylesheet 生效，即時 rect 量
        // 到的是「已被 reader 撐開後」的值（換日線作者頭像實測 608×608），gate 的
        // rect 門檻永遠不可能命中 → 等於整條防放大保護對 lazy 圖失效。
        // 即時路徑不傳 preRect（此時 rect 本來就是原站值），行為完全不變。
        // v2.5.5：「被同層真圖蓋住的佔位圖」判定（呼叫端已確認 img 是已載入的低解析
        // 圖：natural 兩維 < CONTENT_IMG_MIN、非 SVG）。三個條件全成立才算：
        //   1. img 在站方 cascade 下是 position:absolute（不佔版面的疊層）
        //   2. 同一個父元素下另有一張 in-flow（非 absolute / fixed）的 img，其 rect
        //      完整涵蓋本圖（±2px）——版面位置由那張圖負責
        //   3. 那張圖是「真圖」：尚未載入，或來源解析度比本圖大；且不是 data: /
        //      SVG（那是 sizer——AMP 類「in-flow 透明 sizer＋absolute 真圖」的方向
        //      相反，真圖是 absolute 的那張，不可藏）
        // 不命中的鄰近形狀（刻意）：absolute 的那張是高解析圖（blur(0) 載完的 zoom
        // overlay、輪播疊層）→ 呼叫端低解析門檻就擋掉；真圖還沒有預留尺寸（rect 0）
        // → 條件 2 不成立，佔位圖照舊留著撐版面；只有佔位圖、真圖晚 append → 沒有
        // 同層第二張圖。
        const isCoveredPlaceholder = (img, gr) => {
          const par = img.parentElement;
          if (!par || !gr || !(gr.width > 0 && gr.height > 0)) return false;
          const view = img.ownerDocument.defaultView;
          if (view.getComputedStyle(img).position !== 'absolute') return false;
          for (const o of par.children) {
            if (o === img || o.tagName !== 'IMG') continue;
            const src = o.currentSrc || o.src || '';
            if (!src || /^data:/i.test(src) || /\.svg(\?|#|$)/i.test(src)) continue;
            if (o.complete && !(o.naturalWidth > img.naturalWidth)) continue;
            const op = view.getComputedStyle(o).position;
            if (op === 'absolute' || op === 'fixed') continue;
            const or = o.getBoundingClientRect();
            if (gr.top >= or.top - 2 && gr.bottom <= or.bottom + 2 &&
                gr.left >= or.left - 2 && gr.right <= or.right + 2) return true;
          }
          return false;
        };
        // v2.5.24（arstechnica 小圖與圖說被壓成 76–148px）：apply 當下對「還沒載入」的
        // lazy 圖拍的快照，不一定是站方的顯示尺寸。站方把 figure 做成 shrink-to-fit
        // （display:table ＋ figcaption table-caption）、圖用 width:100% 時，未載入的圖
        // 沒有 intrinsic 寬度 → figure 塌成圖說的 min-content（最長單字，CJK 譯文約兩個
        // 字寬）→ 快照量到 76–148px。圖載入後 capIcon 拿這個快照判成「站方刻意縮小的
        // 大圖」把寬度釘死，圖與圖說就永遠停在塌掉的寬度。
        // 載入後在站方 cascade 下（停用注入 CSS）重量一次；只在三個條件全成立時才改用
        // 重量的結果：
        //   1. 重量的寬度明顯大於快照（> 1.5 倍）——快照是塌掉的
        //   2. 不超過來源解析度（naturalWidth）——不是被撐大
        //   3. 不超過 HTML width 屬性——站方自己宣告的顯示尺寸；沒有這個屬性就不改
        // 條件 2、3 擋的是「頭像所在的 flex 列已被 decolumn 成 block、站方 width:100%
        // 把頭像撐到版心寬」（換日線 / propublica，v1.8.5 / v1.7.57）：那種情況重量到的
        // 寬度會超過屬性或來源解析度，照舊信快照。
        const settleLazySnap = (img, snap) => {
          if (!snap || !img.complete || !(img.naturalWidth > 1)) return snap;
          const attrW = parseInt(img.getAttribute('width'), 10);
          if (!(attrW > 0) || !NS.withInjectedCssDisabled) return snap;
          let late = null;
          try { late = NS.withInjectedCssDisabled(() => img.getBoundingClientRect()); } catch (_) { return snap; }
          if (late && late.width > snap.width * 1.5 &&
              late.width <= img.naturalWidth + 1 && late.width <= attrW + 1) return late;
          return snap;
        };
        const classifyImg = (img, preRect) => {
          if (img.hasAttribute(INLINE_IMG_ATTR) || img.hasAttribute(CONTENT_IMG_ATTR) || img.hasAttribute(ICON_IMG_ATTR)) return;
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          // natPlaceholder 用 naturalX || X 為基準（與下方 w/h 同源）——img 有真實
          // width 屬性（如 lazy a>img width=608）時不可誤判成 1×1 placeholder。
          const natPlaceholder = w <= 1 && h <= 1;
          // 2026-10-07 review B-06：圖「還在載入」（!complete）且不是 load 後的補分類
          // （無 preRect）時，natural 與 rect 都是**上一張 src**（LQIP / blur-up 20px
          // 佔位圖）的殘值——cleaner.hydrateLazyImages 剛把 data-src 換進 src、新圖
          // 尚未到。v1.8.5 已讓 measureIsContentSize 對 !complete 不信 natural，但
          // inline 判定沒套同一準則：殘值 20×20 → 立即標 INLINE_IMG 並 return，之後
          // hasAttribute 早退、load 也不重判 → 1200px 內容圖永久 display:inline、無
          // 置中 / 90vh cap / 翻頁單頁 cap（真 Chromium 合成 blur-up 頁實證：hydrate
          // 後 complete=false、natural 0×0、rect 20×20 → inline=1，載入後仍 inline）。
          // 此刻不做 inline 判定，交給下方 a 包 / bare 分支既有的 load listener 帶
          // apply 當下快照重跑 classifyImg（preRect 非空＝圖已載入、natural 可信）。
          // 已載入的真 emoji（complete、natural 20）不受影響，照舊即時標 inline。
          const unloaded = !img.complete && !preRect;
          let isInline = !unloaded && !natPlaceholder &&
                         w > 0 && w <= INLINE_IMG_MAX && h > 0 && h <= INLINE_IMG_MAX;
          let r = null;
          let inlineViaRect = false;
          if (!isInline && !unloaded) {
            r = img.getBoundingClientRect();
            isInline = r.width > 0 && r.width <= INLINE_IMG_MAX &&
                       r.height > 0 && r.height <= INLINE_IMG_MAX;
            inlineViaRect = isInline;
          }
          if (isInline) {
            img.setAttribute(INLINE_IMG_ATTR, '1');
            inlineImgs.push(img);
            // natural 不可靠（viewBox-only SVG 等）時走 rect fallback 標到的 inline——
            // 釘原站 rendered 尺寸，杜絕 width:auto 把無 intrinsic size 的 SVG 撐成滿欄
            // （見 inlineImgPins 註解）。natural 可靠（natural <= INLINE_IMG_MAX）的小圖
            // 不需釘：width:auto 已正確退回 natural 尺寸。
            if (inlineViaRect && r) pinInlineImg(img, r.width, r.height);
            return;
          }
          // v0.8.90：「作者刻意縮小的大圖」防放大。INLINE_IMG_MAX (48px) 與
          // CONTENT_IMG_MIN (200px) 之間的小圖（48 < rect < 200）落在兩個門檻中間：
          // 不算 inline emoji、不算內容照片。裸 img 落入 img:not(a>img) 的 width:auto →
          // 退回 naturalWidth 撐成滿版（washingtonpost lightbulb badge 56→788px 實證）。
          // 結構訊號：已載入（complete + natural > 1）、pre-reader rendered rect 兩維皆
          // < CONTENT_IMG_MIN、且 natural 明顯大於 rendered（作者把大來源圖顯示縮小）→
          // reader 不該反向放大，釘回原始顯示寬。natural ≈ rendered 的真實小圖不命中
          // （width:auto 本來就給 natural≈rendered、無放大、不必釘）。lazy placeholder
          // （!complete / natural<=1）此刻量不準，交給上方 load listener 載入後重判。
          //
          // v1.0.7：移除原本的 `!img.closest('a')` 排除——a 包的縮小大圖同樣會破版，
          // 只是路徑不同：a-wrapped 不走 width:auto blowup（被 :not(a>img) 排除），而是
          // 落入下方 a-wrapped 分支被 tryMarkContentImg 標成 content-img → 強制 block +
          // 撐滿欄寬（autocar.co.uk 作者欄 <a><div.personality-image><img></div></a>
          // 頭像 natural 3309 / rect 142 被放大成 608、溢出固定高 142px 的裁切容器、疊到
          // bio 文字上＝圖疊文，cage probe 實證）。capIcon 幾何 gate（兩維皆 48~200 +
          // natural > rect×1.5）夠精確：lightbox 內容圖 render >= 200 不命中本支、照走下方
          // content-img 分支（styler-lightbox-content-image-margin.spec 不退步）。capIcon
          // 必須在 a-wrapped content-img 分支**之前**（縮小頭像優先當 icon 釘小，不當內容圖
          // 放大）——本判斷已在該分支上方，移除排除即生效。
          if (img.complete && img.naturalWidth > 1 &&
              img.getAttribute(PLAYER_ATTR) !== '1') {
            // v1.8.5：站方顯示尺寸一律取 preRect（有的話）——見 classifyImg 簽名註解
            const gr = preRect || r || (r = img.getBoundingClientRect());
            if (gr.width > INLINE_IMG_MAX && gr.width < CONTENT_IMG_MIN &&
                gr.height > INLINE_IMG_MAX && gr.height < CONTENT_IMG_MIN &&
                img.naturalWidth > gr.width * 1.5) {
              capIconImg(img, gr.width);
              return;
            }
          }
          // v1.7.57（2026-08-08 page rounds，propublica 作者頭像撐成 608×608
          // 圓形蓋住 bio）：**低解析度來源圖不得被 reader 放大**。
          // 上面的 capIcon 閘要求 `naturalWidth > rect × 1.5`（＝「站方把大來源圖
          // 顯示縮小」），對 natural ≈ rendered 的小圖（頭像 / badge / logo）完全
          // 不命中，這類圖等於沒有任何寬度保護：一旦其所在的 flex 列被 decolumn
          // 成 block，容器從 shrink-to-fit 變成撐滿版心，站方自己的
          // `img { width: 100% }`（WordPress `.wp-block-post-featured-image img`
          // 是預設）就把 70×70 的頭像放大到 608×608、溢出固定高的 figure 疊在
          // 後續文字上。
          // 結構通則：把 70px 的來源圖撐到 608px 在任何站都只會糊掉，是無條件錯的。
          // 上限取 `max(naturalWidth, 進 reader 前的 rendered 寬)`——**只擋 reader
          // 造成的放大，不縮小站方自己就顯示得比原始解析度大的圖**（那是站方意圖，
          // 維持原樣）。
          // 排除項：inline emoji（上面已 return）、player、lazy placeholder
          // （!complete / natural <= 1，此刻量不準，交給 load listener 重判）、
          // SVG（解析度無關，naturalWidth 對 viewBox-only SVG 是 Chrome 預設 150、
          // 拿來當上限會誤縮）。
          const isSvgImg = (im) => /\.svg(\?|#|$)/i.test(im.currentSrc || im.src || '') ||
            /^data:image\/svg/i.test(im.currentSrc || im.src || '');
          if (img.complete && img.naturalWidth > 1 &&
              img.getAttribute(PLAYER_ATTR) !== '1' &&
              img.naturalWidth < CONTENT_IMG_MIN && img.naturalHeight < CONTENT_IMG_MIN &&
              !isSvgImg(img)) {
            // v1.8.5：同上，「進 reader 前的 rendered 寬」對 lazy 補分類路徑＝preRect
            const gr = preRect || r || (r = img.getBoundingClientRect());
            // v2.5.5（bbc culture 中段空白）：低解析圖在站方是 position:absolute、
            // 疊在同一父層某張 in-flow 真圖的範圍內＝被真圖蓋住的佔位圖，不是內容。
            // 只在即時路徑判（!preRect：ARTICLE_ATTR 尚未設定，computed position 仍是
            // 站方值；補分類路徑的 position 已被 reader 改成 static、量不到）。
            if (!preRect && isCoveredPlaceholder(img, gr)) {
              iconImgs.push({
                img,
                prevMw: img.style.getPropertyValue('max-width'),
                prevMwP: img.style.getPropertyPriority('max-width'),
                prevVar: img.style.getPropertyValue('--jread-icon-max'),
                prevW: img.style.getPropertyValue('width'),
                prevWP: img.style.getPropertyPriority('width'),
              });
              img.setAttribute(ICON_IMG_ATTR, '1');
              img.setAttribute(COVERED_PH_ATTR, '1');
              return;
            }
            const cap = Math.max(img.naturalWidth, Math.round(gr.width) || 0);
            if (cap > 0) { capIconImg(img, cap); return; }
          }
          // 大內容圖被 `<a>`（lightbox / photoswipe）包住時，img:not(a > img) 的
          // block + margin 規則會漏掉它 → 維持原站 display:inline + 小 margin（巴哈
          // forum.gamer.com.tw a.photoswipe-image > img 實測 inline + 4px margin、
          // 圖文幾乎貼著）。量到 >= CONTENT_IMG_MIN 且祖先有 `<a>` 的 img 標記為
          // content-img，CSS 對它強制 block + 對稱 margin。inline emoji 已在上面
          // 排除、不會誤標。
          //
          // 自適應 lazy-load（v0.8.11 修正）：apply() 在 document_idle 跑，巴哈這類
          // 整篇 lazyload 圖在 toggle 當下多數還沒載入——naturalWidth=0、無 width 屬性、
          // rect 是 placeholder 小尺寸 → big 判定失敗、漏標 → 圖載入後 naturalWidth 變
          // 大但標記不會重跑，下方 32/34 張圖維持 inline + 4px margin 貼著文字（Jimmy
          // 2026-06-09 截圖實證）。修法：未即時標到的 a-wrapped img 掛 once load
          // listener，圖載入時 tryMarkContentImg 重量、夠大就補標（CSS 即時生效加
          // margin）。below-fold lazy 圖在使用者捲到時才 load → 屆時才標，自適應載入時序。
          if (img.closest('a')) {
            if (!tryMarkContentImg(img) && !img.complete) {
              // v1.8.5：補標改走完整 classifyImg（帶 pre-reader rect 快照），不再
              // 只跑 tryMarkContentImg——後者繞過上方兩條防放大 gate，lazy 頭像
              // 載入後直接被當內容圖撐滿版心（見 classifyImg 簽名註解）。
              const snap = preRect || img.getBoundingClientRect();
              const onLoad = () => classifyImg(img, settleLazySnap(img, snap));
              img.addEventListener('load', onLoad);
              contentImgLoadCleanup.push({ img, onLoad });
            }
            return;
          }
          // v0.8.112：bare 內容圖（非 a 包、非 player）來源解析度小於版心時放大填滿
          // 欄寬。走到這裡的 bare img 已排除 inline emoji（上面 return）、capIcon（作者
          // 刻意縮小的大圖，上面 return）——剩下的就是「站點以原尺寸或小幅放大顯示的
          // 配圖」。content-size（>= CONTENT_IMG_MIN 一維）標 upscale、CSS width:100%
          // 撐滿欄寬；< CONTENT_IMG_MIN 的小圖（logo / 短橫幅）不標、維持 width:auto
          // 原尺寸（不反向放大成滿版）。lazy bare 圖同 a 包路徑掛 load listener 補標。
          if (img.getAttribute(PLAYER_ATTR) !== '1') {
            if (!tryMarkUpscaleImg(img, preRect || r || (r = img.getBoundingClientRect())) && !img.complete) {
              // v1.8.5：同 a 包路徑——補標走完整 classifyImg + pre-reader 快照。
              // 換日線作者頭像實證（Jimmy 2026-09-03）：站方顯示 150×150、來源
              // 300×300 的 lazy 頭像，cleaner hydrate 後在 apply 當下 !complete →
              // 舊路徑載入後只跑 tryMarkUpscaleImg（natural 300 >= 200 即標
              // upscale）→ width:100% 撐成 608×608 圓形滿版。
              const snap = preRect || img.getBoundingClientRect();
              const onLoad = () => classifyImg(img, settleLazySnap(img, snap));
              img.addEventListener('load', onLoad);
              contentImgLoadCleanup.push({ img, onLoad });
            }
          }
        };
        // v1.9.7：晚 mount 的 img 補分類（cleaner dynamic observer → remarkDynamicMarkers）。
        // AMP `layout="intrinsic"` 捲到附近才 build 真圖——apply 當下 img 還不存在，
        // 上面的迴圈與 load listener 都接不到，圖永遠不標 upscale、停在站方原寬
        // （cuphistory 同頁：先 build 的肖像撐滿版心、晚 build 的城堡 / 蘇維埃宮停在
        // 440 / 436px）。preRect 在停用 JRead 注入 CSS 下量＝原站 cascade 的顯示尺寸，
        // capIcon / 低解析上限兩條防放大 gate 對晚到的圖一樣有效（見 classifyImg 簽名註解）。
        // 2026-10-07 review B-05：定義搬到下方靜態迴圈**之前**——迴圈的 0×0 placeholder
        // 路徑也走這條（見該處註解），const 賦值必須先於使用。
        classifyLateImg = (img) => {
          if (!img || img.tagName !== 'IMG' || !articleEl.contains(img)) return;
          if (img.hasAttribute(INLINE_IMG_ATTR) || img.hasAttribute(CONTENT_IMG_ATTR) ||
              img.hasAttribute(ICON_IMG_ATTR) || img.hasAttribute(UPSCALE_IMG_ATTR)) return;
          const run = () => {
            const snap = NS.withInjectedCssDisabled
              ? NS.withInjectedCssDisabled(() => img.getBoundingClientRect())
              : img.getBoundingClientRect();
            classifyImg(img, snap);
          };
          if (img.complete && img.naturalWidth > 1) { run(); return; }
          const onLoad = () => run();
          img.addEventListener('load', onLoad, { once: true });
          contentImgLoadCleanup.push({ img, onLoad });
        };
        for (const img of articleEl.querySelectorAll('img')) {
          // v0.8.89：natural 1×1 placeholder 且連 rect 都還沒 reliable（0×0 未渲染）
          // → 此刻完全無從分類，等圖真正載入後再分類（hydrateLazyImages 換上真 src
          // 後會觸發 load）。站點有預留 reserved 尺寸的 lazy 圖 rect 非 0、直接
          // classifyImg 走 rect fallback 即可。
          // 2026-10-07 review B-05：改走 classifyLateImg——舊路徑 load 後呼叫
          // `classifyImg(img)` 不帶 preRect，v1.8.5 的兩道防放大 gate 量到的是 reader
          // 撐開後的 rect（真 Chromium 合成頁實證：無尺寸屬性、站方 CSS max-width:150
          // 的 lazy 頭像 apply 當下 rect 0×0，載入後 rect 608、natural 300 → capIcon
          // miss、低解析 gate miss → 標 upscale 撐成 608×608）。apply 當下的快照對這
          // 條路徑是 0×0、毫無參考價值，唯一可信的「站方顯示尺寸」是 load 時停用注入
          // CSS 再量（classifyLateImg 既有形狀）。三條 lazy 入口的「無快照」情境至此
          // 收斂成同一條。
          const natPlaceholder = (img.naturalWidth || img.width) <= 1 && (img.naturalHeight || img.height) <= 1;
          if (natPlaceholder) {
            const r = img.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) {
              classifyLateImg(img);
              continue;
            }
          }
          classifyImg(img);
        }
      };

      const passSplitPreWrapParas = () => {
        // v1.7.70：pre-wrap 硬換行切成真段落（見 splitPreWrapParagraphs）。
        // 必須在 passMarkTextDivs **之前**——切出的段落載體要被 markTextDivs
        // 標成 TEXT_DIV_ATTR 才吃得到段距 / 字級 / 行距（段落規則單一資料源）。
        // 同時必須在 passInjectCss 之前：本 pass 靠 computed white-space 判定
        // 候選，reader stylesheet 一旦注入就量不到原站值（carousel 那組規則會
        // 把 white-space 覆寫成 normal）。
        prewrapParaSnap = splitPreWrapParagraphs(articleEl);
      };

      const passMarkTextDivs = () => {
        // v0.8.49：「div 當段落」標記必須在 ARTICLE_ATTR 設定**前**跑——主流字級
        // 判定要量「原站 CSS 下的字級」；ARTICLE_ATTR 一旦設定，BODY_TEXT_SEL 的
        // font-size 規則對 article 根生效，繼承鏈被改、量到的是注入後的值。
        textDivMarked = markTextDivs(articleEl);
      };

      const passMarkIconPadLinks = () => {
        // v2.5.34：量站方的背景圖示與 padding，必須在 ARTICLE_ATTR 設定前（之後背景被清掉）
        iconPadMarked = markIconPadLinks(articleEl);
        // v3.7.9：遮罩／背景圖畫的行內 pseudo 圖示（同樣要在背景被清掉前量）
        iconPadMarked = iconPadMarked.concat(markMaskedIconPseudos(articleEl));
        // v3.7.13：圖說裡左右邊距不對稱的區塊（同樣要在 ARTICLE_ATTR 設定前量站方邊距）
        iconPadMarked = iconPadMarked.concat(markCaptionAsymMargins(articleEl));
      };

      const passSetArticleAttr = () => {
        articleEl.setAttribute(ARTICLE_ATTR, '1');
      };

      // v1.6.24：markCjkParagraphs / markDecorativeInlines 移到 byline / kicker
      // 標記之後（見 bylineMarks 區塊尾）——兩函式的
      // `closest([BYLINE_ATTR], [KICKER_ATTR])` 排除 guard 需要標記已存在，
      // 舊順序（此處）跑在 byline 標記前，guard 永遠 miss、中文 byline
      //（「文／某某」CJK 佔比達標）會被 justify。

      const passMarkPlayers = () => {
        // v0.7.182：mark video player container descendants——背景/色彩
        // strip CSS 加 :not([data-jread-player]) 排除 player 子結構。
        // JW Player 的 poster（.jw-preview background-image: url(thumb)）、
        // 控制列（.jw-controls bg-color）、play 按鈕 overlay 等仰賴
        // background-image/color 呈現 UI。通則：<video> 的最近 N 層祖先
        // 及所有後代標記為 player 結構、不被 background strip 清除。
        // <iframe> 不標記：YouTube/Vimeo embed 的 poster 在 iframe 內部
        // document，reader card CSS 影響不到。
        // v0.7.183 修正：只標到 player root（position:relative + overflow:hidden
        // 的最近祖先），不標外層 layout wrapper。JW Player 結構：
        //   video → jw-media(abs) → jw-wrapper(abs) → jwplayer(rel+ovH) → layout wrappers
        // 外層 wrapper 必須被 card max-width/position 約束，否則 player 溢出遮字。
        // v0.7.182 走 4 層太高，把 wp-block-group layout wrapper 也排除了。
        // 2026-10-07 review B-04 / A-31：root 判定收斂到 NS.findVideoPlayerRoots
        // （與 cleaner.resetMediaPlaceholderPadding 共用單一資料源），且量的是
        // **站方原始 cascade**（函式內 withInjectedCssDisabled）。舊版在這裡直接
        // getComputedStyle——本 pass 排在 passInjectCss / passSetArticleAttr 之後，
        // `<video>` 的直接父層此刻已被 MEDIA_DIRECT_WRAP_SEL 打成 static，「直接
        // 父層就是 player root」的結構（hero 影片固定高裁切框、新式 player 的
        // media container）永遠偵測不到 → root 被當一般媒體容器攤平（height:auto
        // + static），poster / 控制列等 absolute 子層全部回 flow 疊成一長條。
        // v0.7.225 的「root 含主文長段落 → 不是 player」guard 也住在該函式。
        const playerRoots = NS.findVideoPlayerRoots(articleEl);
        for (const vid of articleEl.querySelectorAll('video')) {
          // v0.8.105：是否找到「真 player root」（relative + overflow:hidden 的
          // 自包覆容器，JW Player 等成熟播放器的 chrome wrapper 結構）。沒找到時
          // 走下面 fallback；fallback 只標 <video> 本身、不標站點包裝容器（理由見下）。
          let container = playerRoots.get(vid) || null;
          const foundGenuineRoot = !!container;
          // v0.8.105：沒有真 player root（relative+overflow:hidden）時，只標 <video>
          // 本身、不把站點的 fallback 包裝容器整支標 PLAYER_ATTR。
          // 根因：wikiHow Tie-a-Tie 步驟用「inline 自動播放示範影片」結構——
          // DIV.video-container.content-fill（position:absolute，內含 poster img +
          // video，無 relative+overflow:hidden 自包覆 root）。整支標 player 會把這個
          // absolute 容器凍結在所有 position/height reset 之外 → 容器不貢獻 flow 高度
          // → 祖先（.mwimg.whvid）塌成 16px → 309px 的 absolute 圖壓住後續 step 文字
          //（Jimmy 2026-06-18 寬版心截圖）。只標 video 後，container 與 poster img
          // 改走一般媒體正規化（:has(>media) height:auto + 含媒體容器 position:static）
          // 回到流內撐高、不再壓字；video 播放層自身仍受 player 保護不被 strip。
          // 真 player root（JW 等）找得到時不受影響——subtree chrome 保護照舊。
          if (!foundGenuineRoot) container = vid;
          container.setAttribute(PLAYER_ATTR, '1');
          playerMarked.push(container);
          for (const el of container.querySelectorAll('*')) {
            el.setAttribute(PLAYER_ATTR, '1');
            playerMarked.push(el);
          }
        }
      };

      const passMarkRatioClassBoxes = () => {
        // 2026-10-07 review B-01：必須在 passSetArticleAttr 之前（見函式註解）
        markRatioClassBoxes(articleEl, ratioClassMarked);
      };

      const passMarkEmbedHeadingAbsAnchors = () => {
        // v1.6.30（#13）：EMBED_WRAP / HEADING_LINK 標記。必須在下方 FILL_IFRAME
        // 量測**之前**跑——EMBED_WRAP_ATTR 讓 static-flow 規則豁免 embed 子樹，
        // FILL_IFRAME 的 getComputedStyle 才量得到 absolute（與原 :not(:has(iframe))
        // 的同刻語意一致；量測會 flush style、attr 已就位）。
        markEmbedWrapIframes(articleEl, embedWrapMarked, embedFillMarked, siteUiMarked);
        // v2.5.18：背景圖影片佔位殼的縮圖 / 播放鍵保留站方配色（見 markBgFacadeUi）
        markBgFacadeUi(articleEl, siteUiMarked);
        markHeadingLinks(articleEl, headingLinkMarked);
        // v1.7.45：absolute/fixed 錨定豁免標記（在 ARTICLE_ATTR 設定後量，見函式註解）
        markAbsAnchors(articleEl, absAnchorMarked);
        // v2.5.14：直向 flex 容器的直接子 <pre> 不置中（同樣要在 ARTICLE_ATTR 之後量）
        markFlexColumnPres(articleEl, preFlexStretchMarked);
        // v2.5.24：站方 float 的文字方塊撐滿版心（同樣要在 ARTICLE_ATTR 之後量）
        markDefloatedTextBoxes(articleEl, defloatTextMarked);
        // v3.7.6：通用 float: none 的副作用（短字標記保留 float、靠 float 成區塊的行內元素改 block）
        markSiteFloatSideEffects(articleEl, defloatTextMarked);
        // v3.7.7：清單縮排、pseudo 操作提示字（同一份還原清單）
        markListMarkerIndent(articleEl, defloatTextMarked);
        markUiHintPseudo(articleEl, defloatTextMarked);
        // v2.5.23：圖說上方的媒體與圖說標記（見 markCaptionMedia；要在 PLAYER / INLINE_IMG
        // 標記之後——兩者都在更早的 pass）
        markCaptionMedia(articleEl, capMediaMarked, contentImgLoadCleanup, (cap) => {
          if (!lateCapFs) return;
          captionFsSnap.push({ el: cap, fs: cap.style.getPropertyValue('font-size'), fsP: cap.style.getPropertyPriority('font-size') });
          cap.style.setProperty('font-size', lateCapFs + 'px', 'important');
        });
        markFlexRowCodeShells(articleEl, capMediaMarked);
        // v2.5.16：shadow DOM 元件的 color-scheme 跟著卡片（見 markShadowHosts）
        markShadowHosts(articleEl, shadowHostMarked);
        // v1.9.15：行內高亮自訂元素標記（必須在 contrast phase 3 之前——該 pass
        // 靠 SITE_UI_ATTR 跳過站方配色成對保留的元素）
        markInlineHighlights(articleEl, siteUiMarked);
        // v3.7.4：色塊保留站方底色（見 markColorSwatches）
        markColorSwatches(articleEl, siteUiMarked);
        activeMarkState = { articleEl, embedWrapMarked, ratioClassMarked, embedFillMarked, headingLinkMarked, absAnchorMarked, prewrapParaSnap, siteUiMarked, firstLetterMarked,
          cjkJustifyMarked, textJustify: opts.textJustify, // 2026-11-15 review B-09
          // v2.5.21：getter——這個物件建立時 rtlBase 可能還沒量（量在後面的 pass）
          get rtlBase() { return rtlBase; },
          // 呼叫當下才讀 classifyLateImg（與 passClassifyImages 的執行先後無關）
          classifyLateImg: (img) => { if (classifyLateImg) classifyLateImg(img); } };
      };

      const passMarkFillIframes = () => {
        // v0.8.86：responsive embed 的 abs-pos iframe 標 [FILL_IFRAME_ATTR]，讓
        // CSS pin 回填滿 wrapper（見上方 FILL_IFRAME_ATTR rule 註解）。必須在
        // ARTICLE_ATTR 設定**後**量——reader CSS 對 [class*="placeholder"] 後代
        // 強制 position:static，那類 iframe 量到 static 不被標（已在 flow 內
        // 正常置中），只命中「reader CSS 未改其定位、仍 absolute」的真 embed。
        {
          const _win = articleEl.ownerDocument?.defaultView;
          if (_win && _win.getComputedStyle) {
            for (const ifr of articleEl.querySelectorAll('iframe')) {
              if (ifr.hasAttribute(PLAYER_ATTR)) continue;
              if (_win.getComputedStyle(ifr).position === 'absolute') {
                ifr.setAttribute(FILL_IFRAME_ATTR, '1');
                fillIframes.push(ifr);
              }
            }
          }
        }
      };

      const passMarkAncestors = () => {
        ancestors = markAncestors(articleEl);
      };

      const passHtmlClassThemeMeta = () => {
        htmlHadClass = document.documentElement.classList.contains(HTML_CLASS);
        document.documentElement.classList.add(HTML_CLASS);

        // v0.8.24：覆蓋 theme-color meta = reader card 色（狀態列 / 底部工具列染色）
        themeColorSnap = applyThemeColor(theme.articleBg);

        // v0.8.139：正規化 viewport meta（行動裝置「縮小一半」修法，見函式註解）
        viewportSnap = applyViewportFix();
      };

      const passMarkFirstLetterColor = () => {
        // v2.4.9：drop cap 首字色修正對象標記。必須在 passHtmlClassThemeMeta 之後
        //（主題文字色全生效才比得出「段落色 vs 站方首字色」，見函式註解）
        markFirstLetterColorBlocks(articleEl, firstLetterMarked);
        // v2.5.24：放大首字重排＋首行樣式歸回標記（共用同一個還原陣列）。同樣要在
        // 使用者字級 / 行距的 CSS 生效之後量
        markDropCapBlocks(articleEl, firstLetterMarked);
      };

      const passMarkSelectionBg = () => {
        // v2.4.10：站方 ::selection 底色不透明標記（見函式註解）
        selBgMarked = markSiteSelectionBg(articleEl);
      };

      const passContrastGuardPhase2 = () => {
        // v0.7.225 contrast guard phase 2：CSS 全生效後（ARTICLE_ATTR + HTML_CLASS
        // 都已就位）以 card bg 為基底重算每個容器的新 effective bg。半透明 pre bg
        // 疊白卡 = 近白；wrapper 載 bg 的站則已被 background strip 清掉——兩種
        // 機制都會讓 newBg 落到 card bg。判定「大部分文字對新 bg 不可讀、但對
        // 原始 bg 可讀」才動手：把原始 bg inline !important 還給容器（原站
        // syntax 色是配這個 bg 設計的，還原 bg = 還原設計時的對比）。
        // snapshot entry 通用化：{ el, prop, prev, prevP }——bg 還原與
        // per-carrier 色覆寫共用一個還原清單。
        if (contrastProbe.length) {
          const _win = articleEl.ownerDocument?.defaultView;
          const cardBg = parseCssColor(theme.articleBg) || WHITE;
          for (const probe of contrastProbe) {
            const newBg = compositeBgOver(probe.el, articleEl, cardBg, _win);
            // 重量注入後的實際文字色（繼承類元素已走新 cascade，見
            // collectTextCarriers 註解——用 phase 1 舊色會誤觸發）
            for (const c of probe.carriers) {
              c.newColor = parseCssColor(_win.getComputedStyle(c.el).color);
            }
            // --- 修法一：整容器 bg 還原（大部分文字不可讀時）---
            // 修復後的最終狀態 = 注入後文字色 + 還原的原始 bg。這個組合必須
            // 真的可讀才動手——同時涵蓋「原站本來就低對比（不是 jread 造成、
            // 還原 bg 也救不回）」的保守分支：那種 case 此檢查必 fail。
            let finalBg = newBg;
            if (lowContrastFraction(probe.carriers, newBg, 'newColor') >= CONTRAST_LOW_FRACTION &&
                lowContrastFraction(probe.carriers, probe.origBg, 'newColor') < CONTRAST_LOW_FRACTION) {
              contrastBgSnap.push({
                el: probe.el,
                prop: 'background-color',
                prev: probe.el.style.getPropertyValue('background-color'),
                prevP: probe.el.style.getPropertyPriority('background-color')
              });
              const o = probe.origBg;
              probe.el.style.setProperty(
                'background-color',
                `rgb(${Math.round(o.r)}, ${Math.round(o.g)}, ${Math.round(o.b)})`,
                'important'
              );
              finalBg = probe.origBg;
            }
            // --- 修法二：per-carrier 色覆寫（少數載體仍不可讀時）---
            // tymscar table 實測：th 有自己的 color（淺色、為深底設計）被
            // :not(th) 排除保留，td 無 color 繼承 card 深字——混色容器 bg 還原
            // 會弄壞多數 td、只能對 th 這類少數載體個別覆寫文字色。覆寫值不
            // 猜原設計、直接依最終 bg 亮度選高對比色（淺底深字 / 深底淺字）。
            // 「原設計可讀」前提仍要守：原本就低對比的載體不是 jread 造成，
            // 不動（同修法一的保守邊界）。
            for (const c of probe.carriers) {
              if (!c.newColor) continue;
              if (contrastRatio(c.newColor, finalBg) >= CONTRAST_MIN_RATIO) continue;
              if (contrastRatio(c.origColor, probe.origBg) < CONTRAST_MIN_RATIO) continue;
              contrastBgSnap.push({
                el: c.el,
                prop: 'color',
                prev: c.el.style.getPropertyValue('color'),
                prevP: c.el.style.getPropertyPriority('color')
              });
              c.el.style.setProperty(
                'color',
                relLuminance(finalBg) > 0.5 ? '#1a1a1a' : '#f0f0f0',
                'important'
              );
            }
          }
        }
      };

      const passBlockquoteSummaryContrast = () => {
        // v1.0.6 light theme：bg 保留但文字色被強制的語意元素（blockquote /
        // summary）深底深字守門。
        // Root cause（通則，非站點特例）：BG_PRESERVE_NOT 保留 figure/figcaption/
        // summary/blockquote 的原站背景，但 COLOR_PRESERVE_NOT 只排除 figcaption——
        // blockquote / summary 的文字在 light theme 被 color: inherit 強制成 reader
        // 卡片深色。站點若把這類元素配深色不透明背景（autocar.co.uk 把圖說做成
        // <blockquote class="image-field-caption"> bg rgb(48,48,48)），深字落深底＝
        // 整條黑條不可讀（cage 量 1.59:1）。與 figcaption v0.8.169「文字已決定走
        // 卡片色 → 背景跟著透明」同款修法形狀。
        //
        // 為什麼用 contrast gate 而非比照 figcaption 無條件清背景：blockquote 引言框
        // 可能有「淺底 + 深字」的合理設計（行 1917 註解：引言框靠 padding + 背景
        // 撐視覺）——無條件清會弄丟正常引言框的底色。以實際對比 gate：只有「強制
        // 文字色對保留 effective bg < 3:1（占比 >= 40%）」才把背景正規化為透明
        // （讓白卡透出、深字變可讀），高對比的淺底引言框一律不動（保守邊界，同
        // pre/table contrast guard 與 v0.7.225 light guard）。figure 直接文字罕見、
        // figcaption 已另條 light 規則處理，故只掃 blockquote / summary。
        //
        // 訊號層次：本層驗「blockquote/summary 直接文字載體 vs 保留 bg 的 WCAG
        // 對比」一層；dark / sepia 不走（theme.text 非 null → 由下方 phase 3 兜底
        // 接管全 card 文字色）。restore 走 contrastBgSnap 既有通道。
        if (!theme.text) {
          const _win = articleEl.ownerDocument?.defaultView;
          if (_win && _win.getComputedStyle) {
            const cardBg = parseCssColor(theme.articleBg) || WHITE;
            let bqScanned = 0;
            for (const el of articleEl.querySelectorAll('blockquote, summary')) {
              if (bqScanned >= CONTRAST_MAX_TARGETS) break;
              if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
              const cs = _win.getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              // 無自身背景（透明）→ effective bg 由白卡決定、不可能深底深字，跳過
              const ownBg = parseCssColor(cs.backgroundColor);
              if (!ownBg || ownBg.a < 0.05) continue;
              bqScanned++;
              // 注入後實際文字色（color: inherit 已走新 cascade，見
              // collectTextCarriers 註解——用注入前舊色會誤判）
              const carriers = collectTextCarriers(el, _win);
              if (!carriers.length) continue;
              for (const c of carriers) c.newColor = parseCssColor(_win.getComputedStyle(c.el).color);
              const effBg = compositeBgOver(el, articleEl, cardBg, _win);
              if (lowContrastFraction(carriers, effBg, 'newColor') >= CONTRAST_LOW_FRACTION) {
                contrastBgSnap.push({
                  el,
                  prop: 'background-color',
                  prev: el.style.getPropertyValue('background-color'),
                  prevP: el.style.getPropertyPriority('background-color')
                });
                el.style.setProperty('background-color', 'transparent', 'important');
              }
            }
          }
        }
      };

      const passShadowHostSchemeFit = () => {
        // v2.5.32：shadow 元件 color-scheme 跟卡片之後，量元件內文字對實際底色的對比
        // （MDN「Try it」系統淺色＋深色主題：CodeMirror 語法色由站方 JS 依系統挑淺色
        // 那組、編輯區透明落在深色卡片上，藍字 #00f 對比 1.04）。低對比字數 >=
        // CONTRAST_LOW_FRACTION 時改標 "flip"（CSS 見 SHADOW_HOST_ATTR "flip" 規則），
        // 翻完重量一次，沒有變好就改回——量測本身就是驗收，不靠猜元件怎麼挑配色。
        // 訊號層次：apply 當下的 computed 值。主題切換走 restore → apply 會重量；進場後
        // 才升級／才畫出來的元件、之後才換配色的元件量不到（同 markShadowHosts）。
        // restore：屬性由 shadowHostMarked 通道統一移除
        const _win = articleEl.ownerDocument?.defaultView;
        if (!_win || !_win.getComputedStyle) return;
        const cardBg = parseCssColor(theme.articleBg) || WHITE;
        for (const host of shadowHostMarked) {
          if (!host || !host.isConnected || host.getAttribute(SHADOW_HOST_ATTR) !== '1') continue;
          try {
            const before = shadowTextLowFraction(measureShadowHostText(host, articleEl, cardBg, _win));
            if (before < CONTRAST_LOW_FRACTION) continue;
            host.setAttribute(SHADOW_HOST_ATTR, 'flip');
            const after = shadowTextLowFraction(measureShadowHostText(host, articleEl, cardBg, _win));
            if (after >= before) host.setAttribute(SHADOW_HOST_ATTR, '1');
          } catch (_) {
            try { host.setAttribute(SHADOW_HOST_ATTR, '1'); } catch (__) { /* */ }
          }
        }
      };

      const passTableSiteBgContrast = () => {
        // v2.5.18 light theme：表格系（TABLE_TAGS）站方深色底上的深字守門。
        // Jimmy 2026-11-17：GitHub README 表格在「系統深色＋light 主題」是黑字配近黑底
        //（tj/commander.js，1.1:1）。根因（probe 真站）：站方深色模式把列底色畫在
        // <tr>（rgb(13,17,23) / 斑馬列 rgb(21,27,35)）；TABLE_TAGS 在 BG_PRESERVE_NOT
        // 內 → 底色保留，td / th 沒有自己的 color、自然繼承卡片的深字。gray / sepia /
        // dark / night 有背景中和規則（v0.8.45）所以沒事；light 沒有。既有的 v0.7.225
        // 守門（phase 1 / 2）拿整張 <table> 的 effective bg 當基準、看不到 <tr> 這層。
        //
        // 為什麼不比照其他主題無條件清：light 刻意保留站方的淺色底（維基表頭 / 提示框、
        // sspai 表格、斑馬紋）。這裡用量測 gate，兩道都要過才清：
        //   1. 這個元素自己有底色，而且卡片文字色落在它的 effective bg 上 < 3:1
        //     （＝深色底；淺色底在這一步就全數放行，不可能被清）
        //   2. 直接落在這層底色上的非連結文字有看不清楚的（< 3:1），而且清掉之後
        //      沒有任何原本看得清楚的字變成看不清楚（站方自己配「深底淺字」的表頭：
        //      th / td 的 color 在 COLOR_PRESERVE_NOT 內會留著 → 第 2 道不過、不動）
        // 同一張表有元素被清時，沒有自己文字的深色底（空列、只有連結的列）一併清，
        // 避免整張表一列深一列白。連結不計入占比：主題連結色落在深底上常常還有 3:1，
        // 會讓「只有連結的列」留著深底。
        // 與 phase 2 的分工：phase 2 還原過底色的容器（站方淺字、為深底設計）在第 2 道
        // 必定不過——它還原的前提就是「新文字色落在原始底色上多數看得清楚」。
        // 訊號層次：apply 當下的 computed 值；之後才換底色的站（SPA 晚到樣式、進場後
        // 切換系統深淺色）掃不到。restore 走 contrastBgSnap 既有通道。
        if (theme.text) return;
        const _win = articleEl.ownerDocument?.defaultView;
        if (!_win || !_win.getComputedStyle) return;
        const cardBg = parseCssColor(theme.articleBg) || WHITE;
        const cardText = parseCssColor(_win.getComputedStyle(articleEl).color);
        if (!cardText) return;
        const tableSel = TABLE_TAGS.join(',');
        let scanned = 0;
        for (const table of articleEl.querySelectorAll('table')) {
          if (scanned >= TABLE_BG_MAX_SCAN) break;
          if (table.parentElement && table.parentElement.closest && table.parentElement.closest('table')) continue;
          if (table.closest && table.closest('[data-jread-hidden="1"]')) continue;
          // 第 1 道：找出這張表裡帶深色底的表格系元素（文件順序＝外層先）
          const dark = [];
          for (const el of NS.selfAndDescendants(table, tableSel)) {
            if (scanned >= TABLE_BG_MAX_SCAN) break;
            scanned++;
            const own = parseCssColor(_win.getComputedStyle(el).backgroundColor);
            if (!own || own.a < 0.05) continue;
            const eff = compositeBgOver(el, articleEl, cardBg, _win);
            if (contrastRatio(cardText, eff) >= CONTRAST_MIN_RATIO) continue;
            dark.push(el);
          }
          if (!dark.length) continue;
          const darkSet = new Set(dark);
          // 文字載體歸戶：往上第一個帶深色底的表格系元素
          const owned = new Map();
          for (const el of dark) owned.set(el, []);
          for (const c of collectTextCarriers(table, _win, TABLE_BG_MAX_SCAN)) {
            let cur = c.el;
            while (cur && cur !== table.parentElement && !darkSet.has(cur)) cur = cur.parentElement;
            if (!cur || !darkSet.has(cur)) continue;
            c.isLink = !!(c.el.closest && c.el.closest('a'));
            owned.get(cur).push(c);
          }
          const cleared = [];
          const clear = (el) => {
            contrastBgSnap.push({
              el,
              prop: 'background-color',
              prev: el.style.getPropertyValue('background-color'),
              prevP: el.style.getPropertyPriority('background-color')
            });
            el.style.setProperty('background-color', 'transparent', 'important');
            cleared.push(el);
          };
          // 清掉之後這層露出來的底色（自己這層不算）
          const behindOf = (el) => (el.parentElement && el !== articleEl
            ? compositeBgOver(el.parentElement, articleEl, cardBg, _win) : cardBg);
          const verdict = (el) => tableSiteBgVerdict(
            owned.get(el).map((c) => ({ len: c.len, isLink: c.isLink, color: c.origColor })),
            compositeBgOver(el, articleEl, cardBg, _win),
            behindOf(el)
          );
          // 第 2 道：有自己文字的層先判
          const pending = [];
          for (const el of dark) {
            const v = verdict(el);
            if (v === 'clear') clear(el);
            else if (v === 'no-own-text') pending.push(el);
          }
          // 同一張表有層被清 → 沒有自己文字的深色底跟著清（連結清掉後仍要看得清楚）
          if (cleared.length) {
            for (const el of pending) {
              const behind = behindOf(el);
              const linksOk = owned.get(el).every((c) => contrastRatio(c.origColor, behind) >= CONTRAST_MIN_RATIO);
              if (linksOk) clear(el);
            }
          }
        }
      };

      const passDarkSepiaContrastPhase3 = () => {
        // v0.8.45 dark / sepia contrast 兜底層（phase 3）：CSS 通則層管不到的
        // 低對比文字逐元素修色。CSS cascade 有結構性輸局——站點高 specificity
        // !important rule（twz `.recurrent-author-widgets .recurrent-author-widget
        // .author-bio` = (0,3,0) !important，贏 jread color-inherit 的 (0,2,12)，
        // probe 實證）、@layer important 反轉、CSS-in-JS 動態注入——stylesheet
        // 軍備競賽永遠有更高的站點。inline style + !important 是 author origin
        // 最高優先級，cascade 戰爭一律終結。
        // 保守邊界：只修「對 effective bg 對比 < 3:1」的元素——本來就不可讀，
        // 改色是淨改善；可讀的原站色（表格漲跌紅綠、syntax token、mark 高亮上
        // 的深字）一律不動。候選色挑對比較高者（亮底深字 / 暗底用 theme 淺字），
        // 連結用 link 色變體維持與正文的雙通道辨識。修後仍 < 3:1 則不動（與
        // v0.7.225 light guard 同款保守分支——不是 jread 能救的不亂動）。
        // restore 走 contrastBgSnap 既有通道；theme 切換走 main.js restore→apply
        // 重跑，inline 不殘留、不污染重算。
        // 訊號層次：本層驗「直接文字載體 vs effective bg 的 WCAG 對比」；不驗
        // 圖片 / iframe 內部（jread 摸不到）、不驗 lazy-load 晚到的內容（apply
        // 當下不存在的元素掃不到——對 theme 切換場景夠用，極端 lazy 站漏網）。
        //
        // SPA cascade 時序坑（sspai instrument 實證）：apply() 同步流程內
        // getComputedStyle 量到的 bg 可能還是站點值——SPA hydration 期站點動態
        // <style> 與 jread styleEl 的 cascade 勝負會在 apply 之後翻轉（sspai TH
        // 在 phase 3 當下 bg=#f7f7f9、1.5s 後才變 transparent），照當下值修色
        // 會做出「亮底深字」之後變「暗底深字」ratio 1。所以 effective bg 不照
        // 當下 computed 算，而是按「jread 規則的目標狀態」算：會被上方背景中和
        // 規則打 transparent 的層（tag 清單同款生成）一律跳過其 bg。代價：站點
        // rule 永久賽贏中和規則的極端站會被當成已中和而漏修（保守邊界——漏修
        // 不誤傷）。
        if (theme.text) {
          const _win = articleEl.ownerDocument?.defaultView;
          if (_win && _win.getComputedStyle) {
            const cardBg = parseCssColor(theme.articleBg) || WHITE;
            const neutralizedSel = [...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS].join(',');
            const skipNeutralized = (cur) => !!(cur.matches && cur.matches(neutralizedSel));
            // v1.7.44 E1 效能：兩段式讀寫分離。原本逐元素「讀 computed → 命中即寫
            // inline color」交錯，每次寫入都讓後續 getComputedStyle 重新 style recalc
            // （至多 3,000 元素 × 祖先鏈）。改 phase A 全讀收集 fixes、phase B 統一寫。
            // 語意差異（可接受）：原交錯版中祖先先被修色時、繼承色的子孫重量會過
            // contrast gate 而跳過；分離版子孫以舊繼承色判定、可能同被收進 fixes——
            // 但候選色同一組、挑中同色，視覺結果相同，restore 各自還原 inline 不受序影響。
            //
            // effective bg 沿 DOM 樹 memoize：effBg(el) = 自身 bg 圖層疊在
            // effBg(parent) 上（opaque 圖層蓋掉底下一切 = blendOver 自然語意），與
            // compositeBgOver(el, null, cardBg, _win, skipNeutralized) 等價；同一
            // 祖先鏈只算一次，兄弟元素共用祖先段快取。
            const bgMemo = new Map();
            const effBgOf = (el) => {
              const chain = [];
              let cur = el;
              let cached = null;
              while (cur && cur.nodeType === 1) {
                if (bgMemo.has(cur)) { cached = bgMemo.get(cur); break; }
                chain.push(cur);
                if (cur === _win.document.body) break;
                cur = cur.parentElement;
              }
              let base = cached ? cached : { ...cardBg };
              for (let i = chain.length - 1; i >= 0; i--) {
                const node = chain[i];
                if (!skipNeutralized(node)) {
                  const c = parseCssColor(_win.getComputedStyle(node).backgroundColor);
                  if (c && c.a > 0) base = blendOver(c, base);
                }
                bgMemo.set(node, base);
              }
              return base;
            };
            let scanned = 0;
            let fixed = 0;
            const contrastFixes = [];
            for (const el of articleEl.querySelectorAll('*')) {
              if (scanned >= 3000 || fixed >= 300) break;
              const tag = el.tagName.toUpperCase();
              if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'TITLE' || tag === 'DESC') continue;
              let len = 0;
              for (const n of el.childNodes) {
                if (n.nodeType === 3) len += n.textContent.trim().length;
              }
              if (len < 4) continue;
              scanned++;
              if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
              // v1.9.15：站方自管配色的行內高亮 / 工具列不修色——底色常畫在
              // background-image（effBgOf 只疊 background-color、看不到），照
              // 卡片底色算會把「黃底上的深字」誤判成低對比、改成淺字
              if (el.closest && el.closest(`[${SITE_UI_ATTR}]`)) continue;
              const cs = _win.getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              const fg = parseCssColor(cs.color);
              if (!fg || fg.a < 0.5) continue;
              const bg = effBgOf(el);
              if (contrastRatio(fg, bg) >= CONTRAST_MIN_RATIO) continue;
              const isLink = !!(el.closest && el.closest('a'));
              // 深色候選：#1a1a1a（深字）/ #1a73e8（light theme link 色，亮底上 5.2:1）
              const candidates = isLink ? [theme.link, '#1a73e8'] : [theme.text, '#1a1a1a'];
              let best = null;
              let bestRatio = -1;
              for (const cstr of candidates) {
                const c = parseCssColor(cstr);
                const r = c ? contrastRatio(c, bg) : 0;
                if (r > bestRatio) { bestRatio = r; best = cstr; }
              }
              if (!best || bestRatio < CONTRAST_MIN_RATIO) continue;
              contrastFixes.push({ el, best });
              fixed++;
            }
            for (const f of contrastFixes) {
              contrastBgSnap.push({
                el: f.el,
                prop: 'color',
                prev: f.el.style.getPropertyValue('color'),
                prevP: f.el.style.getPropertyPriority('color')
              });
              f.el.style.setProperty('color', f.best, 'important');
            }
          }
        }
      };

      const passCodeBlockBgPhase4 = () => {
        // v1.5.17 code block 背景辨識度（phase 4，所有主題）：原站常把 `<pre>`
        // 程式碼框做成「透明底 + 細淺色邊框」（Medium 實測 bg rgba(0,0,0,0)、
        // border 1px #e5e5e5）。reader card 在 sepia(#eee2cb) / gray(#ededed) 主題
        // 下，淺邊框 ≈ 卡片色幾乎不可見、透明底又透出卡片色 → code block 與主文
        // 完全融在一起、看不出邊界（Jimmy 2026-06-29 medium 截圖回報）。
        //
        // Root cause（通則）：BG_PRESERVE_NOT 保留 pre 背景（語法高亮塊的實心底 +
        // token 色是配套設計、不能清）。但「自身背景透明」的純文字 code 塊沒有任何
        // 區隔載體，靠原站淺邊框在深/暖卡上失效。
        //
        // 修法：只對「自身 background-color alpha < 0.1（透明 / 近透明）」的 pre
        // 補主題協調底色 theme.codeBlockBg（半透明、疊在卡片上產生 recessed panel）。
        // gate 在 alpha：語法高亮塊（實心 #282c34 之類，alpha=1）一律跳過、原樣保留，
        // 零誤傷其 token 對比。所有主題都跑（sepia/gray 是回報情境、light/dark 同樣
        // 受益）。snapshot 走 contrastBgSnap 既有還原通道（theme 切換 restore→apply
        // 重算，inline 不殘留）。
        if (theme.codeBlockBg) {
          const _win = articleEl.ownerDocument?.defaultView;
          if (_win && _win.getComputedStyle) {
            let preScanned = 0;
            const codePadPending = [];
            for (const pre of articleEl.querySelectorAll('pre')) {
              if (preScanned >= CODE_BG_MAX_SCAN) break;
              if (pre.closest && pre.closest('[data-jread-hidden="1"]')) continue;
              // 嵌套（pre 內 pre，罕見）只處理最外層，避免疊兩層底色
              if (pre.parentElement && pre.parentElement.closest &&
                  pre.parentElement.closest('pre')) continue;
              preScanned++;
              const ownBg = parseCssColor(_win.getComputedStyle(pre).backgroundColor);
              // 自身有實心 / 明顯底色（語法高亮塊）→ 保留原設計，不補
              if (ownBg && ownBg.a >= 0.1) continue;
              contrastBgSnap.push({
                el: pre,
                prop: 'background-color',
                prev: pre.style.getPropertyValue('background-color'),
                prevP: pre.style.getPropertyPriority('background-color')
              });
              pre.style.setProperty('background-color', theme.codeBlockBg, 'important');
              // v2.5.24：補了底色的 <pre> 若沒有內距，字會貼著灰底邊緣。站方常把
              // 底色與內距都放在外層 wrapper（qiita `.code-frame { padding: 8px 16px;
              // background }` 實證）：wrapper 的底色被 bg strip 清掉、水平內距被版心
              // 對齊 pass 歸零，底色改畫在 <pre> 上之後就沒有任何內距。
              // 只在「這個底色是本 pass 補的」時才補內距（站方自己畫底的 <pre> 不動）；
              // 內距量 <pre> 自身＋唯一 block 子元素 <code>（有些站把內距放在 code 上）。
              // 水平、垂直各自判定，不足 CODE_PAD_MIN 才補。
              const pcs = _win.getComputedStyle(pre);
              const only = pre.children.length === 1 && pre.firstElementChild.tagName === 'CODE'
                ? _win.getComputedStyle(pre.firstElementChild) : null;
              const padOf = (side) => (parseFloat(pcs['padding' + side]) || 0) + (only ? (parseFloat(only['padding' + side]) || 0) : 0);
              const sides = [];
              for (const [side, prop, val] of [['Left', 'padding-left', CODE_PAD_X], ['Right', 'padding-right', CODE_PAD_X],
                ['Top', 'padding-top', CODE_PAD_Y], ['Bottom', 'padding-bottom', CODE_PAD_Y]]) {
                if (padOf(side) < CODE_PAD_MIN) sides.push({ side, prop, val });
              }
              if (sides.length) codePadPending.push({ pre, code: only ? pre.firstElementChild : null, sides });
            }
            // 先全讀再全寫（判定值全取自寫入前的 layout，不逐個 <pre> 觸發 recalc）
            const setInline = (el, prop, val) => {
              contrastBgSnap.push({
                el, prop,
                prev: el.style.getPropertyValue(prop),
                prevP: el.style.getPropertyPriority(prop)
              });
              el.style.setProperty(prop, val, 'important');
            };
            for (const { pre, sides } of codePadPending) {
              for (const { prop, val } of sides) setInline(pre, prop, val);
            }
            // 站方若寫 pre code { padding: inherit }（qiita 實證），剛補在 <pre> 上的內距
            // 會被 <code> 再繼承一次、變成兩倍。寫完後重讀一次：<code> 在補過的那一側
            // 多出內距，就把 <code> 那一側歸零。
            for (const { code, sides } of codePadPending) {
              if (!code) continue;
              const ccs = _win.getComputedStyle(code);
              for (const { side, prop } of sides) {
                if ((parseFloat(ccs['padding' + side]) || 0) >= CODE_PAD_MIN) setInline(code, prop, '0');
              }
            }
          }
        }
      };

      const passCodeWhitespaceDecoration = () => {
        // v2.5.23：程式碼區塊裡「只有空白的 token」帶的底線 / 刪除線拿掉。
        // 語法上色器（Chroma / Pygments 的 TextWhitespace token `.w`）把縮排空白包成
        // <span>，有些佈景給它 `text-decoration: underline` ＋「與區塊底色相同的字色」
        // ——在站上看不見。閱讀模式把程式碼字色統一成主題文字色、底色也換了，那條
        // 底線就現形：縮排變成一排底線（kubernetes.io YAML 範例實證，probe 量到
        // `.chroma .w { color: #f8f8f8; text-decoration: underline }`，字色被
        // color-inherit 規則改成黑）。
        // 判定不看 class：<pre> 內沒有子元素、文字全是空白的元素，computed
        // text-decoration-line 不是 none 就清。空白上的裝飾線沒有資訊量——真的要
        // 標示的（diff 的刪除線、連結底線）一定畫在有字的元素上，那些不動。
        // 同一個 class 組合的結果相同（規則是 class 給的）→ 以 className 快取，
        // 帶 inline style 的不快取。restore 走 contrastBgSnap 既有通道。
        // 這條驗 X、不驗 Y：只處理 apply 當下已在 DOM 的 token；之後才上色的
        //（lazy highlight）掃不到。祖先給的裝飾線（整個 <pre> 畫底線）不在此列
        const _win = articleEl.ownerDocument?.defaultView;
        if (!_win || !_win.getComputedStyle) return;
        const verdictByClass = new Map();
        let scanned = 0;
        for (const pre of articleEl.querySelectorAll('pre')) {
          if (scanned >= CODE_WS_MAX_SCAN) break;
          if (pre.closest && pre.closest('[data-jread-hidden="1"]')) continue;
          for (const tok of pre.querySelectorAll('span, i, b, em, font')) {
            if (scanned >= CODE_WS_MAX_SCAN) break;
            if (tok.firstElementChild) continue;
            const t = tok.textContent;
            if (!t || /\S/.test(t)) continue;
            scanned++;
            const key = tok.hasAttribute('style') ? null : (tok.getAttribute('class') || '');
            let decorated = key !== null ? verdictByClass.get(key) : undefined;
            if (decorated === undefined) {
              const cs = _win.getComputedStyle(tok);
              const line = cs.textDecorationLine || cs.textDecoration || '';
              decorated = !!line && line.indexOf('none') === -1;
              if (key !== null) verdictByClass.set(key, decorated);
            }
            if (!decorated) continue;
            contrastBgSnap.push({
              el: tok,
              prop: 'text-decoration',
              prev: tok.style.getPropertyValue('text-decoration'),
              prevP: tok.style.getPropertyPriority('text-decoration')
            });
            tok.style.setProperty('text-decoration', 'none', 'important');
          }
        }
      };

      const passInstallListeners = () => {
        // v0.7.90：install scroll listener（auto-hide scrollbar）。passive 確保
        // 不卡 scroll 效能；window 層級捕捉文件捲動事件。重複 apply 時 remove
        // 後 add 防止 listener 累積（瀏覽器 dedupe 但保險，restore 也對稱乾淨）。
        window.removeEventListener('scroll', onScrollFlash, { passive: true });
        window.addEventListener('scroll', onScrollFlash, { passive: true });

        // 閱讀進度條——v1.5.2：分頁模式不注入（底部頁碼指示器已表閱讀進度，頂端進度條
        // 為重複功能；Jimmy 2026-06-27）。styler 是進度條生命週期的單一資料源：依
        // opts.pagedMode 決定注入與否，paged-mode.js 不再碰它。切到分頁模式（scroll→
        // paged reapply）時把既有的移除，騰出頂端區域給文章排版（paged 卡片上緣 gutter
        // 同步收斂，見上方 PAGED_TOP_GUTTER）。
        window.removeEventListener('scroll', onScrollProgress, { passive: true });
        if (opts.pagedMode) {
          const existing = document.getElementById(PROGRESS_ID);
          if (existing) existing.remove();
          progressEl = null;
        } else {
          progressEl = document.getElementById(PROGRESS_ID);
          if (!progressEl) {
            progressEl = document.createElement('div');
            progressEl.id = PROGRESS_ID;
            (document.head?.parentElement || document.documentElement).appendChild(progressEl);
          }
          window.addEventListener('scroll', onScrollProgress, { passive: true });
          onScrollProgress();
        }

        // v0.7.91：install SPACE keydown listener（capture phase 比原站 bubble
        // listener 早攔，比原站 keydown 攔截先收到 SPACE）。重複 apply 時保險先 remove。
        window.removeEventListener('keydown', onSpaceScroll, true);
        window.addEventListener('keydown', onSpaceScroll, true);
      };

      const passFirstInkTopMargin = () => {
        // 消除頂端留白：第一個**可見** h1-h4/p（深層後代也算）margin-top: 0
        // inline。必須用 JS：站點 CSS 常給深層 heading 寫死 margin-top，純 CSS
        // 的 `:first-child` 只能摸到 article 的 direct child，摸不到「包在
        // wrapper 裡的 H1」。
        // v0.7.180：跳過 display:none / data-jread-hidden 內的隱藏元素。
        // MSNBC/ms.now opinion-header 內 .opinion-column(display:none) 包
        // P "Opinion" 類別標籤——querySelector DOM order 比 H1 早命中，導致
        // firstInk 指向隱藏 P、後續 ancestor padding strip 和 titleFontSize
        // inline override 都因此 miss。
        // v1.7.43：可見性判定收斂到 isVisiblyShown（與 firstVisibleH1 同一份標準）
        for (const el of articleEl.querySelectorAll('h1, h2, h3, h4, p')) {
          if (!isVisiblyShown(el, articleEl)) continue;
          firstInk = el;
          break;
        }
        if (firstInk) {
          firstInkPriorMt = firstInk.style.getPropertyValue('margin-top');
          firstInkPriorMtPriority = firstInk.style.getPropertyPriority('margin-top');
          firstInk.style.setProperty('margin-top', '0', 'important');
        }
      };

      const passHeadingPseudoSpacerReset = () => {
        // v1.8.4：標題（h1-h6）自帶的「不可見 ::before / ::after 純間距佔位」歸零
        // （Jimmy 2026-09-03 第二輪回報 nytimes：v1.8.3 清掉站方 article padding 後，
        // 標題文字上方仍空——h1 box 71px 高、文字行只有 39px，多出來的是
        // `h1::before { content:""; display:block; height:1px; margin:12px 0 28px }`，
        // 完全透明、無 border、無背景，純粹是站方版面間距 / 曾經的裝飾線殘骸；
        // reader 卡片重排後它就是標題上方 41px 的死空間）。
        // 為何既有機制不管用：這不是元素、不在 querySelectorAll 裡，cleaner 掃不到；
        // passAspectPseudoReset 只掃 mediaAncestors 且認垂直 padding（這條是 margin）。
        // 通則（硬規則 3，非站點 / class 特判）：pseudo 有 content 但「量得出來完全
        // 看不見」（透明背景 + 無背景圖 + 四邊 border 0 + 無 box-shadow + content 是
        // 空字串），卻佔掉可觀的垂直空間 → 那是版面間距 hack，不是設計語彙，reader
        // 內一律歸零。可見的 pseudo（h2 前的彩色短線那種）不動——那是站點 typography
        // 的一部分，保留比清掉好。
        // 淨佔位用 height + marginTop + marginBottom：負 margin 相消的 anchor-offset
        // hack 自動落在門檻外（見 HEADING_SPACER_MIN_NET）。
        const winPseudo = articleEl.ownerDocument?.defaultView;
        if (!winPseudo || !winPseudo.getComputedStyle) return;
        const isTransparentBgEl = (c) => !c || c === 'transparent'
          || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(c);
        // v2.5.31：標題元素自己的上下 padding 也是同一種東西（Jimmy 2026-11-20 回報 theguardian
        // 「標題和照片說明中間多出一段空間」：h1 帶站方 padding-bottom: 24px，閱讀模式上面那條
        // h1–h6 margin 規則已統一管標題上下間距，padding 再疊一份）。判準與 pseudo 相同：
        // 透明底、無背景圖、無陰影、四邊無框線 → padding 撐的只是看不見的空間，上下歸零；
        // 有框線（標題底線）或底色（色塊標題）的 padding 是框內留白，不動。左右 padding 不動。
        // 門檻沿用 HEADING_SPACER_MIN_NET（上下合計 12px 以下是細部微調）
        for (const el of articleEl.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
          if (el.closest('[data-jread-hidden="1"]')) continue;
          let cs;
          try { cs = winPseudo.getComputedStyle(el); } catch (_) { continue; }
          if (!cs) continue;
          const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
          if (padV <= HEADING_SPACER_MIN_NET) continue;
          if (!isTransparentBgEl(cs.backgroundColor)) continue;
          if (cs.backgroundImage && cs.backgroundImage !== 'none') continue;
          if (cs.boxShadow && cs.boxShadow !== 'none') continue;
          if (['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
            .some((k) => (parseFloat(cs[k]) || 0) > 0)) continue;
          el.setAttribute(HEADING_PAD_ATTR, '1');
          headingSpacerMarks.push({ el, attr: HEADING_PAD_ATTR });
        }
        // 無 layout 引擎的環境（jsdom）直接 short-circuit——同 passAspectPseudoReset：
        // 本 pass 修的是真實 layout 才存在的死空間，且 jsdom 未實作帶 pseudo 參數的
        // getComputedStyle。
        const rootEl = articleEl.ownerDocument && articleEl.ownerDocument.documentElement;
        if (!rootEl || !(rootEl.getBoundingClientRect().height > 0)) return;
        const isTransparentBg = (c) => !c || c === 'transparent'
          || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(c);
        for (const el of articleEl.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
          for (const [pseudo, attr] of [
            ['::before', HEADING_SPACER_BEFORE_ATTR],
            ['::after', HEADING_SPACER_AFTER_ATTR],
          ]) {
            let ps;
            // 只吞 SyntaxError（jsdom nwsapi 既知行為，同 passAspectPseudoReset）
            try { ps = winPseudo.getComputedStyle(el, pseudo); } catch (e) {
              if (e && e.name === 'SyntaxError') break;
              throw e;
            }
            if (!ps) continue;
            // content 必須是空字串——'none' / 'normal' 代表 pseudo 不存在，
            // 有文字或 url() 的則是真的看得見的內容
            const content = ps.content;
            if (content !== '""' && content !== "''") continue;
            if (!isTransparentBg(ps.backgroundColor)) continue;
            if (ps.backgroundImage && ps.backgroundImage !== 'none') continue;
            if (ps.boxShadow && ps.boxShadow !== 'none') continue;
            if (['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
              .some((k) => (parseFloat(ps[k]) || 0) > 0)) continue;
            const net = (parseFloat(ps.height) || 0)
              + (parseFloat(ps.marginTop) || 0)
              + (parseFloat(ps.marginBottom) || 0);
            if (net <= HEADING_SPACER_MIN_NET) continue;
            el.setAttribute(attr, '1');
            headingSpacerMarks.push({ el, attr });
          }
        }
      };

      const passVisibleEdgeChildMarks = () => {
        // v1.8.3：標記 articleEl 的第一個 / 最後一個「可見」direct child，供頂 /
        // 底端留白消除的 CSS 規則掛靠（原 `> *:first-child` / `> *:last-child` 的
        // 盲點見 EDGE_FIRST_ATTR 常數註解）。可見性判定沿用 isVisiblyShown——與
        // firstInk / firstVisibleH1 同一份標準（data-jread-hidden 子樹 + display:none
        // 祖先鏈）。首尾同一個元素時兩個標記都上（單一 child 的主文）。
        // 時序：跑在 cleaner.clean 之後（styler.apply 的呼叫點），所以隱藏標記已就位；
        // 之後動態 observer 若再隱藏 direct child 不會重標——direct child 層級的
        // 晚期隱藏罕見，且漏標只是回到「站方 padding 留著」的舊行為，不會破版。
        const kids = Array.from(articleEl.children);
        let first = null;
        let last = null;
        for (const k of kids) {
          if (isVisiblyShown(k, articleEl)) { first = k; break; }
        }
        for (let i = kids.length - 1; i >= 0; i -= 1) {
          if (isVisiblyShown(kids[i], articleEl)) { last = kids[i]; break; }
        }
        if (first) {
          first.setAttribute(EDGE_FIRST_ATTR, '1');
          edgeMarks.push({ el: first, attr: EDGE_FIRST_ATTR });
        }
        if (last) {
          last.setAttribute(EDGE_LAST_ATTR, '1');
          edgeMarks.push({ el: last, attr: EDGE_LAST_ATTR });
        }
      };

      const passBylineKicker = () => {
        // v1.0.8：byline meta 區一行正規化（見頂部 BYLINE_ATTR 常數註解）。
        // 偵測（結構訊號、非站點 class 特判）：date 訊號（<time> 或 date-regex 短文）
        // 與 author 訊號（行首 by / rel=author）的共同祖先，往上爬到「不含第一段內文
        // （>= 120 chars 的 p）、且 visible 文字 <= 200」的最高祖先 = byline root。
        // 只標 visible 元素（避免把站點隱藏的作者 hover card / 分享列重新顯示）。
        // 多站驗證（autocar / npr / techcrunch / bbc / theverge）選到乾淨 byline 區。
        {
          const win = articleEl.ownerDocument?.defaultView;
          if (win && win.getComputedStyle && !articleEl.querySelector(`[${BYLINE_ATTR}]`)) {
            const bnorm = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const bvisible = (el) => {
              if (el.closest && el.closest('[data-jread-hidden="1"]')) return false;
              const cs = win.getComputedStyle(el);
              return cs.display !== 'none' && cs.visibility !== 'hidden';
            };
            const bdirect = (el) => bnorm(Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(''));
            // v1.7.4：相對日期切段比對（見 BYLINE_SEG_SPLIT_RE 常數註解）
            // v1.9.11：同一條切段路徑加收無年份英文日期（見 BYLINE_YEARLESS_DATE_RE 常數註解）
            const brelDate = (s) => !!s && s.split(BYLINE_SEG_SPLIT_RE).some((seg) => {
              const t = seg.trim();
              return BYLINE_REL_DATE_RE.test(t) || BYLINE_YEARLESS_DATE_RE.test(t);
            });
            // v1.7.43：純分隔符 item 判定（null-safe）——markRt 相鄰分隔符標記與
            // 孤兒分隔符掃描共用（原兩份 micro-dup）
            const bisSep = (el) => !!el && BYLINE_SEP_RE.test(bnorm(el.textContent)) &&
              !el.querySelector('img, svg, picture, video');
            // v1.7.66：內文錨點加第二層——`<p>` 全 miss 時改用「div 當段落」標記
            // （`[TEXT_DIV_ATTR]`，由 passMarkTextDivs 標記、排在本 pass 之前）。
            // 根因：WYSIWYG / SPA 型頁面（Draft.js、Lexical、X / FB 貼文）整篇主文
            // 是 div，`querySelectorAll('p')` 回空 → firstBodyP = null →
            // beforeBody() 恆真 →「日期錨點必須在內文之前」這道 guard 整條靜默
            // 失效，往下抓到文末 metadata 的 <time>（X 貼文「上次編輯時間 / 觀看數」
            // 列被當 byline：日期 item 吃到 v1.5.28 的 order:1 被推到行尾、label
            // 後面剩孤兒「·」、整行染成連結色。Jimmy 2026-08-08 page rounds cage 輪）。
            //
            // 為什麼是「fallback」而不是把兩種 tag 併成一個 selector：text-div 標記
            // 的門檻只有「leaf div + 字級 >= 主流」，站點的長文字 widget 也會中
            // （probe 實測 theverge 文章內一顆 "ColumnClose…" 導覽 widget 被標成
            // text-div，且排在真正的 byline 之前）。併成一條 selector 會讓這類站
            // 的錨點提前到 widget、byline 反而偵測不到。`<p>` 是精度較高的段落訊號，
            // 有 `<p>` 就以它為準，第二層只補「一個 <p> 都沒有」的那類頁面——
            // 兩層判定基礎不同，不共用盲點。
            // v2.5.40：看不到的段落不算第一段內文。arstechnica 真站 <article> 第一個子元素
            // 是同意視窗（「Currently, only residents from GDPR countries…」），cleaner 已藏，
            // 但它的段落仍被當第一段內文 → 作者列排在它「之後」、整個作者列偵測落空：時刻沒藏、
            // 留言數連結被清後的「｜」變孤兒（語料庫快照沒有同意視窗，所以只有真站重現）
            let firstBodyP = null;
            for (const p of articleEl.querySelectorAll('p')) {
              if (bnorm(p.textContent).length >= 120 && isVisiblyShown(p, articleEl)) { firstBodyP = p; break; }
            }
            if (!firstBodyP) {
              for (const d of articleEl.querySelectorAll(`[${TEXT_DIV_ATTR}="1"]`)) {
                if (bnorm(d.textContent).length >= 120 && isVisiblyShown(d, articleEl)) { firstBodyP = d; break; }
              }
            }
            const beforeBody = (el) => !firstBodyP ||
              !!(el.compareDocumentPosition(firstBodyP) & Node.DOCUMENT_POSITION_FOLLOWING);
            // v2.5.22：資料表格裡的日期不是發稿日期。維基資訊框的「出生 1879 年 3 月 14 日」
            // 列、頁首維護告示的「(2023 年 3 月 18 日)」都在第一段主文之前、文字又短，會被
            // 當成日期錨，整列（或整張告示表）變成作者列：格子被打平成一行、非日期的字被
            // 當時刻藏掉（語料庫普查 168 頁，作者列落在表格內的 7 頁全是這類誤判）。
            // 結構訊號：日期在 <table> 裡、而那張表不含第一段主文（＝不是包住整篇文章的
            // 版面表格，老式表格排版的站不受影響）→ 跳過、往後找下一個
            const inDataTable = (el) => {
              const t = el.closest('table');
              return !!t && articleEl.contains(t) && !!firstBodyP && !t.contains(firstBodyP);
            };
            // date 訊號：<time> 優先、否則 date-regex 短文
            let dateEl = null;
            for (const t of articleEl.querySelectorAll('time')) {
              if (bvisible(t) && beforeBody(t) && bnorm(t.textContent) && !inDataTable(t)) { dateEl = t; break; }
            }
            if (!dateEl) {
              for (const el of articleEl.querySelectorAll('span, div, p, li, a')) {
                if (!beforeBody(el) || !bvisible(el)) continue;
                if (inDataTable(el)) continue;
                const dt = bdirect(el);
                // v1.7.4：絕對日期（子字串比對）或相對日期（切段全字串比對，見
                // BYLINE_REL_DATE_RE / BYLINE_SEG_SPLIT_RE 常數註解）皆可當日期錨。
                if (dt && dt.length < 40 && (BYLINE_DATE_RE.test(dt) || brelDate(dt))) { dateEl = el; break; }
              }
            }
            if (dateEl) {
              // author 訊號（選填、用於擴大 root 的 LCA）
              let authorEl = null;
              for (const el of articleEl.querySelectorAll('a[rel~="author"], span, div, p, a')) {
                if (!beforeBody(el) || !bvisible(el)) continue;
                const t = bnorm(el.textContent);
                if (BYLINE_AUTHOR_PREFIX_RE.test(t) && t.length < 60) { authorEl = el; break; }
              }
              let seed = dateEl;
              if (authorEl && authorEl !== dateEl) {
                const anc = new Set();
                for (let x = dateEl; x && x !== articleEl.parentElement; x = x.parentElement) anc.add(x);
                for (let y = authorEl; y && y !== articleEl.parentElement; y = y.parentElement) {
                  if (anc.has(y)) { seed = y; break; }
                }
              }
              // 內容尺寸大圖判定（byline meta 區塊結構上絕不含內容大圖；頭像 <=96px、
              // hero >=150px）。與下方 v1.6.18 prevSib guard 共用同一份判定。
              const bimgRect = (im) => {
                try { const r = im.getBoundingClientRect(); return { w: r.width, h: r.height }; }
                catch (_) { return { w: 0, h: 0 }; }
              };
              const bhasBigImg = (el) => Array.from(el.querySelectorAll('img, picture'))
                .some((im) => { const r = bimgRect(im); return r.w >= 150 || r.h >= 150; });
              // v1.6.10：LCA seed 有效性 guard——byline meta 區塊結構上絕不含文章標題/
              // 副標 heading。「作者在 hero 上方、日期在 hero 下方」的版面（The Atlantic
              // ArticleHero header：kicker → h1 標題 → dek → 作者 → hero figure → 日期）
              // 使 author+date 的 LCA engulf 整個 header（含 h1 + hero）。下方 climb 的
              // heading guard 只擋「往上爬進含 heading 的 parent」、擋不住 seed 自身已含
              // heading。若 seed 已含 heading，退回只用 dateEl 當 seed——climb 從日期
              // 往上會在 header（含 h1）邊界前停住，root 落在純日期 wrapper、不罩住 h1 與
              // hero figure。否則 byline root 罩住 hero img → 被 [BYLINE] img 頭像 50%
              // 圓角規則 render 成橢圓框（Jimmy 2026-07-02 回報 Atlantic hero 變圓框）。
              // v1.7.9：heading 之外加「內容大圖」訊號——Readwise Reader 把文件標題渲染
              // 在 article 容器外，同款「作者在 hero 上、日期在 hero 下」版面（header：
              // dek → 作者 → hero figure → 日期）內沒有 h1，heading guard 不觸發、LCA
              // 又 engulf 整個 header → hero 變橢圓（Jimmy 2026-07-16 回報）。seed 含
              // >=150px 大圖同樣代表過度捕捉，退回 dateEl。
              // v1.7.35：heading guard 擴充「promoted-title-source」——標題非
              // h1/h2/h3 的站（latepost 標題是 div）由 detector title-promote
              // 注入 h1 clone 到 articleEl 開頭、原標題元素標
              // data-jread-promoted-title-source + display:none。原標題所在的
              // 祖先（.article-header 級）等價於「含標題的祖先」，byline root
              // 絕不可包含（否則 climb 把整個 header 吞進 byline flex）。
              const BYLINE_STOP_SEL = 'h1, h2, h3, [data-jread-promoted-title-source]';
              if (seed !== dateEl && (seed.querySelector(BYLINE_STOP_SEL) || bhasBigImg(seed))) seed = dateEl;
              // 爬到「不含 body、不含標題/副標 heading、visible 文字 <= 200」的最高祖先。
              // v1.0.12：heading guard——byline（作者/日期 meta）結構上絕不會包住文章
              // 標題或副標（h1/h2/h3）。原本只用「文字 <= 200」當天花板，但翻譯後中文
              // 比英文緊湊（chinatalk Substack post-header 英文 113 字 → 中文 59 字），
              // 整個 post-header（含 h1 標題 + h3 副標 + byline）落在 200 內 → climb 把
              // post-header 當 byline root，h1/h3 被打平成 flex-wrap item，窄的中文副標
              // 與作者名同列（英文因 heading 夠寬各佔一列而僥倖沒露餡）。加 heading guard
              // 後 climb 在 heading 邊界前停住，root 落在真正的 author+date wrapper。
              // v1.7.9：climb 同步加大圖 guard——無 heading 的 header（見上）文字常
              // <= 200，seed 退回 dateEl 後 climb 仍會一路爬回含 hero 的 header，等於
              // seed guard 白退。爬進含內容大圖的 parent 一律停住。
              // v2.5.32：climb 加圖說 guard——作者列不會包住圖片的說明文字。theguardian
              // 1280 寬把作者、日期、首圖圖說放在同一個左側窄欄（<aside>）：原文欄內 257 字
              // 超過 200 天花板、climb 停在作者＋日期那層；譯成中文後不到 200，climb 一路
              // 爬到整個窄欄，圖說被打平成作者列的 flex item、與作者名擠在同一行，窄欄裡
              // display:contents 的空殼又撐出約 430px 空白（翻譯輪真站實測）。
              // 「圖說」用文字長度分辨：頭像 <figure> 的 figcaption 只放作者名（短），
              // 長於 BYLINE_CAPTION_MIN_LEN 的是照片說明
              const bhasImageCaption = (el) => Array.from(el.querySelectorAll('figcaption'))
                .some((fc) => bnorm(fc.textContent).length >= BYLINE_CAPTION_MIN_LEN);
              let root = seed;
              while (root.parentElement && root.parentElement !== articleEl &&
                     beforeBody(root.parentElement) &&
                     (!firstBodyP || !root.parentElement.contains(firstBodyP)) &&
                     !root.parentElement.querySelector(BYLINE_STOP_SEL) &&
                     !bhasBigImg(root.parentElement) &&
                     !bhasImageCaption(root.parentElement) &&
                     bnorm(root.parentElement.textContent).length <= 200) {
                root = root.parentElement;
              }
              const setMark = (el, attr) => {
                el.setAttribute(attr, '1'); bylineMarks.push({ el, attr });
                // v2.5.9：隱藏標記要贏過別人寫的 inline display !important（見 helper 註解）
                if (HIDDEN_MARK_ATTRS.indexOf(attr) !== -1) takeOverInlineDisplayForHiddenMark(el, bylineDispSnap);
              };
              // 設 inline display（覆蓋 cleaner collapseGridWithHiddenCell 的 inline
              // display:block !important——byline 容器常是 flex/grid + hidden 社群分享
              // child 被 collapse；stylesheet 的 byline flex 贏不過 inline !important）。
              // snapshot prev 供 styler.restore 還原；styler.restore 在 cleaner.restore
              // 之前（main.js 458→459），collapsed 元素還原成 cleaner 值、cleaner 再
              // 還原成原始。
              const setStyleImp = (el, prop, val) => {
                bylineDispSnap.push({ el, prop, prev: el.style.getPropertyValue(prop), prevP: el.style.getPropertyPriority(prop) });
                setInlineOwned(el, prop, val, 'important', 'styler:byline');
              };
              setMark(root, BYLINE_ATTR);
              setStyleImp(root, 'display', 'flex');
              // cleaner collapseGridWithHiddenCell 攤平 flex-row 時設了 inline
              // flex-direction:column（display:block 下無作用、但 byline 翻回 flex 後
              // 會生效成直排）——一併用 inline row 覆蓋
              setStyleImp(root, 'flex-direction', 'row');
              // 遞迴標 item（可見 leaf / 有直接文字 / 媒體）與 wrap（純 wrapper）
              // v1.7.4：item 同時含日期訊號與閱讀時間時不可整顆標 rt——Medium 近期
              // 文章的日期是 item 的 direct text、閱讀時間是同 item 的子元素
              //（<div><span>15 min read</span><span>·</span>5 days ago</div>），整顆
              // 藏會連日期一起消失（實測 byline 整條變空）。改往下找「命中閱讀時間、
              // 不含日期訊號」的最深子元素只藏它，並連帶藏其相鄰純分隔符（否則殘留
              //「·5 days ago」）。日期與閱讀時間同在 direct text 無法分離時保守不藏
              //（日期優先於「去閱讀時間」）。
              const hasDateSignal = (el) =>
                BYLINE_DATE_RE.test(bnorm(el.textContent)) || brelDate(bdirect(el));
              const markRt = (el) => {
                if (!hasDateSignal(el)) {
                  setMark(el, BYLINE_RT_ATTR);
                  if (bisSep(el.previousElementSibling)) setMark(el.previousElementSibling, BYLINE_SEP_ATTR);
                  if (bisSep(el.nextElementSibling)) setMark(el.nextElementSibling, BYLINE_SEP_ATTR);
                  return;
                }
                for (const c of el.children) {
                  if (BYLINE_RT_RE.test(bnorm(c.textContent))) { markRt(c); return; }
                }
              };
              const walk = (el) => {
                for (const child of el.children) {
                  if (!bvisible(child)) continue;
                  const tag = child.tagName.toUpperCase();
                  const isMedia = tag === 'IMG' || tag === 'PICTURE' || tag === 'TIME' || tag === 'SVG';
                  const hasText = bdirect(child).length > 0;
                  if (hasText || isMedia || child.children.length === 0) {
                    setMark(child, BYLINE_ITEM_ATTR);
                    // v1.7.12：多作者 inline 文字流（>= 2 條連結 + 直接分隔文字、
                    // 無媒體＝無頭像對齊需求）→ 標 inline attr 回歸自然文字換行，
                    // 免被 inline-flex nowrap 擠壓（見 BYLINE_INLINE_ATTR 常數註解）
                    if (hasText && child.querySelectorAll('a').length >= 2 &&
                        !child.querySelector('img, picture, svg, video')) {
                      setMark(child, BYLINE_INLINE_ATTR);
                    }
                    if (BYLINE_RT_RE.test(bnorm(child.textContent))) markRt(child);
                  } else {
                    setMark(child, BYLINE_WRAP_ATTR);
                    setStyleImp(child, 'display', 'contents');
                    walk(child);
                  }
                }
              };
              walk(root);
              // v1.7.35：byline 子樹字體統一補 inline !important。v1.0.20 的 CSS
              // 規則 `[BYLINE] * { font: inherit !important }` specificity 只有
              // (0,2,0)，被同為 !important 的 BODY_TEXT_SEL span 規則（:not 鏈疊到
              // (0,7,10)）打穿——byline 內的 span（latepost「文」「編輯」前綴）拿
              // 到使用者字級 17px、旁邊的作者連結繼承 root 的 12.4px，同一行字級
              // 不一致（Jimmy 2026-08-03 截圖）。inline style 必贏所有 stylesheet
              // 規則；只寫 font-family / font-size 兩條 longhand（本 bug 的兩個
              // 不一致維度），不動 font-weight——item 字重 400 正規化仍由既有
              // CSS 規則負責。子樹元素數量小（十餘個）、snapshot/restore 走既有
              // bylineDispSnap 機制。CSS `font: inherit` 規則保留當兜底。
              // v2.5.44：作者列祖先 font-size: 0（chinatimes .article-header / .meta-info：
              // 消 inline-block 間空白的寫法，外層歸 0、子項目各自指定字級）。子項目統一
              // inherit 後全部繼承成 0px，整行（時間、來源、作者）消失。root 量到 < 1px 時，
              // 跳過被站方歸 0 的那一段繼承鏈：往上找第一個字級不是 0 的祖先，把 root 釘成
              // 那個值，子項目照舊 inherit。不取子項目自己的字級——統一時閱讀模式 CSS 已
              // 套上，span 量到的是使用者內文字級（v1.7.35 註解），作者列會跟內文一樣大。
              // root 本來就有字級的（絕大多數站）一個值都不多寫
              const zeroFontFallbackPx = (rootEl) => {
                if (!(parseFloat(win.getComputedStyle(rootEl).fontSize) < 1)) return 0;
                for (let a = rootEl.parentElement; a; a = a.parentElement) {
                  const px = parseFloat(win.getComputedStyle(a).fontSize);
                  if (px >= 1) return px;
                }
                return 0;
              };
              const unifyFont = (rootEl) => {
                const fallbackPx = zeroFontFallbackPx(rootEl);
                for (const el of rootEl.querySelectorAll('*')) {
                  setStyleImp(el, 'font-family', 'inherit');
                  setStyleImp(el, 'font-size', 'inherit');
                }
                if (fallbackPx >= 1) setStyleImp(rootEl, 'font-size', fallbackPx + 'px');
              };
              unifyFont(root);
              // v1.7.39：byline 頭像隱藏改走 runtime inline !important。v1.7.25 的
              // CSS 規則 `[BYLINE] img/picture { display:none }` specificity 只有
              // (0,2,1)：裸 <img>（> inline 門檻）被 MEDIA_CAP_SEL (0,3,3) 的
              // display:block 打穿、小裸圖被 inline-img 規則（同 specificity、
              // source order 在後）打穿——真 Chromium probe 實證只有 <picture> 包
              // 與 <a> 包的頭像藏得掉。inline !important 必贏所有 stylesheet 規則、
              // 終結 specificity 軍備；snapshot/restore 走既有 bylineDispSnap。
              // CSS 規則保留當兜底（涵蓋 apply 之後動態插入的頭像）。
              const hideAvatarMedia = (rootEl) => {
                for (const el of rootEl.querySelectorAll('img, picture')) {
                  setStyleImp(el, 'display', 'none');
                }
              };
              hideAvatarMedia(root);
              // v1.6.18：byline root 落在 date-only（seed 因 LCA 含標題退回 dateEl、
              // 或 author 與 date 無共同乾淨祖先）時，作者列常是 date root 的「相鄰前一個
              // sibling」而未被納入 → 維持站點 header 的 text-align:center，與已左對齊的
              // 日期列不一致（Fox News `<header class="article-header">` text-align:center，
              // `.author-byline`（頭像+作者）置中、日期 flex 列靠左，Jimmy 2026-07-08 回報
              // 「byline 排版亂七八糟」）。把該相鄰作者列也標成 byline root（同 flex + 左
              // 對齊 + item 正規化），兩列一致左排。
              // guard（四道、皆結構訊號）：只認 date root 的「相鄰前一個 visible sibling」
              // ——Atlantic 型（作者在 hero 上方、與日期非相鄰、中間隔 <figure>）不相鄰 →
              // 不命中（見 v1.6.10 guard + atlantic-hero-byline-overcapture fixture）；且
              // 該 sibling 須①不含 heading（h1/h2/h3）②不含內容大圖（>=150px，排除 hero）
              // ③visible 文字 <= 200 ④含作者訊號（rel=author / 行首 By / 小頭像 img）。
              {
                let prevSib = root.previousElementSibling;
                while (prevSib && !bvisible(prevSib)) prevSib = prevSib.previousElementSibling;
                if (prevSib && !prevSib.hasAttribute(BYLINE_ATTR) && beforeBody(prevSib) &&
                    !prevSib.querySelector(BYLINE_STOP_SEL) &&
                    bnorm(prevSib.textContent).length <= 200) {
                  // v1.7.9：大圖/頭像尺寸判定改用上方 bimgRect / bhasBigImg 共用 helper
                  const hasBigImg = bhasBigImg(prevSib);
                  const hasAuthorSignal =
                    !!prevSib.querySelector('a[rel~="author"]') ||
                    BYLINE_AUTHOR_PREFIX_RE.test(bnorm(prevSib.textContent)) ||
                    Array.from(prevSib.querySelectorAll('img'))
                      .some((im) => { const r = bimgRect(im); return r.w > 0 && r.w <= 96 && r.h <= 96; });
                  if (hasAuthorSignal && !hasBigImg) {
                    setMark(prevSib, BYLINE_ATTR);
                    setStyleImp(prevSib, 'display', 'flex');
                    setStyleImp(prevSib, 'flex-direction', 'row');
                    walk(prevSib);
                    unifyFont(prevSib);
                    hideAvatarMedia(prevSib); // v1.7.39：第二 root 同步隱藏頭像
                  }
                }
              }
              // v1.5.28：日期 item = 含 dateEl 的最近 byline item（NPR 即 <time> 自身）。
              // 下面時刻隱藏（結構訊號）與作者排序（order）都以它為錨。
              let dateItem = dateEl;
              while (dateItem && dateItem !== root && !dateItem.hasAttribute(BYLINE_ITEM_ATTR)) {
                dateItem = dateItem.parentElement;
              }
              const dateItemValid = dateItem && dateItem !== root && dateItem.hasAttribute(BYLINE_ITEM_ATTR);

              // v1.5.28：隱藏 byline 內的發稿時刻（"1:59 PM ET"），只留日期。
              // 結構訊號（翻譯無關，Jimmy 2026-07-02 Shinkansen 譯後「東岸時間下午
              // 1:59」殘留實測）：日期 item（<time>）內若有子元素文字符合 BYLINE_DATE_RE
              //（此 regex 含中文「2026 年 6 月 1 日」），把**不符日期**的兄弟子元素
              //（時刻/時區）隱藏。BYLINE_DATE_RE 判別日期 vs 時刻、不靠英文時刻字面，
              // 故 Shinkansen 就地譯文（結構不變、僅換文字）照樣命中。
              //
              // v2.5.22：連結不是時刻。日期 item 有時是「作者連結 + 分隔符 + <time>」同一個
              // 容器（arstechnica：`<div><a href="/author/…">名字</a> – <span><time>…</time>
              // …</span></div>`，Jimmy 2026-11-18 語料庫審查「只剩破折號＋日期」），作者連結
              // 的直接文字不是日期 → 被當時刻藏掉。維基資訊框的出生地連結同理（th / hi / he
              // 語料庫實證）。時刻與時區是純文字、不會是連結——元素自己是連結、在日期 item
              // 內的連結裡、或自己包著連結，一律不藏（結構訊號，譯文不影響）。
              const isLinkish = (c) => {
                if (c.tagName === 'A' && c.hasAttribute('href')) return true;
                const up = c.closest && c.closest('a[href]');
                if (up && dateItem.contains(up)) return true;
                return !!(c.querySelector && c.querySelector('a[href]'));
              };
              if (dateItemValid) {
                const kids = Array.from(dateItem.querySelectorAll('*')).filter(bvisible);
                const hasDateKid = kids.some((c) => BYLINE_DATE_RE.test(bnorm(bdirect(c))));
                if (hasDateKid) {
                  for (const c of kids) {
                    const dt = bnorm(bdirect(c));
                    if (dt && !BYLINE_DATE_RE.test(dt) && !isLinkish(c)) setMark(c, BYLINE_TIME_ATTR);
                  }
                }
              }
              // v2.5.40：日期與時刻在同一個文字節點（arstechnica 的 <time> 是「2025年4月14日
              // 下午7:00」，站方 script 格式化成一整串；語料庫 KNOWN-ISSUES「日期後面的時刻沒藏」）。
              // 上面兩條都以元素為單位，一個文字節點分不開。日期錨元素裡、日期之後緊接的剩餘文字
              // 整段是時刻（BYLINE_TRAILING_TIME_RE：可帶上午 / 下午、am / pm、時區）→ 切成
              // 一個 span 標時刻、交給同一條隱藏規則；restore 併回原文字節點。翻譯後格式相同
              //（Shinkansen 不改 <time> 的數字格式；譯成「下午 7:00」也在 regex 內）
              {
                const tn = Array.from(dateEl.childNodes).filter((n) => n.nodeType === 3 && bnorm(n.nodeValue));
                if (tn.length === 1 && !dateEl.children.length) {
                  const textNode = tn[0];
                  const orig = textNode.nodeValue;
                  const m = BYLINE_DATE_RE.exec(orig);
                  if (m) {
                    const end = m.index + m[0].length;
                    const rest = orig.slice(end);
                    if (BYLINE_TRAILING_TIME_RE.test(rest.trim())) {
                      const span = articleEl.ownerDocument.createElement('span');
                      span.textContent = rest;
                      textNode.nodeValue = orig.slice(0, end);
                      textNode.parentNode.insertBefore(span, textNode.nextSibling);
                      bylineTimeSplits.push({ textNode, span, orig });
                      setMark(span, BYLINE_TIME_ATTR);
                    }
                  }
                }
              }
              // 補充（英文、時刻為獨立 byline item 而非日期 item 子元素的情況）：整段
              // 直接文字＝純時刻（HH:MM AM/PM TZ）的葉元素也隱藏。譯後 DOM 不命中此
              // regex，靠上面結構訊號接住。安全閘：隱藏後 root 仍須有日期訊號才動手。
              const rootHasDateWithout = (el) =>
                BYLINE_DATE_RE.test(bnorm(root.textContent).replace(bnorm(el.textContent), ''));
              for (const el of root.querySelectorAll('*')) {
                if (!bvisible(el)) continue;
                const dt = bdirect(el);
                if (dt && BYLINE_TIME_RE.test(dt) && rootHasDateWithout(el)) {
                  setMark(el, BYLINE_TIME_ATTR);
                }
              }
              // v1.5.28：清掉「Heard on <節目>」廣播節目出處 chip（閱讀模式非必要
              // metadata）。兩訊號並用：① 英文句式開頭（Heard/Aired/Broadcast on）；
              // ② item 內連結 href 命中 /programs|shows|podcasts|episodes/（翻譯無關
              // ——href 不被 Shinkansen 翻譯，譯後 DOM 靠這條接住「聽過《早晨版》」）。
              for (const el of root.querySelectorAll(`[${BYLINE_ITEM_ATTR}]`)) {
                const hitText = BYLINE_PROGRAM_RE.test(bnorm(el.textContent));
                // 連結含自身（item 本身即 <a> 時 querySelectorAll('a') 不含它）
                const links = [el, ...el.querySelectorAll('a[href]')]
                  .filter((a) => a.tagName === 'A' && a.getAttribute('href'));
                const hitUrl = !hitText && links.some((a) => BYLINE_PROGRAM_URL_RE.test(a.getAttribute('href')));
                if (hitText || hitUrl) setMark(el, BYLINE_PROGRAM_ATTR);
              }
              // v1.5.28：作者排在日期前——把日期 item order:1 推到最後，其餘 item 維持
              // 預設 order:0 排前。不必逐站辨識作者（NPR 作者無 rel=author / By 前綴，
              // 辨識 fragile），只認可靠的日期錨（<time>，翻譯無關）。
              if (dateItemValid) {
                setMark(dateItem, BYLINE_DATE_ITEM_ATTR);
                // v2.5.6：byline 有兩個以上日期 item（dev.to「Posted on … • Edited on …」、
                // cna「發稿時間（更新時間）」、vocus「更新 · 發佈」）時，上面只把錨點那一個
                // 推到行尾，其餘日期留在 order:0 → 視覺順序與站方相反（v1.5.28 起就有）。
                // 改成同一個 root 內「每個日期 item」都標，同為 order:1 時照 DOM 順序排，
                // 日期群維持站方相對順序、整群仍在作者之後。被兩個日期 item 夾住的分隔符
                // 一起標（否則分隔符留在前段、兩個日期黏在一起）。
                // 日期 item 判定（結構訊號，翻譯無關的 <time> 優先）：含有文字的 <time>，
                // 或整段文字 < 40 字且命中日期（與上方 dateEl 的文字錨同一組條件）。
                // 內含連結的 item 不認（「作者連結＋日期」合在一格時標了會把作者一起推到行尾；
                // 整個 item 就是日期連結、或 <time> 外面包一層連結的不受影響）；
                // 分隔符含 CSS 畫的空殼點（無文字、無子元素；圖片在 byline 內一律被藏、不用另外排除）。
                // 只有一個日期 item 的 byline 不會多標任何東西，行為與 v2.5.5 相同。
                // 這條只管順序、不管隱藏。日期群後面接的非日期 item 由下面 v2.5.8 那段處理。
                const ditems = Array.from(root.querySelectorAll(`[${BYLINE_ITEM_ATTR}]`));
                const isShellSep = (el) => !el.children.length && !bnorm(el.textContent);
                const isSepLike = (el) => bisSep(el) || isShellSep(el);
                const isDateFlags = ditems.map((el) => {
                  if (el === dateItem) return true;
                  if (isSepLike(el)) return false;
                  if (el.querySelector('a[href]')) return false;
                  const times = el.tagName === 'TIME' ? [el] : Array.from(el.querySelectorAll('time'));
                  if (times.some((t) => bnorm(t.textContent))) return true;
                  const txt = bnorm(el.textContent);
                  return txt.length < 40 && (BYLINE_DATE_RE.test(txt) || brelDate(txt));
                });
                ditems.forEach((el, i) => {
                  if (el === dateItem) return;
                  let mark = isDateFlags[i];
                  if (!mark && isSepLike(el)) {
                    let p = -1;
                    for (let j = i - 1; j >= 0; j--) { if (!isSepLike(ditems[j])) { p = j; break; } }
                    let n = -1;
                    for (let j = i + 1; j < ditems.length; j++) { if (!isSepLike(ditems[j])) { n = j; break; } }
                    mark = p >= 0 && n >= 0 && isDateFlags[p] && isDateFlags[n];
                  }
                  if (mark) setMark(el, BYLINE_DATE_ITEM_ATTR);
                });
                // v3.7.7：日期前面的標籤跟著日期走。Trigger：stackoverflow 標題下「Asked <time>」——
                // 站方每一格是 `<div><span>Asked</span><time>…</time></div>`，作者列把格子攤平
                //（BYLINE_WRAP_ATTR 的 display: contents），只有 <time> 推到行尾、「Asked」留在原位，
                // 變成「Asked　Viewed 84k times　5 years ago」（語料庫 KNOWN-ISSUES，Jimmy 2026-11-27
                // 裁定標籤跟著日期一起排到行尾）。
                // 條件（結構訊號）：日期項目的父層是被攤平的格子；同一格裡排在日期前面的項目
                // 沒有連結、20 字以內、不是作者字樣（「By」）、本身不是日期——就是那個日期的標籤
                for (const d of ditems) {
                  if (!d.hasAttribute(BYLINE_DATE_ITEM_ATTR)) continue;
                  const cell = d.parentElement;
                  if (!cell || !cell.hasAttribute(BYLINE_WRAP_ATTR)) continue;
                  const before = ditems.filter((el) => el !== d && el.parentElement === cell &&
                    (el.compareDocumentPosition(d) & 4 /* d 在後 */));
                  const isLabel = (el) => {
                    if (el.hasAttribute(BYLINE_DATE_ITEM_ATTR)) return false;
                    if (el.tagName === 'A' || el.querySelector('a[href]')) return false;
                    const t = bnorm(el.textContent);
                    return !!t && t.length <= 20 && !BYLINE_AUTHOR_PREFIX_RE.test(t) &&
                      !BYLINE_DATE_RE.test(t) && !brelDate(t);
                  };
                  if (before.length && before.every(isLabel)) {
                    for (const el of before) setMark(el, BYLINE_DATE_ITEM_ATTR);
                  }
                }
                // v2.5.8：站方把日期與附屬項目收在同一層容器、作者在容器外面時，整層跟著
                // 日期走（dev.to `<a>作者</a><p>Posted • Edited • Originally published at…</p>`：
                // 上面只標日期群，「• Originally published at」留在 order:0 → 排到日期前面，
                // 站方順序是 Posted · Edited · Originally。同型：vocus 日期列尾的閱讀時間、
                // distill `.date` 內月日與年份兩格）。全部同為 order:1 時照 DOM 順序排＝
                // 該層維持站方順序、整層在作者之後。
                // 條件（都是結構訊號，不認文字內容）：
                //   ① 所有日期 item 的父層是同一個容器（日期直接掛在 root 底下＝作者與日期
                //      同層時，容器就是 root、③ 不可能成立，維持上面的行為）
                //   ② 容器內第一個非分隔符 item 是日期（日期前面還有別的項目時，那個項目
                //      可能就是作者——v1.5.28 的「作者排在日期前」要靠它留在 order:0）
                //   ③ 容器之前（DOM 序）有帶文字的 item（容器外沒有東西留在前段時，整層
                //      都標等於沒排序，不必動）
                //   ④ 容器內的非日期 item 沒有作者訊號（rel=author / 行首 By 前綴）——
                //      「標籤在外、日期與作者同層」時不可把作者推到日期後面
                {
                  const group = dateItem.parentElement;
                  if (group &&
                      ditems.every((el, i) => !isDateFlags[i] || el.parentElement === group)) {
                    const inGroup = ditems.filter((el) => group.contains(el));
                    const lead = inGroup.find((el) => !isSepLike(el));
                    const headBefore = ditems.some((el) => !group.contains(el) &&
                      bnorm(el.textContent) && !bisSep(el) &&
                      (el.compareDocumentPosition(group) & 4 /* DOCUMENT_POSITION_FOLLOWING */));
                    const authorInside = inGroup.some((el) => !isDateFlags[ditems.indexOf(el)] &&
                      ((el.matches && el.matches('a[rel~="author"]')) || el.querySelector('a[rel~="author"]') ||
                       BYLINE_AUTHOR_PREFIX_RE.test(bnorm(el.textContent))));
                    if (lead && isDateFlags[ditems.indexOf(lead)] && headBefore && !authorInside) {
                      for (const el of inGroup) setMark(el, BYLINE_DATE_ITEM_ATTR);
                    }
                  }
                }
              }
              // v1.7.5：撤銷 byline 子樹的段落載體標記——markTextDivs 依排序約束
              //（v0.8.49：主流字級要量原站 CSS，須在 ARTICLE_ATTR 前跑）先於 byline
              // 標記執行，無法用 closest guard 排除。翻譯合併後的 byline 列（div 直含
              // 文字、無 block 子元素、字級不小於主流）會先被標 text-div，吃到段落
              // 間距 margin-bottom（userOverrides 排在 byline item margin:0 之後、
              // 同 specificity 後注入者贏）→ byline 下方多一行段距。byline 是 meta
              // 列非段落，整棵撤標；restore 端 textDivMarked 的 removeAttribute 對
              // 已撤元素是冪等 no-op，不需同步剔除。
              for (const broot of articleEl.querySelectorAll(`[${BYLINE_ATTR}]`)) {
                if (broot.hasAttribute(TEXT_DIV_ATTR)) broot.removeAttribute(TEXT_DIV_ATTR);
                for (const d of broot.querySelectorAll(`[${TEXT_DIV_ATTR}]`)) d.removeAttribute(TEXT_DIV_ATTR);
                // v2.5.34：小字段落 div 標記同樣撤掉——作者列的字體由 byline 自己統一，
                // 標了反而改到作者列 span 的行高（語料庫 404media 作者名、thewoksoflife「Updated:」）
                if (broot.hasAttribute(SMALL_TEXT_DIV_ATTR)) broot.removeAttribute(SMALL_TEXT_DIV_ATTR);
                for (const d of broot.querySelectorAll(`[${SMALL_TEXT_DIV_ATTR}]`)) d.removeAttribute(SMALL_TEXT_DIV_ATTR);
              }
              // v1.7.4：孤兒分隔符隱藏（見 BYLINE_SEP_ATTR 常數註解）。必須在所有
              // 隱藏標記（walk 的 RT、上方 TIME、PROGRAM）之後跑：純分隔符 item 的
              // 相鄰非分隔符 item（DOM 序、跳過其他分隔符）任一側缺席或已被隱藏 →
              // 分隔符失去被隔開的對象，一併隱藏。兩側都可見才保留。
              {
                const items = Array.from(root.querySelectorAll(`[${BYLINE_ITEM_ATTR}]`));
                const isHiddenItem = (el) => el.hasAttribute(BYLINE_RT_ATTR) ||
                  el.hasAttribute(BYLINE_TIME_ATTR) || el.hasAttribute(BYLINE_PROGRAM_ATTR);
                // v2.5.9：CSS 畫的分隔點也算分隔符（見 isDotShellSep）；每個 item 只量一次
                const sepFlags = items.map((el) => bisSep(el) || isDotShellSep(el));
                items.forEach((el, i) => {
                  if (!sepFlags[i]) return;
                  let prev = null;
                  for (let j = i - 1; j >= 0; j--) { if (!sepFlags[j]) { prev = items[j]; break; } }
                  let next = null;
                  for (let j = i + 1; j < items.length; j++) { if (!sepFlags[j]) { next = items[j]; break; } }
                  if (!prev || isHiddenItem(prev) || !next || isHiddenItem(next)) {
                    setMark(el, BYLINE_SEP_ATTR);
                  }
                });
                // v1.9.11：零尺寸空殼 item（無文字、無媒體、無子元素、rect 寬或高
                // 為 0）一併隱藏。站點用空 div 當 CSS 分隔點、或留空的佔位 span
                //（Readwise Reader metadata row 的 separator / 無 tag 時的 tags 容器），
                // 本身看不見，但身為 root 的 flex item 每顆各吃一個 column-gap——作者
                // 與日期之間實測 30px（應為 10px）。bisSep 靠文字判定、接不到這類
                // 空殼。有實際寬高的 CSS 繪製分隔點不動（那是看得見的分隔符）。
                for (const el of items) {
                  if (el.hasAttribute(BYLINE_SEP_ATTR) || el.children.length || bnorm(el.textContent)) continue;
                  if (/^(IMG|PICTURE|TIME|SVG|VIDEO)$/i.test(el.tagName)) continue;
                  let r = null;
                  try { r = el.getBoundingClientRect(); } catch (_) { r = null; }
                  if (r && (r.width === 0 || r.height === 0)) setMark(el, BYLINE_SEP_ATTR);
                }
                // v3.7.11：看不見的 pseudo 變成作者列的 flex 項目、白吃一格 column-gap（作者名前
                // 多 9–21px 空白；Jimmy 2026-11-27 裁定修）。root 與 display: contents 的 wrapper
                // 身上的 ::before / ::after 在 flex 容器裡各自是一個 flex 項目：npr、plos 的 clearfix
                //（content: " "; display: table，0 寬）、theregister `address::before`（content: ""、
                // 13px 方塊，站方圖示背景被 pseudo 底色清除規則拿掉）。
                // 條件（量注入後的現況）：content 是空字串或只有空白、在文流裡（static / relative）、
                // 什麼都不畫（底色透明、沒有背景圖、沒有框線與陰影）。有字的分隔符、底色畫的圓點、
                // 框線畫的形狀都不動（下一段 v2.5.52 處理位置脫節的分隔符字）
                // 無 layout 引擎的環境（jsdom）不量 pseudo——jsdom 未實作帶 pseudo 參數的
                // getComputedStyle（同 passHeadingPseudoSpacerReset 的 short-circuit 判定）
                const pRootEl = articleEl.ownerDocument && articleEl.ownerDocument.documentElement;
                if (pRootEl && pRootEl.getBoundingClientRect().height > 0) {
                  const hosts = [root, ...root.querySelectorAll(`[${BYLINE_WRAP_ATTR}]`)];
                  for (const host of hosts) {
                    if (host.hasAttribute(BYLINE_PSEUDO_SEP_ATTR)) continue;
                    const sides = [];
                    for (const side of ['before', 'after']) {
                      let ps = null;
                      try { ps = getComputedStyle(host, '::' + side); } catch (_) { ps = null; }
                      if (!ps || ps.display === 'none') continue;
                      const m = /^(["'])(.*)\1$/.exec(ps.content || '');
                      if (!m || m[2].trim()) continue;
                      if (ps.position !== 'static' && ps.position !== 'relative') continue;
                      if (!/^(?:transparent|rgba\([^)]*,\s*0\))$/.test(ps.backgroundColor || '')) continue;
                      if (ps.backgroundImage && ps.backgroundImage !== 'none') continue;
                      if (ps.boxShadow && ps.boxShadow !== 'none') continue;
                      const bw = ['Top', 'Right', 'Bottom', 'Left'].reduce((s, k) => s + (parseFloat(ps['border' + k + 'Width']) || 0), 0);
                      if (bw > 0) continue;
                      sides.push(side);
                    }
                    if (!sides.length) continue;
                    host.setAttribute(BYLINE_PSEUDO_SEP_ATTR, sides.join(' '));
                    bylineMarks.push({ el: host, attr: BYLINE_PSEUDO_SEP_ATTR });
                  }
                }
                // v2.5.52：站方 pseudo 畫的分隔符跟著被藏 / 被推走的項目脫節（見 BYLINE_PSEUDO_SEP_ATTR）。
                // 依「最終順序」判斷：看得到的非日期項目照 DOM 序、日期項目全推到最後（order: 1）。
                // 宿主的 ::after 只在「最終順序裡緊接宿主最後一個項目的」＝「DOM 裡緊接宿主的那個
                // 看得到的項目」時位置才對；::before 對稱。宿主裡的項目全被藏 → 兩側都脫節。
                // 「作者 · 日期」這種本來就對的分隔符不動
                {
                  const hiddenSel = `[${BYLINE_TIME_ATTR}], [${BYLINE_RT_ATTR}], [${BYLINE_PROGRAM_ATTR}]`;
                  const shown = items.filter((el) => !el.matches(hiddenSel) && !el.hasAttribute(BYLINE_SEP_ATTR) && !sepFlags[items.indexOf(el)]);
                  const finalOrder = shown.filter((el) => !el.hasAttribute(BYLINE_DATE_ITEM_ATTR))
                    .concat(shown.filter((el) => el.hasAttribute(BYLINE_DATE_ITEM_ATTR)));
                  const FOLLOW = Node.DOCUMENT_POSITION_FOLLOWING;
                  const misplacedSides = (host) => {
                    const inHost = shown.filter((it) => it === host || host.contains(it));
                    if (!inHost.length) return ['before', 'after'];
                    const outside = shown.filter((it) => !inHost.includes(it));
                    const domNext = outside.find((it) => host.compareDocumentPosition(it) & FOLLOW) || null;
                    const domPrev = outside.filter((it) => !(host.compareDocumentPosition(it) & FOLLOW)).pop() || null;
                    const idx = inHost.map((it) => finalOrder.indexOf(it));
                    const finalNext = finalOrder[Math.max(...idx) + 1] || null;
                    const finalPrev = finalOrder[Math.min(...idx) - 1] || null;
                    const out = [];
                    if (!domPrev || finalPrev !== domPrev) out.push('before');
                    if (!domNext || finalNext !== domNext) out.push('after');
                    return out;
                  };
                  for (const el of NS.selfAndDescendants(root, '*')) {
                    if (el === root) continue;
                    // v3.7.11：上一段已標了一側（看不見的空 pseudo）的 wrapper 照樣檢查另一側、合併標記
                    const prevSides = (el.getAttribute(BYLINE_PSEUDO_SEP_ATTR) || '').split(' ').filter(Boolean);
                    // 項目內部的 pseudo（cnbc `<time>日期<span class=…Divider></span>時刻</time>` 的分隔 span）
                    // 不是項目之間的分隔符
                    if (items.some((it) => it !== el && it.contains(el))) continue;
                    const sides = [];
                    let bad = null;
                    for (const side of ['before', 'after']) {
                      let c = '';
                      try { c = getComputedStyle(el, '::' + side).content || ''; } catch (_) { continue; }
                      const m = /^(["'])(.*)\1$/.exec(c);
                      if (!m) continue; // none / normal / counter() / url()
                      const txt = m[2].trim();
                      if (!txt || !BYLINE_SEP_RE.test(txt)) continue; // 只認分隔符字；空殼、空白、字不動
                      if (!bad) bad = misplacedSides(el);
                      if (bad.includes(side)) sides.push(side);
                    }
                    if (!sides.length) continue;
                    el.setAttribute(BYLINE_PSEUDO_SEP_ATTR, [...new Set([...prevSides, ...sides])].join(' '));
                    if (!prevSides.length) bylineMarks.push({ el, attr: BYLINE_PSEUDO_SEP_ATTR });
                  }
                }
              }
            }
            // v1.5.28：移除標題前的分類 kicker / eyebrow（NPR「BUSINESS」連到
            // /sections/business/）。結構訊號（非站點特判）：標題 H1「之前」、連到
            // 分類頁（SECTION_URL_RE）的短連結。往上爬到「文字仍等於 kicker 文字」的
            // 最高 wrapper 一併隱藏（避免只藏連結、留空的 slug 容器殘留高度），比照
            // byline root 的 climb。href 不被翻譯 → 譯後 DOM 照樣命中（Shinkansen
            // 把「Business」譯成「商業」，wrapper 文字同步變、climb 仍成立）。獨立於
            // byline 偵測（無日期的頁面也要清 kicker）。restore 走 bylineMarks 移除標記。
            // v1.7.43：改取第一個「可見」h1（原本裸 querySelector——站點隱藏的
            // 響應式重複 h1 在 DOM order 較早時，kicker 錨點會錨錯位置）
            const titleH1 = firstVisibleH1(articleEl);
            if (titleH1) {
              const beforeTitle = (el) =>
                !!(el.compareDocumentPosition(titleH1) & Node.DOCUMENT_POSITION_FOLLOWING);
              for (const a of articleEl.querySelectorAll('a[href]')) {
                if (!bvisible(a) || !beforeTitle(a)) continue;
                if (!SECTION_URL_RE.test(a.getAttribute('href') || '')) continue;
                const t = bnorm(a.textContent);
                if (!t || t.length > 30) continue;
                let k = a;
                while (k.parentElement && k.parentElement !== articleEl &&
                       beforeTitle(k.parentElement) &&
                       bnorm(k.parentElement.textContent) === t) {
                  k = k.parentElement;
                }
                if (!k.hasAttribute(KICKER_ATTR)) {
                  k.setAttribute(KICKER_ATTR, '1');
                  bylineMarks.push({ el: k, attr: KICKER_ATTR });
                  takeOverInlineDisplayForHiddenMark(k, bylineDispSnap); // v2.5.9：同 setMark
                }
              }
            }
          }
        }
      };

      const passBlockquoteMarks = () => {
        // v1.9.12：引言視覺補強（見 BQ_PLAIN_ATTR / BQ_UPRIGHT_ATTR 常數註解）。
        // 排在 contrast 各 phase 之後：dark / sepia 會強制清 blockquote 背景
        //（v0.7.154），「只靠淺底區分」的站方引言框在暗色主題下量到的就是透明 →
        // 判為無裝飾 → 補邊線，正好補回被清掉的區隔；light 下底色還在 → 不動。
        //
        // 「有裝飾」判定（任一成立即不標 plain）——量 computed、非 class 特判：
        //   自身 / 可見直接子元素 / 包裝父層（父層只包這一顆、或父層是 figure /
        //   aside 這類引言包裝慣例）任一有：可見邊線（width > 0 + style 非 none + 對後方底色對比 >= 3:1 +
        //   顏色非透明）、背景色 alpha >= 0.05 或背景圖、box-shadow、或有內容 /
        //   有底色的 ::before / ::after（引號圖示、色條）。
        //   量的是「reader CSS 注入後」的 computed：子層若是 div / p 這類不在
        //   BORDER / BG preserve 清單的 tag，其邊線與底色早被 reader 通則清掉、
        //   量到就是無裝飾（畫面上確實也看不到）→ 照補邊線，這是預期行為。
        // 已知取捨：站方拿 <blockquote> 當純縮排（內容不是引言）也會補邊線——
        // probe 四站（stratechery / wikipedia / paulgraham / Reader）未見此用法，
        // 且語意上 blockquote 就是引言，補邊線不算錯。
        //
        // 訊號層次：本 pass 驗「blockquote 的 computed 裝飾」一層。不驗站方用
        // <p> / <div> + class 做的引言（沒有 tag 語意、無結構訊號可抓）、不驗
        // apply 之後才 lazy 注入的 blockquote。
        const bwin = articleEl.ownerDocument?.defaultView;
        if (!bwin || !bwin.getComputedStyle) return;
        const alphaOf = (c) => {
          if (!c || c === 'transparent') return 0;
          const m = /^rgba?\(([^)]+)\)$/.exec(c);
          if (!m) return 1; // 具名色 / hex（jsdom）＝不透明
          const parts = m[1].split(',');
          return parts.length >= 4 ? (parseFloat(parts[3]) || 0) : 1;
        };
        // v2.2.11：邊線「看得見」還要對比夠（Jimmy 2026-10-28，sharptext.net 暗色
        // 主題）。站方為淺底設計的引言線（WordPress wp-block-quote 1px #333）在 dark
        // 卡片 #4a494d 上只剩 1.41:1——量得到、肉眼幾乎看不到，卻因此被判「有裝飾」
        // 而不補主題色邊線。改成邊線色疊在其後方底色（behind：元素外側的 effective
        // bg）上的對比 < CONTRAST_MIN_RATIO（3:1，WCAG 非文字元素下限）即視為不可見。
        // 顏色解析不了（jsdom 具名色）→ 退回只看 alpha 的舊判定。
        const cardBg = parseCssColor(theme.articleBg) || WHITE;
        const bgBehind = (el) => (el && el !== articleEl && articleEl.contains(el))
          ? compositeBgOver(el, articleEl, cardBg, bwin) : cardBg;
        const hasVisibleBorder = (cs, behind) => ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
          if (!((parseFloat(cs[`border${side}Width`]) || 0) > 0 &&
            cs[`border${side}Style`] && cs[`border${side}Style`] !== 'none' &&
            alphaOf(cs[`border${side}Color`]) >= 0.05)) return false;
          const c = parseCssColor(cs[`border${side}Color`]);
          if (!c) return true;
          return contrastRatio(blendOver(c, behind), behind) >= CONTRAST_MIN_RATIO;
        });
        const hasOwnBg = (cs) => alphaOf(cs.backgroundColor) >= 0.05 ||
          (!!cs.backgroundImage && cs.backgroundImage !== 'none');
        // 無 layout 引擎的環境（jsdom）不量 pseudo——jsdom 未實作帶 pseudo 參數的
        // getComputedStyle（同 passHeadingPseudoSpacerReset 的 short-circuit 判定）
        const bRootEl = articleEl.ownerDocument && articleEl.ownerDocument.documentElement;
        const hasLayout = !!bRootEl && bRootEl.getBoundingClientRect().height > 0;
        const hasPseudoDecor = (el) => {
          if (!hasLayout) return false;
          for (const pseudo of ['::before', '::after']) {
            let ps;
            // 只吞 SyntaxError（jsdom nwsapi 既知行為，同 passHeadingPseudoSpacerReset）
            try { ps = bwin.getComputedStyle(el, pseudo); } catch (e) {
              if (e && e.name === 'SyntaxError') return false;
              throw e;
            }
            if (!ps || !ps.content || ps.content === 'none' || ps.content === 'normal') continue;
            if (ps.content !== '""' && ps.content !== "''") return true; // 引號字元 / url() 圖示
            if (hasOwnBg(ps) || hasVisibleBorder(ps, bgBehind(el))) return true; // 空 content 的色條
          }
          return false;
        };
        const isDecorated = (el) => {
          const cs = bwin.getComputedStyle(el);
          return hasVisibleBorder(cs, bgBehind(el.parentElement)) || hasOwnBg(cs) ||
            (!!cs.boxShadow && cs.boxShadow !== 'none') || hasPseudoDecor(el);
        };
        const isShown = (el) => {
          if (el.closest && el.closest('[data-jread-hidden="1"]')) return false;
          const cs = bwin.getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden';
        };
        const mark = (el, attr) => { el.setAttribute(attr, '1'); quoteMarks.push({ el, attr }); };
        for (const bq of articleEl.querySelectorAll('blockquote')) {
          if (!isShown(bq)) continue;
          const txt = bq.textContent || '';
          if (!txt.trim()) continue; // 純媒體 / 空殼（embed placeholder）不是文字引言
          // --- 斜體：CJK 為主才取消（判定同 markCjkParagraphs 的佔比訊號）---
          const han = (txt.match(CJK_HAN_RE) || []).length;
          const latin = (txt.match(LATIN_LETTER_RE) || []).length;
          if (han >= 4 && han / (han + latin) >= 0.3) {
            const carrier = bq.querySelector('p, div, span') || bq;
            const italicRe = /italic|oblique/;
            if (italicRe.test(bwin.getComputedStyle(bq).fontStyle || '') ||
                italicRe.test(bwin.getComputedStyle(carrier).fontStyle || '')) {
              mark(bq, BQ_UPRIGHT_ATTR);
            }
          }
          // --- 左邊線：自身 / 子 / 包裝父層皆無裝飾才補 ---
          if (isDecorated(bq)) continue;
          if (Array.from(bq.children).some((c) => isShown(c) && isDecorated(c))) continue;
          const par = bq.parentElement;
          if (par && par !== articleEl && articleEl.contains(par)) {
            const shownSibs = Array.from(par.children).filter(isShown);
            const isWrapper = shownSibs.length === 1 || /^(FIGURE|ASIDE)$/i.test(par.tagName);
            if (isWrapper && isDecorated(par)) continue;
          }
          mark(bq, BQ_PLAIN_ATTR);
          // v2.5.53：plain 引言的站方大內距（> 1em）歸零（見 BQ_PAD_TRIM_ATTR 註解）
          const bcs = bwin.getComputedStyle(bq);
          const em = parseFloat(bcs.fontSize) || 16;
          const trim = ((parseFloat(bcs.paddingTop) || 0) > em ? 't' : '') + ((parseFloat(bcs.paddingBottom) || 0) > em ? 'b' : '');
          if (trim) { bq.setAttribute(BQ_PAD_TRIM_ATTR, trim); quoteMarks.push({ el: bq, attr: BQ_PAD_TRIM_ATTR }); }
        }
      };

      const passCjkDecorInlineFlowMarks = () => {
        // v1.6.12：CJK 為主段落標記（須在 TEXT_DIV_ATTR 標記後，才含 div 當段落站）。
        // 翻譯優先（iOS Safari 實機順序）時 text 已是中文、此處即命中；純文字判定、
        // 不依賴 computed style，ARTICLE_ATTR 先後皆可。
        // v1.6.24：移到 byline / kicker 標記之後——排除 guard（closest BYLINE_ATTR /
        // KICKER_ATTR）需要標記已存在，否則中文 byline（「文／某某」）被 justify。
        // 2026-11-15 review B-09：就地 push（不換陣列）——activeMarkState 握同一個
        // 參照，動態補標的元素才進得了 restore 清單
        markCjkParagraphs(articleEl, opts.textJustify, null, cjkJustifyMarked);
        // v2.5.21：右到左頁面譯成中文後改回左到右。基準方向在覆寫之前量
        try {
          document.documentElement.removeAttribute(DIR_LTR_ATTR);
          rtlBase = getComputedStyle(articleEl).direction === 'rtl';
        } catch (_) { rtlBase = false; }
        evalDirOverride(articleEl, rtlBase);

        // v1.6.23：內文裝飾性大寫 / 加寬字距標記。依賴 computed style；byline item
        // 的 text-transform 已由 closest guard 排除（v1.6.24 順序修正後 guard 生效）。
        decorResetMarked = markDecorativeInlines(articleEl);
        // v2.5.30：段首首字行內載體標記（量站方 computed 的 margin / padding）
        leadLetterMarked = markLeadLetterSpans(articleEl);

        // v1.7.8：inline-flow p 標記（v0.7.201 水平 padding reset 豁免）。依賴
        // computed display（站方 CSS 給的 inline / inline-block），與注入 CSS
        // 無時序依賴——注入規則不改 p 的 display。
        inlineFlowPMarked = markInlineFlowParagraphs(articleEl);
      };

      const passAncestorPaddingStrip = () => {
        // v0.7.179：strip excessive padding on ancestors between firstInk and
        // articleEl。CMS hero banner（CNN opinion-header 等）常用 padding:
        // 100px 配合彩色背景做全寬視覺。reader mode strip 背景後 padding 變成
        // 純空白。沿 firstInk 往上走到 articleEl，每層 paddingTop > 48px
        // （reader card 自身 padding 大小）的元素清掉 padding。
        if (firstInk) {
          let cur = firstInk.parentElement;
          const win = articleEl.ownerDocument?.defaultView;
          while (cur && cur !== articleEl && win) {
            const cs = win.getComputedStyle(cur);
            const pt = parseFloat(cs.paddingTop) || 0;
            const pb = parseFloat(cs.paddingBottom) || 0;
            if (pt > 48 || pb > 48) {
              ancestorPaddingSnap.push({
                el: cur,
                pt: cur.style.getPropertyValue('padding-top'),
                ptP: cur.style.getPropertyPriority('padding-top'),
                pb: cur.style.getPropertyValue('padding-bottom'),
                pbP: cur.style.getPropertyPriority('padding-bottom'),
              });
              if (pt > 48) cur.style.setProperty('padding-top', '0', 'important');
              if (pb > 48) cur.style.setProperty('padding-bottom', '0', 'important');
            }
            cur = cur.parentElement;
          }
        }
      };

      const passNegMarginStrip = () => {
        // v0.7.183：strip 大幅負 margin-top（CMS layout hack 的遺毒）。
        // 原站用 margin-top:-80px 類負值把 video block 向上拉進 opinion-
        // header 的 100px padding 區域做視覺重疊。我們 strip padding 後、
        // 負 margin 殘留 → video 溢出遮住 subtitle。通則：reader card
        // 內負 margin-top > 20px 的元素 = layout hack，不適用單欄 card。
        {
          const _w = articleEl.ownerDocument?.defaultView;
          if (_w) {
            for (const el of articleEl.querySelectorAll('div, section')) {
              // 2026-10-07 review B-09：absolute / fixed 錨定元素（markAbsAnchors 已在
              // 本 pass 之前標完）的負 margin 是「top:50% + margin-top:-N」置中慣用寫法
              // 的錨點偏移，不是 layout hack——歸零會讓 play 鈕 / overlay 從中心往右下
              // 偏 N px（真 Chromium 合成 WP Rocket 3.x `.play` 頁實證：dy −36）。與
              // v1.7.45 CSS 端 inset 豁免是同一份事實（absolute 元素的 inset / margin
              // 是錨點），JS pass 這一側補齊。只豁免「reader CSS 下仍 absolute」者：被
              // 媒體規則打回 static 的子樹量到 static 不標、照舊清。
              if (el.getAttribute(ABS_ANCHOR_ATTR) === '1') continue;
              const mt = parseFloat(_w.getComputedStyle(el).marginTop) || 0;
              if (mt < -20) {
                negMarginSnap.push({
                  el,
                  mt: el.style.getPropertyValue('margin-top'),
                  mtP: el.style.getPropertyPriority('margin-top'),
                });
                el.style.setProperty('margin-top', '0', 'important');
              }
            }
          }
        }
      };

      const passFigurePaddingStrip = () => {
        // v1.6.21：strip figure 的「不對稱水平 padding」定位 hack。
        // 症狀（Jimmy cn.nytimes.com 回報）：小直幅照片整塊偏右、左側一大塊空白。
        // 根因 = 站點對 <figure> 設 `padding-left`（= 欄寬 − 照片寬）把小於欄寬的
        // 照片在文字欄內靠右對齊（NYT-cn `figure.article-inline-photo` 實證：
        // padding-left:285px pr:0 → figure 內容區只剩 323px 靠在右緣、img wrapper
        // width:auto 填滿的是那 323px）。reader mode 已把 figure 強制成滿版單欄
        // 媒體容器、其 img wrapper 走 width:auto + margin:auto 置中，但沒清 figure
        // 自身的水平 padding → 內容區被 padding 推偏、置中/填滿都在偏掉的內容區裡算。
        // 結構通則（非站點特判）：single-column reader 內，figure 是「配圖區塊」、
        // 其媒體應對齊閱讀軸；figure 上「兩側不對稱」的水平 padding 只可能是原站用
        // 來把窄媒體推離軸線的定位 hack，清為 0。對稱水平 padding（合法的框內縮 /
        // 帶背景 inset）差值小、不命中，保留。
        {
          const _w = articleEl.ownerDocument?.defaultView;
          if (_w) {
            for (const fig of articleEl.querySelectorAll('figure')) {
              const cs = _w.getComputedStyle(fig);
              const pl = parseFloat(cs.paddingLeft) || 0;
              const pr = parseFloat(cs.paddingRight) || 0;
              if (Math.abs(pl - pr) > 24) {
                figurePaddingSnap.push({
                  el: fig,
                  pl: fig.style.getPropertyValue('padding-left'),
                  plP: fig.style.getPropertyPriority('padding-left'),
                  pr: fig.style.getPropertyValue('padding-right'),
                  prP: fig.style.getPropertyPriority('padding-right'),
                });
                fig.style.setProperty('padding-left', '0', 'important');
                fig.style.setProperty('padding-right', '0', 'important');
              }
            }
          }
        }
      };

      const passZeroHorizInsets = () => {
        // v0.7.246：版心自我檢查（enforce content width）。
        // 症狀（Jimmy roomie.tw/posts/73403 iPhone 回報）：圖片撐滿 reader card
        // 版心，但內文段落（v0.7.246）+ 標題 / 分類列（v0.7.247）左右各窄一截。
        // 根因 = 主文容器與內容之間夾了一層通用 block wrapper 帶水平 padding：
        //   內文：`div.content { padding: 0 20px }`
        //   標題列：`div.mobile-info { padding: 0 24px }`（內含可見標題 + 分類 + 日期；
        //           語意 h1 是 sr-only display:none，可見標題是非 heading 元素）
        // card 已提供唯一應有的閱讀內距、此 wrapper 的額外水平內距把內容壓窄到
        // < 設定版心寬。styler 既有 width:auto / max-width:100% 只擋「超寬」、
        // 擋不掉「被內距夾窄」。
        //
        // 通則（非站點特判）：reader card 是單欄 layout，card padding 是唯一應有
        // 的閱讀內距；card 內任何通用 block wrapper（div / section / article /
        // aside / header / footer / nav）+ 文字 block（p / h1-6）都不該再貢獻水平
        // padding/margin。直接遍歷 card 內這些元素清零水平內距——不依賴「找到某個
        // 段落」（roomie 可見標題不是 heading、隱藏 h1 又空，沿段落鏈走不到標題
        // wrapper，故 v0.7.247 改為全面遍歷）。
        //   - 語意縮排容器（blockquote / 清單 / 表格 / 圖說 / 程式碼 / details）
        //     自身與其後代不動——縮排是刻意的。
        //   - cleaner 清掉的隱藏雜訊（data-jread-hidden）不動。
        //   - 水平 margin：既有規則已對這些元素設 width:auto / max-width:100%，
        //     滿版元素的 auto margin 會算成 0，故 computed 水平 margin 非 0 必是
        //     「顯式非置中 margin」（narrowing / offset），清掉安全。
        // v0.8.123：水平 margin 改用「絕對值 > 0.5」判定——既清正 margin（narrowing
        //   / offset），也清**負 margin**（full-bleed overhang）。theverge.com 實測：
        //   in-body 圖片包在 `div.duet--article--block-placement` 帶 margin-left:-100px，
        //   原站用負 margin 讓圖片向版心左外延伸成 full-bleed；reader 單欄 card 下圖片
        //   被推到內文左側 100px、未與文字欄對齊（Jimmy 2026-06-19 回報「圖片沒置中」）。
        //   既有 `ml > 0.5` 只清正 margin、漏掉負 margin，且 early-return guard 把
        //   `ml<=0.5` 當「無事可做」整支跳過。改 abs 判定後負 margin 一併歸零、圖片
        //   wrapper 退回 column 起點對齊文字。媒體置中（img/picture/video/figure margin:
        //   auto）另由上方規則處理、不在 TARGET_SEL 內，互不干擾。
        // 圖片若是 wrapper 外的 full-bleed 子元素本就滿版，清零後內容與圖片同寬
        // = 符合設定寬度。翻頁模式（multicol）與捲動模式同根因同修法——走「水平
        // 內距和 = 0」不量 card 寬（multicol clientWidth 含全部欄量不準），通用。
        {
          const win = articleEl.ownerDocument?.defaultView;
          if (win) {
            // 語意縮排容器：縮排刻意（引言 / 清單 / 表格 / 圖說 / 程式碼），
            // 自身與後代都不清
            const INDENT_TAGS = new Set(['BLOCKQUOTE', 'UL', 'OL', 'DL', 'MENU', 'LI', 'DD', 'DT',
              'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
              'PRE', 'DETAILS', 'SUMMARY']);
            // 清水平內距對象：通用 block wrapper + 內文文字 block
            const TARGET_SEL = 'div, section, article, main, aside, header, footer, nav, p, h1, h2, h3, h4, h5, h6';
            // v1.6.29 批次化：讀（getComputedStyle）與寫（inline setProperty）分
            // 兩個 pass——舊版逐元素「讀完就寫」，下一個元素的 computed 讀取被前
            // 一個元素的寫入弄髒、每個元素各觸發一次強制 style recalc，大頁面
            // O(n) 次 recalc 是 enter 延遲主要來源之一。先全讀（layout 乾淨、
            // 只 flush 一次）再全寫，判定值全取自「寫入前」的原站 layout。
            const zeroHorizPending = [];
            for (const el of articleEl.querySelectorAll(TARGET_SEL)) {
              // 自身是語意縮排容器 → 不清（保留引言 / 清單 / 表格縮排）
              if (INDENT_TAGS.has(el.tagName)) continue;
              // v1.7.8：inline-flow p 豁免（與 v0.7.201 CSS 規則的 :not 豁免同一份
              // 事實、雙 path 必須同步）——inline / inline-block p 的水平 padding /
              // margin 是相鄰元素分隔用途、不是版心內縮（NYT byline 黏字實證：
              // CSS 規則豁免後 computed padding 恢復 12px，本 pass 若不同步豁免
              // 會在下一步把它寫成 inline 0 !important、黏字復發）。標記見
              // markInlineFlowParagraphs（本 pass 之前已跑）。
              if (el.getAttribute && el.getAttribute(INLINE_FLOW_P_ATTR) === '1') continue;
              // 2026-10-07 review B-09：absolute / fixed 錨定元素的水平 margin 是
              // 「left:50% + margin-left:-N」置中的錨點偏移，不是版心內縮——與上方
              // passNegMarginStrip 同一條豁免（註解見該處）。
              if (el.getAttribute && el.getAttribute(ABS_ANCHOR_ATTR) === '1') continue;
              // cleaner 清掉的隱藏雜訊不動
              if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
              // 在語意縮排脈絡內 → 縮排刻意，跳過
              let a = el.parentElement, insideIndent = false;
              while (a && a !== articleEl) {
                if (INDENT_TAGS.has(a.tagName)) { insideIndent = true; break; }
                a = a.parentElement;
              }
              if (insideIndent) continue;
              // v2.5.9：ARIA 排的 div 表格（role=row 的列、格子與格子內容）比照
              // TABLE / TR / TD——格子的水平內距是欄間距，清掉兩格文字就黏在一起
              if (inAriaTableRow(el, articleEl)) continue;
              const cs = win.getComputedStyle(el);
              // v3.7.7：inline 層級（inline-block / inline-flex…）的水平 margin / padding 是相鄰元素的
              // 間隔、不是版心內縮——與上面 v1.7.8 inline 段落同理。thewoksoflife 食譜時間列三格
              // `div.wprm-recipe-block-container-inline { display: inline-block; margin-right: 1.2em }`
              // 之間沒有空白，margin 清掉就黏成「35 minsCook: 15 minsTotal: 50 mins」
              // 只認「跟旁邊並排」的：不是標題（站方 inline 標題之後會被 JRead 改成 block，wikihow
              // 430 寬 inline-block h2 的左右 17px 是框的內距）、而且有看得到的 inline 層級兄弟
              if (/^inline/.test(cs.display || '') && !/^H[1-6]$/.test(el.tagName) && hasInlineSibling(win, el)) continue;
              const pl = parseFloat(cs.paddingLeft) || 0;
              const pr = parseFloat(cs.paddingRight) || 0;
              const ml = parseFloat(cs.marginLeft) || 0;
              const mr = parseFloat(cs.marginRight) || 0;
              if (pl <= 0.5 && pr <= 0.5 && Math.abs(ml) <= 0.5 && Math.abs(mr) <= 0.5) continue;
              // v3.7.7：絕對定位的 pseudo 圖示畫在內距裡（vuejs 提示框 `.custom-block::before
              // { content: "ⓘ"; position: absolute; left: 17px }`）——那側內距是圖示的跑道，清掉
              // 文字就跟圖示疊在一起。那側內距保留（只看有內距要清的元素，才讀 pseudo）
              if (pl > 0.5 || pr > 0.5) {
                const lane = pseudoIconLane(win, el, pl, pr);
                if (lane.left || lane.right) {
                  zeroHorizPending.push({ el, pl: lane.left ? 0 : pl, pr: lane.right ? 0 : pr, ml, mr });
                  continue;
                }
              }
              zeroHorizPending.push({ el, pl, pr, ml, mr });
            }
            for (const { el, pl, pr, ml, mr } of zeroHorizPending) {
              contentWidthSnap.push({
                el,
                pl: el.style.getPropertyValue('padding-left'), plP: el.style.getPropertyPriority('padding-left'),
                pr: el.style.getPropertyValue('padding-right'), prP: el.style.getPropertyPriority('padding-right'),
                ml: el.style.getPropertyValue('margin-left'), mlP: el.style.getPropertyPriority('margin-left'),
                mr: el.style.getPropertyValue('margin-right'), mrP: el.style.getPropertyPriority('margin-right'),
              });
              if (pl > 0.5) el.style.setProperty('padding-left', '0', 'important');
              if (pr > 0.5) el.style.setProperty('padding-right', '0', 'important');
              if (Math.abs(ml) > 0.5) el.style.setProperty('margin-left', '0', 'important');
              if (Math.abs(mr) > 0.5) el.style.setProperty('margin-right', '0', 'important');
            }

            // v1.7.16：full-bleed「translateX(-50%) 置中對」殘留 reset。
            // 症狀（Netflix Tudum，Jimmy 2026-07-24 截圖）：主文 inline 圖左移
            // 半個圖寬（wrapper computed transform: matrix(1,0,0,1,-304,0)）、
            // 掛出 card 左緣被裁。根因：站方 full-bleed 置中 idiom 是成對的
            // 「+50% 定位（grid 佈局 / left:50% / margin-left:50%）↔ stylesheet
            // transform: translateX(-50%)」；reader 的 grid 塌平（cleaner
            // collapseInnerGridFlex）/ 寬度正規化把 + 半邊拆掉、-50% translate
            // 殘留 → 元素平移出框。margin 變體已由上方 zeroHoriz abs 判定清
            // （v0.8.123 theverge 負 margin full-bleed），transform 變體這裡補。
            // 結構訊號（不綁站點 / class，硬規則 3）：
            //   - computed transform 是純水平位移（matrix 其餘分量 identity）、
            //     |tx| > 8px（有意義的位移）
            //   - 目前 rect 水平掛出 parent 內容框（左緣或右緣超出 > 8px）
            //   - 位移歸零後恰好回到框內（±4px）→ 判定為被拆散的置中對
            // carousel 滑軌不誤傷：軌寬 > parent、歸零後仍出框右緣 → fits 不
            // 成立。合法裝飾性小位移（|tx| <= 8 或未出框）不碰。跑在 zeroHoriz
            // 寫入之後——量的是 reader 最終 layout 的出框狀態。
            {
              const parseTx = (t) => {
                if (!t || t === 'none') return null;
                let m = /^matrix\(1,\s*0,\s*0,\s*1,\s*(-?[\d.]+),\s*0\)$/.exec(t);
                if (m) return parseFloat(m[1]);
                // jsdom computed 不解析成 matrix，退回 specified 語法
                m = /^translateX\((-?[\d.]+)px\)$/i.exec(t);
                if (m) return parseFloat(m[1]);
                m = /^translate\((-?[\d.]+)px(?:\s*,\s*0(?:px)?)?\)$/i.exec(t);
                if (m) return parseFloat(m[1]);
                return null;
              };
              const translatePending = [];
              for (const el of articleEl.querySelectorAll('div, section, figure, picture, img')) {
                if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
                const cs = win.getComputedStyle(el);
                const tx = parseTx(cs.transform);
                if (tx === null || Math.abs(tx) <= 8) continue;
                const parent = el.parentElement;
                if (!parent) continue;
                let r, pr2;
                try { r = el.getBoundingClientRect(); pr2 = parent.getBoundingClientRect(); } catch (_) { continue; }
                if (!r || !pr2 || r.width < 1 || pr2.width < 1) continue;
                const overflows = r.left < pr2.left - 8 || r.right > pr2.right + 8;
                if (!overflows) continue;
                const fits = (r.left - tx) >= pr2.left - 4 && (r.right - tx) <= pr2.right + 4;
                if (!fits) continue;
                translatePending.push(el);
              }
              for (const el of translatePending) {
                translateResetSnap.push({
                  el,
                  tf: el.style.getPropertyValue('transform'),
                  tfP: el.style.getPropertyPriority('transform')
                });
                el.style.setProperty('transform', 'none', 'important');
              }
            }
          }
        }
      };

      const passCaptionFontFloor = () => {
        // v0.8.123：圖說字級下限（caption font-size floor）。
        // v0.7.120 刻意把 figcaption 排除在 BODY_TEXT_SEL 外、保留原站 caption
        // typography（caption 普遍比 body 小一階是合理的階層差異化）。但部分站把
        // caption 設得過小（theverge.com 實測 figcaption 11px 配 ~18px 內文 →
        // 太小難讀，Jimmy 2026-06-19 回報「圖說閱讀困難」）。修法不回到「caption =
        // body」（會抹平階層、撞 v0.7.120 已知問題），改設**下限**：只把小於 floor
        // 的 caption 撐到 floor，已 >= floor 的 caption 維持原站字級不動（不縮大字、
        // 不抹平正常 caption 階層）。floor = max(14px, round(body * 0.78))——隨使用者
        // 字級縮放（body 大時 caption floor 同步變大）、且 14px 絕對下限保底；0.78
        // 係數讓 caption 仍明顯小於 body、保留階層。opts.fontSize 為 0（Auto sentinel、
        // 保留原站 body 字級）時用 18 當 body 估計值。inline !important 蓋站點 caption
        // class rule。snapshot 對稱還原（與 titleFsSnap 同款）。
        {
          const _w = articleEl.ownerDocument?.defaultView;
          if (_w) {
            // v2.5.24：所有圖說統一字級（Jimmy 2026-11-19 裁定「所有站圖說一律置中縮小」）。
            // 原本只有下限（小於 floor 才撐），現在一律寫成 max(下限, 內文 × 0.8)：
            // 太小的撐上來、跟內文一樣大或更大的縮下去。置中 / 字體 / 顏色在 buildCss 的
            // captionDefaultCss。內文字級：使用者有設就用設定值；Auto（0，保留原站字級）
            // 時取主文裡最常見的長段落字級，量不到用 18。
            // 這條驗 X、不驗 Y：認 <figcaption> 與 div 圖說（CAP_DIV_ATTR，v2.5.36）；p / span 當圖說的站不處理
            let bodyFs = opts.fontSize || 0;
            if (!bodyFs) {
              const tally = new Map();
              let seen = 0;
              for (const p of articleEl.querySelectorAll('p')) {
                if ((p.textContent || '').trim().length < 120) continue;
                if (p.closest('figcaption, blockquote, li, table, [data-jread-hidden="1"]')) continue;
                const f = Math.round(parseFloat(_w.getComputedStyle(p).fontSize) || 0);
                if (f > 0) tally.set(f, (tally.get(f) || 0) + 1);
                if (++seen >= 30) break;
              }
              let best = 0;
              for (const [f, n] of tally) if (n > best) { best = n; bodyFs = f; }
              if (!bodyFs) bodyFs = 18;
            }
            const capFloor = Math.max(14, Math.round(bodyFs * 0.78));
            const capFs = Math.max(capFloor, Math.round(bodyFs * 0.8));
            lateCapFs = capFs;
            // v1.6.29 批次化：先全讀 computed font-size 再全寫（同 zeroHoriz，
            // 避免逐元素讀寫交錯的 O(n) 強制 recalc）
            const capPending = [];
            // v2.5.36：div 圖說（CAP_DIV_ATTR）比照
            for (const fc of articleEl.querySelectorAll(`figcaption, [${CAP_DIV_ATTR}]`)) {
              if (fc.closest('[data-jread-hidden="1"]')) continue;
              // 一律寫（不比對現值）：樣式表的 0.8em 後備是相對父層，算出值剛好等於目標
              // 不代表父層字級之後不變
              capPending.push(fc);
            }
            for (const fc of capPending) {
              captionFsSnap.push({
                el: fc,
                fs: fc.style.getPropertyValue('font-size'),
                fsP: fc.style.getPropertyPriority('font-size'),
              });
              fc.style.setProperty('font-size', capFs + 'px', 'important');
            }
          }
        }
      };

      const passCaptionAlignReset = () => {
        // v1.7.19：圖說「credit 靠尾端」對齊 reset。
        // 症狀（archive.ph WSJ 存檔頁，Jimmy 2026-07-27 截圖）：hero figcaption
        // 帶站方 text-align:right（WSJ credit 靠右下慣例、archive.today 再 inline
        // 化成 element style），reader 窄版心下 caption + credit 連排折成兩行 →
        // 非末行填滿整寬、末行孤懸右緣，讀起來像斷版。原站語境「寬 hero 右下角
        // 一小行 credit」在 reader 單欄不存在，靠尾端對齊失去意義。
        // 通則（硬規則 3，語意標籤 + computed 值判定，非站點 / class 特判）：
        // reader scope 內 figcaption 的 computed text-align 是「文向尾端」——
        // ltr 的 right / rtl 的 left / 兩者的 end——→ inline text-align:start
        // !important 打回自然流向（inline !important 蓋 archive.today inline 化
        // 的站方值）。center 是排版意圖、自然流向（ltr left / rtl right / start）
        // 本來就對，皆不碰。與 v1.5.15 / v1.6.20 figcaption 正規化家族同哲學：
        // 圖說回到 normal flow 的自然排版。
        {
          const _w2 = articleEl.ownerDocument?.defaultView;
          if (_w2) {
            const alignPending = [];
            for (const fc of articleEl.querySelectorAll('figcaption')) {
              if (fc.closest('[data-jread-hidden="1"]')) continue;
              const cs2 = _w2.getComputedStyle(fc);
              const ta = cs2.textAlign;
              const rtl = cs2.direction === 'rtl';
              const tailAligned = ta === 'end' || (rtl
                ? (ta === 'left' || ta === '-webkit-left')
                : (ta === 'right' || ta === '-webkit-right'));
              if (tailAligned) alignPending.push(fc);
            }
            for (const fc of alignPending) {
              captionAlignSnap.push({
                el: fc,
                ta: fc.style.getPropertyValue('text-align'),
                taP: fc.style.getPropertyPriority('text-align'),
              });
              // v2.5.24：圖說一律置中（buildCss captionDefaultCss）。這裡仍要寫 inline——
              // 站方 inline !important 的靠尾端對齊，樣式表的 center 蓋不過
              fc.style.setProperty('text-align', 'center', 'important');
            }
          }
        }
      };

      const passTitleFontOverride = () => {
        // v0.7.180：title font-size inline override。CMS 高 specificity rule
        // 常用 5+ class selector + !important 鎖死 h1 font-size（MSNBC/ms.now
        // `.opinion-header > .wp-block-group .title-and-dek-column
        //  h1.wp-block-post-title[class*=...] { font-size: 2rem !important }`
        // specificity (0,5+,1) 打敗 jread stylesheet (0,1,1)），CSS stylesheet
        // 打不贏。inline !important 是最高優先級。
        // 獨立搜尋第一個可見 h1（不依賴 firstInk 是否 H tag）：firstInk 可能是
        // P（副標題/byline 在 DOM order 比 H1 早出現時），title override 不該
        // 因此 miss。
        if (overrides.titleFontSize) {
          const titleH1 = firstInk && /^H1$/.test(firstInk.tagName)
            ? firstInk
            : firstVisibleH1(articleEl);
          if (titleH1) {
            titleFsSnap = {
              el: titleH1,
              fs: titleH1.style.getPropertyValue('font-size'),
              fsP: titleH1.style.getPropertyPriority('font-size'),
            };
            titleH1.style.setProperty('font-size', opts.titleFontSize + 'px', 'important');
          }
        }
      };

      const passHeroTitleFloor = () => {
        // v0.8.3：hero 標題字級下限（Jimmy 2026-06-09 規則）。Auto 模式
        // （titleFontSize=0、不強制覆寫）下，原站把標題做得太小（roomie.tw
        // mobile span.title 23px、近內文 18px，視覺上不像標題）時，把 hero
        // 拉到至少 1.5× 內文字級。只在低於下限時 bump（max 語意），原站 hero
        // 夠大就不動。hero = detector inject 的 H1（[data-jread-injected-title]）
        // 優先，否則第一個可見 h1。override 模式由上方 titleFsSnap 精準覆寫、
        // 不走這條（exact size 已贏）。
        if (!overrides.titleFontSize) {
          const floorPx = Math.round((opts.fontSize || DEFAULTS.fontSize) * 1.5);
          const heroEl = articleEl.querySelector('[data-jread-injected-title="1"]')
            || (firstInk && /^H1$/.test(firstInk.tagName)
              ? firstInk
              : firstVisibleH1(articleEl));
          if (heroEl && floorPx > 0) {
            const win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
            const cur = win ? (parseFloat(win.getComputedStyle(heroEl).fontSize) || 0) : 0;
            if (cur < floorPx) {
              heroFloorSnap = {
                el: heroEl,
                fs: heroEl.style.getPropertyValue('font-size'),
                fsP: heroEl.style.getPropertyPriority('font-size'),
              };
              heroEl.style.setProperty('font-size', floorPx + 'px', 'important');
            }
          }
        }
      };

      const passPseudoHeadingSize = () => {
        // v2.5.40：見 passMarkPseudoHeadings。注入樣式後字級掉到原本的八成以下＝被 JRead
        // 的內文字級規則壓小了，才改；站方字級沒被動到（div 不在內文選擇器裡）就不碰。
        // 尺寸跟著使用者設定走、不沿用站方的展示字級（pudding 標題 198px）：
        //   - 標題：頁面沒有任何可見標題（h1 / JRead 標題節點），第一個 pseudo heading 排在
        //     第一段長內文之前、站方字級 >= 內文 2 倍 → 標題字級（設定值；Auto 時內文 1.5 倍，
        //     與 passHeroTitleFloor 同一把尺）
        //   - 其餘：內文 1.3 倍、粗體
        if (!pseudoHeadings.length) return;
        const win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
        if (!win) return;
        const bodyFs = opts.fontSize > 0 ? opts.fontSize : pseudoBodyFs;
        if (!bodyFs) return;
        const hasTitle = !!(articleEl.querySelector('[data-jread-injected-title="1"], [data-jread-title-clone="1"]')
          || firstVisibleH1(articleEl)
          || articleEl.ownerDocument.querySelector('[data-jread-promoted-outside="1"]'));
        let firstLongP = null;
        for (const p of articleEl.querySelectorAll('p')) {
          if (!isVisiblyShown(p, articleEl)) continue;
          if ((p.textContent || '').trim().length >= 80) { firstLongP = p; break; }
        }
        const pending = [];
        pseudoHeadings.forEach(({ el, fs }, i) => {
          if (!el.isConnected || !isVisiblyShown(el, articleEl)) return;
          const cur = parseFloat(win.getComputedStyle(el).fontSize) || 0;
          if (cur >= fs * 0.8) return;
          const isTitle = i === 0 && !hasTitle && fs >= pseudoBodyFs * 2 &&
            (!firstLongP || !!(el.compareDocumentPosition(firstLongP) & Node.DOCUMENT_POSITION_FOLLOWING));
          const size = isTitle
            ? (opts.titleFontSize > 0 ? opts.titleFontSize : Math.round(bodyFs * 1.5))
            : Math.round(bodyFs * 1.3);
          pending.push({ el, size });
        });
        for (const { el, size } of pending) {
          for (const [prop, val] of [['font-size', size + 'px'], ['font-weight', '700'], ['line-height', '1.3']]) {
            if (prop === 'line-height' && opts.lineHeight === 0) continue;
            titleLineSnap.push({ el, prop, v: el.style.getPropertyValue(prop), p: el.style.getPropertyPriority(prop) });
            el.style.setProperty(prop, val, 'important');
          }
        }
      };

      const passSubheadingBelowTitle = () => {
        // v2.5.40：內文小標不可大過（或等於）標題。Trigger：netflix tudum 的 h3 36px 比
        // h1 32px 大（語料庫 KNOWN-ISSUES）——標題被標題字級設定定成 32px，內文小標留站方
        // 字級。普查（語料庫 180 頁）：小標大過標題 5 站（netflix 36、grubstreet 40、twz 36、
        // engadget / theverge 34），與標題一樣大 7 站（bbc、MDN、github.blog、jestjs、
        // kubernetes、myartbroker、sspai 的 h2 都是 32）——一樣大也看不出階層，一起處理。
        // 通則：主文內可見的 h2–h6，字級 >= 標題最終字級 → 壓到標題 0.75 倍（與摘要同一個
        // 比例，見 passTitleOwnLineAndDek）。標題 = JRead 標題節點或第一個可見 h1；頁面沒有
        // 標題時不動。比標題小的小標維持站方字級。
        // 排在 passTitleOwnLineAndDek 之後：標題緊接的摘要（dek，常是 h2）由那條處理（壓字級＋
        // 轉 block＋行高按比例縮），這裡先壓了字級那條就認不出摘要
        const win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
        if (!win) return;
        const titleEl = articleEl.querySelector('[data-jread-injected-title="1"], [data-jread-title-clone="1"]')
          || firstVisibleH1(articleEl)
          || articleEl.ownerDocument.querySelector('[data-jread-promoted-outside="1"] h1, h1[data-jread-promoted-outside="1"]');
        if (!titleEl) return;
        // 標題字級：有設定值就用設定值（標題最終就是這個大小；量 computed 會量到還沒套上
        // 覆寫的節點——danluu 注入的標題量到 17px，小標被壓成 13px，語料庫 check 抓到）。
        // Auto 時量 computed，且必須大過內文，否則不動
        const measured = parseFloat(win.getComputedStyle(titleEl).fontSize) || 0;
        const titleFs = opts.titleFontSize > 0 ? opts.titleFontSize : measured;
        if (!titleFs) return;
        const bodyFs = opts.fontSize > 0 ? opts.fontSize : 0;
        if (bodyFs && titleFs <= bodyFs) return;
        const cap = Math.round(titleFs * 0.75);
        const pending = [];
        for (const h of articleEl.querySelectorAll('h2, h3, h4, h5, h6')) {
          if (h === titleEl || h.contains(titleEl) || titleEl.contains(h)) continue;
          if (!isVisiblyShown(h, articleEl) || !(h.textContent || '').trim()) continue;
          const fs = parseFloat(win.getComputedStyle(h).fontSize) || 0;
          if (fs >= titleFs) pending.push(h);
        }
        for (const h of pending) {
          titleLineSnap.push({ el: h, prop: 'font-size', v: h.style.getPropertyValue('font-size'), p: h.style.getPropertyPriority('font-size') });
          h.style.setProperty('font-size', cap + 'px', 'important');
        }
      };

      const passReattachDetachedCaptions = () => {
        // v2.5.34：脫離型圖說搬回照片下方（見 findDetachedCaptions）。排在 markCaptionMedia
        //（passMarkEmbedHeadingAbsAnchors）之前：搬過去的圖說也要吃到「圖說貼近圖片」規則
        for (const { fc, fig } of findDetachedCaptions(articleEl)) {
          capReattachSnap.push({ fc, parent: fc.parentNode, next: fc.nextSibling });
          fig.appendChild(fc);
        }
      };

      const passTitleOwnLineAndDek = () => {
        // v2.2.7：標題獨佔一行＋緊接的摘要（dek）不可大過標題。
        // 根因（grubstreet chocolate-conspiracy 實證，Jimmy 2026-10-28）：站方
        // 頁首的 h1 與摘要 h2 都是 display:inline（原站 h1 55px 寬到把摘要擠到
        // 下一行，靠字寬「碰巧」分行），摘要 49px。reader 下標題被上兩條 pass
        // 定成 32px（設定預設）→ 摘要 49px 反而比標題大、兩者併進同一行。
        // 通則（結構訊號，不綁站點 / class）：
        //   1) reader 標題 computed display 為 inline* → display:block（標題的
        //      語意就是獨立一行；inline 只在原站版寬下碰巧成立）
        //   2) 標題之後連續的兄弟（最多 3 個，遇含媒體者停）字級大於標題最終
        //      字級 → 壓到標題 0.75 倍；站方 px 行高按同比例縮（否則字小行距
        //      巨大），text-align 跟標題一致（不再一個靠左一個置中）；inline
        //      的 dek 同樣轉 block（否則對齊由父層 line box 決定）
        // 收斂：只看標題的「同層後續兄弟」，不碰正文裡的 h2（正文 h2 比標題大
        // 是另一回事，且通常跟標題不同層）。
        const titleEl = articleEl.querySelector('[data-jread-injected-title="1"]')
          || (firstInk && /^H1$/.test(firstInk.tagName) ? firstInk : firstVisibleH1(articleEl));
        const win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
        if (!titleEl || !win) return;
        // 2026-11-15 review B-04：display 走分層登記簿（owner 'styler:title-line'）——
        // 編輯模式點掉標題 / dek 後退出，cleaner 那層記到的原值才不會是這裡寫的
        // block !important。其他屬性（font-size / line-height / text-align）沒有別的
        // 模組會寫，維持自帶快照
        const setSnap = (el, prop, val) => {
          titleLineSnap.push({
            el, prop,
            v: el.style.getPropertyValue(prop),
            p: el.style.getPropertyPriority(prop),
          });
          if (prop === 'display') setInlineOwned(el, prop, val, 'important', 'styler:title-line');
          else el.style.setProperty(prop, val, 'important');
        };
        const tcs = win.getComputedStyle(titleEl);
        if (/^inline/.test(tcs.display)) setSnap(titleEl, 'display', 'block');
        const titleFs = parseFloat(tcs.fontSize) || 0;
        if (!titleFs) return;
        const titleAlign = tcs.textAlign;
        // 2026-11-15 review B-08：dek 身分 guard。「字級大於標題」在 Auto 標題模式
        // 等同「大於內文」（passHeroTitleFloor 保證標題 >= 1.5 倍內文），但覆寫模式
        // 下標題可以比內文小（popup 範圍：內文到 32、標題低到 16）——內文 24＋
        // 標題 20、標題後直接接 <p> 的版型，開頭三段會被當 dek 壓成 15px、第四段
        // 回到 24px（合成頁 probe 兩引擎實證）。通則：dek 是「比內文大的展示字」，
        // 兄弟字級必須同時大於內文主流字級才算；遇到內文字級的兄弟就停（後面
        // 都是正文）。內文字級：有覆寫用設定值，Auto（0）量主文前 12 個 <p> 的
        // 眾數（懶算——沒有候選就不量）。
        let bodyFsMemo = null;
        const bodyFontSize = () => {
          if (bodyFsMemo !== null) return bodyFsMemo;
          if (opts.fontSize > 0) return (bodyFsMemo = opts.fontSize);
          const tally = new Map();
          let seen = 0;
          for (const p of articleEl.querySelectorAll('p')) {
            if (seen >= 12) break;
            if (!(p.textContent || '').trim() || p.closest('[data-jread-hidden="1"]')) continue;
            seen++;
            const f = parseFloat(win.getComputedStyle(p).fontSize) || 0;
            if (f) tally.set(f, (tally.get(f) || 0) + 1);
          }
          let best = 0, bestN = 0;
          for (const [f, n] of tally) if (n > bestN) { best = f; bestN = n; }
          return (bodyFsMemo = best);
        };
        const isBodySizedOrSmaller = (fs) => { const b = bodyFontSize(); return b > 0 && fs <= b; };
        // 先全讀再全寫（同 passCaptionFontFloor，避免讀寫交錯強制 recalc）
        const pending = [];
        let sib = titleEl.nextElementSibling;
        for (let n = 0; sib && n < 3; n++, sib = sib.nextElementSibling) {
          if (sib.querySelector('img, picture, video, figure, iframe')) break;
          if (sib.closest('[data-jread-hidden="1"]')) continue;
          const scs = win.getComputedStyle(sib);
          const fs = parseFloat(scs.fontSize) || 0;
          if (fs <= titleFs) continue;
          // 2026-11-15 review B-08：字級沒有大過內文＝這是內文不是 dek，到此為止
          if (isBodySizedOrSmaller(fs)) break;
          pending.push({ el: sib, fs, lh: scs.lineHeight, ta: scs.textAlign, disp: scs.display });
        }
        for (const it of pending) {
          const newFs = Math.round(titleFs * 0.75);
          setSnap(it.el, 'font-size', newFs + 'px');
          if (/px$/.test(it.lh)) {
            // 站方 display 字的行高常貼近 1.0（大字才好看），縮成內文級字級後
            // 太擠 → 下限 1.25 倍字級
            const scaled = parseFloat(it.lh) * newFs / it.fs;
            setSnap(it.el, 'line-height', Math.max(scaled, newFs * 1.25).toFixed(1) + 'px');
          }
          // inline 的 dek 對齊吃父層 line box（text-align 設在自己身上無效）→
          // 同標題一起轉 block 才對得齊
          if (/^inline/.test(it.disp)) setSnap(it.el, 'display', 'block');
          if (it.ta !== titleAlign) setSnap(it.el, 'text-align', titleAlign);
        }
      };

      const passHeadingLineHeightFloor = () => {
        // v2.5.24：內文小標行高下限。站方的展示字小標常把行高鎖在字級的 1.0 倍
        //（netflix tudum 的 h3：36px 字、36px 行高，配站方的窄體展示字型才好看）。
        // 閱讀模式換成設定的字體後字面變高，兩行以上的小標上下行貼在一起；譯成
        // 中文後更明顯（CJK 字佔滿整個字框，1.0 倍行高＝行與行之間沒有空隙）。
        // 通則：h2–h6 的 computed 行高 < 字級 1.15 倍 → 行高改成 1.25（unitless，
        // 跟著字級走）。h1 由標題字級覆寫那條帶 1.3，不在這裡。
        // 使用者選「行距 Auto」（保留原站行距）時整條跳過，與內文、標題同一個取捨。
        // 還原共用 titleLineSnap（同形 {el, prop, v, p}）。
        // 訊號層次：驗「行高比 → 寫入」；不驗換字體後實際墨跡有沒有相碰（截圖）。
        if (opts.lineHeight === 0) return;
        const win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
        if (!win) return;
        const pending = [];
        for (const h of articleEl.querySelectorAll('h2, h3, h4, h5, h6')) {
          if (h.closest('[data-jread-hidden="1"]')) continue;
          if (!(h.textContent || '').trim()) continue;
          const cs = win.getComputedStyle(h);
          const fs = parseFloat(cs.fontSize) || 0;
          const lh = parseFloat(cs.lineHeight);
          if (!fs || !isFinite(lh)) continue; // 'normal' 由字型自己決定，不會貼行
          if (lh >= fs * 1.15) continue;
          pending.push(h);
        }
        for (const h of pending) {
          titleLineSnap.push({
            el: h, prop: 'line-height',
            v: h.style.getPropertyValue('line-height'),
            p: h.style.getPropertyPriority('line-height'),
          });
          h.style.setProperty('line-height', '1.25', 'important');
        }
      };

      const passGalleryFlex = () => {
        // v0.7.93：substack 類 image gallery 修法——含直接 picture/img/figure 子的
        // flex/grid 容器強制改成 block display + height auto，讓並列圖在 reader mode
        // 下垂直堆疊、不再被父容器固定 height 切掉內容 + 不再 overflow 蓋下方文字。
        // 案例（synapseching.substack.com /p/17 Jimmy 2026-05-13 回報）：
        //   IMG → PICTURE → DIV.imageRow（display:flex, height:230px）→ ...
        //   imageRow flex 子 align-items:stretch 把 picture 拉到 230，但 styler
        //   `img { height:auto !important }` 讓 IMG 跑 natural ratio = 295，
        //   IMG 超出 picture 65px → 視覺覆蓋下方段落文字。
        //   單純 height:auto 又會讓 flex container 內並列圖各取 max-width:100% 加總
        //   溢出 article 右側（第二張 img.left=952 > article.right=944）。
        //   結論：reader card 單欄閱讀情境下 flex/grid 並列 layout 無保留必要，
        //   直接 display:block 讓兩張圖垂直堆疊最穩。
        // 通則 selector：祖先到 articleEl 為止，掃所有 display:flex / display:grid 且
        // 直接子含 picture / img / figure 的元素，runtime 設 inline !important
        // 蓋過原站 stylesheet。CSS :has() jsdom 不支持，改 runtime 解決。
        // v0.7.144：原 code 對主文每個後代跑 getComputedStyle 找 flex/grid + 含
        // picture/img/figure 直接子的 wrapper。大頁面 + 多次設定變更時負荷重。
        // 改為先 querySelectorAll('picture, img, figure') 收媒體節點 → 各自往上
        // walk parent 鏈到 articleEl 為止收集祖先 Set → 對 Set 內元素才跑
        // getComputedStyle。從 O(全 DOM) → O(媒體節點 × 平均深度)；純文字主文
        // 直接 short-circuit 0 次 getComputedStyle。
        mediaAncestors = new Set();
        const mediaNodes = articleEl.querySelectorAll('picture, img, figure');
        for (const media of mediaNodes) {
          let cur = media.parentElement;
          while (cur && cur !== articleEl) {
            mediaAncestors.add(cur);
            cur = cur.parentElement;
          }
        }
        // v1.6.29 批次化：先全讀（computed display + 直接子媒體判定）再全寫——
        // 舊版逐元素讀寫交錯，每個 gallery 容器各觸發一次強制 recalc
        const galleryPending = [];
        for (const el of mediaAncestors) {
          // v0.8.45：排除 player 結構（與 v0.7.182 background strip 同原則）。
          // ms.now 實測：JW Player 的 jw-wrapper（含 poster img、computed flex）
          // 被本規則打成 display:block + height:auto → 容器塌成 16px → JW JS
          // 對 video 寫負 margin 置中於塌掉的容器 → video absolute 突出 342px
          // 蓋住 dek 文字 + 流空間錯位出 245px 假空白（gap audit y=206 實證）。
          // player 內部 layout 由 player JS 自己管理，jread 不該動。
          if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
          // v1.0.8：byline 區自管 flex 一行 layout（見 BYLINE_ATTR），不被 gallery
          // flatten 成 block——否則 inline display:block !important 蓋掉 byline flex
          if (el.closest && el.closest(`[${BYLINE_ATTR}="1"]`)) continue;
          const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
          if (!cs) continue;
          // 2026-11-15 review B-03：「要不要塌」問 NS.flexShellVerdict（與 cleaner /
          // paged-mode 同一張判定表）；這裡蒐集的事實是 directMedia
          if (!NS.FLEX_SHELL_DISPLAYS.has(cs.display)) continue;
          let hasMediaChild = false;
          for (const c of el.children) {
            if (c.tagName === 'PICTURE' || c.tagName === 'IMG' || c.tagName === 'FIGURE') {
              hasMediaChild = true;
              break;
            }
            // v2.2.9：「連結 / span 只包一張圖」等同直接子圖片（grubstreet 翻頁模式
            // 實證，Jimmy 2026-10-28）——flex 容器 > <a> > <img>，翻頁把圖縮到
            // 放得進一頁（406px < 欄寬 608）後，flex 預設 flex-start 讓整組靠左；
            // 舊判定只認直接子媒體、包一層 <a> 就 miss。包裝層須只有那一張媒體、
            // 沒有自己的文字（有文字＝卡片連結，不是媒體包裝）；inline emoji /
            // icon 圖不算（一排社群 icon 連結不該被攤成直排）
            const only = c.children.length === 1 ? c.firstElementChild : null;
            if ((c.tagName === 'A' || c.tagName === 'SPAN') && only &&
                (only.tagName === 'PICTURE' ||
                  (only.tagName === 'IMG' && !only.hasAttribute(INLINE_IMG_ATTR) && !only.hasAttribute(ICON_IMG_ATTR))) &&
                !(c.textContent || '').trim()) {
              hasMediaChild = true;
              break;
            }
          }
          if (!NS.flexShellVerdict({ display: cs.display, directMedia: hasMediaChild }).collapse) continue;
          galleryPending.push(el);
        }
        for (const el of galleryPending) {
          // snapshot 原 inline value/priority for restore
          const prior = {
            el,
            display: el.style.getPropertyValue('display'),
            displayPriority: el.style.getPropertyPriority('display'),
            height: el.style.getPropertyValue('height'),
            heightPriority: el.style.getPropertyPriority('height'),
            minHeight: el.style.getPropertyValue('min-height'),
            minHeightPriority: el.style.getPropertyPriority('min-height')
          };
          galleryFlex.push(prior);
          setInlineOwned(el, 'display', 'block', 'important', 'styler:gallery');
          el.style.setProperty('height', 'auto', 'important');
          el.style.setProperty('min-height', '0', 'important');

          // v0.7.94：gallery flex 改 block 後原 flex gap 失效，直接子（figure /
          // picture / img / a / div）會緊貼。逐個媒體子設 margin-bottom: 12px
          // !important 補空白。snapshot 紀錄原 inline margin-bottom 以便 restore。
          // Jimmy 2026-05-13 回報 v0.7.93 修完三張並列照片改垂直後緊貼無間距。
          const mediaTags = new Set(['FIGURE', 'PICTURE', 'IMG', 'A', 'DIV']);
          for (const child of el.children) {
            if (!mediaTags.has(child.tagName)) continue;
            // v1.7.29：inline emoji / icon 跳過 gap 補償——inline 圖的 margin-bottom
            // 不產生流間距，只把圖沿 baseline 往上抬（錯位）。與上方 gallery 偵測
            // guard 同一判定基礎（皆以 INLINE_IMG_ATTR 為準）但獨立兜底：真 gallery
            // （另有大圖子）仍會攤平，此處確保混在其中的 icon 不被塞 margin
            if (child.tagName === 'IMG' &&
                (child.hasAttribute(INLINE_IMG_ATTR) || child.hasAttribute(ICON_IMG_ATTR))) continue;
            // 排除「不含媒體」的 div（gallery wrapper 內偶爾混 spacer / caption），
            // 只對「自身含 img/picture/figure 子孫」的 element 加 margin。
            const hasMediaDescendant = child.tagName === 'IMG' || child.tagName === 'PICTURE' || child.tagName === 'FIGURE' ||
              !!(child.querySelector && child.querySelector('img, picture, figure'));
            if (!hasMediaDescendant) continue;
            // v2.5.23：緊接圖說的那張圖不補 12px——它與圖說的距離由 CAP_MEDIA 規則管
            //（inline !important 會蓋過樣式表，chinatalk 實測圖說上方多 12px）
            if (child.hasAttribute(CAP_MEDIA_ATTR)) continue;
            const priorChild = {
              el: child,
              marginBottom: child.style.getPropertyValue('margin-bottom'),
              marginBottomPriority: child.style.getPropertyPriority('margin-bottom')
            };
            galleryFlex.push(priorChild);
            child.style.setProperty('margin-bottom', '12px', 'important');
          }
        }
      };

      const passAbsFillShellFlow = () => {
        // v2.5.30：媒體容器的高度與內容無關（固定高、視窗高、長寬比），內容放在一層
        // 「絕對定位、四邊貼齊容器」的外殼裡 → 圖被 reader 還原成自然高度後，容器
        // 仍是站方那個高度（Jimmy 2026-11-20 theguardian.com 回報首圖與標題間一大塊
        // 空白）。真站量到的三種形態是同一個結構：
        //   寬螢幕 ≥ 980：容器 height: calc(100vh - 126px) → 視窗 900 高時圖下 271px
        //                 空白、1200 高時 571px（空白隨視窗高度變）
        //   窄螢幕：容器 aspect-ratio 4/5 → 430 寬時圖下 156px 空白
        //   矮視窗（520 高）：容器 394px 比圖矮，外殼 overflow:hidden 把圖裁掉約 100px
        // 為什麼既有 pass 全漏：ratioBoxes / fixedHeightBoxes 把容器歸 auto 後，唯一的
        //   子元素是 absolute、容器塌成 0 → collapse guard 還原（「內容本身脫離 flow」
        //   那一支）。它們保護的正是這個結構，所以要在它們之前把外殼拉回版面。
        // 通則（硬規則 3，結構訊號、非站點 / class 特判）：
        //   - 容器在 mediaAncestors、不是 player、不含 iframe / video（影片嵌入的
        //     「比例框＋absolute 填滿」由 embed 那一組規則管）
        //   - 容器只有一個 rendered 的元素子（外殼）、沒有直接文字
        //   - 外殼 computed position: absolute、rect 與容器相同（±2px）——填滿
        //   - 外殼不是媒體本身（img / picture / video 的 absolute 由 CSS 規則拉回）
        //   - 外殼內的 img / picture 到外殼之間沒有 absolute / fixed（圖已在版面內）
        // 寫入：外殼 position:static + height:auto；容器 height:auto + aspect-ratio:auto。
        // 量測後才決定留不留（與 ratioBoxes / fixedHeightBoxes 同精神）：
        //   - 新高度撐得住圖（≥ 圖高 × 0.8；圖未載入＝高度 0 時不設下限）
        //   - 而且站方高度與內容真的對不上：原本多出 > 40px（死空間），或原本比內容
        //     矮 > 8px（裁切 / 蓋到後面的內容）。兩者皆非＝站方版面本來就合身，還原不動
        // 必須在 passRatioBoxReset / passFixedHeightReset 之前：留下來的容器 inline
        //   height 已是 auto、aspect-ratio 已是 auto，兩條 pass 各自的入口會略過它。
        // 無 layout 的環境（jsdom，rect 全 0）在「容器高度 > 0」那一關自動略過。
        if (!mediaAncestors) return;
        const pending = [];
        for (const el of mediaAncestors) {
          if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
          if (el.closest && el.closest(`[${BYLINE_ATTR}="1"]`)) continue;
          if (el.style.getPropertyValue('height') === 'auto') continue;
          const win = el.ownerDocument?.defaultView;
          if (!win || !win.getComputedStyle) continue;
          // jsdom（nwsapi）遇到注入樣式裡的 :has() 會在 getComputedStyle 拋 SyntaxError
          //（既知行為，同 passAspectPseudoReset）；量不到就當成不是候選
          const gcs = (node) => { try { return win.getComputedStyle(node); } catch (_) { return null; } };
          let shell = null;
          let rendered = 0;
          for (const c of el.children) {
            const ccs = gcs(c);
            if (!ccs || ccs.display === 'none') continue;
            rendered++;
            shell = c;
            if (rendered > 1) break;
          }
          if (rendered !== 1) continue;
          if (/^(IMG|PICTURE|VIDEO|IFRAME)$/.test(shell.tagName)) continue;
          const scs = gcs(shell);
          if (!scs || scs.position !== 'absolute') continue;
          const cs = gcs(el);
          if (!cs) continue;
          if (cs.display === 'inline' || cs.display === 'none') continue;
          let directText = false;
          for (const n of el.childNodes) {
            if (n.nodeType === 3 && n.nodeValue.trim()) { directText = true; break; }
          }
          if (directText) continue;
          if (el.querySelector(`iframe, video, [${PLAYER_ATTR}="1"]`)) continue;
          const media = shell.querySelector('img, picture');
          if (!media) continue;
          let inFlow = true;
          for (let cur = media; cur && cur !== shell; cur = cur.parentElement) {
            const pcs = gcs(cur);
            if (!pcs || pcs.position === 'absolute' || pcs.position === 'fixed') { inFlow = false; break; }
          }
          if (!inFlow) continue;
          const er = el.getBoundingClientRect();
          if (!(er.height > 0)) continue;
          const sr = shell.getBoundingClientRect();
          if (Math.abs(sr.height - er.height) > 2 || Math.abs(sr.width - er.width) > 2 ||
              Math.abs(sr.top - er.top) > 2 || Math.abs(sr.left - er.left) > 2) continue;
          pending.push({
            el, shell, media, beforeH: er.height,
            rec: {
              el, shell,
              height: el.style.getPropertyValue('height'), heightPriority: el.style.getPropertyPriority('height'),
              aspectRatio: el.style.getPropertyValue('aspect-ratio'), aspectRatioPriority: el.style.getPropertyPriority('aspect-ratio'),
              shellPosition: shell.style.getPropertyValue('position'), shellPositionPriority: shell.style.getPropertyPriority('position'),
              shellHeight: shell.style.getPropertyValue('height'), shellHeightPriority: shell.style.getPropertyPriority('height')
            }
          });
        }
        if (!pending.length) return;
        // 寫入前先 push 進 snapshot 陣列（rollback 安全，同 ratioBoxes）
        const pushStart = absFillShells.length;
        for (const f of pending) {
          absFillShells.push(f.rec);
          f.shell.style.setProperty('position', 'static', 'important');
          f.shell.style.setProperty('height', 'auto', 'important');
          f.el.style.setProperty('height', 'auto', 'important');
          f.el.style.setProperty('aspect-ratio', 'auto', 'important');
        }
        for (const f of pending) {
          f.afterH = f.el.getBoundingClientRect().height;
          f.imgH = f.media.getBoundingClientRect().height;
        }
        const kept = [];
        for (const f of pending) {
          const holdsMedia = !(f.imgH > 0) || f.afterH >= f.imgH * 0.8;
          const mismatched = (f.beforeH - f.afterH > 40) || (f.afterH - f.beforeH > 8);
          if (holdsMedia && mismatched) { kept.push(f.rec); continue; }
          restoreAbsFillShell(f.rec);
        }
        absFillShells.length = pushStart;
        for (const k of kept) absFillShells.push(k);
      };

      const passRatioBoxReset = () => {
        // v0.8.137：媒體 wrapper 用 aspect-ratio 預留固定比例 placeholder（lazy-load
        // 占位），但實際載入的圖片比例 ≠ 預留比例時，wrapper 高度按 aspect-ratio 撐
        // 出超過圖片內容的空間 → 圖片下方一大塊假空白（Jimmy 2026-06-20 The Verge
        // lede / gallery wrapper 用雜湊 atomic class 設 aspect-ratio:1/1、實際 landscape
        // 圖渲染 405px、box 撐 608px → 203px 假空白；截圖回報）。
        // 上方 CSS [RATIO_CLASS_ATTR] reset 只認 class 帶 "ratio" token 的容器（New Yorker
        // AspectRatioContainer 類），SPA 站把 aspect-ratio 塞進 hash class（_1m5y14k5）
        // 漏網。改用 computed aspect-ratio !== 'auto' 這個結構訊號（非 class / hostname
        // 特判，符合硬規則 3）：mediaAncestors 內任何帶實際 aspect-ratio 的 wrapper
        // 一律歸 auto，讓 box 高度退回圖片 static flow 的自然高度。
        // 安全性：
        //   - mediaAncestors 由 picture/img/figure 上溯收集，純 iframe 影片 embed
        //     （aspect-ratio:16/9 + iframe absolute 撐高、無 img）不在集合內、不誤殺。
        //   - player 結構額外排除（與 galleryFlex 同原則）。
        //   - 自驗 collapse guard：歸 auto 後若 box 塌到比內圖渲染高度還矮（內容本身
        //     absolute、aspect-ratio 是唯一高度來源，例 New Yorker overlay 類但 class
        //     不含 "ratio" 漏掉 static-flow 配套）→ 還原 aspect-ratio 避免裁切。內圖
        //     尚未載入（高度 0）時仍 reset：未載圖沒有要保護的高度，box 跟著塌、載入
        //     後 height:auto 自然撐起。
        // v1.6.29 批次化：write-then-measure guard 改成「全讀（aspect-ratio +
        // 內圖高）→ 全 reset → 一次 flush 量全部 afterH → 還原失敗者」——舊版逐
        // 元素 reset + getBoundingClientRect，每個 ratio box 各觸發一次強制
        // reflow。批次量測下 afterH 反映「全部 ratio box 都已 reset」的 layout；
        // 舊版是逐一累進量測——巢狀 ratio wrapper 極端場景下 guard 判定時點不同，
        // 但兩者最終狀態一致（通過者本來就全會被 reset），wired/theverge harness
        // 驗證行為不變。
        const ratioPending = [];
        for (const el of mediaAncestors) {
          if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
          const win = el.ownerDocument?.defaultView;
          const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
          if (!cs || !cs.aspectRatio || cs.aspectRatio === 'auto') continue;
          const innerMedia = el.querySelector('img, picture, video');
          const imgH = innerMedia ? innerMedia.getBoundingClientRect().height : 0;
          ratioPending.push({
            el, imgH,
            priorAR: el.style.getPropertyValue('aspect-ratio'),
            priorARP: el.style.getPropertyPriority('aspect-ratio')
          });
        }
        // 寫入前先 push 進 snapshot 陣列（rollback 安全：批次中途拋錯時 v1.6.27
        // 的部分快照自我還原才涵蓋已寫入的元素）；guard 失敗者事後還原並自陣列移除
        const ratioPushStart = ratioBoxes.length;
        for (const r of ratioPending) {
          ratioBoxes.push({ el: r.el, aspectRatio: r.priorAR, aspectRatioPriority: r.priorARP });
          r.el.style.setProperty('aspect-ratio', 'auto', 'important');
        }
        // getBoundingClientRect 同步 flush layout（整批只 flush 一次），afterH
        // 反映 reset 後高度
        for (const r of ratioPending) r.afterH = r.el.getBoundingClientRect().height;
        {
          const keptRatio = [];
          ratioPending.forEach((r, i) => {
            if (r.imgH > 0 && r.afterH < r.imgH * 0.8) {
              if (r.priorAR) r.el.style.setProperty('aspect-ratio', r.priorAR, r.priorARP || '');
              else r.el.style.removeProperty('aspect-ratio');
              return;
            }
            keptRatio.push(ratioBoxes[ratioPushStart + i]);
          });
          ratioBoxes.length = ratioPushStart;
          for (const k of keptRatio) ratioBoxes.push(k);
        }
      };

      const passFixedHeightReset = () => {
        // v1.6.22：媒體祖先帶「明確固定 px height」但內容比它矮 → 容器底部一大塊
        // 死空間（Jimmy 2026-07-08 wired.com 回報 hero 圖下方一大段空白）。根因：
        //   IMG → PICTURE → SPAN(.responsive-asset) → DIV.SplitScreenContentHeaderLedeBlock
        //   (height:895px) → LeadWrapper(895) → GridItem(895) — WIRED 桌面版
        //   split-screen header 的「圖欄」在原站是雙欄 grid，圖欄固定高 895px 與
        //   文字欄等高。reader 把 grid 線性化成單欄後圖只渲染 356px、但三層 wrapper
        //   的固定 height:895 還在 → 圖下方 539px 純死空間頂開後續內文。
        // galleryFlex 只認 flex/grid（此鏈是 display:block）、ratioBoxes 只認
        //   aspect-ratio（此鏈無 aspect-ratio）→ 都漏網；這類「block + 明確 px
        //   height」是第三條 path。
        // 通則（硬規則 3，非站點/class 特判）：mediaAncestors 內、display 非 inline
        //   的容器，暫設 height:auto 後量自然高——若自然高比原渲染高矮 > 40px（固定
        //   height 撐出的死空間）→ 保持 auto 塌掉。computed height 永遠回 px（無法
        //   從樣式判斷是否明確設高），故一律「reset 後量差」判定：本來就 auto 的
        //   容器 reset 無變化（差 0）自動略過，只有真被 height 頂高的才命中。
        //   mediaAncestors 由 picture/img/figure 上溯，純文字段落不在集合、零影響。
        // 安全：
        //   - galleryFlex 已設 inline height:auto 的容器（flex/grid 並列圖）略過，
        //     避免重複判定 / restore 雙重還原。
        //   - 只覆寫 height（不動 min-height）：死空間若來自 min-height 由既有
        //     min-height:0 規則群處理，此條專注 height 這條已證實的 path。
        //   - collapse guard（與 ratioBoxes 同精神）：reset 後若比內圖渲染高度還矮
        //     （內容 absolute、固定 height 是唯一高度來源）→ 還原避免裁切。
        //   - 內圖含 caption 的 figure：height 本來就 auto（內容驅動），reset 無變化
        //     → 差 0 略過，caption 空間不受影響。
        // v1.6.29 批次化：同 ratioBoxes——「全讀 beforeH → 全 reset height:auto →
        // 一次 flush 量全部 afterH（+ 內圖高，維持舊版『reset 後量 imgH』時點）→
        // 還原失敗者」。WIRED 三層巢狀 895px wrapper 場景逐層/整批判定結果相同
        // （通過者最終全 auto），harness 驗證行為不變。
        const fixedHPending = [];
        for (const el of mediaAncestors) {
          if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
          if (el.closest && el.closest(`[${BYLINE_ATTR}="1"]`)) continue;
          const win = el.ownerDocument?.defaultView;
          const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
          if (!cs) continue;
          if (cs.display === 'inline' || cs.display === 'none') continue;
          // galleryFlex 已塌成 block + height:auto 的容器不重複處理
          if (el.style.getPropertyValue('height') === 'auto') continue;
          const beforeH = el.getBoundingClientRect().height;
          if (!(beforeH > 0)) continue;
          fixedHPending.push({
            el, beforeH,
            priorH: el.style.getPropertyValue('height'),
            priorHP: el.style.getPropertyPriority('height')
          });
        }
        // 寫入前先 push 進 snapshot 陣列（rollback 安全，同 ratioBoxes）；guard
        // 失敗者事後還原並自陣列移除
        const fixedHPushStart = fixedHeightBoxes.length;
        for (const f of fixedHPending) {
          fixedHeightBoxes.push({ el: f.el, height: f.priorH, heightPriority: f.priorHP });
          f.el.style.setProperty('height', 'auto', 'important');
        }
        for (const f of fixedHPending) {
          f.afterH = f.el.getBoundingClientRect().height;
          // collapse guard 的內圖高：與舊版同時點（reset 之後）量測
          const innerMedia = f.el.querySelector('img, picture, video');
          f.imgH = innerMedia ? innerMedia.getBoundingClientRect().height : 0;
        }
        {
          const keptFixedH = [];
          fixedHPending.forEach((f, i) => {
            // 死空間門檻：固定高比自然高多出 > 40px 才算，避免 rounding 級抖動誤動
            // collapse guard：塌到比內圖渲染高度還矮 → 還原（內容本身脫離 flow）
            if (f.beforeH - f.afterH <= 40 || (f.imgH > 0 && f.afterH < f.imgH * 0.8)) {
              if (f.priorH) f.el.style.setProperty('height', f.priorH, f.priorHP || '');
              else f.el.style.removeProperty('height');
              return;
            }
            keptFixedH.push(fixedHeightBoxes[fixedHPushStart + i]);
          });
          fixedHeightBoxes.length = fixedHPushStart;
          for (const k of keptFixedH) fixedHeightBoxes.push(k);
        }
      };

      const passAspectPseudoReset = () => {
        // v1.8.2：媒體祖先容器用 ::before / ::after 的垂直 padding 撐 aspect 佔位
        // （padding-bottom hack 的 pseudo 版）→ 內容被 reader 打回 flow 後，佔位
        // 本身變成純死空間，把媒體整段往下推（pansci.asia
        // DIV.rve-embed-responsive-16by9::before { padding-top: 56.25% } 撐 270px，
        // 影片框被推到空白下方，Jimmy 2026-09-01 回報「YouTube 影片不見了」的
        // 空白半邊；另一半是佔位框裁掉縮圖，見 EMBED_FILL_ATTR）。
        // 為何既有機制都漏：
        //   - CSS 端 ::before 中和（line ~1470）只認 class 含 placeholder / ratio
        //     的容器，這類 embed wrapper 的 class 無語意（rve-embed-responsive）。
        //   - ratioBoxes 認 computed aspect-ratio（此容器是 auto）、fixedHeightBoxes
        //     認「height 設 auto 後變矮」（padding 佔位 reset 後反而變高）、
        //     minHeightBoxes 認 min-height——三條死空間 pass 全不命中，這是第四條 path。
        // 通則（硬規則 3，非站點 / class 特判）：mediaAncestors 內、pseudo 有實際
        // content 且垂直 padding > 40px 的容器一律中和該佔位。
        // 安全：
        //   - 子樹含 iframe 者排除：那是已 mount 的 responsive embed，佔位框正是
        //     absolute iframe 的高度來源（FILL_IFRAME_ATTR 機制），中和會讓它塌掉。
        //   - player 結構不動（與 galleryFlex / ratioBoxes 同原則）。
        //   - collapse guard（同 ratioBoxes）：中和後容器塌到比內含媒體渲染高度還
        //     矮 → 撤回標記，避免 pseudo 是唯一高度來源時裁掉內容。
        // 成本：候選限 mediaAncestors（純文字主文 0 次 getComputedStyle），讀寫
        // 照批次三段式。
        const winPseudo = articleEl.ownerDocument?.defaultView;
        if (!winPseudo || !winPseudo.getComputedStyle) return;
        // 無 layout 引擎的環境（jsdom：documentElement 也量不到高度）直接
        // short-circuit——本 pass 修的是真實 layout 才存在的死空間，無 layout
        // 時無事可做；順帶避開 jsdom 未實作「帶 pseudo 參數的 getComputedStyle」
        // 而噴進 virtual console 的 not-implemented（回 undefined、catch 不到）。
        const rootEl = articleEl.ownerDocument && articleEl.ownerDocument.documentElement;
        if (!rootEl || !(rootEl.getBoundingClientRect().height > 0)) return;
        const pseudoPending = [];
        for (const el of mediaAncestors) {
          if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
          if (el.getAttribute && el.getAttribute(ASPECT_PSEUDO_ATTR) === '1') continue;
          if (el.querySelector && el.querySelector('iframe')) continue;
          let hit = false;
          for (const pseudo of ['::before', '::after']) {
            let ps;
            // 只吞 SyntaxError（jsdom nwsapi 既知行為，同 markAbsAnchors）
            try { ps = winPseudo.getComputedStyle(el, pseudo); } catch (e) {
              if (e && e.name === 'SyntaxError') break;
              throw e;
            }
            if (!ps) continue;
            const content = ps.content;
            if (!content || content === 'none' || content === 'normal') continue;
            const pad = (parseFloat(ps.paddingTop) || 0) + (parseFloat(ps.paddingBottom) || 0);
            if (pad > ASPECT_PSEUDO_MIN_PAD) { hit = true; break; }
          }
          if (!hit) continue;
          pseudoPending.push({ el, beforeH: el.getBoundingClientRect().height });
        }
        // 寫入前先 push 進 snapshot 陣列（rollback 安全，同 ratioBoxes）；
        // guard 失敗者事後撤回並自陣列移除
        const pseudoPushStart = aspectPseudoMarked.length;
        for (const p of pseudoPending) {
          aspectPseudoMarked.push(p.el);
          p.el.setAttribute(ASPECT_PSEUDO_ATTR, '1');
        }
        // getBoundingClientRect 同步 flush layout（整批只 flush 一次）
        for (const p of pseudoPending) {
          p.afterH = p.el.getBoundingClientRect().height;
          const innerMedia = p.el.querySelector('img, picture, video');
          p.mediaH = innerMedia ? innerMedia.getBoundingClientRect().height : 0;
        }
        {
          const keptPseudo = [];
          pseudoPending.forEach((p, i) => {
            if (p.mediaH > 0 && p.afterH < p.mediaH * 0.8) {
              p.el.removeAttribute(ASPECT_PSEUDO_ATTR);
              return;
            }
            keptPseudo.push(aspectPseudoMarked[pseudoPushStart + i]);
          });
          aspectPseudoMarked.length = pseudoPushStart;
          for (const k of keptPseudo) aspectPseudoMarked.push(k);
        }
        // v3.7.4：媒體直接容器的圖示字型 pseudo（見 ICON_PSEUDO_ATTR）。條件全成立才標：
        //   - 容器的直接子有 img / picture / video（＝被 MEDIA_DIRECT_WRAP_SEL 改成 static 的那層）
        //   - pseudo 絕對定位
        //   - content 是 1–2 個私用區字元（U+E000–U+F8FF：圖示字型的慣例碼位，不會是文字）
        // 只看私用區：用 content 放「攝影：某某」這類圖片來源字的站，那是內容，不藏
        for (const el of mediaAncestors) {
          if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
          if (!el.querySelector || !el.querySelector(':scope > img, :scope > picture, :scope > video')) continue;
          const which = [];
          for (const pseudo of ['before', 'after']) {
            let ps;
            try { ps = winPseudo.getComputedStyle(el, '::' + pseudo); } catch (e) {
              if (e && e.name === 'SyntaxError') break;
              throw e;
            }
            if (!ps || ps.position !== 'absolute') continue;
            const m = /^"(.*)"$/.exec(ps.content || '');
            if (!m) continue;
            const chars = Array.from(m[1].replace(/\\/g, ''));
            if (chars.length >= 1 && chars.length <= 2 && chars.every((c) => /[\uE000-\uF8FF]/.test(c))) which.push(pseudo);
          }
          if (!which.length) continue;
          el.setAttribute(ICON_PSEUDO_ATTR, which.join(' '));
          aspectPseudoMarked.push(el);
        }
      };

      const passMinHeightReset = () => {
        // v1.7.78：純文字容器被 min-height 撐出死空間 → 標題 / byline 上下大片空白
        // 根因（Jimmy 2026-08-20 techcrunch.com 回報 hero 圖、標題、byline、內文
        // 之間各一大段空白，probe 實證）：
        //   .article-hero__content { display:flex; flex-direction:column;
        //     justify-content:space-around; min-height:620px }（站方 @media
        //     (min-width:48em) 為「左圖右文等高雙欄」hero 設計而設，620px = 圖欄高）。
        //   reader 把雙欄線性化成單欄後圖搬到上方，文字欄內容只剩標題 96px +
        //   byline 27px（分類 chip 與 extension 區已被 cleaner 隱藏），但
        //   min-height:620 還在 → space-around 把多出的 465px 均分成三段空白，
        //   正好落在 caption↓標題、標題↓byline、byline↓內文 之間。
        // 為什麼既有 pass 全漏：galleryFlex / ratioBoxes / fixedHeightBoxes 三條
        //   都只掃 mediaAncestors（此容器不含媒體後代——圖在 sibling section），
        //   且 fixedHeightBoxes 明示只動 height、不動 min-height；CSS 側的
        //   min-height:0 規則群則全部 keyed on 媒體 tag 或 hidden marker，純文字
        //   容器沒有對應規則。這是第四條 path。
        // 通則（硬規則 3，非站點 / class 特判）：主文內任何 computed min-height
        //   非 0 / auto 的容器，暫設 min-height:0 後量自然高——比原渲染高矮 > 40px
        //   者保持 0（min-height 撐出的死空間），否則還原。本來就沒被 min-height
        //   頂住的容器 reset 後差 0，自動略過（TechCrunch 全頁只有 1 個容器命中）。
        // 安全：
        //   - display:none / inline 略過（前者無 layout、後者 min-height 無效）。
        //   - player 結構（PLAYER_ATTR）內部 layout 自管，不動。
        //   - collapse guard（與 ratioBoxes / fixedHeightBoxes 同精神）：塌到比內含
        //     媒體渲染高還矮 → 還原，避免內容 absolute、min-height 是唯一高度來源
        //     時被裁掉；有文字卻塌到近 0 同樣還原。
        // 成本：全主文 computed 掃描的三條之一（另兩條：markAbsAnchors 讀 position、
        //   splitPreWrapParagraphs 讀 white-space）。2026-10-07 review B-11 以 CDP
        //   profile 量 wiki 17K 節點頁：167 / 64 / 11ms（含各自觸發的一次強制
        //   recalc）；三條落在不同 pipeline 階段（ARTICLE_ATTR 後 / decolumn 後 /
        //   pre-wrap 切段前）、量的東西互不相干，不合併。（min-height 沒有可用的
        //   selector 前篩）。讀寫仍照 v1.6.29 批次三段式（全讀 → 全寫 → 一次 flush
        //   量全部），期間不交錯，只觸發一次強制 recalc。
        const win = articleEl.ownerDocument?.defaultView;
        if (!win || !win.getComputedStyle) return;
        const minHPending = [];
        for (const el of articleEl.querySelectorAll('*')) {
          if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
          const cs = win.getComputedStyle(el);
          if (!cs) continue;
          if (cs.display === 'none' || cs.display === 'inline') continue;
          const mh = cs.minHeight;
          if (!mh || mh === 'auto' || mh === 'none' || parseFloat(mh) === 0) continue;
          const beforeH = el.getBoundingClientRect().height;
          if (!(beforeH > 0)) continue;
          minHPending.push({
            el, beforeH,
            priorMH: el.style.getPropertyValue('min-height'),
            priorMHP: el.style.getPropertyPriority('min-height')
          });
        }
        // 寫入前先 push 進 snapshot 陣列（rollback 安全，同 ratioBoxes /
        // fixedHeightBoxes）；guard 失敗者事後還原並自陣列移除
        const minHPushStart = minHeightBoxes.length;
        for (const m of minHPending) {
          minHeightBoxes.push({ el: m.el, minHeight: m.priorMH, minHeightPriority: m.priorMHP });
          m.el.style.setProperty('min-height', '0', 'important');
        }
        for (const m of minHPending) {
          m.afterH = m.el.getBoundingClientRect().height;
          const innerMedia = m.el.querySelector('img, picture, video, iframe');
          m.mediaH = innerMedia ? innerMedia.getBoundingClientRect().height : 0;
        }
        {
          const keptMinH = [];
          minHPending.forEach((m, i) => {
            const hasText = ((m.el.textContent || '').trim().length > 0);
            const collapsedTooFar = (m.mediaH > 0 && m.afterH < m.mediaH * 0.8) ||
              (hasText && m.afterH < 8);
            if (m.beforeH - m.afterH <= 40 || collapsedTooFar) {
              if (m.priorMH) m.el.style.setProperty('min-height', m.priorMH, m.priorMHP || '');
              else m.el.style.removeProperty('min-height');
              return;
            }
            keptMinH.push(minHeightBoxes[minHPushStart + i]);
          });
          minHeightBoxes.length = minHPushStart;
          for (const k of keptMinH) minHeightBoxes.push(k);
        }
      };

      const passDecolumn = () => {
        // v0.8.66：多欄塌成單欄（de-column flex/grid columns）。
        // 根因（Jimmy 2026-06-14 christies.com/en/stories/... 回報「內文寬度不
        // 正確」+「圖片偏左變小」）：原站把主文段落 / 內容圖片排進 flex-row /
        // 多欄 grid 容器做雜誌式雙欄 layout（christies `div.sc-kLokBR` 是
        // display:flex 把內文擠成 292px 半欄、把直幅素描鎖在 66.67% 欄 = 397px、
        // 另半欄留給側欄圖說，本文沒側欄時右半整片留白）。reader card 是單欄
        // layout，這類橫向分欄讓內容只佔卡片版心一部分、大量浪費可讀寬度。
        // 上方 galleryFlex 只處理「含 picture/img/figure 直接子」的 flex/grid
        // （並列圖），「段落分欄」與「媒體深埋在欄 wrapper div 內」是另兩條
        // path——這裡一起補上。
        //
        // 通則（非站點特判，符合硬規則 3）：以「主文長段落 / 內容圖片實際被渲染
        // 得比它的 flex/grid 祖先的內容寬窄一截（< 70%）」為結構訊號——往上找出
        // 真正在分欄的那層容器，塌成 display:block 讓內容退回正常 block flow 撐滿
        // 版心（塌欄後欄 wrapper 的 flex-basis 失效、退回 block 自然填滿父寬）。
        // 防誤殺：
        //   - 只認 flex-direction:row(-reverse) 或 grid 多欄（>= 2 column track）；
        //     flex-column 本來就垂直堆疊、不命中。
        //   - anchor 必須是 >= 80 字的長 <p> 或 >= 100px 的 content img——button
        //     row / tag 列 / 麵包屑 / metadata / emoji / icon-link 沒有長段落或
        //     大圖、不命中。
        //   - anchor 寬必須 < 容器內容寬 70%——單一全寬 flex/grid 子（沒真的分欄）
        //     比例接近 1、不動。
        // 每塌一層後重量 anchor 寬：內層 splitter 塌掉後 anchor 已撐滿，外層若非
        // splitter 比例回到 ~1 不會被誤塌（避免 stale 寬度連鎖誤判）。
        const textColSeen = new Set();
        // v0.8.69：lazy content img 載入後才補跑 de-column 的 load listener，
        // restore 時清除尚未觸發者（避免退出後仍在 detach 節點上塌欄 / 洩漏）。
        // galleryFlex 已塌成 block 的容器不再重複塌（避免 restore 雙重還原）。
        for (const g of galleryFlex) { if (g.el) textColSeen.add(g.el); }
        {
          const win = articleEl.ownerDocument?.defaultView;
          if (win) {
            // v1.7.43：橫向多欄容器判定——decolumnFrom / stackLopsidedImgCol /
            // overflow-right 塌欄三處共用（原三份逐字重複）。只認
            // flex-direction:row(-reverse) 或 >= 2 column track 的 grid：
            // flex-column 本來就垂直堆疊、單欄 grid 沒分欄，不該被塌。
            const isMultiColumnContainer = (cs) => {
              const disp = cs.display;
              if ((disp === 'flex' || disp === 'inline-flex') && /^row/.test(cs.flexDirection)) return true;
              const cols = cs.gridTemplateColumns;
              return (disp === 'grid' || disp === 'inline-grid') &&
                !!cols && cols !== 'none' && cols.trim().split(/\s+/).length >= 2;
            };
            // 對單一 anchor 沿祖先鏈塌分欄容器（長段落 / content img 共用同一邏輯）。
            // ratio = anchor 渲染寬 / 容器內容寬 的「塌欄門檻」：anchor 比這比例
            // 還窄才視為「真的被分欄擠窄」。長段落用 0.7（pull-quote / 縮排引言等
            // 合法窄段落比例落在 0.7~1，不該誤塌）；content 圖片用 0.9——v0.8.70：
            // 圖片在單欄閱讀模式只有「撐滿」或「被分欄擠窄」兩種狀態、沒有中間
            // 地帶，hero 是 440px 小圖卡在 flex 欄 = 72%（> 0.7 漏掉、Jimmy 截圖
            // 仍偏左），把圖片門檻放寬到 0.9 讓「沒撐滿（< 90%）的 flex/grid 欄內
            // 圖」都塌欄 → 退回 block 流、margin auto 置中（且 picture srcset 重評
            // 常順帶載入更寬來源撐滿）。真正撐滿（>= 90%）的單一全寬圖比例近 1、不動。
            // v2.5.9：ARIA 表格的列（isAriaTableRow）不塌——那是表格的欄、不是雜誌式
            // 分欄；塌掉後「標籤格 / 說明格」變上下堆疊、和其他列對不上。下方
            // stackLopsidedImgCol 不必另外豁免：格子已被等分欄寬（segCardWidth 的
            // CSS 規則），不會出現「含圖欄 < 25%、另一欄 ≥ 50%」的形狀
            // v2.5.18：翻頁模式的寬度要按「單一欄片段」量。multicol 卡片裡跨頁的元素，
            // getBoundingClientRect() 回的是各欄片段的聯集（兩頁 = 兩欄寬＋欄距），
            // 拿它當「容器內容寬」會把沒分欄的橫向 flex 誤判成分欄：GitBook 清單項
            // （li 是橫向 flex：圓點 div＋文字 div）跨頁時聯集 804px、裡面的段落 371px
            // 不到 70% → li 被寫成 display:block、圓點單獨佔一行（Jimmy 2026-11-17
            // 裁定修）。改取 getClientRects() 裡最寬的那一片——跨頁的容器與 anchor 都
            // 回到單欄內的真實寬，真的分欄（christies 這類）跨頁時比例照樣成立、照塌。
            // 捲動模式沒有欄片段，直接回 bounding 寬（與舊行為逐值相同）
            const colWidthOf = (el) => {
              const bw = el.getBoundingClientRect().width;
              if (!opts.pagedMode || typeof el.getClientRects !== 'function') return bw;
              const rs = el.getClientRects();
              if (!rs || rs.length < 2) return bw;
              let m = 0;
              for (const fr of rs) { if (fr.width > m) m = fr.width; }
              return m > 0 ? m : bw;
            };
            const decolumnFrom = (anchor, ratio) => {
              let cur = anchor.parentElement;
              while (cur && cur !== articleEl) {
                if (!textColSeen.has(cur) &&
                    !isAriaTableRow(cur) &&
                    !(cur.getAttribute && cur.getAttribute(PLAYER_ATTR) === '1') &&
                    !(cur.closest && cur.closest(`[${BYLINE_ATTR}="1"]`))) {
                  const cs = win.getComputedStyle(cur);
                  if (isMultiColumnContainer(cs)) {
                    const contentW = colWidthOf(cur) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
                    const aw = colWidthOf(anchor); // 每層重量（前一層塌掉後會變寬）
                    if (contentW > 0 && aw > 0 && aw < contentW * ratio) {
                      textColSeen.add(cur);
                      textColFlex.push({
                        el: cur,
                        display: cur.style.getPropertyValue('display'),
                        displayPriority: cur.style.getPropertyPriority('display'),
                      });
                      setInlineOwned(cur, 'display', 'block', 'important', 'styler:decolumn');
                    }
                  }
                }
                cur = cur.parentElement;
              }
            };

            // v1.0.9：作者 bio / meta 卡的「窄圖欄擠寬文欄」塌成單欄（stack）。
            // 根因（Jimmy 2026-06-25 autocar.co.uk 作者欄「文字疊在一起」回報）：
            // 站點把作者卡排成 flex-row 兩欄——窄欄（頭像 + Title/Follow 標籤）+
            // 寬欄（bio 長文）。reader card 單欄下窄欄被擠到 min-content（autocar
            // .author-left 渲染 39px = card 6%），頭像（capIcon 釘 max-width 142）
            // 被壓到 39px、標籤逐字斷行，與寬欄 bio 文字擠在一起（real Chrome 疊字、
            // headless 並排但同樣破版）。decolumnFrom 的 ratio 閘以「主文 anchor 被
            // 擠窄」為訊號，這裡被擠的是窄圖欄、寬 bio 欄佔 82% > 70% 漏網。
            // 通則（結構，非站點特判，符合硬規則 3）：flex-row / 多欄 grid 容器，其中
            // 一個「含圖的內容欄」被渲染得極窄（< 25% 容器內容寬）、另有一欄佔 >= 50%
            // （lopsided sidebar + main 分欄）→ 單欄閱讀無保留價值，塌成 display:block
            // 讓兩欄垂直堆疊（窄圖欄回全寬、頭像回原顯示寬、標籤不再逐字斷行；寬欄
            // 落到下方）。防誤殺：narrow 欄必須含 img（純窄文字欄 = 分類標籤，交給
            // cleaner sidebar 規則 hide，不在此塌欄）；排除 byline root / player。
            // 沿 img 祖先鏈走（path child 即含 img 的欄），bounded by img 數 × 深度。
            const stackLopsidedImgCol = (img) => {
              let child = img, cur = img.parentElement;
              while (cur && cur !== articleEl) {
                if (!textColSeen.has(cur) &&
                    !(cur.getAttribute && cur.getAttribute(PLAYER_ATTR) === '1') &&
                    !(cur.closest && cur.closest(`[${BYLINE_ATTR}="1"]`))) {
                  const cs = win.getComputedStyle(cur);
                  if (isMultiColumnContainer(cs)) {
                    const contentW = colWidthOf(cur) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
                    const childW = colWidthOf(child);
                    if (contentW > 0 && childW > 0 && childW < contentW * 0.25) {
                      // 另需一個 >= 50% 寬的 sibling 欄（確認是 lopsided 分欄、非單欄）
                      let wideSibling = false;
                      for (const c of cur.children) {
                        if (c === child) continue;
                        const cr = c.getBoundingClientRect();
                        if (cr.height >= 1 && colWidthOf(c) >= contentW * 0.5) { wideSibling = true; break; }
                      }
                      if (wideSibling) {
                        textColSeen.add(cur);
                        textColFlex.push({
                          el: cur,
                          display: cur.style.getPropertyValue('display'),
                          displayPriority: cur.style.getPropertyPriority('display'),
                        });
                        setInlineOwned(cur, 'display', 'block', 'important', 'styler:decolumn');
                      }
                    }
                  }
                }
                child = cur;
                cur = cur.parentElement;
              }
            };

            // anchor 0（v2.5.21）：主標題。標題被橫向多欄擠到不滿容器七成 → 塌欄。
            // 語料庫 theverge.com 翻譯後（2026-11-18 逐頁看截圖）：頁首是
            // flex row-reverse（左欄作者、右欄標題＋副標），原文頁靠 anchor 1 塌掉
            // ——副標是 88 字的 <p>；譯成中文後副標剩 32 字，過不了下面的 80 字門檻
            // （按拉丁字校準的 raw 長度，CJK 譯文落網的老問題），整列沒塌，標題被擠在
            // 右側 268px 窄欄。標題該佔滿版心，跟旁邊的文字多長無關，所以拿標題
            // 自己當 anchor、不看字數。只取卡內第一個看得到的 h1。
            for (const h of articleEl.querySelectorAll('h1')) {
              if (h.closest && h.closest('[data-jread-hidden="1"]')) continue;
              if (!(h.getBoundingClientRect().width > 0)) continue; // 看不到的 h1（站方藏的 SEO 標題）跳過
              decolumnFrom(h, 0.7);
              break;
            }
            // anchor 1：長段落（toggle 當下已在 DOM、文字不 lazy）。
            for (const p of articleEl.querySelectorAll('p')) {
              if (p.closest && p.closest('[data-jread-hidden="1"]')) continue;
              if ((p.textContent || '').trim().length >= 80) decolumnFrom(p, 0.7);
            }
            // anchor 2：content 圖片（v0.8.68）——christies stories 把直幅素描 /
            // hero 放進 flex-row 的 66.67% 欄（DIV flex: 0 0 calc(66.6667% - 8px)），
            // 欄內只有 <a><picture><img>、沒有長 <p>，longParas 路徑漏掉、圖被鎖在
            // 2/3 欄寬 = 397px（card 內容寬 608），偏左又縮小。galleryFlex 只認
            // 「flex/grid 直接子是 picture/img/figure」的並列圖，這裡的媒體深埋在欄
            // wrapper div 內、不命中。inline emoji（INLINE_IMG_ATTR）與純 icon-link
            // （a > img 未標 content-img）排除，與 styler media 規則同準則。
            //
            // v0.8.69：lazy 圖延後處理——hero 在 above-fold 卻 lazy-load，toggle
            // 當下 naturalWidth=0 / rect 0x0、不滿 >= 100px anchor 門檻被漏掉，
            // 一次性 de-column 跑完就不再回頭，圖載入後仍卡 66.67% 欄偏左（Jimmy
            // 2026-06-14 cage 實機實證：hero rect 397/608、sc-kLokBR 仍 flex、
            // 長 <p> 路徑救不到它的圖說欄）。修法：toggle 當下已載入的圖立即跑；
            // 未載入的掛一次性 load listener，載入後重量、夠大且撐窄欄才塌。
            for (const m of articleEl.querySelectorAll('img')) {
              if (m.closest && m.closest('[data-jread-hidden="1"]')) continue;
              if (m.hasAttribute(INLINE_IMG_ATTR)) continue;
              // v1.7.44 E10 效能：v1.0.9 stackLopsidedImgCol 原本獨立再掃一輪
              // querySelectorAll('img') + 重複 hidden closest 檢查——合併進本迴圈
              // 單次遍歷。呼叫點在 A-parent skip 之前（stack 規則不豁免 <a> 內
              // avatar，與原獨立迴圈一致）；兩規則的 collapse 動作同構（display:
              // block + textColFlex snapshot）且 textColSeen 去重，先後互換結果等價。
              stackLopsidedImgCol(m);
              if (m.parentElement && m.parentElement.tagName === 'A' &&
                  !m.hasAttribute(CONTENT_IMG_ATTR)) continue;
              const mr = m.getBoundingClientRect();
              if (mr.width >= 100 && mr.height >= 100) {
                decolumnFrom(m, 0.9);
              } else if (!m.complete || (m.naturalWidth || 0) === 0) {
                const onLoad = () => {
                  if (m.hasAttribute(INLINE_IMG_ATTR)) return;
                  const rr = m.getBoundingClientRect();
                  if (rr.width >= 100 && rr.height >= 100) decolumnFrom(m, 0.9);
                };
                m.addEventListener('load', onLoad, { once: true });
                decolumnLoadCleanup.push({ img: m, onLoad });
              }
            }

            // v0.8.136：互補 case——「固定 px grid/flex track 不隨 card 縮窄」造成
            // 內文被撐寬往右溢出。上方 decolumnFrom 的 ratio 閘只認「anchor 被擠得
            // 比容器窄」（< 70%/90%），認不出「anchor 反而比 card 還寬、右移溢出」。
            // NYT Wirecutter 實測（snoo-smart-sleeper）：article > div（display:grid，
            // 寬度已正確縮到 card content box 608px）的 grid 子項用站點寫死的 1024px
            // content track → 內含 h1/p/figure 全部 1024 寬、左緣右移 64px、右緣
            // 衝出 card content box 被 overflow-x:hidden 切掉 → 視覺上「圖文偏右 +
            // 右側被切」。decolumnFrom 對長 <p> 走到此 grid 時 anchor 寬 1024 >
            // 容器 608、不滿足 narrower 閘 → 漏網。
            // 通則（結構，非站點特判，符合硬規則 3）：任何 grid/flex 容器，其直接子
            // 渲染右緣溢出 card 右緣 → 固定 track / 並列 layout 在單欄閱讀無保留價值，
            // 塌成 display:block 讓子項退回 block flow（width 退回父寬、靠左對齊）。
            // overflow 幾何閘只動真破版的容器、放過正常 grid/flex。
            // 效能：先用 rect 收「溢出右緣」節點 → 往上收祖先 Set → 只對 Set 跑
            // getComputedStyle（同 galleryFlex mediaAncestors 思路，避免 O(全 DOM)
            // getComputedStyle）。
            // v1.6.24：gate 在非翻頁模式——翻頁的 multicol card（position:fixed +
            // column-width）第 2 欄起所有元素 rect.right 天然超過 card 右緣（probe
            // 實證：正常 flex-row / 窄 table 全被誤判「溢出」），量 card 寬在 multicol
            // 下不可靠（同 contentWidthSnap v0.7.246 註解的既有原則）。翻頁模式
            // 溢出破版由 column layout 自然裁切，不做 rect 幾何修法。
            // v1.7.44 E5 效能：cheap gate——scrollWidth 量的是含被 overflow 裁掉
            // 部分的水平內容寬，articleEl 無水平溢出（scrollWidth ≈ clientWidth）
            // 時子樹內不可能有「右緣衝出 card」的破版，整段 O(全子樹) rect 掃描
            // 直接跳過（絕大多數正常頁面走這條零成本路）。容差 +2 對齊下方
            // cardRight + 2 的判定。已知盲點：溢出在「中介 overflow:hidden 祖先」
            // 就地被裁掉時不反映在 articleEl.scrollWidth——該情境本段原本也只能
            // 塌中介層以下的容器、覆蓋本就有限，屬可接受的保守邊界。
            if (!opts.pagedMode && articleEl.scrollWidth > articleEl.clientWidth + 2) {
              const cardRight = articleEl.getBoundingClientRect().right;
              const overflowAncestors = new Set();
              for (const el of articleEl.querySelectorAll('*')) {
                const rr = el.getBoundingClientRect();
                if (rr.width < 1 || rr.height < 1) continue;
                if (rr.right <= cardRight + 2) continue;
                let cur = el.parentElement;
                while (cur && cur !== articleEl.parentElement) {
                  overflowAncestors.add(cur);
                  cur = cur.parentElement;
                }
              }
              for (const el of overflowAncestors) {
                if (textColSeen.has(el)) continue;
                if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
                const cs = win.getComputedStyle(el);
                // 同 decolumnFrom 的容器判定（isMultiColumnContainer 共用）——
                // flex-column / 單欄 grid 不該因「某後代溢出」被誤塌。
                if (!isMultiColumnContainer(cs)) continue;
                let overflows = false;
                for (const c of el.children) {
                  const cr = c.getBoundingClientRect();
                  if (cr.width >= 1 && cr.right > cardRight + 2) { overflows = true; break; }
                }
                if (!overflows) continue;
                textColSeen.add(el);
                textColFlex.push({
                  el,
                  display: el.style.getPropertyValue('display'),
                  displayPriority: el.style.getPropertyPriority('display'),
                });
                setInlineOwned(el, 'display', 'block', 'important', 'styler:decolumn');
              }
            } else if (opts.pagedMode) {
              // v2.5.38：上一段在翻頁模式的對偶。上一段用「子項右緣衝出卡片右緣」判溢出，
              // 翻頁的 multicol 卡片量不準（第 2 欄起天然超出）所以整段關掉——但橫排溢出
              // 在翻頁模式一樣會發生、一樣被欄裁掉。cnbc「Key Points」實證：站方 flex 列
              // ＝左 85px 標題＋右清單，清單 flex-shrink:0 搭配 min/max-width:calc(75% - 30px)
              // 自己算寬；segCardWidth 的通則把 max-width 改 100%、min-width 改 0，清單撐滿
              // 608px、旁邊再擠 85px 標題 → 右側溢出 85px，第二條「…reinvent the P」後半被
              // 欄邊裁掉（捲動模式靠上一段塌欄，沒事）。
              // 翻頁版的溢出判定改成「子項右緣衝出它自己的 flex/grid 容器內容右緣」：子項
              // 與容器在同一欄片段內比，不受欄位移影響（容器跨頁時取子項起點所在的那一片）。
              // 候選先用 scrollWidth > clientWidth 篩（不必對全 DOM getComputedStyle）。
              // 溢出的子項要有文字：症狀是「字被切」；沒有字的溢出（discourse 燈箱資訊列
              // opacity:0 疊層裡的 svg 圖示）不是這個症狀、也看不到，不碰。
              // 語料庫 180 頁翻頁模式普查（2026-11-22）：只命中 cnbc 原文與翻譯後兩頁。
              for (const el of articleEl.querySelectorAll('*')) {
                if (textColSeen.has(el)) continue;
                if (!(el.clientWidth > 0) || el.scrollWidth <= el.clientWidth + 2) continue;
                if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
                if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
                if (isAriaTableRow(el)) continue;
                const cs = win.getComputedStyle(el);
                if (!isMultiColumnContainer(cs)) continue;
                const frs = el.getClientRects();
                if (!frs || !frs.length) continue;
                const padR = (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderRightWidth) || 0);
                let overflows = false;
                for (const c of el.children) {
                  if (!(c.textContent || '').trim()) continue;
                  const cr = c.getClientRects()[0];
                  if (!cr || cr.width < 1 || cr.height < 1) continue;
                  let fr = frs[0];
                  for (const f of frs) { if (cr.left >= f.left - 1 && cr.left < f.right) { fr = f; break; } }
                  if (cr.right > fr.right - padR + 2) { overflows = true; break; }
                }
                if (!overflows) continue;
                textColSeen.add(el);
                textColFlex.push({
                  el,
                  display: el.style.getPropertyValue('display'),
                  displayPriority: el.style.getPropertyPriority('display'),
                });
                setInlineOwned(el, 'display', 'block', 'important', 'styler:decolumn');
              }
            }

            // v1.0.9 stackLopsidedImgCol 的獨立 img 掃描已於 v1.7.44（E10）合併
            // 進上方 anchor 2 迴圈（單次遍歷；圖小被 >= 100px 門檻漏掉的 avatar
            // 場景由合併後迴圈的 stackLopsidedImgCol 呼叫點涵蓋）
          }
        }
      };

      const passWpConstrainedMaxWidth = () => {
        // v0.7.179：WordPress constrained layout inline override。
        // CSS stylesheet `html [data-jread-active] p { max-width: none !important }`
        // 在某些 WP theme 下 computed 仍未生效（疑似 WP 動態注入的 inline style
        // 或 container query 機制覆蓋）。inline !important 是 CSS 最高優先級，
        // 任何 stylesheet rule 都無法打敗。
        const CONTENT_BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, ul, ol, dl';
        for (const el of articleEl.querySelectorAll(CONTENT_BLOCK_SEL)) {
          const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
          if (!cs) continue;
          const mw = cs.maxWidth;
          if (mw && mw !== 'none' && mw !== '100%' && !mw.startsWith('100')) {
            wpConstrained.push({
              el,
              maxWidth: el.style.getPropertyValue('max-width'),
              maxWidthPriority: el.style.getPropertyPriority('max-width'),
            });
            el.style.setProperty('max-width', 'none', 'important');
          }
        }
      };

      // v2.5.18：被我們縮窄的寬表（passWideContentScroll 把 min-width 歸 0 的那種）裡，
      // 站方寫死高度的文字容器放開高度。真站：en.wikipedia Taiwan「Largest cities」
      // 表頭 div inline `height: 2.6em; line-height: 1.3em`（剛好兩行）——表縮窄後
      // 標題換成兩行、第三行的「source」連結溢出固定高，疊到下一列的欄名上
      //（畫面「sourDivision」）。站方的高度是按「表有 50em 寬」算的，我們把寬度
      // 拿掉了，高度就得跟著放。
      // 結構判定（不綁 class）：內容溢出自己的高度（scrollHeight > clientHeight）、
      // overflow-y 是 visible（站方自己裁切 / 內捲的不碰）、有文字。放開後仍溢出＝
      // 溢出不是高度造成的（例如定位子元素）→ 退回原值、不接管。
      // 表格結構 tag 與 replaced / pre 不看：高度語意不同，也不是這個症狀的載體。
      const WIDE_FIXED_HEIGHT_SKIP = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COL', 'COLGROUP', 'IMG', 'PICTURE', 'VIDEO', 'IFRAME', 'SVG', 'CANVAS', 'OBJECT', 'EMBED', 'PRE']);
      const releaseFixedHeightText = (root, win, entry) => {
        for (const box of root.querySelectorAll('*')) {
          if (WIDE_FIXED_HEIGHT_SKIP.has(String(box.tagName).toUpperCase())) continue;
          if (!(box.clientHeight > 0) || box.scrollHeight <= box.clientHeight + 1) continue;
          if (!(box.textContent || '').trim()) continue;
          const oy = win.getComputedStyle(box).overflowY;
          if (oy && oy !== 'visible') continue;
          const height = box.style.getPropertyValue('height');
          const heightPriority = box.style.getPropertyPriority('height');
          box.style.setProperty('height', 'auto', 'important');
          if (box.scrollHeight > box.clientHeight + 1) {
            if (height) box.style.setProperty('height', height, heightPriority);
            else box.style.removeProperty('height');
            continue;
          }
          (entry.heightReleased || (entry.heightReleased = [])).push({ el: box, height, heightPriority });
        }
      };

      // v2.5.24：表格欄位被擠到一字一行時，給那一格最小寬度。
      // 根因（ko.wikipedia 咖啡「花式咖啡」九欄表、hi / fa.wikipedia 譯成中文後的五欄表，
      // 語料庫 1280 與 430 寬）：表格自動排版在放不下時把每欄往「最小內容寬」壓；中日韓
      // 文字每個字之間都能斷，最小內容寬＝一個字，所以表格永遠「放得下」、不會溢出，
      // passWideContentScroll 也就不會接手——結果是欄寬 20–38px、「牛奶／蒸氣牛奶」
      // 直排成七行。拉丁文字的單字不能從中間斷，欄寬有單字長度墊著，不會這樣。
      // 通則（不看站點 / class / 語言）：格子裡最長的一段「不含空白的字串」如果比格子的
      // 內容寬還寬，代表它正被從中間斷開。斷到一行放不下
      // min(那段字串, CELL_FLOOR_TRIGGER_EM 個字) 才算被擠（一行還放得下三個字的欄
      // 不動——pmc 譯文表的標籤欄 3.5 個字寬，動了只是從別欄搶 8px、別欄多折一行）；
      // 被擠的格子 min-width 設成 min(那段字串的寬, CELL_FLOOR_EM 個字)。表格會先從有
      // 餘裕的欄挪寬度，挪不夠才比卡片寬——那時交給排在後面的 passWideContentScroll
      // 寫成卡內橫向捲動。
      //   - 字串寬用 OffscreenCanvas 以格子的字型量（只量前 CELL_FLOOR_PROBE_CHARS 個字，
      //     夠判斷有沒有到上限）；沒有 OffscreenCanvas（jsdom、Safari 16.4 以前）時按
      //    「寬字 1em、其餘 0.55em」估
      //   - 字串本來就放得下的格子（一般換行、拉丁單字）一個 inline 都不寫
      //   - 只在捲動模式跑：翻頁模式橫拖是翻頁，表格比欄寬就看不到也捲不到
      //    （Jimmy 2026-11-18 裁定：翻頁模式會擠成一字一行的表整張不處理）
      //   - 含公式的格子不看（NS.MATH_RENDER_SEL）：公式的 textContent 是 MathML 各節點
      //     與 LaTeX 原始碼黏成的一長串，量它的字寬沒有意義（arxiv 公式表的式子被
      //     推偏 22px）
      //   - 含巢狀表格的格子、看不到的格子、播放器不看；單張表超過
      //     CELL_FLOOR_MAX_CELLS 格不看（量測成本）
      // 這條驗「字串被從中間斷開的格子有了下限」、不驗撐寬之後表格比卡片寬時的橫捲
      //（歸 passWideContentScroll）
      const CELL_FLOOR_TRIGGER_EM = 3;
      const CELL_FLOOR_EM = 4;
      const CELL_FLOOR_PROBE_CHARS = 8;
      const CELL_FLOOR_MAX_CELLS = 1500;
      const CELL_FLOOR_MAX_ROUNDS = 4;
      const CELL_FLOOR_WIDE_CHAR_RE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;
      // 量字寬的 canvas 與「給一張表的格子下限」抽成共用（v2.5.25：passWideTableFontFit
      // 縮字級後要對同一張表重算下限）
      let cellFloorCtx = null, cellFloorCtxTried = false;
      const cellFloorTokenWidth = (win, tok, cs, fs) => {
        const head = Array.from(tok).slice(0, CELL_FLOOR_PROBE_CHARS).join('');
        if (!cellFloorCtxTried) {
          cellFloorCtxTried = true;
          // OffscreenCanvas：不建 DOM 節點；jsdom 與 Safari 16.4 以前沒有 → 走估算
          try { cellFloorCtx = typeof win.OffscreenCanvas === 'function' ? new win.OffscreenCanvas(1, 1).getContext('2d') : null; } catch (_) { cellFloorCtx = null; }
        }
        if (cellFloorCtx && typeof cellFloorCtx.measureText === 'function') {
          try {
            cellFloorCtx.font = `${cs.fontStyle || 'normal'} ${cs.fontWeight || '400'} ${fs}px ${cs.fontFamily || 'sans-serif'}`;
            const w = cellFloorCtx.measureText(head).width;
            if (w > 0) return w;
          } catch (_) { /* 落到估算 */ }
        }
        let w = 0;
        for (const ch of head) w += CELL_FLOOR_WIDE_CHAR_RE.test(ch) ? fs : fs * 0.55;
        return w;
      };
      const cellFloorEligible = (table) => {
        if (table.getAttribute && table.getAttribute(PLAYER_ATTR) === '1') return null;
        if (table.closest && table.closest('[data-jread-hidden="1"]')) return null;
        const cells = table.querySelectorAll('td, th');
        if (!cells.length || cells.length > CELL_FLOOR_MAX_CELLS) return null;
        return cells;
      };
      const floorCellsOf = (table, cells, win) => {
        // 先量完再寫：寫一格的 min-width 會讓整張表重排，邊量邊寫每格都觸發一次排版。
        // 寫完再量一輪：撐寬的欄會從別的欄挪寬度，原本夠寬的欄可能變成被擠的
        //（ko 維基九欄表：第 3–9 欄撐寬後第 1 欄從 124px 被壓到 16px）。下限只增
        // 不減，最多 CELL_FLOOR_MAX_ROUNDS 輪、沒有新寫入就停。
        const floored = new Set();
        for (let round = 0; round < CELL_FLOOR_MAX_ROUNDS; round++) {
          const writes = [];
          for (const cell of cells) {
            if (floored.has(cell)) continue;
            if (cell.closest('table') !== table) continue;
            if (cell.querySelector('table')) continue;
            if (NS.MATH_RENDER_SEL && cell.querySelector(NS.MATH_RENDER_SEL)) continue;
            const text = (cell.textContent || '').trim();
            if (!text) continue;
            const r = cell.getBoundingClientRect();
            if (!(r.width > 0) || !(r.height > 0)) continue;
            const cs = win.getComputedStyle(cell);
            const fs = parseFloat(cs.fontSize) || 16;
            const insets = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
              + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
            const inner = r.width - insets;
            const cap = fs * CELL_FLOOR_EM;
            const trigger = fs * CELL_FLOOR_TRIGGER_EM;
            if (inner + 1 >= trigger) continue;                 // 一行放得下三個字 → 不看
            let need = 0;
            for (const tok of text.split(/\s+/)) {
              if (!tok) continue;
              const w = Math.min(cellFloorTokenWidth(win, tok, cs, fs), cap);
              if (w > need) need = w;
              if (need >= cap) break;
            }
            if (!(Math.min(need, trigger) > inner + 1)) continue; // 最長字串放得下 → 不是被擠
            writes.push({ cell, px: Math.ceil(need + (cs.boxSizing === 'border-box' ? insets : 0)) });
          }
          for (const w of writes) {
            cellFloorSnap.push({
              el: w.cell,
              table,
              minWidth: w.cell.style.getPropertyValue('min-width'),
              minWidthPriority: w.cell.style.getPropertyPriority('min-width'),
            });
            w.cell.style.setProperty('min-width', w.px + 'px', 'important');
            floored.add(w.cell);
          }
          if (!writes.length) break;
        }
      };
      // 撤掉一張表的格子下限（縮字級後下限的 px 要按新字級重算）
      const unfloorCellsOf = (table) => {
        for (let i = cellFloorSnap.length - 1; i >= 0; i--) {
          const c = cellFloorSnap[i];
          if (!c || c.table !== table) continue;
          if (c.minWidth) c.el.style.setProperty('min-width', c.minWidth, c.minWidthPriority || '');
          else c.el.style.removeProperty('min-width');
          cellFloorSnap.splice(i, 1);
        }
      };
      const passSqueezedCellFloor = () => {
        if (opts.pagedMode) return;
        const win = articleEl.ownerDocument?.defaultView;
        if (!win) return;
        const tables = [];
        for (const table of articleEl.querySelectorAll('table')) {
          const cells = cellFloorEligible(table);
          if (!cells) continue;
          floorCellsOf(table, cells, win);
          fitTableFont(table, win);
          tables.push(table);
        }
        if (!tables.length) return; // 主文沒有表格：不掛計時器
        // v2.5.25：落定後重量縮字級。進場當下畫面是替代字型（比內嵌字型窄約 7%），
        // 字型載完表格會變寬——語料庫 pmc 430 寬：進場量到 522px、縮到 75% 剛好塞進
        // 392px，載完字型又超出 34px，變成字小了還要橫捲；hi 維基譯文五欄表進場
        // 390px 塞得下、載完 397px。時間點與 ARIA 表格同一組（ARIA_CELL_SETTLE_MS＋
        // document.fonts.ready）。
        //   - 縮過的表：整張還原（字級、內距、格子下限）後從頭量、從頭縮——沒有遲滯；
        //     還原與重寫在同一個 task 內，中間不繪製。這次塞不下了就照原字級顯示，
        //     並補上卡內橫捲（進場時它塞得下，passWideContentScroll 沒處理過它）
        //   - 沒縮過的表：只再試一次縮字級（仍塞得下就什麼都不做；塞不下則維持原狀）。
        //     格子下限不重算、橫捲不重掃——落定後才超出的表不新增橫捲是既有裁定
        //    （ja 維基頁尾導覽框、arxiv 公式表，v2.5.17）
        const settleLater = () => {
          if (tableFitSnap.restored) return; // 這一輪 apply 已被 restore
          for (const table of tables) {
            if (!table.isConnected) continue;
            const idx = tableFitSnap.findIndex((f) => f && f.table === table);
            if (idx < 0) { fitTableFont(table, win); continue; }
            const entry = tableFitSnap[idx];
            tableFitSnap.splice(idx, 1);
            unfloorCellsOf(table);
            restoreTableFitEntry(entry);
            floorCellsOf(table, table.querySelectorAll('td, th'), win);
            fitTableFont(table, win);
            if (!table.hasAttribute(TABLE_FIT_ATTR)) wideScrollOne(table, win, articleEl.getBoundingClientRect().right);
          }
        };
        try { win.document.fonts && win.document.fonts.ready && win.document.fonts.ready.then(settleLater, () => {}); } catch (_) { /* 沒有 fonts API */ }
        for (const ms of ARIA_CELL_SETTLE_MS) win.setTimeout(settleLater, ms);
      };

      // v2.5.25：比卡片寬的表格縮字級塞進卡片（Jimmy 2026-11-18 裁定、11-19 確認）。
      // 起因：v2.5.24 的格子下限讓 ko.wikipedia 咖啡九欄表不再一字一行，但表變成約
      // 800px 寬（卡片 608px），右邊三欄要橫捲才看得到。整張表的字縮到約 76% 就塞得進去。
      // 順序（同一張表內）：格子下限（上面）→ 仍比可用寬度寬 → 縮字級、按新字級重算
      // 下限、再量 → 塞得進去就定案；縮到 TABLE_FIT_MIN_SCALE 仍塞不下 → 字級還原成
      // 原本的、下限重算，交給後面的 passWideContentScroll 寫成卡內橫向捲動（字又小
      // 又要橫捲是兩頭落空，所以塞不下就不縮）。
      // 通則（不看站點 / class / 語言）：
      //   - 可用寬度＝卡片的內容右緣（扣掉內距）；表在站方自己的橫捲容器裡時取那個容器的內容右緣
      //    （站方給了橫捲也一樣先試著縮進去）
      //   - 「表寬 ÷ 可用寬度」先估一次：連 75% 都不到就確定塞不下，一個 inline 都不寫
      //    （內距與邊框不跟著字級縮，實際需要的比例只會更小）
      //   - 字級寫在表內每個「自己帶文字」的元素與每個格子上（inline px !important）：
      //     內文字級規則直接命中 td / th / p / li / span，寫在 table 上繼承不下去。
      //     格子的左右內距同比例縮（上下不動）
      //   - 表格自己是橫捲容器時量 scrollWidth 對 clientWidth（見 selfScroll）
      //   - 含公式的表不縮（公式字型另有尺寸，arxiv 公式表維持橫捲）；巢狀表格的外層
      //     與內層都不縮（外層多半是排版用的表）；表內文字佔主文一半以上的不縮
      //    （整篇文章包在 table 裡的老式排版頁，縮了等於整篇字變小）
      //   - 只在捲動模式跑（翻頁模式的寬表 2026-11-18 裁定不處理）
      // 這條驗「比可用寬度寬、縮到 75% 以內塞得進去的表被縮到塞得進去」，不驗縮完之後
      // 字夠不夠大（下限 75% 是裁定值）、也不驗圖片造成的溢出（圖不跟字級縮）
      const TABLE_FIT_MIN_SCALE = 0.75;
      const TABLE_FIT_MAX_ROUNDS = 5;
      const TABLE_FIT_MIN_STEP = 0.04;
      const TABLE_FIT_MAIN_TEXT_RATIO = 0.5;
      let tableFitArticleLen = -1;
      const fitTableFont = (table, win) => {
        if (table.querySelector('table') || (table.parentElement && table.parentElement.closest('table'))) return;
        if (NS.MATH_RENDER_SEL && table.querySelector(NS.MATH_RENDER_SEL)) return;
        // 可用寬度的右緣
        // 卡片的內容右緣（扣掉右內距）：塞進卡片＝與內文右緣對齊，不是伸進內距
        const acs = win.getComputedStyle(articleEl);
        let limit = articleEl.getBoundingClientRect().right
          - (parseFloat(acs.borderRightWidth) || 0) - (parseFloat(acs.paddingRight) || 0);
        for (let cur = table.parentElement; cur && cur !== articleEl.parentElement; cur = cur.parentElement) {
          const ccs = win.getComputedStyle(cur);
          if (ccs.overflowX === 'auto' || ccs.overflowX === 'scroll') {
            const cr = cur.getBoundingClientRect();
            const inner = cr.right - (parseFloat(ccs.borderRightWidth) || 0) - (parseFloat(ccs.paddingRight) || 0);
            if (inner < limit) limit = inner;
            break;
          }
        }
        // 表格自己就是橫捲容器（維基窄螢幕樣式把 table 設成 display: block＋overflow-x: auto）
        // 時，外框永遠不比卡片寬——改量它的內容寬（scrollWidth）對可視寬（clientWidth）
        const tcs = win.getComputedStyle(table);
        const selfScroll = (tcs.overflowX === 'auto' || tcs.overflowX === 'scroll') && table.clientWidth > 0;
        // 回傳 [表需要的寬, 可用的寬]
        const measure = () => {
          if (selfScroll) return [table.scrollWidth, table.clientWidth];
          const r = table.getBoundingClientRect();
          return [r.width, limit - r.left];
        };
        const fits = (m) => !(m[0] > m[1] + 2);
        const m0 = measure();
        if (fits(m0)) return;
        if (!(m0[1] > 0) || !(m0[0] > 0)) return;
        if (m0[1] / m0[0] < TABLE_FIT_MIN_SCALE) return;         // 連 75% 都不到 → 確定塞不下
        if (tableFitArticleLen < 0) tableFitArticleLen = (articleEl.textContent || '').length;
        if ((table.textContent || '').length > tableFitArticleLen * TABLE_FIT_MAIN_TEXT_RATIO) return;
        // 要寫的元素：每個格子（字級＋左右內距）＋表內自己帶文字的元素（字級）。先全讀再全寫
        const targets = [];
        const seen = new Set();
        const add = (el, isCell) => {
          if (seen.has(el)) return;
          seen.add(el);
          const cs = win.getComputedStyle(el);
          const fs = parseFloat(cs.fontSize);
          if (!(fs > 0)) return;
          const t = { el, fs };
          if (isCell) { t.pl = parseFloat(cs.paddingLeft) || 0; t.pr = parseFloat(cs.paddingRight) || 0; }
          targets.push(t);
        };
        for (const el of table.querySelectorAll('td, th')) add(el, true);
        for (const el of table.querySelectorAll('caption')) add(el, false);
        for (const el of table.querySelectorAll('*')) {
          if (seen.has(el)) continue;
          if (el.closest('svg')) continue;
          let own = false;
          for (let n = el.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) { own = true; break; }
          }
          if (own) add(el, false);
        }
        if (!targets.length) return;
        const FIT_PROPS = ['font-size', 'padding-left', 'padding-right'];
        const snaps = [];
        for (const t of targets) {
          for (const prop of (t.pl !== undefined ? FIT_PROPS : ['font-size'])) {
            snaps.push({ el: t.el, prop, value: t.el.style.getPropertyValue(prop), priority: t.el.style.getPropertyPriority(prop) });
          }
        }
        const restoreSnaps = () => {
          for (let i = snaps.length - 1; i >= 0; i--) {
            const a = snaps[i];
            if (a.value) a.el.style.setProperty(a.prop, a.value, a.priority || '');
            else a.el.style.removeProperty(a.prop);
          }
        };
        const px = (n) => (Math.round(n * 100) / 100) + 'px';
        const writeScale = (scale) => {
          for (const t of targets) {
            t.el.style.setProperty('font-size', px(t.fs * scale), 'important');
            // 格子的左右內距跟著縮：九欄表光內距就佔一百多 px，只縮字的話 75% 還塞不進去
            if (t.pl !== undefined) {
              if (t.pl > 0) t.el.style.setProperty('padding-left', px(t.pl * scale), 'important');
              if (t.pr > 0) t.el.style.setProperty('padding-right', px(t.pr * scale), 'important');
            }
          }
        };
        const cells = table.querySelectorAll('td, th');
        let scale = 1, fitted = false;
        for (let round = 0; round < TABLE_FIT_MAX_ROUNDS; round++) {
          const m = measure();
          if (!(m[1] > 0) || !(m[0] > 0)) break;
          let next = scale * (m[1] / m[0]) - 0.01;
          // 第二輪起每輪至少再降 TABLE_FIT_MIN_STEP、最後一輪直接試下限：格子下限會隨
          // 字級重算，照比例估的值常常只差幾 px 沒塞進去（hi 維基譯文五欄表 397 / 392：
          // 0.98 → 0.96 → 0.94… 四輪用完還沒收斂）
          if (round > 0) next = Math.min(next, scale - TABLE_FIT_MIN_STEP);
          if (round === TABLE_FIT_MAX_ROUNDS - 1) next = TABLE_FIT_MIN_SCALE;
          if (next < TABLE_FIT_MIN_SCALE) {
            if (scale <= TABLE_FIT_MIN_SCALE) break;             // 已經在下限、仍塞不下
            next = TABLE_FIT_MIN_SCALE;
          }
          scale = Math.round(next * 100) / 100;
          unfloorCellsOf(table);
          writeScale(scale);
          floorCellsOf(table, cells, win);
          if (fits(measure())) { fitted = true; break; }
        }
        if (!fitted) {
          // 塞不下：字級與內距還原、下限按原字級重算，留給 passWideContentScroll
          unfloorCellsOf(table);
          restoreSnaps();
          floorCellsOf(table, cells, win);
          return;
        }
        table.setAttribute(TABLE_FIT_ATTR, String(scale));
        tableFitSnap.push({ table, snaps });
      };

      // 單一元素的「超出卡片右緣 → 卡內橫捲」（passWideContentScroll 捲動模式的迴圈本體；
      // v2.5.25 抽出：縮字級落定後塞不下的表要補做這一步）
      const wideScrollOne = (el, win, cardRight) => {
        // 翻頁 multicol 下 cardRight 幾何不可靠（v1.6.24）：這個函式只給捲動模式用
        if (opts.pagedMode) return;
        if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        // v2.5.32：<pre> 的盒子被全後代 max-width: 100% 壓在卡內，溢出的是盒子裡的長行
        //（overflow 預設 visible → 長行畫出灰框、再被卡片右緣切掉、捲不到）。只量盒子的
        // 話這一步對 pre 永遠不觸發。站方給了 pre overflow: auto / hidden 的不算（已能捲
        // 或站方刻意裁）。Stack Overflow HTML 快照回放實證（站方樣式表沒載到，等同沒給
        // pre overflow 規則的站）：長行超出卡片右緣 36–632px
        let spills = false;
        if (el.tagName === 'PRE') {
          try {
            const ox = win.getComputedStyle(el).overflowX;
            // 空字串：jsdom 對沒宣告的 overflow 不給初始值（瀏覽器回 'visible'）
            spills = (ox === 'visible' || ox === '') && el.scrollWidth > el.clientWidth + 2;
          } catch (_) { spills = false; }
        }
        if (r.right <= cardRight + 2 && !spills) return; // 沒溢出右緣 → 不動
        // 已被「在卡內、可捲到」的祖先吸收 → 不重複處理
        let absorbed = false, cur = el.parentElement;
        while (cur && cur !== articleEl.parentElement) {
          const ox = win.getComputedStyle(cur).overflowX;
          if ((ox === 'auto' || ox === 'scroll') &&
              cur.getBoundingClientRect().right <= cardRight + 2) { absorbed = true; break; }
          cur = cur.parentElement;
        }
        if (absorbed) return;
        wideScroll.push({
          el,
          display: el.style.getPropertyValue('display'),
          displayPriority: el.style.getPropertyPriority('display'),
          overflowX: el.style.getPropertyValue('overflow-x'),
          overflowXPriority: el.style.getPropertyPriority('overflow-x'),
          maxWidth: el.style.getPropertyValue('max-width'),
          maxWidthPriority: el.style.getPropertyPriority('max-width'),
          minWidth: el.style.getPropertyValue('min-width'),
          minWidthPriority: el.style.getPropertyPriority('min-width'),
        });
        setInlineOwned(el, 'display', 'block', 'important', 'styler:widescroll');
        el.style.setProperty('max-width', '100%', 'important');
        el.style.setProperty('overflow-x', 'auto', 'important');
        // v2.5.18：寫成捲動容器之後仍超出卡片右緣＝被 min-width 撐住（CSS 規定
        // min-width 優先於 max-width；en.wikipedia Taiwan「Largest cities」表站方
        // inline `min-width: 50em`，表自己 850–1000px 寬、內容沒有溢出它自己所以
        // 不出現捲軸，超出卡片的右半邊被卡片 overflow:hidden 切掉、捲不到）。把
        // min-width 歸 0 讓 max-width: 100% 生效。只在「寫完仍超出」時才動——
        // 沒被 min-width 撐住的表一個值都不多寫（19 頁 × 3 條件普查：其他 2,170 個
        // table / pre 逐值不變）。
        // 不做「版面落定後重掃」：ja 東海道新幹線頁尾導覽框是落定後才超出 11px，
        // 重掃會讓它與 arxiv 公式表變成要橫捲（v2.5.17 普查，Jimmy 裁定不動）。
        if (el.getBoundingClientRect().right > cardRight + 2) {
          el.style.setProperty('min-width', '0', 'important');
          releaseFixedHeightText(el, win, wideScroll[wideScroll.length - 1]);
        }
      };

      const passWideContentScroll = () => {
        // v0.8.101：寬語意內容（table / pre）超出 card → 卡內水平捲，不被切掉。
        // 根因（arxiv HTML 全文）：LaTeXML 把展示公式輸出成 <table class="ltx_equation">，
        // 內含不可斷行的數學運算式，intrinsic min-width 撐破卡片版心；styler 既有
        // 全後代 max-width:100%（line 1314）限縮 box 寬卻擋不住內容 min-width，
        // table 仍溢出右緣被 card 的 overflow-x:hidden 切掉——公式右側 + 式號被截、
        // 使用者看不到也捲不到（probe 實測溢出 54-144px）。
        // 通則（非站點特判，符合硬規則 3）：table / pre 是「內容無法 wrap」的語意
        // 載體，渲染寬撐破 card 時改 display:block + overflow-x:auto + max-width:100%
        // 讓它在卡內水平捲（標準 responsive-table pattern）——使用者捲得到 = 視覺
        // 無破版（probe 套後 fitsCard + innerScroll 110-200px）。防誤殺：
        //   - 只處理「實際溢出右緣」的——能正常 wrap 的窄表格 / 文字不命中。
        //   - 排除 player 結構（與 galleryFlex 同原則）。
        //   - 排除已被既有 overflow-x:auto/scroll 祖先（在卡內）吸收的——原站
        //     已給 code block 內捲（rust-book / k8s 的 <pre> overflow-x:auto）就不
        //     重複處理，避免雙重 scroll container。
        // v1.6.24：同上——翻頁 multicol 下 cardRight 幾何不可靠（第 2 欄起的正常
        // table/pre 全被誤判溢出、套上 display:block + overflow-x:auto 造成與第 1
        // 頁排版不一致），gate 在非翻頁模式。
        if (!opts.pagedMode) {
          const win = articleEl.ownerDocument?.defaultView;
          if (win) {
            const cardRight = articleEl.getBoundingClientRect().right;
            for (const el of articleEl.querySelectorAll('table, pre')) wideScrollOne(el, win, cardRight);
          }
        } else {
          // v2.5.19：翻頁模式只做「被站方 min-width 撐住」這一種（Jimmy 2026-11-18 實機：
          // en.wikipedia Taiwan「Largest cities」表捲動模式 OK、翻頁模式仍被切）。
          // 上面那套不能搬過來：multicol 下第 2 欄起 rect.right 天然超過卡片右緣
          //（v1.6.24），而且翻頁模式橫拖一律是翻頁、寫成捲動容器也捲不到。
          // 判定不看卡片右緣，改看「自己比容器的內容寬還寬」——全後代已有
          // max-width: 100%，table / pre 會比容器寬只剩兩種原因：站方 min-width、
          // 或內容本身放不下。只處理前者（computed min-width 比容器內容寬還大）：
          // min-width 歸 0，再放開表內寫死高度的文字容器（同捲動模式第二步）。
          // 寬度按單一欄片段量（跨頁元素的 bounding 寬是各欄片段的聯集）。
          // 內容本身放不下的表不動（縮不進去；翻頁模式下看不到的部分照舊）。
          // 沒被 min-width 撐住的表一個 inline 都不寫。還原只動 min-width（minWidthOnly）。
          const win = articleEl.ownerDocument?.defaultView;
          if (win) {
            const fragW = (node) => {
              let m = 0;
              const rs = typeof node.getClientRects === 'function' ? node.getClientRects() : null;
              if (rs) { for (const fr of rs) { if (fr.width > m) m = fr.width; } }
              return m > 0 ? m : node.getBoundingClientRect().width;
            };
            for (const el of articleEl.querySelectorAll('table, pre')) {
              if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
              const parent = el.parentElement;
              if (!parent) continue;
              const w = fragW(el);
              if (w < 1) continue;
              const pcs = win.getComputedStyle(parent);
              const avail = fragW(parent)
                - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0)
                - (parseFloat(pcs.borderLeftWidth) || 0) - (parseFloat(pcs.borderRightWidth) || 0);
              if (!(avail > 0) || w <= avail + 2) continue;        // 沒比容器寬 → 不動
              const minW = parseFloat(win.getComputedStyle(el).minWidth);
              if (!(minW > avail + 2)) continue;                   // 不是 min-width 撐的 → 不動
              const entry = {
                el,
                minWidthOnly: true,
                minWidth: el.style.getPropertyValue('min-width'),
                minWidthPriority: el.style.getPropertyPriority('min-width'),
              };
              wideScroll.push(entry);
              el.style.setProperty('min-width', '0', 'important');
              releaseFixedHeightText(el, win, entry);
            }
          }
        }
      };

      const passAriaHeaderKeepWithNext = () => {
        // v2.5.13：翻頁模式 ARIA 表格的表頭列不單獨留在頁底。v2.5.12 讓列不可切之後，
        // 表頭列與第一列資料之間沒有「不分開」的約束——GitBook quickstart 390×760
        // 第 2、4 頁底只剩一列表頭、資料整批在下一頁（兩引擎 14 組裡 7 組）。
        // 不用 break-after: avoid：WebKit 的多欄不照做（實測 Chromium 7 組全好、
        // WebKit 一組都沒變）。改用兩引擎都有效的佔位法：表頭那一塊（表頭列；它是
        // rowgroup 的獨生子時取 rowgroup）加 padding-bottom: H、margin-bottom: 原值 − H、
        // break-inside: avoid，H＝下一列的高。這一塊變成「表頭＋H」不可切 → 頁底放不下
        // 「表頭＋下一列」時整塊推到下一頁；padding 與負 margin 相消，下一列的位置不變。
        //   - 只在翻頁模式跑；捲動模式一個 inline 都不寫
        //   - H 超過視窗高的 ARIA_HEADER_KEEP_MAX_VH 就不做：下一列本身就佔大半頁，
        //     硬綁只會讓表頭前留一大片空白
        //   - 表頭那一塊自己有背景 / 邊框時不做（padding 會把背景往下畫到下一列底下）
        if (!opts.pagedMode) return;
        const win = articleEl.ownerDocument?.defaultView;
        if (!win) return;
        const vh = win.innerHeight || 0;
        if (!(vh > 0)) return;
        const snap = (el, prop) => ariaHeaderKeepSnap.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
        // 可重跑：每次先把上一輪寫的 inline 寫回原值再從頭量（進場當下字型還沒落定、
        // 翻頁版面也還沒裝好，量到的下一列高會偏矮——Chromium 390×844 第一張表進場
        // 量到的 H 不夠、表頭仍單獨留在頁底；落定後重量一次就對）
        const measureAndWrite = () => {
        for (let i = ariaHeaderKeepSnap.length - 1; i >= 0; i--) {
          const a = ariaHeaderKeepSnap[i];
          if (a.value) a.el.style.setProperty(a.prop, a.value, a.priority || '');
          else a.el.style.removeProperty(a.prop);
        }
        ariaHeaderKeepSnap.length = 0;
        const done = new Set();
        let seen = 0;
        for (const row of articleEl.querySelectorAll('[role="row"]')) {
          if (!isAriaTableRow(row)) continue;
          if (!row.querySelector(':scope > [role="columnheader"]')) continue;
          seen++;
          if (row.closest && row.closest('[data-jread-hidden="1"]')) continue;
          let box = row;
          const par = row.parentElement;
          if (par && par !== articleEl && par.getAttribute('role') === 'rowgroup' && par.children.length === 1) box = par;
          if (done.has(box)) continue;
          done.add(box);
          // 下一列：這一塊之後、同一張表裡文件順序的第一個 ARIA 列
          const root = row.closest(ARIA_TABLE_ROOT_SEL) || box.parentElement;
          if (!root) continue;
          let next = null;
          for (const r of root.querySelectorAll('[role="row"]')) {
            if (r === row || !isAriaTableRow(r)) continue;
            if (row.compareDocumentPosition(r) & 4 /* FOLLOWING */) { next = r; break; }
          }
          if (!next || next.querySelector(':scope > [role="columnheader"]')) continue;
          const H = next.getBoundingClientRect().height;
          if (!(H > 0) || H > vh * ARIA_HEADER_KEEP_MAX_VH) continue;
          const cs = win.getComputedStyle(box);
          const bg = cs.backgroundColor || '';
          const bgClear = bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg);
          if (!bgClear || (cs.backgroundImage && cs.backgroundImage !== 'none')) continue;
          if ((parseFloat(cs.borderBottomWidth) || 0) > 0) continue;
          const pb = parseFloat(cs.paddingBottom) || 0;
          const mb = parseFloat(cs.marginBottom) || 0;
          snap(box, 'padding-bottom'); snap(box, 'margin-bottom'); snap(box, 'break-inside');
          // 保留量＝下一列高＋兩者之間原有的間距＋2px 進位餘裕（只留 H 時，這一塊剛好
          // 放得下、下一列卻差那段間距放不下——Chromium 390×844 實測差 4px）
          const R = H + Math.max(0, mb) + 2;
          box.style.setProperty('padding-bottom', (pb + R) + 'px', 'important');
          box.style.setProperty('margin-bottom', (mb - R) + 'px', 'important');
          box.style.setProperty('break-inside', 'avoid', 'important');
        }
        return seen;
        };
        if (!measureAndWrite()) return; // 沒有 ARIA 表頭列：不掛計時器
        const settleLater = () => {
          if (ariaHeaderKeepSnap.restored) return; // 這一輪 apply 已被 restore
          measureAndWrite();
        };
        try { win.document.fonts && win.document.fonts.ready && win.document.fonts.ready.then(settleLater, () => {}); } catch (_) { /* 沒有 fonts API */ }
        for (const ms of ARIA_CELL_SETTLE_MS) win.setTimeout(settleLater, ms);
      };

      const passMarkAriaFlowShells = () => {
        // v2.5.12：翻頁模式「ARIA 表格列不跨頁」的外殼標記（CSS 與根因見翻頁區塊
        // ARIA_FLOW_SHELL_ATTR 那條規則的註解）。只在翻頁模式跑：捲動模式沒有分頁、
        // 一個標記都不寫。對每一列（isAriaTableRow）往上走兩段：
        //   1. 列的 parent 到表格根（role=table / grid / treegrid；沒有根就到最外層
        //      rowgroup）、含根——逐層問 ariaFlowShellCollapsible，過的才標
        //   2. 根以上：只在「這一層是 parent 的第一個 in-flow 子」時繼續往上。WebKit
        //      把「不跨頁」做成往下推的位移；元素貼在容器頂端時位移會交給容器、一層
        //      一層往上傳，傳到 flex 容器就被丟掉。真站 probe（quickstart 第二張表，
        //      WebKit 390×700）：表格根塌成 block 後資料列全部不切，但表頭列（整張表
        //      的第一列）剛好落在頁底時照切——表格是上一層直向 flex 外殼的第一個子；
        //      把那層也塌掉，頁底前 0–700px 每 4px 掃一輪都不再切。前面有 in-flow
        //      兄弟的那一層＝位移有 block 容器接手，到此為止、不再往上標
        // 主文容器本身不標。
        // 排在 passDecolumn 之後（它會改列的 display）、passAriaNarrowCellInsets 之前
        //（那條量格寬，要看到塌完的版面；外殼塌成 block 不改格寬，順序只是保險）。
        // 這條驗「外殼是不是塌了版面不變的 flex」、不驗塌完之後列有沒有真的不跨頁
        //（歸 webkit-paged-probe 兩引擎量每列碎片數）
        if (!opts.pagedMode) return;
        const win = articleEl.ownerDocument?.defaultView;
        if (!win) return;
        const inFlowKids = (n) => {
          const kids = [];
          for (const ch of n.children) {
            if (ch.getAttribute('data-jread-hidden') === '1') continue;
            const ccs = win.getComputedStyle(ch);
            if (ccs.display === 'none' || ccs.position === 'absolute' || ccs.position === 'fixed') continue;
            kids.push(ch);
          }
          return kids;
        };
        const seen = new Set();
        const consider = (n) => {
          if (seen.has(n)) return;
          seen.add(n);
          const cs = win.getComputedStyle(n);
          if (ariaFlowShellCollapsible({
            display: cs.display,
            flexDirection: cs.flexDirection,
            flexWrap: cs.flexWrap,
            alignItems: cs.alignItems,
            rowGap: cs.rowGap,
            inFlowChildren: inFlowKids(n).length
          })) {
            n.setAttribute(ARIA_FLOW_SHELL_ATTR, '1');
            ariaFlowShellMarked.push(n);
          }
        };
        const aboveDone = new Set();
        for (const row of articleEl.querySelectorAll('[role="row"]')) {
          if (!isAriaTableRow(row)) continue;
          if (row.closest && row.closest('[data-jread-hidden="1"]')) continue;
          let root = row.closest(ARIA_TABLE_ROOT_SEL);
          if (!root) {
            for (let g = row.parentElement.closest(ARIA_TABLE_SEL); g; g = g.parentElement && g.parentElement.closest(ARIA_TABLE_SEL)) root = g;
          }
          if (!root || root === articleEl || !articleEl.contains(root)) continue;
          for (let n = row.parentElement; n && n !== articleEl && n.nodeType === 1; n = n.parentElement) {
            consider(n);
            if (n === root) break;
          }
          if (aboveDone.has(root)) continue;
          aboveDone.add(root);
          for (let n = root; n.parentElement && n.parentElement !== articleEl && articleEl.contains(n.parentElement); n = n.parentElement) {
            const parent = n.parentElement;
            if (inFlowKids(parent)[0] !== n) break;
            consider(parent);
          }
        }
      };

      const passAriaNarrowCellInsets = () => {
        // v2.5.10：ARIA 排的 div 表格（isAriaTableRow）在窄卡片下，格子內容撐出格子。
        // 根因（docs.gitbook.com blocks/table 四欄表，390 / 430 寬實測）：v2.5.9 起
        // 格子保留站方左右各 12px 內距（不保留表頭會黏字），四欄等分後每格 89.5 /
        // 98px、內容區只剩 65 / 74px；狀態標籤「In progress」是站方 white-space:pre
        // 的膠囊（字寬 80＋自己的內距 16＝96px）、不能換行，超出格子 19 / 10px
        //（WebKit 16 / 7px），390 寬直接壓到隔壁 email 上。
        // 通則（不看站點 / class）：以「整張表」為單位，只要有一格內容撐出格子
        //（scrollWidth > clientWidth）就——
        //   1. 整張表每一格的左右內距收到 ARIA_CELL_NARROW_PAD_PX（原本更小的不動）。
        //      整張表一起收，表頭與資料列的文字左緣才對得齊
        //   2. 收完還伸進右側內距的「不可換行」元素（white-space: nowrap / pre），
        //      放行成可換行（nowrap → normal、pre → pre-wrap，後者保留空白與
        //      換行字元；只在空白處換、不從單字中間斷）；程式碼 / 鍵盤輸入 / 表單類（ARIA_CELL_KEEP_NOWRAP_SEL）不動
        //   3. v2.5.11：收窄過的表，一般文字格也只在空白處換行（overflow-wrap /
        //      word-break 回 normal）——放不下的單字稍微伸進內距、不從單字中間斷。
        //      Jimmy 實機（iPhone Safari、襯線字）表頭「Company」被斷成「Compan / y」：
        //      第 2 步只管不可換行元素，表頭格只有一個文字節點，站方 <main> 的
        //      overflow-wrap:anywhere 一路繼承下來照斷（Source Serif 17px「Company」
        //      77.2px、390 寬內容區 77.5px 只差 0.3px；375 寬 / 字重 600 / 字級 18
        //      兩個引擎都重現）。以「格」為單位試寫、寫完再量：單字長到伸出格子
        //      外緣（scrollWidth > clientWidth——email「rena@ace.ai」97px 對 89.5px
        //      的格子）的那一格整格退回站方的斷法，寧可從中間斷也不壓到隔壁格
        //      量不能只在 apply 當下量一次（當下是 fallback 字型＋站方 transition 途中，
        //      見 settleLater 的註解），字型載完與兩個固定時間點各重量一次
        // 順序不可反：先放行換行、內距不收的話，390 寬內容區 65px 比「progress」的
        // 膠囊（74px）還窄，站方 overflow-wrap:anywhere 會把單字從中間斷開。
        // 沒有任何一格撐出去的表（quickstart 兩欄表四種寬度實測全部 0）整段不進、
        // 一個 inline 都不寫。量的是格子自己的 scrollWidth / clientWidth、不看卡片
        // 右緣，翻頁 multicol 下同樣成立（passWideContentScroll 的幾何問題不適用）。
        // 這條驗「內容撐出格子」、不驗「撐進內距但沒出格子」（文字仍離隔壁 ≥ 12px）
        const win = articleEl.ownerDocument?.defaultView;
        if (!win) return;
        const overflows = (c) => (c.scrollWidth || 0) > (c.clientWidth || 0) + 1;
        // 會從單字中間斷的 computed 值（overflow-wrap: anywhere / break-word、
        // word-break: break-all / break-word）
        const breaksInsideWord = (cs) => {
          const ow = cs.overflowWrap || cs.getPropertyValue('overflow-wrap');
          const wb = cs.wordBreak || cs.getPropertyValue('word-break');
          return ow === 'anywhere' || ow === 'break-word' || wb === 'break-all' || wb === 'break-word';
        };
        // v2.5.12：整段包成 measureAndWrite()、可重跑——每次先把這個 pass 上一輪寫的
        // inline 全部寫回原值，再從頭量、從頭寫（三步都是）。v2.5.11 只有第 3 步會
        // 重量，第 1、2 步仍只在 apply 當下量一次：當下畫面是 fallback 字型（比內嵌
        // 字型窄約 7%）＋站方 transition 途中，docs.gitbook.com 四欄表 460–480 寬
        // 實測膠囊「In progress」落定後超出格子 2–7px，但進場當下沒超出 → 整張表
        // 沒被收窄、膠囊一路伸進隔壁格。先寫回再量＝沒有遲滯（收窄後不再溢出，
        // 不寫回的話下一輪會誤判成「不用收」）；寫回與重寫在同一個 task 內、中間不繪製
        const restoreOwnWrites = () => {
          for (let i = ariaCellSnap.length - 1; i >= 0; i--) {
            const a = ariaCellSnap[i];
            if (!a || !a.el) continue;
            if (a.value) a.el.style.setProperty(a.prop, a.value, a.priority || '');
            else a.el.style.removeProperty(a.prop);
          }
          ariaCellSnap.length = 0;
        };
        const measureAndWrite = () => {
        restoreOwnWrites();
        const wordWrapCells = [];
        const tables = new Map();
        for (const row of articleEl.querySelectorAll('[role="row"]')) {
          if (!isAriaTableRow(row)) continue;
          if (row.closest && row.closest('[data-jread-hidden="1"]')) continue;
          const owner = row.closest(ARIA_TABLE_ROOT_SEL) || row.parentElement.closest(ARIA_TABLE_SEL);
          if (!owner) continue;
          let cells = tables.get(owner);
          if (!cells) { cells = []; tables.set(owner, cells); }
          for (const c of row.children) {
            if (ARIA_CELL_ROLES.indexOf(c.getAttribute('role')) === -1) continue;
            if (c.getAttribute('data-jread-hidden') === '1') continue;
            cells.push(c);
          }
        }
        const snapProp = (el, prop) => {
          ariaCellSnap.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
        };
        for (const cells of tables.values()) {
          if (!cells.some(overflows)) continue;
          // 先讀後寫（一張表一次 reflow）
          const narrow = [];
          for (const c of cells) {
            const cs = win.getComputedStyle(c);
            for (const prop of ['padding-left', 'padding-right']) {
              if ((parseFloat(cs.getPropertyValue(prop)) || 0) > ARIA_CELL_NARROW_PAD_PX + 0.5) narrow.push([c, prop]);
            }
          }
          for (const [c, prop] of narrow) {
            snapProp(c, prop);
            c.style.setProperty(prop, ARIA_CELL_NARROW_PAD_PX + 'px', 'important');
          }
          // 第 2 步的判定比第 1 步嚴：看的是「伸進右側內距」（元素右緣超過格子內容區
          // 右緣），不是「撐出格子」——WebKit 430 寬實測收完內距後膠囊只超出格子
          // 1.1px（scrollWidth 差 1、過不了第 1 步的門檻），但與隔壁文字只剩 4.9px
          const unwrap = [];
          for (const c of cells) {
            const cr = c.getBoundingClientRect();
            if (!(cr.width > 0)) continue;
            const contentRight = cr.right - (parseFloat(win.getComputedStyle(c).paddingRight) || 0);
            for (const d of c.querySelectorAll('*')) {
              if (d.closest(ARIA_CELL_KEEP_NOWRAP_SEL)) continue;
              const ws = win.getComputedStyle(d).whiteSpace;
              if (ws !== 'nowrap' && ws !== 'pre') continue;
              // 元素右緣＋它自己被文字撐出去的量：GitBook 的膠囊是 flex 子項，盒子被
              // 壓成內容區寬（65px）、文字從盒子裡溢出，只看盒子右緣量不到
              const inkRight = d.getBoundingClientRect().right + Math.max(0, (d.scrollWidth || 0) - (d.clientWidth || 0));
              if (!(inkRight > contentRight + 0.5)) continue;
              unwrap.push([d, ws === 'pre' ? 'pre-wrap' : 'normal']);
            }
          }
          // 放行換行的同時把「單字中間可斷」關掉（overflow-wrap / word-break 回 normal）：
          // 只在空白處換行。不關的話 Chromium 390 寬實測「progress」被斷成
          //「progres / s」（膠囊文字區 61.5px 比單字窄 1px 左右，站方 overflow-wrap:
          // anywhere 就從字中間斷）；關掉後單字完整、頂多伸進內距幾 px
          for (const [d, value] of unwrap) {
            for (const [prop, v] of [['white-space', value], ['overflow-wrap', 'normal'], ['word-break', 'normal']]) {
              snapProp(d, prop);
              d.style.setProperty(prop, v, 'important');
            }
          }
          // 第 3 步（v2.5.11）：一般文字格只在空白處換行。先找出要寫的元素——格子自己
          //（站方多半是從祖先繼承下來的，寫格子就蓋掉整格）＋另有自己宣告的後代
          for (const c of cells) {
            if (c.closest(ARIA_CELL_KEEP_NOWRAP_SEL)) continue;
            const recs = [];
            const els = [c];
            for (const d of c.querySelectorAll('*')) els.push(d);
            for (const el of els) {
              if (el !== c && el.closest(ARIA_CELL_KEEP_NOWRAP_SEL)) continue;
              // 已經寫過的祖先會讓繼承來的後代算出 normal，自然跳過
              if (!breaksInsideWord(win.getComputedStyle(el))) continue;
              for (const prop of ARIA_CELL_WORD_WRAP_PROPS) {
                const rec = { el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) };
                recs.push(rec);
                ariaCellSnap.push(rec);
                el.style.setProperty(prop, 'normal', 'important');
              }
            }
            if (recs.length) wordWrapCells.push({ c, recs, cells });
          }
        }
        // v2.5.13：表頭格的單字比整格還寬時，整列表頭一起縮字級到放得下，再決定要不要
        // 退回。Jimmy 實機（iPhone Air 420 寬、字級 20、襯線）：「Company」91px、格子扣掉
        // 左內距只剩 90px → 伸出格子 → 下面那段把它退回站方斷法 →「Compan / y」；v2.5.12
        // 表頭留站方字重 500 後，402 寬＋字級 19 也從放得下變成放不下。表頭是整欄的標籤，
        // 從中間斷比小一點難看得多；站方表頭本來就比內文小（GitBook 14 對 16）。
        //   - 只看 role=columnheader 的格子；資料格（email 這類長字串）照舊退回
        //   - 以「表」為單位取最緊的那一格算比例，同一張表所有表頭格寫同一個字級
        //     （四個表頭同大）；半 px 為一階、往下取
        //   - 比例低於 ARIA_HEADER_FIT_MIN_RATIO 就整個不縮（字太小不如斷行），照舊退回
        // 量法：溢出時 scrollWidth＝左內距＋最寬那個字，可用寬＝clientWidth − 左內距
        // （字可以伸進右內距、不可出格子外緣，與上面第 3 步同一條線）
        {
          const headerFit = new Map();
          for (const w of wordWrapCells) {
            if (w.c.getAttribute('role') !== 'columnheader') continue;
            const sw = w.c.scrollWidth || 0;
            const cw = w.c.clientWidth || 0;
            if (!(sw > cw)) continue;
            const padL = parseFloat(win.getComputedStyle(w.c).paddingLeft) || 0;
            const need = sw - padL;
            const avail = cw - padL;
            if (!(need > 0) || !(avail > 0)) continue;
            const ratio = avail / need;
            const prev = headerFit.get(w.cells);
            if (prev === undefined || ratio < prev) headerFit.set(w.cells, ratio);
          }
          for (const [cells, ratio] of headerFit) {
            const headers = cells.filter((c) => c.getAttribute('role') === 'columnheader');
            if (!headers.length) continue;
            const cur = parseFloat(win.getComputedStyle(headers[0]).fontSize) || 0;
            if (!(cur > 0)) continue;
            // 0.985：留一點餘裕給次像素進位（剛好等寬時 scrollWidth 仍可能多 1）
            const next = Math.floor(cur * ratio * 0.985 * 2) / 2;
            if (!(next < cur) || next < cur * ARIA_HEADER_FIT_MIN_RATIO) continue;
            for (const h of headers) {
              const els = [h];
              for (const d of h.querySelectorAll('*')) { if (!d.closest(ARIA_CELL_KEEP_NOWRAP_SEL)) els.push(d); }
              for (const el of els) {
                snapProp(el, 'font-size');
                el.style.setProperty('font-size', next + 'px', 'important');
              }
            }
          }
        }
        // 寫 → 量 → 伸出格子外緣的那一格整格退回站方的斷法（退回的紀錄留在
        // ariaCellSnap 裡無妨——值已經是原值，還原時再寫一次原值）。下一輪重跑會
        // 從頭再試寫一次（字寬變了可能就放得下）
        const out = wordWrapCells.filter((w) => (w.c.scrollWidth || 0) > (w.c.clientWidth || 0));
        for (const w of out) {
          for (let i = w.recs.length - 1; i >= 0; i--) {
            const a = w.recs[i];
            if (a.value) a.el.style.setProperty(a.prop, a.value, a.priority || '');
            else a.el.style.removeProperty(a.prop);
          }
        }
        return tables.size;
        };
        // 主文裡沒有任何 ARIA 表格列：不掛計時器、之後也不重量
        if (!measureAndWrite()) return;
        // apply 當下量到的不是最終字寬（真站實測兩個來源）：(a) JRead 選到的內嵌字型
        // 這一刻才剛注入 @font-face、還在載入，畫面是 fallback 字型（Georgia 比
        // Source Serif 窄約 7%）；(b) 站方連結帶 transition: all 100ms，字級還停在
        // 站方的 14px、沒走到 JRead 的 17px。兩者都讓 email 在 apply 當下「放得下」、
        // 落定後伸出格子 14–20px 壓到隔壁。所以字型載完、以及固定兩個時間點各整段
        // 重跑一次（v2.5.12 起含第 1、2 步）；退出閱讀模式後（ARTICLE_ATTR 已拿掉）不再動
        // ariaCellSnap.restored：這一輪 apply 已被 restore（退出，或改設定時的 restore →
        // 重新 apply）。重新 apply 後 ARTICLE_ATTR 又是 1，只看屬性擋不住上一輪留下的
        // 計時器——它手上的格子清單與原值是上一輪的，再寫會與新一輪的還原紀錄打架
        const settleLater = () => {
          if (ariaCellSnap.restored) return;
          if (articleEl.getAttribute(ARTICLE_ATTR) !== '1') return;
          measureAndWrite();
        };
        const fontSet = articleEl.ownerDocument.fonts;
        if (fontSet && fontSet.ready && typeof fontSet.ready.then === 'function') fontSet.ready.then(settleLater, () => {});
        for (const ms of ARIA_CELL_SETTLE_MS) win.setTimeout(settleLater, ms);
      };

      const passPangu = () => {
        // Pangu spacing：CJK ↔ 英數字之間自動補空白。設定預設 true，使用者可
        // 到 options 取消。一次性掃完整 articleEl + 起 MutationObserver 接後續
        // 動態注入內容（SPA / lazy-load 留言、推薦、晚到段落等）。
        const panguEnabled = s.pangu !== false;
        panguSnap = panguEnabled ? panguInstall(articleEl) : null;
      };

      // ─── T12：pass 執行順序（單一資料源）──────────────────────────
      // 順序即依賴：各 pass 開頭註解記載「必須在 X 之前/之後」的理由；
      // 關鍵配對由 test/regression/styler-apply-pass-order.spec.js forcing。
      // 2026-10-07 review B-08：passFirstInkTopMargin / passVisibleEdgeChildMarks 必須
      // 在 passBylineKicker 之後——kicker（標題前的分類短連結）與 byline 內的閱讀時間
      // / 時刻 / 節目 chip 都是 CSS 隱藏的標記，先跑會把 margin-top:0 寫在 kicker
      // 上、EDGE_FIRST 標在 kicker wrapper 上，真正的第一個可見元素 h1 留著站方
      // margin-top（NPR probe 實證：標題頂距 32px vs 對照組 0px）。順序配對由
      // styler-apply-pass-order.spec.js 的 ORDER_PAIRS 守門；陣列內不可放註解
      //（spec 以逗號切成員）。
      const APPLY_PASSES = [
        passContrastProbePhase1,
        passMarkPseudoHeadings,
        passSplitPreWrapParas,
        passInjectCss,
        passClassifyImages,
        passMarkTextDivs,
        passMarkIconPadLinks,
        passMarkRatioClassBoxes,
        passSetArticleAttr,
        passMarkPlayers,
        passReattachDetachedCaptions,
        passMarkEmbedHeadingAbsAnchors,
        passMarkFillIframes,
        passMarkAncestors,
        passHtmlClassThemeMeta,
        passMarkFirstLetterColor,
        passMarkSelectionBg,
        passContrastGuardPhase2,
        passBlockquoteSummaryContrast,
        passShadowHostSchemeFit,
        passTableSiteBgContrast,
        passDarkSepiaContrastPhase3,
        passCodeBlockBgPhase4,
        passCodeWhitespaceDecoration,
        passInstallListeners,
        passHeadingPseudoSpacerReset,
        passBylineKicker,
        passFirstInkTopMargin,
        passVisibleEdgeChildMarks,
        passBlockquoteMarks,
        passCjkDecorInlineFlowMarks,
        passAncestorPaddingStrip,
        passNegMarginStrip,
        passFigurePaddingStrip,
        passZeroHorizInsets,
        passCaptionFontFloor,
        passCaptionAlignReset,
        passTitleFontOverride,
        passHeroTitleFloor,
        passPseudoHeadingSize,
        passTitleOwnLineAndDek,
        passSubheadingBelowTitle,
        passHeadingLineHeightFloor,
        passGalleryFlex,
        passAbsFillShellFlow,
        passRatioBoxReset,
        passFixedHeightReset,
        passDecolumn,
        passAspectPseudoReset,
        passMinHeightReset,
        passWpConstrainedMaxWidth,
        passMarkAriaFlowShells,
        passAriaHeaderKeepWithNext,
        passAriaNarrowCellInsets,
        passSqueezedCellFloor,
        passWideContentScroll,
        passPangu,
      ];
      try {
        for (const p of APPLY_PASSES) p();
        return snapshotNow();
      } catch (err) {
        // v1.6.27:apply 中途 throw → 半套 DOM 副作用（已注入 stylesheet /
        // 已標 attr / 已寫 inline style）以部分快照自我還原後再拋，上層
        // main.js catch 走 exitReaderModeImpl 接手 cleaner 側。還原自身再
        // 失敗只留 console 訊號，原始錯誤照拋（對 caller 語意不變）。
        try { styler.restore(articleEl, snapshotNow()); } catch (restoreErr) {
          try { console.warn('[JRead] styler.apply 半套還原失敗:', restoreErr); } catch (_) { /* noop */ }
        }
        throw err;
      }
    },

    /**
     * 還原 apply() 所做的所有變更。
     * @param {Element} _articleEl 相容舊 API，實際從 snapshot 讀
     * @param {object} snapshot apply() 的回傳值
     */
    restore(_articleEl, snapshot) {
      if (!snapshot) return;
      // Pangu spacing 還原：停 MutationObserver、把改過的 text node 還回原值。
      // 2026-10-07 review B-03：必須排在**所有 DOM 搬動之前**（原本在 restorePreWrap
      // 之後）——restorePreWrapParagraphs 把段落載體 unwrap 後 `normalize()` 會把相鄰
      // text node 合併：第一個節點的 nodeValue 變成串接字串（≠ panguize(original)、
      // 比對失敗不還原）、其餘節點 detached；加上 pangu observer 還活著、搬動中的
      // 節點被再 panguize 一次。結果 X / Threads 這類 pre-wrap 貼文退出閱讀模式後
      // 盤古空白與全形標點永久留在原頁（Chromium probe 實證）。panguRestore 只看
      // snapshot.changes、不依賴任何 reader attr，放最前面零副作用。
      if (snapshot.panguSnap) {
        panguRestore(snapshot.panguSnap);
      }
      if (typeof NS.resetPseudoMemo === 'function') NS.resetPseudoMemo(); // B-02：快取隨 apply 生命週期清掉
      // v0.8.130：清 marker <style> + 可能的 adopted sheet（CSP fallback 對稱還原）
      NS.removeCssText(STYLE_ID);
      NS.removeCssText(PSEUDO_SHAPE_STYLE_ID); // v2.5.24
      NS.removeCssText(CAPTION_STYLE_ID); // v2.5.24

      // v0.7.90：移除 scroll listener、清 timer 與 scrolling attr，避免閱讀
      // 模式關閉後仍在 html 留下 [data-jread-scrolling] / 殘留 timer 觸發 attr 設定。
      window.removeEventListener('scroll', onScrollFlash, { passive: true });
      if (scrollHideTimer) {
        clearTimeout(scrollHideTimer);
        scrollHideTimer = null;
      }
      document.documentElement.removeAttribute(SCROLLING_ATTR);

      // 閱讀進度條清除
      window.removeEventListener('scroll', onScrollProgress, { passive: true });
      if (progressEl) { progressEl.remove(); progressEl = null; }

      // v0.7.91：移除 SPACE keydown listener（避免關閉 reader mode 後 SPACE
      // 仍被 jread 攔截）。capture phase listener 第三個參數須為 true 才能正確 dedup。
      window.removeEventListener('keydown', onSpaceScroll, true);

      if (Array.isArray(snapshot.inlineImgs)) {
        for (const img of snapshot.inlineImgs) {
          if (img && img.removeAttribute) img.removeAttribute(INLINE_IMG_ATTR);
        }
      }
      // v0.8.98：還原 viewBox-only SVG emoji 的 inline width/height 釘寬
      if (Array.isArray(snapshot.inlineImgPins)) {
        for (const s of snapshot.inlineImgPins) {
          if (!s || !s.img || !s.img.style) continue;
          if (s.prevW) s.img.style.setProperty('width', s.prevW, s.prevWP || '');
          else s.img.style.removeProperty('width');
          if (s.prevH) s.img.style.setProperty('height', s.prevH, s.prevHP || '');
          else s.img.style.removeProperty('height');
        }
      }
      if (Array.isArray(snapshot.contentImgs)) {
        for (const img of snapshot.contentImgs) {
          if (img && img.removeAttribute) img.removeAttribute(CONTENT_IMG_ATTR);
        }
      }
      // v0.8.112：移除 bare 內容圖放大標記（CSS-only、無 inline style，移 attr 即還原）
      if (Array.isArray(snapshot.upscaleImgs)) {
        for (const img of snapshot.upscaleImgs) {
          if (img && img.removeAttribute) img.removeAttribute(UPSCALE_IMG_ATTR);
          // v2.5.27：連同「不超過原尺寸」的上限一起拿掉
          if (img && img.style) img.style.removeProperty('--jread-upscale-max');
        }
      }
      // v0.8.90：還原 icon 圖的 inline max-width 釘寬 + 移除標記
      if (Array.isArray(snapshot.iconImgs)) {
        for (const s of snapshot.iconImgs) {
          if (!s || !s.img) continue;
          if (s.prevMw) s.img.style.setProperty('max-width', s.prevMw, s.prevMwP || '');
          else s.img.style.removeProperty('max-width');
          // v1.8.5：第二 / 第三通道（custom property + 釘寬）同步還原
          if (s.prevVar) s.img.style.setProperty('--jread-icon-max', s.prevVar);
          else s.img.style.removeProperty('--jread-icon-max');
          if (s.prevW) s.img.style.setProperty('width', s.prevW, s.prevWP || '');
          else s.img.style.removeProperty('width');
          if (s.img.removeAttribute) { s.img.removeAttribute(ICON_IMG_ATTR); s.img.removeAttribute(COVERED_PH_ATTR); }
        }
      }
      // 移除尚未觸發的 lazy-load content-img 標記 listener（避免退出後圖載入仍
      // 在已 detach 的節點上補標 / listener 洩漏）
      if (Array.isArray(snapshot.contentImgLoadCleanup)) {
        for (const { img, onLoad } of snapshot.contentImgLoadCleanup) {
          if (img && img.removeEventListener) img.removeEventListener('load', onLoad);
        }
      }
      if (Array.isArray(snapshot.playerMarked)) {
        for (const el of snapshot.playerMarked) {
          if (el && el.removeAttribute) el.removeAttribute(PLAYER_ATTR);
        }
      }
      // v1.9.15：行內高亮 / 站方浮動工具列標記（apply 與動態補標共用同一陣列）
      if (Array.isArray(snapshot.siteUiMarked)) {
        for (const el of snapshot.siteUiMarked) {
          if (!el || !el.removeAttribute) continue;
          el.removeAttribute(SITE_UI_ATTR);
          el.removeAttribute(PLAYER_ATTR);
          el.removeAttribute(FACADE_FRAME_ATTR); // v2.5.19：佔位殼的翻頁不跨頁標記
        }
      }
      // v2.4.9：drop cap 首字色修正標記（apply 與動態補標共用同一陣列）
      if (Array.isArray(snapshot.firstLetterMarked)) {
        for (const el of snapshot.firstLetterMarked) {
          if (el && el.removeAttribute) {
            el.removeAttribute(FIRST_LETTER_ATTR);
            el.removeAttribute(DROP_CAP_ATTR);  // v2.5.24
            el.removeAttribute(DROP_CAP_FRAME_ATTR); // v3.7.7
            el.removeAttribute(FIRST_LINE_ATTR); // v2.5.24
          }
        }
      }
      // v2.4.10：站方選取底色不透明標記
      if (snapshot.selBgMarked && document.documentElement) {
        document.documentElement.removeAttribute(SEL_BG_ATTR);
      }
      // v0.8.86：移除 responsive embed iframe fill 標記
      if (Array.isArray(snapshot.fillIframes)) {
        for (const ifr of snapshot.fillIframes) {
          if (ifr && ifr.removeAttribute) ifr.removeAttribute(FILL_IFRAME_ATTR);
        }
      }
      // v1.6.30（#13）：移除 embed-wrap / heading-link 標記 + 關閉動態補標
      activeMarkState = null;
      if (Array.isArray(snapshot.embedWrapMarked)) {
        for (const el of snapshot.embedWrapMarked) {
          if (el && el.removeAttribute) el.removeAttribute(EMBED_WRAP_ATTR);
        }
      }
      // 2026-10-07 review B-01：移除 class ratio token 標記
      if (Array.isArray(snapshot.ratioClassMarked)) {
        for (const el of snapshot.ratioClassMarked) {
          if (el && el.removeAttribute) el.removeAttribute(RATIO_CLASS_ATTR);
        }
      }
      if (Array.isArray(snapshot.headingLinkMarked)) {
        for (const el of snapshot.headingLinkMarked) {
          if (el && el.removeAttribute) el.removeAttribute(HEADING_LINK_ATTR);
        }
      }
      // v1.8.2：移除 lazy embed 縮圖填滿 / ::before aspect 佔位標記
      if (Array.isArray(snapshot.embedFillMarked)) {
        for (const el of snapshot.embedFillMarked) {
          if (!el || !el.removeAttribute) continue;
          el.removeAttribute(EMBED_FILL_ATTR);
          el.removeAttribute(EMBED_FLOW_ATTR);
        }
      }
      if (Array.isArray(snapshot.aspectPseudoMarked)) {
        for (const el of snapshot.aspectPseudoMarked) {
          if (el && el.removeAttribute) el.removeAttribute(ASPECT_PSEUDO_ATTR);
          if (el && el.removeAttribute) el.removeAttribute(ICON_PSEUDO_ATTR); // v3.7.4
        }
      }
      // v1.7.45：移除 absolute 錨定豁免標記
      if (Array.isArray(snapshot.absAnchorMarked)) {
        for (const el of snapshot.absAnchorMarked) {
          if (el && el.removeAttribute) el.removeAttribute(ABS_ANCHOR_ATTR);
        }
      }
      if (Array.isArray(snapshot.preFlexStretchMarked)) {
        for (const el of snapshot.preFlexStretchMarked) {
          if (el && el.removeAttribute) el.removeAttribute(PRE_FLEX_STRETCH_ATTR);
        }
      }
      if (Array.isArray(snapshot.defloatTextMarked)) {
        for (const el of snapshot.defloatTextMarked) {
          if (!el || !el.removeAttribute) continue;
          el.removeAttribute(DEFLOAT_TEXT_ATTR);
          el.removeAttribute(KEEP_FLOAT_ATTR);
          el.removeAttribute(FLOAT_BLOCK_ATTR);
          el.removeAttribute(LIST_INDENT_ATTR); // v3.7.7
          el.removeAttribute(UI_HINT_PSEUDO_ATTR); // v3.7.7
        }
      }
      if (Array.isArray(snapshot.capMediaMarked)) {
        for (const el of snapshot.capMediaMarked) {
          if (!el || !el.removeAttribute) continue;
          el.removeAttribute(CAP_MEDIA_ATTR);
          el.removeAttribute(CAP_BELOW_ATTR);
          el.removeAttribute(CAP_DIV_ATTR);
          if (el.hasAttribute && el.hasAttribute(CAP_MEDIA_PAD_ATTR)) {
            el.removeAttribute(CAP_MEDIA_PAD_ATTR);
            if (!releaseInlineOwned(el, 'padding-bottom', 'styler:cap-media-pad')) {
              const pv = capPadPrev && capPadPrev.get(el);
              if (pv && pv.v) el.style.setProperty('padding-bottom', pv.v, pv.p || '');
              else el.style.removeProperty('padding-bottom');
            }
          }
          el.removeAttribute(CODE_FLEX_FILL_ATTR);
        }
      }
      if (Array.isArray(snapshot.shadowHostMarked)) {
        for (const el of snapshot.shadowHostMarked) {
          if (el && el.removeAttribute) el.removeAttribute(SHADOW_HOST_ATTR);
        }
      }
      // v0.8.49：移除「div 當段落」標記
      if (Array.isArray(snapshot.textDivMarked)) {
        for (const el of snapshot.textDivMarked) {
          if (el && el.removeAttribute) el.removeAttribute(TEXT_DIV_ATTR);
          if (el && el.removeAttribute) el.removeAttribute(SMALL_TEXT_DIV_ATTR);
        }
      }
      // v1.7.70：pre-wrap 切出的段落載體合併回原容器（換行字元一併補回）。
      // 排在 textDivMarked 移除之後——那些載體多半也被標了 TEXT_DIV_ATTR，
      // 先讓標記還原跑完再把節點搬回去、移除空殼。
      restorePreWrapParagraphs(snapshot.prewrapParaSnap);
      // v2.5.21：移除左到右覆寫
      if (dirOverrideTimer) { clearTimeout(dirOverrideTimer); dirOverrideTimer = null; }
      document.documentElement.removeAttribute(DIR_LTR_ATTR);
      // v1.6.12：移除 CJK 段落兩端對齊標記
      if (Array.isArray(snapshot.cjkJustifyMarked)) {
        for (const el of snapshot.cjkJustifyMarked) {
          if (el && el.removeAttribute) el.removeAttribute(CJK_JUSTIFY_ATTR);
        }
      }
      // v1.7.8：移除 inline-flow p 標記
      if (Array.isArray(snapshot.inlineFlowPMarked)) {
        for (const el of snapshot.inlineFlowPMarked) {
          if (el && el.removeAttribute) el.removeAttribute(INLINE_FLOW_P_ATTR);
        }
      }
      // v2.5.34：移除連結圖示留位標記
      if (Array.isArray(snapshot.iconPadMarked)) {
        for (const el of snapshot.iconPadMarked) {
          if (el && el.removeAttribute) el.removeAttribute(ICON_PAD_ATTR);
          if (el && el.removeAttribute) el.removeAttribute(ICON_PSEUDO_ATTR); // v3.7.9
          if (el && el.removeAttribute) el.removeAttribute(BG_ICON_EL_ATTR); // v3.7.11
          if (el && el.removeAttribute) el.removeAttribute(CAP_ASYM_ATTR); // v3.7.13
        }
      }
      // v2.5.30：移除段首首字行內載體標記
      if (Array.isArray(snapshot.leadLetterMarked)) {
        for (const el of snapshot.leadLetterMarked) {
          if (el && el.removeAttribute) el.removeAttribute(LEAD_LETTER_ATTR);
        }
      }
      // v1.6.23：移除內文裝飾性大寫 / 加寬字距標記
      if (Array.isArray(snapshot.decorResetMarked)) {
        for (const el of snapshot.decorResetMarked) {
          if (el && el.removeAttribute) el.removeAttribute(DECOR_RESET_ATTR);
        }
      }

      // v1.0.8：還原 byline inline display（在 cleaner.restore 之前——main.js
      // 458→459——collapsed 元素還回 cleaner 值、cleaner 再還回原始）+ 移除標記
      if (Array.isArray(snapshot.bylineDispSnap)) {
        for (const s of snapshot.bylineDispSnap) {
          if (!s || !s.el) continue;
          const prop = s.prop || 'display';
          if (releaseInlineOwned(s.el, prop, s.owner || 'styler:byline')) continue;
          if (s.prev) s.el.style.setProperty(prop, s.prev, s.prevP || '');
          else s.el.style.removeProperty(prop);
        }
      }
      // v2.5.40：拆回日期＋時刻切出來的 span（文字原樣併回原本的文字節點）
      if (Array.isArray(snapshot.bylineTimeSplits)) {
        for (let i = snapshot.bylineTimeSplits.length - 1; i >= 0; i--) {
          const { textNode, span, orig } = snapshot.bylineTimeSplits[i] || {};
          if (!textNode || !span) continue;
          try {
            textNode.nodeValue = orig;
            if (span.parentNode) span.parentNode.removeChild(span);
          } catch (_) { /* 節點已被站方移除 */ }
        }
      }
      if (Array.isArray(snapshot.bylineMarks)) {
        for (const m of snapshot.bylineMarks) {
          if (m && m.el && m.el.removeAttribute) m.el.removeAttribute(m.attr);
        }
      }
      // v1.8.3：移除首 / 末可見 direct child 標記
      if (Array.isArray(snapshot.edgeMarks)) {
        for (const m of snapshot.edgeMarks) {
          if (m && m.el && m.el.removeAttribute) m.el.removeAttribute(m.attr);
        }
      }
      // v1.8.4：移除標題 pseudo 間距佔位標記
      if (Array.isArray(snapshot.headingSpacerMarks)) {
        for (const m of snapshot.headingSpacerMarks) {
          if (m && m.el && m.el.removeAttribute) m.el.removeAttribute(m.attr);
        }
      }
      // v1.9.12：引言補強標記（BQ_PLAIN / BQ_UPRIGHT）
      if (Array.isArray(snapshot.quoteMarks)) {
        for (const m of snapshot.quoteMarks) {
          if (m && m.el && m.el.removeAttribute) m.el.removeAttribute(m.attr);
        }
      }

      if (snapshot.articleEl && snapshot.articleEl.removeAttribute) {
        snapshot.articleEl.removeAttribute(ARTICLE_ATTR);
      }
      if (Array.isArray(snapshot.ancestors)) {
        for (const a of snapshot.ancestors) {
          if (a && a.removeAttribute) a.removeAttribute(ANCESTOR_ATTR);
        }
      }
      if (!snapshot.htmlHadClass) {
        document.documentElement.classList.remove(HTML_CLASS);
      }

      // v0.8.24：還原 theme-color meta（自建的移除、原有的還原 content）
      restoreThemeColor(snapshot.themeColorSnap);

      // v0.8.139：還原 viewport meta（自建的移除、原有的還原 content）
      restoreViewport(snapshot.viewportSnap);

      if (snapshot.firstInk) {
        if (snapshot.firstInkPriorMt) {
          snapshot.firstInk.style.setProperty(
            'margin-top',
            snapshot.firstInkPriorMt,
            snapshot.firstInkPriorMtPriority || ''
          );
        } else {
          snapshot.firstInk.style.removeProperty('margin-top');
        }
      }

      // v0.7.179：還原 ancestor padding strip
      if (Array.isArray(snapshot.ancestorPaddingSnap)) {
        for (const s of snapshot.ancestorPaddingSnap) {
          if (!s || !s.el) continue;
          if (s.pt) s.el.style.setProperty('padding-top', s.pt, s.ptP || '');
          else s.el.style.removeProperty('padding-top');
          if (s.pb) s.el.style.setProperty('padding-bottom', s.pb, s.pbP || '');
          else s.el.style.removeProperty('padding-bottom');
        }
      }

      // v0.7.183：還原 negative margin-top strip
      if (Array.isArray(snapshot.negMarginSnap)) {
        for (const s of snapshot.negMarginSnap) {
          if (!s || !s.el) continue;
          if (s.mt) s.el.style.setProperty('margin-top', s.mt, s.mtP || '');
          else s.el.style.removeProperty('margin-top');
        }
      }

      // v1.6.21：還原 figure 不對稱水平 padding strip
      if (Array.isArray(snapshot.figurePaddingSnap)) {
        for (const s of snapshot.figurePaddingSnap) {
          if (!s || !s.el) continue;
          if (s.pl) s.el.style.setProperty('padding-left', s.pl, s.plP || '');
          else s.el.style.removeProperty('padding-left');
          if (s.pr) s.el.style.setProperty('padding-right', s.pr, s.prP || '');
          else s.el.style.removeProperty('padding-right');
        }
      }

      // v0.7.246：還原內文版心自我檢查清掉的水平 padding/margin
      if (Array.isArray(snapshot.contentWidthSnap)) {
        for (const s of snapshot.contentWidthSnap) {
          if (!s || !s.el) continue;
          if (s.pl) s.el.style.setProperty('padding-left', s.pl, s.plP || '');
          else s.el.style.removeProperty('padding-left');
          if (s.pr) s.el.style.setProperty('padding-right', s.pr, s.prP || '');
          else s.el.style.removeProperty('padding-right');
          if (s.ml) s.el.style.setProperty('margin-left', s.ml, s.mlP || '');
          else s.el.style.removeProperty('margin-left');
          if (s.mr) s.el.style.setProperty('margin-right', s.mr, s.mrP || '');
          else s.el.style.removeProperty('margin-right');
        }
      }

      // v1.7.16：還原 full-bleed translateX 置中對殘留 reset
      if (Array.isArray(snapshot.translateResetSnap)) {
        for (const s of snapshot.translateResetSnap) {
          if (!s || !s.el) continue;
          if (s.tf) s.el.style.setProperty('transform', s.tf, s.tfP || '');
          else s.el.style.removeProperty('transform');
        }
      }

      // v2.5.25：還原縮字級塞進卡片的表（fitTableFont）。排在圖說字級之前——
      // 表內若有 figcaption，這裡記的原值是圖說那條寫的 inline，要先寫回去
      if (Array.isArray(snapshot.tableFitSnap)) {
        for (let i = snapshot.tableFitSnap.length - 1; i >= 0; i--) restoreTableFitEntry(snapshot.tableFitSnap[i]);
        // 標記這一輪已還原：晚到的落定後重量看到就不再動
        snapshot.tableFitSnap.restored = true;
      }

      // v0.8.123：還原 figcaption 字級下限 inline override
      if (Array.isArray(snapshot.captionFsSnap)) {
        for (const s of snapshot.captionFsSnap) {
          if (!s || !s.el) continue;
          if (s.fs) s.el.style.setProperty('font-size', s.fs, s.fsP || '');
          else s.el.style.removeProperty('font-size');
        }
      }

      // v1.7.19：還原 figcaption 靠尾端對齊 reset
      if (Array.isArray(snapshot.captionAlignSnap)) {
        for (const s of snapshot.captionAlignSnap) {
          if (!s || !s.el) continue;
          if (s.ta) s.el.style.setProperty('text-align', s.ta, s.taP || '');
          else s.el.style.removeProperty('text-align');
        }
      }

      // v0.7.179：還原 title font-size inline override
      if (snapshot.titleFsSnap) {
        const t = snapshot.titleFsSnap;
        if (t.fs) t.el.style.setProperty('font-size', t.fs, t.fsP || '');
        else t.el.style.removeProperty('font-size');
      }

      // v0.8.3：還原 hero 字級下限 inline override
      if (snapshot.heroFloorSnap) {
        const h = snapshot.heroFloorSnap;
        if (h.fs) h.el.style.setProperty('font-size', h.fs, h.fsP || '');
        else h.el.style.removeProperty('font-size');
      }

      // v2.5.34：脫離型圖說搬回原位（反向）
      if (Array.isArray(snapshot.capReattachSnap)) {
        for (let i = snapshot.capReattachSnap.length - 1; i >= 0; i--) {
          const r = snapshot.capReattachSnap[i];
          if (!r || !r.fc || !r.parent || !r.parent.isConnected) continue;
          try {
            if (r.next && r.next.parentNode === r.parent) r.parent.insertBefore(r.fc, r.next);
            else r.parent.appendChild(r.fc);
          } catch (_) { /* noop */ }
        }
      }

      // v2.2.7：還原標題獨佔一行 / dek 字級壓制（反向，同 el 多 prop 各自一筆）
      if (Array.isArray(snapshot.titleLineSnap)) {
        for (let i = snapshot.titleLineSnap.length - 1; i >= 0; i--) {
          const s = snapshot.titleLineSnap[i];
          if (!s || !s.el) continue;
          // B-04：display 先問登記簿，沒登記（最小 NS 環境）才走快照寫回
          if (s.prop === 'display' && releaseInlineOwned(s.el, 'display', 'styler:title-line')) continue;
          if (s.v) s.el.style.setProperty(s.prop, s.v, s.p || '');
          else s.el.style.removeProperty(s.prop);
        }
      }

      // v0.7.225：還原 contrast guard 的 inline override（background-color
      // 還原 + per-carrier color 覆寫，通用 {el, prop, prev, prevP} entry）
      if (Array.isArray(snapshot.contrastBgSnap)) {
        for (const s of snapshot.contrastBgSnap) {
          if (!s || !s.el || !s.prop) continue;
          if (s.prev) s.el.style.setProperty(s.prop, s.prev, s.prevP || '');
          else s.el.style.removeProperty(s.prop);
        }
      }

      // v0.7.179：還原 WP constrained layout inline max-width override
      if (Array.isArray(snapshot.wpConstrained)) {
        for (const g of snapshot.wpConstrained) {
          if (!g || !g.el) continue;
          if (g.maxWidth) {
            g.el.style.setProperty('max-width', g.maxWidth, g.maxWidthPriority || '');
          } else {
            g.el.style.removeProperty('max-width');
          }
        }
      }

      // v0.7.93：還原 image gallery flex/grid containers 的原 inline style
      // v0.7.94：同陣列也含 gallery 內媒體直接子的 margin-bottom snapshot
      if (Array.isArray(snapshot.galleryFlex)) {
        for (const g of snapshot.galleryFlex) {
          if (!g || !g.el) continue;
          // gallery container 自身: 還原 display / height / min-height
          if (g.hasOwnProperty('display')) {
            for (const prop of ['display', 'height', 'min-height']) {
              if (prop === 'display' && releaseInlineOwned(g.el, 'display', 'styler:gallery')) continue;
              const key = prop === 'min-height' ? 'minHeight' : prop;
              const value = g[key];
              const priority = g[key + 'Priority'];
              if (value) {
                g.el.style.setProperty(prop, value, priority || '');
              } else {
                g.el.style.removeProperty(prop);
              }
            }
          }
          // gallery 內媒體子: 還原 margin-bottom
          if (g.hasOwnProperty('marginBottom')) {
            if (g.marginBottom) {
              g.el.style.setProperty('margin-bottom', g.marginBottom, g.marginBottomPriority || '');
            } else {
              g.el.style.removeProperty('margin-bottom');
            }
          }
        }
      }

      // v0.8.137：還原 aspect-ratio box reset 的 inline override
      if (Array.isArray(snapshot.ratioBoxes)) {
        for (const r of snapshot.ratioBoxes) {
          if (!r || !r.el) continue;
          if (r.aspectRatio) r.el.style.setProperty('aspect-ratio', r.aspectRatio, r.aspectRatioPriority || '');
          else r.el.style.removeProperty('aspect-ratio');
        }
      }

      // v2.5.30：還原「absolute 填滿外殼拉回版面」的四個 inline override。
      if (Array.isArray(snapshot.absFillShells)) {
        for (const r of snapshot.absFillShells) restoreAbsFillShell(r);
      }

      // v1.6.22：還原固定 px height 死空間 collapse 的 height inline override。
      if (Array.isArray(snapshot.fixedHeightBoxes)) {
        for (const f of snapshot.fixedHeightBoxes) {
          if (!f || !f.el) continue;
          if (f.height) f.el.style.setProperty('height', f.height, f.heightPriority || '');
          else f.el.style.removeProperty('height');
        }
      }

      // v1.7.78：還原 min-height 死空間 collapse 的 min-height inline override。
      if (Array.isArray(snapshot.minHeightBoxes)) {
        for (const m of snapshot.minHeightBoxes) {
          if (!m || !m.el) continue;
          if (m.minHeight) m.el.style.setProperty('min-height', m.minHeight, m.minHeightPriority || '');
          else m.el.style.removeProperty('min-height');
        }
      }

      // v2.5.12：移除翻頁模式 ARIA 表格 flex 外殼標記
      if (Array.isArray(snapshot.ariaFlowShellMarked)) {
        for (const el of snapshot.ariaFlowShellMarked) {
          if (el && el.removeAttribute) el.removeAttribute(ARIA_FLOW_SHELL_ATTR);
        }
      }

      // v2.5.13：還原翻頁模式表頭列「跟著下一列」寫的 inline
      if (Array.isArray(snapshot.ariaHeaderKeepSnap)) {
        for (let i = snapshot.ariaHeaderKeepSnap.length - 1; i >= 0; i--) {
          const a = snapshot.ariaHeaderKeepSnap[i];
          if (!a || !a.el || !a.el.style) continue;
          if (a.value) a.el.style.setProperty(a.prop, a.value, a.priority || '');
          else a.el.style.removeProperty(a.prop);
        }
        snapshot.ariaHeaderKeepSnap.restored = true;
      }

      // v2.5.10：還原 ARIA 表格格子收窄的左右內距與放行換行的 white-space。
      // 反序寫回（同一元素同一屬性只會記一筆，反序是防未來多筆時的順序錯位）
      if (Array.isArray(snapshot.ariaCellSnap)) {
        for (let i = snapshot.ariaCellSnap.length - 1; i >= 0; i--) {
          const a = snapshot.ariaCellSnap[i];
          if (!a || !a.el) continue;
          if (a.value) a.el.style.setProperty(a.prop, a.value, a.priority || '');
          else a.el.style.removeProperty(a.prop);
        }
        // v2.5.11：標記這一輪已還原，passAriaNarrowCellInsets 晚到的重量看到就不再動
        snapshot.ariaCellSnap.restored = true;
      }

      // v2.5.24：還原被擠格子的 min-width 下限（passSqueezedCellFloor）
      if (Array.isArray(snapshot.cellFloorSnap)) {
        for (const c of snapshot.cellFloorSnap) {
          if (!c || !c.el) continue;
          if (c.minWidth) c.el.style.setProperty('min-width', c.minWidth, c.minWidthPriority || '');
          else c.el.style.removeProperty('min-width');
        }
      }

      // v0.8.101：還原寬語意內容（table / pre）的 display / overflow-x / max-width
      // （v2.5.18 起多帶 min-width）
      // inline override（apply 時設的水平捲）。
      if (Array.isArray(snapshot.wideScroll)) {
        for (const w of snapshot.wideScroll) {
          if (!w || !w.el) continue;
          // v2.5.19：翻頁模式那一筆只寫過 min-width（minWidthOnly），其他三個不碰
          for (const prop of (w.minWidthOnly ? ['min-width'] : ['display', 'overflow-x', 'max-width', 'min-width'])) {
            if (prop === 'display' && releaseInlineOwned(w.el, 'display', 'styler:widescroll')) continue;
            const key = prop === 'overflow-x' ? 'overflowX' : (prop === 'max-width' ? 'maxWidth' : (prop === 'min-width' ? 'minWidth' : prop));
            const value = w[key];
            if (value) w.el.style.setProperty(prop, value, w[key + 'Priority'] || '');
            else w.el.style.removeProperty(prop);
          }
          // v2.5.18：放開過的寫死高度容器還原 height（值與 priority）
          if (Array.isArray(w.heightReleased)) {
            for (const h of w.heightReleased) {
              if (!h || !h.el) continue;
              if (h.height) h.el.style.setProperty('height', h.height, h.heightPriority || '');
              else h.el.style.removeProperty('height');
            }
          }
        }
      }

      // v0.8.69：移除尚未觸發的 lazy content-img de-column listener（避免退出後
      // 圖載入仍在已 detach 的節點上塌欄 / listener 洩漏）。先清 listener 再還原
      // display，避免 restore 進行中 load 事件又補一筆塌欄。
      if (Array.isArray(snapshot.decolumnLoadCleanup)) {
        for (const { img, onLoad } of snapshot.decolumnLoadCleanup) {
          if (img && img.removeEventListener) img.removeEventListener('load', onLoad);
        }
      }
      // v0.8.66：還原 de-column flex/grid 容器的 display inline override
      if (Array.isArray(snapshot.textColFlex)) {
        for (const t of snapshot.textColFlex) {
          if (!t || !t.el) continue;
          if (releaseInlineOwned(t.el, 'display', 'styler:decolumn')) continue;
          if (t.display) {
            t.el.style.setProperty('display', t.display, t.displayPriority || '');
          } else {
            t.el.style.removeProperty('display');
          }
        }
      }
    },

    /**
     * v1.6.30（#13）：動態補標——cleaner 的 dynamic-append observer 對
     * articleEl 內新增節點轉呼。晚 mount 的 responsive embed iframe（v0.8.155
     * 場景：WP embed lazy 注入）與 heading link 補標記，取代原 :has 的自動
     * 反應（差一個 observer microtask，視覺無感）。gate 在「新增子樹含
     * iframe / heading」才全掃（罕見事件；平時每節點只付兩個 querySelector）。
     * @param {Element} node dynamic-append 的新增節點（articleEl 內）
     */
    remarkDynamicMarkers(node) {
      const s = activeMarkState;
      if (!s || !s.articleEl || !s.articleEl.isConnected) return;
      if (!node || node.nodeType !== 1 || !s.articleEl.contains(node)) return;
      // 2026-10-07 review B-01：先補 ratio token 標記（EMBED_WRAP 候選集合依賴它）
      if (Array.isArray(s.ratioClassMarked) &&
          ((node.matches && node.matches('[class*="ratio" i]')) ||
           (node.querySelector && node.querySelector('[class*="ratio" i]')))) {
        markRatioClassBoxes(s.articleEl, s.ratioClassMarked, node);
      }
      const hasIframe = (node.matches && node.matches('iframe')) ||
        (node.querySelector && node.querySelector('iframe'));
      if (hasIframe) markEmbedWrapIframes(s.articleEl, s.embedWrapMarked, s.embedFillMarked, s.siteUiMarked);
      // v2.5.18：晚升級的背景圖影片佔位殼補標（自訂元素升級後才插入播放鍵）
      if (Array.isArray(s.siteUiMarked) &&
          ((node.matches && node.matches(NS.FACADE_BTN_SEL)) ||
           (node.querySelector && node.querySelector(NS.FACADE_BTN_SEL)))) {
        markBgFacadeUi(s.articleEl, s.siteUiMarked, node);
      }
      const hasHeading = (node.matches && node.matches('h1,h2,h3,h4,h5,h6,a')) ||
        (node.querySelector && node.querySelector('h1,h2,h3,h4,h5,h6'));
      if (hasHeading) {
        // v1.7.44 E11：只掃新增子樹（scope 參數）——新 heading 的包裹 <a>
        // 可能是既有節點（node 之外），closest 往上補到該 <a> 為 scope
        const wrapA = (node.closest && node.closest('a')) || null;
        markHeadingLinks(s.articleEl, s.headingLinkMarked, wrapA || node);
      }
      // v1.7.45：晚 mount 的 absolute/fixed 錨定元素補標（只掃新增子樹；
      // position 無 cheap selector gate、但子樹通常很小，直接量 computed）
      if (Array.isArray(s.absAnchorMarked)) {
        markAbsAnchors(s.articleEl, s.absAnchorMarked, node);
      }
      // v1.7.70：翻譯回填把 pre-wrap 容器內容整包換掉時重新切段（見
      // resplitPreWrapParagraphs——翻譯完成沒有事件可聽，借這條通道）
      resplitPreWrapParagraphs(node, s.prewrapParaSnap);
      // v1.9.7：晚 mount 的 img 補 inline / icon / upscale 分類（見 passClassifyImages 的 classifyLateImg）
      if (typeof s.classifyLateImg === 'function') {
        const imgs = (node.matches && node.matches('img')) ? [node]
          : (node.querySelectorAll ? node.querySelectorAll('img') : []);
        for (const img of imgs) s.classifyLateImg(img);
      }
      // v1.9.15：閱讀模式中新畫的重點（站方把選取文字包進高亮自訂元素）補標
      if (Array.isArray(s.siteUiMarked)) markInlineHighlights(s.articleEl, s.siteUiMarked, node);
      if (Array.isArray(s.siteUiMarked)) markColorSwatches(s.articleEl, s.siteUiMarked, node); // v3.7.4
      // v2.4.9：晚 mount 段落的站方 drop cap 首字色補標
      if (Array.isArray(s.firstLetterMarked)) {
        markFirstLetterColorBlocks(s.articleEl, s.firstLetterMarked, node);
        markDropCapBlocks(s.articleEl, s.firstLetterMarked, node); // v2.5.24
      }
      // 2026-11-15 review B-09：晚 mount / 譯文回填的段落補 CJK justify 標記
      if (Array.isArray(s.cjkJustifyMarked)) markCjkParagraphs(s.articleEl, s.textJustify, node, s.cjkJustifyMarked);
      scheduleDirOverride(s); // v2.5.21
    },

    /**
     * 2026-11-15 review B-09：段落內只換了 text node（譯文回填純文字段落——沒有
     * 新增元素，remarkDynamicMarkers 收不到）時，重判該段的 CJK justify 標記。
     * cleaner dynamic observer 對 articleEl 內新增的非空白 text node 轉呼。
     * @param {Element} host 新 text node 的父元素
     */
    remarkDynamicText(host) {
      const s = activeMarkState;
      if (!s || !s.articleEl || !Array.isArray(s.cjkJustifyMarked)) return;
      if (!host || host.nodeType !== 1 || !s.articleEl.contains(host)) return;
      markCjkParagraphs(s.articleEl, s.textJustify, host, s.cjkJustifyMarked);
      // v2.5.24：譯文回填把段首從拉丁字母換成 CJK（或反過來）→ 重判放大首字
      if (Array.isArray(s.firstLetterMarked)) markDropCapBlocks(s.articleEl, s.firstLetterMarked, host);
      scheduleDirOverride(s); // v2.5.21
    },

    /**
     * v1.9.15：把站方浮動工具列子樹標成「站方自管視覺」（bg / border / color
     * strip 與主題文字色都不接管）。cleaner 的 allowSelectionToolbar 放行選取
     * 工具列時轉呼；閱讀模式未啟動（無 activeMarkState）時 no-op。
     * @param {Element} root 工具列宿主，或宿主內 re-render 的新增節點
     */
    markSiteWidgetSubtree(root) {
      const s = activeMarkState;
      if (!s || !s.articleEl || !Array.isArray(s.siteUiMarked)) return;
      if (!root || root.nodeType !== 1 || !s.articleEl.contains(root)) return;
      markSiteWidgetEls(root, s.siteUiMarked);
    }
  };

  NS.styler = styler;
})();
