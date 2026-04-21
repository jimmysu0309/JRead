// JRead — 閱讀模式排版（瘦身版 / c 路線）
// 設計哲學：**盡量不動原站的內文排版**（font-family / font-size / heading margin /
// p margin / list style / link color / blockquote / code 等一律不覆寫），只提供：
//   1. 讀者卡片容器（article card）——版心、背景、圓角、陰影、置中
//   2. 頁面 / 祖先鏈 reset——讓主文能脫離原 2-col layout 限制
//   3. 必要的「破壞站點 hack」——aspect-ratio placeholder、圖片超出版心
//   4. 使用者 override——只在使用者**改過**預設設定（theme/fontSize/fontFamily/
//      lineHeight）時注入對應 CSS，預設值不動
// restore() 移除 style 元素與 attribute 即可完整還原，不動任何原 inline style。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const STYLE_ID = '__jread-style';
  const HTML_CLASS = '__jread-active';
  const ARTICLE_ATTR = 'data-jread-active';
  const ANCESTOR_ATTR = 'data-jread-ancestor';

  // 預設值：等於「未設定」——對應的 CSS 不會注入（保留原站樣式）
  const DEFAULTS = {
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  };

  // 主題配色：僅 dark / sepia 會注入文字 + 卡片底色覆寫；light 不碰原站色
  const THEMES = {
    light: { pageBg: '#ececec', articleBg: '#ffffff', text: null },
    dark:  { pageBg: '#0b0b0b', articleBg: '#1a1a1a', text: '#d4d4d4' },
    sepia: { pageBg: '#cdb891', articleBg: '#f4ecd8', text: '#5b4636' }
  };

  function themeOf(name) {
    return THEMES[name] || THEMES.light;
  }

  function buildCss(theme, opts, overrides) {
    const { contentWidth } = opts;

    // ---- 骨架：頁面 reset + 祖先鏈 reset + 卡片容器（永遠注入）----
    const base = `
html.${HTML_CLASS} {
  background: ${theme.pageBg} !important;
}
html.${HTML_CLASS} body {
  background: ${theme.pageBg} !important;
  margin: 0 !important;
  padding: 0 !important;
  max-width: none !important;
  width: auto !important;
  min-width: 0 !important;
  overflow-x: hidden !important;
}
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
/* 讀者卡片：版心、置中、背景、圓角、陰影。刻意不設 font-family / font-size
   / line-height / color——保留原站字體與排版。 */
[${ARTICLE_ATTR}="1"] {
  box-sizing: border-box !important;
  max-width: ${contentWidth}px !important;
  width: auto !important;
  min-height: 0 !important;
  height: auto !important;
  margin: 40px auto !important;
  padding: 48px 56px !important;
  background: ${theme.articleBg} !important;
  background-image: none !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
  float: none !important;
  position: static !important;
  transform: none !important;
}
/* 消除頂端留白：第一個 direct child 清 margin-top / padding-top。
   JS 端另外會對「第一個 h1-h4/p」設 margin-top: 0 inline（覆蓋深層 CMS 寫死的值） */
[${ARTICLE_ATTR}="1"] > *:first-child {
  margin-top: 0 !important;
  padding-top: 0 !important;
}
/* 圖片 / 影片：不超出卡片寬度；不改 margin（交給原站或 figure） */
[${ARTICLE_ATTR}="1"] img,
[${ARTICLE_ATTR}="1"] video,
[${ARTICLE_ATTR}="1"] picture {
  max-width: 100% !important;
  height: auto !important;
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
}
/* 破 aspect-ratio placeholder hack：Substack / Medium 用
   'position: relative; padding-bottom: 56.25%' 為圖片預留空間（img absolute
   覆蓋）。閱讀模式下 img 變 static，padding 留著 = 視覺留白。
   只 reset 含 img/picture/video 的容器的 padding-bottom / aspect-ratio，
   其他樣式不動。 */
[${ARTICLE_ATTR}="1"] *:has(> img),
[${ARTICLE_ATTR}="1"] *:has(> picture),
[${ARTICLE_ATTR}="1"] *:has(> video) {
  padding-bottom: 0 !important;
  aspect-ratio: auto !important;
}
`;

    // ---- 使用者 override：僅在非預設值才注入 ----
    let userOverrides = '';
    if (overrides.fontSize) {
      userOverrides += `
[${ARTICLE_ATTR}="1"] {
  font-size: ${opts.fontSize}px !important;
}`;
    }
    if (overrides.fontFamily) {
      userOverrides += `
[${ARTICLE_ATTR}="1"] {
  font-family: ${opts.fontFamily}, -apple-system, "Noto Sans TC", "PingFang TC", system-ui, sans-serif !important;
}`;
    }
    if (overrides.lineHeight) {
      userOverrides += `
[${ARTICLE_ATTR}="1"] {
  line-height: ${opts.lineHeight} !important;
}`;
    }
    if (overrides.theme && theme.text) {
      // dark / sepia：覆蓋文字色（light 的 text 是 null，不注入）
      userOverrides += `
html.${HTML_CLASS} body {
  color: ${theme.text} !important;
}
[${ARTICLE_ATTR}="1"],
[${ARTICLE_ATTR}="1"] * {
  color: ${theme.text} !important;
}`;
    }

    return base + userOverrides;
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
        fontSize: Number(s.fontSize) || DEFAULTS.fontSize,
        contentWidth: Number(s.contentWidth) || DEFAULTS.contentWidth,
        fontFamily: s.fontFamily || DEFAULTS.fontFamily,
        lineHeight: Number(s.lineHeight) || DEFAULTS.lineHeight
      };
      const theme = themeOf(s.theme);

      // 判斷哪些是「使用者改過」→ 需要 override；預設值不動原站
      const overrides = {
        theme: (s.theme || DEFAULTS.theme) !== DEFAULTS.theme,
        fontSize: opts.fontSize !== DEFAULTS.fontSize,
        fontFamily: opts.fontFamily !== DEFAULTS.fontFamily,
        lineHeight: opts.lineHeight !== DEFAULTS.lineHeight
      };

      let styleEl = document.getElementById(STYLE_ID);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = buildCss(theme, opts, overrides);

      articleEl.setAttribute(ARTICLE_ATTR, '1');
      const ancestors = markAncestors(articleEl);

      const htmlHadClass = document.documentElement.classList.contains(HTML_CLASS);
      document.documentElement.classList.add(HTML_CLASS);

      // 消除頂端留白：第一個 h1-h4/p（深層後代也算）margin-top: 0 inline。
      // 必須用 JS：站點 CSS 常給深層 heading 寫死 margin-top，純 CSS 的
      // `:first-child` 只能摸到 article 的 direct child，摸不到「包在 wrapper
      // 裡的 H1」。
      let firstInk = articleEl.querySelector('h1, h2, h3, h4, p');
      let firstInkPriorMt = '';
      let firstInkPriorMtPriority = '';
      if (firstInk) {
        firstInkPriorMt = firstInk.style.getPropertyValue('margin-top');
        firstInkPriorMtPriority = firstInk.style.getPropertyPriority('margin-top');
        firstInk.style.setProperty('margin-top', '0', 'important');
      }

      return { articleEl, ancestors, htmlHadClass, firstInk, firstInkPriorMt, firstInkPriorMtPriority };
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
      if (!snapshot.htmlHadClass) {
        document.documentElement.classList.remove(HTML_CLASS);
      }

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
