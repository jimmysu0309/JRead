// JRead — AppSyncStore.acceptedTs 的獨立測試（2026-11-15 review 批 6 E-10）
//
// 專案沒有 XCTest target；合併決策抽成純函式後用這支直接編譯真的 AppSyncStore.swift 來驗。
// 跑法（由 test/regression/review-1115-b6-ios-appsync-merge.spec.js 呼叫，也可手動）：
//   swiftc safari-app/JRead-iOS/Shared/AppSyncStore.swift tools/swift-tests/appsync-accepted-ts/main.swift -o /tmp/t && /tmp/t
// 這條驗：acceptedTs 的決策表。不驗：merge 的檔案讀寫、NSFileCoordinator 跨 process 排隊、
// 排除備份屬性（App Group 容器在未簽章的 macOS 執行檔拿不到）。

import Foundation

// 帶參數時是「對照模式」：每個參數 "ts,cur,now" 印一行結果（nil 或數字），給 mocha spec
// 拿去逐筆比對 JS 假 store 的同語意實作，確保兩份不 drift
let triples = CommandLine.arguments.dropFirst()
if !triples.isEmpty {
    for t in triples {
        let p = t.split(separator: ",").map { Double($0)! }
        if let r = AppSyncStore.acceptedTs(incoming: p[0], current: p[1], now: p[2]) { print(String(format: "%.0f", r)) } else { print("nil") }
    }
    exit(0)
}

var failed = 0
func check(_ name: String, _ got: Double?, _ want: Double?) {
    if got == want { print("ok   \(name)") } else { failed += 1; print("FAIL \(name): got \(String(describing: got)) want \(String(describing: want))") }
}
let now = 1_000_000.0

// 一般 LWW
check("沒有現有值（-1）→ 收、ts 不變", AppSyncStore.acceptedTs(incoming: now, current: -1, now: now), now)
check("比現有新 → 收、ts 不變", AppSyncStore.acceptedTs(incoming: now, current: now - 5000, now: now), now)
check("戳記較早、較晚送達（現有 ts 不在未來）→ 拒", AppSyncStore.acceptedTs(incoming: now - 3000, current: now - 1000, now: now), nil)
check("同 ts → 拒（維持原行為）", AppSyncStore.acceptedTs(incoming: now, current: now, now: now), nil)
// 時鐘回調：現有那筆在未來
check("現有 ts 在未來 → 收、ts 墊成現有 + 1", AppSyncStore.acceptedTs(incoming: now, current: now + 86_400_000, now: now), now + 86_400_001)
check("現有 ts 在未來、incoming 更早 → 仍收並墊高", AppSyncStore.acceptedTs(incoming: now - 10, current: now + 1, now: now), now + 2)
check("incoming 自己就比未來那筆新 → 照一般規則", AppSyncStore.acceptedTs(incoming: now + 9, current: now + 1, now: now), now + 9)

if failed > 0 { print("FAILED \(failed)"); exit(1) }
print("ALL OK")
