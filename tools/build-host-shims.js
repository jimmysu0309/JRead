#!/usr/bin/env node
// JRead — 組出 iOS App 的 host 替身（v2.6.0）
//
// App 的 WKWebView 在 document start 注入一支腳本（ViewController.swift 讀 App bundle 的
// jreader-app-shim.js）。替身拆成兩份來源後，那一支改由本工具組出：
//   jread/lib/host-shim-core.js              跟平台無關的核心（網頁版也載同一份）
//   safari-app/JRead-iOS/shim-src/app-backend.js  App 專屬的 backend
// → safari-app/JRead-iOS/JRead/Resources/jreader-app-shim.js（產生檔，勿手改）
//
// 組法：外層一個 IIFE，先給核心一個區域 module 物件（核心偵測到 module.exports 就匯出到
// 那裡、不碰 window），再把匯出結果以 __JReadHostShimCore 傳給 backend。所以 App 頁面上
// 不會多出任何全域。
//
// 用法：
//   node tools/build-host-shims.js           # 寫入產生檔
//   node tools/build-host-shims.js --check   # 只比對，不一致 exit 1（spec 同款檢查）
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const CORE = path.join(REPO, 'jread', 'lib', 'host-shim-core.js');
const APP_BACKEND = path.join(REPO, 'safari-app', 'JRead-iOS', 'shim-src', 'app-backend.js');
const APP_SHIM = path.join(REPO, 'safari-app', 'JRead-iOS', 'JRead', 'Resources', 'jreader-app-shim.js');

function buildAppShim() {
  const core = fs.readFileSync(CORE, 'utf8').trimEnd();
  const backend = fs.readFileSync(APP_BACKEND, 'utf8').trimEnd();
  return [
    '// ⚠️ 產生檔，勿手改。來源：jread/lib/host-shim-core.js ＋ safari-app/JRead-iOS/shim-src/app-backend.js',
    '// 重新產生：node tools/build-host-shims.js（forcing：test/regression/host-shim-build.spec.js）',
    '(function () {',
    "  'use strict';",
    '  const module = { exports: {} };',
    '  // ---- jread/lib/host-shim-core.js ----',
    core,
    '  const __JReadHostShimCore = module.exports;',
    '  // ---- safari-app/JRead-iOS/shim-src/app-backend.js ----',
    backend,
    '})();',
    ''
  ].join('\n');
}

if (require.main === module) {
  const out = buildAppShim();
  const cur = fs.existsSync(APP_SHIM) ? fs.readFileSync(APP_SHIM, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (cur !== out) { console.error('jreader-app-shim.js 與來源不一致，請跑 node tools/build-host-shims.js'); process.exit(1); }
    console.log('jreader-app-shim.js 與來源一致');
  } else {
    fs.writeFileSync(APP_SHIM, out);
    console.log((cur === out ? '無變更：' : '已寫入：') + path.relative(REPO, APP_SHIM));
  }
}

module.exports = { buildAppShim, APP_SHIM, CORE, APP_BACKEND };
