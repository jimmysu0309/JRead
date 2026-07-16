// JRead — regression spec: 連結目錄 reject gate → 404 頁 no-op（v1.7.8）
// -----------------------------------------------------------------------------
// Forcing function for detector `isLinkDirectory`（heuristic 候選 gate +
// detectByMainTag gate）。
//
// Trigger: 2026-07-16 harness 掃 udn 已下架文章（404「找不到網頁」頁）發現
// reader card 渲染的是整個站台產品選單（「udn line 好友 / 更多產品」殘留其實
// 是選單連結）。Playwright probe 實證：404 頁無任何文章內容，唯一過
// MIN_TEXT_LEN 的候選是 div.site-links__wrapper（8 個 section、h4 + 純連結、
// 無任何段落，linkDensity 0.727）；heuristic 的 linkDensity 懲罰是乘法折扣、
// 無競爭者時照樣勝出 → 違反「偵測失敗 → no-op、不誤傷原頁面」降級政策
// （CLAUDE.md 主文偵測節）。真實文章 articleEl 實測 linkDensity 0.24。
//
// 規則（結構通則，不綁站點 / class，雙條件同時成立才 reject）：
//   1. 候選內無任何 >= 80 chars 段落載體（p / li / blockquote / dd）
//   2. linkDensity >= 0.5
// 掛載點：heuristic 候選迴圈（continue）+ detectByMainTag（return null）。
// 只滿足其一不 reject——正控制見 (c)：link roundup（ld 高但有導言段）仍偵測。
//
// 驗收層次：本 spec 驗 jsdom 端 detect() 回傳；真實 Chrome 端由 Playwright
// probe 完成（2026-07-16 實測 udn 404 頁 no-op、真實文章照常偵測 ld 0.24）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

describe('detector — 連結目錄 reject gate（404 頁 no-op, v1.7.8）', () => {
  it('(a) 404 選單頁：detect() 必須回 null（no-op，不把站台選單當主文）', () => {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'link-directory-404.html'),
      scripts: ['detector']
    });
    const detected = env.NS.detector.detect();
    assert.strictEqual(detected, null,
      '404 頁唯一候選是純連結選單（無段落 + linkDensity >= 0.5），必須 no-op');
  });

  it('(b) fixture 前提：選單文字總量過 MIN_TEXT_LEN（確認是 gate 擋下、非字數門檻）', () => {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'link-directory-404.html'),
      scripts: ['detector']
    });
    const wrapper = env.document.querySelector('[data-test="menu-wrapper"]');
    const textLen = (wrapper.textContent || '').replace(/\s+/g, ' ').trim().length;
    assert.ok(textLen >= 200,
      `選單文字必須 >= MIN_TEXT_LEN(200) 才驗得到 gate 本身（目前 ${textLen}）`);
    assert.strictEqual(wrapper.querySelectorAll('p').length, 0,
      '選單不可含 <p>（無段落是 gate 條件 1 的前提）');
  });

  it('(c) 正控制：link roundup（高連結密度但有 >= 80 chars 導言段）仍必須偵測', () => {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'link-roundup-article.html'),
      scripts: ['detector']
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected && detected.el,
      'link roundup 有導言段落（gate 條件 1 不成立），不可被誤殺');
    const intro = env.document.querySelector('[data-test="intro"]');
    assert.ok(detected.el.contains(intro), '偵測結果必須涵蓋導言段落');
  });
});
