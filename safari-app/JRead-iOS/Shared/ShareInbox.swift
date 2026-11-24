//
//  ShareInbox.swift
//  JRead
//
//  v3.2.0：Safari 分享面板「JRead」的 payload 收件匣（App Group 內的 share-inbox/ 資料夾）。
//  為什麼要收件匣：Safari 只等分享擴充的前置 JS 約 1～2.5 秒（模擬器實測，超過就交出空值），
//  長文光進閱讀模式就超過。所以前置 JS 只帶回請求 id，內容由頁面上的 JRead 抽完後經
//  background → sendNativeMessage → SafariWebExtensionHandler 寫進這裡，分享擴充依 id 取件。
//  寫入端：JRead Extension（SafariWebExtensionHandler）；讀取端：JRead Share（ShareViewController）。
//  兩個 target 都編這一份（同一份事實不分兩條 path）。
//

import Foundation

enum ShareInbox {
    static let folderName = "share-inbox"
    /// 單筆上限：翻譯頁 payload 實測數十～數百 KB（圖片內嵌在分享擴充送出時才做），留足餘裕
    static let maxBytes = 16 * 1024 * 1024
    /// 沒人取的件（網站偽造請求、分享被中途取消）超過這個時間就清掉
    static let staleAfter: TimeInterval = 10 * 60

    /// 請求 id 格式（與 content/main.js SHARE_REQUEST_ID_RE、lib/app-sync.js SHARE_ID_RE 一致）
    static func isValidID(_ id: String) -> Bool {
        let n = id.utf8.count
        guard n >= 8, n <= 64 else { return false }
        return id.unicodeScalars.allSatisfy { c in
            (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "_" || c == "-"
        }
    }

    static func folderURL() -> URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppSyncStore.appGroup)
        else { return nil }
        let dir = base.appendingPathComponent(folderName, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func fileURL(_ id: String) -> URL? {
        guard isValidID(id) else { return nil }
        return folderURL()?.appendingPathComponent(id + ".json")
    }

    /// 寫入一件（result＝content 抽好的 JSON 字串）。回 false＝id 不合法 / 太大 / 寫入失敗
    @discardableResult
    static func put(id: String, result: String) -> Bool {
        sweep()
        let data = Data(result.utf8)
        guard data.count <= maxBytes, let url = fileURL(id) else { return false }
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var u = url
            try? u.setResourceValues(values)
            return true
        } catch {
            return false
        }
    }

    /// 取件：讀到就刪掉（一件只取一次）
    static func take(id: String) -> String? {
        guard let url = fileURL(id), let data = try? Data(contentsOf: url) else { return nil }
        try? FileManager.default.removeItem(at: url)
        return String(data: data, encoding: .utf8)
    }

    /// 清掉過期的件
    static func sweep(now: Date = Date()) {
        guard let dir = folderURL(),
              let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])
        else { return }
        for f in files {
            let mod = (try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if now.timeIntervalSince(mod) > staleAfter { try? FileManager.default.removeItem(at: f) }
        }
    }
}
