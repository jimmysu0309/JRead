#!/usr/bin/env node
// asc-provision-ios.js — iOS App Store 簽章資源 bootstrap（idempotent，可重跑）
//
// 做四件事（已存在的步驟自動跳過）：
//   1. Apple Distribution 憑證：本機產 RSA key + CSR → ASC API 簽發 →
//      import 進 login Keychain（key + cert）
//   2. 註冊 bundle ID：app.jread.ios + app.jread.ios.Extension（platform IOS）
//   3. 建 IOS_APP_STORE provisioning profiles（distribution profile 不需要
//      裝置清單——automatic signing 在無註冊裝置的 team 會卡 development
//      profile，這正是本 script 存在的原因）
//   4. profiles 下載到 ~/Library/MobileDevice/Provisioning Profiles/
//
// 用途：ios-build.sh 的 manual signing 前置。憑證一年到期後重跑即可換發。
//
// 需求：
//   - env ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY_PATH（~/.zshrc 已有，
//     與 Shinkansen 共用 592WJH7U2F）
//   - openssl / security CLI（macOS 內建）
//
// 用法：node tools/asc-provision-ios.js

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KEY_ID = process.env.ASC_KEY_ID || '592WJH7U2F';
const ISSUER_ID = process.env.ASC_ISSUER_ID || 'e9b64046-86e6-42a0-b8b6-74e33e91f7f0';
const P8_PATH = process.env.ASC_PRIVATE_KEY_PATH
  || path.join(os.homedir(), '.appstoreconnect', `AuthKey_${KEY_ID}.p8`);

const ASC_DIR = path.join(os.homedir(), '.appstoreconnect');
const DIST_KEY_PATH = path.join(ASC_DIR, 'apple-distribution-PR6NG3PH45.key');
const DIST_CER_PATH = path.join(ASC_DIR, 'apple-distribution-PR6NG3PH45.cer');
const PROFILE_DIR = path.join(os.homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles');

const BUNDLE_IDS = [
  { identifier: 'app.jread.ios', name: 'JRead iOS' },
  { identifier: 'app.jread.ios.Extension', name: 'JRead iOS Extension' },
];
const PROFILES = [
  { name: 'JRead iOS App Store', bundleId: 'app.jread.ios' },
  { name: 'JRead iOS Extension App Store', bundleId: 'app.jread.ios.Extension' },
];

// ---- ASC API JWT（ES256）----------------------------------------------
function makeJwt() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const key = fs.readFileSync(P8_PATH, 'utf8');
  // JWT ES256 要 raw r||s（ieee-p1363），不是 openssl 預設 DER
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

// ---- Step 1: Apple Distribution 憑證 ------------------------------------
async function ensureDistributionCert() {
  // Keychain 已有有效 Apple Distribution → 跳過
  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  if (/Apple Distribution: Zhimin Su \(PR6NG3PH45\)/.test(identities)) {
    console.log('[1/4] Apple Distribution 憑證已在 Keychain，跳過');
    return;
  }
  console.log('[1/4] 產生 Apple Distribution 憑證...');

  // 本機 RSA key + CSR（key 永不離開本機，chmod 600）
  if (!fs.existsSync(DIST_KEY_PATH)) {
    execFileSync('openssl', ['genrsa', '-out', DIST_KEY_PATH, '2048']);
    fs.chmodSync(DIST_KEY_PATH, 0o600);
  }
  const csrPem = execFileSync('openssl', [
    'req', '-new', '-key', DIST_KEY_PATH,
    '-subj', '/emailAddress=jimmy.zm.su@gmail.com/CN=Zhimin Su/C=TW',
  ], { encoding: 'utf8' });

  const created = await api('POST', '/v1/certificates', {
    data: {
      type: 'certificates',
      attributes: { certificateType: 'DISTRIBUTION', csrContent: csrPem },
    },
  });
  const certDer = Buffer.from(created.data.attributes.certificateContent, 'base64');
  fs.writeFileSync(DIST_CER_PATH, certDer);

  // import 進 login Keychain：先 key 再 cert（順序對 codesign identity 配對重要）
  const loginKeychain = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
  execFileSync('security', ['import', DIST_KEY_PATH, '-k', loginKeychain,
    '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
  execFileSync('security', ['import', DIST_CER_PATH, '-k', loginKeychain, '-f', 'x509']);
  console.log(`      憑證 ${created.data.id} 已 import Keychain（serial: ${created.data.attributes.serialNumber}）`);
}

// ---- Step 2: bundle IDs --------------------------------------------------
async function ensureBundleIds() {
  console.log('[2/4] 確認 bundle IDs...');
  const existing = await api('GET', '/v1/bundleIds?filter[identifier]=app.jread.ios,app.jread.ios.Extension&limit=200');
  const have = new Map((existing.data || []).map(b => [b.attributes.identifier, b.id]));
  const ids = {};
  for (const { identifier, name } of BUNDLE_IDS) {
    if (have.has(identifier)) {
      ids[identifier] = have.get(identifier);
      console.log(`      ${identifier} 已註冊，跳過`);
      continue;
    }
    const created = await api('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier, name, platform: 'IOS' } },
    });
    ids[identifier] = created.data.id;
    console.log(`      ${identifier} 註冊完成（${created.data.id}）`);
  }
  return ids;
}

// ---- Step 3+4: App Store profiles → 下載安裝 -----------------------------
async function ensureProfiles(bundleIdMap) {
  console.log('[3/4] 確認 App Store provisioning profiles...');
  // 撈 team 的 Apple Distribution 憑證 id（取未過期的全部掛進 profile）
  const certs = await api('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200');
  const validCerts = (certs.data || []).filter(c => new Date(c.attributes.expirationDate) > new Date());
  if (!validCerts.length) throw new Error('team 沒有有效 DISTRIBUTION 憑證——step 1 應已建立，請檢查');

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const existing = await api('GET', '/v1/profiles?filter[profileType]=IOS_APP_STORE&limit=200');
  const haveByName = new Map((existing.data || []).map(p => [p.attributes.name, p]));

  for (const { name, bundleId } of PROFILES) {
    let profile = haveByName.get(name);
    if (profile && profile.attributes.profileState === 'INVALID') {
      // 憑證換發後舊 profile 會 INVALID——刪掉重建
      await api('DELETE', `/v1/profiles/${profile.id}`);
      profile = null;
      console.log(`      ${name} 原 profile INVALID，已刪除重建`);
    }
    if (!profile) {
      const created = await api('POST', '/v1/profiles', {
        data: {
          type: 'profiles',
          attributes: { name, profileType: 'IOS_APP_STORE' },
          relationships: {
            bundleId: { data: { type: 'bundleIds', id: bundleIdMap[bundleId] } },
            certificates: { data: validCerts.map(c => ({ type: 'certificates', id: c.id })) },
          },
        },
      });
      profile = created.data;
      console.log(`      ${name} 建立完成`);
    } else {
      console.log(`      ${name} 已存在，重新下載`);
    }
    const content = Buffer.from(profile.attributes.profileContent, 'base64');
    const dest = path.join(PROFILE_DIR, `${profile.attributes.uuid}.mobileprovision`);
    fs.writeFileSync(dest, content);
    console.log(`      → ${dest}`);
  }
}

(async () => {
  if (!fs.existsSync(P8_PATH)) {
    console.error(`ERROR: ASC API key 不存在：${P8_PATH}`);
    process.exit(1);
  }
  await ensureDistributionCert();
  const bundleIdMap = await ensureBundleIds();
  await ensureProfiles(bundleIdMap);
  console.log('[4/4] 完成。接下來：./safari-app/ios-build.sh');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
