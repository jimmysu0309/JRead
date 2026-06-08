// JRead — 內文版心自我檢查（enforce content width，v0.7.246）
//
// Bug：roomie.tw/posts/73403（Jimmy iPhone 回報）進 reader mode 後，圖片 /
// 標題撐滿 reader card 版心，內文段落卻左右各窄一截。根因 = 主文容器與內文
// 之間夾了一層通用 block wrapper 帶水平 padding（`div.content { padding:
// 0 20px }`）。card 已提供唯一應有的閱讀內距，此 wrapper 額外水平內距把
// 內文壓窄到 < 設定版心寬。styler 既有 width:auto / max-width:100% 只擋
// 「超寬」、擋不掉「被內距夾窄」。
//
// 修法（結構性通則，非站點特判）：apply() runtime 沿每個「頂層內文段落」
// （p / h1-6，不在 blockquote / li / figure / table 等語意縮排容器內）的
// 祖先鏈往上走到 articleEl，把鏈上通用 wrapper（div/section/article/aside/
// header/footer/nav）+ 段落自身的水平 padding/margin 清零（inline
// !important）。語意縮排容器與其後代不動，保留引言 / 清單 / 表格縮排。
// restore() 對稱還原原 inline 值。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'content-width-wrapper-padding.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  const snapshot = env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  return { env, detected, snapshot };
}

describe('styler — 內文版心自我檢查（v0.7.246）', () => {
  it('內文 wrapper（div.content）的水平 padding 被清零', () => {
    const { env } = setup();
    const content = env.document.querySelector('.content');
    assert.ok(content, 'fixture 必須有 .content wrapper');
    assert.strictEqual(content.style.getPropertyValue('padding-left'), '0px',
      'wrapper padding-left 必須被清零');
    assert.strictEqual(content.style.getPropertyValue('padding-right'), '0px',
      'wrapper padding-right 必須被清零');
    assert.strictEqual(content.style.getPropertyPriority('padding-left'), 'important',
      '清零必須用 !important（贏過原站）');
  });

  it('標題列 wrapper（無段落、可見標題非 heading）的水平 padding 也被清零', () => {
    // v0.7.247：roomie div.mobile-info 內含 sr-only 空 h1 + span 標題，沿
    // 段落鏈走不到——必須靠全面遍歷清零。
    const { env } = setup();
    const tw = env.document.querySelector('.title-wrap');
    assert.ok(tw, 'fixture 必須有 .title-wrap');
    assert.strictEqual(tw.style.getPropertyValue('padding-left'), '0px',
      '標題列 wrapper padding-left 必須被清零（不依賴段落鏈）');
    assert.strictEqual(tw.style.getPropertyValue('padding-right'), '0px',
      '標題列 wrapper padding-right 必須被清零');
  });

  it('blockquote 的縮排 padding 必須保留（語意縮排不清）', () => {
    const { env } = setup();
    const bq = env.document.querySelector('blockquote');
    assert.ok(bq, 'fixture 必須有 blockquote');
    assert.strictEqual(bq.style.getPropertyValue('padding-left'), '30px',
      'blockquote padding-left 必須原封不動（引言縮排刻意）');
    assert.strictEqual(bq.style.getPropertyValue('padding-right'), '10px',
      'blockquote padding-right 必須原封不動');
  });

  it('ul 的 list-indent padding 必須保留（清單縮排不清）', () => {
    const { env } = setup();
    const ul = env.document.querySelector('ul');
    assert.ok(ul, 'fixture 必須有 ul');
    assert.strictEqual(ul.style.getPropertyValue('padding-left'), '40px',
      'ul padding-left 必須原封不動（bullet 對齊需要）');
  });

  it('snapshot 帶 contentWidthSnap，restore 還原原 padding', () => {
    const { env, detected, snapshot } = setup();
    assert.ok(Array.isArray(snapshot.contentWidthSnap), 'snapshot 必須含 contentWidthSnap 陣列');
    assert.ok(snapshot.contentWidthSnap.length >= 1, '至少捕捉到 .content wrapper 一筆');
    env.NS.styler.restore(detected.el, snapshot);
    const content = env.document.querySelector('.content');
    assert.strictEqual(content.style.getPropertyValue('padding-left'), '20px',
      'restore 後 padding-left 還原為原始 20px');
    assert.strictEqual(content.style.getPropertyValue('padding-right'), '20px',
      'restore 後 padding-right 還原為原始 20px');
  });
});
