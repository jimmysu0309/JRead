# Chrome Extension 自動化除錯指南

> 給 Claude Code（或其他 LLM agent）讀的操作手冊。目的：讓 Claude 在開發 Chrome Extension 時，能**自己**打開真實瀏覽器、載入 unpacked extension、觸發行為、讀取 DOM 結果，**不用請使用者貼 console 或截圖**。

本指南以 JRead 為樣板，但方法適用任何 MV3 Chrome Extension。把這個流程複製到新專案時，大部分結構可直接套用。

---

## 為什麼需要這套流程

Chrome Extension 開發有三個 LLM 痛點：

1. **content script 的 `window.*` 在 isolated world**，不會出現在 DevTools 的頁面 console 或 `page.evaluate` 預設環境。讓使用者貼 `window.__YourExt` 永遠回 undefined，把 Claude 帶往錯誤方向。
2. **Chrome Stable 從 137+ 擋掉 `--load-extension` flag**（Google 不希望 unpacked extension 方便被濫用）。Microsoft Edge 也擋。這讓很多「用 Chrome + CDP 連 9222 port」的文章失效。
3. **MV3 service worker 會被隨時終止**。連得到、幾秒後又斷，診斷訊息漏拿。

正確組合：

| 元件 | 選擇 | 理由 |
|---|---|---|
| 自動化 framework | Playwright | 官方支援 extension loading、API 穩定 |
| 瀏覽器 | **Playwright 內建的 Chromium** | 沒擋 `--load-extension`；Google Chrome 擋 |
| 連線模式 | `launchPersistentContext` | MV3 extension 必須 persistent context |
| headless | `false` | extension 僅 headed 可用 |
| 驗證管道 | SW 端 `chrome.tabs.sendMessage` → content script | 正確處理 world 隔離 |

---

## 背景除錯的三層分工（不干擾 Jimmy 前景的單一資料源）

> 痛點：cage（Claude in Chrome）能用 Jimmy 的真實 profile 除錯，但它會把分頁帶到**前景**、搶焦點，嚴重干擾 Jimmy 工作。以下三層由輕到重，目標是「該用哪一層就用哪一層，盡量別動到 Jimmy 的前景 Chrome」。**選層原則：能用低層就別跳高層。**

| 層 | 適用場景 | 工具 | 對 Jimmy 的干擾 | DOM 精度 |
|---|---|---|---|---|
| **Tier 1** | 一般站、不需登入態 | `debug-harness.js`（獨立 /tmp profile） | 零（headless + 螢幕外） | 完整（CDP 讀 DOM/rect/computed） |
| **Tier 2** | 需登入態，但可在專用 profile 登入一次 | `debug-harness.js --profile <name>` | 零（背景跑） | 完整 |
| **Tier 3** | **必須是 Jimmy 活的主 Chrome**（live session、無法在他處重登） | cua-driver（背景像素驅動） | 不搶焦點（背景） | 受限（像素/AX，見下） |

### Tier 1 — 獨立 profile 背景 harness（預設、最常用）

現成的 `tools/debug-harness.js`：用獨立 persistent profile（`/tmp/jread-pw-profile`）、`--headless=new` + 視窗推到螢幕外（`--window-position=-2400,-2400`）載入 dev 版 JRead，CDP 讀 DOM。本來就完全不碰 Jimmy 的 Chrome。

```bash
node tools/debug-harness.js --url https://example.com/article
```

JRead 大多數 bug（cleaner/styler/detector，不需登入）都走這層。

### Tier 2 — 帶登入態的持久 profile（背景）

`--profile <name>` 用 `~/.jread-debug/profiles/<name>` 這個**跨 run 重用**的持久 profile 取代 /tmp。在該 profile 登入過的站台 cookie/session 會留存（已驗證：run 後 `Default/Cookies` + `Local Storage` 落地），之後背景跑就自動帶登入態。

一次性登入（視窗會上螢幕，登入完關掉視窗即可）：

```bash
node tools/debug-harness.js --profile work --login --url https://paywalled-site.com
```

之後背景除錯（headless、螢幕外、不干擾）：

```bash
node tools/debug-harness.js --profile work --url https://paywalled-site.com/some-article
```

**相容性重點**：content script（cleaner/styler/detector）每次從磁碟重載 → 改這些**不需 `--fresh`**，登入態保得住；只有改 background SW 才需 `--fresh`（會清掉該 profile 登入態，要重登）。

**為什麼不直接複製 Jimmy 的真實 Chrome profile**：macOS 上 Chrome cookie 用 Keychain 的「Chrome Safe Storage」金鑰加密，複製到 Playwright Chromium（不同 app、不同 Safe Storage 金鑰）解不開；且 Chrome 137+ 擋 `--load-extension`，用真 Chrome 載不了 dev 版 JRead。專用 profile 一次登入是更穩、更乾淨、零侵入的解。

### Tier 3 — cua-driver 背景驅動 Jimmy 活的主 Chrome

> 不可化約的場景：必須是 Jimmy **正在跑的主 Chrome、活的 profile**（無法在 Tier 2 專用 profile 重登的 session）。cage 碰得到但搶前景；[cua-driver](https://github.com/trycua/cua) 是唯一能在**背景、不搶焦點**碰它的工具。

**狀態（2026-06-18）：drive-and-read 已實測通過。** 在新 session 載入 `cua-computer-use` MCP 工具後，對 Jimmy 活的主 Chrome（pid + window_id，全程 `is_on_screen:false`／前景在別的 Space）跑完整四步：(1) `check_permissions` 三項皆 true 且歸屬 `com.trycua.driver` daemon；(2) `get_window_state` 背景讀到該分頁 AX tree（標題／連結／訂閱頁尾等殘留文字結構讀得到，element_count 1381）；(3) `hotkey ["option","r"]` 不帶 window_id（auth-message 路徑、不搶前景）背景觸發 JRead 閱讀模式；(4) 再讀 AX（element_count 902，少 479 個元素）+ `vision` 截背景視窗確認 reader card 已渲染、雜訊退出主視覺。全程 Chrome 未被帶到前景。<br>（前置歷史：已安裝 + 授權 + MCP 註冊並 Connected；背景枚舉/AX 讀取 CLI 已 smoke 過。）

已裝版本：cua-driver 0.5.7（Rust backend，maintainer 現行預設；macOS 背景 AX 表現若不佳可改 `--backend=swift` 重裝）。

#### 安裝（已完成，重裝/他機照這步）

TCC 權限對話框只認 app bundle 身分，**授權開關只能由人親手點**，Claude 代點不了。

```bash
# 1. 安裝（sudo-free：CuaDriver.app → /Applications，binary symlink → ~/.local/bin/cua-driver）
#    副作用：會在 ~/.claude/skills/ 放一個 cua-driver skill symlink（uninstall 會移除）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"

# 2. 啟背景 daemon（-g：不帶到前景）+ 授權
open -n -g -a CuaDriver --args serve
cua-driver permissions grant          # 開系統設定面板，等人授權後自動完成
#    在 系統設定 → 隱私權與安全性 把 CuaDriver 兩項都打開：
#      ① 輔助使用 Accessibility（讀 AX tree、送點擊/鍵盤）
#      ② 螢幕錄製 Screen Recording（截單一視窗）
#    打開螢幕錄製通常要求「結束並重新打開」CuaDriver → daemon 會被結束，
#    重跑 `open -n -g -a CuaDriver --args serve` 再驗證。
cua-driver permissions status --json  # 確認 accessibility/screen_recording/capturable 三者皆 true

# 3. 接 MCP（Claude Code computer-use 相容模式；指令由 `cua-driver mcp-config --client claude` 印出）
claude mcp add-json cua-computer-use '{"args":["mcp","--claude-code-computer-use-compat"],"command":"'"$HOME"'/.local/bin/cua-driver"}'
claude mcp list | grep cua            # 應顯示 ✔ Connected
```

**MCP 工具要新開一個 Claude Code session 才會載入**——裝完當下的 session 沒有工具（但可用 `cua-driver call <tool> <json>` 從 CLI 直接驗）。

#### 驅動模型 + 工具集（實測）

輸入工具（`click` / `double_click` / `type_text` / `press_key` / `hotkey` / `scroll`）經 `CGEventPostToPid` 送到**指定 pid**，**背景、不搶前景**（不必 `bring_to_front`）。鎖定 Jimmy 的 Chrome 視窗用 `pid` + `window_id`。

讀取分三個訊號層（由結構化到像素）：
1. **`get_accessibility_tree`** → 列出 app + 可見視窗（title / bounds / z-order / window_id）。先用它找到 Chrome 視窗的 pid+window_id。
2. **`get_window_state`** → 走該視窗 AX tree，回傳 **Markdown 呈現的 UI、每個可互動元素標 `[element_index N]`**。Chrome 把網頁內容曝給 AX，所以這層**讀得到頁面標題 / 連結 / 殘留文字的結構**——這是 Tier 3 主要的「DOM-ish」讀取管道，殘留雜訊類驗收靠它，不必 OCR。`click` 可直接吃 `element_index` + `window_id`（不必算座標）。
3. **`screenshot`（單一視窗，吃 pid+window_id）/ `zoom`（裁切區域 JPEG）** → 視覺層。排版破壞、配圖大小、對齊、低對比這類「眼睛看的」bug 靠截圖直判。

**精確幾何（gap/寬度 px）的對策**：AX tree 給結構不給精確 rect。需要量 px 時用 JRead 既有「instrument 印到頁面紅框 div」pattern（見 memory／iOS instrument 套路），讓 content script 把 `getBoundingClientRect`/computed 值**渲染進頁面 overlay**，cua 截圖/AX 讀回；或退回 Tier 2 用專用 profile（有完整 CDP）重現。

#### 風險

cua 是 pre-release、API 變動快（README 自承 expect rough edges）；且授予了 Accessibility + Screen Recording 兩個高權限給 `com.trycua.driver`。因此 **Tier 3 只在 Tier 1/2 都搆不到的活 profile 場景才用**，不是常態。uninstall：`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/uninstall.sh)"`。

### 本輪建置心得（2026-06-18）

從「cage 除錯都得在前景、干擾 Jimmy」這個痛點出發、研究 cua 並建好三層的過程中，幾條值得記下的教訓：

1. **先盤點現有工具能力，再決定要不要引入新依賴**。原本以為要靠 cua 才能背景除錯，實際盤點後發現：Tier 1（現有 `debug-harness.js`）本來就 `--headless=new` + 視窗推到螢幕外＝零干擾；Tier 2 只差「視窗上螢幕登入一次」一個 flag——持久 profile 跨 run 留登入態的機制早就在（不加 `--fresh` 就重用）。**大半需求是把既有能力框成策略，而非寫新東西**。差點為了已有的能力裝一個重權限 app。

2. **cua-driver 的定位是「補最後一格」，不是「取代 cage」**。它的獨特價值只有一個：背景驅動「Jimmy 活的主 Chrome / 活 profile」這個 Tier 1/2 搆不到的場景。它不是更好的 DOM 工具。**選層原則：能用低層就別跳高層**——一般站 Tier 1、登入態 Tier 2、只有非用活 profile 不可才 Tier 3。

3. **工具真實能力要實測，別憑 README 推斷**（呼應 probe-before-code）。動手前以為「cua = 只能像素截圖、會丟失 DOM 精度」，差點為此先設計一套 on-page overlay 補償。實際 `cua-driver list-tools` 一看，`get_window_state` 把網頁 AX tree 轉成帶 `element_index` 的 Markdown——結構化讀取頁面文字/連結根本沒丟。**先入為主的限制假設會導致過度設計**。

4. **不要複製真實 Chrome profile 來拿登入態**：macOS cookie 用 Keychain「Chrome Safe Storage」金鑰加密，複製到 Playwright Chromium（不同 app、不同金鑰）解不開；加上 Chrome 137+ 擋 `--load-extension`。**專用持久 profile + 一次性登入**是更穩、零侵入的解，繞開整串加解密與 profile lock 問題。

5. **安裝/授權的兩個坑**：(a) 打開「螢幕錄製」授權時 macOS 要求重啟 CuaDriver → 背景 daemon 被殺 → 必須 `open -n -g -a CuaDriver --args serve` 重啟才驗得到權限；(b) `permissions status` 反映的是 daemon 自己的 TCC 身分（`com.trycua.driver`），daemon 沒在跑就回 `unknown`，不是真的沒授權。

6. **MCP server 接線當下 session 不會有工具**——MCP 工具只在 Claude Code session 啟動時載入。接好線要驗，先用 `cua-driver call <tool> <json>` 從 CLI 直接驗；真正用 MCP 工具要開新 session。

---

## 必要條件

1. **Node.js** ≥ 18（Playwright 需要）
2. **專案用 MV3**（`manifest_version: 3`）
3. **專案有可從 SW 觸發的訊息 API**（如 `TOGGLE_READER_MODE`）。如果沒有，請先加上，否則自動化只能看靜態狀態。

---

## Step 1：安裝 Playwright

在專案 root：

```bash
npm install --save-dev playwright
npx playwright install chromium
```

注意：`npx playwright install chromium` 會下載 bundled Chromium（幾百 MB，放在 `~/Library/Caches/ms-playwright/`）。這是關鍵——**不是**你系統裝的 Google Chrome。

---

## Step 2：專案目錄結構

```
<project-root>/
├─ <extension-folder>/        # manifest.json 與 extension 原始碼（JRead 的叫 jread/）
├─ tools/
│  └─ debug-harness.js        # ← 本指南的主角
├─ docs/
│  └─ CHROME_EXTENSION_DEBUG.md  # 本文
├─ package.json               # 加一行 "debug": "node tools/debug-harness.js"
└─ ...
```

---

## Step 3：debug-harness.js 範本

核心結構（以 JRead 為例，見 `tools/debug-harness.js` 完整版）：

```js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXT_PATH = path.join(__dirname, '..', '<extension-folder>');
const PROFILE_DIR = '/tmp/<your-ext>-pw-profile';
const URL = process.env.TARGET_URL || 'https://example.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (process.argv.includes('--fresh')) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // 1. 啟動 persistent context + 載 extension
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium',        // 必須
    headless: false,            // 必須
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  // 2. 等 service worker 起來（MV3 背景是 SW）
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  sw.on('console', m => console.log('SW', m.type(), m.text().slice(0, 300)));

  // 3. 關 about:blank，新開 tab（舊 tab 在 extension 載入前已存在，content script 不會補）
  for (const p of ctx.pages()) { try { await p.close(); } catch {} }
  const page = await ctx.newPage();
  page.on('console', m => console.log('PAGE', m.type(), m.text().slice(0, 200)));
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  // 4. Navigate + 等 content script 注入（document_idle）
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(2500);

  // 5. 找該 tab 的 id（從 SW 端查——content script 讀不到 tab id）
  const tabId = await sw.evaluate(async (u) => {
    const ts = await chrome.tabs.query({});
    return (ts.find(t => t.url === u) || ts.find(t => t.url && !t.url.startsWith('chrome')))?.id;
  }, URL);

  // 6. SW 傳訊息給 content script 觸發行為
  const result = await sw.evaluate(async (id) => {
    try {
      const res = await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' });
      return { ok: true, res };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }, tabId);
  console.log('toggle:', result);

  await sleep(1200);

  // 7. 驗證 DOM（用 shared DOM 觀察，不碰 isolated world 變數）
  const state = await page.evaluate(() => ({
    hasActiveArticle: !!document.querySelector('[data-your-ext-active="1"]'),
    injectedStyle: !!document.getElementById('__your-ext-style'),
  }));
  console.log('state:', state);

  // 8. 截圖給 Claude 肉眼驗
  await page.screenshot({ path: '/tmp/ext-debug.png' });

  if (!process.argv.includes('--keep')) await ctx.close();
})().catch(e => { console.error(e.message, e.stack); process.exit(1); });
```

---

## Step 4：LLM 呼叫流程

Claude 在 Claude Code 裡面使用這個 harness 的典型流程：

```
1. 改 extension 程式碼
2. npm test（regression pass）
3. node tools/debug-harness.js --fresh
   → 讀 stdout 的 SW/PAGE log、DOM state、gap 數據
4. Read /tmp/ext-debug.png（或專案 .playwright-mcp/screenshot.png）
   → 肉眼確認視覺
5. 若有問題，改 code，重複 3–4
6. OK 後請使用者手動 Chrome reload 驗證 → commit/bump/release
```

關鍵：**步驟 3 可以多次跑，不用使用者介入**。

---

## Step 4.5：假設驗證順序（修 detector / cleaner / styler 時的硬性要求）

**在動 extension code 之前，必須先用 harness 在真實站點驗證你的修法假設。** 這是跟很多 LLM 習慣相反的流程——不是「改 code → 跑 unit test → 跑 harness」，而是「probe 真實 DOM 驗假設 → 改 code → fixture + spec 鎖行為 → harness 驗視覺」。

### 為什麼 unit test / fixture 不能當假設驗證工具

fixture 是**你自己寫的最小重現**，會漏掉真實站點 candidate 列表裡的元素——整站 wrapper、CMS 自動生成的無 class div、第三方廣告容器、隱藏但有文字的 meta 區塊等。在 fixture 上驗過的演算法，到真實站點跑會得到不同的 top-N 候選，常常選錯。

fixture 的正確定位是**forcing function（鎖住行為不回歸）**，不是假設探索工具。

### 正確順序

1. **寫一次性 probe 腳本**（`tools/probe-<site>.js`），直接把候選的評分/判斷邏輯注入 `page.evaluate` 跑真實站點 DOM：

    ```js
    const top = await page.evaluate(() => {
      // 你正在考慮的新演算法——直接寫在這裡，還沒改到 extension code
      const scoreMap = new Map();
      for (const el of document.querySelectorAll('p, li, h2, h3')) {
        const base = calcContentScore(el);
        bumpParentAndGrandparent(el, base, scoreMap);
      }
      const results = [];
      for (const [el, raw] of scoreMap) {
        results.push({ tag: el.tagName, cls: el.className, score: raw, ... });
      }
      return results.sort((a, b) => b.score - a.score).slice(0, 15);
    });
    console.table(top);
    ```

2. **肉眼驗證 top-N**：確認第一名是你預期的主文容器、其他站點 chrome / sidebar / 列表項都沒擠進前段。分數差距是否夠穩（第一名 47 分、第二名 17 分 → 穩；第一名 24 分、第二名 22 分 → 不穩，容易被雜訊翻轉）。

3. **假設成立才改 extension code**。假設不成立回到 step 1 換假設——此時成本極低，因為 extension code / fixture / spec 都還沒動。

4. **把假設鎖成 fixture + spec**。fixture 要含足夠的真實結構（不只主文，還要把競爭的 candidate 也放進去，例如你 probe 發現的整站 wrapper），讓 spec 真的驗得到「新演算法會選對而非選到競爭者」。

5. **sanity check**：暫時破壞修法跑 spec 驗 fail → 還原驗 pass。

6. **harness 驗真實視覺**。

7. **probe 腳本用完就刪**（一次性，不進 commit）。

### 反例：錯序的代價

2026-04-21 修 JRead detector 時踩過：
- 錯序：在 jsdom fixture 上設計「多分支懲罰」規則 → npm test 過 → 才跑 harness → 發現真實 Stratechery 頁面有 `div.wp-site-blocks`（整站 wrapper，後代 p 數多達 32）這個 fixture 沒涵蓋的競爭者 → 多分支懲罰不夠力 → 得**整條重寫**成 Readability-style bubble-up
- 正序：直接在真實站點跑 probe 列 top-15 → 看到整站 wrapper 排第一 → 換假設跑 probe 看 bubble-up 結果 → 真主文 47 分 vs 第二名 17 分 → 假設確認 → 才動 detector code，一次到位

成本差異：錯序多花一輪 code 改寫 + fixture 擴充；正序只需一個 probe 腳本（跑完就刪）。

---

## 七個最容易踩的坑

### 1. `page.evaluate(() => !!window.__MyExt)` 永遠 false

**原因**：content script 在 isolated world，`page.evaluate` 在 page main world，兩個 window 不同。

**修法**：

- 不要驗 `window.__MyExt` 本身。
- 改驗「副作用」——content script 改了 DOM / inject 了 `<style>` / 加了 `data-*` attribute，這些**都在共享 DOM**，`page.evaluate` 看得到。
- 或用 `chrome.scripting.executeScript({ world: 'MAIN' })` 把驗證邏輯注入主世界（極少需要）。

### 2. `--load-extension` 無效

**原因**：如果你用的是 `channel: 'chrome'` 或系統安裝的 Google Chrome，新版 Chrome 把這 flag 擋掉了。

**修法**：一定要 `channel: 'chromium'`，用 Playwright 內建的 Chromium。

### 3. 擴充功能頁面顯示 extension 空的 / 開發人員模式灰掉

**原因**：你用了 Playwright MCP，它不支援 persistent context（2026/04 為止），見 [microsoft/playwright#39569](https://github.com/microsoft/playwright/issues/39569)。

**修法**：**不要**用 Playwright MCP 來載 extension。寫 standalone node script 用 `chromium.launchPersistentContext`。

### 4. 第一個分頁 content script 不注入

**原因**：Playwright 啟動時先開了 `about:blank`，那時 extension 還沒完成註冊，content script 不會回頭補注入。

**修法**：在 `ctx.pages()[0]` 上 `.close()`，再 `ctx.newPage()` 才 navigate。

### 5. `waitUntil: 'networkidle'` 卡住

**原因**：現代網頁有長效 WebSocket / analytics beacon / ads SDK，永遠沒 idle。

**修法**：用 `'load'` 就好，再加 `sleep(2500)` 等 document_idle 的 content script。

### 6. SW 看起來載入卻沒印任何 log

**原因**：Playwright 的 console listener 綁太慢、或 SW 已經跑完。

**修法**：SW 起來後立刻 `sw.on('console', ...)` 再 `sw.evaluate(() => 'ping')`，確保 CDP 綁上；之後 SW 有任何 `console.log/warn/error` 都會進 listener。

### 7. `chrome.tabs.sendMessage(id, ...)` 拋 `Could not establish connection`

**原因**：content script 還沒注入完成、或這個 tab 根本沒注入（chrome://、extension 頁面、部分 CSP 站點）。

**修法**：navigate 後至少等 2.5 秒；用 try/catch 吞錯誤回傳 ok:false；需要時 SW 端 fallback `chrome.scripting.executeScript` 主動注入（popup 的標準做法）。

---

## 怎麼讓 Claude 知道這套能力

把下面這段放在專案 CLAUDE.md（或類似的 agent instruction 檔）：

```markdown
## 自動化除錯

本專案有 `tools/debug-harness.js`，可以自動載 extension、打開目標頁、觸發閱讀模式、
讀 DOM 狀態、截圖到 `.playwright-mcp/jread-viewport.png`。

當你需要：
- 驗證 content script 的 DOM 變更是否符合預期
- 量測元素 layout（gap、computed style）
- 產生截圖比對視覺

請自己跑：
  node tools/debug-harness.js --fresh
  # 或針對特定網址
  JREAD_URL=https://example.com node tools/debug-harness.js --fresh
  # 驗收翻頁模式（先寫 settings.pagedMode=true 再 toggle，印 PAGED AUDIT：
  # column CSS 算出值 / 頁數 / 鍵盤翻頁 stride）
  node tools/debug-harness.js --fresh --paged

然後 Read `.playwright-mcp/jread-viewport.png`、分析 stdout log。
不需要請使用者貼 console 或截圖——這是自助的工具。

注意：`window.__JRead` 在 isolated world，`page.evaluate` 讀不到。
驗證一律走 shared DOM 的副作用（data-* / injected style / getBoundingClientRect）。

注意：**改過 background SW 後必加 `--fresh`**——Chromium 會把 unpacked
extension 的 SW 快取在 persistent profile 內，重啟不一定重載；content script
每次從磁碟新載。症狀是「content 端是新 code、SW 回應是舊 code」（新欄位
缺、SW 內新 log 不出現），v0.7.230 燒 4 輪 debug 的實證教訓。

### WebKit（Safari）軌的驗證

本 harness 是 Chromium，**WebKit engine 行為驗不到**（v0.7.230 翻頁模式
column-count: 1 bug 即 Chrome 綠、Safari 全滅）。WebKit 軌兩條驗法：

1. **Playwright WebKit**（`npx playwright install webkit`）：不能載 extension，
   改把 content script 以 `addScriptTag` 注入 page main world + chrome API
   stub（`setContent` 不觸發 `addInitScript`，stub 要放頁內 `<script>`）。
   注意 Playwright WebKit 是 **trunk build，可能已修正式版 Safari 還沒修的
   bug**（v0.7.230：trunk 對 count=1 正常、正式版 Safari 翻車）——綠燈不可
   直接當「Safari 沒問題」。
2. **safaridriver（真 Safari）**：需使用者一次性開 Safari → 設定 → 開發者 →
   「允許遠端自動化」；`safaridriver -p 4445` + W3C WebDriver REST 即可驅動。
   限制：自動化視窗 `visibilityState=hidden`、**rAF 完全不發、timer 鎖
   ~220ms**——能驗同步 DOM / layout / scrollLeft 直接賦值，rAF 動畫類行為
   驗不到（卡死是環境假象，不是 bug）。

   兩個 v0.7.231 實證的坑：
   - **bfcache 還魂**：同一 session 內「導航 A → about:blank → A」會把 A 的
     **完整 JS heap（含先前注入的舊 code closure）** 從 bfcache 還原，重注入
     新 code 也蓋不掉舊 listener。驗新 code 必須 DELETE session 開新 session。
   - **實機裝著正式版 extension 會搶 debug event**：使用者 Safari 裝著舊版
     JRead（isolated world），`__jread_debug` 是 DOM event 跨 world 廣播，
     舊版會先進 reader mode、注入舊 stylesheet，蓋掉手動注入的新 code。
     驗新 code 不可廣播 event——直接呼叫 main world 注入模組鏈
     （`NS.detector.detect()` → `NS.cleaner.clean()` → `NS.styler.apply()` →
     `NS.pagedMode.sync()`）。判別訊號：注入後 computed style 仍是舊版值
     （v0.7.231 案例：`paddingRight: 56px` 而非新版的 `0px`）。

## 假設驗證順序（硬性要求）

修 detector / cleaner / styler 這類跟真實 DOM 互動的 bug 時，**必須先在
harness 寫一次性 probe 腳本（tools/probe-<site>.js）把假設的演算法注入
page.evaluate 跑真實站點 DOM、驗證 top-N 候選正確，再動 extension code**。

fixture 是 forcing function，不是假設探索工具——fixture 會漏掉真實站點的
競爭 candidate（整站 wrapper、CMS 自動生成的無 class div 等）。在 fixture
上驗過的演算法到真實站點跑常會選錯，導致「改 code → 跑 npm test 過 → 才
跑 harness → 發現不對 → 重寫」的反模式。

正確順序：probe 驗假設 → 改 code → fixture + spec 鎖行為 → sanity check
→ harness 驗視覺 → probe 腳本刪除（一次性）。完整細節見
`docs/CHROME_EXTENSION_DEBUG.md` 的「假設驗證順序」章節。
```

---

## 移植到其他 Chrome Extension 專案時要改的地方

複製 `tools/debug-harness.js` 到新專案後，改以下幾個地方：

| 位置 | 原 JRead 值 | 要改成 |
|---|---|---|
| `EXT_PATH` | `jread` | 你的 extension 資料夾名 |
| `PROFILE_DIR` | `/tmp/jread-pw-profile` | `/tmp/<your-ext>-pw-profile` |
| `URL` 預設 | ChinaTalk 文章 | 你的測試頁 |
| `chrome.tabs.sendMessage` 的 `type` | `TOGGLE_READER_MODE` | 你的 extension 支援的訊息 type |
| DOM 驗證的 selector | `[data-jread-active="1"]` / `#__jread-style` | 你的 extension 加的 attribute / id |
| 環境變數名 | `JREAD_URL` | `<YOUR_EXT>_URL` |

其他（persistent context 設定、args、關 about:blank、SW console listener 等）**照抄即可**。

---

## 最小可行 checklist（新專案套用時）

- [ ] 專案內裝了 `playwright` devDependency
- [ ] `npx playwright install chromium` 跑過
- [ ] `tools/debug-harness.js` 改過 `EXT_PATH` / 訊息 type / 驗證 selector
- [ ] Extension 的 manifest 有 `"permissions": ["tabs"]` 或 `"activeTab"` + `"scripting"`（SW 才能 `chrome.tabs.sendMessage`）
- [ ] Extension 有可從 SW 觸發的訊息協定（TOGGLE / APPLY / 等）
- [ ] `package.json` 加了 `"debug": "node tools/debug-harness.js"` script
- [ ] CLAUDE.md（或 AGENTS.md 等）加了「可以自己跑 debug-harness」的指示
- [ ] 用一個真實測試頁跑過 `npm run debug -- --fresh` 確認 DOM state 正確印出

符合全部 → 下次 Claude 跟你改 extension 時，它可以**自己驗證視覺**，你只需要在最終 commit 前手動 Chrome reload 確認一次。
