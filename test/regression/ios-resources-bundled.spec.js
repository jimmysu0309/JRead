// JRead — iOS Xcode bundle 必須打包 jread/ 每個資源資料夾（v1.0.25 forcing function）
//
// 動機（v1.0.22–v1.0.24 的 iOS feed 全白根因）：新增 jread/reader/ 後，ios-build.sh
// 只把檔案 rsync 到 Xcode 的 Resources/ 鏡像，但**沒人把 reader 加進 .pbxproj 的打包
// 清單**——Xcode 逐個資料夾參照（folder reference）來打包，沒參照的就不進 .appex。
// 結果 reader/ 在磁碟有、但 iOS app bundle 裡沒有，reader.html 不存在 → Safari 導航
// 到不存在的頁 → 全白。ios-build.sh 的 drift 檢查只比對「Resources 磁碟 == jread/」，
// 抓不到「Xcode 有沒有真的打包」這層。
//
// 這條 forcing：jread/ 每個資料夾都必須在 project.pbxproj
//   (1) 有 folder 型 PBXFileReference（path = Resources/<dir>）
//   (2) 列入 Copy Bundle Resources build phase（/* <dir> in Resources */）
// 新增資源資料夾忘了接 Xcode 專案就 fail。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const JREAD = path.join(ROOT, 'jread');
const PBXPROJ = path.join(ROOT, 'safari-app', 'JRead-iOS', 'JRead.xcodeproj', 'project.pbxproj');

describe('iOS Xcode bundle — jread/ 資源資料夾必須打包進 .appex（v1.0.25）', () => {
  const pbx = fs.readFileSync(PBXPROJ, 'utf8');
  const dirs = fs.readdirSync(JREAD, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it('jread/ 至少含 content / popup / reader（sanity，目錄抓取沒壞）', () => {
    for (const d of ['content', 'popup', 'reader']) {
      assert.ok(dirs.includes(d), `jread/ 應含 ${d}/`);
    }
  });

  for (const dir of fs.readdirSync(JREAD, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    it(`資料夾「${dir}」必須有 folder reference（path = Resources/${dir}）`, () => {
      const re = new RegExp(`lastKnownFileType = folder;[^}]*?path = Resources/${dir};`);
      assert.ok(re.test(pbx),
        `project.pbxproj 缺 jread/${dir} 的 folder reference（path = Resources/${dir}）——` +
        `新增資源資料夾必須在 Xcode 專案加 folder 參照，否則不會打包進 iOS .appex（v1.0.22 reader/ 漏打包教訓）`);
    });

    it(`資料夾「${dir}」必須列入 Copy Bundle Resources build phase`, () => {
      assert.ok(pbx.includes(`/* ${dir} in Resources */`),
        `project.pbxproj 的 Copy Bundle Resources 缺「${dir} in Resources」——資料夾沒進 build phase 就不會打包進 .appex`);
    });
  }
});
