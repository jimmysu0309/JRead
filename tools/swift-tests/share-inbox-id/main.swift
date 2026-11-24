// share-inbox-id — 給 test/regression/ios-share-extension.spec.js 用：
// 從 stdin 逐行讀請求 id，印出 ShareInbox.isValidID 的結果（1 / 0），
// spec 拿同一批 id 跟 JS 端的 SHARE_REQUEST_ID_RE 比對，確保兩端判準不 drift
import Foundation

while let line = readLine(strippingNewline: true) {
    print(ShareInbox.isValidID(line) ? "1" : "0")
}
