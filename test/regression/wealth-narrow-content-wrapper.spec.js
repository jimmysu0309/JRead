// JRead — regression spec: wealth.com.tw narrow guard（sibling 含主文長段落保留）
// -----------------------------------------------------------------------------
// Trigger: Jimmy 2026-05-21 回報 https://www.wealth.com.tw/articles/f2b6e893-...
// 進閱讀模式後文章開頭一大段內容（含灰底引文 + 前 2-3 段主文 + 第一個 H3）整段不見。
//
// Root cause（probe 確認）：cleaner narrowPromotedSiblings 從 promotedFrom 沿
// 祖先鏈走、砍 sibling chrome 時，誤殺含開頭主文的 wrapper（emotion hash class
// DIV.JozKC）。既有白名單（H1 / promotedTitleHead / standalone media /
// time byline）全沒命中。
//
// 修法（v0.7.154 narrow guard）：sibling 含「unwrapped >= 100 chars 單一 p
// 或累計 >= 300 chars」→ 保留。`unwrapped` = 不在 list-item / a / aside 內，
// 避免誤豁免 sidebar 「相關新聞」list 內的描述 p（與 udn-byline-subinfo fixture
// 共生：相關新聞 li > p 雖長但被排除、仍被 narrow hide）。
//
// 通則特徵：主文 p 不會被 `<li>` / `<a>` / `<aside>` 包；sidebar 列表項的描述
// p 必然在 `<li>`（HTML 語意）或 `<a>`（卡片連結）內。
//
// 本 spec 4 條 forcing function：
//   (a) 前段主文 wrapper content-A（含 blockquote 灰底引文 + 主文 p + H3）保留
//   (b) 灰底引文段、主文 p、H3 內元素全部 visible（不在 hidden 樹下）
//   (c) sidebar 「相關新聞」list 雖含長 p（li > p 結構）仍被 narrow hide
//   (d) sanity forcing：前段 wrapper 必須含 >= 100 chars 單一 unwrapped p
//       （fixture 結構自檢，防將來改 fixture 時門檻失效）

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const DETECTOR_SRC = fs.readFileSync(path.join(ROOT, 'content', 'detector.js'), 'utf8');
const CLEANER_SRC = fs.readFileSync(path.join(ROOT, 'content', 'cleaner.js'), 'utf8');

describe('cleaner — wealth-narrow-content-wrapper-guard（sibling 含主文長段落保留）', () => {
  let window, document, result;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'wealth-narrow-content-wrapper-guard.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    // v0.8.37：改載真 namespace.js（stripSiteSuffix / foldTitlePunct 等共用 helper 需要）
    window.chrome = window.chrome || { runtime: { getManifest: () => ({ version: "0.0.0-test" }), id: "t", sendMessage: () => {}, getURL: (p) => "x/" + p } };
    window.eval(require("../helpers").SRC.namespace);
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  it('(a) 前段主文 wrapper content-A 保留（含主文長段落 guard）', () => {
    const contentA = document.getElementById('content-A');
    assert.ok(contentA, 'fixture 須含 content-A');
    assert.notStrictEqual(contentA.dataset.jreadHidden, '1',
      'content-A 含開頭灰底引文 + 前 2-3 段主文 + H3，必須由 v0.7.154 narrow guard 保留；' +
      '拿掉「含 unwrapped >= 100 chars 單一 p」guard → 此 assertion fail');
  });

  it('(b) 灰底引文段 + 主文 p + H3 全部 visible（祖先鏈無 hidden）', () => {
    const ids = ['quote-block', 'content-A-p1', 'content-A-p2', 'content-A-h3', 'content-A-p3'];
    for (const id of ids) {
      const el = document.getElementById(id);
      assert.ok(el, `fixture 須含 #${id}`);
      // 自身不被 hide
      assert.notStrictEqual(el.dataset.jreadHidden, '1', `#${id} 自身不該 hide`);
      // 祖先鏈無 hidden
      let p = el.parentElement;
      while (p) {
        assert.notStrictEqual(p.dataset.jreadHidden, '1',
          `#${id} 祖先 ${p.tagName}#${p.id || ''}.${(p.className || '').toString().split(' ')[0]} 不該 hide（會連帶讓 #${id} 不可見）`);
        p = p.parentElement;
      }
    }
  });

  it('(c) sidebar 「相關新聞」list 雖含長 p 仍被 hide（li > p 結構不算主文）', () => {
    const sidebar = document.getElementById('related-sidebar');
    assert.ok(sidebar, 'fixture 須含 related-sidebar');
    // forcing：sidebar textLen 必須 > 100 才 forcing「li > p 排除」guard 有意義
    const stxt = (sidebar.textContent || '').replace(/\s+/g, ' ').trim();
    assert.ok(stxt.length > 100,
      `fixture forcing: sidebar textLen (${stxt.length}) 須 > 100 才 forcing li > p 排除邏輯`);
    // 確認所有 p 都包在 li / a 內
    for (const p of sidebar.querySelectorAll('p')) {
      assert.ok(p.closest('li, a, aside'),
        `fixture forcing: sidebar 內 p 須全部在 li / a / aside 內（才 forcing 新 guard 的「unwrapped」判定）`);
    }
    assert.strictEqual(sidebar.dataset.jreadHidden, '1',
      'sidebar 「相關新聞」list 雖含長 p 但全在 li > p，仍須由 narrow hide；' +
      '若把 li / a / aside 排除拿掉 → 此 assertion fail（sidebar 會被誤豁免）');
  });

  it('(d) sanity forcing: content-A 必須含 >= 100 chars 單一 unwrapped p', () => {
    const contentA = document.getElementById('content-A');
    let maxLen = 0;
    for (const para of contentA.querySelectorAll('p')) {
      if (para.closest('li, a, aside')) continue;
      maxLen = Math.max(maxLen, (para.textContent || '').replace(/\s+/g, ' ').trim().length);
    }
    assert.ok(maxLen >= 100,
      `fixture forcing: content-A 必須含 >= 100 chars 單一 unwrapped p 才 forcing 新 guard 觸發；實際最長 ${maxLen}`);
  });
});
