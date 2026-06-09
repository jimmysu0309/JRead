// JRead — detector 隱藏容器 textLen 不得灌水計分（v0.8.19 C2）
//
// 對應 code review C2：getText(el) = (el.innerText || el.textContent).trim()。
// 隱藏元素（祖先鏈 display:none）的 innerText 在真實瀏覽器回 ''，於是 fallback
// 到 textContent → 拿到隱藏子樹的全部文字。article-tag / schema-org / main-tag /
// heuristic 候選的 textLen 門檻都走 getText().length，導致隱藏 modal（upmedia.mg
// 實案：display:none 的推薦清單 2700+ 字）通過 MIN_TEXT_LEN、甚至贏過真主文。
//
// 修法：抽共用 isAncestorChainHidden predicate + scoredTextLen（隱藏計 0），
// 套到所有 textLen 計分。
//
// 本 spec：唯一的 <article> 被 display:none 隱藏且塞大量文字；detector 必須
// **不**經 article-tag 選中它，而是選到 <main> 內可見的真主文。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'hidden-modal-textlen-pollution.html');

describe('detector — 隱藏容器 textLen 不灌水（C2）', () => {
  let window, result;
  before(() => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE, scripts: ['detector'], pretendToBeVisual: true });
    window = env.window;
    result = env.NS.detector.detect();
  });

  it('偵測成功（不因隱藏 article 干擾而 no-op）', () => {
    assert.ok(result, 'detector 應命中可見主文');
  });

  it('不可選中隱藏的 <article id="hidden-modal">（display:none）', () => {
    assert.ok(result.el, 'result.el 必須存在');
    const chosen = result.el;
    // 選中的元素不可是隱藏 modal，也不可被它包含
    const hidden = window.document.getElementById('hidden-modal');
    assert.notStrictEqual(chosen, hidden, '不可選中隱藏 modal 本身');
    assert.ok(!hidden.contains(chosen), '選中的主文不可在隱藏 modal 內');
    assert.ok(!chosen.contains(hidden) || chosen.tagName === 'BODY',
      '選中的容器不應把隱藏 modal 包進主文 scope');
  });

  it('必須選到可見主文（含「真標題」+ 真主文文字）', () => {
    const txt = (result.el.textContent || '');
    assert.ok(txt.includes('真標題') || txt.includes('真實主文'),
      `選中的容器應含可見主文內容，實際 className="${result.el.className}" tag=${result.el.tagName}`);
    assert.ok(!txt.includes('隱藏推薦清單'),
      '選中的主文不可含隱藏 modal 的文字（隱藏內容不該進主文 scope）');
  });
});
