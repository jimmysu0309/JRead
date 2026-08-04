// JRead — regression spec: 頂端進度條皮膚 progressBarStyle（v1.7.37）
// -----------------------------------------------------------------------------
// 需求（Jimmy 2026-08-04）：閱讀模式頂端進度條在「鄰近背景也是深色」時很難辨識，
// 要在淺色與深色模式都容易辨識。
//
// 根因：進度條是 position: fixed; top: 0 + z-index 2147483647，底下的背景**不是**
// 主題色，是當下捲到畫面頂端的任何內容（hero 大圖、深色引言區、程式碼黑塊）。
// 所以「把 theme.progressBar 調成更好的顏色」救不了——任何單一顏色都會在某段
// 背景上被吃掉。解法必須是背景無關的機制。
//
// 修法（結構性通則，不綁站點 / class）：新增 settings.progressBarStyle 四選一
//   'hairline'（預設 = 歷代行為）3px 純色
//   'outline'  雙通道描邊：深底靠白邊、淺底靠黑邊，兩側總有一邊有對比
//   'track'    outline + 常駐軌道（未讀段也有底色）
//   'thick'    5px + 右端圓角 + drop-shadow
//
// 訊號層次（CLAUDE.md 工作流原則 3）：
//   本檔驗「設定值 → 注入 CSS 字串」這一層，外加三條結構不變式（cache、單一
//   寫入點、options 預覽雙實作同步）。**不驗**真實瀏覽器下描邊在各種背景上的
//   實際對比是否足夠——那是 /harness-verify 截圖肉眼巡的層次。
//   也不驗 options 頁的 radio 點擊互動（jsdom 無真實 UI 事件鏈）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'progress-bar-style.html');
const JREAD_DIR = path.join(__dirname, '..', '..', 'jread');
const STYLER_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'styler.js'), 'utf8');
const OPTIONS_HTML = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.html'), 'utf8');
const OPTIONS_JS = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.js'), 'utf8');
const SHARED_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'settings-defaults.js'), 'utf8');
const SHARED = require(path.join(JREAD_DIR, 'content', 'settings-defaults.js'));

// 描邊值單一資料源（本 spec 的正準期望值）——styler 注入端與 options 預覽端
// 都必須逐字使用這串，任一邊改了另一邊沒跟上就 fail。
const HALO_CSS = 'box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.55), 0 1.5px 0 0 rgba(255, 255, 255, 0.65);';
const TRACK_COLOR = 'rgba(128, 128, 128, 0.42)';

function cssFor(progressBarStyle) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler'],
    viewport: { width: 1280, height: 900 }
  });
  const articleEl = env.document.getElementById('post');
  env.window.__JRead.styler.apply(articleEl, {
    theme: 'dark', fontSize: 17, contentWidth: 720,
    fontFamily: '', lineHeight: 1.5,
    ...(progressBarStyle === undefined ? {} : { progressBarStyle })
  });
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return { css: styleEl.textContent, env, articleEl };
}

describe('styler — 頂端進度條皮膚 progressBarStyle（v1.7.37）', () => {

  describe('設定欄位與白名單（單一資料源）', () => {
    it('DEFAULT_SETTINGS.progressBarStyle 預設 hairline（維持歷代行為）', () => {
      assert.strictEqual(SHARED.progressBarStyle, 'hairline');
    });

    it('settings-defaults.js 必須 export __JReadProgressBarStyles 白名單', () => {
      assert.match(SHARED_SRC, /global\.__JReadProgressBarStyles = PROGRESS_BAR_STYLES;/,
        '白名單必須從單一資料源 export，供 styler / options 共用');
      assert.match(SHARED_SRC,
        /const PROGRESS_BAR_STYLES = \['hairline', 'outline', 'track', 'thick'\];/,
        '白名單四值與順序（= options UI 排列順序）');
    });

    it('styler 的 fallback literal 必須與 shared 白名單逐字一致', () => {
      // styler 是獨立 content script、自帶 fallback（shared 缺席時的保險）。
      // 兩份存在就有 drift 風險——此條是 forcing function。
      const m = STYLER_SRC.match(/globalThis\.__JReadProgressBarStyles\) \|\|\s*(\[[^\]]+\])/);
      assert.ok(m, 'styler 必須先讀 globalThis.__JReadProgressBarStyles、再退回自帶 literal');
      const fallback = m[1].replace(/\s+/g, ' ');
      assert.strictEqual(fallback, "['hairline', 'outline', 'track', 'thick']",
        'styler fallback literal 必須與 settings-defaults.js 的白名單一致');
    });

    it('options.js 白名單取自 shared，不得自帶第二份 literal', () => {
      assert.match(OPTIONS_JS, /const PROGRESS_BAR_STYLES = window\.__JReadProgressBarStyles/,
        'options.js 必須 reference 單一資料源');
      assert.ok(!/const PROGRESS_BAR_STYLES = \['hairline', 'outline'/.test(OPTIONS_JS),
        'options.js 不得自帶完整白名單 literal');
    });
  });

  describe('注入 CSS：四種皮膚各自的產出', () => {
    it("hairline（預設）不注入任何覆寫——CSS 與「未帶此設定」逐字相等", () => {
      // 預設路徑零回歸面的不變式：既有使用者升級後拿到的 CSS 一個位元組都不變。
      assert.strictEqual(cssFor('hairline').css, cssFor(undefined).css);
    });

    it('hairline 不得含描邊 / 軌道 / 加高的任何宣告', () => {
      const { css } = cssFor('hairline');
      assert.ok(!css.includes('rgba(0, 0, 0, 0.55)'), 'hairline 不可有描邊');
      assert.ok(!css.includes('--jread-progress'), 'hairline 不可有軌道漸層');
      assert.ok(!css.includes('drop-shadow(0 1px 2px'), 'hairline 不可有投影');
    });

    it('outline 注入雙通道描邊（深底靠白邊、淺底靠黑邊）', () => {
      const { css } = cssFor('outline');
      const re = new RegExp('#__jread-progress\\s*\\{[^}]*' + HALO_CSS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      assert.match(css, re, 'outline 必須注入 #__jread-progress 的雙層 box-shadow');
      assert.ok(!css.includes('--jread-progress'), 'outline 不含軌道');
    });

    it('track 注入 width:100% !important + 硬色標漸層 + 描邊', () => {
      const { css } = cssFor('track');
      assert.match(css, /#__jread-progress\s*\{[^}]*width:\s*100%\s*!important/,
        'track 必須用 !important 蓋掉 onScrollProgress 寫入的 inline width');
      assert.match(css, /linear-gradient\(to right,\s*#7fb5e6 var\(--jread-progress, 0%\),\s*rgba\(128, 128, 128, 0\.42\) var\(--jread-progress, 0%\)\)/,
        '已讀 / 未讀必須是同位置兩個 color stop 的硬邊界，位置讀 --jread-progress');
      assert.ok(css.includes(HALO_CSS), 'track 必須同時帶描邊');
    });

    it('track 的條子顏色跟著主題走（dark 用 #7fb5e6、sepia 用 #2c5282）', () => {
      const env = loadFixtureWithScripts({
        fixturePath: FIXTURE_PATH, scripts: ['styler'],
        viewport: { width: 1280, height: 900 }
      });
      env.window.__JRead.styler.apply(env.document.getElementById('post'), {
        theme: 'sepia', fontSize: 17, contentWidth: 720,
        fontFamily: '', lineHeight: 1.5, progressBarStyle: 'track'
      });
      const css = env.document.getElementById('__jread-style').textContent;
      assert.ok(css.includes('#2c5282 var(--jread-progress, 0%)'),
        'sepia 主題的漸層必須用該主題的 progressBar 色');
    });

    it('thick 注入 5px + 右端圓角 + 投影', () => {
      const { css } = cssFor('thick');
      assert.match(css, /#__jread-progress\s*\{[^}]*height:\s*5px/, 'thick 必須加高到 5px');
      assert.match(css, /#__jread-progress\s*\{[^}]*border-radius:\s*0 3px 3px 0/, 'thick 右端圓角');
      assert.match(css, /#__jread-progress\s*\{[^}]*filter:\s*drop-shadow\(0 1px 2px rgba\(0, 0, 0, 0\.55\)\)/,
        'thick 投影');
      assert.ok(!css.includes(HALO_CSS), 'thick 不疊描邊（投影已是它的分離機制）');
    });

    it('未知值 / 損壞資料一律回退 hairline（白名單驗證）', () => {
      const baseline = cssFor('hairline').css;
      for (const bad of ['neon', '', null, 42, {}]) {
        assert.strictEqual(cssFor(bad).css, baseline, `progressBarStyle=${JSON.stringify(bad)} 必須回退 hairline`);
      }
    });
  });

  describe('base skeleton memoize cache 不變式（切換皮膚不可拿到 stale CSS）', () => {
    // buildCss 的 base 骨架有 memoize cache，key 只含 theme + contentWidth +
    // readerHostPage（_baseSkeletonKey）。若把依賴 progressBarStyle 的宣告寫進
    // base，切換皮膚會命中同 key 的舊 cache 拿到 stale CSS。這條就是守住
    // 「皮膚規則必須在 base 之外」的 forcing function。
    it('同一個 document 內連續切四種皮膚，每次都拿到對應的新 CSS', () => {
      const env = loadFixtureWithScripts({
        fixturePath: FIXTURE_PATH, scripts: ['styler'],
        viewport: { width: 1280, height: 900 }
      });
      const articleEl = env.document.getElementById('post');
      const styler = env.window.__JRead.styler;
      const settings = {
        theme: 'dark', fontSize: 17, contentWidth: 720,
        fontFamily: '', lineHeight: 1.5
      };
      const seen = {};
      // 同一組 theme + contentWidth（= 同一個 base cache key）反覆 apply
      for (const style of ['hairline', 'outline', 'track', 'thick', 'hairline', 'track']) {
        const snap = styler.apply(articleEl, { ...settings, progressBarStyle: style });
        seen[style] = env.document.getElementById('__jread-style').textContent;
        styler.restore(articleEl, snap);
      }
      assert.ok(seen.outline.includes(HALO_CSS), '第二次 apply（outline）必須拿到描邊');
      assert.ok(seen.track.includes('--jread-progress'), 'track 必須拿到軌道漸層');
      assert.ok(seen.thick.includes('height: 5px'), 'thick 必須拿到加高');
      assert.ok(!seen.hairline.includes(HALO_CSS),
        '切回 hairline 必須不含描邊（cache 不可把前一次的皮膚留下來）');
    });

    it('_baseSkeletonKey 不得含 progressBarStyle（皮膚規則應在 base 之外）', () => {
      const m = STYLER_SRC.match(/function _baseSkeletonKey\([^)]*\)/);
      assert.ok(m, '必須有 _baseSkeletonKey');
      assert.ok(!/progressBarStyle/.test(m[0]),
        'cache key 不該為了皮膚而膨脹——皮膚覆寫接在 base 之後即可');
    });
  });

  describe('進度百分比單一寫入點', () => {
    // 'track' 皮膚同時需要 style.width 與 CSS 變數 --jread-progress。兩者若各自
    // 寫入就會 drift（一條 path 更新、另一條沒有 → 軌道停在錯的位置）。
    it('setProgressPct 必須同時寫 style.width 與 --jread-progress', () => {
      const m = STYLER_SRC.match(/function setProgressPct\(pct\) \{[\s\S]*?\n  \}/);
      assert.ok(m, '必須有 setProgressPct');
      assert.match(m[0], /progressEl\.style\.width = pct \+ '%';/);
      assert.match(m[0], /setProperty\('--jread-progress', pct \+ '%'\)/);
    });

    it('onScrollProgress 不得直接寫 progressEl.style.width（必須走 setProgressPct）', () => {
      const m = STYLER_SRC.match(/function onScrollProgress\(\) \{[\s\S]*?\n  \}/);
      assert.ok(m, '必須有 onScrollProgress');
      assert.ok(!/progressEl\.style\.width\s*=/.test(m[0]),
        'onScrollProgress 內不可有第二個 width 寫入點（繞過 setProgressPct 會讓軌道位置 drift）');
      assert.match(m[0], /setProgressPct\(/, 'onScrollProgress 必須呼叫 setProgressPct');
    });
  });

  describe('options 預覽與 styler 注入的雙實作同步', () => {
    // options.html 的預覽 CSS 是靜態宣告、styler 的是動態產生字串，無法共用同
    // 一份宣告（CLAUDE.md 工作流原則 5 的「必須分開維護」情形）。此組即該原則
    // 要求的「明確標記 + sync 觸發條件」的自動化形式。
    it('options 預覽的描邊值必須與 styler 注入值逐字一致', () => {
      assert.ok(STYLER_SRC.includes(HALO_CSS), 'styler PROGRESS_HALO 必須是這串');
      assert.ok(OPTIONS_HTML.includes(HALO_CSS), 'options 預覽必須用同一串描邊');
    });

    it('options 預覽的軌道色 / 加高值必須與 styler 一致', () => {
      assert.ok(STYLER_SRC.includes(TRACK_COLOR) && OPTIONS_HTML.includes(TRACK_COLOR),
        '軌道色兩邊一致');
      assert.match(OPTIONS_HTML, /\[data-style="thick"\] \.pp-bar \{[^}]*height: 5px/,
        'options 預覽 thick 必須也是 5px');
      assert.match(OPTIONS_HTML, /\[data-style="thick"\] \.pp-bar \{[^}]*drop-shadow\(0 1px 2px rgba\(0, 0, 0, 0\.55\)\)/,
        'options 預覽 thick 投影值一致');
    });

    it('options radio 群的四個 value 必須等於白名單（含順序）', () => {
      const group = OPTIONS_HTML.match(/id="progressBarStyle"[\s\S]*?<\/div>/);
      assert.ok(group, 'options.html 必須有 progressBarStyle radio 群');
      const values = [...group[0].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
      assert.deepStrictEqual(values, ['hairline', 'outline', 'track', 'thick']);
    });

    it('options.js 必須把 progressBarStyle 納入 fields（否則不會存檔）', () => {
      assert.match(OPTIONS_JS, /const fields = \[[^\]]*'progressBarStyle'/);
    });

    it('雙實作標記必須留在 options.html（人看得到的 sync 觸發條件）', () => {
      assert.match(OPTIONS_HTML, /雙實作標記/,
        '移除標記等於移除下一個人同步兩邊的唯一線索');
    });
  });
});
