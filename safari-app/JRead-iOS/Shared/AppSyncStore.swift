//
//  AppSyncStore.swift
//  JRead（App 與 JRead Extension 兩個 target 共用）
//
//  App 內 JReader 與 Safari 擴充的 storage.sync 共用鏡像（v2.2.0）。
//  住在 App Group 容器內一份 JSON 檔，格式：
//    { "<key>": { "vj": "<值的 JSON 字串>", "ts": <毫秒>, "del": true? } }
//  合併規則（逐鍵 last-writer-wins）只住這裡：App 端（ViewController 的 storage bridge）
//  與擴充端（SafariWebExtensionHandler 收 lib/app-sync.js 的 sendNativeMessage）都呼叫 merge。
//  值用 JSON 字串存：sendNativeMessage 經 property list 轉送時布林會變數字，字串不會走樣。
//

import Foundation

enum AppSyncStore {
    static let appGroup = "group.app.jread.ios"
    static let fileName = "jread-sync.json"

    static func fileURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }

    static func load() -> [String: [String: Any]] {
        guard let url = fileURL() else { return [:] }
        var result: [String: [String: Any]] = [:]
        coordinate(url, writing: false) { readURL in
            result = read(readURL)
        }
        return result
    }

    /// 單一鍵的合併決策（純函式）：回傳要寫入的 ts，nil＝拒絕這筆。
    ///
    /// 一般情況逐鍵 last-writer-wins：incoming 的 ts 比現有的新才收。
    ///
    /// v2.5.4（2026-11-15 review E-10）時鐘回調：現有那筆的 ts 比「現在」還晚，只可能是
    /// 寫入之後裝置時鐘被往回調（App 與擴充在同一台裝置、共用同一個時鐘，沒有別的來源會
    /// 寫出未來的 ts）。舊版這時一律拒絕——時鐘追上那個 ts 之前，這個鍵的任何新寫入都被
    /// 靜默丟掉，App 端畫面改了、回前景重讀鏡像又跳回舊值。改成收下，ts 取「現有 + 1」：
    ///   - 不能改成 now：擴充端的 meta 已記到現有那個較大的 ts，鏡像 ts 變小的話它的
    ///     planPull 會跳過這筆、planReconcile 還會把自己的舊值以 ts=now 推回來蓋掉新值。
    ///   - 只在「現有 ts > now」才墊高，不是任何被拒的寫入都墊：正常時鐘下被拒的是
    ///     「戳記較早、較晚才送達」的寫入（例如擴充 onChanged 的推送晚於 App 之後的修改），
    ///     那種要維持拒絕，否則舊值會蓋掉對端較新的值。
    /// 已知殘留：時鐘回調期間同一鍵的兩端寫入若亂序送達，後到的會贏（無法從 ts 分辨）。
    static func acceptedTs(incoming ts: Double, current curTs: Double, now: Double) -> Double? {
        if ts > curTs { return ts }
        if curTs > now { return curTs + 1 }
        return nil
    }

    static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

    /// incoming 逐鍵過 acceptedTs，收下的才寫入；回傳合併後的全量。
    @discardableResult
    static func merge(_ incoming: [String: Any]) -> [String: [String: Any]] {
        guard let url = fileURL() else { return [:] }
        var result: [String: [String: Any]] = [:]
        coordinate(url, writing: true) { writeURL in
            var cur = read(writeURL)
            var changed = false
            let now = nowMs()
            for (key, raw) in incoming {
                guard var entry = sanitize(raw) else { continue }
                let ts = (entry["ts"] as? Double) ?? 0
                let curTs = (cur[key]?["ts"] as? NSNumber)?.doubleValue ?? -1
                if let accepted = acceptedTs(incoming: ts, current: curTs, now: now) {
                    entry["ts"] = accepted
                    cur[key] = entry
                    changed = true
                }
            }
            if changed, let data = try? JSONSerialization.data(withJSONObject: cur) {
                try? data.write(to: writeURL, options: .atomic)
                excludeFromBackup(writeURL)
            }
            result = cur
        }
        return result
    }

    /// v2.5.4（2026-11-15 review E-04）：鏡像內含 Readwise / Instapaper 憑證，不進 iCloud /
    /// 電腦備份與換機轉移。`.atomic` 寫入每次都是換一個新檔，這個屬性會跟著消失，所以每次
    /// 寫完都要重設。
    ///
    /// 檔案保護等級**刻意維持系統預設**（completeUntilFirstUserAuthentication：關機到第一次
    /// 解鎖前已加密），沒有照 review 建議升到 completeUnlessOpen：鎖定後既有檔案無法開啟
    /// 讀取、但仍可建立新檔，而本檔與 LocalStore 都是「整檔讀 → 改 → 整檔寫」且讀失敗當成
    /// 空的——鎖定瞬間剛好有寫入（位置記憶在頁面 hidden 時 flush、擴充 background 的推送）
    /// 就會用「只含這一筆」的新檔蓋掉整份鏡像。模擬器不實作檔案保護，這條路無法自驗。
    private static func excludeFromBackup(_ url: URL) {
        var u = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? u.setResourceValues(values)
    }

    /// 全量 entries 序列化成 JSON 字串（回給 JS 端用，避免 property list 轉型）。
    static func json(_ entries: [String: [String: Any]]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: entries),
              let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }

    // 只收 { vj: String, ts: Number } 或 { del: true, ts: Number }，其餘欄位丟掉
    private static func sanitize(_ raw: Any) -> [String: Any]? {
        guard let e = raw as? [String: Any],
              let ts = (e["ts"] as? NSNumber)?.doubleValue, ts.isFinite else { return nil }
        if let del = e["del"] as? NSNumber, del.boolValue {
            return ["del": true, "ts": ts]
        }
        guard let vj = e["vj"] as? String else { return nil }
        return ["vj": vj, "ts": ts]
    }

    private static func read(_ url: URL) -> [String: [String: Any]] {
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else { return [:] }
        return obj
    }

    // App 與擴充是兩個 process，同時寫同一份檔要經 NSFileCoordinator 排隊
    private static func coordinate(_ url: URL, writing: Bool, _ body: (URL) -> Void) {
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var error: NSError?
        if writing {
            coordinator.coordinate(writingItemAt: url, options: .forMerging, error: &error, byAccessor: body)
        } else {
            coordinator.coordinate(readingItemAt: url, options: [], error: &error, byAccessor: body)
        }
        if error != nil { body(url) }
    }
}
