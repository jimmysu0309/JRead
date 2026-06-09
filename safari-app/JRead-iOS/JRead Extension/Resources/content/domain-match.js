// JRead — Auto-enable 網域 matching helper（v0.7.155）
// 共用於 content script（main.js 啟動時判定是否 auto-enter）、popup（顯示此網域 toggle
// 狀態）、options（清理 textarea 輸入）、regression spec（直接 require）。
//
// matching 規則（與使用者 spec 對齊）：
//   - pattern 'abc.com'     → 命中 'abc.com' / 'www.abc.com' / 'foo.abc.com' / 'a.b.abc.com'
//   - pattern 'www.abc.com' → 命中 'www.abc.com'（不含 '123.abc.com'，因 '123.abc.com'
//                              不 endsWith '.www.abc.com'）
// 形式上：hostname === pattern OR hostname endsWith '.' + pattern。
//
// 跨環境匯出：content script 走 window 全域、Node require 走 module.exports。
(function (global) {
  'use strict';

  // 把使用者輸入（可能含 https:// / 路徑 / port / 大小寫 / 前後空白 / 前導點）
  // 正規化成純 hostname 形式（lowercase / 無路徑 / 無 port）。空字串代表無效。
  function normalizeDomain(input) {
    let s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');   // scheme
    s = s.replace(/^[^@\/]+@/, '');                   // user:pass@
    s = s.replace(/[\/\?#].*$/, '');                  // path / query / hash
    s = s.replace(/:\d+$/, '');                       // port
    s = s.replace(/^\.+|\.+$/g, '');                  // 前後 dot
    return s;
  }

  function matchHostname(hostname, patterns) {
    if (!hostname || !Array.isArray(patterns) || patterns.length === 0) return false;
    const h = String(hostname).toLowerCase().replace(/^\.+|\.+$/g, '');
    if (!h) return false;
    for (const raw of patterns) {
      const p = normalizeDomain(raw);
      if (!p) continue;
      if (h === p) return true;
      // suffix 比對只在 pattern 含至少一個點時啟用：防止使用者誤填 public
      // suffix / 單段字串（如 'com' / 'io' / 'co.uk' 的 'com'）match 整個
      // eTLD 底下所有網域、auto-enter 在沒預期的大量站點誤觸（v0.8.15）。
      // 單段 pattern（無點）一律只走上面的 exact match。
      if (p.includes('.') && h.endsWith('.' + p)) return true;
    }
    return false;
  }

  // textarea 多行字串 → 去重 + 正規化的網域陣列。逗號 / 換行皆視為分隔。
  function parseList(text) {
    if (!text) return [];
    const seen = new Set();
    const out = [];
    String(text).split(/[\r\n,]+/).forEach((line) => {
      const d = normalizeDomain(line);
      if (d && !seen.has(d)) { seen.add(d); out.push(d); }
    });
    return out;
  }

  // 陣列 → textarea 顯示字串（每行一個）。
  function serializeList(arr) {
    if (!Array.isArray(arr)) return '';
    const seen = new Set();
    const out = [];
    arr.forEach((raw) => {
      const d = normalizeDomain(raw);
      if (d && !seen.has(d)) { seen.add(d); out.push(d); }
    });
    return out.join('\n');
  }

  // popup 「此網域自動啟動」關閉時用：移除清單中**所有**會 match 目前 hostname
  // 的 entry（含更寬的 pattern，如 'abc.com'）。確保 toggle off 後此 hostname
  // 確實不會再 auto-enter。
  function removeMatching(hostname, patterns) {
    if (!hostname || !Array.isArray(patterns)) return [];
    const h = String(hostname).toLowerCase().replace(/^\.+|\.+$/g, '');
    if (!h) return patterns.slice();
    return patterns.filter((raw) => {
      const p = normalizeDomain(raw);
      if (!p) return false; // 順手清空字串
      if (h === p) return false;
      // 與 matchHostname 同規則：suffix 比對只在 pattern 含點時啟用（v0.8.15）
      if (p.includes('.') && h.endsWith('.' + p)) return false;
      return true;
    });
  }

  const api = { normalizeDomain, matchHostname, parseList, serializeList, removeMatching };
  if (typeof window !== 'undefined') window.__JReadDomainMatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
