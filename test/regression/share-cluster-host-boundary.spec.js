// JRead — share cluster hostname 邊界 + 主文 guard（v1.7.39 全面 review C1）
// -----------------------------------------------------------------------------
// 對應 fixture：test/regression/fixtures/share-cluster-host-boundary.html
//
// Bug（2026-08-05 全面 review 批次 1，真 Chromium probe 實證）：
//   1. SHARE_LINK_SEL 的 `a[href*="x.com"]` 是 CSS 子字串比對——
//      "netflix.com".includes("x.com") === true，netflix / dropbox / xbox /
//      linux 等一整族域名全部誤中；`t.me` 誤中 about.me、`line.me` 誤中
//      airline.me 同型。
//   2. hideSocialShareClusters 是 cleaner 全檔唯一無主文兜底的 hide 規則：
//      正文段落行文中含 3+ 個撞名域名連結 → 整段被 hide（主文誤殺通道）。
//
// 修法：
//   - SHARE_HOSTS 單一資料源 → selector 只當 superset pre-filter，實際判定
//     走 isShareServiceLink 的 hostname 邊界比對（host === d 或 endsWith('.'+d)）
//   - hide 前補主文 guard：wrapperContainsMainContentP（wrapper 場景）+
//     「非連結文字量 >= 80」（inline prose 場景）
//
// 訊號層次：本 spec 驗 jsdom 下 hide 標記與 guard 邏輯；真實站分享列的視覺
// 清除由 /harness-verify residual audit 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'share-cluster-host-boundary.html');

describe('cleaner — share cluster hostname 邊界 + 主文 guard (v1.7.39)', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      // isShareServiceLink 用 new URL(href, location.href)；給真實 base 讓
      // 相對 href 也解析得出來（本 fixture 全絕對 href，屬防禦性設定）
      url: 'https://example.com/article/1'
    });
    document = env.document;
    const articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  const byTest = (t) => document.querySelector(`[data-test="${t}"]`);

  it('真社群分享列（x.com intent / facebook sharer / line subdomain）仍被 hide（正例不退化）', () => {
    assert.strictEqual(byTest('share-cluster').dataset.jreadHidden, '1',
      'hostname 邊界修法後，真 share 連結（x.com 本域 + www.facebook.com + social-plugins.line.me 子網域）必須照常命中');
  });

  it('正文段落含 3 個 netflix.com 連結不可 hide（撞名域名 + inline prose guard）', () => {
    assert.notStrictEqual(byTest('prose-with-service-links').dataset.jreadHidden, '1',
      '"netflix.com".includes("x.com") 撞名不得計為 share 連結；即使計入也該被非連結文字量 guard 豁免');
  });

  it('3 個 dropbox.com 連結的短列不 hide（hostname 邊界擋撞名域名）', () => {
    assert.notStrictEqual(byTest('storage-service-nav').dataset.jreadHidden, '1',
      'dropbox.com 不是 share 服務域名，hostname 邊界比對後 cluster 計數應為 0');
  });

  it('wrapper 含主文長段 + 3 個真 share 連結 → 主文 guard 豁免整塊', () => {
    assert.notStrictEqual(byTest('wrapper-with-content').dataset.jreadHidden, '1',
      'wrapperContainsMainContentP guard：含 >= 100 字段落的 wrapper 不可整塊 hide');
    assert.notStrictEqual(byTest('wrapper-para').dataset.jreadHidden, '1');
  });

  it('主文段落全數保留', () => {
    for (const t of ['intro', 'tail']) {
      assert.notStrictEqual(byTest(t).dataset.jreadHidden, '1', `${t} 不可被 hide`);
    }
  });
});
