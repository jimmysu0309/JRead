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
        // inline margin (!important 防 styler 通用 rule 覆寫，scoped 不影響其他站)
        div.style.setProperty('margin', '1.2em 0', 'important');
        count++;
      }
    }
    return count;
  }

  // 在 clone 內清掉非主貼文內容：
  // - [role="article"] 留言（FB 把每則留言標為 role="article"）
  // - 所有 button / [role="button"]（CLAUDE.md 硬教訓九：reader mode 純閱讀
  //   定位下所有 interactive button 一律清，無保留例外）
  // - rect.height === 0 的 placeholder（hidden keyboard nav focus zone）
  // - 含留言區 wrapper 的直系子（textLen 通常較短但含多個 role="article"）
  // - reactions/share count wrapper（含「則留言」「次分享」等慣用語）
  function pruneReaderClone(clone, original) {
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

  // 從原 DOM 抽 author info 資訊：display name + avatar + timestamp link href
  function extractAuthorInfo(author, mainMsg) {
    const info = { displayName: null, avatarSrc: null };
    if (!author) return info;
    info.displayName = (author.innerText || author.textContent || '').trim() || null;
    // 作者 avatar：FB 把頭像 img 放在 profile_name 的 sibling/ancestor 範圍內,
    // 找最接近的 svg image 或 img。常見結構：
    //   <a><svg><image href="..."></svg></a>   <profile_name>
    // walk up 共同祖先後找含 image href 的 svg
    const headerScope = commonAncestor(author, mainMsg)?.parentElement || document.body;
    const imgs = headerScope.querySelectorAll('image[xlink\\:href], image[href], img');
    for (const im of imgs) {
      const src = im.getAttribute('xlink:href') || im.getAttribute('href') || im.getAttribute('src');
      if (!src || /^data:/.test(src)) continue;
      // 排除主文內嵌入圖（連結卡縮圖）：只取作者區域附近的 img
      // 簡單啟發：取第一個非主文內 img
      if (mainMsg && mainMsg.contains(im)) continue;
      info.avatarSrc = src;
      break;
    }
    return info;
  }

  function createSyntheticHeader(info) {
    const h = document.createElement('header');
    h.setAttribute('data-jread-fb-author', '1');
    h.style.cssText = 'display:flex;align-items:center;gap:12px;margin:1.4em 0 0.6em;';
    if (info.avatarSrc) {
      const img = document.createElement('img');
      img.setAttribute('data-jread-fb-avatar', '1');
      img.src = info.avatarSrc;
      img.alt = '';
      img.style.cssText = 'width:48px;height:48px;border-radius:50%;flex:0 0 auto;display:block;';
      h.appendChild(img);
    }
    if (info.displayName) {
      const strong = document.createElement('strong');
      strong.textContent = info.displayName;
      strong.style.cssText = 'font-size:1.05em;';
      h.appendChild(strong);
    }
    return h;
  }

  function enter() {
    const existing = document.querySelector('[' + READER_ATTR + ']');
    if (existing) return existing;

    const container = findPostContainer();
    if (!container) return null;

    const mainMsg = container.querySelector('[data-ad-comet-preview="message"]');
    const author = container.querySelector('[data-ad-rendering-role="profile_name"]');
    if (!mainMsg) return null;

    // 抽 author info 從原 DOM,合成 header 之後注入到 clone 開頭（取代被 prune
    // 掉的原 author header——原 header 含 timestamp / privacy icon / menu button
    // 等 UI chrome,清掉後我們補一個乾淨的）。
    const info = extractAuthorInfo(author, mainMsg);

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
    if (info.displayName || info.avatarSrc) {
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

  NS.fbPost = {
    isFacebookPost,
    findMainMessage,
    findAuthorForMessage,
    findPostContainer,
    extractAuthorInfo,
    createSyntheticHeader,
    pruneReaderClone,
    stripFacebookLayout,
    markParagraphDivs,
    enter,
    exit,
    isActive,
    READER_ATTR
  };
})();
