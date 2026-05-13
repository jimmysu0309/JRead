// JRead — 雜訊隱藏
// 規則來源：SPEC.md「雜訊隱藏規則」章節。
// 所有規則皆為 DOM / CSS 結構特徵通則，不綁站點 hostname 或特定 class。
// 站點特判一律放 site-overrides/，不得混入此檔。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  // ---- Keyword 名單（主文內雜訊 heuristic） -----------------------------
  // 邊界檢查：class/id 通常是 kebab-case 或 snake_case，用非字母數字作邊界，
  // 避免 sharepoint / headset 這類誤殺。
  // 跨 CMS 命名慣例的雜訊 class/id keyword 名單。每組為語意 family：
  //   paywall / subscribe / newsletter / signup：訂閱 / 付費牆
  //   promo / promotion / advertisement / sponsor(ed) / cta / call-to-action：廣告 / 贊助
  //     - sponsored（形容詞，覆蓋 sponsored-content 類）+ sponsor（動詞詞根，
  //       覆蓋 udn `.sponsor-ads` / `.sponsor-links` 類——實測）
  //   related-(articles|news|posts|stories)：相關閱讀 section family
  //   more-(news|stories|posts|articles)：「延伸閱讀」section family（udn
  //     `section.more-news` 實測，跨聯合 / 中時 / 各種新聞 CMS 的慣例命名）
  //   recommend(ed) / read-more：推薦 / 更多（popIn / dable / Taboola widget 命名）
  //   taboola：Taboola 第三方推薦 widget 的 id / class 前綴
  //     （`taboola-below-article-thumbnails` 等跨站 embed 命名）
  //   share / social：分享按鈕
  //   comment(s) / discuss(ion) / disqus：留言 / 討論（udn `.discuss-board`
  //     實測——`discussion` 名詞不 match `discuss-board`；加 `discuss` 動詞
  //     詞根覆蓋 board / form 類 CMS module）
  //   article-sidebar / sidebar-(wrapper|column|content|widget|primary|secondary)：
  //     CMS 慣例 article 內 sidebar wrapper 命名。twz.com 實測 sidebar 是
  //     `<aside id="article-sidebar" class="article-sidebar pb-5">`，包在
  //     `<div class="featured-template-sidebar-wrapper article-sidebar-wrapper">`
  //     內，跟主文 paywall wrapper 是 flex-row siblings。既有
  //     hideInsideArticleSidebarColumns 條件 B（aside tag + rectH > 400）只
  //     檢查 direct child，aside 在 sibling div wrapper 內漏網；條件 A
  //     （linkDensity > 0.5）也因 sidebar 內 11 個 a 累計 textContent 不及
  //     描述文字 0.5 比值漏網。直接靠 class token 命中比 layout 啟發式穩。
  //     不裸用 `sidebar` token——會誤殺 `sidebar-icon` / `sidebar-toggle` /
  //     `mobile-sidebar-button` 等明顯非 sidebar 的 button class。只用明確
  //     語意的 alternation（CMS / WordPress / news 站慣例命名）。
  // alternation 順序不影響：regex 會依 boundary `(^|[^a-z0-9])...([^a-z0-9]|$)`
  // 逐一 try。動詞詞根不會誤殺既有的形容詞 `recommended` / `sponsored` /
  // `discussion`——後者各自有自己的 alternation 先行。
  // `newsletter[\w-]*`（v0.7.25 techbang 修法）：原本 `newsletter` 要求後綴 word
  // boundary，對 techbang 的 `<div class="newsletter2in1">` 失效——`newsletter2in1`
  // 中 `newsletter` 後面接 `2`（數字），boundary `[^a-z0-9]|$` 要求非字母數字
  // 或字串結束都不滿足。改成 `newsletter` 後接任意 word 字元（含數字 / 連字元），
  // 配合外層的 `[^a-z0-9]|$` boundary 對整個匹配 token 的末尾做檢查——能吃
  // `newsletter` / `newsletter2in1` / `newsletter-form` / `newsletterBox` 等所有
  // 以 `newsletter` 開頭的 class 變體。
  // v0.7.85：對標業界開源專案（Mozilla Readability / Postlight Parser /
  // Unclutter / EasyList / uBlock）的 noise keyword 最佳實踐補強。新加 token
  // 都已過 word-boundary 安全評估（不誤殺主文常見 class）。完整研究紀錄
  // 與來源見 docs/NOISE_KEYWORD_RESEARCH.md（不存在則待後續補檔）。
  // 加入分類（按來源）：
  //   - 品牌/服務名（零誤殺，命中即必然雜訊）：
  //       addthis, sharedaddy, ai2html, sociable, dianomi, adsense, adslot,
  //       onesignal, intercom, printfriendly, instapaper_ignore, blogger-labels,
  //       smartfeed, mpu
  //   - 廣告/付費牆變體：advert, adbox, adhesion, metered, interstitial, takeover
  //   - 留言/社群：replies, remark, shoutbox, respond, composer, combx
  //   - 結構雜訊：supplemental, cover-wrap, entry-unrelated, crumb (補
  //       breadcrumb 變體), recirc, nag, backdrop, topbar, announcement,
  //       popover, drawer, loader, contact, shopping, plea
  //   - 「相關文章 / 推薦」變體：next-article, latest-posts, mostread, most-read
  // 刻意不加（誤殺風險）：gate (太短/tailgate)、wall (firewall)、media、
  //   meta、info、tags、widget 單字、scroll 單字、disclaimer、dialog、
  //   alert、prompt、commercial、tease、splash、bookmark、tools、legends、
  //   dateline (主文署名)、marketing (主題詞會誤命)、aux、yom-remote (站特定)
  const NOISE_KEYWORD_RE = /(^|[^a-z0-9])(paywall|subscribe|subscription|newsletter[\w-]*|signup|sign-up|signin|sign-in|login|register|promo|promotion|promote|advertisement|advert|adbox|adsense|adslot|adhesion|metered|interstitial|takeover|sponsored|sponsor|donation|donate|call-to-action|cta|callout|related[-_]?(?:articles?|news|posts|stories)|more[-_]?(?:news|stories|posts|articles?)|hash[-_]?tag|premium[-_]?(?:widget|content|trial|banner|box)|next-article|latest-posts|mostread|most-read|recommended|recommend|recommendation|read-more|read-next|up-next|recirc|smartfeed|taboola|trc_[a-z_]+|outbrain|zergnet|revcontent|popin|dianomi|addthis|sharedaddy|sociable|ai2html|onesignal|intercom|printfriendly|instapaper_ignore|blogger-labels|mpu|share|social|social-(?:bar|links|icons|share|media)|comment|comments|comment-form|discussion|discuss|disqus|livefyre|hyvor|replies|remark|shoutbox|respond|composer|combx|article-sidebar|sidebar-wrapper|sidebar-column|sidebar-content|sidebar-widget|sidebar-primary|sidebar-secondary|supplemental|cover-wrap|entry-unrelated|breadcrumb|breadcrumbs|crumb|audio-player|audio-widget|controls|partner|postlisting|post-listing|thread|threads|reposted|repost|follow|follow-us|following|cookie-(?:banner|notice|consent|bar|message)|gdpr|consent|privacy-(?:banner|notice)|email-(?:signup|capture|subscribe)|pagination|page-nav|pager|page-navigation|author-(?:bio|card|info|box|meta|widget)|about-(?:author|the-author)|powered[-_]?by|popup|popover|overlay|modal-(?:content|dialog|box|wrapper)|backdrop|drawer|floating-(?:bar|cta|widget)|sticky-(?:bar|cta|banner|subscribe)|topbar|announcement|nag|plea|contact|shopping|loader|toast|snackbar|notification-(?:bar|banner)|marker|weixin|wechat|weibo|qrcode|qr-code|qrcoode|app-?download|app-?promo|app-?banner|appdownload|app-?store-?banner)([^a-z0-9]|$)/i;
  // ad- / -ad 邊界特例（不可直接放進上面 alternation，否則 2 字母太短會大量誤殺）
  const AD_BOUNDARY_RE = /(^|[-_\s])ad([-_\s]|$)/i;

  // camelCase / 連寫 ad 後綴（`lineAd` lowercase 為 `linead`，AD_BOUNDARY_RE 攔
  // 不到——`ad` 前是 `e` 不是邊界字元）。CMS 廣告命名慣例：layout/position/
  // content-type prefix + Ad 後綴（`lineAd` / `articleAd` / `topAd` / `sideAd`
  // / `bannerAd` / `inlineAd` 等），跨 CMS pattern。明確列舉前綴避免誤殺
  // `head` / `load` / `bread` / `glad` 等英文單詞。
  // cna.com.tw 實測：<div class="lineAd"> 廣告 wrapper 高 571px 殘留主文中。
  const AD_SUFFIX_RE = /(line|inline|article|page|main|single|banner|display|video|side|top|bottom|left|right|header|footer|content|sticky|float|wrapper|container|block|widget|module|slot|unit|infinite|leader|skyscraper|rectangle|square|tall|wide|preroll|postroll|midroll)ad(s?)([-_\s\d]|$)/i;

  // 永不隱藏的保留元素 selector（即使命中 keyword 也跳過，避免 Unclutter 把 <summary> 外移的坑）
  const PRESERVE_SEL = 'summary, figure, figcaption, blockquote';

  // Heading 文字 heuristic：跨站點文末列表 / 推薦 / 延伸閱讀 section 的 h2/h3
  // 標題字樣命名極固定（中文新聞站、部落格、Medium 中文化等通用）。SPA
  // 框架站點（LINE Today / Next.js emotion-style hash class）的 class 全無
  // 語意命名、NOISE_KEYWORD_RE 無法命中，只能靠 heading content 匹配。
  // 字詞 family：
  //   延伸閱讀 / 相關新聞 / 相關文章 / 相關報導 / 推薦閱讀 / 推薦文章
  //   熱門新聞 / 熱門文章 / 最新消息 / 最新新聞
  //   更多相關 / 更多...文章 / 更多...新聞 / 查看更多 / 看更多
  //   其他人也看 / 你可能也喜歡 / 也許您(會|也會)(感興趣|喜歡)
  // 為避免誤殺主文的正當副標題（例如「案情分析」「後續發展」），要求：
  //   - heading text 長度 <= 20 chars（推薦 section 標題通常短）
  //   - 命中的是 h2 / h3 / h4（h5/h6 罕用為推薦 section heading）
  // 命中後 hide「heading 所在、articleEl 之下的 direct child 容器」——通常
  // 是 section wrapper，整塊清掉。
  const NOISE_HEADING_TEXT_RE = /(延伸閱讀|相關新聞|相關文章|相關報導|相關行情|推薦閱讀|推薦文章|最新消息|最新新聞|更多相關|更多.{0,4}(文章|新聞|報導)|看更多|查看更多|其他人也看|你可能(也)?(喜歡|感興趣)|也許您?(會|也會)?(感興趣|喜歡)|網友貼文.{0,4}AI|AI.{0,4}(摘要|總結|整理|生成|來回答|回答)|.{0,6}AI摘要|文章標籤|想知道更多|繼續看下去|請繼續下滑(閱讀)?|.{2,4}號貼文|^討論區|^(回應|回覆|留言|评论|回复)(\s*\([^)]*\))?$|^我要(登入|留言|分享|看法)|^貼文(\s*\(\d+\))?$|^(熱門|最新)$|^(下一篇|上一篇)$|^(prev(ious)?|next)\s*(article|post|story)?$|^(related|recommended|popular|trending|latest|featured)(\s+\S+){0,3}$|^top\s+stories?$|^more\s+(from|stories|articles|news|posts|like\s+this)(\s+\S+){0,3}$|^you\s+(may|might)\s+(also\s+)?(like|enjoy|be\s+interested)|^read\s+(more|next|also)|^up\s+next$|^continue\s+reading|^see\s+also|^further\s+reading|editor['’]?s\s+picks?|^sponsored\s+(content|stories|posts)|^comments?(\s*\(\d+\))?$|^discussion(\s*\(\d+\))?$|^responses?(\s*\(\d+\))?$|^replies(\s*\(\d+\))?$|^newsletter$|^subscribe$|^follow\s+us|^join\s+us|^sign\s+up$|^support\s+us|^(hot|new|top)$|AI\s+(summary|digest|overview|takeaways?))/i;
  const NOISE_HEADING_MAX_LEN = 20;

  // 主文內「CTA / 外連 / 訂閱推廣」連結 text heuristic：LINE Today / 新聞聚合
  // 站在文末常塞「查看原始文章」（連回發布站）、主文中段塞「點開加入…LINE
  // 官方帳號」（訂閱推廣）—— class 都是 emotion-style hash / 跨 SPA 命名，
  // keyword / heading rule 都攔不到。走 `<a>` text 跨站通用慣用語匹配 hide。
  // 字詞 family：
  //   查看原始文章 / 看原文 / 回到原文 / 閱讀原文 / 原文連結
  //   加入.{0,10}(LINE|官方帳號|好友|粉絲專頁)
  //   (LINE|官方帳號).{0,10}(加入|訂閱)
  //   訂閱(我們|本報|電子報)
  // 命中後 hide 的目標：a → 若 parent 是 p/div 且只含這個 a（或 a 的文字占
  // parent text 80%+）則 hide parent，否則 hide a 本身。避免把含有少量 a
  // 的 legit p 誤殺。
  const NOISE_LINK_TEXT_RE = /(查看原始文章|看原文|回到原文|閱讀原文|原文連結|原始文章|加入.{0,10}(LINE|官方帳號|好友|粉絲專頁)|(LINE|官方帳號).{0,10}(加入|訂閱)|訂閱.{0,4}(電子報|本報|我們|粉絲團)|點我.{0,8}(下載|訂閱|加入|看|了解|查看)|下載\s*(APP|app)|^(看更多|查看更多)$|^我要(登入|留言|分享)|^發佈$|^標記股票$|^(小額)?(贊助|赞助|抖內|斗内|打賞|打赏)$|^(訂閱|已訂閱|追蹤|已追蹤|關注|已關注|訂閱中|追蹤中|建立貼文|發佈貼文|發表貼文|轉發|轉貼|留言|分享|收藏|更多選項|檢舉|舉報|回覆|讚|喜歡|已讚)$|^轉發\s*\(\d+\)$|^貼文\s*\(\d+\)$|^(view\s+(original|source)|read\s+(the\s+)?(original|full\s+article|more|next|on\s+\w+)|back\s+to\s+(top|article|original)|visit\s+(original|source|site)|show\s+(more|less)|load\s+more|see\s+more|learn\s+more|get\s+(started|the\s+app)|download\s+(the\s+)?app|open\s+(in\s+)?app|subscribe|subscribed|follow|following|unfollow|like|liked|dislike|share|repost|retweet|reply|comment|save|saved|bookmark|bookmarked|report|flag|join|joined|sign\s+(in|up|out)|log\s+(in|out)|register|create\s+(an\s+)?account|new\s+post|post|reblog|upvote|downvote|clap|applaud)(\s*\(\d+\))?$|join\s+(our\s+)?(newsletter|mailing\s+list|community|telegram|discord|slack|line|whatsapp)|follow\s+(us\s+)?on\s+(twitter|x|facebook|instagram|tiktok|youtube|linkedin|threads|line|google\s+news)|subscribe\s+(to\s+)?(our\s+)?(newsletter|channel|podcast|feed|email)|(\d+\s+)?(min(ute)?s?|hour?s?|day?s?|week?s?|month?s?|year?s?)\s+ago)/i;
  const NOISE_LINK_TEXT_MAX_LEN = 60;

  // Strict CTA token list：強廣告 CTA 詞，主文新聞極少自然出現（主文不會自己
  // 叫使用者「立即報名」/「立即下載」），所以對含此 token 的 link/button **不
  // 受 NOISE_LINK_TEXT_MAX_LEN 限制**——常見場景：esmchina 主文末嵌的活動
  // 推廣 `<a>` 整段 80+ chars 包含完整描述 + 結尾「立即报名>>」CTA，被 60 chars
  // 上限 skip 漏網。將此類 strict CTA 拆出獨立 regex，hideInsideArticleByLinkText
  // 對 strict CTA 命中時跳過 length cap，僅保留 PRESERVE_SEL 與 article-self 保護。
  const NOISE_LINK_TEXT_STRICT_RE = /(立即\s*(报名|報名|领取|領取|下载|下載|预约|預約|参与|參與|加入|获取|獲取|查看|了解|抢购|搶購|购买|購買)|马上\s*(报名|领取|下载|预约)|馬上\s*(報名|領取|下載|預約)|請點(我|此)|点击\s*(报名|领取|下载|了解|查看|阅读)|點擊\s*(報名|領取|下載|了解|查看|閱讀))/i;

  // 主文中段「廣告插播」inline 文字 heuristic：自由時報 / 聯合 / ETtoday 等
  // 台灣新聞站在主文段落中段插播「廣告（請繼續閱讀本文）」類 placeholder
  // 文字——單獨 span 內文、無可識別 class。keyword / heading rule 都攔不到，
  // 走 inline text 匹配：
  //   廣告 / AD / 業配 + 各種變體括號 + 「請繼續 / 接下來 / 以下內容」等
  //   續文指示字樣
  const NOISE_INLINE_AD_TEXT_RE = /^(廣告|AD|業配|促銷|贊助|廣編|advertisement|sponsored|promotion|advertorial)\s*[（(:：\-]\s*.{0,40}?(請繼續|繼續|接下來|以下內容|下方|continue|please|below|article\s+continues|story\s+continues|more\s+below)/i;
  const NOISE_INLINE_AD_MAX_LEN = 40;

  // v0.7.109：byline 文字 pattern——hideInsideArticleSidebarColumns
  // 條件 A（textLen < main × 10% + linkDensity > 0.5）會誤殺短篇 byline
  // wrapper（healthsystemtracker `.entry-meta` 實測：author 名都包 `<a>`
  // 連結 link density > 0.5 + 總文字 ~80 chars 遠 < 主文 14K × 10% 1400
  // chars → 命中 A 砍掉作者 + 日期）。byline 結構特徵是「短文 + author
  // 識別字串 + date」，下面 regex 涵蓋常見 byline pattern：
  //   - 英文 byline 前綴："By X" / "Written by X" / "Posted by X"
  //     / "Author: X" / "Authors: X"
  //   - 英文日期：月份英文+日+年（"August 2, 2024" / "Aug 2 2024"
  //     / "2 August 2024" / ISO "2024-08-02"）
  //   - 中文 byline："撰文：" / "作者：" / "編輯：" / "整理：" / "報導："
  //     / "發布日期" / "更新日期" / "刊出日期"
  // 通則：byline 跨站文字 pattern 高度收斂，誤判風險低；搭配 textLen <
  // BYLINE_MAX_TEXT_LEN 雙條件避免廣告 / sidebar widget 偶含日期片段誤觸發。
  const BYLINE_TEXT_RE = /^\s*(by|written\s+by|posted\s+by|authors?[:\s])|\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|撰文[:：]|作者[:：]|編輯[:：]|整理[:：]|報導[:：]|發[佈布][日時]期|更新[日時]期|刊出[日時]期/i;
  const BYLINE_MAX_TEXT_LEN = 200;

  // 主文內 keyword heuristic 只作用於「容器型」元素。
  // 理由：真實世界的廣告/paywall/subscribe 區塊都是容器包裝，
  // 不會是單一 <h1-6> / <p> / <img> / <a>。
  // Wikipedia 曾出現 h4 id="_ad_blocking" / h3 id="Market_share" 這類
  // 內容標題被 keyword 誤殺，限定容器型元素可解此問題。
  // ul / ol 加入：esmchina 把分享 widget（QR + 微信）包在 <ul class="article-weixin">
  // 內，class 命中 NOISE_KEYWORD_RE 的 `weixin` token 但 ul 不在容器名單就漏掃。
  // 主文列表通常 class 不含 noise keyword，命中的 ul/ol 幾乎都是 widget。
  const CONTAINER_SEL = 'div, section, aside, iframe, form, nav, header, footer, ul, ol';

  // Fixed/sticky 結構判斷門檻
  const TOP_BAR_WIDTH_RATIO = 0.8;   // 寬度 ≥ viewport 80% 視為 top bar
  const TOP_BAR_MAX_HEIGHT = 100;    // 高度 < 100px
  const SIDE_TOOL_MAX_WIDTH = 100;   // 寬度 < 100px 視為側邊浮動工具列
  const SIDE_TOOL_MIN_HEIGHT = 200;  // 高度 > 200px

  // 社群分享 cluster 門檻：同 parent 下 3+ 個社群連結
  const SHARE_CLUSTER_MIN = 3;
  const SHARE_LINK_SEL = [
    'a[href*="twitter.com"]',
    'a[href*="x.com"]',
    'a[href*="facebook.com"]',
    'a[href*="linkedin.com"]',
    'a[href*="line.me"]',
    'a[href*="weibo.com"]',
    'a[href*="reddit.com"]',
    'a[href*="pinterest.com"]',
    'a[href*="t.me"]',
    'a[href*="wa.me"]'
  ].join(', ');

  // ---- 工具 -------------------------------------------------------------
  function markerOf(el) {
    // el.className 在 SVG 是 SVGAnimatedString，不是 string；用 classList 保險
    const classList = Array.from(el.classList || []).join(' ');
    const id = el.id || '';
    return (classList + ' ' + id).toLowerCase();
  }

  function shouldHideByKeyword(el) {
    const m = markerOf(el);
    if (!m.trim()) return false;
    return NOISE_KEYWORD_RE.test(m) || AD_BOUNDARY_RE.test(m) || AD_SUFFIX_RE.test(m);
  }

  // v0.7.84：strong noise keyword——CMS / news 站慣例命名 sidebar wrapper 的
  // 強語意 token list，主文 wrapper 絕不會這樣命名。命中時跳過 v0.7.83 加的
  // wrapperContainsArticleAnchor guard 直接 hide，避免 sidebar 內若含 100+
  // chars description p（典型相關文章 card 的描述）觸發 guard 被豁免。
  // twz.com 實機 case：ASIDE#article-sidebar 內含 latest-posts-widget，每張
  // 卡片是「短 link + 140 chars 描述 p」，描述 p 超 100 chars → 普通 keyword
  // hide path 被 anchor guard 豁免；strong path 跳過 guard 直接 hide。
  // v0.7.85：strong path 加品牌名——這些 widget 內容常含長文字（評論 /
  // recommendation 描述 / 分享配文）會觸發 wrapperContainsArticleAnchor
  // guard 被豁免。明確品牌名命中即必然雜訊、零誤殺，安全跳過 guard。
  const STRONG_NOISE_KEYWORD_RE = /(^|[^a-z0-9])(article-sidebar|sidebar-wrapper|sidebar-column|sidebar-content|sidebar-widget|sidebar-primary|sidebar-secondary|disqus|outbrain|taboola|dianomi|addthis|sharedaddy)([^a-z0-9]|$)/i;
  function shouldHideByStrongKeyword(el) {
    const m = markerOf(el);
    if (!m.trim()) return false;
    return STRONG_NOISE_KEYWORD_RE.test(m);
  }

  // whitespace-normalize：jsdom textContent 保留 HTML 縮排 `\n    `，真實
  // Chrome innerText 會 collapse——兩端統一 collapse `\s+` → 單一空格並 trim，
  // 讓 fixture 與真實站點量到同一個 textLen。sidebar / button-cluster 規則共用。
  function norm(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  // 「主文標題級」class anchor token list。命中於 wrapper 子樹則該 wrapper
  // 視為「含主文標題」、hideInsideArticleByHeadingText 的 walk-up fallback
  // 必須停（不再升級 hide），避免把含主標的 article-header wrapper 誤殺。
  // 通則：CMS / news 站慣例 class 命名（不含 widget-title / sub-title /
  // card-title 這類 widget 用途的 token）。
  const TITLE_ANCHOR_TOKENS = new Set([
    'title', 'headline', 'heading',
    'article-title', 'articletitle',
    'post-title', 'posttitle',
    'entry-title', 'entrytitle',
    'news-title', 'newstitle',
    'story-title', 'storytitle',
    'page-title', 'pagetitle',
    'main-title', 'maintitle',
    'article-headline', 'articleheadline',
    'post-headline', 'postheadline'
  ]);
  function hasArticleTitleAnchor(wrapper, exclude) {
    // 含 h1 一律保護（已是 hideInsideArticleByKeyword 慣例）
    if (wrapper.querySelector && wrapper.querySelector('h1')) return true;
    // class token 命中 TITLE_ANCHOR_TOKENS + 內含 textLen 介於 10-200 chars
    // （主文標題長度區間，排除 widget 內 sub-title 通常 < 10 chars）
    if (!wrapper.querySelectorAll) return false;
    for (const el of wrapper.querySelectorAll('[class]')) {
      if (el === exclude) continue;
      const cls = (el.className || '').toString();
      if (!cls) continue;
      let hit = false;
      for (const tok of cls.split(/\s+/)) {
        if (TITLE_ANCHOR_TOKENS.has(tok.toLowerCase())) { hit = true; break; }
      }
      if (!hit) continue;
      const t = norm(el.textContent || '');
      if (t.length >= 10 && t.length <= 200) return true;
    }
    return false;
  }

  // 三道主文 anchor 保護：wrapper 含「>= 100 chars 單一 p / 累計 p text >= 300 /
  // title-anchor element」任一即視為「含主文」、不准砍。findSafeWrapperForHeading
  // 與 closest hit 分支共用此判定，保持結構性通則一致。
  function wrapperContainsArticleAnchor(wrapper, exclude) {
    if (!wrapper || !wrapper.querySelectorAll) return false;
    let acc = 0;
    for (const para of wrapper.querySelectorAll('p')) {
      const pt = norm(para.textContent);
      if (pt.length >= 100) return true;
      acc += pt.length;
      if (acc >= 300) return true;
    }
    return hasArticleTitleAnchor(wrapper, exclude);
  }

  // 嚴格版（v0.7.97 chinatimes 修法）：只看主文長段落 p，**不**檢查 title-anchor
  // token。專供 hideInsideArticleByKeyword 用——keyword rule 已對「class 含
  // noise keyword」做明確判定，wrapper 若是真主文必然含長 p；title-anchor
  // 太寬（`title` / `headline` 短 token 廣泛被 widget 用：H3.title / H4.title
  // / span.title 等）會把 widget wrapper 誤豁免。chinatimes 文末
  // subscribe-news-letter 內 H3.title、recommended-article 內多個 H4.title、
  // premium-widget 內 span.brand-name 旁配 H3.title——全因含 `title` token
  // 被 hasArticleTitleAnchor 誤判主文豁免。改用 P-only 嚴格判定後，widget
  // 內無長 p、guard 不豁免、keyword rule 順利 hide widget；newtalk
  // `<div class="title">` 主標題場景仍由 hideInsideArticleByHeadingText 走
  // 寬鬆的 wrapperContainsArticleAnchor（含 title-anchor）保護不受影響。
  function wrapperContainsMainContentP(wrapper) {
    if (!wrapper || !wrapper.querySelectorAll) return false;
    let acc = 0;
    for (const para of wrapper.querySelectorAll('p')) {
      const pt = norm(para.textContent);
      if (pt.length >= 100) return true;
      acc += pt.length;
      if (acc >= 300) return true;
    }
    return false;
  }

  // heading walk-up fallback：從 heading 往 articleEl 方向爬，停在「含主文長段
  // 落 / 累計主文 textLen / 含主文標題 anchor」之前一層，回傳停下時的最深安全
  // wrapper（找不到回 null）。兩處呼叫端共用：
  //   - hideInsideArticleByHeadingText 的 closest 失敗 fallback（v0.7.28 cnyes / v0.7.34 newtalk / v0.7.36 cna）
  //   - checkDynamicNoise 對 dynamic 注入的 heading 同樣處理
  // 三道保護由 wrapperContainsArticleAnchor 統一判定。
  function findSafeWrapperForHeading(h, articleEl) {
    let cur = h;
    let lastSafeWrapper = null;
    while (cur.parentElement && cur.parentElement !== articleEl &&
           articleEl.contains(cur.parentElement)) {
      const pp = cur.parentElement;
      if (wrapperContainsArticleAnchor(pp, h)) break;
      lastSafeWrapper = pp;
      cur = pp;
    }
    return lastSafeWrapper;
  }

  function isInPreserved(el) {
    return !!(el.closest && el.closest(PRESERVE_SEL));
  }

  function isRelated(articleEl, el) {
    // el 在主文內 / 是主文 / 是主文祖先 → 不能動
    return el === articleEl || articleEl.contains(el) || el.contains(articleEl);
  }

  // ---- style snapshot / restore helper ----------------------------------
  // cleaner 內多條 rule 需要改 inline style 後 restore（collapse grid/flex /
  // innerGridFlex / media placeholder）。每個 prop 都要記 value + priority 才能
  // round-trip 還原原站的 `!important` 寫法——若原站 inline 有 `!important`、
  // 我們 remove 後忘了加回 priority，reader mode 退出後等於移除了站點自己的
  // priority 宣告。把 snapshot / apply / restore 的三步驟抽成共用 helper，避免
  // 每個規則重複寫 `prevXxx` + `prevXxxPriority` boilerplate。
  function snapshotStyles(el, propNames) {
    const prev = {};
    if (!el || !el.style) return prev;
    for (const name of propNames) {
      const value = el.style.getPropertyValue ? el.style.getPropertyValue(name) : '';
      const priority = (el.style.getPropertyPriority && el.style.getPropertyPriority(name)) || '';
      prev[name] = { value, priority };
    }
    return prev;
  }

  // apply: 對一批 prop 以 !important 寫 inline style。declarations 為 {name: value}
  // 格式；priority 固定 'important'（cleaner 的 layout 類 rule 都需贏過原站
  // stylesheet `!important`——見硬教訓十）。
  function applyImportant(el, declarations) {
    if (!el || !el.style) return;
    for (const [name, value] of Object.entries(declarations)) {
      el.style.setProperty(name, value, 'important');
    }
  }

  function restoreStyles(el, prev) {
    if (!el || !el.style || !prev) return;
    for (const [name, entry] of Object.entries(prev)) {
      el.style.removeProperty(name);
      if (entry && entry.value) {
        el.style.setProperty(name, entry.value, entry.priority || '');
      }
    }
  }

  function hide(el, hidden) {
    if (!el || el.nodeType !== 1) return;
    if (el.dataset && el.dataset.jreadHidden === '1') return; // 已處理過
    const prevDisplay = el.style.display;
    const prevDisplayPriority = (el.style.getPropertyPriority &&
      el.style.getPropertyPriority('display')) || '';
    hidden.push({ el, prevDisplay, prevDisplayPriority });
    if (el.dataset) el.dataset.jreadHidden = '1';
    // inline `!important` —— 勝過任何 stylesheet rule（包括原站自己的
    // `display: flex !important`）。原本 `el.style.display = 'none'`（inline
    // 無 priority）在 stylesheet !important 戰中會輸 — udn LINE 分享按鈕
    // 的 `aside.article-content__social` 原站規則 specificity 高於 jread
    // 的 `[data-jread-hidden="1"] { display: none !important }`，戰勝後
    // 按鈕重新顯示。改用 inline !important 後就完全贏過任何 stylesheet。
    el.style.setProperty('display', 'none', 'important');
  }

  // ---- 任何位置：ARIA UI-chrome roles ------------------------------------
  // 結構性通則：W3C ARIA 定義的 UI chrome 語意標記，依規範**絕不會**出現在
  // 正文流程裡——凡帶此語意都是對話框/彈窗/懸停提示等 UI chrome 雜訊。
  //   - role="dialog" / "alertdialog" / aria-modal="true"：訂閱彈窗、登入
  //     提示、cookie 同意、付費牆 overlay。Substack 的 .subscribeDialog 就是
  //     嵌在 <article> 內部的 role="dialog"，傳統 fixed/ancestor-sibling 漏掉。
  //   - role="tooltip"：ARIA 規範語意為「懸停/聚焦時顯示的輔助說明」，純
  //     UI chrome、非正文。Medium 的「Member-only story」付費徽章就包在
  //     `<div role="tooltip">` 裡，外觀是 inline-flex 雙 border 徽章——
  //     在 reader mode 下屬於不提供閱讀價值的訂閱提示，hide 之。若有站點
  //     把正文縮寫/術語說明包在 role=tooltip（ARIA 允許但少見），閱讀模式
  //     下損失僅輔助說明、主文仍完整，可接受。
  const DIALOG_SEL =
    '[role="dialog"], [role="alertdialog"], [role="tooltip"], [aria-modal="true"]';

  function hideDialogs(articleEl, hidden) {
    const dialogs = document.querySelectorAll(DIALOG_SEL);
    for (const el of dialogs) {
      if (el === articleEl) continue;
      if (el.contains(articleEl)) continue; // 不砍到主文祖先
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：<hr> 分隔線 ------------------------------------------------
  // 結構特徵（非站點特判）：HTML5 `<hr>` 是「thematic break」——站點常用於
  // post-header 與內文之間的分隔線、或正文節段分隔。reader mode 卡片式
  // 排版下段落 margin 已提供足夠分節視覺，殘留 hr 通常造成多餘橫線
  // （Medium 類實測：post-meta（作者/日期）下方接 1-2 條 hr 再接首圖，
  // 在 reader mode 版面看起來就是「照片上方多出橫線」artifact）。
  //
  // 通則：hide 主文內的所有 `<hr>`。正文作者刻意插入的節段分隔也一併清
  // ——reader mode 本就重排版面、卡片 margin 取代分隔線的視覺功能，
  // 損失極小。已驗證 baseline fixture（businessweekly / stratechery /
  // chinatalk / anthropic / ltn / engadget / dwarkesh / bbc 等）無一含 hr，
  // 零 regression 風險。
  function hideInsideArticleHorizontalRules(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('hr')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：<nav> element（v0.7.28 cnyes.com 修法）-------------------
  // semantic `<nav>` 在 articleEl 之外由 hideOutsideArticleSemantic 處理，
  // 但若 `<nav>` 嵌在 articleEl 內 — 多半是 share toolbar / floating tool
  // rail / breadcrumb / table-of-contents。reader mode 下這些都是 chrome、
  // 不是主文。
  //
  // 觸發場景（cnyes news.cnyes.com/news/id/6429386 實測）：
  //   `<article class="mfxje1x">
  //      <nav class="s155wao3">  ← 左側 fixed 社交 rail（FB/LINE/連結/字級/列印/收藏/留言）
  //        position: absolute、4076×36、跨整篇主文高度
  //      <div>主文 p 段落...</div>`
  //
  // hideFixedOutsideArticle 因 position: absolute 不命中（規則只看 fixed/
  // sticky）；hideOutsideArticleSemantic 對 articleEl 內部不處理。靠新規則。
  //
  // 通則：主文 scope 內的 `<nav>` 不含主文長段落（textLen >= 100 的 p）→
  // 視為 chrome 清。若某站把目錄 / breadcrumb 嵌在 article 內（少見）也會
  // 被清——閱讀模式不需 navigation 元素，這個損失合理。
  //
  // 主文長段落保護：若 nav 內含 textLen >= 100 的 p，跳過（極罕見、避免
  // 將「文章內含 nav 結構的主文容器」誤殺）。
  function hideInsideArticleNav(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('nav')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      let hasLongP = false;
      for (const p of el.querySelectorAll('p')) {
        if (norm(p.textContent).length >= 100) { hasLongP = true; break; }
      }
      if (hasLongP) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文外：語意標籤 --------------------------------------------------
  function hideOutsideArticleSemantic(articleEl, hidden) {
    // 補 id/class 慣用命名（v0.7.23 newtalk.tw 修法）：newtalk 等舊 CMS /
    // 客製模板用 `<div id="footer">` / `<div class="site-footer">` 而不是
    // HTML5 `<footer>` tag，僅掃 semantic tag 會漏網。這些 id/class 是跨
    // CMS site-level chrome 的慣用命名（WordPress 預設主題、Drupal、
    // Bootstrap-based 模板），主文外一律視為 chrome。isRelated guard 擋
    // 主文內/祖先誤殺——若站點把 `.site-footer` 當文章內元件 class 也不
    // 會被清（極罕見場景）。
    //
    // 此修法補洞：v0.7.22 hideAncestorSiblings 能走到 DIV.main 層清
    // `<div id="footer">` 的 harness 驗過——但 Jimmy 實機 Chrome 下仍
    // 看到 footer，是 Playwright vs 實機 DOM 時序差異導致祖先鏈遍歷漏
    // 這個 node。改用「全頁掃 id/class 命中」不依賴祖先鏈、邏輯完整性
    // 保證跨環境一致。
    const els = document.querySelectorAll(
      'header, nav, footer, aside, ' +
      '#header, #footer, #site-header, #site-footer, #page-header, #page-footer, ' +
      '[class~="site-header"], [class~="site-footer"], [class~="page-header"], [class~="page-footer"]'
    );
    for (const el of els) {
      if (isRelated(articleEl, el)) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文外：fixed / sticky 元素 --------------------------------------
  function hideFixedOutsideArticle(articleEl, hidden) {
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    for (const el of all) {
      if (isRelated(articleEl, el)) continue;
      const cs = window.getComputedStyle(el);
      const pos = cs.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // 隱形元素（display:none 不會跑到這，但保險）

      const isTopBar = r.width >= vw * TOP_BAR_WIDTH_RATIO && r.height < TOP_BAR_MAX_HEIGHT;
      const isSideTool = r.width < SIDE_TOOL_MAX_WIDTH && r.height > SIDE_TOOL_MIN_HEIGHT;
      const isBottomPopup = r.top > vh / 2;

      if (isTopBar || isSideTool || isBottomPopup) {
        hide(el, hidden);
      }
    }
  }

  // ---- 主文外/內：社群分享 cluster --------------------------------------
  function hideSocialShareClusters(articleEl, hidden) {
    const anchors = document.querySelectorAll(SHARE_LINK_SEL);
    const parentCount = new Map();
    for (const a of anchors) {
      const p = a.parentElement;
      if (!p) continue;
      parentCount.set(p, (parentCount.get(p) || 0) + 1);
    }
    for (const [p, count] of parentCount) {
      if (count < SHARE_CLUSTER_MIN) continue;
      if (isInPreserved(p)) continue;
      if (p.contains(articleEl)) continue; // 不砍到主文祖先
      hide(p, hidden);
    }
  }

  // ---- 主文外：祖先兄弟（lift article out） ------------------------------
  // 通則：從主文容器沿 parent 鏈往 body 走，每一層把「當前元素的兄弟」
  // 全部隱藏（style/script 等無視覺元素、保留元素、已隱藏者除外）。
  // 效果等同於把主文從複雜的 layout 容器中「拔出來」，解決以下 pattern：
  //   - Medium / Substack 的上方 brand header（非 <header>、非 fixed、
  //     class 不含 keyword，舊規則都漏掉）
  //   - 文章外的相關閱讀 rail、推薦文章、作者卡片
  //   - 版心左右的空白占位容器
  // 前提是 detector 有信心分數門檻，選錯主文的風險可控。
  const STRUCTURAL_TAGS = new Set(['style', 'script', 'link', 'noscript', 'meta', 'title']);

  function hideAncestorSiblings(articleEl, hidden) {
    let cur = articleEl;
    while (cur && cur.parentElement && cur !== document.body) {
      const parent = cur.parentElement;
      for (const sib of parent.children) {
        if (sib === cur) continue;
        if (STRUCTURAL_TAGS.has(sib.tagName.toLowerCase())) continue;
        if (sib.dataset && sib.dataset.jreadHidden === '1') continue;
        if (isInPreserved(sib)) continue;
        hide(sib, hidden);
      }
      cur = parent;
    }
  }

  // ---- promote+narrow 聯動：sibling chrome 全清 ------------------------
  //
  // 場景：detector heuristic 選到深層 content container（例：ebc 的
  // `article_content`，DOM 4-5 層深），promoteForTitle 爬多 hops 升到含
  // h1 的共同祖先（例：`#main_content`）。從 promotedFrom 沿祖先鏈到
  // articleEl 的每一層、除 content 分支外的 sibling 都是 page-level
  // chrome（ebc: 相關新聞 article_relevant、聽新聞 article_controls、
  // 更多 link、article_cover 圖片 overlay、share_box 分享列 etc.），
  // 都不該留在 scope 內。
  //
  // 演算法（與 `hideAncestorSiblings` 方向相反——那條從 articleEl 往 body
  // 走、這條從 promotedFrom 往 articleEl 走）：
  //   cur = promotedFrom
  //   while cur !== articleEl:
  //     parent = cur.parentElement
  //     for sib of parent.children:
  //       if sib === cur: 保留 (content 分支)
  //       if sib 含 h1: 保留 (h1 分支)
  //       else: hide
  //     cur = parent
  //
  // 不動深層後代（各 rule 由 hideInsideArticle* 處理）。isInPreserved
  // 保護仍生效（figure/figcaption/blockquote/summary 內部不動）。
  function narrowPromotedSiblings(articleEl, promotedFrom, hidden, promotedTitleHead) {
    if (!articleEl || !promotedFrom) return;
    if (!articleEl.contains || !articleEl.contains(promotedFrom)) return;
    let cur = promotedFrom;
    // 最多走 10 hops，防萬一 DOM 詭異
    for (let hops = 0; hops < 10 && cur && cur !== articleEl; hops++) {
      const parent = cur.parentElement;
      if (!parent) break;
      for (const sib of parent.children) {
        if (sib === cur) continue;
        if (sib.contains && sib.contains(promotedFrom)) continue;  // content 分支
        // promoted title heading 分支（v0.7.21 Stratechery 修法）：detector
        // promote 實際命中的那個 heading，可能是 h1/h2/h3/h4 任一 tag；
        // 精準白名單保護，不放寬成「所有 H2」避免 sidebar card 的 H2 被誤保。
        if (promotedTitleHead) {
          if (sib === promotedTitleHead) continue;
          if (sib.contains && sib.contains(promotedTitleHead)) continue;
        }
        // 回落 h1 分支（v0.7.14 udn 修法）：沒 promotedTitleHead 資訊時
        // 仍保留「sibling 自己是 H1 或含 h1 後代」作為 fallback——某些站點
        // 走策略 1（article-tag）時沒 promote、但 article 內可能已含 h1。
        if (sib.tagName === 'H1') continue;
        if (sib.querySelector && sib.querySelector('h1')) continue;
        // 媒體分支（v0.7.22 newtalk.tw 修法 → v0.7.24 ttv 精修）：sibling 含
        // 「非連結包裹」的 `<img>` / `<picture>` / `<video>` 才視為主文媒體保留。
        //
        // 為何加 `<a>` 不能包：單純的 `sib.querySelector('img')` 太寬——ttv
        // 類站點 `<div class="sidebox"><ul><li><a href="..."><img></a></li>...</ul>`
        // 的 sidebar 列表（熱門新聞縮圖）每個 img 都在 `<a>` 內，舊 guard 會
        // 誤保整塊 sidebar。而主圖慣例（ebc article_cover / newtalk news_img /
        // 多數新聞站 hero image）是 `<div><img>` 或 `<figure><img>`，img 直接
        // 露出不在 `<a>` 內。此區分同時精準保留主圖 + 清 sidebar 縮圖列表。
        //
        // 通則依據：hero image 是內容本身、不作為連結；sidebar 縮圖是「點擊
        // 跳到其他文章」的連結 affordance。這個「img 是否包在 a 裡」的結構
        // 特徵跨 CMS 通用（不限 ttv）。
        if (sib.querySelectorAll) {
          const medias = sib.querySelectorAll('img, picture, video');
          let hasStandaloneMedia = false;
          for (const m of medias) {
            if (!m.closest || !m.closest('a')) { hasStandaloneMedia = true; break; }
          }
          if (hasStandaloneMedia) continue;
        }
        // byline 分支（v0.7.96 udn 主筆室文章修法）：sibling 短小且含 `<time>`
        // 元素 → 視為「文首 byline / 作者 / 日期 meta」保留。
        // `<time>` 是 HTML5 語意 element 專指日期/時間，跨站通用；短文字限制
        // （textLen <= 200）排除「相關新聞」「最新消息」這類大塊 chrome 雖也含
        // 多個 time 但本身是 noise list 的場景——udn 實測 byline 37 chars vs
        // more-news 490 chars，門檻有充裕空間。
        // 場景：udn /news/story/124844/9460037（主筆室評論文）detector heuristic
        // 選 ARTICLE.article-content + promote 升到 SECTION.article-content__wrapper，
        // wrapper 的 children 含 DIV.article-content__subinfo（2026-04-23 15:07
        // 聯合報／ 主筆室 + tags + 關閉按鈕），舊 narrow 把它當 chrome 砍。
        if (sib.querySelector && sib.querySelector('time')) {
          const sibText = (sib.textContent || '').replace(/\s+/g, ' ').trim();
          if (sibText.length <= 200) continue;
        }
        if (sib.dataset && sib.dataset.jreadHidden === '1') continue;
        if (isInPreserved(sib)) continue;
        hide(sib, hidden);
      }
      if (parent === articleEl) break;
      cur = parent;
    }
  }

  // ---- 主文內：action toolbar（拍手/回應/收藏/分享等互動列）----------------
  // 結構特徵：容器本身無 <p> 直接子、自身文字短、含多個按鈕/圖示元素。
  // Medium / Substack / 部分新聞站的 post footer 互動列都命中此 pattern。
  // 為何限制「自身文字短」：避免誤殺正當的 CTA 卡片（有較長說明文字）。
  // 為何不含 <p> 直接子：避免誤殺內文段落容器。
  const ACTION_TEXT_MAX = 80;
  const ACTION_MIN_ICONS = 2;

  function hideInsideArticleActionRows(articleEl, hidden, containers) {
    containers = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of containers) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      // iframe / video / audio 本身是媒體內容，不是互動列——即使 cross-origin
      // iframe 讀不到 textContent 與內部 DOM，也絕對不能當 action-row 候選。
      if (el.tagName === 'IFRAME' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;

      // 排除：含圖片/影片/嵌入內容的容器（是內容容器，不是互動列）
      // 理由：Substack 的 captioned-image-container 含 <img> + 2 個以上
      // 的 zoom / loading svg，會誤觸 iconCount 門檻被隱藏
      if (el.querySelector('img, picture, video, audio')) continue;

      // 排除：含 heading 直接子（h1-h6）的容器
      // 理由：action row 本質上是圖示互動列，絕不會包含文章 heading。
      // ChinaTalk/Substack 的 div.post-header 包 <h1 post-title> + 作者/
      // 日期 meta + like/comment/share/more buttons——特徵剛好命中 action
      // -row 條件（無 p、無媒體、短文字、多 icon），若不排除 heading 就
      // 會砍掉整個標題區塊（quantum-101 實測觸發）。
      const hasHeadingChild = Array.from(el.children).some(c => /^H[1-6]$/.test(c.tagName));
      if (hasHeadingChild) continue;

      const hasParagraphChild = Array.from(el.children).some(c => c.tagName === 'P');
      if (hasParagraphChild) continue;

      // 排除：直接子中「互動元素」（button / [role=button] / svg）比例 < 50%
      // 的容器。理由：action row 本質是多個互動元素排成一列。若直接子主要
      // 是 sub-container（div），代表這是「內容 wrapper」不是 row。
      // ChinaTalk 作者列外層：直接子是 2 個 DIV（meta group + button group），
      // 0% 互動比例——若不排除會整塊 hide、把作者/日期一起藏掉；加此排除後
      // 外層不 hide，內層 button group（直接子多為 button）仍會被正確命中
      // 單獨 hide，作者/日期保留。
      //
      // Shell short-circuit（v0.6.7）：若自身 textContent < 20 chars，仍視為
      // 空殼 action-bar、不跳過。理由：Medium 把 clap / comment / bookmark /
      // more 各包一層 div，外層 action-bar direct children 全是 0% interactive
      // 的 wrapper，但 textContent 幾乎空（純 icon、clap count 可能 0 / 未
      // 登入不顯示）；這類「border-top + border-bottom 的空殼」在閱讀模式下
      // 遺留兩條橫線夾圖示的 artifact（2026-04-21 ddsakura medium 實測）。
      // 差異點：ChinaTalk byline wrapper 含 author+date 文字 ~30 chars ≥ 20，
      // 走原排除保留不動；Medium outer shell textContent 短，放行走後續 hide
      // 邏輯（iconCount、textLen 等仍會把關）。
      const directChildren = Array.from(el.children);
      if (directChildren.length > 0) {
        const interactiveCount = directChildren.filter(c =>
          c.tagName === 'BUTTON' || c.tagName === 'SVG' ||
          (c.getAttribute && c.getAttribute('role') === 'button')
        ).length;
        if (interactiveCount / directChildren.length < 0.5) {
          const selfText = (el.textContent || '').trim();
          if (selfText.length >= 20) continue;
          // 文字極短：shell short-circuit，繼續走後面 iconCount/textLen 檢查
        }
      }

      const text = (el.textContent || '').trim();
      if (text.length > ACTION_TEXT_MAX) continue;

      const iconCount = el.querySelectorAll('button, [role="button"], svg').length;
      if (iconCount < ACTION_MIN_ICONS) continue;

      hide(el, hidden);
    }
  }

  // ---- 主文內：button cluster（byline 區塊裡的 Share/Save/Add-as-preferred）
  // 結構特徵（非站點特判）：container 自身短文字（≤ 80 chars）+ 遞迴含 ≥ 2 個
  // `<button>` 或 `a[role="button"]` + 不含任何 p/h1-h6/媒體元素。專門對付
  // 現代 CSS-in-JS（styled-components、BBC kKqaMX/cSUzvu 類）把 button 用
  // `display: contents` 層層包 div 的 pattern——
  //   <div class="cSUzvu"> (textLen 35)
  //     <div class="dkgDie" display:contents>  ← 每個 direct child 都是 div
  //       <div><a><button>Share</button></a></div>
  //     </div>
  //     <div class="dkgDie" display:contents>
  //       <div><a><button>Save</button></a></div>
  //     </div>
  //     <div class="dkgDie" display:contents>
  //       <div><a><button>Add as preferred on Google</button></a></div>
  //     </div>
  //   </div>
  //
  // 現有 `hideInsideArticleActionRows` 對此失靈：direct children 全是 div
  // → interactive ratio = 0% → 觸發排除條件 1「ratio < 50% 且 selfText ≥ 20」
  // → continue 跳過。那個排除條件是用來保護 ChinaTalk byline+actions wrapper
  // 不被整塊誤殺（v0.6.2 baseline）——不能放寬。所以用獨立規則遞迴找 button
  // 數量，補 action-row 規則的盲點。
  //
  // 保護設計（避免誤殺 byline row 本身或 post-header）：
  // - 自身 textLen ≤ 80：BBC cSUzvu 僅 35（Share/Save/Add），jXywqM 整個
  //   byline row 96（含作者+日期）→ 不命中，只動按鈕 cluster 這層。
  //   ChinaTalk byline+actions wrapper 含作者+日期+meta 遠 > 80 → 不命中
  // - 排除含 `<p>` / h1-h6：post-header 含 `<h1>` 必跳過（同 action-row）
  // - 排除含媒體：figure / picture / video / iframe 跳過
  // - 排除主文祖先（contains articleEl）：不砍到卡片層
  //
  // 為何最小 button 數 = 2：單一 button（例如 toggle 按鈕）可能是合法 CTA，
  // 多個才是 cluster 特徵。
  //
  // 為何再加「interactive 外文字 < 10」保護：
  // ChinaTalk byline-actions-wrapper fixture 實測：
  //   <div.meta-group><a>Jordan Schneider</a><span>Apr 21, 2026</span></div>
  //   <div.btn-group><button>like</button><span>41</span><button>comment</button>...</div>
  // textLen 只有 ~31（< 80）、button >= 3（>= 2）、無 p/h/媒體 → 上列 3 條件
  // 全中！會整塊砍掉作者+日期（v0.6.2 baseline 保護面）。差別在 ChinaTalk
  // 的 meta-group 把作者/日期文字放在 interactive **之外**（span 日期），
  // BBC cSUzvu 的所有文字全部在 `<button>` 或 `<a>` **裡面**。
  //
  // Interactive 定義（v0.6.19 擴展）：button + [role=button] + a[href]。
  // a[href] 也算是因為 Engadget 類站點把 "Add Engadget on Google" 做成
  // 純 `<a href="google.com/preferences">` 沒 button tag、沒 role=button——
  // 視覺上是按鈕但 DOM 是 link，舊定義（只含 button / role=button）漏算。
  // 擴展後 Engadget cluster 3 direct children 的全部文字都在 interactive
  // 裡（Add link + 2 button），outsideText = 0 → 命中。ChinaTalk meta-group
  // 只有 1 個 a[href]（作者）——buttonCount < 2 跳過保留；byline-actions-
  // wrapper 外層有 a[href]+button 共 4 個 interactive（滿足 >= 2），但作者
  // 在 a 內（算 interactive）+ 日期在 span 外 12 chars > 10 → outsideText 仍
  // 滿足保護（12 > 10），跳過保留。
  //
  // 為何要過濾 nested interactive：若 a > button（或 button > a），原始
  // querySelectorAll 兩個都收，其 textContent 在累加時會重複計到、outside
  // 被壓負。改成只取最外層 interactive 節點（祖先非 interactive），避免重疊。
  const BUTTON_CLUSTER_TEXT_MAX = 80;
  const BUTTON_CLUSTER_MIN_BUTTONS = 2;
  const BUTTON_CLUSTER_MAX_OUTSIDE_TEXT = 10;

  function isInteractiveLeaf(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.tagName === 'BUTTON') return true;
    if (node.tagName === 'A' && node.hasAttribute('href')) return true;
    const role = node.getAttribute && node.getAttribute('role');
    if (role === 'button') return true;
    return false;
  }

  function hideInsideArticleButtonClusters(articleEl, hidden, containers) {
    containers = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of containers) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (el.tagName === 'IFRAME' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;
      if (el.contains(articleEl)) continue; // 不砍主文祖先

      // 排除內容元素：含 p / h1-h6 / 媒體 → 不是純按鈕 cluster
      // 但 **button / a[href] / [role=button] 內部**的 p/h1-h6 不算——
      // Medium 類站點把 button label 包成 `<p>Listen</p>`、`<p>Share</p>`
      // 等，遞迴 querySelector 找到這些深層 p 會誤觸發內文保護、讓
      // action bar 本體逃過規則。只要 p/heading 從 el 到它的路徑上「不經過」
      // interactive 或 **已 jread hide 的祖先**，才算真正的內文。
      //
      // v0.6.23 加「已 hide 祖先」條件：Medium 的 clap count "442" 包在
      // `<p>` 外層是 `<div class="bi" role="tooltip">`（同 Member-only
      // badge pattern）——v0.6.22 hideDialogs 已 hide tooltip，但此 p 仍
      // 被 querySelector 抓到；path-check 沿祖先鏈只到 tooltip 就停（不是
      // interactive、但已 hide）→ 過去會把此 p 當真內文、action bar 被誤
      // 跳過。修法：路徑經過 `data-jread-hidden="1"` 的祖先也視為「已
      // 處理、不算真內文」，繼續掃下一個候選。
      const contentCandidates = el.querySelectorAll(
        'p, h1, h2, h3, h4, h5, h6, img, picture, video, iframe');
      let hasContentOutsideInteractive = false;
      for (const n of contentCandidates) {
        let p = n.parentElement;
        let wrappedByInteractiveOrHidden = false;
        while (p && p !== el) {
          if (isInteractiveLeaf(p)) { wrappedByInteractiveOrHidden = true; break; }
          if (p.dataset && p.dataset.jreadHidden === '1') {
            wrappedByInteractiveOrHidden = true; break;
          }
          p = p.parentElement;
        }
        if (!wrappedByInteractiveOrHidden) {
          hasContentOutsideInteractive = true;
          break;
        }
      }
      if (hasContentOutsideInteractive) continue;

      const text = norm(el.textContent);
      if (text.length > BUTTON_CLUSTER_TEXT_MAX) continue;

      // 遞迴收集所有 interactive 節點（button / [role=button] / a[href]），
      // 過濾掉「被另一個 interactive 祖先覆蓋」的 nested 節點——只取最外層，
      // 避免 textContent 在累加時重複計（例如 `<a><button>X</button></a>`
      // 會把 X 算兩次、outsideText 被壓成負值失去保護作用）。
      const allInteractive = el.querySelectorAll('button, [role="button"], a[href]');
      const topInteractive = [];
      for (const n of allInteractive) {
        let nested = false;
        let p = n.parentElement;
        while (p && p !== el) {
          if (isInteractiveLeaf(p)) { nested = true; break; }
          p = p.parentElement;
        }
        if (!nested) topInteractive.push(n);
      }
      if (topInteractive.length < BUTTON_CLUSTER_MIN_BUTTONS) continue;

      // 至少 1 個真正的 button / role=button（遞迴查、不限 topInteractive）：
      // 排除純 link cluster（3 條 a[href] 堆在一起的導覽 rail）——那類由
      // ancestor-sibling / share cluster / keyword 規則處理。BBC 類
      // `<a href><button></button></a>` 因 button 被 a[href] 覆蓋而不在
      // topInteractive 裡，但仍存在於 DOM descendant 中，這裡遞迴查保留命中。
      if (!el.querySelector('button, [role="button"]')) continue;

      // interactive 外的文字量：總文字 - 最外層 interactive 節點文字之和
      let interactiveText = 0;
      for (const n of topInteractive) interactiveText += norm(n.textContent).length;
      const outsideText = text.length - interactiveText;
      if (outsideText > BUTTON_CLUSTER_MAX_OUTSIDE_TEXT) continue;

      hide(el, hidden);
    }
  }

  // ---- 主文內：視覺性空白 spacer ------------------------------------------
  // 結構特徵：容器型元素 + 高度 > 60px + 文字 < 10 字 + 不含任何媒體/互動圖示
  // （img/picture/video/iframe/svg/button）。通常是 Substack / 現代 CSS-in-JS
  // layout 的 visual separator / spacer div，會造成段落與圖片間不自然留白。
  // jsdom 沒 layout，此規則不在 jsdom 測試中生效；真實 Chrome 才命中。
  const SPACER_MIN_HEIGHT = 60;
  const SPACER_TEXT_MAX = 10;

  function hideInsideArticleEmptySpacers(articleEl, hidden, containers) {
    containers = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of containers) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      // iframe / video / audio 本身是媒體，不是 spacer。cross-origin iframe
      // 的 textContent 空、querySelector 讀不到內部 DOM，rect 又有高度——三條
      // spacer 條件全命中，會被誤殺（2026-04-21 Dwarkesh YouTube embed 實測）。
      if (el.tagName === 'IFRAME' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;

      // blocker 檢查：若 wrapper 內含 visible 的媒體 / 互動元素就不算 empty
      // spacer。v0.7.26 techbang 修法：blocker 本身或祖先已被 jread-hidden
      // 的不算 visible blocker——否則 `DIV.content-top` 這類 wrapper 雖然
      // inner 全是已 hide 的 DFP 廣告 iframe，但 `querySelector('iframe')`
      // 仍 match、spacer rule skip，留下 CSS min-height 撐起的空白（Jimmy
      // 實測 techbang byline 下方 115px 空白）。通則：hidden element 已
      // 視覺上不佔空間、不該阻止 spacer rule 清其 wrapper。
      const blockers = el.querySelectorAll('img, picture, video, iframe, svg, button, input, select, textarea');
      let hasVisibleBlocker = false;
      for (const b of blockers) {
        let cur = b;
        let inHidden = false;
        while (cur && cur !== el && cur !== articleEl) {
          if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
          cur = cur.parentElement;
        }
        if (!inHidden) { hasVisibleBlocker = true; break; }
      }
      if (hasVisibleBlocker) continue;

      const text = (el.textContent || '').trim();
      if (text.length > SPACER_TEXT_MAX) continue;

      const rect = el.getBoundingClientRect();
      if (rect.height < SPACER_MIN_HEIGHT) continue;

      hide(el, hidden);
    }
  }

  // ---- 主文內：keyword heuristic ----------------------------------------
  function hideInsideArticleByKeyword(articleEl, hidden, containers) {
    // 限定容器型元素；避免誤殺內文標題/段落/圖片
    const candidates = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of candidates) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;           // 保留元素內部/本身跳過
      if (!shouldHideByKeyword(el)) continue;
      // 保護含 h1 的 wrapper（`article_header` / `post-header` / `entry-header`
      // 類 CMS 命名，class 含 `header` keyword 但實際包主文 h1 標題）。
      // 場景：ebc news.ebc.net.tw /news/society/548318 實測——detector promote
      // 升到 `#main_content` 含 `article_header` 為 scope 內子元素，但
      // `article_header` class 命中 NOISE_KEYWORD_RE 的 `header` 詞被 hide，
      // 連帶 h1 主標題消失。通則：article 內含 h1 的 wrapper 一律保留。
      // 內部的 controls / nav / share（article_header 內的 article_nav /
      // 聽新聞 button 等）由其他 rule（hideInsideArticleByKeyword 對子層
      // article_nav、hideInsideArticleAllButtons 對 buttons）各自處理。
      if (el.querySelector && el.querySelector('h1')) continue;
      // v0.7.83 修法：保護「含主文 anchor」的 wrapper——含 >= 100 chars 單一
      // p / 累計 p textLen >= 300 / 含 title-anchor element。場景：twz.com
      // 主文 wrapper class 為 `entry-content Article-bodyText paywall ...`，
      // 含 `paywall` keyword 命中 NOISE_KEYWORD_RE，但 wrapper 內含 47 個 p、
      // 8 個 h2、23K 字主文——CMS 用 `paywall` class 反向標「付費牆已解鎖內文」，
      // 語意完全相反。h1 不在此 wrapper（在外層 HEADER），既有 h1 guard 不及。
      // 通則：keyword 命中後若 wrapper 含主文 anchor（重用 wrapperContainsArticleAnchor
      // 三道判定），視為主文容器、不 hide——寧可留小 widget 也不要砍主文。
      // 風險：少數 widget（含 100+ chars description p 的 newsletter widget 等）
      // 會被豁免，但其他 rule（heading text / button / link / 等）兜底。
      // v0.7.84：strong keyword（article-sidebar / sidebar-wrapper / 等 CMS
      // 強語意 sidebar 命名）跳過 anchor guard——主文 wrapper 絕不會用這些
      // class 命名，sidebar widget 內含長描述 p 時 guard 會誤豁免，需強路徑。
      // v0.7.97 chinatimes 修法：anchor guard 改用 wrapperContainsMainContentP
      // 嚴格版（只看 p）—— 不再因「子樹含 class="title" 短 token」豁免，避免
      // subscribe-news-letter / recommended-article / premium-widget 等 widget
      // wrapper 內含 H3/H4.title 卻被誤當主文 wrapper 保護。twz paywall wrapper
      // 含 47 個長 p（命中 P-only guard）仍正確豁免——通則屬性不變。
      if (!shouldHideByStrongKeyword(el) && wrapperContainsMainContentP(el)) continue;
      hide(el, hidden);
    }
    // 另外掃 `<button>` + `<a>`：CTA / 訂閱 / 追蹤 / 分享 / 社群等類型常在
    // class 命名帶 subscribe / follow / share / social / comment / sponsor 等
    // keyword。button / a 不在 CONTAINER_SEL（會影響 action-row / button-
    // cluster 等規則判定），但 class keyword 命中的 button / a 就是雜訊、
    // 直接 hide。
    //
    // 實測場景：
    //   - line today `button.subscribe-button`（class 含 subscribe）
    //   - udn `a.btn btn-social btn-social--line`（LINE 分享連結，href="#"
    //     不含 social platform URL；class 含 social 才命中）
    //   - 各種 `a.share-facebook` / `a.social-link` / `a.comment-btn` 等
    //
    // 風險：主文連結（超連結 / wiki / 引用 / 人名）class 命名極少用 noise
    // keyword，實際會命中的 `<a>` 幾乎都是雜訊。
    for (const el of articleEl.querySelectorAll('button, a')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (!shouldHideByKeyword(el)) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：heading text heuristic ----------------------------------
  // 跨站 SPA 類站點（LINE Today / Next.js 類 emotion-style css-hash class）
  // 的 class 無語意，NOISE_KEYWORD_RE 無法命中文末推薦 / 相關列表 section。
  // 靠 heading 文字 match 跨站通用的 section 標題字樣（延伸閱讀 / 相關新聞 /
  // 更多文章 / 其他人也看 / 查看更多 等），hide 其所在的 `<section>` / `<aside>`
  // 容器。
  //
  // 為何 hide `closest('section, aside')` 而非 articleEl 的 direct child：
  // 前者精確命中「heading 所在的 section-level 容器」，只清該 section；
  // 後者會把 articleEl 下整個 direct child（如 column-wrapper）連同主文
  // 一起砍（chinatimes fixture 有「也許您會感興趣」h4 在 column-wrapper 的
  // 深層後代，direct-child 式 hide 會誤殺 column-wrapper 整個主文）。
  //
  // 保護：
  //   - heading text 長度 <= 20（主文副標不會這麼短剛好命中規則字）
  //   - 只 match h2/h3/h4（h1 是主標、h5/h6 罕用為推薦 section heading）
  //   - closest 結果為 null 時放棄 hide（conservative）
  //   - 不 hide 主文本身、主文祖先、PRESERVE_SEL 內部
  function hideInsideArticleByHeadingText(articleEl, hidden) {
    // 擴掃 h2-h4 + div/span（SPA 站如 LINE Today 用 div/span 做 header
    // 而非 semantic heading tag——「貼文 (166)」「熱門」「最新」「繼續看
    // 下去」都是 div/span）。對 div/span 只看 direct text（不抓子孫），
    // 且長度要 <= NOISE_HEADING_MAX_LEN，避免誤殺主文段落。
    const semanticHeadings = Array.from(articleEl.querySelectorAll('h2, h3, h4'));
    // div / span / p 候選（v0.7.28 加 p：cnyes 用 `<p>下一篇</p>` 當
    // navigation header；line today 用 div/span 包 section title）。對 p
    // 的 direct text 仍套 NOISE_HEADING_MAX_LEN <= 20 過濾，避免主文長段
    // 落誤命中（主文 p 通常 > 20 字）。
    const divSpanCandidates = Array.from(articleEl.querySelectorAll('div, span, p'))
      .filter(el => {
        const direct = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent).join('');
        const text = norm(direct);
        return text && text.length <= NOISE_HEADING_MAX_LEN;
      });
    const headings = semanticHeadings.concat(divSpanCandidates);
    for (const h of headings) {
      // 對 div/span 只用 direct text（heading tag 用 textContent）
      const isSemanticHeading = /^H[234]$/.test(h.tagName);
      const text = isSemanticHeading
        ? norm(h.textContent)
        : norm(Array.from(h.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(''));
      if (!text || text.length > NOISE_HEADING_MAX_LEN) continue;
      if (!NOISE_HEADING_TEXT_RE.test(text)) continue;
      if (isInPreserved(h)) continue;
      let target = h.closest('section, aside');
      // closest hit 分支也必須跑三道主文 anchor 保護——businessweekly blog 實測：
      // `<div class="line-sub-title">FOLLOW US</div>` 命中 `^follow\s+us`，
      // closest('section, aside') 直接命中 `<section class="row no-gutters
      // position-relative">`（包整篇主文 + 26 個長 p + 4 張圖），不加保護就
      // 連同主文整塊砍 → 使用者只看到 H1 標題、無內文。修法：closest target
      // 含主文 anchor 即視為過寬，改走 walk-up fallback 找更窄 wrapper。
      // 與 walk-up fallback 共用 wrapperContainsArticleAnchor 判定（單一 source
      // of truth，避免結構性通則漂移）。
      //
      // Fallback：若沒 section/aside 祖先（SPA 類 div-only 結構），改升級到
      // heading 所在 articleEl 的 direct child sub-branch——但僅當該 sub-
      // branch **不含主文長段落**（無 p 的 textLen > 100）才動，避免誤殺
      // 主文（chinatimes「也許您會感興趣」h4 在 column-wrapper 深層後代，
      // column-wrapper 自身含主文 p > 100，保護成立）。
      //
      // v0.7.28 cnyes 修法：原 fallback 只試 articleEl 的 direct child；若
      // 站點把整篇主文跟末段 widget 全包進 articleEl 的同一個直接子（cnyes
      // 是 `DIV.c9ky432 > ARTICLE.mfxje1x` 內含主文 p + 多個 widget），
      // direct child 含主文 → skip → widget 全留下。改進：從 heading 往上
      // walk、找「不含主文長段落」的最深 wrapper 當 target。停止條件：parent
      // 含主文 p（>= 100）或到 articleEl 邊界。這樣 cnyes 的 H3「延伸閱讀」
      // 會 walk 到 `DIV.c1ciwb2s`（不含主文）後 break、target 設為它。
      const targetTooWide = target && target !== articleEl &&
        !target.contains(articleEl) && wrapperContainsArticleAnchor(target, h);
      if (!target || target === articleEl || target.contains(articleEl) || targetTooWide) {
        // walk-up fallback 共用 helper（findSafeWrapperForHeading 含三道保護：
        // >= 100 chars long p / 累計 textLen >= 300 中文短段 / title-anchor wrapper）
        const lastSafeWrapper = findSafeWrapperForHeading(h, articleEl);
        if (!lastSafeWrapper) {
          // tail-cleanup fallback（v0.7.31 cnyes 末段討論區修法）：heading
          // 直接是 articleEl 的 child（無 wrapper）、walk-up 第一層即 articleEl
          // 就 break 失敗的情境。檢查 heading 之後的 sibling 是否全為 widget
          // （無主文長 p、textLen >= 100）—— 是的話 hide heading 自己 + 所有
          // 後續 sibling 直到 articleEl 結尾（文末雜訊統一清）。
          //
          // 安全 guard：heading 之前的 sibling 不動（保留主文段落）；只清
          // heading 自己 + 之後。若任一 next sibling 含主文長 p，立即 abort
          // 不清（避免誤殺主文）。
          if (h.parentElement === articleEl) {
            let allWidgetsAfter = true;
            let next = h.nextElementSibling;
            while (next) {
              let hasLongP2 = false;
              for (const para of next.querySelectorAll('p')) {
                if (norm(para.textContent).length >= 100) { hasLongP2 = true; break; }
              }
              if (hasLongP2) { allWidgetsAfter = false; break; }
              next = next.nextElementSibling;
            }
            if (allWidgetsAfter) {
              hide(h, hidden);
              let s = h.nextElementSibling;
              while (s) {
                const nx = s.nextElementSibling;
                if (!isInPreserved(s) && !(s.dataset && s.dataset.jreadHidden === '1')) {
                  hide(s, hidden);
                }
                s = nx;
              }
              continue;
            }
          }
          continue;
        }
        target = lastSafeWrapper;
      }
      if (!target) continue;
      if (target === articleEl) continue;
      if (!articleEl.contains(target)) continue;
      if (target.contains(articleEl)) continue;
      if (target.dataset && target.dataset.jreadHidden === '1') continue;
      hide(target, hidden);
    }
  }

  // ---- 主文內：link text heuristic（CTA / 外連 / 訂閱推廣）-----------------
  // 對主文內 `<a>` 元素：text 命中 NOISE_LINK_TEXT_RE 則 hide。若 `<a>` 的
  // parent 是 `<p>` / `<div>` 且 a 文字占 parent 文字 80% 以上，hide parent
  // 整個段落；否則只 hide a 本身。
  function hideInsideArticleByLinkText(articleEl, hidden) {
    // 掃 `<a>` + `<button>`——CTA 按鈕類（訂閱 / 追蹤 / 關注）通常是 button
    // 而非 a，舊版只掃 a 漏網
    const links = articleEl.querySelectorAll('a, button');
    for (const a of links) {
      const text = norm(a.textContent);
      if (!text) continue;
      const strictHit = NOISE_LINK_TEXT_STRICT_RE.test(text);
      if (!strictHit) {
        if (text.length > NOISE_LINK_TEXT_MAX_LEN) continue;
        if (!NOISE_LINK_TEXT_RE.test(text)) continue;
      }
      if (isInPreserved(a)) continue;
      if (a.dataset && a.dataset.jreadHidden === '1') continue;
      // 嘗試 hide parent p / div 若 a 文字占 parent 文字 80% 以上（整個段
      // 落都是 CTA）
      const parent = a.parentElement;
      let target = a;
      if (parent && (parent.tagName === 'P' || parent.tagName === 'DIV' || parent.tagName === 'LI')) {
        if (parent === articleEl) { /* 不升級 */ }
        else if (parent.contains(articleEl)) { /* 不 hide 主文祖先 */ }
        else {
          const parentText = norm(parent.textContent);
          if (parentText.length > 0 && text.length / parentText.length >= 0.8) {
            target = parent;
          }
        }
      }
      if (target.dataset && target.dataset.jreadHidden === '1') continue;
      if (target === articleEl) continue;
      if (target.contains && target.contains(articleEl)) continue;
      hide(target, hidden);
    }
  }

  // ---- 主文內：hashtag link cluster（文末 #tag 列表）---------------------
  // 結構特徵（非站點特判）：article 內任一 P / DIV 的「子 link」中，**多數
  // 文字以 # 開頭**且**自身 direct text 幾乎全是這些 hashtag 連結**——這是
  // 跨站常見的文末 tags / labels widget（cna 實測：文末「#一帶一路 #中國
  // #台灣 #伊斯蘭國...」，每個都是 `<a>#...</a>` 在無 class 的 P 內）。
  // 對 reader mode「純閱讀」定位、tags 是 navigation chrome，不屬於主文。
  //
  // 通則條件（避免誤殺主文段落含個別 #hashtag 字串）：
  //   - container 內 a 數量 >= HASHTAG_MIN_COUNT
  //   - 其中 ≥ HASHTAG_RATIO 的 a.textContent 以 # 開頭
  //   - container 的 direct text（不抓子孫）<= HASHTAG_NARRATIVE_TEXT_MAX
  //     字（避免「敘述+一個 #tag link」的主文段落）
  //   - container 內**所有非 anchor 的長文字（>= 50 字 block）** 數 = 0
  //     （避免誤殺含主文 p 的外層 wrapper：cna 真實 DOM 中 DIV.paragraph
  //      含 5 段長 p + articlekeywordGroup，沒此 guard 會把整個 paragraph
  //      wrapper hide、主文消失。實測 2026-05-13 fixture sanity check 才
  //      抓到此 bug，補上 forcing function）。
  const HASHTAG_MIN_COUNT = 3;
  const HASHTAG_RATIO = 0.8;
  const HASHTAG_NARRATIVE_TEXT_MAX = 5;
  const HASHTAG_NON_ANCHOR_BLOCK_MIN_LEN = 50;
  function hideInsideArticleHashtagClusters(articleEl, hidden) {
    const candidates = articleEl.querySelectorAll('p, div');
    for (const el of candidates) {
      if (el === articleEl) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (isInPreserved(el)) continue;
      if (el.contains && el.contains(articleEl)) continue;
      const anchors = el.querySelectorAll('a');
      if (anchors.length < HASHTAG_MIN_COUNT) continue;
      let hashtagHits = 0;
      for (const a of anchors) {
        if (norm(a.textContent).startsWith('#')) hashtagHits++;
      }
      if (hashtagHits / anchors.length < HASHTAG_RATIO) continue;
      // direct text 扣除子孫 = 自身 textNode
      const directText = norm(Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent).join(''));
      if (directText.length > HASHTAG_NARRATIVE_TEXT_MAX) continue;
      // 主文 guard：el 內若有任一非 anchor 的長 text block（p / h* / li /
      // blockquote 自身 textContent >= 50 字），代表 el 是含主文的 wrapper、
      // 非純 tag cluster。skip。
      let hasMainBlock = false;
      for (const block of el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote')) {
        if (block.closest && block.closest('a')) continue;
        if (norm(block.textContent).length >= HASHTAG_NON_ANCHOR_BLOCK_MIN_LEN) {
          hasMainBlock = true;
          break;
        }
      }
      if (hasMainBlock) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：figure 內 position:absolute credit overlay --------------
  // 結構特徵（非站點特判）：editorial 站點（BBC / Guardian / NYT / WaPo 類）
  // 慣例在 `<figure>` 主圖右下角浮一個 `position: absolute` 的 SPAN/DIV
  // credit overlay（深色背景 + 淺色字、約 12px font），文字內容多半重複
  // 出現在 `<figcaption>` 的 "(Credit: ...)" 段落裡。reader mode 下：
  //   1. 圖片寬度被 styler 重排，原站 absolute top/left 算的位置基準失效
  //      → overlay 落在圖片內容區域上、跟圖案紋路混在一起遮文字
  //   2. 即使位置正確，圖片下方的 `<figcaption>` 已含 "(Credit: ...)" 重複
  //      info，overlay 純屬視覺裝飾、無閱讀價值
  // 通則：當 `<figure>` 含 `<figcaption>` 時，figcaption 是 canonical caption；
  // 同 figure 內任何 `position: absolute|fixed` 且帶 direct text 的 SPAN/DIV/
  // P/SMALL 視為 credit overlay → hide。位置定義是純結構特徵（CSS computed
  // position），無 hostname / class 綁定，跨所有 editorial 站通用。
  //
  // 為何 figcaption 要求是 guard：若 figure **沒有** figcaption，absolute
  // overlay 可能是該 figure 唯一的說明文字，hide 掉就完全失去 caption——
  // 此 case 不修。BBC 三張圖每張都有 figcaption，guard 自然滿足。
  //
  // 為何不檢查 text 是否子集 figcaption：嚴格子集判定會被 BBC 「Courtesy of
  // the Warden and Fellows of Merton College Oxford」（overlay）vs 「(Credit:
  // Courtesy of the Warden and Fellows of Merton College Oxford)」（figcaption）
  // 微妙差異干擾（前者無括號、後者有 "Credit:" 前綴），用 substring 判太脆。
  // 既然 figcaption 已是 canonical caption，overlay 一律當裝飾砍。
  //
  // 為何只看 SPAN/DIV/P/SMALL：避開 IMG/PICTURE/VIDEO（媒體本身可能 absolute
  // ，例如 padding-hack pattern）+ FIGCAPTION 自己 + BUTTON（hideInsideArticle-
  // AllButtons 處理）+ SVG（icon overlay 可接受不動，無 direct text）。
  function hideInsideArticleAbsoluteCreditOverlays(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    for (const fig of articleEl.querySelectorAll('figure')) {
      if (fig === articleEl) continue;
      if (fig.dataset && fig.dataset.jreadHidden === '1') continue;
      const figcap = fig.querySelector('figcaption');
      if (!figcap) continue; // canonical caption 缺席就不動
      for (const el of fig.querySelectorAll('span, div, p, small')) {
        if (el === figcap) continue;
        if (el.contains && el.contains(figcap)) continue; // 不砍 figcaption 祖先
        if (figcap.contains && figcap.contains(el)) continue; // figcaption 內的 overlay 不動（可能是真說明）
        if (el.dataset && el.dataset.jreadHidden === '1') continue;
        // direct text（不抓子孫）—— wrapper 沒 direct text 不視為 overlay
        const directText = norm(Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent).join(''));
        if (!directText.length) continue;
        const cs = window.getComputedStyle(el);
        if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
        hide(el, hidden);
      }
    }
  }

  // ---- 主文內：sidebar column（高 linkDensity + 低文字量 vs 兄弟）--------
  // 結構特徵（非站點特判）：主文容器內任一 container，其 direct children
  // 中某個 child Cs 滿足：
  //   - Cs.textLen < 主要 sibling 的 10%
  //   - Cs linkDensity > 0.5
  // → Cs 為 sidebar column（導覽/相關列表/訂閱/Listen-on 卡片等），隱藏之。
  //
  // 場景（Substack podcast-post / Dwarkesh）：`<article>` tag 把整個
  // main-content-and-sidebar flex 2-col 包進來，sidebar 身為 article 後代
  // 躲過 outside-article / ancestor-sibling 所有規則。單欄文章不觸發（主欄
  // 本身還沒 500 字就 continue）。
  //
  // 為何不檢查 display: flex / grid：
  //   - 判斷重心是「content ratio + link density」，layout 方式不影響是否該清
  //   - 省去 jsdom 對 computed style display / flex-direction 的相容性麻煩
  //
  // 為何保留元素 scope：article 內自帶 <figure><figcaption> 時，figcaption
  // 若 linkDensity 高也不該砍——PRESERVE_SEL closest() 已擋掉。
  const SIDEBAR_COLUMN_TEXT_RATIO = 0.1;
  const SIDEBAR_COLUMN_MIN_LINK_DENSITY = 0.5;
  const SIDEBAR_COLUMN_MIN_MAIN_TEXT = 500;
  // 條件 C（v0.7.95 esmchina /news/14116 修法）——sidebar column 的「中等
  // 大小但仍是 link widget」場景。esmchina 實測：`DIV.container > [.article-
  // title, .col-md-9.article-left(20K chars 主文), .col-md-3.rightsection
  // (4.7K chars 全 widget link)]`，sidebar.textLen / main.textLen = 0.23，
  // 不命中條件 A 的 0.1 ratio，但 sidebar 仍是高 link density 的 widget
  // cluster（近期热点 / EE直播间 / 在线研讨会 / 热门标签）。
  // 通則：main 至少是 sibling 3 倍 + sibling linkDensity > 0.5 + sibling
  // textLen >= 200（避免單行短元素誤判）→ hide。Substack Dwarkesh 14.3x
  // 早就命中條件 A，本條額外 cover 商業類「Bootstrap 兩欄主文+sidebar」
  // 中等大小 sidebar，single-column 文章（無 sibling）不觸發。
  const SIDEBAR_COLUMN_MAIN_SIBLING_RATIO = 3;
  const SIDEBAR_COLUMN_MIN_SIBLING_TEXT = 200;
  // 條件 B（<aside> tag）——sidebar column 的 `<aside>` tag 特判閾值：
  // `<aside>` 是 HTML5 語意「次要內容」tag。article 內 aside 只要
  // rectH > 400 即視為 sidebar（導覽 / 廣告 / 相關列表）hide——rectH 門檻
  // 已排除 pull-quote（通常 < 300px 簡單結構）。不做 textLen 相對比值：
  // chinatimes 實測 aside 含 10 條熱門新聞 ~1389 chars vs 主文當下 2457
  // chars（時序 race：推薦閱讀未 lazy-load 完時 main 偏低）打在 0.5
  // ratio 上漏網；Engadget 過往靠此條 B 命中也不依賴 ratio，因為 aside
  // 本來就被廣告 placeholder 稀釋 textLen 接近 0。
  const SIDEBAR_ASIDE_MIN_HEIGHT = 400;

  function hideInsideArticleSidebarColumns(articleEl, hidden, containers, promotedTitleHead) {
    containers = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    // v0.7.95：articleEl 自身也納入候選 container（esmchina /news/14116
    // 修法）——esmchina 的 articleEl = DIV.container 本身就是 Bootstrap row、
    // main(col-md-9) + sidebar(col-md-3) 直接是 articleEl 的 children。
    // 舊版 skip articleEl 導致 condition A/B/C 全漏判。條件本身的
    // textLen >= 500 + sibling ratio + linkDensity guard 已足夠避免誤殺
    // 「article > [header, main, footer]」這類正常 direct child 結構。
    const candidates = [articleEl, ...Array.from(containers).filter(c => c !== articleEl)];
    for (const el of candidates) {
      if (el !== articleEl && isInPreserved(el)) continue;
      const children = Array.from(el.children);
      if (children.length < 2) continue;

      const stats = children.map(c => {
        const text = norm(c.textContent);
        let linkLen = 0;
        if (c.querySelectorAll) {
          for (const a of c.querySelectorAll('a')) {
            linkLen += norm(a.textContent).length;
          }
        }
        return { el: c, textLen: text.length, ld: text.length ? linkLen / text.length : 0 };
      });

      // 找主欄：文字量最大者
      let main = stats[0];
      for (const s of stats) if (s.textLen > main.textLen) main = s;
      if (main.textLen < SIDEBAR_COLUMN_MIN_MAIN_TEXT) continue;

      for (const s of stats) {
        if (s === main) continue;
        if (isInPreserved(s.el)) continue;
        // promoted title heading 白名單（v0.7.97 Stratechery 修法）：detector
        // promote 命中的 title heading（h1-h4），若 sibling 是該 heading 或含該
        // heading 則 skip。理由：WordPress block theme 預設 post-title 是 <a>
        // 包整個 heading（自連結到文章），導致 linkDensity = 1 + textLen 短，
        // 條件 A（textLen < main×10% + ld > 0.5）直接命中、主標題被當 widget
        // sidebar 砍。與 narrowPromotedSiblings 共用同一條白名單機制，跨 rule
        // 一致保護「promote 升級後的真標題」不被任何 cleaner rule 誤殺。
        // promoted title heading 白名單（v0.7.97 Stratechery 修法）：detector
        // promote 命中的 title heading（h1-h4），若 sibling 是該 heading 或含該
        // heading 則 skip。理由：WordPress block theme 預設 post-title 是 <a>
        // 包整個 heading（自連結到文章），導致 linkDensity = 1 + textLen 短，
        // 條件 A（textLen < main×10% + ld > 0.5）直接命中、主標題被當 widget
        // sidebar 砍。與 narrowPromotedSiblings 共用同一條白名單機制，跨 rule
        // 一致保護「promote 升級後的真標題」不被任何 cleaner rule 誤殺。
        if (promotedTitleHead) {
          if (s.el === promotedTitleHead) continue;
          if (s.el.contains && s.el.contains(promotedTitleHead)) continue;
        }
        // 條件 A：textLen < main × 10% AND linkDensity > 0.5
        // （Substack Dwarkesh 高 link-density 卡片命中路徑）
        if (s.textLen < main.textLen * SIDEBAR_COLUMN_TEXT_RATIO &&
            s.ld > SIDEBAR_COLUMN_MIN_LINK_DENSITY) {
          // v0.7.109：byline 白名單——短篇（textLen < 200）+ 文字命中
          // BYLINE_TEXT_RE（"By X" / 日期 pattern / 中文撰文 等）→ skip。
          // healthsystemtracker `.entry-meta` 場景：author 名都是 link 導致
          // ld > 0.5、總文 ~80 chars 落入「sibling 太小且 link 密」誤判；
          // byline 結構特徵跨站通用，誤殺風險可控。
          const sText = norm(s.el.textContent || '');
          if (s.textLen < BYLINE_MAX_TEXT_LEN && BYLINE_TEXT_RE.test(sText)) continue;
          hide(s.el, hidden);
          continue;
        }
        // 條件 C：main >= sibling × 3 AND sibling linkDensity > 0.5
        //         AND sibling textLen >= 200
        // （Bootstrap 兩欄主文+widget sidebar 場景，esmchina 類）
        // 比條件 A 寬鬆但仍要求 sibling 是 link-heavy widget cluster + 有
        // 一定篇幅（avoid 單行短 nav 誤判），與條件 A 的「極小極密」場景
        // 互補不重疊。
        if (main.textLen >= s.textLen * SIDEBAR_COLUMN_MAIN_SIBLING_RATIO &&
            s.ld > SIDEBAR_COLUMN_MIN_LINK_DENSITY &&
            s.textLen >= SIDEBAR_COLUMN_MIN_SIBLING_TEXT) {
          hide(s.el, hidden);
          continue;
        }
        // 條件 B：child 是 <aside> tag + rectH > 400
        // `<aside>` 是 HTML5 語意「次要內容」tag；若 rectH > 400 已排除
        // pull-quote（通常簡單結構 < 300px）。不再檢查 textLen 比值——
        // chinatimes 實測 aside 含 10 條熱門新聞 + section header 約 1389
        // chars，主文當下 2457 chars（時序 race：相關閱讀還沒 lazy-load 完
        // 時 main 文字量偏低），aside/main = 0.565 打在保守 0.5 ratio 上
        // 漏網。aside tag + rectH > 400 的**絕對結構特徵**夠強，textLen
        // 相對比值只會把這類邊緣場景當 false negative 放過。
        // Wikipedia 類 infobox 多用 `<table class="infobox">` 非 <aside>；
        // NYT pull-quote 用 <aside> 但 rectH < 300——通則安全。
        if (s.el.tagName === 'ASIDE') {
          const r = s.el.getBoundingClientRect &&
            s.el.getBoundingClientRect();
          if (r && r.height > SIDEBAR_ASIDE_MIN_HEIGHT) {
            hide(s.el, hidden);
          }
        }
      }
    }
  }

  // ---- 主文內：absolute / fixed overlay 砍除 -----------------------------
  //
  // 場景：TBIJ thebureauinvestigates.com 實測——兩處 overlay 浮動側欄：
  //   (1) `<aside class="tb-o-fixed-left-sidebar__inner">` position absolute
  //       z-index 1，"We expose injustice / Bureau Insider" 品牌宣傳
  //   (2) `<div class="tb-c-story-authors tb-js-fixed-sidebar-stop-here">`
  //       position absolute z-index 2，文末 "About The Authors / Niamh
  //       McIntyre 報導 / Misbah Khan 報導 / Mark Sellman" 作者 bio
  // 原 design 在寬 viewport 浮在主文兩側、reader card 縮窄後與內文完全
  // 重疊、文字疊在一起。
  //
  // 通則：reader mode 的「flow > overlay」原則對任何 position:
  // absolute / fixed overlay 適用（不限 `<aside>` tag）。HTML5 `<aside>`
  // 是 semantic 次要內容、`<div>` 帶 absolute 也是 visual overlay；對
  // reader 都是雜訊。v0.7.111 把 v0.7.110 的 `<aside>`-only 規則放寬到
  // 任意 tag。
  //
  // 邊界保護：
  // - PRESERVE_SEL 內 skip（figure / blockquote / summary 內 absolute
  //   caption overlay 是設計一部分）
  // - position 必須是 absolute 或 fixed（static / relative / sticky 保留）
  // - articleEl 自身不算
  // - 主文段落保護：若 element 包含 > 500 chars 的單一 `<p>` 後代，視為
  //   主文流的一部分（絕對定位的主文容器，雖罕見但保留），不 hide。
  // - 父高度殘留修法（v0.7.112）：hide absolute child 後，父若 stylesheet
  //   `min-height` 或 `height` 預留空間給 absolute child（典型 hero header
  //   `min-height: 720px` 包 hero img + absolute title overlay），會留下
  //   大塊空白。一併清直接父的 min-height + height 為 0/auto。
  //   通則：absolute child 是為 overlay 而生的「視覺擴展」，父保留空間
  //   是配合它；child hidden 後保留空間就是 stale 設計殘留。
  function hideInsideArticleAbsoluteOverlays(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const parentHeightResets = [];
    const seenParents = new Set();
    for (const el of articleEl.querySelectorAll('*')) {
      if (el === articleEl) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (isInPreserved(el)) continue;
      let cs;
      try { cs = window.getComputedStyle(el); } catch (_) { continue; }
      if (!cs) continue;
      if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
      // 主文段落保護：含 > 500 chars 的單一 <p> 後代 → 視為主文，skip
      let hasLongParagraph = false;
      const ps = el.querySelectorAll && el.querySelectorAll('p');
      if (ps) {
        for (const p of ps) {
          if ((p.textContent || '').length > 500) {
            hasLongParagraph = true;
            break;
          }
        }
      }
      if (hasLongParagraph) continue;
      hide(el, hidden);
      // 清直接父的 min-height/height 殘留（避免父預留 absolute child 空間
      // 後仍空著一大塊）
      const parent = el.parentElement;
      if (parent && parent !== articleEl && !seenParents.has(parent)) {
        seenParents.add(parent);
        let pcs;
        try { pcs = window.getComputedStyle(parent); } catch (_) { pcs = null; }
        if (pcs && (parseFloat(pcs.minHeight) > 0 || parseFloat(pcs.height) > 100)) {
          parentHeightResets.push({
            el: parent,
            prev: snapshotStyles(parent, ['min-height', 'height'])
          });
          applyImportant(parent, { 'min-height': '0', 'height': 'auto' });
        }
      }
    }
    hidden.__absoluteOverlayParentHeight = parentHeightResets;
  }

  function restoreAbsoluteOverlayConverted(hiddenEls) {
    const arr = hiddenEls && hiddenEls.__absoluteOverlayParentHeight;
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
    }
  }

  // ---- 主文內：廣告位 grid / flex cell 被 AdBlocker 清後殘留的欄位寬度 ----
  // 結構特徵（非站點特判）：原站用 CSS Grid / Flex 做「主文 + 廣告側欄」多
  // 欄 layout，AdBlocker（或站點自身）把廣告元素 hide 後，**grid cell / flex
  // child 佔的寬度還在**——grid-template-columns 仍定義 300px 給右欄，主文
  // 被擠成窄欄。Engadget 實測：article 內 grid-template-columns = `[main-
  // start] 196px [main-end right-start] 300px [right-end]`，右欄 ad 被擋、
  // 但 300px 硬性保留，主文只剩 196px。
  //
  // 通則：若 display: grid / flex 的 container 有「某個 direct child 被隱藏
  // （data-jread-hidden="1" 或 rect 0×0）」，代表原設計中的某一欄空了——
  // 把 container 退化成 block + 清 grid-template-columns，讓主文回到自然
  // block 寬度。
  //
  // 為何必須走 JS 而非 CSS：
  // - CSS selector 無法條件性判斷 computed display:grid（沒有 pseudo-class
  //   on computed style）
  // - `*:has(> [data-jread-hidden="1"])` 太廣（所有 container 都中），且 CSS
  //   無法分辨那是「側欄被清」還是「有意 hide 的 inline decoration」
  //
  // 邊界保護（避免誤殺 intentional 多欄）：
  // - 只處理 grid 或 flex-row container（flex-column / inline 不動）
  // - 要求 hidden child 的 rect.width / rect.height 反映它「曾佔 layout 空間」
  //   （rect.width > 0 或者 dataset.jreadHidden="1"）
  // - 保留 container 原 inline display / grid-template 讓 restore 還原
  const COLLAPSE_ATTR = 'data-jread-collapsed';

  function collapseGridWithHiddenCell(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const collapsed = [];
    // 掃 article 內所有可能的 grid / flex-row container，**含 articleEl 自己**
    // （v0.7.24 ttv.com.tw 修法）：ttv 的 `DIV.news-article.fitVids` 本身是
    // `display: flex`（左主文 + 右 sidebar 兩欄 layout），sidebar 被 narrow
    // hide 後 article-body 是唯一 flex child、沒 `flex: 1` → 維持 shrink-to-
    // fit 被壓到 288px、figure 塌到 0×0 → 主圖消失。舊版 for-loop 只掃
    // `articleEl.querySelectorAll('*')` 天生不含 articleEl 自己、漏處理。
    // 通則：articleEl 若是 flex-row/grid + 有 hidden child、直接 children 間
    // 失衡 → 退化。
    const candidates = [articleEl, ...articleEl.querySelectorAll('*')];
    for (const el of candidates) {
      if (el !== articleEl) {
        if (el.dataset && el.dataset.jreadHidden === '1') continue;
        if (isInPreserved(el)) continue;
      }
      const cs = window.getComputedStyle(el);
      const isGrid = cs.display === 'grid' || cs.display === 'inline-grid';
      const isFlexRow = (cs.display === 'flex' || cs.display === 'inline-flex') &&
        (cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse');
      const children = Array.from(el.children);
      if (children.length < 1) continue;
      // 分類 children：hidden vs visible；同時記下是否有 visible float child
      // （判斷是否為傳統 float 多欄 layout）
      let hasHiddenChild = false;
      let hasVisibleFloatChild = false;
      const visibleChildren = [];
      for (const c of children) {
        const ccs = window.getComputedStyle(c);
        const isHidden = (c.dataset && c.dataset.jreadHidden === '1') ||
          ccs.display === 'none' || ccs.visibility === 'hidden';
        if (isHidden) { hasHiddenChild = true; continue; }
        visibleChildren.push(c);
        if (ccs.float && ccs.float !== 'none') hasVisibleFloatChild = true;
      }
      // 條件 C（新，傳統 float layout + hidden sibling）：container 不是
      // grid / flex-row 但 direct children 用 `float: left/right` + 固定
      // width 做多欄 layout（chinatimes `.column-wrapper.clear-fix` 實測：
      // column-left float:left width:308px + aside.column-right float:right
      // width:300px）。aside 被 cleaner hide 後 column-left 仍鎖寬、右側
      // 空白殘留。通則：float + hidden sibling 代表原設計某欄已空、剩下
      // visible float child 該撐滿 container——清 float + width 讓它回到
      // 自然 block 流。
      const isFloatLayout = !isGrid && !isFlexRow && hasVisibleFloatChild;
      if (!isGrid && !isFlexRow && !isFloatLayout) continue;
      // 條件 A（既有 v0.6.12）：有 hidden sibling → 退化
      //   要求 children.length >= 2，避免「單 child 的 container 正好 display:none」
      //   這種無意義情境誤動
      //   條件 C 的 float 場景也走這條：hidden sibling + visible child 就退化
      const triggerHiddenSibling = hasHiddenChild && children.length >= 2 &&
        visibleChildren.length >= 1;
      // 條件 B（新）：grid underfill——visible children 全在同一 row 但寬度
      // 總和 < container 70%，代表 grid 保留大片空白欄位壓擠主文
      // （BBC 24-col design system 場景：container 用 repeat(24, ...) grid，
      //  child 明確 `grid-column: 6 / span 12` 只佔中間 12 欄，沒 sibling
      //  佔剩餘 12 欄——原站設計預期右側放東西但這篇沒放，導致主文被壓窄）
      //
      // 僅對 grid 做、不對 flex-row 做：flex-row child 寬度未撐滿 container
      // 通常是 `justify-content: center/flex-start` 的自然寬度流，不是被
      // layout 鎖死；grid 則是被 grid-template-columns 明確分配 track。
      //
      // 額外保護：
      // - 只處理單 row grid（visible children top 都相同）——2D grid（gallery
      //   等）child 跨多 row 時 sum < container 是正常的，不該 collapse
      // - container 寬度 >= 100 才處理——jsdom 等無 layout engine 環境 rect 全 0
      //   會自動 skip；極窄 container 也避免雜訊
      let triggerGridUnderfill = false;
      if (!triggerHiddenSibling && isGrid && visibleChildren.length >= 1) {
        const containerRect = el.getBoundingClientRect();
        if (containerRect.width >= 100) {
          const firstTop = visibleChildren[0].getBoundingClientRect().top;
          const allSameRow = visibleChildren.every(c =>
            Math.abs(c.getBoundingClientRect().top - firstTop) < 5);
          if (allSameRow) {
            let sumWidth = 0;
            for (const c of visibleChildren) sumWidth += c.getBoundingClientRect().width;
            if (sumWidth < containerRect.width * 0.7) triggerGridUnderfill = true;
          }
        }
      }
      // 條件 D（v0.7.110）：傳統 float layout——visible children 全部 float
      // → 視為 multi-col 設計，reader card 縮窄下 children 寬度 + margin
      // 已偏離設計，collapse 為 block flow。不需 hidden sibling。
      //
      // 兩條子路徑：
      //   D1（多 child）：visibleChildren.length >= 2 + 全 floated。TBIJ
      //   第一個 tb-o-story-section（sidebar + body）命中。
      //   D2（單 child，v0.7.110 後續修正）：visibleChildren.length === 1
      //   + 該 child floated + 該 child 寬度 < 父寬 × 70%。TBIJ 其餘 N 個
      //   tb-o-story-section 每個只有 body（無 sidebar）但 stylesheet 給
      //   `width: 50%; margin-left: 25%`，rect 寬 274 (~ 50%) < 547 × 70%，
      //   命中。
      //
      // 邊界保護：
      // - 單 child 必須 < 70% 父寬：避免誤殺「單個 full-width floated 容器」
      //   類合理設計（floated child 寬度 ≈ 父寬時 float 對視覺無影響、
      //   保留不動）
      // - **所有** visible child 都 floated（混合 floated + 非 floated 通常
      //   是內文 + pull-quote 結構，保留 pull-quote 不動）
      // - PRESERVE_SEL 內 skip（既有 isInPreserved 已處理）
      // - container rect width >= 100（jsdom 無 layout engine 環境 rect 全 0
      //   會自動 skip；極窄 container 也避免雜訊）
      // 不對 grid / flex-row 容器做（既有條件 A/B 處理）；專門針對傳統
      // float-based multi-column / centered-narrow-body layouts。
      let triggerFloatLayoutAllChildren = false;
      if (!triggerHiddenSibling && !triggerGridUnderfill && isFloatLayout &&
          visibleChildren.length >= 1) {
        const allFloated = visibleChildren.every(c => {
          const ccs = window.getComputedStyle(c);
          return ccs.float && ccs.float !== 'none';
        });
        if (allFloated) {
          if (visibleChildren.length >= 2) {
            triggerFloatLayoutAllChildren = true; // D1
          } else {
            // D2：單 floated child + rect 寬度 < 父寬 70% → centered-narrow
            // 設計，collapse 撐滿
            const containerRect = el.getBoundingClientRect();
            const childRect = visibleChildren[0].getBoundingClientRect();
            if (containerRect.width >= 100 &&
                childRect.width < containerRect.width * 0.7) {
              triggerFloatLayoutAllChildren = true; // D2
            }
          }
        }
      }
      if (!triggerHiddenSibling && !triggerGridUnderfill && !triggerFloatLayoutAllChildren) continue;
      // 記下 container 的原 inline style 以便 restore
      // v0.7.104：擴增 width/max-width/margin-left/margin-right reset 軌道——
      // BBC byline `.dWzpHk` stylesheet rule 給 `width:458px` + `margin:0 auto`
      // 配合 grid 第二欄寬，collapse 後若不清 container 自身 width/margin，
      // 458px + auto-center 殘留會把 byline 推到 reader card 中央偏右（margin
      // 自動分 75px each side）。同樣的修法也覆蓋其他「stylesheet 給 grid
      // 容器固定寬度」case。
      const CONTAINER_PROPS = [
        'display', 'grid-template-columns', 'grid-template-rows',
        'grid-template-areas', 'flex-direction',
        'width', 'max-width', 'margin-left', 'margin-right'
      ];
      collapsed.push({ el, kind: 'container', prev: snapshotStyles(el, CONTAINER_PROPS) });
      // 用 !important 確保贏過原站的 grid rule（Tailwind 的 `md:grid-cols-*`
      // 等 class 本身 specificity 不是 !important，但多欄定義 rule 可能
      // 有 utility 特殊 priority；保險起見用 important）
      const containerDecls = {
        'display': 'block',
        'grid-template-columns': 'none',
        'grid-template-rows': 'none',
        'grid-template-areas': 'none',
        'width': '100%',
        'max-width': 'none',
        'margin-left': '0',
        'margin-right': '0'
      };
      if (isFlexRow) containerDecls['flex-direction'] = 'column';
      applyImportant(el, containerDecls);
      if (el.dataset) el.dataset.jreadCollapsed = '1';

      // 關鍵：collapse container 只改了父的 display，但 children 身上的
      // Bootstrap `col-md-8` 類 class（`flex: 0 0 66.67%; max-width: 66.67%`）
      // 或 Tailwind `col-span-*` 等 utility 寬度定義**仍會生效**——child 會
      // 維持原來的 N/12 欄寬度，collapse 等於沒做。Lawfaremedia 實測：
      // `.row` 被 collapse 後 `.col-md-8` 仍 405px wide（608 × 66.67%），
      // 主文被擠在左 2/3、右邊 200px 空白。
      // 修法：對 visible 的 direct children 強制 `flex: initial` + `max-width:
      // none` + `width: auto`，讓 children 恢復 block 預設「撐滿父寬度」。
      // 只用 longhand，避免 shorthand serialization 在不同瀏覽器 / jsdom
      // 不一致。longhand !important inline 能贏過 Bootstrap 的
      // `flex: 0 0 66.67%` shorthand stylesheet rule。float 清零：chinatimes
      // 類傳統多欄 float layout，aside 被 hide 後剩下 float: left 的
      // column-left 仍會維持 308px 固定寬、不撐滿 container。
      // v0.7.110：加 margin-left/right reset——TBIJ tb-o-story-section__body
      // stylesheet `margin-left: 25%` 在原 1152 寬下偏移 288，reader card
      // 547 寬下仍 25% = 137px，body 維持左偏狀態。clear float 不夠、
      // 還要清 margin 才能讓 body 撐滿父寬。
      const CHILD_PROPS = [
        'flex-grow', 'flex-shrink', 'flex-basis',
        'width', 'max-width', 'grid-column', 'float',
        'margin-left', 'margin-right'
      ];
      const CHILD_DECLS = {
        'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto',
        'width': 'auto', 'max-width': 'none', 'grid-column': 'auto', 'float': 'none',
        'margin-left': '0', 'margin-right': '0'
      };
      for (const c of visibleChildren) {
        if (!c.style) continue;
        collapsed.push({ el: c, kind: 'child', prev: snapshotStyles(c, CHILD_PROPS) });
        applyImportant(c, CHILD_DECLS);
      }
    }
    // 把 collapsed 紀錄接到 hidden 陣列尾（共享 restore）——但格式不同，
    // restore 流程要能識別。為了不動 restore 簽章，存到 hidden.__collapsed
    // （sidecar array，不是正常 item）。
    hidden.__collapsed = collapsed;
  }

  function restoreCollapsed(hiddenEls) {
    const collapsed = hiddenEls && hiddenEls.__collapsed;
    if (!Array.isArray(collapsed)) return;
    for (const item of collapsed) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
      if (item.kind === 'container' && item.el.dataset) delete item.el.dataset.jreadCollapsed;
    }
  }

  // ---- articleEl 內部 grid/flex container 強制 block ---------------------
  //
  // 場景：BBC /news/articles/clyepyy82kxo 實測——即便廣告 wrapper 已 hide、
  // 主文 `<p>` 仍被鎖在 386px 欄位（grid-template-columns: 386px 的單欄
  // 固定寬 grid container）。祖先鏈 reset（`data-jread-ancestor`）只處理
  // articleEl **外部**祖先、沒管內部；`collapseGridWithHiddenCell` 只在
  // grid/flex container 有 hidden child 時 collapse。兩者都漏掉「內部
  // 沒 hidden sibling 但 grid-template 固定鎖寬」的 container。
  //
  // 通則：reader mode 精神是「內文撐滿 card」，articleEl 內的任何 grid/
  // flex layout container（除保留元素 figure/figcaption/summary/blockquote
  // 內部）都強制 `display: block` + 清 `grid-template-columns/rows`。
  // children 回歸 block flow、繼承 parent 寬度。
  //
  // 排除保留範圍：
  // (1) preserved 元素（summary/figure/figcaption/blockquote）內部不動
  // (2) grid-template-columns 非 hard-coded px 值（`1fr 1fr` / `auto` /
  //     `minmax(0, 1fr)` 等彈性單位）保留——這類通常是 intentional 多欄
  //     設計（主文內雙欄引述 / 圖片並列），reader mode 下仍合理
  // (3) flex container 不動——Bootstrap row/col 類 layout 由
  //     `collapseGridWithHiddenCell` 針對 hidden child 場景處理，
  //     無 hidden 的 flex 保留（避免誤殺主文內設計的 flex 排版）
  //
  // 只處理 `display: grid|inline-grid` + `grid-template-columns` 含 `\d+px`
  // —— hard-coded 固定寬度是 pathological case（BBC styled-components
  // 把主文鎖在 386px 單欄），reader mode 下明確該 reset。
  // v0.7.104：collapsed grid 容器自身也 reset width/max-width/margin。
  // BBC byline `.dWzpHk` stylesheet rule 設 `width: 458px` 配合 grid 第二欄寬，
  // 我們把 display:grid → block 後 458px 寬度 + margin:auto 在 608px 父容器內
  // 變成水平置中（margin 自動分 75px each side）→ byline 從左對齊變中央偏移。
  // 必須把容器自己的 width 也清成 100% + margin 清 0 + max-width 清 none。
  // 用 100% 而非 auto——實測 BBC 多層 styled-components nested layout 下
  // `width: auto` 即使 inline !important 仍會解析成原 stylesheet 寬度
  // （疑似 CSS containment / sub-grid / styled-components 動態 width 互動）；
  // `width: 100%` 強制使用 parent 的 width，可靠覆寫 stylesheet 任何固定 px。
  const INNER_GRID_PROPS = ['display', 'grid-template-columns', 'grid-template-rows', 'width', 'max-width', 'margin-left', 'margin-right'];
  const INNER_GRID_DECLS = {
    'display': 'block',
    'grid-template-columns': 'none',
    'grid-template-rows': 'none',
    'width': '100%',
    'max-width': 'none',
    'margin-left': '0',
    'margin-right': '0'
  };

  // v0.7.103：collapsed grid 的 descendants 殘留 auto-center 修法。
  // BBC byline 實測——grid 容器（dWzpHk）有 grid-template-columns "230px 491px"，
  // descendant wrapper（ittDij SPAN）綁 `width:458px` + `margin:0 auto` 配合 grid
  // 第二欄寬。我們 collapse 父為 display:block 後，458 < 608(父寬) + margin:auto
  // 觸發水平置中（resolved margin: 75px each side）→ author 從左對齊變中央偏移。
  // 修法：對 collapsed grid 內任意 descendant，computed margin-left === margin-right
  // 且 > 4px（auto-center 痕跡）→ 強制 width:auto + margin:0 + grid-area:auto，
  // 還原為 block flow 的左對齊。symmetric margin 是 auto-center 的結構特徵
  // ——非 auto-center 的 descendant（單側固定 margin / 0 margin / 不對稱 margin）
  // 完全不動，避免 v0.7.103 第一版「全 descendants reset」造成連鎖塌陷的回歸。
  const INNER_GRID_DESC_PROPS = ['width', 'margin-left', 'margin-right', 'grid-area', 'grid-column', 'grid-row'];
  const INNER_GRID_DESC_DECLS = {
    'width': '100%',
    'margin-left': '0',
    'margin-right': '0',
    'grid-area': 'auto',
    'grid-column': 'auto',
    'grid-row': 'auto'
  };
  // symmetric margin 容差——styled-components 浮點運算可能有 sub-pixel 差異，
  // 1px 容差既不過鬆也不過嚴。> 4px 門檻避免一般小型 padding-margin 誤觸發。
  const SYMMETRIC_MARGIN_MIN = 4;
  const SYMMETRIC_MARGIN_TOLERANCE = 1;

  function collapseInnerGridFlex(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const resets = [];
    const descResets = [];
    for (const el of articleEl.querySelectorAll('*')) {
      if (el === articleEl) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (isInPreserved(el)) continue;
      let cs;
      try { cs = window.getComputedStyle(el); } catch (_) { continue; }
      if (!cs) continue;
      if (!/^(grid|inline-grid)$/.test(cs.display)) continue;
      // 只 collapse hard-coded px 的 grid（固定欄寬）；彈性單位保留
      if (!/\d+px/.test(cs.gridTemplateColumns || '')) continue;
      resets.push({ el, prev: snapshotStyles(el, INNER_GRID_PROPS) });
      applyImportant(el, INNER_GRID_DECLS);
      // 掃 descendants：只對 symmetric margin（margin-left ≈ margin-right > 4px）
      // 元素 reset width/margin/grid-area。symmetric margin 是 styled-components
      // 「fixed width child + margin: auto」auto-center 殘留的結構特徵。
      // 排除 PRESERVE_SEL + 媒體 tag（widths 由 styler max-width 控管）。
      for (const desc of el.querySelectorAll('*')) {
        if (desc.dataset && desc.dataset.jreadHidden === '1') continue;
        if (isInPreserved(desc)) continue;
        const tag = desc.tagName;
        if (tag === 'IMG' || tag === 'PICTURE' || tag === 'VIDEO' || tag === 'SVG' ||
            tag === 'IFRAME' || tag === 'FIGURE') continue;
        let dcs;
        try { dcs = window.getComputedStyle(desc); } catch (_) { continue; }
        if (!dcs) continue;
        const ml = parseFloat(dcs.marginLeft) || 0;
        const mr = parseFloat(dcs.marginRight) || 0;
        if (ml < SYMMETRIC_MARGIN_MIN || mr < SYMMETRIC_MARGIN_MIN) continue;
        if (Math.abs(ml - mr) > SYMMETRIC_MARGIN_TOLERANCE) continue;
        descResets.push({ el: desc, prev: snapshotStyles(desc, INNER_GRID_DESC_PROPS) });
        applyImportant(desc, INNER_GRID_DESC_DECLS);
      }
    }
    hidden.__innerGridFlex = resets;
    hidden.__innerGridFlexDesc = descResets;
  }

  function restoreInnerGridFlex(hiddenEls) {
    const arr = hiddenEls && hiddenEls.__innerGridFlex;
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (!item || !item.el) continue;
        restoreStyles(item.el, item.prev);
      }
    }
    const desc = hiddenEls && hiddenEls.__innerGridFlexDesc;
    if (Array.isArray(desc)) {
      for (const item of desc) {
        if (!item || !item.el) continue;
        restoreStyles(item.el, item.prev);
      }
    }
  }

  // ---- articleEl 內部 flex-row wrap container 強制 block -----------------
  //
  // 場景：healthsystemtracker.org 實測——主文用 Bootstrap-style `.row`
  // (`display: flex; flex-direction: row`) 含多個固定寬度 children
  // （`.entry-content-left` 140px spacer + `.entry-content-center` 280px
  // 段落 + `.datawrapper-embed` 467px chart + `.entry-content-right` 140px
  // spacer ...）。原 design 在 1140px container 寬度可一條 row 排開，
  // 進 reader card 720px 後 flex-wrap 啟動讓 children 散落到多行 +
  // 個別 children 維持 stylesheet 固定 width →段落被擠成 256px 窄欄
  // 緊貼右側、與全寬 h1 視覺斷層。既有規則漏網：
  //   - collapseGridWithHiddenCell 只在「sibling 已 hidden」時 fire
  //   - collapseInnerGridFlex 只處理 grid + hard-coded px column、明文
  //     排除 flex (line 1565)
  // 這條補上「flex-row 多 child + 無 hidden + wrap 已發生」場景。
  //
  // 通則：reader mode 精神是「內文撐滿 card」。任何 flex-row container
  // 若其 visible children 不全在同一 row（top 值差距 > 5px）= flex-wrap
  // 已啟動 = 原 layout 寬度超過 reader card 容納範圍 → collapse 成 block
  // + 子寬度回 auto。
  //
  // 邊界保護：
  // - PRESERVE_SEL（figure / figcaption / blockquote / summary）內部 flex
  //   保留（image gallery / 引文裝飾通常在 figure 內）
  // - visible children < 2 不處理
  // - visible children top 差距 <= 5px = 沒 wrap、單行 flex 設計合理保留
  //   （author/date inline、未 wrap 的 chip 群等）
  // - jsdom 無 layout engine（rect 全 0）時 top 全相等 → 不誤觸發
  //
  // 與 collapseInnerGridFlex 並列、互補不重疊：那條處理 grid hard-coded
  // px column；這條處理 flex-row wrap。
  const INNER_FLEX_PROPS = ['display', 'width', 'max-width', 'margin-left', 'margin-right'];
  const INNER_FLEX_DECLS = {
    'display': 'block',
    'width': '100%',
    'max-width': 'none',
    'margin-left': '0',
    'margin-right': '0'
  };
  const INNER_FLEX_CHILD_PROPS = [
    'flex-grow', 'flex-shrink', 'flex-basis',
    'width', 'max-width', 'float', 'position'
  ];
  // v0.7.107：CHILD_DECLS 加 `position: static`——healthsystemtracker
  // `.entry-content-right` (`position: absolute` 的 "About this site"
  // 側欄) 實測：collapse 父 .row 為 block 後，absolute child 仍維持
  // `position: absolute` + 我們強制 `width: auto` 觸發 absolute box 的
  // shrink-to-fit → 寬度塌成 24px (content-shrunk)、text 縱向疊在
  // Methods 主文上。改成 `position: static` 讓 absolute child 回到
  // block flow（一般 block 撐滿父寬，不再 overlay）。
  const INNER_FLEX_CHILD_DECLS = {
    'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto',
    'width': 'auto', 'max-width': 'none', 'float': 'none',
    'position': 'static'
  };

  function collapseInnerFlexWrap(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const resets = [];
    for (const el of articleEl.querySelectorAll('*')) {
      if (el === articleEl) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (isInPreserved(el)) continue;
      let cs;
      try { cs = window.getComputedStyle(el); } catch (_) { continue; }
      if (!cs) continue;
      if (cs.display !== 'flex' && cs.display !== 'inline-flex') continue;
      if (cs.flexDirection !== 'row' && cs.flexDirection !== 'row-reverse') continue;
      const children = Array.from(el.children);
      if (children.length < 2) continue;
      const visibleChildren = [];
      // v0.7.107：在 wrap 判定階段過濾掉 position: absolute / fixed children
      // ——這些 children 的 top 不由 flex layout 決定（由 CSS top/left
      // 控制），混入會產生 wrap false positive（healthsystemtracker
      // `.entry-content-right` 全文高 absolute 側欄、top=716 跟其他
      // flex children 同 row 但獨立計算）。reset 階段仍對 absolute
      // children 套 CHILD_DECLS（position:static + width:auto），
      // 將它們拉回 block flow。
      const inFlowChildren = [];
      for (const c of children) {
        if (c.dataset && c.dataset.jreadHidden === '1') continue;
        let ccs;
        try { ccs = window.getComputedStyle(c); } catch (_) { continue; }
        if (!ccs) continue;
        if (ccs.display === 'none' || ccs.visibility === 'hidden') continue;
        visibleChildren.push(c);
        if (ccs.position === 'absolute' || ccs.position === 'fixed') continue;
        inFlowChildren.push(c);
      }
      if (visibleChildren.length < 2) continue;
      if (inFlowChildren.length < 2) continue;
      // wrap 判定：in-flow visible children 的 top 差距 > 5px = flex-wrap 已啟動
      let minTop = Infinity, maxTop = -Infinity;
      for (const c of inFlowChildren) {
        const r = c.getBoundingClientRect();
        if (r.top < minTop) minTop = r.top;
        if (r.top > maxTop) maxTop = r.top;
      }
      if (maxTop - minTop <= 5) continue;
      resets.push({ el, kind: 'container', prev: snapshotStyles(el, INNER_FLEX_PROPS) });
      applyImportant(el, INNER_FLEX_DECLS);
      if (el.dataset) el.dataset.jreadCollapsed = '1';
      // 對所有 visible children（含 absolute）套 CHILD_DECLS——把 absolute
      // 拉回 static、寬度回 auto，讓 layout 整體乾淨在 block flow
      const directChildrenSet = new Set();
      for (const c of visibleChildren) {
        if (!c.style) continue;
        directChildrenSet.add(c);
        resets.push({ el: c, kind: 'child', prev: snapshotStyles(c, INNER_FLEX_CHILD_PROPS) });
        applyImportant(c, INNER_FLEX_CHILD_DECLS);
      }
      // v0.7.108：deep absolute descendants 拉回 static——v0.7.107 只處理
      // direct children；absolute descendants（healthsystemtracker `.about`
      // sidebar 在 `.entry-content-right` 內、原本 anchor 到外層 relative
      // `.row`）會繼續 overlay 在主文上、產生疊字。對 collapse 的 flex
      // container 內所有非 direct-child 的 position: absolute / fixed
      // 後代強制 position: static（reader mode flow > overlay 原則）。
      // 不動 width/top/left 等——這些後代寬度由 stylesheet 給合理值，
      // 只取消 absolute 定位讓元素回到 flow 位置就夠。
      for (const desc of el.querySelectorAll('*')) {
        if (directChildrenSet.has(desc)) continue;
        if (desc.dataset && desc.dataset.jreadHidden === '1') continue;
        if (isInPreserved(desc)) continue;
        if (!desc.style) continue;
        let dcs;
        try { dcs = window.getComputedStyle(desc); } catch (_) { continue; }
        if (!dcs) continue;
        if (dcs.position !== 'absolute' && dcs.position !== 'fixed') continue;
        resets.push({ el: desc, kind: 'desc', prev: snapshotStyles(desc, ['position']) });
        applyImportant(desc, { 'position': 'static' });
      }
    }
    hidden.__innerFlexWrap = resets;
  }

  function restoreInnerFlexWrap(hiddenEls) {
    const arr = hiddenEls && hiddenEls.__innerFlexWrap;
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
      if (item.kind === 'container' && item.el.dataset) {
        delete item.el.dataset.jreadCollapsed;
      }
    }
  }

  // ---- figure / picture 容器強制 block（v0.7.24 ttv.com.tw 修法）----------
  //
  // 場景：ttv 主圖包在 `<figure class="cover img"><figure><img></figure></figure>`
  // 雙層 figure，外層 class 含 flex layout CSS（`display: flex`）。child 是
  // 單一 `<figure>`、沒 `flex: 1`，shrink-to-fit 被壓扁 → rect 0×0、img 跟
  // 著 0×0 → 主圖消失。
  //
  // 通則依據：`<figure>` / `<picture>` 在 HTML5 spec 的 UA 預設 display 是
  // `block`。原站把它改成 `flex` / `grid` / `inline-*` 是站點 custom layout
  // 需求（如左右並排圖說 / 多欄 gallery）——但 reader mode 脫離原站上下文後
  // 這些 custom layout 常失效（因 ancestor 的 layout reset），留下 shrink
  // 陷阱。強制回歸 HTML5 預設 block 安全且符合「貼近原站語意」哲學。
  //
  // 為何不在 styler 加 `display: block`：styler 視為動不得、需 Jimmy 授權；
  // 放 cleaner 用 inline !important + restore 機制跟 v0.6.13 的
  // resetMediaPlaceholderPadding 同層級。
  const MEDIA_CONTAINER_PROPS = ['display'];

  function forceMediaContainerBlock(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const resets = [];
    const candidates = articleEl.querySelectorAll('figure, picture');
    for (const el of candidates) {
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      let cs;
      try { cs = window.getComputedStyle(el); } catch (_) { continue; }
      if (!cs) continue;
      const d = cs.display;
      // 只改 flex / grid / inline-*（非預設 block 行為）；原本就 block
      // 或 table / list-item 等其他 layout 不動
      if (d === 'block' || d === 'none') continue;
      if (!/^(flex|inline-flex|grid|inline-grid|inline-block|inline)$/.test(d)) continue;
      resets.push({ el, prev: snapshotStyles(el, MEDIA_CONTAINER_PROPS) });
      applyImportant(el, { display: 'block' });
    }
    hidden.__mediaContainerBlock = resets;
  }

  function restoreMediaContainerBlock(hiddenEls) {
    const arr = hiddenEls && hiddenEls.__mediaContainerBlock;
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
    }
  }

  // ---- 後代 container 殘留 box-shadow 清除（v0.7.30 cnyes.com 修法）-----
  //
  // 場景：cnyes 內層 `<article class="mfxje1x">` 自帶
  // `box-shadow: rgba(0, 65, 143, 0.1) 0px 0px 6px 0px`——reader card 已有
  // 自己的 box-shadow，內層再來一層淡藍陰影、視覺像「卡片裡再一層淡淡外框」
  // （Jimmy 2026-04-25 指認）。styler 的 ancestor reset 只清主文祖先鏈、
  // 沒處理 articleEl 後代。
  //
  // 通則：reader mode 下卡片視覺骨架由 styler 統一管（外卡 box-shadow），
  // 內層 container 不該再有自己的 box-shadow——這些都是原站 layout 用裝飾，
  // 在 reader mode 重新 layout 後失去語意、變成「框中框」雜訊。掃 articleEl
  // 後代的 container 類 element（div/section/article/aside/nav/main/header/
  // footer），box-shadow 非 none 就 inline override 'none'。
  //
  // scope 限制 container tags 不掃 blockquote / figure / table / pre / code
  // 等內文結構元素——這些在某些站確實用 box-shadow 做引言/表格設計，保留。
  const DECOR_BOX_SHADOW_SEL = 'div, section, article, aside, nav, main, header, footer';
  const DECOR_BOX_SHADOW_PROPS = ['box-shadow'];

  function clearDescendantBoxShadow(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const resets = [];
    for (const el of articleEl.querySelectorAll(DECOR_BOX_SHADOW_SEL)) {
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (isInPreserved(el)) continue;
      let cs;
      try { cs = window.getComputedStyle(el); } catch (_) { continue; }
      if (!cs || cs.boxShadow === 'none') continue;
      resets.push({ el, prev: snapshotStyles(el, DECOR_BOX_SHADOW_PROPS) });
      applyImportant(el, { 'box-shadow': 'none' });
    }
    hidden.__descendantBoxShadow = resets;
  }

  function restoreDescendantBoxShadow(hiddenEls) {
    const arr = hiddenEls && hiddenEls.__descendantBoxShadow;
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
    }
  }

  // ---- 媒體 placeholder pattern：區分 padding-hack vs 正規 aspect-ratio ---
  // 兩種常見媒體容器模式：
  //   A) padding-hack（Substack / Medium）：
  //      `<div style="position:relative; padding-bottom: 56.25%;">
  //         <img style="position:absolute; inset:0; width:100%; height:100%;">`
  //      用 padding-bottom 撐 16:9 空間，img 絕對覆蓋。閱讀模式下我們重排版、
  //      img 可能脫離原本的布局邏輯，padding 留著 = 主圖下方一大片空白。
  //   B) 純 aspect-ratio（Engadget / 新世代 CSS）：
  //      `<div style="aspect-ratio: 16/9;"><img style="position:absolute; inset:0; w/h:100%">`
  //      容器 padding-bottom 為 0，完全靠 `aspect-ratio` 撐高度，img 一樣
  //      絕對覆蓋。閱讀模式下若強行 reset `aspect-ratio: auto`，容器高度
  //      歸零、img 雖然仍 absolute 渲染但 flow 內看不到 → 主圖消失（v0.6.13
  //      在 Engadget 實測到）。
  //
  // v0.6.13 之前 styler 有一條 `*:has(> img) { padding-bottom: 0; aspect-ratio: auto }`
  // 對 A 沒問題、對 B 會破。CSS :has() 看不到 computed padding 值，無法在樣式
  // 層區分兩者——搬到 cleaner runtime：
  //   - 計算 parent 的 computed padding-bottom 與 width 比例
  //   - 比例 > 20% 才視為 hack、reset padding-bottom 並把 media 從 absolute
  //     解放為 static
  //   - 否則（包含純 aspect-ratio 容器）完全不碰
  //
  // 通則性：僅以「padding-bottom / width 比例」為結構特徵，不綁任何 hostname
  // 或 class。
  function resetMediaPlaceholderPadding(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const resets = [];
    const visited = new WeakSet();
    for (const media of articleEl.querySelectorAll('img, picture, video')) {
      const parent = media.parentElement;
      if (!parent || parent === articleEl) continue;
      if (visited.has(parent)) continue;
      visited.add(parent);
      if (isInPreserved(parent) && parent.matches && parent.matches('figcaption')) continue;

      const mediaCs = window.getComputedStyle(media);
      if (mediaCs.position !== 'absolute') continue;

      const pCs = window.getComputedStyle(parent);
      // 先讀 inline string（jsdom 不解析 % → px，但原站多半走 stylesheet、
      // 少數 hack 寫在 inline）。real Chrome 下 computed 已 resolve 成 px。
      let isHack = false;
      const inlinePb = parent.style && parent.style.paddingBottom;
      if (inlinePb && /%$/.test(inlinePb) && parseFloat(inlinePb) > 20) isHack = true;
      if (!isHack) {
        const pbPx = parseFloat(pCs.paddingBottom) || 0;
        const wPx = parseFloat(pCs.width) || 0;
        if (pbPx > 0 && wPx > 0 && pbPx / wPx > 0.2) isHack = true;
      }
      if (!isHack) continue;

      resets.push({
        kind: 'placeholder-parent',
        el: parent,
        prev: snapshotStyles(parent, ['padding-bottom'])
      });
      applyImportant(parent, { 'padding-bottom': '0' });

      // 把 media 從 absolute 解放，讓它照自己的 intrinsic 尺寸流在原位
      // （styler 那邊會套 max-width:100% + height:auto）
      resets.push({
        kind: 'placeholder-media',
        el: media,
        prev: snapshotStyles(media, ['position', 'top', 'left', 'right', 'bottom'])
      });
      applyImportant(media, { 'position': 'static' });
      media.style.removeProperty('top');
      media.style.removeProperty('left');
      media.style.removeProperty('right');
      media.style.removeProperty('bottom');
    }
    hidden.__mediaResets = resets;
  }

  function restoreMediaResets(hiddenEls) {
    const resets = hiddenEls && hiddenEls.__mediaResets;
    if (!Array.isArray(resets)) return;
    for (const item of resets) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
    }
  }

  // ---- 主文內：lazy-load 圖片 src 補正 ------------------------------------
  // 場景：Medium / WordPress / CMS 類站點常用 IntersectionObserver 做 lazy
  // image load，未進視窗的 <img> 的 `src` 是 1x1 透明 gif、base64 placeholder
  // 或空字串，真圖 URL 存在 `data-src` / `data-original` / `data-lazy-src`。
  // 進 reader mode 時整個 DOM 被標 active + 套排版，**使用者捲動時不會觸發
  // 原站的 lazy-load observer**（可能是原 observer 被 style 變動影響、可能
  // 是原本的 root margin 以 viewport 為基準跟不上新排版），導致圖片一片空白。
  //
  // 修法：進 reader mode 時主動把 `data-src` / `data-original` / `data-lazy-src`
  // / `data-lazy` / `data-srcset` / `srcset` 的 URL 補到 `src`，瀏覽器就會正
  // 常載入。restore 時把 src 還原成原值，不破壞原站的 lazy-load 邏輯。
  //
  // 通則依據：對標 Readability.js 的 `_fixLazyImages`——Readability 是「parse
  // HTML 後修」情境、我們是「瀏覽器已載但 observer 沒跑」情境，attribute 名單
  // 與補救邏輯一樣，記 prevSrc 做還原是 JRead 架構的延伸。
  const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy'];
  // placeholder 判定：empty / about:blank / data:image URL 視為「未 hydrate」
  // 常見 placeholder：`data:image/gif;base64,R0lGOD...`（1x1 透明 gif）、
  // `data:image/svg+xml;base64,...`（低解析度佔位 svg）
  const LAZY_PLACEHOLDER_RE = /^\s*$|^about:blank$|^data:image\//i;

  function hydrateLazyImages(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const hydrations = [];
    for (const img of articleEl.querySelectorAll('img')) {
      // 區分「沒有 src attribute」 vs 「src 空字串」——restore 要 round-trip
      // 回原狀態，兩者不同（原站若 `<img>` 沒 src attribute，我們補完後要
      // removeAttribute 才能還原；若原站 `src=""` 則要 setAttribute('src','')）
      const hadSrcAttr = img.hasAttribute('src');
      const prevSrc = hadSrcAttr ? img.getAttribute('src') : '';
      if (!LAZY_PLACEHOLDER_RE.test(prevSrc)) continue;

      let newSrc = null;
      for (const attr of LAZY_SRC_ATTRS) {
        const v = img.getAttribute(attr);
        if (v && !LAZY_PLACEHOLDER_RE.test(v)) { newSrc = v; break; }
      }
      // srcset fallback：取第一個 URL（忽略後面的 `1x` / `300w` descriptor）
      if (!newSrc) {
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
        if (srcset) {
          const first = srcset.split(',')[0].trim().split(/\s+/)[0];
          if (first && !LAZY_PLACEHOLDER_RE.test(first)) newSrc = first;
        }
      }
      if (!newSrc) continue;

      hydrations.push({ el: img, prevSrc, hadSrcAttr });
      img.setAttribute('src', newSrc);
    }
    hidden.__lazyImages = hydrations;
  }

  function restoreLazyImages(hiddenEls) {
    const arr = hiddenEls && hiddenEls.__lazyImages;
    if (!Array.isArray(arr)) return;
    for (const { el, prevSrc, hadSrcAttr } of arr) {
      if (!el || !el.setAttribute) continue;
      if (hadSrcAttr) el.setAttribute('src', prevSrc);
      else el.removeAttribute('src');
    }
  }

  // ---- 主文內：所有 interactive button 一律 hide --------------------------
  // Jimmy 2026-04-23 明確要求：reader mode 下不需要任何按鈕（分享 / 訂閱 /
  // 追蹤 / 讚 / 收藏 / 播放 / 展開 / 任何 CTA / 任何 interactive）。
  // reader mode 的定位是「純閱讀」——所有 button 類 interactive 都是雜訊。
  //
  // 範圍：`<button>` + `[role="button"]` + `<input type="button|submit|reset">`。
  // 不受 `PRESERVE_SEL`（summary/figure/figcaption/blockquote）保護影響——
  // figure 內的 expand/zoom 按鈕、figcaption 內的展開按鈕也一律清掉。
  //
  // 風險評估：極低。reader mode 下使用者只閱讀、不會操作按鈕；主文正文
  // 從不用 `<button>` 排版文字。極少數 code demo / interactive widget 會
  // 被誤殺，但 reader mode 本就不適合跑 interactive demo（應該回原站）。
  function hideInsideArticleAllButtons(articleEl, hidden) {
    const sel = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
    for (const btn of articleEl.querySelectorAll(sel)) {
      if (btn === articleEl) continue;
      if (btn.contains && btn.contains(articleEl)) continue;
      if (btn.dataset && btn.dataset.jreadHidden === '1') continue;
      // 保護含主文媒體的 button wrapper（v0.7.11 Medium click-to-zoom 修法）：
      // Medium 把主文 <picture>/<img> 嵌在 <div role="button" tabindex="0">
      // 的 wrapper 裡、點擊看大圖（a11y 同時有 span「Press enter or click
      // to view image in full size」）。btn 內含 img/picture/video 時保留
      // 整個 wrapper——這是 v0.7.3「所有 button 無條件清」rule 的例外：
      // button wrapper 雙重角色（click-to-zoom + 主文媒體容器），hide 掉
      // 連圖片都看不見。通則依據：button 內含媒體元素 = 主文載體、非純
      // CTA。share / subscribe / follow button 一般用 svg（不在保護範圍內）
      // 或完全無圖、保留判定不影響。
      if (btn.querySelector && btn.querySelector('img, picture, video')) continue;
      hide(btn, hidden);
    }
  }

  // ---- 主文內：a[href^="javascript:"] heuristic --------------------------
  // 結構性通則：href 為 `javascript:` 的 `<a>` 是 JS handler trigger（分享 /
  // 聽新聞 / 複製連結 / 收藏 / open modal 等），不是主文引用連結——主文
  // 不會用 javascript: pseudo-protocol 連結。reader mode 下這類 a 一律清。
  // 場景：cna.com.tw 標題下方 5 個社群按鈕（btn_audio / btn_fb / btn_line /
  // btn_copy / btn_support）都是 a[href^="javascript:"]，class 命名特殊
  // （btn_*）NOISE_KEYWORD_RE 不命中，textContent 空（icon-only）NOISE_LINK_
  // TEXT_RE 也不命中——靠 href pseudo-protocol 統一識別。
  function hideInsideArticleJsLinks(articleEl, hidden) {
    for (const a of articleEl.querySelectorAll('a[href^="javascript:"]')) {
      if (isInPreserved(a)) continue;
      if (a.dataset && a.dataset.jreadHidden === '1') continue;
      hide(a, hidden);
    }
  }

  // ---- 主文內：icon-only <a> 通則 ---------------------------------------
  // 結構性通則：reader mode 是純閱讀體驗，所有 CTA / 分享 / 訂閱 / 支持 /
  // 收藏類 button-style 連結都該清。icon-only `<a>`（內含 svg/img 但無
  // visible 文字）幾乎都是這類 CTA——主文引用連結一定有文字標籤、絕不會
  // 是純圖標。
  // cna.com.tw 實測：「支持 CNA」按鈕是 <a class="btn_support"><img src=
  // "support.svg"></a>，href 不是 javascript: 所以 hideInsideArticleJsLinks
  // 攔不到，class btn_support 不在 NOISE_KEYWORD_RE，textContent 空所以
  // NOISE_LINK_TEXT_RE 也不命中。靠「icon-only」結構特徵統一識別。
  // 安全 guard：figure / picture 內的 a > img 是「圖片可點擊版」合法用法
  // （常見於主文 hero 圖配連結），保留；其他位置的 icon-only a 一律 hide。
  function hideInsideArticleIconOnlyLinks(articleEl, hidden) {
    for (const a of articleEl.querySelectorAll('a')) {
      if (isInPreserved(a)) continue;
      if (a.dataset && a.dataset.jreadHidden === '1') continue;
      // 跳過 figure / picture 內的 a（主文圖片可點擊版，合法用法）
      if (a.closest('figure, picture')) continue;
      // 必須含 img / svg（icon 載體）
      const hasIcon = a.querySelector('img, svg');
      if (!hasIcon) continue;
      // textContent 去空白後仍有 >= 1 個字 = 不算 icon-only
      const text = (a.textContent || '').replace(/\s+/g, '').trim();
      if (text.length >= 1) continue;
      hide(a, hidden);
    }
  }

  // ---- 主文內：<font> tag heuristic ------------------------------------
  // `<font>` 是 HTML4 老式樣式 tag，HTML5 已 deprecated。現代網站幾乎只在
  // **inline 廣告 / PR 推廣**插播時用它（改字色 / 加 emoji 吸睛），正文排
  // 版都改走 CSS class。udn 實測：主文段落中插入 `<font><a>🎮想成為超強
  // 飼主？玩問答遊戲拿課程金</a></font>` PR 連結，無 class / id、沒祖先
  // section，既有 rule 全攔不到。直接 hide 主文內所有 `<font>` tag——損失
  // 風險極低（現代主文不該有 font tag）。
  function hideInsideArticleFontTags(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('font')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：留言 / 社群面板 structural rule ---------------------------
  // 跨站通用的結構特徵：comment / social widget 必含多個「N 分鐘/小時/天前」
  // 相對時間戳（每則留言一個）。主文作者資訊最多 1 個相對時間戳（發布
  // 時間），超過 3 個就是留言面板或社群 feed。
  //
  // LINE Today 實測：留言面板跟主文在同一個 swipe-back direct child
  // wrapper 下（heading rule 升級會誤殺主文），但留言 cluster 本身是
  // 獨立 sub-tree，可透過「relative time marker count」定位。
  //
  // 掃 articleEl 的 descendants（div / section），若其 textContent 含
  // >=3 個相對時間戳 pattern 且「自身 textLen < 父 textLen 的 80%」
  // （避免命中主文容器），hide 之。
  const RELATIVE_TIME_RE = /\d+\s*(分鐘前|小時前|天前|週前|個月前|年前|hours?\s*ago|minutes?\s*ago|days?\s*ago|weeks?\s*ago)/g;
  const COMMENT_PANEL_MIN_TIMESTAMPS = 3;

  function hideInsideArticleCommentPanels(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('div, section, aside, ul, ol')) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (el.contains(articleEl)) continue;
      const text = el.textContent || '';
      const matches = text.match(RELATIVE_TIME_RE);
      if (!matches || matches.length < COMMENT_PANEL_MIN_TIMESTAMPS) continue;
      // 保護主文 layer 1：若此 el 含主文長段落（>= 300 chars 的 p），跳過
      let hasMainParagraph = false;
      for (const p of el.querySelectorAll('p')) {
        const pText = norm(p.textContent);
        if (pText.length >= 300) { hasMainParagraph = true; break; }
      }
      if (hasMainParagraph) continue;
      // 保護主文 layer 2：element 含 >= 4 個獨立 `<p>`、每個 >= 50 chars
      // （trimmed）= 主文。留言面板典型結構是 `<div class="comment">` 巢狀
      // div、**不用 `<p>` tag**（Disqus / LINE Today / Reddit / FB / Twitter
      // 等都是 div）。「>= 4 個 long p」是主文必備結構特徵，留言面板達不到。
      // gvm.com.tw/article/129607 實測：article-content 含 6 個敘事段落 p，
      // 每段平均 200-300 chars，舊 layer 1「單一 p >= 300 chars」失效（中文
      // 主文常分多個短 p），p count guard 兜底。
      let mainPCount = 0;
      for (const p of el.querySelectorAll('p')) {
        if (norm(p.textContent).length >= 50) mainPCount++;
      }
      if (mainPCount >= 4) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：第三方廣告服務標識符 ------------------------------------
  // v0.7.4 EasyList spike 結論：Jimmy 四站實測（line today / udn /
  // chinatimes / upmedia）在 reader mode 內的廣告殘留，幾乎都指向**第三
  // 方廣告服務的標準標識符**，而非站點自訂 class。這些標識符是跨站業界
  // 慣例（Google Ad Manager 的 `div-gpt-ad-*` 是 GAM 官方推薦命名、
  // Taboola 的 `trc_*` 是 Taboola 官方 widget prefix、popIn 的
  // `_popIn_*` 是 popIn recommendation 官方 class），屬結構性通則，
  // 不是站點特判（硬規則 3）。
  //
  // 為何仍要加：NOISE_KEYWORD_RE 的 markerOf 只看 class/id 是否含關鍵詞
  // 片段，對「`div` 只有 id / 無 class」（`div-gpt-ad` 是 id prefix）
  // 或 iframe 的 name 屬性（`google_ads_iframe_*`）無法命中；加精確
  // selector 作為保險絲。實測命中不多（reader mode 架構已代理大部分），
  // 但成本是 8 個 CSS selector 的 `querySelectorAll`，效能可忽略。
  const THIRD_PARTY_AD_SEL = [
    // Google Ad Manager / GPT（業界最大 ad server，標準命名）
    '[id^="div-gpt-ad"]',
    '[id^="google_ads_"]',
    '[id^="dfp-"]',              // v0.7.25 techbang 修法：Google DFP (Ad Manager)
    '[class~="google-dfp"]',     //   id prefix + class 慣用命名（跨 CMS DFP 接入慣例）
    'iframe[name^="google_ads_iframe"]',
    'iframe[id^="google_ads_iframe"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="doubleclick.net"]',
    // Taboola（跨站「推薦 / 相關內容」廣告平台）
    '[class*="trc_"]',
    '[id*="taboola"]',
    '[class*="taboola"]',
    // popIn Discovery（日系廣告平台，台灣新聞站常用）
    '[class*="_popIn_"]',
    '[id*="_popIn_"]',
    // Outbrain（Taboola 同類競品）
    '[class*="OUTBRAIN"]',
    '[data-widget-id*="outbrain"]',
    // 通用 ad container class/id prefix（跨站命名慣例，非站點特判）
    '[id^="ad-"]', '[id^="ads-"]', '[id^="ad_"]', '[id^="ads_"]',
    '[class^="ad-"]', '[class^="ads-"]',
    // React component data attribute（跨站標準，BBC / Vox / React 新聞站慣例）
    // class 是 styled-components hash（`sc-XXXXXX`）無 keyword 可命中，但
    // React 廣告 component 統一用 data-testid / data-component 標記：
    //   <div data-testid="ad-unit" data-component="ad-slot" class="sc-...">
    // BBC 實測 /news/articles/clyepyy82kxo 右側廣告占位——內層 dotcom-ad
    // 已被 AD_BOUNDARY_RE hide、但外層 styled-components wrapper 有 min-height
    // CSS 仍撐 540×1100 灰色占位，必須靠 data attribute 才能識別。
    '[data-testid="ad-unit"]',
    '[data-testid="ad-slot"]',
    '[data-component="ad-slot"]',
    '[data-component="ad-unit"]',
  ].join(', ');

  function hideInsideArticleByThirdPartyAds(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll(THIRD_PARTY_AD_SEL)) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (el.contains(articleEl)) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：第三方 iframe（v0.7.32 cnyes 討論區修法）----------------
  //
  // cnyes news.cnyes.com 的「討論區」widget（anue 留言系統）整個包在
  // <iframe> 裡：probe + textContent 全文檔搜都找不到「討論區」字串
  // （因為 iframe 跨 origin、parent document 看不到內部）、但 screenshot
  // 看得到 visible widget。Jimmy 連續 4 輪實機回報「討論區還在」、所有
  // heading-text / keyword 規則都漏網——根因就是 iframe 包裝。
  //
  // 通則：reader mode 是純閱讀、articleEl 內的 cross-origin iframe 99%
  // 都是廣告 / 留言 widget / share button / poll / chatroom 等 chrome、
  // 不是主文。例外是已知媒體 embed（YouTube / Vimeo / Twitter 引文 /
  // Spotify / SoundCloud / Bilibili 等）—— 主文常嵌的影片 / 音訊 /
  // 推文引用屬於正文一部分、保留。
  //
  // whitelist 用 src 子字串 match（embed 域名跨多種子網域 / mobile
  // variant，hostname 嚴格對比會漏）。新增已知媒體 embed 平台時補進此
  // 清單即可。
  //
  // PRESERVE_SEL（figure/figcaption/blockquote/summary）內的 iframe
  // 由 isInPreserved 保護——主文 figure 內含 iframe（例如 figure 包
  // 影片 embed）不被誤殺。
  const KNOWN_MEDIA_IFRAME_SEL = [
    'iframe[src*="youtube.com"]',
    'iframe[src*="youtube-nocookie.com"]',
    'iframe[src*="youtu.be"]',
    'iframe[src*="vimeo.com"]',
    'iframe[src*="player.vimeo"]',
    'iframe[src*="twitter.com"]',
    'iframe[src*="x.com/embed"]',
    'iframe[src*="platform.twitter"]',
    'iframe[src*="instagram.com"]',
    'iframe[src*="facebook.com/plugins/post"]',  // 嵌入貼文
    'iframe[src*="facebook.com/plugins/video"]',
    'iframe[src*="spotify.com"]',
    'iframe[src*="soundcloud.com"]',
    'iframe[src*="wistia.com"]',
    'iframe[src*="vidyard.com"]',
    'iframe[src*="bilibili.com"]',
    'iframe[src*="dailymotion.com"]',
    'iframe[src*="ted.com"]',
    'iframe[src*="codepen.io"]',
    'iframe[src*="codesandbox.io"]',
    'iframe[src*="jsfiddle.net"]',
    'iframe[src*="github.com"]'
  ].join(', ');

  function hideInsideArticleThirdPartyIframes(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('iframe')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (el.matches && el.matches(KNOWN_MEDIA_IFRAME_SEL)) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：inline 廣告插播文字 heuristic ---------------------------
  // 自由時報 / 聯合 / ETtoday 等台灣新聞站在主文段落中段插播「廣告（請
  // 繼續閱讀本文）」類 placeholder 短文字，無可識別 class、不成 section
  // —— keyword / heading / link 規則都攔不到。走 inline text 匹配：對
  // 主文內 span / p / div 的 direct textNode 內容，若 text 整體命中
  // NOISE_INLINE_AD_TEXT_RE 則 hide 該 element。
  //
  // 為何用 direct textNode 而非 textContent：textContent 會把子孫文字全
  // 算進來，「廣告」字樣的主文段落（如「政府廣告預算」）會被誤殺。
  // direct textNode 確保只 match「element 自己直接的文字」，span/p 本
  // 身就是 placeholder 插播 leaf（無子 element）才命中。
  function hideInsideArticleByInlineAdText(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('span, p, div')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      const direct = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent).join('');
      const text = norm(direct);
      if (!text || text.length > NOISE_INLINE_AD_MAX_LEN) continue;
      if (!NOISE_INLINE_AD_TEXT_RE.test(text)) continue;
      if (el === articleEl) continue;
      if (el.contains && el.contains(articleEl)) continue;
      hide(el, hidden);
    }
  }

  // ---- Reader mode 下凍結主文祖先鏈：攔截 dynamic append ----------------
  // 場景：infinite-scroll 站點（news.ltn.com.tw 自由時報 popIn Discovery /
  // 相似 CMS）、延遲 lazy-load 側邊欄、動態 inject 的廣告 / 推薦列表。
  // cleaner.clean() 是 one-shot snapshot——只 hide 當下存在的節點。reader
  // mode 下若使用者捲動觸發新內容 append（例如 popIn template clone 塞新篇
  // 到主文 parent），新節點沒經過 cleaner 流程 → 混入使用者視野。
  //
  // 通則（非站點特判）：reader mode 的不變量是「進入當下的 DOM snapshot 凍
  // 結」，主文祖先鏈（articleEl.parentElement → ... → body）上任何新 append
  // 的節點都是雜訊（真正的主文不會在 reader mode 途中突然擴張）。用
  // MutationObserver 觀察每一層祖先的 childList，新 addedNodes 直接
  // remove。restore 時 disconnect；dynamic 節點不還原（使用者退出 reader
  // mode 重捲會觸發 site 自己的 lazy-load 邏輯重新 inject）。
  //
  // 為何 remove 而非 hide：popIn 從 cleaner 已經 hide 過的 .template 元素
  // clone 時，新節點繼承舊 `data-jread-hidden="1"` attribute，cleaner.hide
  // 的 early-return 會 skip；且 popIn 之後會主動設 display:block 覆蓋任何
  // inline `display: none`。直接 remove 最徹底、最小狀態管理、不跟 popIn
  // 搶 style property。
  let activeObserver = null;

  // articleEl 內部動態 inject 的檢查：只對命中「雜訊特徵」的 node hide，
  // 不動 legit 主文 update（SPA 段落追加 / typo 修正 / lazy 圖片 load）。
  // 雜訊特徵判定：
  //   - class/id 命中 NOISE_KEYWORD_RE（CMS 命名慣例）
  //   - 含 h2/h3/h4 文字命中 NOISE_HEADING_TEXT_RE（跨站 section 標題慣用語）
  function checkDynamicNoise(articleEl, node, hiddenList) {
    if (isInPreserved(node)) return;
    // 雜訊 class/id 直接 hide 整個 node
    if (shouldHideByKeyword(node)) {
      if (node.dataset && node.dataset.jreadHidden === '1') return;
      hide(node, hiddenList);
      return;
    }
    // **所有** interactive button 一律 hide（Jimmy 要求：reader mode 下
    // 任何按鈕都不需要）。delayed lazy-inject 的按鈕走這條。
    if (node.matches && node.matches(
        'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]')) {
      if (node.dataset && node.dataset.jreadHidden === '1') return;
      hide(node, hiddenList);
      return;
    }
    // 遞迴檢查 node 內的 button / a / role=button——new node 可能是包了
    // 雜訊的 wrapper，其內部的 button/a 才帶 class keyword。udn LINE
    // 分享按鈕是 reader mode toggle 後約 3s lazy-inject 的 `<a class=
    // "btn-social--line">`，包在某個 wrapper div 內、wrapper 自己 class
    // 沒命中 keyword，但內部 a 命中——要遞迴檢查。
    if (node.querySelectorAll) {
      for (const btn of node.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]')) {
        if (btn.dataset && btn.dataset.jreadHidden === '1') continue;
        hide(btn, hiddenList);
      }
      for (const a of node.querySelectorAll('a, button')) {
        if (a.dataset && a.dataset.jreadHidden === '1') continue;
        if (!shouldHideByKeyword(a)) continue;
        hide(a, hiddenList);
      }
    }
    // heading text 命中：跟 hideInsideArticleByHeadingText 同邏輯
    // （v0.7.31 cnyes lazy-inject 修法）：原本只掃 h2-h4 + closest section/
    // aside、沒同步 v0.7.28 的 p/div/span 擴展 + walk-up fallback——對 cnyes
    // 這種 reader mode toggle 後 lazy-inject「討論區」widget（h3 結構、無
    // section 祖先、整篇主文+widget 同一 ARTICLE wrapper）漏網。
    const DYN_TITLE_TAG_SEL = 'h2, h3, h4, p, div, span';
    const candidates = [];
    if (node.matches && node.matches(DYN_TITLE_TAG_SEL)) candidates.push(node);
    if (node.querySelectorAll) {
      candidates.push(...node.querySelectorAll(DYN_TITLE_TAG_SEL));
    }
    for (const h of candidates) {
      const isHeading = /^H[234]$/.test(h.tagName);
      const text = isHeading
        ? norm(h.textContent)
        : norm(Array.from(h.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(''));
      if (!text || text.length > NOISE_HEADING_MAX_LEN) continue;
      if (!NOISE_HEADING_TEXT_RE.test(text)) continue;
      if (isInPreserved(h)) continue;
      let target = h.closest('section, aside');
      // 同 hideInsideArticleByHeadingText：closest target 含主文 anchor 也視為過寬
      const dynTooWide = target && target !== articleEl &&
        !target.contains(articleEl) && wrapperContainsArticleAnchor(target, h);
      if (!target || target === articleEl || target.contains(articleEl) || dynTooWide) {
        const lastSafeWrapper = findSafeWrapperForHeading(h, articleEl);
        if (!lastSafeWrapper) continue;
        target = lastSafeWrapper;
      }
      if (!target) continue;
      if (target === articleEl) continue;
      if (!articleEl.contains(target)) continue;
      if (target.contains(articleEl)) continue;
      if (target.dataset && target.dataset.jreadHidden === '1') continue;
      hide(target, hiddenList);
      return;
    }
  }

  function startWatchingDynamicAppends(articleEl, hiddenList) {
    if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
    if (!articleEl || !articleEl.parentElement) return;

    const mo = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (STRUCTURAL_TAGS.has(node.tagName.toLowerCase())) continue;
          if (isInPreserved(node)) continue;

          // 祖先鏈上 append 的 node（articleEl scope 外）：hide 整塊（v0.7.31
          // cnyes 修法）。
          //
          // 改 hide 不 removeChild 的原因：cnyes（Next.js）/ React 類 SPA
          // 站持續做 client-side reconciliation，jread 主動 removeChild 的
          // node 在 React vdom 裡仍存在、下次 reconcile 找不到 DOM child
          // 觸發 `Failed to execute 'removeChild' on 'Node': The node to be
          // removed is not a child of this node.`、整個 React tree 崩潰、
          // 頁面 layout 變空白。改成 hide() 用 inline `display: none
          // !important`、保留 DOM node、不打斷 React reconciliation——SPA
          // 站照樣可繼續更新；watchHiddenInlineRestyle observer 會把後續
          // !important priority 被清的情況補回來。
          //
          // popIn 相似文章 / lazy header / cookie banner 等視覺結果同等
          // （都是 display:none）、但不再砍 DOM 結構就不打架。
          if (!articleEl.contains(node)) {
            if (node === articleEl) continue;
            if (node.contains && node.contains(articleEl)) continue;
            if (!node.dataset || node.dataset.jreadHidden !== '1') {
              hide(node, hiddenList);
            } else {
              // popIn template clone 類：dataset.jreadHidden 從 source
              // 帶過來但 inline display 被 popIn 主動設成 block。直接
              // 補 inline `display: none !important`（hide() 對已標 jreadHidden
              // 的 node 會 early return、不覆寫 inline display）
              node.style.setProperty('display', 'none', 'important');
            }
            continue;
          }

          // articleEl 內部 append：只對雜訊特徵 node hide，legit 主文 update
          // 保留。場景：LINE Today「其他人也看了」section 在 clean() 之後
          // 才 lazy-load inject 進 swipe-back 內、被 isRelated 放行漏網——
          // 現改成 heading / keyword 特徵判定 hide。
          checkDynamicNoise(articleEl, node, hiddenList);
        }
      }
    });

    // 觀察主文祖先鏈上每一層 parent 的 childList（到 body 為止，含 body）
    let cur = articleEl.parentElement;
    while (cur) {
      mo.observe(cur, { childList: true });
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    // 新增：觀察 articleEl 本身的 subtree——接 SPA 站晚到的 lazy-load 推薦
    // widget。subtree 涵蓋整棵內部樹；只對新 addedNodes 走雜訊判定不遞迴
    // scan 全樹，效能可控。
    mo.observe(articleEl, { childList: true, subtree: true });
    activeObserver = mo;
  }

  function stopWatchingDynamicAppends() {
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
  }

  // ---- inline style 覆寫攔截（v0.7.23 newtalk.tw 修法）---------------------
  //
  // 場景：cleaner.hide() 用 `el.style.setProperty('display', 'none', 'important')`
  // 打 inline `!important`，理論上贏過任何 stylesheet rule（含原站 `!important`）。
  // 但 probe 實測 newtalk.tw 上 `<div id="footer" class="has-comment">` 被標
  // `data-jread-hidden="1"` 後，inline `style.cssText` 竟被清成 `display: none`
  // （priority 空字串、!important 被拔掉）——原站某個 JS handler 在 jread 之後
  // 把 element.style 重新賦值清掉 priority。此時原站 stylesheet 的
  // `#footer { display: block !important }`（ID selector specificity 1,0,0）贏過
  // jread stylesheet `[data-jread-hidden="1"] { display: none !important }`
  // （attr selector specificity 0,1,0），footer 重新 visible。
  //
  // 通則（非站點特判）：任何站的 scroll / resize / timer handler 都可能重新
  // assign style，尤其常見於響應式 UI。對策——開 MutationObserver watch 每個
  // hidden element 的 `style` attribute 變動，一旦 priority 不是 `important`
  // 就立即重新 setProperty。self-trigger 不會無限循環：下一次 mutation callback
  // 來時 priority 已正確、不再 re-set。
  //
  // 性能：hidden list 典型 50-200 個 element、observer 只對 attributeFilter:
  // ['style'] 觸發，原站 JS 高頻 scroll handler 下可能每秒 10 次 mutation、
  // callback 內做輕量 check + 必要時一次 setProperty，不足以影響 UX。
  let styleRestoreObserver = null;
  let hiddenElsRef = null;

  function watchHiddenInlineRestyle(hidden) {
    if (styleRestoreObserver) { styleRestoreObserver.disconnect(); styleRestoreObserver = null; }
    if (!Array.isArray(hidden) || hidden.length === 0) return;
    hiddenElsRef = new WeakSet(hidden.map(h => h.el).filter(Boolean));

    styleRestoreObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.attributeName !== 'style') continue;
        const el = m.target;
        if (!el || el.nodeType !== 1) continue;
        if (!hiddenElsRef.has(el)) continue;
        // element 仍應保持 jread hide 狀態
        if (!el.dataset || el.dataset.jreadHidden !== '1') continue;
        // 檢查 inline display 是否仍是 `none !important`；若被清掉就補回
        const pri = el.style.getPropertyPriority && el.style.getPropertyPriority('display');
        const dsp = el.style.display;
        if (dsp !== 'none' || pri !== 'important') {
          el.style.setProperty('display', 'none', 'important');
        }
      }
    });

    for (const item of hidden) {
      if (!item || !item.el || item.el.nodeType !== 1) continue;
      styleRestoreObserver.observe(item.el, { attributes: true, attributeFilter: ['style'] });
    }
  }

  function stopWatchingHiddenInlineRestyle() {
    if (styleRestoreObserver) {
      styleRestoreObserver.disconnect();
      styleRestoreObserver = null;
    }
    hiddenElsRef = null;
  }

  // ---- 對外介面 ---------------------------------------------------------
  const cleaner = {
    /**
     * 隱藏主文外與主文內的雜訊，回傳還原用的清單。
     * 規則順序：語意標籤 → fixed/sticky → 社群分享 cluster → 主文內 keyword。
     * @param {Element} articleEl 主文容器（必要）
     * @param {Object} [opts] 可選參數
     * @param {Element} [opts.promotedFrom] detector promote 升級前的 el；
     *   若有、跑 narrowPromotedSiblings 把 articleEl 直接子中「不含 content
     *   分支 + 不含 h1 分支」的 sibling chrome hide（ebc 類深層 single-child
     *   wrapper + 橫向 sibling chrome 結構修法）
     * @returns {Array<{el: Element, prevDisplay: string}>} 被隱藏的元素清單
     */
    clean(articleEl, opts) {
      const hidden = [];
      if (!articleEl || articleEl.nodeType !== 1) return hidden;
      // narrow 放最前：promote 升級後 articleEl 變大、需要先把 sibling chrome
      // 清掉、再跑其他 rule。否則後續 hideInsideArticle* 會對 chrome 子樹做
      // 全套檢查、浪費且產生誤殺風險（chrome 裡的 nav / button / list 等 UI
      // 元件可能命中各種 keyword rule、標成 hidden，但本該整塊清掉）。
      // opts.promotedTitleHead（v0.7.21）：detector promote 實際命中的 title
      // heading element（跨 tag h1-h4），narrow guard 會精準保留它的 sibling
      // 分支——Stratechery WordPress block theme 的 h2.wp-block-post-title
      // 在此獲得保護、不被誤認 sibling chrome 清掉。
      if (opts && opts.promotedFrom && opts.promotedFrom !== articleEl) {
        narrowPromotedSiblings(articleEl, opts.promotedFrom, hidden, opts.promotedTitleHead);
      }
      // dialog 放最前：語意最明確，先標掉避免後續規則把它的內部誤判
      hideDialogs(articleEl, hidden);
      hideOutsideArticleSemantic(articleEl, hidden);
      hideFixedOutsideArticle(articleEl, hidden);
      hideSocialShareClusters(articleEl, hidden);
      // 5 條 CONTAINER_SEL 規則共用同一次掃描結果（v0.6.26 效能重構）——
      // 原本各 rule 獨立 querySelectorAll 5 次 article descendant，合併成 1 次。
      // 規則內仍有 `continue` 排除 & `if (dataset.jreadHidden === '1') continue;`
      // 共享 hidden 標記，等同前後鏈接。
      const containers = articleEl.querySelectorAll(CONTAINER_SEL);
      hideInsideArticleByKeyword(articleEl, hidden, containers);
      hideInsideArticleByThirdPartyAds(articleEl, hidden);
      hideInsideArticleThirdPartyIframes(articleEl, hidden);
      hideInsideArticleByHeadingText(articleEl, hidden);
      hideInsideArticleByLinkText(articleEl, hidden);
      hideInsideArticleHashtagClusters(articleEl, hidden);
      hideInsideArticleAbsoluteCreditOverlays(articleEl, hidden);
      hideInsideArticleByInlineAdText(articleEl, hidden);
      hideInsideArticleFontTags(articleEl, hidden);
      hideInsideArticleCommentPanels(articleEl, hidden);
      hideInsideArticleAllButtons(articleEl, hidden);
      hideInsideArticleJsLinks(articleEl, hidden);
      hideInsideArticleIconOnlyLinks(articleEl, hidden);
      hideInsideArticleActionRows(articleEl, hidden, containers);
      hideInsideArticleButtonClusters(articleEl, hidden, containers);
      hideInsideArticleHorizontalRules(articleEl, hidden);
      hideInsideArticleNav(articleEl, hidden);
      hideInsideArticleEmptySpacers(articleEl, hidden, containers);
      hideInsideArticleSidebarColumns(articleEl, hidden, containers, opts && opts.promotedTitleHead);
      hideInsideArticleAbsoluteOverlays(articleEl, hidden);
      // 放最後：先讓精細規則標記，ancestor sibling 才跳過已隱藏者
      hideAncestorSiblings(articleEl, hidden);
      // grid/flex 殘留空欄 collapse：所有前置規則標記完 hidden 後再掃，才能
      // 偵測到「某 child 已被 hide」的條件
      collapseGridWithHiddenCell(articleEl, hidden);
      // articleEl 內部所有 grid/flex container 強制 block + 清 grid-template
      // （BBC 類 styled-components 主文被鎖在固定寬 grid 欄位內）
      collapseInnerGridFlex(articleEl, hidden);
      // articleEl 內部 flex-row container wrap 已啟動者 collapse 成 block
      // （healthsystemtracker Bootstrap `.row` 多 child 在 reader card 縮窄下
      // wrap → 段落被擠成窄欄；既有兩條 collapse 規則都漏網的 case）
      collapseInnerFlexWrap(articleEl, hidden);
      // 媒體 placeholder：padding-bottom hack vs 純 aspect-ratio 的區分
      resetMediaPlaceholderPadding(articleEl, hidden);
      // figure/picture 容器強制 block：ttv 類雙層 figure + 外層 flex 把 img
      // 壓到 0×0 的場景（v0.7.24）
      forceMediaContainerBlock(articleEl, hidden);
      // 清 articleEl 後代殘留 box-shadow（v0.7.30 cnyes 內層 article 殘留
      // 淡藍陰影、看起來像「卡中卡」框）
      clearDescendantBoxShadow(articleEl, hidden);
      // Lazy-load 圖片 src 補正：data-src / data-original / srcset → src
      // 放在 reset / collapse 之後，以防前置規則把 img 的 parent hide 掉
      // （被 hide 的 img 不用補、浪費 network 還有 decode 成本）
      hydrateLazyImages(articleEl, hidden);
      // reader mode 進行中持續攔截主文祖先鏈的 dynamic append
      startWatchingDynamicAppends(articleEl, hidden);
      // v0.7.23 newtalk.tw 修法：watch hidden el 的 inline style 被原站 JS
      // 覆寫清掉 !important priority，被清就立刻補回
      watchHiddenInlineRestyle(hidden);
      return hidden;
    },

    /**
     * 還原 clean() 所隱藏的元素。
     * @param {Array<{el: Element, prevDisplay: string}>} hiddenEls
     */
    restore(hiddenEls) {
      stopWatchingDynamicAppends();
      stopWatchingHiddenInlineRestyle();
      restoreLazyImages(hiddenEls);
      restoreMediaContainerBlock(hiddenEls);
      restoreDescendantBoxShadow(hiddenEls);
      restoreMediaResets(hiddenEls);
      restoreAbsoluteOverlayConverted(hiddenEls);
      restoreInnerFlexWrap(hiddenEls);
      restoreInnerGridFlex(hiddenEls);
      restoreCollapsed(hiddenEls);
      if (!Array.isArray(hiddenEls)) return;
      for (const item of hiddenEls) {
        if (!item || !item.el) continue;
        const { el, prevDisplay, prevDisplayPriority } = item;
        // 還原原始 inline display + priority（`!important` 也要還原，
        // 否則原站的 `display: flex !important` 若原本寫在 inline，
        // reader mode 退出後會變成無 priority）。
        el.style.removeProperty('display');
        if (prevDisplay) {
          el.style.setProperty('display', prevDisplay, prevDisplayPriority || '');
        }
        if (el.dataset) delete el.dataset.jreadHidden;
      }
    }
  };

  NS.cleaner = cleaner;
})();
