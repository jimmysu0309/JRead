// JRead — audio-module 播放器 widget keyword token（v1.5.28）
//
// 對應 bug：NPR 文章主文前的音訊播放器 wrapper class `audio-module`（Listen 鈕 +
// 「2-Minute Listen」時長 + queue + Transcript / download / embed 工具列）進閱讀
// 模式後，真實 Chrome 撐開播放器造成大片空白、且殘留 Transcript 連結（headless
// 不載入播放器故 harness 漏抓）。根因：`audio-module` 未被原 audio-player /
// audio-widget token 涵蓋。修法把 `audio[-_]*module` 加入 audio 系 noise token
// （`module` 是 CMS widget 區塊通用命名，配 audio 前綴即音訊播放器模組，非站點
// 特判）。Jimmy 2026-07-02 NPR 回報。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'audio-module-widget.html');

describe('cleaner — audio-module 播放器 widget keyword（v1.5.28）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('audio-module 播放器容器被 hide', () => {
    const player = document.querySelector('#player');
    assert.strictEqual(player.dataset.jreadHidden, '1',
      'audio-module 必須命中 audio[-_]*module token');
  });

  it('殘留 Transcript 連結隨播放器隱藏', () => {
    const tr = document.querySelector('.audio-tool-transcript');
    let hidden = false, p = tr;
    while (p) { if (p.dataset && p.dataset.jreadHidden === '1') { hidden = true; break; } p = p.parentElement; }
    assert.ok(hidden, 'Transcript 連結應被隱藏的 audio-module 容器蓋住（不再殘留）');
  });

  it('主文 p 全保留', () => {
    for (const para of document.querySelectorAll('article#story > p')) {
      assert.notStrictEqual(para.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${para.textContent.slice(0, 30)}…"`);
    }
  });
});
