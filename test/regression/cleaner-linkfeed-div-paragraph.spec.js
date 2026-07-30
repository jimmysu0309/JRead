// JRead — regression spec: isLinkFeedContainer 認得「div 當段落」正文（v1.7.23）
// -----------------------------------------------------------------------------
// Forcing function for cleaner `isLinkFeedContainer` 的 hasLongMainParagraph
// gate（p >= 100 或 div direct text >= 100）。
//
// Trigger: 2026-07-30 Jimmy 回報 cn.nytimes /world/…/trump-oil-gas-cuba-havana/
// zh-hant/「進入閱讀模式後抓不到內容」——reader card 只剩標題 + byline + hero，
// 正文全滅。hide() 塞 stack instrument 釘出兇手：正文 section 內嵌的「相關報導」
// h4 命中 NOISE_HEADING_TEXT_RE → resolveHeadingNoiseTarget closest 命中整個
// section.article-body → tooWide 主文保護要靠 `!isLinkFeedContainer(target)`
// 成立，但該 gate 的「無主文長段落」檢查**只掃 <p>**——cn.nytimes 正文 38 段全
// 是 div.article-paragraph（<p> 只有 footer 短句）→ gate 全 miss，加上正文內嵌
// 圖 7 張 + 連結 9 個命中 v1.6.5 媒體訊號分支（img >= 3 且 a >= 5），整個正文
// section 被誤判成縮圖卡片 feed（實測 link 文字占比僅 0.031）→ 直接 hide。
//
// 修法（結構通則）：gate 改用既有 hasLongMainParagraph（p >= 100 **或** div
// direct text >= 100）——與 wrapperContainsMainContentP（v0.7.190 upmedia）同款
// 「div 當段落」判準。真 feed（teaser 短文字、無任何長段落）判定不受影響
//（既有 nyt-related-content-thumbnail-feed.spec.js / nyt-article-tail-junk.spec.js
// 是負控制 forcing）。
//
// 同族根因第三現場：v1.7.21（Readwise 匯出）、v1.7.22（detector signal）、本次
// （cleaner feed gate）——「站點拿 div 當段落」打穿所有以 <p> 為前提的判準。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

describe('cleaner — isLinkFeedContainer 認得 div 段落正文（v1.7.23）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'linkfeed-div-paragraph-body.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.chrome = window.chrome || { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
    window.eval(SRC.namespace);
    window.eval(SRC.detector);
    window.eval(SRC.cleaner);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('前提：正文 section 無長 <p>、有 div 段落 + img >= 3 + a >= 5（媒體訊號分支的誤判組合）', () => {
    const section = document.querySelector('[data-test="body-section"]');
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    for (const p of section.querySelectorAll('p')) {
      assert.ok(norm(p.textContent).length < 100,
        'section 內不可有 >= 100 字 <p>（否則舊 p-only gate 就會保護、驗不到修法）');
    }
    const longDiv = [...section.querySelectorAll('div')].some(d => {
      const direct = Array.from(d.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('');
      return norm(direct).length >= 100;
    });
    assert.ok(longDiv, 'section 須含 >= 100 字 direct text 的 div 段落');
    assert.ok(section.querySelectorAll('img, picture').length >= 3, 'img >= 3（媒體訊號前提）');
    assert.ok(section.querySelectorAll('a').length >= 5, 'a >= 5（媒體訊號前提）');
  });

  it('正文 section（含「相關報導」heading）不可被整段 hide', () => {
    const section = document.querySelector('[data-test="body-section"]');
    const para = document.querySelector('[data-test="para-1"]');
    assert.notStrictEqual(section.dataset.jreadHidden, '1',
      'div 段落正文 section 不可被當 link feed 砍；forcing：把 isLinkFeedContainer 的 hasLongMainParagraph gate 還原成 p-only loop → 此 assertion fail');
    assert.notStrictEqual(para.dataset.jreadHidden, '1', '正文段落必須保留');
  });

  it('「相關報導」側欄仍被清（tooWide 後 walk-up 停在正文之外的 wrapper）', () => {
    const related = document.querySelector('[data-test="related-block"]');
    let covered = false;
    for (let p = related; p; p = p.parentElement) {
      if (p.dataset && p.dataset.jreadHidden === '1') { covered = true; break; }
    }
    assert.ok(covered,
      '相關報導區（自身或其 wrapper）仍須被 heading rule 清掉——修法只救正文 section，不放生側欄');
  });
});
