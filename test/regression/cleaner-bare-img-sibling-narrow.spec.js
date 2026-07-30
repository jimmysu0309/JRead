// JRead — regression spec: sibling 自身是裸 <img> 時 narrow 不誤殺（v1.7.22）
// -----------------------------------------------------------------------------
// Forcing function for cleaner `narrowPromotedSiblings` standalone-media guard
// 的「sib 自身納入 media 檢查」修法。
//
// Trigger: 2026-07-30 upmedia.mg /tw/commentary/columnists/262918。detector
// 修好裸 div 段落 signal 後（見 detector-bare-div-paragraphs.spec.js），cage
// 實機驗收發現 hero 圖（陶哲軒照片）被 hide——hide() 塞 stack 進 data attr
// 釘出兇手是 narrowPromotedSiblings：upmedia 把 hero <img> 直接放主文容器
// direct child（不包 figure / div / a），與 promotedFrom（裸段落 wrapper）
// 互為 sibling；standalone-media guard 用 sib.querySelectorAll('img,…') 只查
// **後代**、查不到 sib 自己 → guard 全 miss、hero 被當 chrome 砍。
//
// 同族前例：v0.7.14 h1 guard 也是「querySelector 不含自身」踩過的同一坑
// （sib 自身是 h1 時保留邏輯漏掉）。
//
// 修法（結構通則）：sib 自身 matches('img, picture, video') 也納入同一條
// 「img 不在 <a> 內 = standalone 主文媒體」檢查，語意與既有 guard 一致。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

describe('cleaner — 裸 <img> sibling narrow guard（v1.7.22）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'bare-img-sibling-narrow-guard.html'),
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

  it('前提：promotedFrom 與 hero img 互為 sibling（narrow 會掃到 img 本身）', () => {
    const img = document.querySelector('[data-test="hero"]');
    assert.ok(result.promotedFrom, 'promote 應發生（h1 在容器外、需升級）');
    assert.ok(!result.promotedFrom.contains(img),
      'hero img 須在 promotedFrom 之外（否則 narrow 根本不會碰它、驗不到 guard）');
    assert.strictEqual(img.parentElement, result.promotedFrom.parentElement,
      'hero img 須與 promotedFrom 同 parent（sibling 關係是本 spec 的 forcing 前提）');
  });

  it('hero img（sibling 自身是裸 <img>）必須保留', () => {
    const img = document.querySelector('[data-test="hero"]');
    assert.notStrictEqual(img.dataset.jreadHidden, '1',
      'sibling 自身是裸 <img>（不在 <a> 內）＝主文媒體，必須保留；forcing：把 guard 的「sib 自身 matches media」檢查拿掉 → 此 assertion fail');
  });

  it('非 media 的 sibling chrome（連結面板）仍被 narrow hide', () => {
    const panel = document.querySelector('[data-test="extra-panel"]');
    assert.strictEqual(panel.dataset.jreadHidden, '1',
      '純連結 sibling 面板仍由 narrow 清（guard 只放行 media 自身，不整層放行）');
  });

  it('主文裸 div 段落保留', () => {
    const para = document.querySelector('[data-test="para-1"]');
    assert.notStrictEqual(para.dataset.jreadHidden, '1', '主文段落不可被砍');
  });
});
