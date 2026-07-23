// JRead — regression spec: overflow clip 裁切在框外的內容 hide（v1.7.14）
// -----------------------------------------------------------------------------
// Forcing function for cleaner rule `hideInsideArticleClipCroppedContent`。
//
// Trigger: Jimmy 2026-07-23 回報 NYT Magazine data-center-heist reader mode
// 「Illustration by Francesco Francavilla」顯示兩次（一次帶「Credit...」前綴）。
// cage live probe 實證根因：header 媒體 wrapper overflow:hidden、box 高度由
// 設計對位剛好裁在 hero 圖下緣，figure 的 figcaption（含 sr-only「Credit...」
// label）整個落在 clip box 之外＝原頁刻意不顯示；可見 credit 另外 render 成
// article 內獨立 <p>，兩份在原版面幾何上重疊。reader 卡片縮窄後圖縮小、
// figcaption 順 reflow 滑進仍在的 clip 窗口 → 重複顯示。
//
// 規則（結構通則，不綁站點 / class）：clean 初期（styler reflow 前）掃
// articleEl 內 overflow-y clip 容器，子樹中 rect 完全落在 box 下緣之外的
// 元素 hide。只認垂直下緣裁切；媒體 / h1 / 長段落 guard 見 cleaner 註解。
//
// 驗證層次：本 spec 驗「規則命中對象 + guard 負控制 + 可逆性」（jsdom 層，
// rect 用 stubRect 注入；jsdom 無 stub 時 rect 全 0 → 規則自動 no-op）。
// 不驗真實 Chrome 視覺結果——該層由 cage live probe 完成（2026-07-23 實測
// hide figcaption 後 reader 內 credit 只剩 article 內獨立 <p> 一份）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-clip-cropped-caption.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1024, height: 1000 },
    pretendToBeVisual: true
  });
  const doc = env.document;
  const articleEl = doc.querySelector('article');
  assert.ok(articleEl, 'fixture 必須含 <article>');
  const q = (sel) => doc.querySelector(sel);
  // 主場景：header clip box 0→1000，figcaption 落在 1010（完全出框）
  stubRect(q('[data-test="lede-header"]'), { left: 0, top: 0, width: 1024, height: 1000 });
  // hero 圖 stub 成內容級尺寸——rect 0 的 img 會被 pre-title 裝飾圖類規則
  // 誤判為 badge / icon（與本規則無關的既有行為），反映真實 NYT hero 幾何
  stubRect(q('[data-test="img-box"]'), { left: 0, top: 0, width: 1024, height: 1000 });
  stubRect(q('[data-test="hero-img"]'), { left: 0, top: 0, width: 1024, height: 1000 });
  stubRect(q('[data-test="cropped-caption"]'), { left: 0, top: 1010, width: 500, height: 20 });
  // 負控制 A：figcaption 在 box 內
  stubRect(q('[data-test="inbox-wrap"]'), { left: 0, top: 1200, width: 500, height: 100 });
  stubRect(q('[data-test="inbox-caption"]'), { left: 0, top: 1220, width: 500, height: 20 });
  // 負控制 B：出框但子樹含 img
  stubRect(q('[data-test="media-clip-wrap"]'), { left: 0, top: 1400, width: 500, height: 100 });
  stubRect(q('[data-test="in-view-slide"]'), { left: 0, top: 1410, width: 500, height: 20 });
  stubRect(q('[data-test="below-media-slide"]'), { left: 0, top: 1510, width: 500, height: 80 });
  // 負控制 C：出框但含 >500 chars 段落（read-more 截斷閘門）
  stubRect(q('[data-test="readmore-gate"]'), { left: 0, top: 1600, width: 500, height: 100 });
  stubRect(q('[data-test="gate-intro"]'), { left: 0, top: 1610, width: 500, height: 20 });
  stubRect(q('[data-test="gate-tail"]'), { left: 0, top: 1710, width: 500, height: 200 });
  stubRect(q('[data-test="gate-long-p"]'), { left: 0, top: 1710, width: 500, height: 200 });
  // 負控制 D：水平出框（carousel）
  stubRect(q('[data-test="carousel-wrap"]'), { left: 0, top: 1800, width: 500, height: 100 });
  stubRect(q('[data-test="carousel-slide-visible"]'), { left: 0, top: 1810, width: 200, height: 80 });
  stubRect(q('[data-test="carousel-slide-offright"]'), { left: 600, top: 1810, width: 200, height: 80 });
  return { env, articleEl };
}

describe('cleaner — overflow clip 裁切在框外的內容 hide（v1.7.14）', () => {
  let env, articleEl, hidden;
  before(() => {
    const s = setup();
    env = s.env;
    articleEl = s.articleEl;
    hidden = env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) 完全落在 clip box 下緣外的 figcaption 被 hide（含 sr-only Credit label 一併消失）', () => {
    const cap = articleEl.querySelector('[data-test="cropped-caption"]');
    assert.strictEqual(cap.dataset.jreadHidden, '1',
      '出框 figcaption 必須被 hide（原頁不可見、reader 不得復活）');
    assert.strictEqual(cap.style.getPropertyValue('display'), 'none',
      'hide 必須寫 inline display:none');
    assert.strictEqual(cap.style.getPropertyPriority('display'), 'important',
      'hide 必須帶 !important');
  });

  it('(b) 可見 credit <p>（article 內獨立 render 的那份）保留', () => {
    const p = articleEl.querySelector('[data-test="visible-credit"]');
    assert.ok(!p.closest('[data-jread-hidden="1"]'),
      '可見 credit p 是原頁使用者看到的那份，不可誤殺');
  });

  it('(c) 標題 / 摘要 / hero 圖 / 主文段落全部保留', () => {
    for (const key of ['title', 'dek', 'hero-img', 'body-p-1', 'body-p-2', 'byline']) {
      const el = articleEl.querySelector(`[data-test="${key}"]`);
      assert.ok(el && !el.closest('[data-jread-hidden="1"]'), `${key} 不可被 hide`);
    }
  });

  it('(d) 負控制 A：box 內的 figcaption 不可 hide', () => {
    const cap = articleEl.querySelector('[data-test="inbox-caption"]');
    assert.notStrictEqual(cap.dataset.jreadHidden, '1',
      'box 內（未被裁切）的 figcaption 不可被本規則誤殺');
  });

  it('(e) 負控制 B：出框但子樹含 img 不可 hide（lazy 媒體 rect 不可信）', () => {
    const slide = articleEl.querySelector('[data-test="below-media-slide"]');
    assert.notStrictEqual(slide.dataset.jreadHidden, '1',
      '含 img 子樹誤殺成本＝主圖消失，必須 guard');
  });

  it('(f) 負控制 C：出框但含 >500 chars 段落不可 hide（read-more 閘門主文保護）', () => {
    const tail = articleEl.querySelector('[data-test="gate-tail"]');
    const longP = articleEl.querySelector('[data-test="gate-long-p"]');
    assert.notStrictEqual(tail.dataset.jreadHidden, '1',
      '含長段落的出框子樹是被截斷的主文，不可 hide');
    assert.notStrictEqual(longP.dataset.jreadHidden, '1',
      '長段落 <p> 自身也不可 hide');
  });

  it('(g) 負控制 D：水平出框（carousel 滑動輪播）不可 hide', () => {
    const off = articleEl.querySelector('[data-test="carousel-slide-offright"]');
    assert.notStrictEqual(off.dataset.jreadHidden, '1',
      '只認垂直下緣裁切；水平出框是 carousel 正常結構');
  });

  it('(h) restore：退出 reader mode 後 figcaption inline display 完整還原', () => {
    env.window.__JRead.cleaner.restore(hidden);
    const cap = articleEl.querySelector('[data-test="cropped-caption"]');
    assert.strictEqual(cap.style.getPropertyValue('display'), '',
      'restore 後 inline display 必須清空（原本無 inline display）');
    assert.notStrictEqual(cap.dataset.jreadHidden, '1',
      'restore 後 data-jread-hidden 標記必須移除');
  });
});
