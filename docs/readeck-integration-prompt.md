# JRead × Readeck 整合 — 實作規格 / Prompt

> 給 JRead 專案的 Claude Code session 直接執行。目標：在 JRead 現有「送到 Readwise
> Reader」功能旁，**平行新增**一個「送到 Readeck」功能，把 JRead 處理過的乾淨主文
> （若使用者先用 Shinkansen 就地翻譯，主文即為譯文）一鍵存到**自架的 Readeck** 供稍後閱讀。
>
> 本規格的 Readeck API 行為**已對實際 Readeck 0.22.3 instance 逐項打過 API 驗證**（非照文件腦補），
> 下方標「✅ 實測」的都是真實回應。

---

## 0. 一句話

「送到 Readeck」= 複製一份現有的 Readwise 整合，改打 Readeck 的 `POST /api/bookmarks`
（帶 `html` 欄位），並把「固定雲端網址 + `Token` 認證」換成「使用者自設 host + `Bearer` 認證」。
兩個功能各自獨立、互不取代。

---

## 1. 為什麼這樣就能存到「翻譯後」的內容

- Shinkansen（使用者另一個擴充）是**就地替換原文文字**，翻譯後瀏覽器 DOM 內的文章段落已是中文。
- JRead 閱讀模式抽取的「乾淨主文」就是當下 DOM 的主文 → 已含譯文。
- Readeck 0.22+ 的建立書籤 API 支援直接帶 `html` 內容，server 就**存你給的 HTML、不重抓原文**。
- ✅ 實測：送中文 `html`，Readeck 跑完 readability 後**中文段落、`<strong>` 等格式完整保留**。

JRead 這個功能本身不碰翻譯——它只負責「把當前乾淨主文送出去」。是否為譯文取決於使用者送出前有沒有開 Shinkansen。

---

## 2. 照抄對象：現有 Readwise 整合的檔案地圖

實作前**先讀完**這些既有程式碼，新功能要與它們的風格、錯誤碼、依賴注入、測試方式對齊：

| 檔案 | 既有 Readwise 內容（要照著做 Readeck 版） |
|---|---|
| `jread/popup/popup-core.js` | `buildReadwisePayload` / `saveToReadwise` / `validateReadwiseToken` / `saveReaderPayload`；掛在 `self.__JReadPopup` + `module.exports`（單測用）。錯誤碼慣例：`NO_FETCH` / `NO_TOKEN` / `NETWORK` / `AUTH` / `HTTP` / `ok`。 |
| `jread/content/settings-defaults.js` | `readwiseToken: ''` 預設值；custom-shortcuts 預設含 `'send-to-readwise': null`。 |
| `jread/options/options.js` | `fields` 陣列含 `readwiseToken`；token 測試按鈕 `readwiseTest` / 結果 `readwiseTestResult` → 呼叫 `validateReadwiseToken`。 |
| `jread/options/options.html` | `readwiseToken` 輸入框、`readwiseTest` 按鈕、`readwiseTestResult` 結果區。 |
| `jread/popup/popup.js` | `readwise-btn` / `readwise-status`、`hasReadwiseToken()`、按鈕僅在「閱讀模式啟用 + 非 cinema + 已設 token」時露出；click → 抽 reader payload → `saveReaderPayload`。 |
| `jread/popup/popup.html` | `readwise-btn` / `readwise-status` 元素。 |
| `jread/background/service-worker.js` | 指令 `send-to-readwise` → `sendToReadwiseFromCommand(tabId)`；allowed commands 清單；流程＝抽 payload → build → save。 |
| `jread/manifest.json` | `commands` 內 `send-to-readwise`（`Alt+Shift+R`）。 |

> 既有的 reader payload 抽取（`extractReaderPayload`，產出 `{ url, html, title, imageUrl, author, publishedDate }`）**直接重用**，不用改。Readeck 只取其中 `url` / `html` / `title`。

---

## 3. Readeck API 合約（✅ 全部對 0.22.3 實測）

### 3.1 建立書籤
```
POST  {host}/api/bookmarks
Authorization: Bearer {token}
Content-Type: application/json

{
  "url":   "https://原文網址/..."   // 必填。當作來源/識別，site 由它推導
  "html":  "<h1>...</h1><p>...</p>"  // 選填。要存的內容；不給則 server 自己抓 url
  "title": "文章標題"                // 選填。✅ 實測有吃，會原樣存為書籤標題
}
```

**✅ 實測成功回應：**
```
HTTP/1.1 202 Accepted
Bookmark-Id: VR3MvcxfnNmDxRXeWeLFZK
Location:    {host}/api/bookmarks/VR3MvcxfnNmDxRXeWeLFZK
Link:        <{host}/bookmarks/VR3MvcxfnNmDxRXeWeLFZK>; rel="alternate"; type="text/html"
Content-Type: application/json

{"status":202,"message":"Link submited"}
```

**關鍵差異（與 Readwise 不同，務必處理）：**
- 成功碼是 **202 Accepted（非同步）**，不是 Readwise 的 200/201。`fetch` 的 `res.ok` 對 202 為 `true`，
  所以沿用「`res.ok` 即成功」的判斷即可，但**文案/註解要寫明 202 = 已收下、背景處理中**。
- 新建的 bookmark id 在 **`Bookmark-Id` response header**（與 `Location` 尾段一致），body 沒有 id。
  若要回連結給使用者，從 header 取。
- body 的 `message` 官方就是拼錯的 `"Link submited"`，別把它當錯誤。

### 3.2 內容處理行為（✅ 實測）
- Readeck **會對你送的 `html` 再跑一次 readability 抽取**。
- 中文譯文、段落、`<strong>` 等**完整保留**；但 `<h1>` 會被降階成 `<h2>`、外層包進 `readability-page`（正常，不用處理）。
- 結論：**送「乾淨主文 HTML」最理想**（JRead 本來就產這個）。不要送整頁含 nav/側欄的 HTML。

### 3.3 Token 驗證端點（給 options「測試 token」按鈕）
```
GET  {host}/api/profile
Authorization: Bearer {token}
```
- ✅ 有效 token → **200**
- ✅ 無效 / 沒帶 token → **401**
- 用法與 `validateReadwiseToken` 完全平行（輕量、不建立任何資料）。

### 3.4 認證錯誤
- 無效 token：**401**（Readeck 沒回 403；判斷時 401/403 都歸 `AUTH` 保險）。

---

## 4. 要新增的設定（storage.sync）

在 `jread/content/settings-defaults.js` 新增**兩個** key（Readeck 是自架，host 必須可設）：
```js
readeckHost:  '',   // 例：http://100.95.51.92:8000（允許 http；結尾斜線要在使用時 normalize 掉）
readeckToken: '',
```
custom-shortcuts 預設新增：`'send-to-readeck': null`。

**host normalize 規則**（寫成共用小函式）：`trim()` → 去尾端 `/` → 視為 base，端點用 `${base}/api/bookmarks`、`${base}/api/profile`。host 為空時功能視為未設定（按鈕 hidden、送出回 `NO_HOST`）。

---

## 5. 要實作的核心函式（`jread/popup/popup-core.js`）

比照 Readwise 那組，新增平行的一組（同樣掛 `self.__JReadPopup` + `module.exports`，同樣 `fetchImpl` 依賴注入便於單測）：

```js
// ---- Readeck integration ------------------------------------------------
// 自架 Readeck 0.22+。POST {host}/api/bookmarks，Authorization: Bearer <token>。
// 成功 = 202 Accepted（非同步，背景抽取內文）；新 id 在 Bookmark-Id header。
// 內容處理：送 html 會被 readability 再抽一次，譯文保留、h1→h2（正常）。
function readeckEndpoint(host, path) {
  const base = String(host || '').trim().replace(/\/+$/, '');
  return base + path;            // base 為空時呼叫端要先擋（NO_HOST）
}

function buildReadeckPayload({ url, html, title } = {}) {
  if (!url || typeof url !== 'string') throw new Error('buildReadeckPayload: url 必填');
  const body = { url };
  if (html  && typeof html  === 'string') body.html  = html;
  if (title && typeof title === 'string' && title.trim()) body.title = title.trim();
  return body;                   // 注意：Readeck 不吃 image_url/author/published_date，別送
}

async function saveToReadeck({ host, token, payload, fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'NO_FETCH' };
  if (!host  || !String(host).trim())  return { ok: false, error: 'NO_HOST' };
  if (!token || !String(token).trim()) return { ok: false, error: 'NO_TOKEN' };
  let res;
  try {
    res = await f(readeckEndpoint(host, '/api/bookmarks'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${String(token).trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) { return { ok: false, error: 'NETWORK', message: String(e && e.message || e) }; }
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'AUTH' };
  if (!res.ok) return { ok: false, status: res.status, error: 'HTTP' };
  // 202 Accepted。新 id（若要用）在 Bookmark-Id header。
  const id = res.headers && res.headers.get ? res.headers.get('Bookmark-Id') : null;
  return { ok: true, status: res.status, id };
}

async function validateReadeckToken({ host, token, fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, error: 'NO_FETCH' };
  if (!host  || !String(host).trim())  return { ok: false, error: 'NO_HOST' };
  if (!token || !String(token).trim()) return { ok: false, error: 'NO_TOKEN' };
  let res;
  try {
    res = await f(readeckEndpoint(host, '/api/profile'), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${String(token).trim()}` }
    });
  } catch (e) { return { ok: false, error: 'NETWORK', message: String(e && e.message || e) }; }
  if (res.ok) return { ok: true, status: res.status };          // 200
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'AUTH' };
  return { ok: false, status: res.status, error: 'HTTP' };
}

// 與 saveReaderPayload 平行：popup 端整段流程（讀 host+token → build → save），直接在 extension 頁 fetch
async function saveReaderPayloadToReadeck({ payload, getHost, getToken, fetchImpl } = {}) {
  let host, token;
  try { host = await getHost(); token = await getToken(); }
  catch (e) { return { ok: false, error: 'INTERNAL', message: String(e && e.message || e) }; }
  let body;
  try { body = buildReadeckPayload(payload || {}); }
  catch (e) { return { ok: false, error: 'INVALID_PAYLOAD', message: String(e && e.message || e) }; }
  return saveToReadeck({ host, token, payload: body, fetchImpl });
}
```
記得加進 `api` 匯出物件：`buildReadeckPayload, saveToReadeck, validateReadeckToken, saveReaderPayloadToReadeck`。

---

## 6. UI / 流程要改的點

### 6.1 Options（`options.html` + `options.js`）
- `fields` 陣列加入 `'readeckHost'`、`'readeckToken'`。
- 新增 UI 區塊「Readeck（自架稍後閱讀）」：一個 **host 輸入框**（placeholder `http://100.x.x.x:8000`）、一個 **token 輸入框**、一顆 **「測試連線」按鈕** + 結果區（比照 `readwiseTest` / `readwiseTestResult`）。
- 測試按鈕呼叫 `PopupAPI.validateReadeckToken({ host, token })`，分支文案沿用 Readwise 測試的台灣用語：`✓ 連線正常` / `✗ Token 無效或已過期` / `✗ 無法連線，請檢查網址與網路` / `✗ 請先填 host 與 token`。
- **遵守 JRead UI 規則**（見 `~/.claude/CLAUDE.md` 與專案 SPEC）：同欄兄弟元件對齊、固定寬、高密度、台灣用語（用「網路」「程式」「快速鍵」等）。

### 6.2 Popup（`popup.html` + `popup.js`）
- 新增 `readeck-btn` / `readeck-status`，緊鄰 Readwise 按鈕。
- 露出條件比照 Readwise，但要 **host 與 token 都已設定**才露出（`hasReadeckConfig()`：讀 `readeckHost` + `readeckToken` 皆非空）。同樣「閱讀模式啟用 + 非 cinema」才顯示。
- click → 重用既有 `extractReaderPayload` 取得 `{ url, html, title }` → 呼叫 `saveReaderPayloadToReadeck({ payload, getHost, getToken })`。
- 狀態文案：`送出中…` / 成功 `✓ 已送到 Readeck`（202 視為成功）/ 失敗依錯誤碼給訊息（`NO_HOST`→提示去設定填 host；`AUTH`→token 失效；`NETWORK`→檢查網址/Tailscale 是否連線）。

### 6.3 快速鍵（`manifest.json` + `service-worker.js`）
- `manifest.json` `commands` 新增 `send-to-readeck`（**建議不設預設 suggested_key**，避免和現有衝突 / Chrome 4 鍵上限；讓使用者在 options 自訂快速鍵 UI 指派）。
- `service-worker.js`：allowed commands 清單加 `'send-to-readeck'`；新增 `sendToReadeckFromCommand(tabId)`，流程比照 `sendToReadwiseFromCommand`（必要時先啟動閱讀模式 → 抽 payload → 讀 host+token → build → `saveToReadeck`），在 SW 內直送。
- 注意既有 iOS Safari 的考量（popup 軌不繞 background，見 popup-core 註解 v0.8.65）——Readeck 的 popup 送出同樣走 extension 頁直接 fetch。

---

## 7. 邊界情況與雷

1. **CORS**：擴充已有 `host_permissions: ["<all_urls>"]`，背景/extension 頁 fetch 任意 Readeck host（含 `http://` 與 Tailscale `100.x`）不受 CORS 限制，**不用** Readeck 端另設 CORS。
2. **http（非 https）host 允許**：自架常是 `http://100.x.x.x:8000`。擴充頁 fetch http 不算 mixed content，OK。但 options 驗證輸入時**不要**強制 https。
3. **202 != 失敗**：務必把 2xx（含 202）當成功，否則使用者每次都看到「送出失敗」但其實有進去。
4. **host 結尾斜線**：normalize（`replace(/\/+$/, '')`），否則會打成 `//api/bookmarks`。
5. **html 要送「乾淨主文」**：別送整頁；Readeck 會再 readability，送整頁會抽歪。
6. **不要送 Readeck 不吃的欄位**（image_url / author / published_date）——不會報錯但無意義，保持 payload 乾淨。
7. **token 是機密**：不可寫進 repo / 測試 fixture / log。單測一律用假 token + `fetchImpl` mock。

---

## 8. 測試

- **單元測試**（比照既有 Readwise 的測法，注入 `fetchImpl` mock）：
  - `buildReadeckPayload`：缺 url 丟錯；有/無 html、title 的組合；不混入多餘欄位。
  - `saveToReadeck`：202→`{ok:true, id:<from header>}`；401→`AUTH`；500→`HTTP`；無 host→`NO_HOST`；無 token→`NO_TOKEN`；網路丟錯→`NETWORK`。mock 的 `res.headers.get('Bookmark-Id')` 要能取到 id。
  - `validateReadeckToken`：200→ok；401→`AUTH`；無 host/token→對應碼。
- **版本號 forcing function**：依專案規則 bump 版本並同步 `test/version-check.spec.js` 的 `EXPECTED_VERSION`。
- **真機驗證（手動）**：使用者有一台 Readeck 0.22.3 instance 可測。用 options 填 host + token → 按「測試連線」應 `✓` → 開一篇文章進閱讀模式（可先開 Shinkansen 翻譯）→ 按「送到 Readeck」→ 到 Readeck 網頁確認該篇出現、內文為譯文。

### 參考：已驗證可用的 curl（host / token 換成自己的，**勿提交進 repo**）
```bash
curl -i -X POST "$READECK_HOST/api/bookmarks" \
  -H "Authorization: Bearer $READECK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/x","title":"測試","html":"<h1>標題</h1><p>中文內文</p>"}'
# 預期：HTTP 202、header Bookmark-Id: <id>、body {"status":202,"message":"Link submited"}
```

---

## 9. 驗收標準

- [ ] options 可填 Readeck host + token，「測試連線」對有效 token 顯示成功、無效顯示失敗。
- [ ] 閱讀模式下 popup 出現「送到 Readeck」按鈕（未設 host/token 時隱藏）。
- [ ] 按下後文章（含 Shinkansen 譯文）出現在 Readeck，標題正確、內文為譯文。
- [ ] 202 顯示成功、各錯誤碼有對應的台灣用語提示。
- [ ] 自訂快速鍵可指派並送出。
- [ ] 既有 Readwise 功能完全不受影響（兩者獨立）。
- [ ] 單元測試涵蓋上述分支、版本號測試同步、token 未進 repo。
- [ ] 所有使用者面對字串符合台灣用語（軟體/網路/程式/介面/快速鍵…）。
