//
//  SafariWebExtensionHandler.swift
//  JRead Extension
//
//  Created by Jimmy Su on 2026/6/5.
//

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        let reply: Any
        if let dict = message as? [String: Any], (dict["type"] as? String) == "jread.sync" {
            // v2.2.0：lib/app-sync.js 的 storage.sync 同步——收對端 entries 合併進 App Group
            // 鏡像（AppSyncStore，與 App 內 JReader 共用），回合併後的全量
            let incoming = (dict["entries"] as? [String: Any]) ?? [:]
            let merged = AppSyncStore.merge(incoming)
            reply = [ "entries": merged ]
        } else {
            os_log(.default, "Received message from browser.runtime.sendNativeMessage: %@ (profile: %@)", String(describing: message), profile?.uuidString ?? "none")
            reply = [ "echo": message ]
        }

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [ SFExtensionMessageKey: reply ]
        } else {
            response.userInfo = [ "message": reply ]
        }

        context.completeRequest(returningItems: [ response ], completionHandler: nil)
    }

}
