// JRead — regression spec: LTN APP promo noise residual (v0.7.201)
//
// Forcing function for CTA_PROMO_P_RE + NOISE_LINK_TEXT_RE:
// news.ltn.com.tw inserts <p class="appE1121"> at end of article body
// containing APP download CTA links and promo text "天天中獎".
//
// The <a> text "按我看活動辦法" matches NOISE_LINK_TEXT_RE via
// (點|按)我.{0,8}(下載|訂閱|加入|看|了解|查看), and "天天中獎" in
// the parent <p> matches CTA_PROMO_P_RE → parent upgrade hides the P.
//
// 5 forcing functions:
//   (a) <a> with "按我看活動辦法": it or parent P hidden
//   (b) parent <p class="appE1121"> containing "天天中獎": hidden
//   (c) <a> with "點我下載APP": it or parent P hidden
//   (d) main article <p> with LTN_MAIN_MARK: NOT hidden (sanity)
//   (e) H1 title: NOT hidden (sanity)

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'ltn-app-promo.html');

describe('cleaner — LTN APP promo noise (v0.7.201)', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('[data-jread-active="1"]');
    assert.ok(articleEl, 'fixture must contain articleEl with data-jread-active="1"');
    window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) <a> with "按我看活動辦法" or its parent P is hidden', () => {
    const links = [...articleEl.querySelectorAll('a')];
    const link = links.find(a => a.textContent.includes('按我看活動辦法'));
    assert.ok(link, 'fixture must contain <a> with "按我看活動辦法"');
    const parentP = link.closest('p');
    const linkHidden = link.dataset.jreadHidden === '1';
    const parentHidden = parentP && parentP.dataset.jreadHidden === '1';
    assert.ok(linkHidden || parentHidden,
      '"按我看活動辦法" link or its parent P must be hidden');
  });

  it('(b) <p class="appE1121"> containing "天天中獎" is hidden', () => {
    const promoP = articleEl.querySelector('p.appE1121');
    assert.ok(promoP, 'fixture must contain <p class="appE1121">');
    assert.ok(promoP.textContent.includes('天天中獎'),
      'promo P must contain "天天中獎"');
    assert.strictEqual(promoP.dataset.jreadHidden, '1',
      '<p class="appE1121"> must be hidden');
  });

  it('(c) <a> with "點我下載APP" or its parent P is hidden', () => {
    const links = [...articleEl.querySelectorAll('a')];
    const link = links.find(a => a.textContent.includes('點我下載APP'));
    assert.ok(link, 'fixture must contain <a> with "點我下載APP"');
    const parentP = link.closest('p');
    const linkHidden = link.dataset.jreadHidden === '1';
    const parentHidden = parentP && parentP.dataset.jreadHidden === '1';
    assert.ok(linkHidden || parentHidden,
      '"點我下載APP" link or its parent P must be hidden');
  });

  it('(d) main article <p> with LTN_MAIN_MARK NOT hidden (sanity)', () => {
    const paragraphs = [...articleEl.querySelectorAll('p')].filter(
      p => p.textContent.includes('LTN_MAIN_MARK'));
    assert.ok(paragraphs.length >= 3,
      `must have at least 3 main body paragraphs (found ${paragraphs.length})`);
    for (const p of paragraphs) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `main text <p> containing "${p.textContent.slice(0, 30)}…" must NOT be hidden`);
    }
  });

  it('(e) H1 title NOT hidden (sanity)', () => {
    const h1 = articleEl.querySelector('h1');
    assert.ok(h1, 'fixture must contain <h1>');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1',
      'H1 title must NOT be hidden');
  });
});
