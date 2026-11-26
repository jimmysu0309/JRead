#!/usr/bin/env node
// JRead — 打包 web core（v2.6.0）：dist/jread-web-core-<version>.zip
//
// 第三個 host（一般 https 網頁，JReader 網頁版）vendor 這個 zip，不改、不重寫任何排版。
// zip 會放在公開網址上，所以：
//   - 檔案一律白名單（下方 FILES 由頁面實際載入的 script ＋ ASSETS 明列組成），不整個資料夾複製
//   - 絕不含 lib/instapaper-keys.js（gitignored 的 Instapaper consumer secret）與 lib/instapaper.js
//     ——web host 不支援 Instapaper（WEB_EXCLUDED_SCRIPTS）
//   - forcing：test/regression/web-core-build.spec.js 解開 zip 驗沒有 instapaper-keys.js、沒有任何
//     檔案含 __JReadKeys、HTML 的 script 清單與 core-manifest.json 一致
//
// 載入清單的單一資料源＝擴充自己的三支頁面（reader/reader.html、reader/article.html、
// popup/popup.html）。web 版頁面與 core-manifest.json 都由 webPage() 從那三支衍生：
//   1. 拿掉 WEB_EXCLUDED_SCRIPTS 的 <script>
//   2. <head> 內 viewport meta 之後插入 HOST_MARKER 與兩支替身（host-shim-core.js、
//      web-host-shim.js）——替身必須比任何 JRead 模組早載
// 擴充頁面加減模組時 web 版自動跟上，不必另外維護一份清單。
//
// 用法：
//   node tools/build-web-core.js                 # 寫 dist/jread-web-core-<version>.zip
//   node tools/build-web-core.js --out <dir>     # 指定輸出資料夾
//   node tools/build-web-core.js --stage <dir>   # 只展開到資料夾（spec / 除錯用），不壓 zip
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SRC = path.join(REPO, 'jread');

// Host 合約版號：只在破壞性變更時加 1（規則見 SPEC.md「Host 合約」）。與 web-host-shim.js
// 的 HOST_CONTRACT 必須相同（forcing：web-core-build.spec.js）
const HOST_CONTRACT = 1;
// host 在這個註解的位置插入自己的 <head> 內容（設定 JSON、<base>、CSP、favicon…）
const HOST_MARKER = '<!-- jread-host-head -->';
const SHIM_SCRIPTS = ['lib/host-shim-core.js', 'lib/web-host-shim.js'];
const WEB_EXCLUDED_SCRIPTS = ['lib/instapaper-keys.js', 'lib/instapaper.js'];
// 頁面種類 → 擴充內的來源頁（zip 內同路徑）
const PAGES = {
  feed: 'reader/reader.html',
  article: 'reader/article.html',
  panel: 'popup/popup.html'
};
// 頁面 script 以外要帶的檔案（白名單）。字型：styler 的 @font-face 與 popup.html 的字型預覽
// 用到的全部（forcing spec 從 styler.js 掃檔名比對）＋授權文件；圖示：懸浮按鈕
const ASSETS = [
  'assets/fonts/LICENSE.txt',
  'assets/fonts/noto-serif-tc-light.woff2',
  'assets/fonts/noto-serif-tc-regular.woff2',
  'assets/fonts/noto-serif-tc-medium.woff2',
  'assets/fonts/noto-serif-tc-semibold.woff2',
  'assets/fonts/source-serif.woff2',
  'assets/fonts/piazzolla.woff2',
  'assets/fonts/public-sans.woff2',
  'assets/fonts/source-sans.woff2',
  'assets/icons/icon-32.png',
  // v3.6.0 Textshot：文章頁以 iframe 開的圖卡頁（不需要 host 替身：只用 canvas / localStorage / 系統分享）
  'reader/textshot.html',
  'reader/reader-textshot.js'
];
const EXTRA_FILES = ['LICENSE'];

const SCRIPT_RE = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;

function version() {
  return JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version;
}

// 頁面內 script src（相對該頁）→ core 根目錄起算的路徑
function resolveFromPage(pagePath, src) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), src));
}
function relativeToPage(pagePath, corePath) {
  return path.posix.relative(path.posix.dirname(pagePath), corePath);
}

function scriptsOf(pagePath, html) {
  const out = [];
  for (const m of html.matchAll(SCRIPT_RE)) out.push(resolveFromPage(pagePath, m[1]));
  return out;
}

// 擴充頁 → web 版頁面（見檔頭 1、2）
function webPage(pagePath, extHtml) {
  let html = extHtml.replace(SCRIPT_RE, (tag, src) => {
    return WEB_EXCLUDED_SCRIPTS.includes(resolveFromPage(pagePath, src)) ? '' : tag;
  });
  const shims = SHIM_SCRIPTS.map((p) => `<script src="${relativeToPage(pagePath, p)}"></script>`).join('\n');
  const inject = `\n${HOST_MARKER}\n<!-- JRead web core：host 替身，必須在任何 JRead 模組之前載入 -->\n${shims}\n`;
  const vp = /<meta name="viewport"[^>]*>/.exec(html);
  if (!vp) throw new Error(`${pagePath}：找不到 viewport meta，無法決定替身插入位置`);
  html = html.slice(0, vp.index + vp[0].length) + inject + html.slice(vp.index + vp[0].length);
  // 連續空行（被拿掉的 script 留下的）收一下，純外觀
  return html.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
}

function buildPlan() {
  const ver = version();
  const pages = {};
  const htmlOut = {};
  const files = new Set(EXTRA_FILES.concat(ASSETS));
  for (const [kind, pagePath] of Object.entries(PAGES)) {
    const ext = fs.readFileSync(path.join(SRC, pagePath), 'utf8');
    const html = webPage(pagePath, ext);
    htmlOut[pagePath] = html;
    pages[kind] = scriptsOf(pagePath, html);
    for (const s of pages[kind]) files.add(s);
  }
  const manifest = {
    version: ver,
    hostContract: HOST_CONTRACT,
    pages,
    html: Object.assign({}, PAGES),
    hostMarker: HOST_MARKER,
    assets: ASSETS.slice()
  };
  return { version: ver, manifest, htmlOut, files: Array.from(files).sort() };
}

function stage(dir) {
  const plan = buildPlan();
  fs.rmSync(dir, { recursive: true, force: true });
  for (const rel of plan.files) {
    const from = rel === 'LICENSE' ? path.join(REPO, 'LICENSE') : path.join(SRC, rel);
    if (!fs.existsSync(from)) throw new Error('白名單檔案不存在：' + rel);
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (rel === 'lib/web-host-shim.js') {
      const src = fs.readFileSync(from, 'utf8');
      const stamped = src.replace("const CORE_VERSION = '0.0.0-dev';", `const CORE_VERSION = '${plan.version}';`);
      if (stamped === src) throw new Error('web-host-shim.js 找不到 CORE_VERSION 標記');
      fs.writeFileSync(to, stamped);
    } else {
      fs.copyFileSync(from, to);
    }
  }
  for (const [rel, html] of Object.entries(plan.htmlOut)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), html);
  }
  fs.writeFileSync(path.join(dir, 'core-manifest.json'), JSON.stringify(plan.manifest, null, 2) + '\n');
  return plan;
}

function buildZip(outDir) {
  const plan = buildPlan();
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'jread-web-core-'));
  try {
    stage(tmp);
    fs.mkdirSync(outDir, { recursive: true });
    const zipPath = path.join(outDir, `jread-web-core-${plan.version}.zip`);
    fs.rmSync(zipPath, { force: true });
    execFileSync('zip', ['-q', '-X', '-r', zipPath, '.'], { cwd: tmp });
    return zipPath;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  if (at('--stage')) {
    const plan = stage(path.resolve(at('--stage')));
    console.log(`已展開 web core ${plan.version}（${plan.files.length + Object.keys(plan.htmlOut).length + 1} 個檔）到 ${at('--stage')}`);
  } else {
    const zip = buildZip(path.resolve(at('--out') || path.join(REPO, 'dist')));
    console.log('已產出 ' + path.relative(process.cwd(), zip));
  }
}

module.exports = {
  HOST_CONTRACT, HOST_MARKER, SHIM_SCRIPTS, WEB_EXCLUDED_SCRIPTS, PAGES, ASSETS,
  scriptsOf, webPage, buildPlan, stage, buildZip, resolveFromPage
};
