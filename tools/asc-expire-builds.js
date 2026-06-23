#!/usr/bin/env node
// asc-expire-builds.js — App Store Connect：過期（expire）舊的 TestFlight build。
//
// 用途：TestFlight 累積一堆舊測試 build 時，把不需要的 build 標記 expired
// （TestFlight 測試者列表清乾淨）。**expired 不可復原**（Apple 限制），故本工具
// 預設「**保留最新一個 build、過期其餘全部**」，並先印出計畫；真正執行要帶 --yes。
//
// 用法：
//   node tools/asc-expire-builds.js                 # 乾跑：列出 build + 標出將過期者，不動
//   node tools/asc-expire-builds.js --yes           # 執行：保留最新 build、過期其餘
//   KEEP_BUILD=0.8.165.2 node tools/asc-expire-builds.js --yes   # 指定保留某 build（CFBundleVersion），過期其餘
//   KEEP_BUILD=none node tools/asc-expire-builds.js --yes        # 全部過期（不保留）
//
// 認證沿用 asc-provision-ios.js 的 ASC API key（~/.appstoreconnect/AuthKey_<KEY_ID>.p8）。

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEY_ID = process.env.ASC_KEY_ID || '592WJH7U2F';
const ISSUER_ID = process.env.ASC_ISSUER_ID || 'e9b64046-86e6-42a0-b8b6-74e33e91f7f0';
const P8_PATH = process.env.ASC_PRIVATE_KEY_PATH
  || path.join(os.homedir(), '.appstoreconnect', `AuthKey_${KEY_ID}.p8`);

const BUNDLE_ID = process.env.ASC_BUNDLE_ID || 'app.jread.ios';
const DO_IT = process.argv.includes('--yes');
const KEEP_BUILD = process.env.KEEP_BUILD; // CFBundleVersion 字串；'none' = 全過期；未設 = 保留最新

function makeJwt() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const key = fs.readFileSync(P8_PATH, 'utf8');
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${sig.toString('base64url')}`;
}

async function api(method, urlPath, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${makeJwt()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} → HTTP ${res.status}\n${text.slice(0, 2000)}`);
  }
  return json;
}

async function main() {
  if (!fs.existsSync(P8_PATH)) {
    console.error(`ERROR: ASC API key 不存在：${P8_PATH}`);
    process.exit(1);
  }

  // 1. app id
  const apps = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  const app = apps && apps.data && apps.data[0];
  if (!app) { console.error(`ERROR: 找不到 app（bundleId=${BUNDLE_ID}）`); process.exit(1); }
  console.log(`App: ${app.attributes.name} (${BUNDLE_ID}) id=${app.id}`);

  // 2. 所有「未過期」build（newest first），含 marketing version
  const builds = await api('GET',
    `/v1/builds?filter[app]=${app.id}&filter[expired]=false&limit=200&sort=-uploadedDate&include=preReleaseVersion`);
  const pre = {};
  for (const inc of (builds.included || [])) {
    if (inc.type === 'preReleaseVersions') pre[inc.id] = inc.attributes.version;
  }
  const list = (builds.data || []).map((b) => ({
    id: b.id,
    build: b.attributes.version,
    marketing: (b.relationships && b.relationships.preReleaseVersion && b.relationships.preReleaseVersion.data
      && pre[b.relationships.preReleaseVersion.data.id]) || '?',
    uploaded: b.attributes.uploadedDate,
    state: b.attributes.processingState,
  }));

  if (!list.length) { console.log('沒有未過期的 build，無事可做。'); return; }

  // 3. 決定保留哪些（其餘過期）
  let keepIds;
  if (KEEP_BUILD === 'none') {
    keepIds = new Set();
  } else if (KEEP_BUILD) {
    keepIds = new Set(list.filter((b) => b.build === KEEP_BUILD).map((b) => b.id));
    if (!keepIds.size) console.warn(`WARN: 指定保留的 KEEP_BUILD=${KEEP_BUILD} 不在未過期清單中——將過期全部。`);
  } else {
    keepIds = new Set([list[0].id]); // 最新一個（-uploadedDate 第一筆）
  }

  console.log(`\n未過期 build 共 ${list.length} 個：`);
  for (const b of list) {
    const tag = keepIds.has(b.id) ? '保留 ✅' : '將過期 ⛔';
    console.log(`  [${tag}] ${b.marketing} (${b.build})  ${b.state}  ${b.uploaded}`);
  }

  const toExpire = list.filter((b) => !keepIds.has(b.id));
  if (!toExpire.length) { console.log('\n沒有要過期的 build。'); return; }

  if (!DO_IT) {
    console.log(`\n[乾跑] 將過期 ${toExpire.length} 個 build。確認無誤後加 --yes 執行（expired 不可復原）。`);
    return;
  }

  console.log(`\n執行過期 ${toExpire.length} 個 build...`);
  for (const b of toExpire) {
    await api('PATCH', `/v1/builds/${b.id}`, {
      data: { type: 'builds', id: b.id, attributes: { expired: true } },
    });
    console.log(`  expired: ${b.marketing} (${b.build})`);
  }
  console.log('完成。');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
