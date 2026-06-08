# Pending Regression Queue

> 當下抽不出最小重現結構的 bug 暫放於此。清空狀態為只保留本 header。
> 流程見 `CLAUDE.md` 硬規則 4（路徑 B）。

每條條目格式:

```
## [日期] 簡短標題
- 觸發頁面：<URL>
- 症狀：
- 推測根因：
- 未補 spec 原因：
- 責任人/目標日期：
```

---

<!-- 待辦條目從這裡往下加 -->

## [2026-06-08] v0.7.244 翻頁收合「縮小範圍、不鎖」最終版真機 feel-check
- 觸發頁面：任意翻頁模式（pagedMode）文章，iOS Safari（TestFlight v0.7.244）
- 症狀：(待最終確認) v0.7.240→243 的「收合後鎖死垂直卷動」已實證在 iOS 本質做不到（touch-action:none 鎖死時慣性彈回頂端 + 工具列重展開；下滑必能叫回工具列），整套鎖已撤回。v0.7.244 = min-height 101vh（真機 Pages instrument 逐值實測：101vh 可捲 ~8px 即收得了工具列）+ 回 v0.7.239 per-page 模型（第一頁放行垂直、第二頁起 preventDefault 鎖）。核心行為已在真機 instrument 驗過（101vh 收得了 / 無鎖無彈回 / 下滑自然叫回工具列）。剩：組裝成 extension 後的整體手感確認——第一頁左右滑是否乾淨、收合是否如預期、第二頁起垂直是否鎖住。
- 推測根因：N/A（功能收尾，非 bug）。
- 未補 spec 原因：iOS Safari 工具列收合 / 第一頁放行第二頁鎖的真機手感是 WebKit + iOS runtime 行為，jsdom / Chromium harness / 模擬器皆非權威（CLAUDE.md WebKit 軌警語）。CSS forcing function（min-height > 100vh + overflow-y visible + 觸控 media query）+ shouldBlockTouchMove per-page spec 已涵蓋可測層。
- 責任人/目標日期：Jimmy 真機驗（TestFlight v0.7.244 上架後），OK 即清本條 + 移除 docs/instrument.html 與 GitHub Pages。
