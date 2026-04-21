// JRead — 閱讀模式排版
// 透過單一注入的 <style id="__jread-style"> 套用所有 reader-mode 樣式。
// 用 data-jread-active / data-jread-ancestor attribute 當 selector 目標，
// restore() 只要移除 style 元素與 attribute 即可完整還原，不動任何原 inline style。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const STYLE_ID = '__jread-style';
  const HTML_CLASS = '__jread-active';
  const ARTICLE_ATTR = 'data-jread-active';
  const ANCESTOR_ATTR = 'data-jread-ancestor';
  const STRUCTURAL_LINK_ATTR = 'data-jread-structural-link';

  // Theme 配色：pageBg = 頁面底色，articleBg = 主文容器底色，
  // text = 主文字色，link = 連結色（須在各 theme 下有足夠對比）
  const THEMES = {
    light: { pageBg: '#ececec', articleBg: '#ffffff', text: '#1a1a1a', link: '#2b6cb0', quote: '#4a5568' },
    dark:  { pageBg: '#0b0b0b', articleBg: '#1a1a1a', text: '#d4d4d4', link: '#63b3ed', quote: '#a0aec0' },
    sepia: { pageBg: '#cdb891', articleBg: '#f4ecd8', text: '#5b4636', link: '#8b4513', quote: '#7c6142' }
  };

  function themeOf(name) {
    return THEMES[name] || THEMES.light;
  }

  function buildCss(t, opts) {
    const { fontSize, contentWidth, fontFamily, lineHeight } = opts;
    // 重點：
    // - html/body 背景與 reset 用 .${HTML_CLASS} 掛在 <html>，避免影響未啟用時的頁面
    // - 祖先鏈 [data-jread-ancestor] 做激進 reset（max-width/width/margin/padding/
    //   background/float/position/transform）以避免站點原本的寬度/版心限制
    // - 主文容器 [data-jread-active] 才是「讀者感知到的文章卡片」
    // - 用 !important 覆蓋站點 CSS；站點若也用 !important 則會平手，少數站點
    //   可能需要 site-overrides（本輪不處理）
    return `
html.${HTML_CLASS} {
  background: ${t.pageBg} !important;
}
html.${HTML_CLASS} body {
  background: ${t.pageBg} !important;
  margin: 0 !important;
  padding: 0 !important;
  max-width: none !important;
  width: auto !important;
  min-width: 0 !important;
  overflow-x: hidden !important;
  color: ${t.text} !important;
}
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
[${ARTICLE_ATTR}="1"] {
  box-sizing: border-box !important;
  max-width: ${contentWidth}px !important;
  width: auto !important;
  min-height: 0 !important;
  height: auto !important;
  margin: 40px auto !important;
  padding: 48px 56px !important;
  background: ${t.articleBg} !important;
  background-image: none !important;
  color: ${t.text} !important;
  font-family: ${fontFamily}, -apple-system, "Noto Sans TC", "PingFang TC", system-ui, sans-serif !important;
  font-size: ${fontSize}px !important;
  line-height: ${lineHeight} !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
  float: none !important;
  position: static !important;
  transform: none !important;
}
/* 第一個可見子元素的 margin-top / padding-top 清零，避免主文容器頂端出現
   大片空白（常見於 Medium：被 cleaner 隱藏的 hero 容器被 display:none 後，
   第一個可見子若還帶原本的 margin-top 會造成視覺留白） */
[${ARTICLE_ATTR}="1"] > *:first-child {
  margin-top: 0 !important;
  padding-top: 0 !important;
}
[${ARTICLE_ATTR}="1"] * {
  max-width: 100% !important;
  float: none !important;
}
/* 強制所有非 heading、非 pre/code 的後代繼承 article 的 font-size。
   理由：站點的 <p> / <li> / <span> 常帶自己的 font-size（例如 Medium
   的 <p> 寫死 21px），只對容器設 font-size 不會向下繼承，導致字級調整
   只有用 em 單位的 heading 生效。pre/code 排除是因為它們用 0.9em 相對
   縮放（仍會跟著 article 的 fontSize 改變）。 */
[${ARTICLE_ATTR}="1"] *:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6):not(pre):not(code) {
  font-size: inherit !important;
}
/* 同站點有些 wrapper 會 inline 指定 min-height / height / background-image
   造成頂端留白。對主文內的所有容器做保險 reset */
[${ARTICLE_ATTR}="1"] div,
[${ARTICLE_ATTR}="1"] section {
  min-height: 0 !important;
  background-image: none !important;
}
/* 「padding-bottom hack」清除：Substack / Medium 用
   'position: relative; padding-bottom: 56.25%' 為圖片預留 aspect-ratio
   空間（img absolute 覆蓋）。閱讀模式下 img 被改成 static + height:auto，
   padding 留著會變視覺留白。:has() 命中所有含 img/picture/video 的祖先
   容器（不碰 figure 的 margin，只 reset padding-bottom / aspect-ratio）。
   瀏覽器需 Chrome 105+（2022/08），目標使用者環境滿足。 */
[${ARTICLE_ATTR}="1"] *:has(img),
[${ARTICLE_ATTR}="1"] *:has(picture),
[${ARTICLE_ATTR}="1"] *:has(video) {
  padding: 0 !important;
  aspect-ratio: auto !important;
  min-height: 0 !important;
  height: auto !important;
}
/* 媒體本體：margin 歸 0，由「媒體容器」（figure / :has(img)）統一負責間距。
   避免 figure + img 雙 margin 疊加造成段落與圖片之間過大留白（Substack 上
   觀察到 60+ px 留白的根因）。 */
[${ARTICLE_ATTR}="1"] img,
[${ARTICLE_ATTR}="1"] video,
[${ARTICLE_ATTR}="1"] iframe,
[${ARTICLE_ATTR}="1"] picture {
  max-width: 100% !important;
  height: auto !important;
  display: block !important;
  margin: 0 auto !important;
  border-radius: 4px !important;
}
/* 媒體容器：figure、或任何直接含 img/picture/video/figure 的 wrapper；
   或 <a> 包 img/picture/figure 這類連結包圖的結構。
   Substack 的 .captioned-image-container 包 <figure>（figure 內才是
   <a><div><picture><img></>），所以必須有 :has(> figure) 這條，
   否則 Substack 的站內 CSS 會勝出塞 32px margin 造成段落與圖片間不自然
   留白。不可改用 :has(img)/:has(figure)（descendant）因其會匹配到
   article 本身與所有媒體祖先。 */
[${ARTICLE_ATTR}="1"] figure,
[${ARTICLE_ATTR}="1"] *:has(> img),
[${ARTICLE_ATTR}="1"] *:has(> picture),
[${ARTICLE_ATTR}="1"] *:has(> video),
[${ARTICLE_ATTR}="1"] *:has(> figure),
[${ARTICLE_ATTR}="1"] *:has(> a > img),
[${ARTICLE_ATTR}="1"] *:has(> a > picture),
[${ARTICLE_ATTR}="1"] *:has(> a > figure) {
  margin-top: 1.2em !important;
  margin-bottom: 1.2em !important;
}
[${ARTICLE_ATTR}="1"] figcaption {
  font-size: 0.875em !important;
  color: ${t.quote} !important;
  text-align: center !important;
  margin-top: 0.5em !important;
}
[${ARTICLE_ATTR}="1"] p,
[${ARTICLE_ATTR}="1"] ul,
[${ARTICLE_ATTR}="1"] ol {
  margin: 1em 0 !important;
}
[${ARTICLE_ATTR}="1"] li {
  margin: 0.3em 0 !important;
}
[${ARTICLE_ATTR}="1"] h1,
[${ARTICLE_ATTR}="1"] h2,
[${ARTICLE_ATTR}="1"] h3,
[${ARTICLE_ATTR}="1"] h4,
[${ARTICLE_ATTR}="1"] h5,
[${ARTICLE_ATTR}="1"] h6 {
  color: ${t.text} !important;
  line-height: 1.3 !important;
  margin: 1.6em 0 0.6em !important;
  font-weight: 700 !important;
}
[${ARTICLE_ATTR}="1"] h1 { font-size: 1.8em !important; }
[${ARTICLE_ATTR}="1"] h2 { font-size: 1.5em !important; }
[${ARTICLE_ATTR}="1"] h3 { font-size: 1.25em !important; }
[${ARTICLE_ATTR}="1"] a {
  color: ${t.link} !important;
  text-decoration: underline !important;
}
/* 結構性連結（heading 包 a、或 parent 只含此 a 作為文字）繼承父層色。
   避免 WordPress / Medium / Substack 類 CMS 把 post-title、category
   meta 包成 <a>，閱讀模式下整行變連結樣式。標記由 styler.apply() 掃描
   主文內所有 <a> 後掛上；真 inline link（parent 還有其他文字）不被標。 */
[${ARTICLE_ATTR}="1"] a[${STRUCTURAL_LINK_ATTR}="1"] {
  color: inherit !important;
  text-decoration: none !important;
}
[${ARTICLE_ATTR}="1"] blockquote {
  border-left: 4px solid ${t.link} !important;
  margin: 1.5em 0 !important;
  padding: 0.3em 0 0.3em 1.2em !important;
  color: ${t.quote} !important;
  font-style: italic !important;
  background: transparent !important;
}
[${ARTICLE_ATTR}="1"] pre,
[${ARTICLE_ATTR}="1"] code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace !important;
  font-size: 0.9em !important;
  background: rgba(127, 127, 127, 0.12) !important;
  border-radius: 4px !important;
}
[${ARTICLE_ATTR}="1"] pre {
  padding: 1em !important;
  overflow-x: auto !important;
  white-space: pre !important;
}
[${ARTICLE_ATTR}="1"] code {
  padding: 0.15em 0.35em !important;
}
[${ARTICLE_ATTR}="1"] pre code {
  padding: 0 !important;
  background: transparent !important;
}
[${ARTICLE_ATTR}="1"] hr {
  border: 0 !important;
  border-top: 1px solid ${t.quote} !important;
  opacity: 0.3 !important;
  margin: 2em 0 !important;
}
[${ARTICLE_ATTR}="1"] table {
  border-collapse: collapse !important;
  margin: 1.5em auto !important;
}
[${ARTICLE_ATTR}="1"] th,
[${ARTICLE_ATTR}="1"] td {
  border: 1px solid ${t.quote} !important;
  padding: 0.5em 0.8em !important;
}
`;
  }

  function markAncestors(articleEl) {
    const ancestors = [];
    let p = articleEl.parentElement;
    const stop = document.body || document.documentElement;
    while (p && p !== stop) {
      p.setAttribute(ANCESTOR_ATTR, '1');
      ancestors.push(p);
      p = p.parentElement;
    }
    return ancestors;
  }

  // 標記結構性連結。兩條通則（非站點特判）：
  //   A. <a> 位於 h1-h6 內——WordPress / Medium / Substack 把 post-title
  //      包成連結（點標題跳 permalink），此 <a> 應該繼承 heading 色。
  //   B. <a> 的 parent textContent 等於 <a> textContent——即整個 parent
  //      只有這一個連結作為文字（分類標籤、作者 meta line、nav item）。
  //      真 inline link（"點此<a>設定</a>頁"）parent 必有其他文字，不命中。
  function markStructuralLinks(articleEl) {
    const marked = [];
    const anchors = articleEl.querySelectorAll('a');
    for (const a of anchors) {
      const aText = (a.textContent || '').trim();
      if (!aText) continue;
      let hit = false;
      // 條件 A
      if (a.closest('h1, h2, h3, h4, h5, h6')) hit = true;
      // 條件 B
      if (!hit) {
        const parent = a.parentElement;
        if (parent) {
          const parentText = (parent.textContent || '').trim();
          if (parentText === aText) hit = true;
        }
      }
      if (!hit) continue;
      a.setAttribute(STRUCTURAL_LINK_ATTR, '1');
      marked.push(a);
    }
    return marked;
  }

  const styler = {
    /**
     * 套用閱讀模式排版。
     * @param {Element} articleEl 主文容器
     * @param {object} settings { theme, fontSize, contentWidth, fontFamily, lineHeight }
     * @returns {object|null} snapshot，restore 時必須原樣回傳
     */
    apply(articleEl, settings) {
      if (!articleEl || articleEl.nodeType !== 1) return null;

      const s = settings || {};
      const opts = {
        fontSize: Number(s.fontSize) || 18,
        contentWidth: Number(s.contentWidth) || 720,
        fontFamily: s.fontFamily || 'system-ui',
        lineHeight: Number(s.lineHeight) || 1.7
      };
      const theme = themeOf(s.theme);

      // 注入 / 更新 style
      let styleEl = document.getElementById(STYLE_ID);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = buildCss(theme, opts);

      articleEl.setAttribute(ARTICLE_ATTR, '1');
      const ancestors = markAncestors(articleEl);
      const structuralLinks = markStructuralLinks(articleEl);

      const htmlHadClass = document.documentElement.classList.contains(HTML_CLASS);
      document.documentElement.classList.add(HTML_CLASS);

      // 消除頂端留白：主文容器內第一個可見內容元素（h1/h2/h3/h4/p，按 DOM
      // 順序）通常是文章標題或第一段；站點 CSS 常給它 margin-top 造成容器
      // padding-top 之外的額外留白（例如 Medium 給 h1.pw-post-title 設
      // margin-top 48.96px）。此處強制設 0 !important，restore 時還原。
      // 用 CSS `:first-of-type` 做不到：H1 可能被包在多層 wrapper 深處，
      // 與 article 不是直接父子關係。
      let firstInk = articleEl.querySelector('h1, h2, h3, h4, p');
      let firstInkPriorMt = '';
      let firstInkPriorMtPriority = '';
      if (firstInk) {
        firstInkPriorMt = firstInk.style.getPropertyValue('margin-top');
        firstInkPriorMtPriority = firstInk.style.getPropertyPriority('margin-top');
        firstInk.style.setProperty('margin-top', '0', 'important');
      }

      return { articleEl, ancestors, structuralLinks, htmlHadClass, firstInk, firstInkPriorMt, firstInkPriorMtPriority };
    },

    /**
     * 還原 apply() 所做的所有變更。
     * @param {Element} _articleEl 相容舊 API，實際從 snapshot 讀
     * @param {object} snapshot apply() 的回傳值
     */
    restore(_articleEl, snapshot) {
      if (!snapshot) return;
      const styleEl = document.getElementById(STYLE_ID);
      if (styleEl) styleEl.remove();

      if (snapshot.articleEl && snapshot.articleEl.removeAttribute) {
        snapshot.articleEl.removeAttribute(ARTICLE_ATTR);
      }
      if (Array.isArray(snapshot.ancestors)) {
        for (const a of snapshot.ancestors) {
          if (a && a.removeAttribute) a.removeAttribute(ANCESTOR_ATTR);
        }
      }
      if (Array.isArray(snapshot.structuralLinks)) {
        for (const a of snapshot.structuralLinks) {
          if (a && a.removeAttribute) a.removeAttribute(STRUCTURAL_LINK_ATTR);
        }
      }
      if (!snapshot.htmlHadClass) {
        document.documentElement.classList.remove(HTML_CLASS);
      }

      // 還原 firstInk 的 inline margin-top
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
    }
  };

  NS.styler = styler;
})();
