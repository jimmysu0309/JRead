// JRead — latepost byline：無年份中文日期錨 + promoted-title climb 停點 +
// 子樹 inline font 統一（v1.7.35）
// 對應 fixture：test/regression/fixtures/latepost-yearless-byline.html
//
// Jimmy 2026-08-03 截圖回報 latepost byline 編排亂（字級不一、名字換行、間距
// 散亂）。三個獨立缺口（真站 probe 實證）：
// 1) BYLINE_DATE_RE 中文變體強制 \d{4}年 開頭——「07 月 27 日 16:07」無年份
//    不命中 → byline pass 整套不啟動。
// 2) 標題非 h1 的站（latepost 標題是 div）由 detector title-promote 注入 h1
//    clone、原標題標 data-jread-promoted-title-source + display:none——byline
//    climb 的 heading guard 只認 h1/h2/h3，會爬進含原標題的 .article-header
//    把整個 header（含閱讀數）吞進 byline root。
// 3) CSS 層 `[BYLINE] * { font: inherit !important }` specificity (0,2,0) 被
//    BODY_TEXT_SEL span 規則（:not 鏈疊到 (0,7,10)）打穿——byline 內 span 拿
//    使用者字級、作者連結繼承 root 字級，同一行兩種字級。改 byline pass 內
//    inline !important 寫 font: inherit（必贏 stylesheet）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'latepost-yearless-byline.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — latepost 無年份日期 byline（v1.7.35）', () => {

  it('無年份中文日期「07 月 27 日 16:07」可當日期錨、byline root 被偵測', () => {
    const { env } = setup();
    const root = env.document.querySelector('[data-jread-byline="1"]');
    assert.ok(root, '無年份「M 月 D 日」日期必須能錨定 byline root（原 regex 強制 \\d{4}年 全 miss）');
    assert.ok(root.contains(q(env, 'date')), 'byline root 必須包含日期');
    assert.ok(root.contains(q(env, 'author-a')), 'byline root 必須包含作者連結');
  });

  it('climb 在含 promoted-title-source 的祖先前停住（root = 作者+日期列、不吞整個 header）', () => {
    const { env } = setup();
    const root = env.document.querySelector('[data-jread-byline="1"]');
    assert.strictEqual(root, q(env, 'ad-row'),
      'byline root 必須是 .article-header-a-d（作者+日期列）');
    assert.strictEqual(q(env, 'header').getAttribute('data-jread-byline'), null,
      '含原標題（data-jread-promoted-title-source）的 .article-header 不可被當 byline root——' +
      '標題非 h1 的站 heading guard 擋不住、需認 promoted-title-source 為標題等價訊號');
    assert.strictEqual(q(env, 'read-count').getAttribute('data-jread-byline-item'), null,
      '閱讀數列不可被打平成 byline item');
    assert.strictEqual(q(env, 'orig-title').getAttribute('data-jread-byline-item'), null,
      '隱藏的原標題不可被標 byline item');
  });

  it('作者前綴 / 作者連結 / 日期被標 item', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'prefix').getAttribute('data-jread-byline-item'), '1', '「文」前綴必須是 item');
    assert.strictEqual(q(env, 'author-a').getAttribute('data-jread-byline-item'), '1', '作者連結必須是 item');
    assert.strictEqual(q(env, 'date').getAttribute('data-jread-byline-item'), '1', '日期必須是 item');
  });

  it('byline 子樹元素被寫 inline font-family / font-size: inherit !important（字級統一必贏 BODY_TEXT_SEL）', () => {
    const { env } = setup();
    for (const t of ['prefix', 'author-a', 'date']) {
      const el = q(env, t);
      for (const prop of ['font-family', 'font-size']) {
        assert.strictEqual(el.style.getPropertyValue(prop), 'inherit',
          `${t} 必須有 inline ${prop}: inherit（CSS 層 (0,2,0) 打不贏 BODY_TEXT_SEL 的 (0,7,10)）`);
        assert.strictEqual(el.style.getPropertyPriority(prop), 'important',
          `${t} 的 ${prop}: inherit 必須帶 !important`);
      }
    }
  });

  it('restore 移除 byline 標記與 inline font 統一', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    assert.ok(!env.document.querySelector('[data-jread-byline]'), 'restore 應移除 byline root 標記');
    assert.strictEqual(q(env, 'author-a').style.getPropertyValue('font-size'), '',
      'restore 應清掉 inline font-size: inherit');
  });
});
