//
//  ViewController.swift
//  JRead
//
//  Created by Jimmy Su on 2026/6/5.
//
//  v2.2.0：App 內建 JReader。
//  - 首次開啟顯示 Main.html（擴充啟用說明 + 「啟用 JReader」按鈕）；按下後記住，之後開 App 直接進 JReader
//  - JReader = 擴充同一份 reader/reader.html、article.html，經 jread-app:// scheme 直接讀
//    App bundle 裡 JRead Extension.appex 的 Resources（不另存一份，單一資料源）
//  - 頁面呼叫的擴充 API 由 Resources/jreader-app-shim.js 替身，背後走本檔的 "jread" bridge：
//    storage.sync ↔ AppSyncStore（App Group 鏡像，與 Safari 擴充同步）、storage.local ↔ App 自己的檔案、
//    跨來源 fetch → URLSession
//

import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {

    @IBOutlet var webView: WKWebView!

    static let scheme = "jread-app"
    static let readerURL = URL(string: "jread-app://app/reader/reader.html")!
    private static let enabledKey = "jreaderEnabled"
    private static let enableActionURL = "jread-action:enable-jreader"

    private let schemeHandler = ExtensionResourceSchemeHandler()

    // v2.2.4：頂端安全區域色帶（狀態列底下 / 隱藏時保留的那條），跟頁面頂端一樣分三段：
    // 兩側＝頁面底色、中段＝卡片色（shim sampleTopBand 回報）。iPad 翻頁卡片不滿版，
    // 只填單一色會在左右兩側露出不同色（Jimmy 2026-10-28 回報 v2.2.3）
    private let topBand = UIView()
    private let topBandCenter = UIView()
    private var topBandSpan: (left: CGFloat, right: CGFloat) = (0, 0)

    override func viewDidLoad() {
        super.viewDidLoad()

        // storyboard 的 WKWebView 建立時 configuration 已定型、加不了 scheme handler → 換成程式建的
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: Self.scheme)
        let ucc = config.userContentController
        ucc.addScriptMessageHandler(self, contentWorld: .page, name: "jread")
        ucc.addUserScript(WKUserScript(source: manifestScript(), injectionTime: .atDocumentStart, forMainFrameOnly: false))
        if let shim = Bundle.main.url(forResource: "jreader-app-shim", withExtension: "js"),
           let src = try? String(contentsOf: shim, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }

        let old = webView
        let wv = WKWebView(frame: view.bounds, configuration: config)
        wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        wv.navigationDelegate = self
        wv.uiDelegate = self
        old?.removeFromSuperview()
        view.addSubview(wv)
        webView = wv

        topBand.isHidden = true
        topBand.isUserInteractionEnabled = false
        topBand.addSubview(topBandCenter)
        view.addSubview(topBand)

        // 左緣滑動返回文章列表在頁面內處理（jreader-app-shim.js installEdgeBack）：翻頁模式的
        // touchmove 會 preventDefault，WKWebView 因此把原生手勢（含 allowsBackForwardNavigationGestures、
        // 自掛的 UIScreenEdgePanGestureRecognizer）全讓給頁面，原生這層收不到（v2.2.1 模擬器實證）

        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground),
                                               name: UIApplication.willEnterForegroundNotification, object: nil)

        if UserDefaults.standard.bool(forKey: Self.enabledKey) {
            openReader()
        } else {
            openIntro()
        }
    }

    private func openIntro() {
        webView.scrollView.isScrollEnabled = false
        webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    private func openReader() {
        webView.scrollView.isScrollEnabled = true
        webView.load(URLRequest(url: Self.readerURL))
    }

    // v2.2.1：狀態列與 Home 指示條那兩條安全區域用頁面頂端的實際底色填（shim 回報），
    // 不然翻頁模式下會露出 WebView 預設的黑 / 白底
    private func applyChromeColor(_ body: [String: Any]) {
        guard let color = Self.parseCSSColor((body["color"] as? String) ?? "") else { return }
        webView.underPageBackgroundColor = color
        webView.backgroundColor = color
        webView.scrollView.backgroundColor = color
        view.backgroundColor = color
        let side = Self.parseCSSColor((body["side"] as? String) ?? "") ?? color
        let left = CGFloat((body["left"] as? Double) ?? 0)
        let right = CGFloat((body["right"] as? Double) ?? Double(view.bounds.width))
        topBand.backgroundColor = side
        topBandCenter.backgroundColor = color
        topBandSpan = (left, right)
        topBand.isHidden = false
        layoutTopBand()
    }

    private func layoutTopBand() {
        topBand.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: view.safeAreaInsets.top)
        topBandCenter.frame = CGRect(x: topBandSpan.left, y: 0,
                                     width: max(0, topBandSpan.right - topBandSpan.left), height: topBand.bounds.height)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutTopBand()
    }

    // v2.2.2：Article View 沉浸閱讀，狀態列預設藏、點一下切換（shim installImmersive 回報）；
    // 列表頁 pageshow 時回報 false 叫回來
    private var statusBarHidden = false
    override var prefersStatusBarHidden: Bool { statusBarHidden }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    // v2.2.3：iPad（與無瀏海機型）的頂端安全區域就是狀態列本身，藏掉會從 32pt 縮成 0
    // （模擬器實測 iPad Pro 11"）→ WebView 可視高度變 → resize → 翻頁重新排版。
    // 狀態列隱藏時用 additionalSafeAreaInsets 補回縮掉的量，WebView 看到的安全區域恆定。
    // 有瀏海的 iPhone 安全區域不受狀態列影響，補 0。依方向記（iPhone 橫向本來就沒有狀態列）。
    private var shownTopInsets: [Bool: CGFloat] = [:]

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        let landscape = view.bounds.width > view.bounds.height
        let system = view.safeAreaInsets.top - additionalSafeAreaInsets.top
        if !statusBarHidden { shownTopInsets[landscape] = system }
        let extra = statusBarHidden ? max(0, (shownTopInsets[landscape] ?? system) - system) : 0
        if additionalSafeAreaInsets.top != extra { additionalSafeAreaInsets.top = extra }
    }

    private func setStatusBarHidden(_ hidden: Bool) {
        guard hidden != statusBarHidden else { return }
        statusBarHidden = hidden
        UIView.animate(withDuration: 0.2) { self.setNeedsStatusBarAppearanceUpdate() }
    }

    // "rgb(r, g, b)" / "rgba(r, g, b, a)"（getComputedStyle 的輸出格式）
    static func parseCSSColor(_ css: String) -> UIColor? {
        let nums = css.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted)
            .compactMap { Double($0) }
        guard css.hasPrefix("rgb"), nums.count >= 3 else { return nil }
        let a = nums.count >= 4 ? nums[3] : 1
        return UIColor(red: nums[0] / 255, green: nums[1] / 255, blue: nums[2] / 255, alpha: a)
    }

    @objc private func willEnterForeground() {
        webView.evaluateJavaScript("window.__jreadApp && window.__jreadApp.onForeground()", completionHandler: nil)
    }

    // 頁面內 runtime.getManifest() 同步回傳，manifest 內容在注入時就先放好
    private func manifestScript() -> String {
        var json = "{}"
        if let url = ExtensionResourceSchemeHandler.resourcesURL?.appendingPathComponent("manifest.json"),
           let data = try? Data(contentsOf: url), let s = String(data: data, encoding: .utf8) {
            json = s
        }
        return "if (location.protocol === 'jread-app:') { window.__JREAD_APP_MANIFEST = \(json); }"
    }

    // MARK: - 導航

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        if url.absoluteString == Self.enableActionURL {
            UserDefaults.standard.set(true, forKey: Self.enabledKey)
            decisionHandler(.cancel)
            openReader()
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        // 文章裡的外部連結：主框架導向 http(s) / mailto 等一律交給系統（Safari）開，JReader 留在原頁
        if isMainFrame && scheme != Self.scheme && scheme != "file" && scheme != "about" {
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
            return
        }
        decisionHandler(.allow)
    }

    // target=_blank / window.open
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if url.scheme == Self.scheme { webView.load(URLRequest(url: url)) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    // MARK: - bridge（jreader-app-shim.js）

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard message.frameInfo.securityOrigin.protocol == Self.scheme,
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "bad request")
            return
        }
        switch op {
        case "syncLoad":
            replyHandler(jsonString(["entries": AppSyncStore.load()]), nil)
        case "syncPut":
            let raw = (body["entries"] as? String) ?? "{}"
            let incoming = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] ?? [:]
            replyHandler(jsonString(["entries": AppSyncStore.merge(incoming)]), nil)
        case "localLoad":
            replyHandler(jsonString(["items": LocalStore.load()]), nil)
        case "localPut":
            let raw = (body["items"] as? String) ?? "{}"
            let items = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: String] ?? [:]
            LocalStore.update(set: items, remove: (body["remove"] as? [String]) ?? [])
            replyHandler("{}", nil)
        case "chromeColor":
            if message.frameInfo.isMainFrame { applyChromeColor(body) }
            replyHandler("{}", nil)
        case "statusBar":
            if message.frameInfo.isMainFrame { setStatusBarHidden((body["hidden"] as? Bool) ?? false) }
            replyHandler("{}", nil)
        case "fetch":
            NativeFetch.perform(body) { result in replyHandler(result, nil) }
        default:
            replyHandler(nil, "unknown op")
        }
    }

    private func jsonString(_ obj: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }
}

// MARK: - jread-app:// → JRead Extension.appex/ 的檔案

final class ExtensionResourceSchemeHandler: NSObject, WKURLSchemeHandler {
    static var resourcesURL: URL? {
        Bundle.main.builtInPlugInsURL?.appendingPathComponent("JRead Extension.appex", isDirectory: true)
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
        "svg": "image/svg+xml", "ico": "image/x-icon", "woff2": "font/woff2", "woff": "font/woff",
        "ttf": "font/ttf", "txt": "text/plain"
    ]

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
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": mime, "Content-Length": String(data.count)])!
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
