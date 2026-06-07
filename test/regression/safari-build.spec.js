// JRead — Safari build forcing function
//
// 驗 safari-app/ scaffold（safari-bootstrap.sh、safari-build.sh、export options
// plist、xcodeproj 設定）結構正確。不實際跑 xcodebuild / notarize（那需要 macOS +
// Xcode + cert + Apple cloud；spec 不該動到那條鏈）。
//
// 此 spec 是 forcing function：
//   - 改 bundle ID、Team ID、scheme name、build script 缺步驟、export options
//     簽章設定錯誤都會被 catch
//   - sanity check：暫時把 PRODUCT_BUNDLE_IDENTIFIER 改錯 → fail；還原 → pass

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SAFARI_APP_DIR = path.join(REPO_ROOT, 'safari-app');
const PROJECT_DIR = path.join(SAFARI_APP_DIR, 'JRead');
const PBXPROJ_PATH = path.join(PROJECT_DIR, 'JRead.xcodeproj', 'project.pbxproj');
const BOOTSTRAP_PATH = path.join(SAFARI_APP_DIR, 'safari-bootstrap.sh');
const BUILD_PATH = path.join(SAFARI_APP_DIR, 'safari-build.sh');
const EXPORT_OPTS_PATH = path.join(SAFARI_APP_DIR, 'safari-export-options-developerid.plist');

describe('safari-app/ scaffold', () => {
  it('safari-bootstrap.sh 必須存在且 executable', () => {
    assert.ok(fs.existsSync(BOOTSTRAP_PATH), `${BOOTSTRAP_PATH} 不存在`);
    const stat = fs.statSync(BOOTSTRAP_PATH);
    assert.ok(stat.mode & 0o100, 'safari-bootstrap.sh 沒有 owner-execute bit');
  });

  it('safari-build.sh 必須存在且 executable', () => {
    assert.ok(fs.existsSync(BUILD_PATH), `${BUILD_PATH} 不存在`);
    const stat = fs.statSync(BUILD_PATH);
    assert.ok(stat.mode & 0o100, 'safari-build.sh 沒有 owner-execute bit');
  });

  it('safari-export-options-developerid.plist 必須存在', () => {
    assert.ok(fs.existsSync(EXPORT_OPTS_PATH), `${EXPORT_OPTS_PATH} 不存在`);
  });

  it('Xcode project（safari-app/JRead/JRead.xcodeproj）必須存在', () => {
    assert.ok(
      fs.existsSync(path.join(PROJECT_DIR, 'JRead.xcodeproj')),
      'Xcode project 不存在——請跑 ./safari-app/safari-bootstrap.sh'
    );
    assert.ok(fs.existsSync(PBXPROJ_PATH), 'project.pbxproj 不存在');
  });
});

describe('safari-export-options-developerid.plist', () => {
  const xml = fs.readFileSync(EXPORT_OPTS_PATH, 'utf8');

  it('method 必須是 developer-id（Developer ID 通道，非 MAS）', () => {
    assert.match(xml, /<key>method<\/key>\s*<string>developer-id<\/string>/);
  });

  it('teamID 必須是 PR6NG3PH45（沿用 Shinkansen Apple Developer Team）', () => {
    assert.match(xml, /<key>teamID<\/key>\s*<string>PR6NG3PH45<\/string>/);
  });

  it('signingStyle 必須是 manual（明確 pin cert 避免 Xcode 自動抓錯）', () => {
    assert.match(xml, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  });

  it('signingCertificate 必須是 Developer ID Application cert', () => {
    assert.match(
      xml,
      /<key>signingCertificate<\/key>\s*<string>Developer ID Application: Zhimin Su \(PR6NG3PH45\)<\/string>/
    );
  });
});

describe('safari-app/JRead/JRead.xcodeproj/project.pbxproj', () => {
  const pbxproj = fs.readFileSync(PBXPROJ_PATH, 'utf8');

  it('host App bundle ID 必須是 app.jread.macos（converter 預設 app.jread.JRead 錯誤）', () => {
    // host App Debug + Release 共兩處
    const matches = pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.jread\.macos;/g) || [];
    assert.ok(
      matches.length >= 2,
      `host App bundle ID 出現次數 ${matches.length} < 2——應 Debug + Release 兩處都是 app.jread.macos`
    );
    assert.ok(
      !pbxproj.includes('PRODUCT_BUNDLE_IDENTIFIER = app.jread.JRead;'),
      'pbxproj 仍含 converter 預設 app.jread.JRead——必須 patch 成 app.jread.macos'
    );
  });

  it('Extension bundle ID 必須是 app.jread.macos.Extension（host App 為 prefix）', () => {
    const matches =
      pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.jread\.macos\.Extension;/g) || [];
    assert.ok(
      matches.length >= 2,
      `Extension bundle ID 出現次數 ${matches.length} < 2——應 Debug + Release 兩處`
    );
  });

  it('DEVELOPMENT_TEAM 必須 4 處皆為 PR6NG3PH45（host App + Extension × Debug + Release）', () => {
    const matches = pbxproj.match(/DEVELOPMENT_TEAM = PR6NG3PH45;/g) || [];
    assert.strictEqual(
      matches.length,
      4,
      `DEVELOPMENT_TEAM = PR6NG3PH45 出現次數 ${matches.length} ≠ 4——少了會讓 archive 抓不到 cert`
    );
  });

  it('LSApplicationCategoryType 必須設成 productivity（host App Debug + Release）', () => {
    const matches =
      pbxproj.match(/INFOPLIST_KEY_LSApplicationCategoryType = "public\.app-category\.productivity";/g) || [];
    assert.ok(
      matches.length >= 2,
      `LSApplicationCategoryType 出現次數 ${matches.length} < 2`
    );
  });

  it('CFBundleDisplayName 必須是 JRead（host App）/ "JRead Extension"（Extension）', () => {
    assert.match(pbxproj, /INFOPLIST_KEY_CFBundleDisplayName = JRead;/);
    assert.match(pbxproj, /INFOPLIST_KEY_CFBundleDisplayName = "JRead Extension";/);
  });
});

describe('safari-build.sh', () => {
  const src = fs.readFileSync(BUILD_PATH, 'utf8');

  it('必須 rsync jread/ → Extension Resources/（每次 build 同步 source）', () => {
    assert.match(
      src,
      /rsync\s+-a\s+--delete\s+jread\/\s+"\$EXTENSION_RESOURCES\/"/,
      'safari-build.sh 必須 rsync jread/ → Extension Resources/，否則 build 出的 extension 永遠是 bootstrap 當時的快照'
    );
  });

  it('必須 sed bump MARKETING_VERSION + CURRENT_PROJECT_VERSION（同步 manifest 版本到 pbxproj）', () => {
    assert.match(src, /sed[^\n]+MARKETING_VERSION = \$\{VERSION\};/);
    assert.match(src, /sed[^\n]+CURRENT_PROJECT_VERSION = \$\{VERSION\};/);
  });

  it('必須跑 xcodebuild archive（含 -scheme JRead）', () => {
    assert.match(src, /xcodebuild[\s\S]+?-scheme JRead[\s\S]+?\barchive\b/);
  });

  it('必須跑 xcodebuild -exportArchive 並指 export-options plist', () => {
    assert.match(src, /xcodebuild -exportArchive/);
    assert.match(src, /-exportOptionsPlist "\$EXPORT_OPTS_DEVID"/);
  });

  it('必須跑 productbuild 把 .app 包成 Developer ID Installer 簽過的 .pkg', () => {
    assert.match(src, /productbuild[\s\S]+--sign "\$DEVID_INSTALLER_CERT"/);
  });

  it('必須跑 xcrun notarytool submit --wait', () => {
    assert.match(src, /xcrun notarytool submit[\s\S]+--wait/);
  });

  it('必須跑 xcrun stapler staple', () => {
    assert.match(src, /xcrun stapler staple/);
  });

  it('必須跑 source drift check（jread/ vs Resources/ 比對；manifest 是受控差異 -x 排除）', () => {
    // v0.7.228：manifest.json 由 patch-safari-manifest.sh 改成 event page
    //（iOS SW 不喚醒 bug 對策），是 jread/ ↔ Resources/ 唯一受控差異——drift
    // check 排除它、改由 patch script 的 verify 補上 manifest 檢查。
    assert.match(src, /diff -r --brief -x manifest\.json jread\/[\s\S]+EXTENSION_RESOURCES/);
    assert.match(src, /patch-safari-manifest\.sh/,
      'safari-build.sh 必須接 patch-safari-manifest.sh（event page patch）');
  });

  it('必須清掉舊版 .pkg（每次 bump 只留本次版本，避免 safari-app/ 累積歷史 .pkg）', () => {
    // forcing function：v0.7.213 前每次 bump 產新 .pkg 但不刪舊版，safari-app/
    // 會累積一堆歷史 .pkg。build 必須 glob safari-app/jread-macos-v*.pkg、
    // 跳過本次 $DEVID_PKG、rm 其餘。
    assert.match(
      src,
      /for old in safari-app\/jread-macos-v\*\.pkg/,
      'safari-build.sh 必須 glob 舊版 .pkg 做清除'
    );
    assert.match(
      src,
      /if \[ "\$old" != "\$DEVID_PKG" \]/,
      '清除迴圈必須跳過本次版本 $DEVID_PKG，只刪舊版'
    );
  });

  it('輸出 .pkg 路徑必須是 safari-app/jread-macos-v<version>.pkg', () => {
    assert.match(
      src,
      /DEVID_PKG="safari-app\/jread-macos-v\$\{VERSION\}\.pkg"/,
      'pkg 命名 forcing：release.sh 上傳 GH Release 時依此路徑找檔'
    );
  });
});

describe('release.sh — Safari 整合', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'release.sh'), 'utf8');

  it('必須呼叫 ./safari-app/safari-build.sh', () => {
    assert.match(src, /\.\/safari-app\/safari-build\.sh/);
  });

  it('必須支援 SKIP_SAFARI=1 escape hatch（cert / Xcode 暫時不能用時）', () => {
    assert.match(src, /SKIP_SAFARI/);
  });

  it('Safari build 後必須 auto-commit pbxproj + Resources/ 改動', () => {
    assert.match(src, /git add safari-app\/JRead\/JRead\.xcodeproj/);
    assert.match(src, /git commit -m "\$\{TAG\} — Safari sync \(auto\)"/);
  });

  it('必須 gh release upload .pkg --clobber 到 tag release', () => {
    assert.match(src, /gh release upload[\s\S]+--clobber/);
  });

  it('必須 poll 等 GH Release 由 Actions 建出後再 upload', () => {
    assert.match(src, /gh release view "\$\{TAG\}"/);
  });

  it('v0.7.141：OTHER_DIRTY 的 grep regex 必須含 `"?` 可選引號前綴（含空格路徑被 git 加雙引號）', () => {
    // forcing function：避免回退到 v0.7.140 踩過的 bug——含空格路徑
    // `safari-app/JRead/JRead Extension/...` 被 git status --porcelain 加雙引號
    // 變成 `"safari-app/...`，舊 grep regex `^.. safari-app/...` 沒對應 quote 前綴，
    // 路徑沒被 exclude → OTHER_DIRTY != 0 → script abort 在 Safari sync 前。
    // core.quotepath 只控制非 ASCII 字元引號、空格不在其控制範圍，**只能**在
    // grep regex 端加 `"?` 容許可選引號才能 match。
    const otherDirtyLine = src.match(/OTHER_DIRTY=\$\([^)]+\)/);
    assert.ok(otherDirtyLine, 'release.sh 必須含 OTHER_DIRTY= 賦值');
    assert.match(otherDirtyLine[0], /"\?safari-app/,
      'OTHER_DIRTY 的 grep regex 必須含 `"?safari-app` 容許可選引號前綴 —— 否則含空格路徑 `safari-app/JRead/JRead Extension/...` 被 git 加雙引號後 grep 對應不到 → script abort');
  });
});
