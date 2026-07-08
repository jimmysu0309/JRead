// JRead — Facebook permalink post reader
// Facebook permalink（/<user>/posts/pfbid* 等）沒主文 <article>、沒 <main>、
// 沒 schema.org，主貼文文字以 <span>/<div> 巢狀包裝、emotion-hash class、無
// semantic markup——detector 四層策略全 null。
//
// FB 內部 marker：`data-ad-comet-preview="message"` 包主貼文文字 wrapper、
// `data-ad-rendering-role="profile_name"` 標作者。page 上可能有多個 message
// （sidebar 推薦會出現 truncated 20-字版本），挑最長者為主貼文。
//
// 策略仿 x-thread.js：clone 主貼文 container 進合成 `<article data-jread-fb-reader>`
// 注入 body 開頭，hide 留言（[role="article"]）+ height=0 placeholder + reactions/
// share counter wrapper，再讓既有 cleaner / styler 流程跑過。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const READER_ATTR = 'data-jread-fb-reader';

  // FB permalink URL patterns:
  //   /<user>/posts/pfbid*
  //   /<user>/posts/<id>
  //   /permalink.php?story_fbid=*
  //   /story.php?story_fbid=*&id=*
  //   /share/p/<id>
  //   /groups/<gid>/posts/<pid>/                       ← 既有 /posts/ 規則涵蓋
  //   /groups/<gid>/permalink/<pid>/                   ← 既有 /permalink/ 規則涵蓋
  //   /groups/<gid>/?multi_permalinks=<pid>            ← v0.7.159 新增（modal preview）
  //   /photo/?fbid=<id>&set=<set_id>                   ← v0.7.204 新增（相簿照片貼文）
  //   /photo.php?fbid=<id>                             ← v0.7.204 新增（legacy 相簿照片）
  function isFacebookPost(url) {
    const target = url || (typeof location !== 'undefined' ? location.href : '');
    try {
      const u = new URL(target);
      if (!/^(www\.|m\.|mobile\.|web\.)?facebook\.com$/.test(u.hostname)) return false;
      const path = u.pathname;
      if (/\/posts\//.test(path)) return true;
      if (/\/permalink(\.php)?(\/|$)/.test(path)) return true;
      if (path === '/story.php' && (u.searchParams.has('story_fbid') || u.searchParams.has('fbid'))) return true;
      if (/\/share\/p\//.test(path)) return true;
      // FB Groups modal preview：/groups/<gid>/?multi_permalinks=<pid>
      // 從社團頁面點某貼文展開的 URL，主貼文在 modal overlay 內、結構與一般 permalink 相同
      if (/^\/groups\//.test(path) && u.searchParams.has('multi_permalinks')) return true;
      // FB photo permalink：/photo/?fbid=<id> 或 /photo.php?fbid=<id>
      // 相簿照片頁附帶貼文內容，DOM 結構與一般 permalink 相同（data-ad-comet-preview="message"）
      if (/^\/photo(\.php)?\/?$/.test(path) && u.searchParams.has('fbid')) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  // 找最近的共同祖先
  function commonAncestor(a, b) {
    if (!a || !b) return null;
    const anc = new Set();
    let c = a;
    while (c) { anc.add(c); c = c.parentElement; }
    c = b;
    while (c) {
      if (anc.has(c)) return c;
      c = c.parentElement;
    }
    return null;
  }

  // 找主貼文 message wrapper：最長的 [data-ad-comet-preview="message"]。
  // 為何挑最長：sidebar 推薦的 message 通常被 FB 截斷到 20 字以內並附「查看更多」
  // 連結；真正主貼文展開後是完整文字（通常 >= 100 字，常見數百到數千字）。
  function findMainMessage() {
    const msgs = Array.from(document.querySelectorAll('[data-ad-comet-preview="message"]'));
    if (msgs.length === 0) return null;
    return msgs.sort((a, b) => (b.innerText || b.textContent || '').length - (a.innerText || a.textContent || '').length)[0];
  }

  // 從 message wrapper 找對應的作者 profile_name。策略：找所有 profile_name，
  // 取「最接近 message」者（DOM 距離最短的共同祖先層級最少）。
  function findAuthorForMessage(mainMsg) {
    if (!mainMsg) return null;
    const profiles = Array.from(document.querySelectorAll('[data-ad-rendering-role="profile_name"]'));
    if (profiles.length === 0) return null;
    if (profiles.length === 1) return profiles[0];
    // 選共同祖先 textLen 最接近 message 的（主貼文 unit）
    let best = null;
    let bestLen = Infinity;
    for (const p of profiles) {
      const anc = commonAncestor(mainMsg, p);
      if (!anc) continue;
      const len = (anc.innerText || anc.textContent || '').length;
      // 主貼文 unit 的祖先 textLen 應該略大於 message 自己；過大代表抓到含留言的 wrapper
      if (len < bestLen) {
        best = p;
        bestLen = len;
      }
    }
    return best;
  }

  // 找主貼文容器：message wrapper + author profile_name 的最近共同祖先。
  function findPostContainer() {
    const mainMsg = findMainMessage();
    if (!mainMsg) return null;
    const author = findAuthorForMessage(mainMsg);
    if (!author) return null;
    const container = commonAncestor(mainMsg, author);
    return container;
  }

  // FB 的 emotion-hash class（x14z9mp / xat24cr / x1lziwak 等）依賴整站 flex/grid
  // 祖先 context 才 layout 正確。clone 進合成 article 後失去 context、所有文字
  // div 被 rect 算成 0×0（display:block / visibility:visible / opacity:1 但無
  // 可視大小）。策略：strip 所有 element 的 class + inline style，讓內容回到
  // 瀏覽器預設 block layout + jread styler 接管 typography。保留 href / src /
  // alt / aria-label 等資訊類 attribute。
  function stripFacebookLayout(root) {
    if (!root || !root.querySelectorAll) return;
    // walk root + all descendants
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      if (el.removeAttribute) {
        el.removeAttribute('class');
        el.removeAttribute('style');
      }
    }
  }

  // FB 主貼文文字用 <div> 不用 <p> 包段落，strip class 後失去原 emotion-hash
  // class 的 line-height / margin 規則，所有段落擠在一起難讀。
  // 修法：walk clone，找「直接含文字的 leaf paragraph div」（children 只有
  // text node 或 inline element 如 a/span/strong/em）標 data-jread-fb-para=1，
  // 再給合成 reader card 內 [data-jread-fb-para] inline 套 paragraph margin。
  // 不對 reader card 內所有 div 套規則——巢狀 wrapper div 會累積 margin、且
  // figure/img 包 div 不需要段落間距。
  function markParagraphDivs(root) {
    if (!root || !root.querySelectorAll) return 0;
    const divs = root.querySelectorAll('div');
    let count = 0;
    const INLINE_TAGS = new Set(['SPAN', 'A', 'STRONG', 'EM', 'I', 'B', 'U', 'BR', 'MARK', 'SMALL', 'SUP', 'SUB', 'CODE']);
    for (const div of divs) {
      // 必須直接含 textNode 文字（textContent 不算，要直接 child text node）
      let hasDirectText = false;
      let hasBlockChild = false;
      for (const node of div.childNodes) {
        if (node.nodeType === 3 /* TEXT_NODE */ && node.textContent.trim().length >= 4) {
          hasDirectText = true;
        } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
          if (!INLINE_TAGS.has(node.tagName)) {
            hasBlockChild = true;
            break;
          }
        }
      }
      if (hasDirectText && !hasBlockChild) {
        div.setAttribute('data-jread-fb-para', '1');
        // v0.7.163：inline fallback margin（無 !important）——styler stylesheet
        // 端的 paragraphSpacing 規則 selector 已涵蓋 [data-jread-fb-para]，
        // 使用者調整段落間距會生效。硬教訓十：inline !important 永遠贏
        // stylesheet !important，先前寫死 !important 會擋掉使用者設定。
        // 此處 1.2em 是 Auto sentinel (-1) 與 styler 規則尚未注入時的 fallback。
        div.style.margin = '1.2em 0';
        count++;
      }
    }
    return count;
  }

  // 在 clone 內清掉非主貼文內容：
  // - 主貼文 message 之後的 sibling chain（link-card / reactions / OG meta
  //   重複描述 等所有「主文結束後」內容；v0.7.158）
  // - [role="article"] 留言（FB 把每則留言標為 role="article"）
  // - 所有 button / [role="button"]（CLAUDE.md 硬教訓九：reader mode 純閱讀
  //   定位下所有 interactive button 一律清，無保留例外）
  // - rect.height === 0 的 placeholder（hidden keyboard nav focus zone）
  // - 含留言區 wrapper 的直系子（textLen 通常較短但含多個 role="article"）
  // - reactions/share count wrapper（含「則留言」「次分享」等慣用語）
  function pruneReaderClone(clone, original) {
    // v0.7.158 主文後續 sibling chain 全清（chrome-in-chrome probe 真實 FB DOM
    // 後的最終版）。實機 Nathan Chiu 貼文 DOM 結構：
    //   findPostContainer 結果（commonAncestor）4 個 children：
    //     [0] Facebook x N hidden placeholder
    //     [1] author header (Nathan Chiu + timestamp)
    //     [2] content wrapper        ← 含 mainMsg
    //         └── inner wrapper      ← 此 wrapper 的 children：
    //             ├── [0] story_message > mainMsg
    //             └── [1] 附帶圖 wrapper（textLen=0, imgs=1）★ 保留
    //     [3] reactions+留言 (textLen=1288, imgs=18)
    // 沿 mainMsg 祖先鏈往上走時，會在「inner wrapper」層遇到 [1] 附帶圖 —
    // 必須結構性辨識保留之，否則貼文媒體被誤殺（Jimmy 第二次回報）。
    //
    // 保留條件（chrome-in-chrome 連 Jimmy session 多輪實機 probe 後最終版）：
    //
    // sibling 三種類型 + 處理方式：
    //   附帶圖 wrapper：含 img + 不含 role=article + 不含 button + linkRatio 低
    //                  → **保留整個 wrapper**
    //   share-preview widget：含 img + 不含 role=article + 不含 button + **linkRatio 高**
    //                  （整片是 <a> 連結—— FB OG share preview 把貼文預覽包成 link
    //                  cluster：short URL + 作者名 + 重複貼文文字 + 縮圖全在 <a> 內）
    //                  → **unwrap 只留媒體**（砍 short URL / 作者名 / 重複文字、保留圖）
    //   reactions+留言 wrapper：含 role=article 或 button → **整 wrapper 砍**
    //
    // linkRatio = anchorText.length / allText.length（去 whitespace 後計算）
    // 實機 probe 結果（Jimmy 2026-05-21 Nathan Chiu 貼文）：
    //   share-preview widget linkRatio = 1.01（textContent 中 <a> 文字佔 100%+）
    //   reactions+留言 wrapper linkRatio = 0.12
    //   一般附帶圖 wrapper linkRatio 預期遠小於 0.7（圖不會整個包在 <a> 內）
    // 閾值 0.7 為判別線。
    const mainMsgClone = clone.querySelector('[data-ad-comet-preview="message"]');
    if (mainMsgClone) {
      let node = mainMsgClone.parentElement;
      while (node && node !== clone) {
        let next = node.nextElementSibling;
        while (next) {
          const toRemove = next;
          next = next.nextElementSibling;
          const hasMedia = toRemove.querySelector('img, picture, video');
          const hasComment = toRemove.querySelector('[role="article"]');
          const hasButton = toRemove.querySelector('button, [role="button"]');
          if (hasComment || hasButton) { toRemove.remove(); continue; }
          if (!hasMedia) { toRemove.remove(); continue; }

          // 算 linkRatio：textContent 中 <a> 文字佔比
          const allText = (toRemove.textContent || '').replace(/\s/g, '');
          const anchorText = Array.from(toRemove.querySelectorAll('a'))
            .map(a => (a.textContent || '').replace(/\s/g, '')).join('');
          const linkRatio = allText.length ? anchorText.length / allText.length : 0;

          if (linkRatio > 0.7) {
            // share-preview widget：unwrap 圖、砍其他內容
            const mediaEls = toRemove.querySelectorAll('img, picture, video');
            if (mediaEls.length > 0) {
              const wrap = clone.ownerDocument.createElement('div');
              wrap.setAttribute('data-jread-fb-media', '1');
              for (const m of mediaEls) {
                // 移除 <a> 包裝，只 clone 媒體 element 本身
                wrap.appendChild(m.cloneNode(true));
              }
              toRemove.replaceWith(wrap);
            } else {
              toRemove.remove();
            }
            continue;
          }
          // linkRatio 低 + 含媒體 → 純附帶媒體 wrapper，整個保留
        }
        node = node.parentElement;
      }
    }

    // 留言全清
    const comments = clone.querySelectorAll('[role="article"]');
    comments.forEach(c => c.remove());

    // button 全清（讚 / 留言 / 分享 / 訂閱 / 追蹤 / 更多選項 等）
    const buttons = clone.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]');
    buttons.forEach(b => b.remove());

    // height=0 placeholder：clone 後 rect 為 0,0,0,0,要用「原 DOM 對應節點」量
    // ——clone 沒在 DOM 上時 getBoundingClientRect 全 0。對應原節點還在 DOM,可量。
    // 用 querySelectorAll 在 clone + original 平行 walk 不可靠（節點順序可能因
    // remove 而錯位）。改採直接特徵：clone 內所有 div 直系子,若其 textContent
    // 只剩重複字串「Facebook」且 < 20 字唯一字元種類,即視為 placeholder。
    const directChildren = Array.from(clone.children);
    for (const child of directChildren) {
      const text = (child.textContent || '').trim();
      if (!text) continue;
      // placeholder 特徵：純 "Facebook" 字串重複（FB hidden a11y zone）
      if (/^(Facebook\s*){3,}$/.test(text)) {
        child.remove();
        continue;
      }
    }

    // 移除 reactions / share counter / 留言區 wrapper：
    // 特徵 = 含「所有心情」「則留言」「次分享」「Like」「Comment」「Share」等
    // FB metadata text 的 wrapper。我們只移除「含這些 text 且不含主 message」
    // 的直系子（避免誤殺主文）。
    const META_RE = /(所有心情|則留言|次分享|喜歡|留言|分享|Reactions:|Comments?|Shares?|Like|Comment|Share)/i;
    const remaining = Array.from(clone.children);
    let mainMsgInClone = clone.querySelector('[data-ad-comet-preview="message"]');
    for (const child of remaining) {
      if (mainMsgInClone && child.contains(mainMsgInClone)) continue;
      const text = (child.textContent || '').trim();
      if (!text) {
        child.remove();
        continue;
      }
      // 短 metadata（< 500 字）且 命中 META_RE 視為 reactions/share/留言 metadata
      // 主文不可能短於 500 字（最長 message 已經是主文）
      if (text.length < 500 && META_RE.test(text)) {
        child.remove();
      }
    }

    return clone;
  }

  // 從原 DOM 抽 author info 資訊：display name。
  // v0.7.158 移除 avatar 抓取——FB DOM 把作者頭像 SVG image 與貼文預覽卡縮圖
  // 放在共同祖先的不同 sibling 內，querySelectorAll DOM order 容易誤取預覽卡
  // 圖（例如 Jimmy 2026-05-21 回報 Nathan Chiu 貼文的 avatar 變成內文提到的
  // Sundar Pichai 演講照）。FB DOM 結構頻繁改版，穩定 selector 難維護。
  // reader mode 是純閱讀、作者名已足夠識別，移除 avatar 視覺更乾淨。
  function extractAuthorInfo(author) {
    const info = { displayName: null };
    if (!author) return info;
    info.displayName = (author.innerText || author.textContent || '').trim() || null;
    return info;
  }

  function createSyntheticHeader(info) {
    const h = document.createElement('header');
    h.setAttribute('data-jread-fb-author', '1');
    h.style.cssText = 'margin:1.4em 0 0.6em;';
    if (info.displayName) {
      const strong = document.createElement('strong');
      strong.textContent = info.displayName;
      strong.style.cssText = 'font-size:1.05em;';
      h.appendChild(strong);
    }
    return h;
  }

  // ── v0.7.204 FB photo page fallback ──
  // FB photo permalink（/photo/?fbid=...）的 DOM 結構跟一般 permalink 完全不同：
  //   - 完全沒有 data-ad-comet-preview="message"
  //   - 完全沒有 data-ad-rendering-role="profile_name"
  //   - 主文在 role="complementary" 右側面板的 <span dir="auto"> 內
  //   - 作者名在 <a aria-label="..." href="/username"> FB profile link
  //   - 文字用 <br> 換行 + hashtag <a> + 可能有「查看更多」截斷
  // 2026-05-28 chrome-in-chrome probe 真實 facebook.com/photo/?fbid=... 頁面驗證。
  // 點「查看更多」展開截斷文字。FB React setState 是 async，必須在獨立 JS
  // task 跑完後才 re-render——呼叫端（main.js enterFbPostMode）await 短暫
  // delay 讓 React flush，再呼叫 enter() 讀已展開的文字。
  function expandSeeMore() {
    var panel = document.querySelector('[role="complementary"]');
    if (!panel) return false;
    var btns = panel.querySelectorAll('[role="button"]');
    var clicked = false;
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].innerText || '').trim();
      if (/^(查看更多|See [Mm]ore|顯示更多)$/.test(t)) {
        btns[i].click();
        clicked = true;
      }
    }
    return clicked;
  }

  function findPhotoPostContent() {
    var panel = document.querySelector('[role="complementary"]');
    if (!panel) return null;

    // 找作者：panel 內第一個指向 FB profile 的 <a>（帶 aria-label 或 clean text）
    var authorName = null;
    var profileLinks = panel.querySelectorAll('a[href]');
    for (var ai = 0; ai < profileLinks.length; ai++) {
      var href = profileLinks[ai].getAttribute('href') || '';
      if (/^https:\/\/(www\.)?facebook\.com\/[A-Za-z0-9._]+\/?$/.test(href)) {
        authorName = profileLinks[ai].getAttribute('aria-label') || (profileLinks[ai].innerText || '').trim();
        if (authorName && authorName.length > 0 && authorName.length < 50) break;
        authorName = null;
      }
    }

    // 找主文：panel 內最長的 <span dir="auto">，排除留言（role="article" 內）
    var candidates = Array.from(panel.querySelectorAll('span[dir="auto"]'))
      .filter(function (s) { return !s.closest('[role="article"]'); })
      .filter(function (s) { return (s.innerText || '').length > 100; })
      .sort(function (a, b) { return (b.innerText || '').length - (a.innerText || '').length; });

    if (candidates.length === 0) return null;

    var postTextEl = candidates[0];

    // 找 photo 圖片
    var photoImg = document.querySelector('img[data-visualcompletion="media-vc-image"]');

    return { authorName: authorName, postTextEl: postTextEl, photoImg: photoImg };
  }

  function enterPhotoMode() {
    var content = findPhotoPostContent();
    if (!content || !content.postTextEl) return null;

    var reader = document.createElement('article');
    reader.setAttribute(READER_ATTR, '1');
    var lang = document.documentElement.getAttribute('lang');
    if (lang) reader.setAttribute('lang', lang);

    // 作者 header
    if (content.authorName) {
      var header = createSyntheticHeader({ displayName: content.authorName });
      reader.appendChild(header);
    }

    // 照片（放在作者下方、主文上方）
    if (content.photoImg) {
      var figure = document.createElement('figure');
      var imgClone = content.photoImg.cloneNode(true);
      imgClone.removeAttribute('class');
      imgClone.removeAttribute('style');
      imgClone.style.cssText = 'max-width:100%;height:auto;display:block;margin:1em auto;';
      figure.appendChild(imgClone);
      reader.appendChild(figure);
    }

    // 主文文字 clone + 清理
    var textClone = content.postTextEl.cloneNode(true);
    // 移除「顯示較少」按鈕
    var roleBtns = textClone.querySelectorAll('[role="button"]');
    for (var ri = 0; ri < roleBtns.length; ri++) {
      var rt = (roleBtns[ri].innerText || '').trim();
      if (/^(顯示較少|Show [Ll]ess|收合)$/.test(rt)) roleBtns[ri].remove();
    }
    stripFacebookLayout(textClone);

    // 包進 div
    var textWrapper = document.createElement('div');
    textWrapper.appendChild(textClone);
    reader.appendChild(textWrapper);

    document.body.insertBefore(reader, document.body.firstChild);

    // hide body 直系子（同 enter() 邏輯；JRead 自家 host 豁免，見 enter() 註解）
    _hiddenBodySiblings = [];
    for (var ci = 0; ci < document.body.children.length; ci++) {
      var child = document.body.children[ci];
      if (child === reader) continue;
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
      if (child.id && child.id.indexOf('__jread') === 0) continue;
      var prevDisplay = child.style.getPropertyValue('display');
      var prevPriority = child.style.getPropertyPriority('display');
      child.style.setProperty('display', 'none', 'important');
      _hiddenBodySiblings.push({ el: child, prevDisplay: prevDisplay, prevPriority: prevPriority });
    }

    return reader;
  }

  function enter() {
    const existing = document.querySelector('[' + READER_ATTR + ']');
    if (existing) return existing;

    const container = findPostContainer();
    if (!container) return enterPhotoMode();

    const mainMsg = container.querySelector('[data-ad-comet-preview="message"]');
    const author = container.querySelector('[data-ad-rendering-role="profile_name"]');
    if (!mainMsg) return null;

    // 抽 author info 從原 DOM,合成 header 之後注入到 clone 開頭（取代被 prune
    // 掉的原 author header——原 header 含 timestamp / privacy icon / menu button
    // 等 UI chrome,清掉後我們補一個乾淨的）。
    const info = extractAuthorInfo(author);

    // 建合成 reader card
    const reader = document.createElement('article');
    reader.setAttribute(READER_ATTR, '1');
    const lang = document.documentElement.getAttribute('lang');
    if (lang) reader.setAttribute('lang', lang);

    // clone 整個 container 進 reader（cloneNode true 保留所有圖片 src 與文字）
    const clone = container.cloneNode(true);
    pruneReaderClone(clone, container);
    // strip FB layout class/style 讓內容回瀏覽器預設 block layout（修 emotion-
    // hash class 在合成容器內因失去祖先 context 而 layout 算錯 0×0 的問題）
    stripFacebookLayout(clone);
    // 給 leaf paragraph div 加 inline margin（FB 用 div 不用 p，strip class 後
    // 段落緊貼難讀）
    markParagraphDivs(clone);

    // 合成 author header 放最前
    if (info.displayName) {
      const header = createSyntheticHeader(info);
      reader.appendChild(header);
    }
    reader.appendChild(clone);

    document.body.insertBefore(reader, document.body.firstChild);

    // hide body 直系子（除了 reader card），相當於 cleaner.hideAncestorSiblings
    // 的精神——FB permalink 頁會 render 主貼文 modal overlay（dialog 形式），
    // 不 hide 就會跟 reader card 同時顯示。記下被 hide 的 element + 原始 inline
    // display value，exit() 時還原。
    _hiddenBodySiblings = [];
    for (const child of Array.from(document.body.children)) {
      if (child === reader) continue;
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
      // v0.8.36：JRead 自家掛在 body 上的 host（#__jread-toast-host /
      // #__jread-page-indicator 等，一律 __jread 前綴）豁免——舊版只排除
      // script/style，toast host 若在 enter 前已存在（本頁先前顯示過 toast）
      // 會被 inline !important 蓋掉，FB reader 下送 Readwise 的結果 toast
      // 不可見（styler 的同款 ancestor 規則有 :not(#__jread-toast-host)，
      // 本 path 是該事實的第二實作、漏了排除——以 id 前綴做結構性豁免）。
      if (child.id && child.id.indexOf('__jread') === 0) continue;
      const prevDisplay = child.style.getPropertyValue('display');
      const prevPriority = child.style.getPropertyPriority('display');
      child.style.setProperty('display', 'none', 'important');
      _hiddenBodySiblings.push({ el: child, prevDisplay, prevPriority });
    }

    return reader;
  }

  // 記錄 enter() hide 的 body 直系子，exit() 還原（避免破壞原 FB SPA 狀態）
  let _hiddenBodySiblings = [];

  function exit() {
    // 還原 body sibling display
    for (const { el, prevDisplay, prevPriority } of _hiddenBodySiblings) {
      el.style.removeProperty('display');
      if (prevDisplay) {
        el.style.setProperty('display', prevDisplay, prevPriority || '');
      }
    }
    _hiddenBodySiblings = [];

    const readers = document.querySelectorAll('[' + READER_ATTR + ']');
    readers.forEach(r => r.remove());
  }

  function isActive() {
    return !!document.querySelector('[' + READER_ATTR + ']');
  }

  // v0.7.167：FB permalink URL 抽 vanity username 給 Readwise author 欄位。
  // `/<user>/posts/<id>` pattern 的 seg[0] = vanity username。其他 reserved
  // pattern(groups/permalink.php/story.php/share/profile.php)沒 vanity,回
  // 空字串讓 caller(main.js extractAuthor)fallback 到 displayName。
  function extractAuthorVanityFromUrl(url) {
    const target = url || (typeof location !== 'undefined' ? location.href : '');
    try {
      const u = new URL(target);
      if (!/^(www\.|m\.|mobile\.|web\.)?facebook\.com$/i.test(u.hostname)) return '';
      const seg = u.pathname.split('/').filter(Boolean);
      if (seg.length < 2) return '';
      if (seg[1] !== 'posts') return '';
      const reserved = new Set(['groups', 'permalink.php', 'story.php', 'share', 'profile.php', 'permalink', 'people', 'pages']);
      if (reserved.has(seg[0])) return '';
      return seg[0];
    } catch (_) {
      return '';
    }
  }

  NS.fbPost = {
    isFacebookPost,
    findMainMessage,
    findAuthorForMessage,
    findPostContainer,
    extractAuthorInfo,
    extractAuthorVanityFromUrl,
    createSyntheticHeader,
    pruneReaderClone,
    stripFacebookLayout,
    markParagraphDivs,
    expandSeeMore,
    enter,
    exit,
    isActive,
    READER_ATTR
  };
})();
