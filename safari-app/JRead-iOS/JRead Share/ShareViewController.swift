//
//  ShareViewController.swift
//  JRead Share
//
//  v3.2.0：Safari 分享面板「JRead」——把目前頁面送到稍後閱讀服務（Jimmy 2026-11-25 需求）。
//  只收 Safari 網頁（啟用條件 NSExtensionActivationSupportsWebPageWithMaxCount），不做「只送網址」：
//  要存的是使用者眼前這頁（翻譯後的譯文、編輯模式移除的段落），網址交給服務端自己抓就做不到。
//
//  流程：
//  1. Safari 在頁面裡跑 preprocess.js，向頁面上的 JRead content script 要 extractReaderPayload 的結果
//  2. 本檔收到結果，在看不見的 WKWebView 以 jread-app:// 載入擴充的 reader/share-send.html
//     （注入與 App 同一份 jreader-app-shim.js，storage.sync＝App Group 鏡像、跨來源 fetch＝URLSession）
//  3. share-send.js 走 popup-core.saveDocumentFlow 送出（與懸浮按鈕「送到…」同一條流程）
//  4. 成功顯示結果約 1 秒自動關閉；失敗留著訊息，按「關閉」才關（Jimmy 裁定：一點就送、不選資料夾）
//  頁面事件網站也能偽造，所以憑證與送出都留在這一側，content script 只交內容
//

import UIKit
import WebKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandlerWithReply, WKScriptMessageHandler {

    static let sendPageURL = URL(string: "jread-app://app/reader/share-send.html")!
    static let successDismissDelay: TimeInterval = 1.0

    /// preprocess.js / content script 回報的失敗原因 → 卡片文字（UI 文字段末不加句號，硬規則 7）
    static func failureMessage(reason: String, detail: String? = nil) -> String {
        switch reason {
        case "NO_JREAD": return "這個網頁沒有執行 JRead，請在 Safari 允許 JRead 存取此網站後重新整理再試"
        case "TIMEOUT": return "讀取頁面內容逾時，請再試一次"
        case "BUSY": return "上一次分享還在處理，請稍後再試"
        case "NOT_APPLICABLE_IN_CINEMA": return "影院模式無法送出"
        case "NO_ARTICLE", "NOT_ACTIVE": return "此頁無法偵測主文，無法送出"
        case "NO_INPUT": return "沒有收到網頁內容，請從 Safari 分享"
        default:
            if let detail, !detail.isEmpty { return "讀取頁面內容失敗（\(detail)）" }
            return "讀取頁面內容失敗"
        }
    }

    private let schemeHandler = ExtensionResourceSchemeHandler()
    private var webView: WKWebView?
    private var payloadJSON: String?
    private var finished = false

    private let card = UIView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let label = UILabel()
    private let closeButton = UIButton(type: .system)

    // MARK: - UI

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.25)

        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .body)
        label.textColor = .label

        closeButton.setTitle("關閉", for: .normal)
        closeButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        closeButton.isHidden = true
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        spinner.startAnimating()
        let stack = UIStackView(arrangedSubviews: [spinner, label, closeButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 280),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20)
        ])

        showProgress("讀取頁面內容…")
        loadInput()
    }

    private func showProgress(_ text: String) {
        guard !finished else { return }
        label.text = text
    }

    private func finish(ok: Bool, message: String) {
        guard !finished else { return }
        finished = true
        spinner.stopAnimating()
        spinner.isHidden = true
        label.text = message
        tearDownWebView()
        if ok {
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.successDismissDelay) { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        } else {
            closeButton.isHidden = false
        }
    }

    @objc private func closeTapped() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    // MARK: - 1. 前置 JS 的結果 → 收件匣取件

    private func loadInput() {
        let type = UTType.propertyList.identifier
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        guard let provider = items.flatMap({ $0.attachments ?? [] }).first(where: { $0.hasItemConformingToTypeIdentifier(type) }) else {
            finish(ok: false, message: Self.failureMessage(reason: "NO_INPUT"))
            return
        }
        provider.loadItem(forTypeIdentifier: type, options: nil) { @Sendable [weak self] obj, _ in
            // 在背景 queue 回呼：先攤成 JSON Data（Sendable）再回主執行緒
            let data = Self.preprocessResults(obj)
            DispatchQueue.main.async { self?.handlePreprocess(data) }
        }
    }

    /// loadItem 交來的東西 → 前置 JS 結果字典的 JSON。系統交來的可能是字典，也可能是
    /// NSKeyedArchiver 封存的 Data（模擬器 iOS 26 實測兩種都會出現）；前置 JS 逾時被 Safari
    /// 放棄時封存的根物件是 $null（→ nil）
    nonisolated static func preprocessResults(_ obj: NSSecureCoding?) -> Data? {
        var root: Any? = obj
        if let raw = obj as? Data {
            root = (try? NSKeyedUnarchiver.unarchivedObject(
                ofClasses: [NSDictionary.self, NSArray.self, NSString.self, NSNumber.self, NSNull.self], from: raw))
                ?? (try? PropertyListSerialization.propertyList(from: raw, options: [], format: nil))
        }
        guard let dict = root as? NSDictionary,
              let results = dict[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary,
              JSONSerialization.isValidJSONObject(results) else { return nil }
        return try? JSONSerialization.data(withJSONObject: results)
    }

    private func handlePreprocess(_ data: Data?) {
        guard let data, let results = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            finish(ok: false, message: Self.failureMessage(reason: "NO_INPUT"))
            return
        }
        if let error = results["error"] as? String {
            finish(ok: false, message: Self.failureMessage(reason: error))
            return
        }
        guard let id = results["requestId"] as? String, ShareInbox.isValidID(id) else {
            finish(ok: false, message: Self.failureMessage(reason: "NO_INPUT"))
            return
        }
        waitForInbox(id: id, deadline: Date().addingTimeInterval(Self.inboxTimeout))
    }

    /// 頁面上的 JRead 抽完內容 → background → 原生 handler 寫進收件匣，這裡輪詢取件
    static let inboxTimeout: TimeInterval = 30
    static let inboxPollInterval: TimeInterval = 0.25

    private func waitForInbox(id: String, deadline: Date) {
        guard !finished else { return }
        if let raw = ShareInbox.take(id: id) {
            handleExtracted(raw)
            return
        }
        if Date() > deadline {
            finish(ok: false, message: Self.failureMessage(reason: "TIMEOUT"))
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.inboxPollInterval) { [weak self] in
            self?.waitForInbox(id: id, deadline: deadline)
        }
    }

    private func handleExtracted(_ raw: String) {
        guard let result = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else {
            finish(ok: false, message: Self.failureMessage(reason: "ERROR"))
            return
        }
        guard (result["ok"] as? Bool) == true, let payload = result["payload"] as? [String: Any],
              let payloadData = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: payloadData, encoding: .utf8) else {
            finish(ok: false, message: Self.failureMessage(reason: (result["reason"] as? String) ?? "ERROR",
                                                           detail: result["detail"] as? String))
            return
        }
        payloadJSON = json
        startSend()
    }

    // MARK: - 2. 看不見的送出頁

    private func startSend() {
        showProgress("送出中…")
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: JReadHostBridge.scheme)
        let ucc = config.userContentController
        ucc.addScriptMessageHandler(self, contentWorld: .page, name: "jread")
        ucc.add(self, contentWorld: .page, name: "jreadShare")
        ucc.addUserScript(WKUserScript(source: ExtensionResourceSchemeHandler.manifestScript(),
                                       injectionTime: .atDocumentStart, forMainFrameOnly: false))
        if let shim = ExtensionResourceSchemeHandler.shimSource {
            ucc.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }
        // 放進畫面但幾乎透明：完全隱藏 / 不在 view 階層的 WKWebView 可能被降速
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 2, height: 2), configuration: config)
        wv.alpha = 0.01
        wv.isUserInteractionEnabled = false
        wv.navigationDelegate = self
        view.insertSubview(wv, at: 0)
        webView = wv
        wv.load(URLRequest(url: Self.sendPageURL))
    }

    private func tearDownWebView() {
        guard let wv = webView else { return }
        wv.configuration.userContentController.removeAllScriptMessageHandlers()
        wv.navigationDelegate = nil
        wv.removeFromSuperview()
        webView = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url == Self.sendPageURL, let json = payloadJSON else { return }
        webView.callAsyncJavaScript("return await window.__jreadShareSend(JSON.parse(p));",
                                    arguments: ["p": json], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let value):
                let obj = value as? [String: Any]
                let ok = (obj?["ok"] as? Bool) == true
                let message = (obj?["message"] as? String) ?? (ok ? "已送出" : "送出失敗")
                self.finish(ok: ok, message: message)
            case .failure(let error):
                self.finish(ok: false, message: "送出失敗（\(error.localizedDescription)）")
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(ok: false, message: "送出失敗（\(error.localizedDescription)）")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(ok: false, message: "送出失敗（\(error.localizedDescription)）")
    }

    // MARK: - 3. bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard JReadHostBridge.isTrusted(message),
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "bad request")
            return
        }
        // shim 會呼叫的 App 專屬 op（chromeColor / statusBar）在分享擴充沒有意義，回空物件
        if !JReadHostBridge.handleCommon(op: op, body: body, reply: { replyHandler($0, nil) }) {
            replyHandler("{}", nil)
        }
    }

    /// share-send.js 的進度回報（SAVE_PROGRESS 文字）
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard JReadHostBridge.isTrusted(message), let body = message.body as? [String: Any],
              (body["type"] as? String) == "progress", let text = body["text"] as? String, !text.isEmpty else { return }
        showProgress(text)
    }
}
