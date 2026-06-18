// JRead — wikiHow inline 影片步驟壓字修法（v0.8.105）
//
// Bug：wikiHow Tie-a-Tie 寬版心下，步驟示範圖壓住右側 step 文字（Jimmy 2026-06-18
// 截圖）。根因（probe 實證）：步驟用 DIV.video-container.content-fill
// （position:absolute，內含 poster img + video）做 inline 自動播放示範影片，外層
// 沒有 relative+overflow:hidden 的自包覆 player root。styler 的 player 標記迴圈
// fallback 把這個 absolute 容器整支標 data-jread-player → 凍結在所有 position /
// height reset 之外 → 容器不貢獻 flow 高度 → 祖先 .mwimg.whvid 塌成 16px →
// 309px 的 absolute 圖浮在後續 step 文字上。
//
// 修法兩部分（皆結構通則、非站點/class 特判）：
//   1. player 標記：沒找到真 player root（relative+overflow:hidden）時，fallback
//      只標 <video> 本身、不標站點的 absolute 包裝容器。
//   2. styler CSS：含媒體的直接容器（:has(> img/picture/video)）一併拉回
//      position:static + 清 inset，讓含媒體的 absolute 容器回到流內撐高。
//
// 註：jsdom 不算 layout / :has() 視覺結果——本 spec 驗「標記演算法選到哪個元素」
// （getComputedStyle 反映 inline position/overflow）+ CSS 字串注入；實際撐高度 /
// 不壓字的視覺由 tools/probe-wikihow.js（已驗 overlapCount 9→0）在真實站點驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wikihow-video-step.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function applyStyler() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner', 'styler'],
    viewport: { width: 1400, height: 900 },
    pretendToBeVisual: true
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  return env;
}

describe('styler — wikiHow inline 影片步驟壓字（v0.8.105）', () => {
  describe('player 標記：absolute fallback 容器只標 video、不凍結容器', () => {
    let document;
    before(() => { document = applyStyler().document; });

    it('沒有真 player root 時，站點 absolute 包裝容器不可被標 data-jread-player', () => {
      const vc = document.querySelector('.video-container');
      assert.ok(vc, 'fixture 應有 .video-container');
      assert.notStrictEqual(vc.getAttribute('data-jread-player'), '1',
        '.video-container（absolute、無真 player root）不可被標 player——forcing：標了會凍結 absolute、脫離 position/height reset、祖先塌陷壓字（回退 v0.8.103 bug）');
    });

    it('該結構的 <video> 本身仍須標 data-jread-player（保護播放層不被 strip）', () => {
      const v = document.querySelector('.wh-video');
      assert.ok(v, 'fixture 應有 .wh-video');
      assert.strictEqual(v.getAttribute('data-jread-player'), '1',
        '<video> 本身仍應標 player——fallback 只縮到 video、不是完全不標');
    });

    it('poster img 不可被標 player（要走一般媒體正規化撐起容器高度）', () => {
      const img = document.querySelector('.video-container img.m-video');
      assert.ok(img, 'fixture 應有 poster img');
      assert.notStrictEqual(img.getAttribute('data-jread-player'), '1',
        'poster img 不可被標 player——它是撐起 video-container flow 高度、避免壓字的關鍵');
    });
  });

  describe('player 標記對照：真 player root（relative+overflow:hidden）仍整支保護', () => {
    let document;
    before(() => { document = applyStyler().document; });

    it('relative+overflow:hidden 的 player root 須標 data-jread-player', () => {
      const root = document.querySelector('.jwplayer-root');
      assert.ok(root, 'fixture 應有 .jwplayer-root');
      assert.strictEqual(root.getAttribute('data-jread-player'), '1',
        '真 player root 找得到時，subtree chrome 保護照舊——forcing：修法不可誤傷 JW 式 player');
    });

    it('真 player root 的後代（controls）也須標 data-jread-player', () => {
      const controls = document.querySelector('.jw-controls');
      assert.ok(controls, 'fixture 應有 .jw-controls');
      assert.strictEqual(controls.getAttribute('data-jread-player'), '1',
        '真 player root 的 chrome 後代仍整支標 player');
    });
  });

  describe('styler CSS：含媒體的直接容器拉回 position:static', () => {
    let css;
    before(() => { css = applyStyler().document.getElementById('__jread-style').textContent; });

    it('必須有「:has(> video) { position: static }」這條媒體容器歸位規則', () => {
      // 把 CSS 切成 rule 區塊，找帶 :has(> video) selector 且 body 含 position:static 的那條
      const blocks = css.split('}').map(b => b + '}');
      const posStaticMediaRule = blocks.find(b =>
        /:has\(>\s*video\)/.test(b) && /position\s*:\s*static\s*!important/.test(b));
      assert.ok(posStaticMediaRule,
        '必須有含媒體容器（:has(> video)）+ position:static 的規則——forcing：移除後 absolute 媒體容器留在原位繼續壓字');
    });

    it('該 position:static 媒體容器規則須一併清 inset（top/left/right/bottom auto）', () => {
      const blocks = css.split('}').map(b => b + '}');
      const rule = blocks.find(b =>
        /:has\(>\s*video\)/.test(b) && /position\s*:\s*static\s*!important/.test(b));
      assert.ok(rule);
      for (const side of ['top', 'left', 'right', 'bottom']) {
        assert.ok(new RegExp(`${side}\\s*:\\s*auto\\s*!important`).test(rule),
          `position:static 媒體容器規則必須含 ${side}: auto !important（清掉站點 inset，容器才回正常 flow 位置）`);
      }
    });

    it('該媒體容器規則須排除 player 容器（:not([data-jread-player="1"]))', () => {
      const blocks = css.split('}').map(b => b + '}');
      const rule = blocks.find(b =>
        /:has\(>\s*video\)/.test(b) && /position\s*:\s*static\s*!important/.test(b));
      assert.ok(rule);
      assert.ok(/:not\(\[data-jread-player="1"\]\)/.test(rule),
        '媒體容器 position:static 規則必須排除 player 容器（真 responsive embed 靠 absolute 填滿 relative 框）');
    });
  });
});
