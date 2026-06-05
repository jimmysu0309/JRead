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
    assert.ok(/diff -r --brief jread\//.test(sh), '缺 source drift check');
    assert.ok(/SKIP_UPLOAD/.test(sh), '缺 SKIP_UPLOAD escape hatch');
  });

  it('BUILD_DIR 必須在 $TMPDIR（iCloud fileprovider 接管教訓，Shinkansen v1.9.26 同根因）', () => {
    assert.ok(/BUILD_DIR="\$\{TMPDIR/.test(sh), 'BUILD_DIR 必須用 $TMPDIR，不可放 repo 內（iCloud Drive 同步範圍）');
  });
});
