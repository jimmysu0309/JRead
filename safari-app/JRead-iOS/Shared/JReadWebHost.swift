//
//  JReadWebHost.swift
//  JRead
//
//  v3.2.0：從 ViewController.swift 搬出，App（內建 JReader）與分享擴充（JRead Share）共用——
//  兩邊都用 WKWebView 以 jread-app:// 載入擴充同一份頁面、注入同一份 jreader-app-shim.js，
//  背後的檔案讀取、storage、跨來源 fetch 只有這一份實作（同一份事實不分兩條 path）
//

import UIKit
import WebKit

// MARK: - bridge 共用 op（syncLoad / syncPut / localLoad / localPut / fetch）

enum JReadHostBridge {
    static let scheme = "jread-app"
    static let appHost = "app"

    /// 來源檢查：只收 jread-app://app 的 frame（E-03：host 一起比）
    static func isTrusted(_ message: WKScriptMessage) -> Bool {
        message.frameInfo.securityOrigin.protocol == scheme && message.frameInfo.securityOrigin.host == appHost
    }

    /// 處理兩邊共用的 op；回 false＝不認得，呼叫端自己處理（App 的 chromeColor / statusBar）
    static func handleCommon(op: String, body: [String: Any], reply: @escaping @MainActor (String) -> Void) -> Bool {
        switch op {
        case "syncLoad":
            reply(jsonString(["entries": AppSyncStore.load()]))
        case "syncPut":
            let raw = (body["entries"] as? String) ?? "{}"
            let incoming = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] ?? [:]
            reply(jsonString(["entries": AppSyncStore.merge(incoming)]))
        case "localLoad":
            reply(jsonString(["items": LocalStore.load()]))
        case "localPut":
            let raw = (body["items"] as? String) ?? "{}"
            let items = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: String] ?? [:]
            LocalStore.update(set: items, remove: (body["remove"] as? [String]) ?? [])
            reply("{}")
        case "fetch":
            NativeFetch.perform(body) { result in reply(result) }
        default:
            return false
        }
        return true
    }

    static func jsonString(_ obj: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }
}

// MARK: - jread-app:// → JRead Extension.appex/ 的檔案

final class ExtensionResourceSchemeHandler: NSObject, WKURLSchemeHandler {
    /// 宿主 App 的 bundle。App 本體＝Bundle.main；分享擴充（v3.2.0）跑在
    /// JRead.app/PlugIns/JRead Share.appex，往上兩層才是 App
    static var appBundleURL: URL {
        let main = Bundle.main.bundleURL
        return main.pathExtension == "appex" ? main.deletingLastPathComponent().deletingLastPathComponent() : main
    }

    static var resourcesURL: URL? {
        appBundleURL.appendingPathComponent("PlugIns/JRead Extension.appex", isDirectory: true)
    }

    /// 擴充 API 替身（App target 的 Resources/jreader-app-shim.js），App 與分享擴充共用
    static var shimSource: String? {
        try? String(contentsOf: appBundleURL.appendingPathComponent("jreader-app-shim.js"), encoding: .utf8)
    }

    /// 頁面內 runtime.getManifest() 同步回傳，manifest 內容在注入時就先放好
    static func manifestScript() -> String {
        var json = "{}"
        if let url = resourcesURL?.appendingPathComponent("manifest.json"),
           let data = try? Data(contentsOf: url), let s = String(data: data, encoding: .utf8) {
            json = s
        }
        return "if (location.protocol === 'jread-app:') { window.__JREAD_APP_MANIFEST = \(json); }"
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
        "svg": "image/svg+xml", "ico": "image/x-icon", "woff2": "font/woff2", "woff": "font/woff",
        "ttf": "font/ttf", "txt": "text/plain"
    ]

    static let htmlCSP = "script-src 'self'; object-src 'none'"

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, let root = Self.resourcesURL?.standardizedFileURL else {
            urlSchemeTask.didFailWithError(URLError(.badURL)); return
        }
        let rel = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        let file = root.appendingPathComponent(rel).standardizedFileURL
        // 擋 ../ 跳出 appex 目錄
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            let resp = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            urlSchemeTask.didReceive(resp)
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
            return
        }
        var mime = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        if mime.hasPrefix("text/") || mime == "application/json" { mime += "; charset=utf-8" }
        var headers = ["Content-Type": mime, "Content-Length": String(data.count)]
        // v2.4.11（2026-11-15 review D-01）：html 回應補 CSP 兜底。擴充頁有 MV3 預設 CSP
        //（script-src 'self'）擋 inline handler；同一份 reader/article.html 以 jread-app://
        // 載入時自訂 scheme 沒有預設 CSP，sanitizer 一有缺口就是直接執行（頁面拿得到
        // App Group 鏡像裡的憑證與原生 fetch 橋）。內容與擴充頁預設值對齊：只收同源
        // script、不收 inline / eval、不收 plugin。WKUserScript 注入的 shim 不受頁面 CSP 限制
        if mime.hasPrefix("text/html") {
            headers["Content-Security-Policy"] = Self.htmlCSP
        }
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

// MARK: - storage.local（App 自己的，不跟擴充同步：閱讀位置、feed 快取、這台裝置套用的設定檔）

nonisolated enum LocalStore {
    private static var fileURL: URL? {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let dir else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("jread-local.json")
    }

    /// key → 值的 JSON 字串
    static func load() -> [String: String] {
        guard let url = fileURL, let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return [:] }
        return obj
    }

    static func update(set: [String: String], remove: [String]) {
        var cur = load()
        for (k, v) in set { cur[k] = v }
        for k in remove { cur.removeValue(forKey: k) }
        guard let url = fileURL, let data = try? JSONSerialization.data(withJSONObject: cur) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

// MARK: - 跨來源 fetch（Instapaper API 不開 CORS，網頁端直接打會被擋）

nonisolated enum NativeFetch {
    @MainActor static func perform(_ body: [String: Any], completion: @escaping @MainActor (String) -> Void) {
        guard let s = body["url"] as? String, let url = URL(string: s),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            completion(encode(["error": "bad url"])); return
        }
        var req = URLRequest(url: url, timeoutInterval: 60)
        req.httpMethod = (body["method"] as? String) ?? "GET"
        for (k, v) in (body["headers"] as? [String: String]) ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
        if let b = body["body"] as? String { req.httpBody = Data(b.utf8) }
        URLSession.shared.dataTask(with: req) { data, response, error in
            let out: String
            if let error {
                out = encode(["error": error.localizedDescription])
            } else if let http = response as? HTTPURLResponse {
                var headers: [String: String] = [:]
                for (k, v) in http.allHeaderFields { headers[String(describing: k)] = String(describing: v) }
                out = encode([
                    "status": http.statusCode,
                    "statusText": HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                    "headers": headers,
                    "url": http.url?.absoluteString ?? s,
                    "bodyB64": (data ?? Data()).base64EncodedString()
                ])
            } else {
                out = encode(["error": "no response"])
            }
            Task { @MainActor in completion(out) }
        }.resume()
    }

    private static func encode(_ obj: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: data, encoding: .utf8) else { return "{\"error\":\"encode\"}" }
        return s
    }
}
