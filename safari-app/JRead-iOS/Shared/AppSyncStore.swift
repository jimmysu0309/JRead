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

    /// incoming 逐鍵比 ts，較新的才寫入；回傳合併後的全量。
    @discardableResult
    static func merge(_ incoming: [String: Any]) -> [String: [String: Any]] {
        guard let url = fileURL() else { return [:] }
        var result: [String: [String: Any]] = [:]
        coordinate(url, writing: true) { writeURL in
            var cur = read(writeURL)
            var changed = false
            for (key, raw) in incoming {
                guard let entry = sanitize(raw) else { continue }
                let ts = (entry["ts"] as? Double) ?? 0
                let curTs = (cur[key]?["ts"] as? NSNumber)?.doubleValue ?? -1
                if ts > curTs {
                    cur[key] = entry
                    changed = true
                }
            }
            if changed, let data = try? JSONSerialization.data(withJSONObject: cur) {
                try? data.write(to: writeURL, options: .atomic)
            }
            result = cur
        }
        return result
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
