// JRead — iOS build forcing function（v0.7.217 TestFlight 軌）
//
// 驗 safari-app/ iOS scaffold（ios-bootstrap.sh、ios-build.sh、ios-export-options
// plist、JRead-iOS xcodeproj 設定、tools/asc-provision-ios.js）結構正確。
// 不實際跑 xcodebuild / altool（那需要 macOS + Xcode + cert + ASC API key；
// spec 不該動到那條鏈）——本 spec 驗「scaffold 結構」這一層，不驗「archive /
// 上傳實際成功」（那層靠人工跑 ios-build.sh 的 stdout 驗收）。
//
// 此 spec 是 forcing function：
//   - 改 bundle ID、Team ID、manual signing 設定、build script 缺步驟、
//     export options mapping 錯誤都會被 catch
//   - sanity check：暫時把 PRODUCT_BUNDLE_IDENTIFIER 改錯 → fail；還原 → pass

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SAFARI_APP_DIR = path.join(REPO_ROOT, 'safari-app');
const PROJECT_DIR = path.join(SAFARI_APP_DIR, 'JRead-iOS');
const PBXPROJ_PATH = path.join(PROJECT_DIR, 'JRead.xcodeproj', 'project.pbxproj');
const BOOTSTRAP_PATH = path.join(SAFARI_APP_DIR, 'ios-bootstrap.sh');
const BUILD_PATH = path.join(SAFARI_APP_DIR, 'ios-build.sh');
const EXPORT_OPTS_PATH = path.join(SAFARI_APP_DIR, 'ios-export-options.plist');
const PROVISION_PATH = path.join(REPO_ROOT, 'tools', 'asc-provision-ios.js');
const HOST_INFO_PLIST = path.join(PROJECT_DIR, 'JRead', 'Info.plist');

describe('safari-app/ iOS scaffold', () => {
  it('ios-bootstrap.sh 必須存在且 executable', () => {
    assert.ok(fs.existsSync(BOOTSTRAP_PATH), `${BOOTSTRAP_PATH} 不存在`);
    assert.ok(fs.statSync(BOOTSTRAP_PATH).mode & 0o100, 'ios-bootstrap.sh 沒有 owner-execute bit');
  });

  it('ios-build.sh 必須存在且 executable', () => {
    assert.ok(fs.existsSync(BUILD_PATH), `${BUILD_PATH} 不存在`);
    assert.ok(fs.statSync(BUILD_PATH).mode & 0o100, 'ios-build.sh 沒有 owner-execute bit');
  });

  it('ios-export-options.plist + asc-provision-ios.js 必須存在', () => {
    assert.ok(fs.existsSync(EXPORT_OPTS_PATH), `${EXPORT_OPTS_PATH} 不存在`);
    assert.ok(fs.existsSync(PROVISION_PATH), `${PROVISION_PATH} 不存在`);
  });

  it('iOS Xcode project（safari-app/JRead-iOS/JRead.xcodeproj）必須存在', () => {
    assert.ok(
      fs.existsSync(path.join(PROJECT_DIR, 'JRead.xcodeproj')),
      'iOS Xcode project 不存在——請跑 ./safari-app/ios-bootstrap.sh'
    );
    assert.ok(fs.existsSync(PBXPROJ_PATH), 'project.pbxproj 不存在');
  });
});

describe('JRead-iOS project.pbxproj', () => {
  const pbx = fs.readFileSync(PBXPROJ_PATH, 'utf8');

  it('host App bundle ID 必須是 app.jread.ios（converter 預設 app.jread.JRead 必須被 patch）', () => {
    assert.ok(/PRODUCT_BUNDLE_IDENTIFIER = app\.jread\.ios;/.test(pbx),
      'host App PRODUCT_BUNDLE_IDENTIFIER 必須是 app.jread.ios');
    assert.ok(!/PRODUCT_BUNDLE_IDENTIFIER = app\.jread\.JRead;/.test(pbx),
      'converter 產的 app.jread.JRead bundle ID 不可殘留');
  });

  it('Extension bundle ID 必須是 app.jread.ios.Extension', () => {
    assert.ok(/PRODUCT_BUNDLE_IDENTIFIER = app\.jread\.ios\.Extension;/.test(pbx));
  });

  it('DEVELOPMENT_TEAM = PR6NG3PH45 必須出現 4 處（兩 target × Debug/Release）', () => {
    const count = (pbx.match(/DEVELOPMENT_TEAM = PR6NG3PH45;/g) || []).length;
    assert.strictEqual(count, 4, `DEVELOPMENT_TEAM 出現 ${count} 處，應為 4`);
  });

  it('Release config 必須是 manual signing + App Store profile（team 無註冊 iOS 裝置，automatic 會卡 development profile）', () => {
    const manualCount = (pbx.match(/CODE_SIGN_STYLE = Manual;/g) || []).length;
    assert.strictEqual(manualCount, 2, `CODE_SIGN_STYLE = Manual 出現 ${manualCount} 處，應為 2（兩 target Release）`);
    assert.ok(/PROVISIONING_PROFILE_SPECIFIER = "JRead iOS App Store";/.test(pbx),
      'host App Release 必須指定 "JRead iOS App Store" profile');
    assert.ok(/PROVISIONING_PROFILE_SPECIFIER = "JRead iOS Extension App Store";/.test(pbx),
      'Extension Release 必須指定 "JRead iOS Extension App Store" profile');
    assert.ok((pbx.match(/CODE_SIGN_IDENTITY = "Apple Distribution";/g) || []).length >= 2,
      'Release config 必須用 Apple Distribution 憑證');
  });

  it('Debug config 必須維持 automatic signing（simulator build 不受 manual 影響）', () => {
    const autoCount = (pbx.match(/CODE_SIGN_STYLE = Automatic;/g) || []).length;
    assert.strictEqual(autoCount, 2, `CODE_SIGN_STYLE = Automatic 出現 ${autoCount} 處，應為 2（兩 target Debug）`);
  });
});

describe('host App Info.plist', () => {
  it('ITSAppUsesNonExemptEncryption 必須為 false（免出口合規問卷，TestFlight 上傳即可測）', () => {
    const xml = fs.readFileSync(HOST_INFO_PLIST, 'utf8');
    assert.match(xml, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  });
});

describe('host App 啟動引導畫面（Main.html）本地化', () => {
  // 單一 iOS binary 涵蓋 macOS（在 Apple Silicon Mac 以 iPad App 執行），台灣使用者
  // 開 App 第一眼是這張畫面——必須繁中，不可殘留 converter 英文 stock 模板。
  // forcing function：ios-bootstrap.sh 重跑會用 converter 模板覆蓋 host App，
  // 沒這條守會在重 bootstrap 後悄悄退回英文。
  const MAIN_HTML = path.join(PROJECT_DIR, 'JRead', 'Resources', 'Base.lproj', 'Main.html');

  it('必須宣告 lang="zh-Hant"', () => {
    const html = fs.readFileSync(MAIN_HTML, 'utf8');
    assert.match(html, /<html lang="zh-Hant">/);
  });

  it('必須為繁中啟用引導、且不殘留 converter 英文 stock 文案', () => {
    const html = fs.readFileSync(MAIN_HTML, 'utf8');
    assert.ok(/啟用 JRead/.test(html), 'Main.html 必須含繁中啟用引導文字');
    assert.ok(!/You can turn on/.test(html),
      'Main.html 不可殘留 converter 預設英文「You can turn on …」——bootstrap 重跑後須重新本地化');
  });
});

describe('ios-export-options.plist', () => {
  const xml = fs.readFileSync(EXPORT_OPTS_PATH, 'utf8');

  it('method 必須是 app-store-connect', () => {
    assert.match(xml, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  });

  it('signingStyle 必須是 manual 且帶 provisioningProfiles mapping', () => {
    assert.match(xml, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
    assert.match(xml, /<key>app\.jread\.ios<\/key>\s*<string>JRead iOS App Store<\/string>/);
    assert.match(xml, /<key>app\.jread\.ios\.Extension<\/key>\s*<string>JRead iOS Extension App Store<\/string>/);
  });

  it('teamID 必須是 PR6NG3PH45', () => {
    assert.match(xml, /<key>teamID<\/key>\s*<string>PR6NG3PH45<\/string>/);
  });
});

describe('ios-build.sh 步驟完整性', () => {
  const sh = fs.readFileSync(BUILD_PATH, 'utf8');

  it('必須含 rsync Resources / 版本 sync / archive / exportArchive / altool validate+upload / drift check', () => {
    assert.ok(/rsync -a --delete jread\//.test(sh), '缺 rsync jread/ → Resources');
    assert.ok(/MARKETING_VERSION = \$\{?VERSION\}?/.test(sh) || /MARKETING_VERSION = \[\^;\]/.test(sh.replace(/\\/g, '')) || /MARKETING_VERSION/.test(sh), '缺 MARKETING_VERSION sync');
    assert.ok(/CURRENT_PROJECT_VERSION/.test(sh), '缺 CURRENT_PROJECT_VERSION sync');
    assert.ok(/-destination 'generic\/platform=iOS'/.test(sh), '缺 generic/platform=iOS archive destination');
    assert.ok(/xcodebuild -exportArchive/.test(sh), '缺 exportArchive');
    assert.ok(/altool --validate-app/.test(sh), '缺 altool validate（upload 前先 validate 抓問題）');
    assert.ok(/altool --upload-app/.test(sh), '缺 altool upload');
    assert.ok(/diff -r --brief -x manifest\.json jread\//.test(sh),
      '缺 source drift check（-x manifest.json：manifest 是 event page patch 的唯一受控差異）');
    assert.ok(/SKIP_UPLOAD/.test(sh), '缺 SKIP_UPLOAD escape hatch');
  });

  it('BUILD_DIR 必須在 $TMPDIR（iCloud fileprovider 接管教訓，Shinkansen v1.9.26 同根因）', () => {
    assert.ok(/BUILD_DIR="\$\{TMPDIR/.test(sh), 'BUILD_DIR 必須用 $TMPDIR，不可放 repo 內（iCloud Drive 同步範圍）');
  });

  // v0.7.228：iOS Safari 的 MV3 SW 被系統回收後不再喚醒（Apple Forums 758346）
  // ——Safari build 的 manifest 必須 patch 成 event page（scripts + persistent:
  // false），否則「用一段時間後手勢 / popup 失效、強制關閉 Safari 才復原」回歸。
  it('rsync 後必須跑 patch-safari-manifest.sh（event page patch），drift check 後必須再 verify 一次', () => {
    const patchCalls = sh.match(/patch-safari-manifest\.sh/g) || [];
    assert.ok(patchCalls.length >= 2,
      `patch-safari-manifest.sh 必須出現至少 2 次（rsync 後 patch + drift check 後 verify），實際 ${patchCalls.length} 次`);
    const rsyncIdx = sh.indexOf('rsync -a --delete jread/');
    const firstPatchIdx = sh.indexOf('patch-safari-manifest.sh');
    assert.ok(rsyncIdx !== -1 && firstPatchIdx > rsyncIdx,
      'patch 必須在 rsync 之後（rsync --delete 會覆掉 patch 結果）');
  });
});

describe('patch-safari-manifest.sh（event page patch，iOS build）', () => {
  const PATCH_PATH = path.join(SAFARI_APP_DIR, 'patch-safari-manifest.sh');

  it('必須存在且 executable', () => {
    assert.ok(fs.existsSync(PATCH_PATH), '缺 safari-app/patch-safari-manifest.sh');
    assert.ok(fs.statSync(PATCH_PATH).mode & 0o111, 'patch-safari-manifest.sh 必須 executable');
  });

  it('必須產生 scripts 三檔（依賴檔先載、SW 最後）+ persistent:false、必須含受控差異驗證', () => {
    const psh = fs.readFileSync(PATCH_PATH, 'utf8');
    // v0.7.229：event page 沒有 importScripts——SW 內 typeof guard 會靜默跳過，
    // 清單漏列依賴檔會讓對應 global undefined、Safari 直接 TypeError。
    // v0.7.235：settings-defaults.js 加入預載（DEFAULT_SETTINGS 單一資料源，
    // SW 的 GET_SETTINGS / onInstalled merge 依賴 __JReadSettingsDefaults）。
    assert.ok(/scripts:\s*\[\$pc,\s*\$sd,\s*\$sw\]/.test(psh),
      'background.scripts 必須是 [popup-core, settings-defaults, service-worker] 三檔且依賴檔在前');
    assert.ok(/POPUP_CORE="popup\/popup-core\.js"/.test(psh), 'popup-core 路徑必須是 popup/popup-core.js');
    assert.ok(/SETTINGS_DEFAULTS="content\/settings-defaults\.js"/.test(psh),
      'settings-defaults 路徑必須是 content/settings-defaults.js');
    assert.ok(/persistent:\s*false/.test(psh), '必須宣告 persistent: false（non-persistent event page）');
    assert.ok(/del\(\.background\)/.test(psh), '必須驗證 background 以外欄位與 source 一致（受控差異唯一性）');
  });

  it('scripts 清單必須與 tools/firefox-build.sh 的 event page 清單同列同序（雙處硬寫防 drift）', () => {
    const ffsh = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'firefox-build.sh'), 'utf8');
    const m = ffsh.match(/"scripts":\s*\[([^\]]+)\]/);
    assert.ok(m, 'firefox-build.sh 找不到 background.scripts 改寫');
    const ffList = m[1].match(/"[^"]+"/g).map((s) => s.replace(/"/g, ''));
    assert.deepStrictEqual(ffList,
      ['popup/popup-core.js', 'content/settings-defaults.js', 'background/service-worker.js'],
      'firefox-build.sh scripts 清單變動——patch-safari-manifest.sh 必須同步（兩邊是同一份事實的雙實作）');
  });
});
