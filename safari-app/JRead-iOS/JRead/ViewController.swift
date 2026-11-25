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
    static let appHost = "app"
    static let readerURL = URL(string: "jread-app://app/reader/reader.html")!
    private static let enabledKey = "jreaderEnabled"
    private static let enableActionURL = "jread-action:enable-jreader"

    private let schemeHandler = ExtensionResourceSchemeHandler()

    // v2.2.13：文章列表下拉更新（Jimmy 2026-10-28：下拉沒有 loading 提示）。WKWebView 沒有
    // Safari 分頁那種原生下拉重整，掛 UIRefreshControl，只在 feed 頁（reader.html）掛；
    // 放手後呼叫頁面 __JReadReaderFeed.refreshCurrent()，等新清單回來才收起 spinner
    private let refreshControl = UIRefreshControl()
    private static let refreshTimeout: TimeInterval = 20

    // v2.2.4：頂端安全區域色帶（狀態列底下 / 隱藏時保留的那條），跟頁面頂端一樣分三段：
    // 兩側＝頁面底色、中段＝卡片色（shim sampleTopBand 回報）。iPad 翻頁卡片不滿版，
    // 只填單一色會在左右兩側露出不同色（Jimmy 2026-10-28 回報 v2.2.3）
    private let topBand = UIView()
    private let topBandCenter = UIView()
    private var topBandSpan: (left: CGFloat, right: CGFloat) = (0, 0)
    // v2.2.15：橫向左右安全區域（瀏海 / 動態島那側）也補色帶，填兩側色（side）。WebView 底色
    // 是卡片色（為了 Home 指示條那條），橫向時左右兩條露出卡片色，畫面變成「灰-黑-卡片-黑-灰」
    // （Jimmy 2026-10-29 回報）。頁面沒宣告 viewport-fit=cover，內容不畫進左右安全區域，蓋住不遮內容
    private let leftBand = UIView()
    private let rightBand = UIView()

    override func viewDidLoad() {
        super.viewDidLoad()

        // storyboard 的 WKWebView 建立時 configuration 已定型、加不了 scheme handler → 換成程式建的
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: Self.scheme)
        let ucc = config.userContentController
        ucc.addScriptMessageHandler(self, contentWorld: .page, name: "jread")
        installUserScripts(ucc)

        let old = webView
        let wv = WKWebView(frame: view.bounds, configuration: config)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        // v2.5.29：捲動檢視不自動把安全區域加進內距。預設行為下，文章頁（翻頁模式）一開始排在
        // 整個 WebView 高度上，手指上下滑一次之後系統才把底部安全區域（Home 指示條 34pt）補進
        // 捲動內距，頁面可視高度跟著縮 34pt → 翻頁重排、頁底少一行、頁數變多（Jimmy 2026-11-20
        // iPhone 回報；模擬器 iPhone 17 重現）。底部那一段本來就由 --__jread-app-safe-bottom
        // 補（pushSafeBottom），頂端由 WebView frame 避開，系統再補一次是重複。
        // 橫向左右安全區域不受影響（模擬器橫向前後對照卡片左右緣相同）
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        old?.removeFromSuperview()
        view.addSubview(wv)
        webView = wv

        refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)

        topBand.isHidden = true
        topBand.isUserInteractionEnabled = false
        topBand.addSubview(topBandCenter)
        view.addSubview(topBand)
        for band in [leftBand, rightBand] {
            band.isHidden = true
            band.isUserInteractionEnabled = false
            view.addSubview(band)
        }

        // 左緣滑動返回文章列表在頁面內處理（jreader-app-shim.js installEdgeBack）：翻頁模式的
        // touchmove 會 preventDefault，WKWebView 因此把原生手勢（含 allowsBackForwardNavigationGestures、
        // 自掛的 UIScreenEdgePanGestureRecognizer）全讓給頁面，原生這層收不到（v2.2.1 模擬器實證）

        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground),
                                               name: UIApplication.willEnterForegroundNotification, object: nil)
        // v2.2.13：設定頁「App 圖示」→ 每次 App 進入 active（含冷啟動）對一次鏡像
        NotificationCenter.default.addObserver(self, selector: #selector(didBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)

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
        leftBand.backgroundColor = side
        rightBand.backgroundColor = side
        leftBand.isHidden = false
        rightBand.isHidden = false
        layoutTopBand()
    }

    private func layoutTopBand() {
        // 色帶高度＝WebView 上緣（狀態列隱藏時那條保留區也要填色）
        topBand.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: webView.frame.minY)
        topBandCenter.frame = CGRect(x: topBandSpan.left, y: 0,
                                     width: max(0, topBandSpan.right - topBandSpan.left), height: topBand.bounds.height)
        let insets = view.safeAreaInsets
        leftBand.frame = CGRect(x: 0, y: 0, width: insets.left, height: view.bounds.height)
        rightBand.frame = CGRect(x: view.bounds.width - insets.right, y: 0, width: insets.right, height: view.bounds.height)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutWebView()
        layoutTopBand()
    }

    // v2.2.2：Article View 沉浸閱讀，狀態列預設藏、點一下切換（shim installImmersive 回報）；
    // 列表頁 pageshow 時回報 false 叫回來
    private var statusBarHidden = false
    override var prefersStatusBarHidden: Bool { statusBarHidden }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    // v2.2.16：WebView 上緣固定在「狀態列顯示時」的頂端安全區域下方，WebView 自己的頂端安全區域恆為 0。
    // iPad（與無瀏海機型）的頂端安全區域就是狀態列本身，藏掉會從 32pt 縮成 0。v2.2.3 用
    // additionalSafeAreaInsets 事後補回，但系統先送出 32→0、補完才回 32，WebView 中間被撐高一次
    // （iPad mini 模擬器 log 實證）；進文章時翻頁模組正在初始化，吃到撐高那次的高度排版，
    // 頁面上緣跑進狀態列區、點出狀態列再重排（Jimmy 2026-10-29 iPad mini 回報，11 頁 ↔ 12 頁）。
    // 改成不讓 WebView 碰到頂端安全區域，從源頭沒有瞬變。有瀏海的 iPhone 安全區域不受狀態列影響，
    // 上緣一樣固定。依方向記（iPhone 橫向本來就沒有狀態列）。
    private var shownTopInsets: [Bool: CGFloat] = [:]

    private func layoutWebView() {
        guard let wv = webView else { return }
        let landscape = view.bounds.width > view.bounds.height
        let system = view.safeAreaInsets.top
        if !statusBarHidden { shownTopInsets[landscape] = system }
        let top = statusBarHidden ? max(system, shownTopInsets[landscape] ?? system) : system
        let frame = CGRect(x: 0, y: top, width: view.bounds.width, height: max(0, view.bounds.height - top))
        if wv.frame != frame { wv.frame = frame }
        pushSafeBottom()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        view.setNeedsLayout()
    }

    // v2.2.16：頁面沒宣告 viewport-fit=cover，env(safe-area-inset-bottom) 恆為 0，但 WebView 畫到
    // Home 指示條底下 → 翻頁頁碼落在系統手勢區，點頁碼會叫出系統手勢（Jimmy 2026-10-29 iPhone 回報）。
    // 把底部安全區域傳給 shim，styler 以 --__jread-app-safe-bottom 補上（與 env 取大者）
    private var pushedSafeBottom: CGFloat = -1

    private func pushSafeBottom() {
        let bottom = view.safeAreaInsets.bottom
        guard bottom != pushedSafeBottom else { return }
        pushedSafeBottom = bottom
        installUserScripts(webView.configuration.userContentController)
        webView.evaluateJavaScript("window.__jreadApp && window.__jreadApp.setSafeBottom(\(Double(bottom)))", completionHandler: nil)
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

    @objc private func didBecomeActive() {
        AppIconSync.apply()
    }

    @objc private func willEnterForeground() {
        webView.evaluateJavaScript("window.__jreadApp && window.__jreadApp.onForeground()", completionHandler: nil)
    }

    // document-start 注入：manifest、底部安全區域初值、shim。底部安全區域變了就整組重裝，
    // 下一次載入的頁面一開始就拿到正確值（載入後才改會再觸發一次翻頁重排）
    private func installUserScripts(_ ucc: WKUserContentController) {
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: ExtensionResourceSchemeHandler.manifestScript(), injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let bottom = Double(max(0, pushedSafeBottom))
        ucc.addUserScript(WKUserScript(source: "if (location.protocol === 'jread-app:') { window.__JREAD_APP_SAFE_BOTTOM = \(bottom); }",
                                       injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let src = ExtensionResourceSchemeHandler.shimSource {
            ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }
    }

    // MARK: - 下拉更新（v2.2.13）

    private static func isFeedPage(_ url: URL?) -> Bool {
        url?.scheme == scheme && url?.path == "/reader/reader.html"
    }

    private func syncRefreshControl() {
        let want = Self.isFeedPage(webView.url)
        if want && webView.scrollView.refreshControl !== refreshControl {
            webView.scrollView.refreshControl = refreshControl
        } else if !want && webView.scrollView.refreshControl != nil {
            refreshControl.endRefreshing()
            webView.scrollView.refreshControl = nil
        }
    }

    @objc private func pullToRefresh() {
        guard Self.isFeedPage(webView.url) else { refreshControl.endRefreshing(); return }
        var done = false
        let finish = { [weak self] in
            guard !done else { return }
            done = true
            self?.refreshControl.endRefreshing()
        }
        // API 卡住也不能讓 spinner 永遠轉
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.refreshTimeout) { finish() }
        let js = "const f = window.__JReadReaderFeed && window.__JReadReaderFeed.refreshCurrent; if (f) { await f(); } return true;"
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { _ in finish() }
    }

    // 進 / 離 feed 頁都要切：commit 時就切（離開 feed 不讓文章頁還能下拉），finish 再保險一次
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        syncRefreshControl()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        syncRefreshControl()
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
        let userClicked = navigationAction.navigationType == .linkActivated
        // v2.4.11（2026-11-15 review E-03）：導覽改白名單。文章內容是遠端 HTML，href 只擋
        // javascript: / vbscript:——舊版對 jread-app:// 與 file: 一律放行、其餘 scheme 一律
        // 交給系統開：文章裡一個 `jread-app://app/options/options.html` 連結就能把 App 帶到
        // 完整設定頁（App 沒有導覽 UI，卡在裡面出不來），file: 同理，自訂 scheme 連結則會
        // 直接喚起別的 App。
        switch Self.navigationVerdict(scheme: scheme, host: url.host, path: url.path,
                                      isMainFrame: isMainFrame, userClicked: userClicked) {
        case .allow:
            decisionHandler(.allow)
        case .openExternally:
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
        case .block:
            decisionHandler(.cancel)
        }
    }

    enum NavigationVerdict { case allow, openExternally, block }

    // 純決策（不碰 WebKit 物件）：
    //   - jread-app：host 必須是 app；主框架只能到 reader/（feed 與文章），子框架另放行
    //     popup/（懸浮按鈕的功能選單 iframe）與 options/（J 選單「設定」的 iframe）。
    //     主框架仍不放行 options/：文章裡的連結不能把整個 App 帶進設定頁（沒有「完成」可回）
    //   - file / about：App 自己載入的說明頁與空白框架；使用者點連結過去的一律擋
    //   - 主框架的 http(s) / mailto：交給系統開，JReader 留在原頁；其餘 scheme 擋
    //   - 子框架的其他 scheme（文章 sanitizer 已移除 iframe，這裡只會是 App 自己的頁面）放行
    static func navigationVerdict(scheme: String, host: String?, path: String,
                                  isMainFrame: Bool, userClicked: Bool) -> NavigationVerdict {
        if scheme == Self.scheme {
            guard host == Self.appHost else { return .block }
            if path.hasPrefix("/reader/") { return .allow }
            if !isMainFrame && path.hasPrefix("/popup/") { return .allow }
            // v3.4.5：設定頁（J 選單「設定」以 iframe 開 options/options.html，v3.3.0）。v3.3.0 加入口時
            // 漏了這條，子框架被擋 → 設定頁整片空白（Jimmy 2026-11-25 iPhone 回報）
            if !isMainFrame && path.hasPrefix("/options/") { return .allow }
            return .block
        }
        if scheme == "file" || scheme == "about" { return userClicked ? .block : .allow }
        if !isMainFrame { return .allow }
        if scheme == "http" || scheme == "https" || scheme == "mailto" { return .openExternally }
        return .block
    }

    // target=_blank / window.open
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // E-03：與 decidePolicy 同一份白名單（target=_blank 一律視為主框架、使用者點擊）
        if let url = navigationAction.request.url {
            switch Self.navigationVerdict(scheme: url.scheme?.lowercased() ?? "", host: url.host, path: url.path,
                                          isMainFrame: true, userClicked: true) {
            case .allow: webView.load(URLRequest(url: url))
            case .openExternally: UIApplication.shared.open(url)
            case .block: break
            }
        }
        return nil
    }

    // MARK: - bridge（jreader-app-shim.js）

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        // E-03：來源檢查連 host 一起比（原本只比 protocol，jread-app://<任意 host> 也成立）
        guard JReadHostBridge.isTrusted(message),
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "bad request")
            return
        }
        // storage / fetch 這幾個 op 與分享擴充共用（Shared/JReadWebHost.swift）
        if JReadHostBridge.handleCommon(op: op, body: body, reply: { replyHandler($0, nil) }) { return }
        switch op {
        case "chromeColor":
            if message.frameInfo.isMainFrame { applyChromeColor(body) }
            replyHandler("{}", nil)
        case "statusBar":
            if message.frameInfo.isMainFrame { setStatusBarHidden((body["hidden"] as? Bool) ?? false) }
            replyHandler("{}", nil)
        default:
            replyHandler(nil, "unknown op")
        }
    }
}

// MARK: - App 圖示（v2.2.13，設定頁「App 圖示」）

// 設定值住 storage.sync 的 appIcon（擴充設定頁寫入 → lib/app-sync.js 推進 App Group 鏡像），
// App 進入 active 時讀鏡像、跟目前圖示不同才換。iOS 只允許 App 本體在前景呼叫
// setAlternateIconName（擴充做不到），換的時候系統會跳「已更改圖示」提示、無法關閉。
// 值 → 替代圖示名稱的對照表要跟 jread/content/settings-defaults.js 的 APP_ICONS 同步；
// 替代圖示要在 build setting ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES 登記。
enum AppIconSync {
    static let key = "appIcon"
    static let alternateNames: [String: String] = ["white": "AppIcon-White"]

    /// 鏡像裡的 appIcon 值 → 要套用的替代圖示名稱（nil = 主圖示）。純函式。
    static func iconName(entries: [String: [String: Any]]) -> String? {
        guard let e = entries[key], (e["del"] as? Bool) != true, let vj = e["vj"] as? String,
              let value = (try? JSONSerialization.jsonObject(with: Data(vj.utf8), options: .fragmentsAllowed)) as? String
        else { return nil }
        return alternateNames[value]
    }

    @MainActor static func apply() {
        let app = UIApplication.shared
        guard app.supportsAlternateIcons, app.applicationState == .active else { return }
        let want = iconName(entries: AppSyncStore.load())
        guard want != app.alternateIconName else { return }
        app.setAlternateIconName(want) { error in
            if let error { NSLog("[JRead] setAlternateIconName(\(want ?? "nil")) failed: \(error.localizedDescription)") }
        }
    }
}
