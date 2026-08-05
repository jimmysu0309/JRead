// JRead — regression spec: 標題比對單一資料源 + 短 CJK 標題 gate（v1.7.40，
// 批次 2 review D3/D4）
// -----------------------------------------------------------------------------
// D3（技術債收斂）：detector 原有 titleMatches（8 字 gate）與 matchesBaseTitle
// （5 字 gate）兩份實作、normalizeTitle 兩份（markPromotedTitleIfMissing 版多剝
// `[...]`）——同一份事實多實作已 drift。收斂到 NS.titleSimilar / NS.normalizeTitle
// / NS.cjkWeightedLen；本 spec 的 forcing 段掃 source 斷言本地實作不再出現。
//
// D4（短 CJK 標題）：中文標題長度中位數 4-7 字，raw 8 字 containment gate 讓
// 短中文標題只剩 exact-match 一條路（h1 帶站方附加字即 miss → promote /
// self-titled guard 整組失效）。合一後 gate 改 CJK 權重（4 字中文 ×2 = 8 即過）。
// 假設驗證（2026-08-05 probe）：zh.wikipedia「珍珠奶茶」H1 innerText
// 「珍珠奶茶編輯」（編輯鈕文字併入）raw 版 miss、權重版命中——真實站實證翻轉。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'), 'utf8');

function load(fixture) {
  return loadFixtureWithScripts({
    fixturePath: path.join(__dirname, 'fixtures', fixture),
    scripts: ['detector']
  });
}

describe('標題比對單一資料源（v1.7.40，D3/D4）', () => {

  describe('forcing：detector 內不再有本地實作', () => {
    it('titleMatches / matchesBaseTitle / cjkWeightedLen 的 function 宣告不得存在', () => {
      assert.ok(!/function\s+titleMatches\s*\(/.test(DETECTOR_SRC),
        'titleMatches 本地實作必須收斂到 NS.titleSimilar');
      assert.ok(!/function\s+matchesBaseTitle\s*\(/.test(DETECTOR_SRC),
        'matchesBaseTitle 本地實作必須收斂到 NS.titleSimilar');
      assert.ok(!/function\s+cjkWeightedLen\s*\(/.test(DETECTOR_SRC),
        'cjkWeightedLen 實作必須上提到 NS（namespace.js）');
      assert.ok(!/CJK_CHAR_RE\s*=/.test(DETECTOR_SRC),
        'CJK 字元 regex 不得在 detector 內重複定義');
    });

    it('normalizeTitle 在 detector 內只允許轉呼 NS 的薄包裝（不得再有折疊 / 剝括號實作）', () => {
      assert.ok(!/foldTitlePunct\s*\(/.test(DETECTOR_SRC),
        'detector 不得直接呼叫 foldTitlePunct 自組折疊（單一資料源在 NS.normalizeTitle）');
      assert.ok(!/normalizeTitle[\s\S]{0,120}?replace\(\/\\\[/.test(DETECTOR_SRC),
        'detector 的 normalizeTitle 不得自帶 [...] 剝除實作（用 stripBrackets 參數）');
    });

    it('NS 端三個單一資料源必須存在', () => {
      const env = load('cjk-short-title-selfhead.html');
      assert.strictEqual(typeof env.NS.titleSimilar, 'function');
      assert.strictEqual(typeof env.NS.normalizeTitle, 'function');
      assert.strictEqual(typeof env.NS.cjkWeightedLen, 'function');
    });
  });

  describe('NS.titleSimilar 單元行為', () => {
    it('D4 核心翻轉：4 字中文標題 vs 帶站方附加字的 heading（zh.wikipedia probe 實案）', () => {
      const env = load('cjk-short-title-selfhead.html');
      assert.strictEqual(env.NS.titleSimilar('珍珠奶茶', '珍珠奶茶編輯'), true,
        '4 字中文權重 8 過 containment gate，不可只剩 exact-match');
    });

    it('拉丁行為不變：8 字以下拉丁字串 containment 仍不比對（僅 exact）', () => {
      const env = load('cjk-short-title-selfhead.html');
      assert.strictEqual(env.NS.titleSimilar('Hello', 'Hello!!'), false,
        '拉丁權重 1，短字串 containment gate 行為與舊 titleMatches 相同');
      assert.strictEqual(env.NS.titleSimilar('Hello', 'Hello'), true, 'exact 不受 gate 影響');
    });

    it('超短 fragment 防線：60% 長度比仍擋「標題包含 2 字片段」', () => {
      const env = load('cjk-short-title-selfhead.html');
      assert.strictEqual(env.NS.titleSimilar('四字標題', '標題'), false,
        '2 字片段 / 4 字標題 = 50% < 60%，不可誤判相似');
    });

    it('雙向包含 + 60% 比例（原 titleMatches 語意保留）', () => {
      const env = load('cjk-short-title-selfhead.html');
      assert.strictEqual(
        env.NS.titleSimilar('A Long Article Title', 'A Long Article Title - Site'), true);
      assert.strictEqual(
        env.NS.titleSimilar('A Long Article Title - Site Name Very Long Suffix', 'Title'), false,
        '長度比不足 60% 不可比對成功');
    });
  });

  describe('NS.normalizeTitle 單元行為', () => {
    it('預設：折疊 typographic 標點 + collapse 空白（不剝括號）', () => {
      const env = load('cjk-short-title-selfhead.html');
      assert.strictEqual(env.NS.normalizeTitle('“Test”  Title'), '"Test" Title');
      assert.strictEqual(env.NS.normalizeTitle('[Site] Title'), '[Site] Title',
        '不帶 stripBrackets 時保留 [...]（主 detect path 語意）');
    });

    it('stripBrackets：先剝 [...] site prefix 再折疊（markPromotedTitleIfMissing 語意）', () => {
      const env = load('cjk-short-title-selfhead.html');
      assert.strictEqual(
        env.NS.normalizeTitle('[Site] ’Test’ Title', { stripBrackets: true }),
        "'Test' Title");
    });
  });

  describe('D4 整合：短 CJK 標題的 self-title guard', () => {
    it('(a) article 自含「珍珠奶茶編輯」h1 時 promote 必須收手，chrome 複寫標題不得括進主文', () => {
      const env = load('cjk-short-title-selfhead.html');
      const detected = env.NS.detector.detect();
      assert.ok(detected && detected.el, 'detect 必須有結果');
      const chrome = env.document.querySelector('[data-test="chrome-title"]');
      assert.ok(!detected.el.contains(chrome),
        '4 字中文標題必須命中 self-title guard——sticky 導覽的標題複寫 span 不可觸發 promote 過廣');
      const selfH1 = env.document.querySelector('[data-test="self-h1"]');
      assert.ok(detected.el.contains(selfH1), '自帶 h1 必須留在主文 scope');
    });

    it('(b) fixture 前提：canonical title raw 4 字（< 8 raw gate）、heading 帶附加字非 exact', () => {
      const env = load('cjk-short-title-selfhead.html');
      const og = env.document.querySelector('meta[property="og:title"]').content;
      const head = env.NS.stripSiteSuffix(og);
      assert.strictEqual(head, '珍珠奶茶');
      assert.ok(head.length < 8, 'canonical raw 必須 < 8（修前 containment gate 擋掉）');
      const selfH1 = env.document.querySelector('[data-test="self-h1"]');
      assert.notStrictEqual(selfH1.textContent.trim(), head,
        'heading 必須非 exact-match（exact 修前也過、驗不到 gate）');
    });
  });
});
