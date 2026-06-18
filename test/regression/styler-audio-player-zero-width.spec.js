// JRead — 可播放原生 audio 被站方自訂播放器 flex wrapper 擠成 0 寬修法（v0.8.116）
//
// Bug：Stratechery 進 reader mode 後「Listen to this post:（聽取本文音訊：）」下方
// 播放器渲染不出來，只剩一大塊空白（Jimmy 2026-06-18 截圖）。
//
// 根因（cage 真實 DOM probe）：passport-podcast-player 用一組 flex wrapper
// （title-container flex-column width:0 等）把原生 <audio controls> 擠成 rectW=0、
// 改由自訂 JS player UI 呈現控制條。reader mode 清掉自訂 UI 後只剩 0 寬裸 <audio>
// + 一行短標籤 → 看起來是空白。但 <audio> 本身有 controls + 有效 src 本來可播放。
//
// 通則修法（硬規則 3，純 CSS :has 結構判定，非站點/class 特判）：reader scope 內
// 任何含 audio[controls]/video[controls] 的祖先鏈解除 flex/0 寬壓縮
// （display:block + width:auto + min-width:0），媒體本體還原可用寬度（width:100%
// + min-width 兜底）。只命中 [controls]（使用者可播放介面），裝飾 JS-driven 媒體不誤撐。
//
// 註：jsdom 不計算 :has() layout，本 spec 只驗 CSS 字串注入（CLAUDE.md「驗哪層訊號」
// 說明）；實際 audio rectW 0→608 全寬行為由 Playwright harness probe 驗（cage 已實證）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'audio-player-zero-width-flex.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function getInjectedCss() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return styleEl.textContent;
}

describe('styler — 可播放 audio 被 flex wrapper 擠 0 寬（v0.8.116 Stratechery）', () => {
  it('CSS 必須含 :has(audio[controls]) / :has(video[controls]) 祖先鏈 un-squish selector', () => {
    const css = getInjectedCss();
    assert.ok(/:has\(audio\[controls\]\)/.test(css),
      'CSS 必須含 :has(audio[controls]) 祖先鏈 selector');
    assert.ok(/:has\(video\[controls\]\)/.test(css),
      'CSS 必須含 :has(video[controls]) 祖先鏈 selector');
  });

  it('祖先鏈 rule body 必須解除 flex/0 寬壓縮（display:block + width:auto + min-width:0）', () => {
    const css = getInjectedCss();
    const m = css.match(/:has\(audio\[controls\]\)[^{]*\{([^}]*)\}/);
    assert.ok(m, '必須找到含 audio[controls] 的祖先鏈 :has rule 區塊');
    const body = m[1];
    assert.ok(/display\s*:\s*block\s*!important/.test(body),
      'rule body 必須含 display: block !important（解除 flex 壓縮）');
    assert.ok(/width\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 width: auto !important');
    assert.ok(/min-width\s*:\s*0\s*!important/.test(body),
      'rule body 必須含 min-width: 0 !important（祖先不再被內容 0 寬壓回）');
  });

  it('媒體本體 audio[controls]/video[controls] 必須還原可用寬度（width:100% + min-width 兜底）', () => {
    const css = getInjectedCss();
    const m = css.match(/\[data-jread-active="1"\]\s*audio\[controls\][^{]*\{([^}]*)\}/);
    assert.ok(m, '必須找到 audio[controls] 媒體本體 rule 區塊');
    const body = m[1];
    assert.ok(/width\s*:\s*100%\s*!important/.test(body),
      'rule body 必須含 width: 100% !important');
    assert.ok(/min-width\s*:\s*min\(100%,\s*320px\)\s*!important/.test(body),
      'rule body 必須含 min-width: min(100%, 320px) !important（父鏈塌陷時兜底不被擠回 0）');
  });

  it('媒體本體 rule 不可下 display（會把原生 replaced 控制條高度壓成 0，probe 實證）', () => {
    const css = getInjectedCss();
    const m = css.match(/\[data-jread-active="1"\]\s*audio\[controls\][^{]*\{([^}]*)\}/);
    assert.ok(m, '必須找到 audio[controls] 媒體本體 rule 區塊');
    assert.ok(!/display\s*:/.test(m[1]),
      'audio[controls] 媒體本體 rule 不可含 display（保留原生 replaced 元素預設 display，否則控制條高度塌 0）');
  });
});
