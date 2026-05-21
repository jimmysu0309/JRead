// JRead — regression spec: 中英文間自動補空白（盤古之白）
// -----------------------------------------------------------------------------
// Trigger: Jimmy 2026-05-21 要求加入「文章內文的中英文之間若無空格，
// reader mode 自動插空格」。typical 場景：CMS / SPA 編輯器寫入中文時不打
// 空格，「NAND快閃記憶體」/「60%以上」這類字串視覺節奏破碎。
//
// 規則（見 styler.js pangu module）：
//   CJK ↔ ASCII 英數字 之間插空白
//   ASCII 英數字 / % / ° + CJK 之間插空白
//   CJK 取常用漢字 一-鿿 + 擴充 A 㐀-䶿
//   全形標點、符號邊界（。，「」（）等）不視為邊界—— 已有視覺分隔
//
// 跳過 tag：CODE / PRE / KBD / SAMP / VAR（程式碼）、A（連結文字，破壞引用
// 語意 + 內含 URL fragment 風險）、SCRIPT / STYLE / NOSCRIPT、TEXTAREA /
// INPUT / SELECT / OPTION（表單值）、contenteditable 元素。
//
// 設定 storage key：pangu（boolean，預設 true）。透過 settings.pangu === false
// 關閉，apply 不掃 + restore 也不還原（snapshot.panguSnap = null）。
//
// 動態注入內容（SPA / lazy-load 留言、推薦、後到段落）由 MutationObserver
// 接住，新插入的 element / text node 自動 pangu。
//
// 本 spec 直接呼叫 styler.apply / restore，驗 DOM 副作用 + restore 可逆。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'pangu-spacing-cjk-ascii.html');

function makeSettings(overrides) {
  return Object.assign({
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7,
    pangu: true
  }, overrides || {});
}

function setup(settingsOverrides) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler']
  });
  const articleEl = env.document.querySelector('article');
  const snapshot = env.NS.styler.apply(articleEl, makeSettings(settingsOverrides));
  return { env, articleEl, snapshot };
}

function textOf(doc, id) {
  return doc.getElementById(id).textContent;
}

describe('styler — Pangu spacing (CJK ↔ ASCII 自動補空白)', () => {

  describe('(a) 正常情境—— pangu: true 預設開啟', () => {
    it('h1 標題 CJK ↔ ASCII 間插空白', () => {
      const { env } = setup();
      // 原文 AI熱潮下NAND快閃記憶體的命運逆轉
      // 期望 AI 熱潮下 NAND 快閃記憶體的命運逆轉
      assert.strictEqual(textOf(env.document, 'title'), 'AI 熱潮下 NAND 快閃記憶體的命運逆轉');
    });

    it('基本句子 CJK 和英文縮寫之間插空白', () => {
      const { env } = setup();
      // 三星和SK海力士紛紛將重心轉向利潤率更高、以DRAM為核心的HBM。
      assert.strictEqual(
        textOf(env.document, 'p-basic'),
        '三星和 SK 海力士紛紛將重心轉向利潤率更高、以 DRAM 為核心的 HBM。'
      );
    });

    it('60%以上 → 60% 以上（% 後接 CJK 也插空白）', () => {
      const { env } = setup();
      // Jimmy 2026-05-21 明確要求：60%以上份額 → 60% 以上份額
      assert.ok(
        textOf(env.document, 'p-percent').includes('60% 以上份額'),
        '「60%以上份額」必須變成「60% 以上份額」（% 算 trailing alnum 邊界）'
      );
      // 同時驗 NAND ↔ 快閃 + 市場 ↔ 60 也補了空白
      assert.strictEqual(
        textOf(env.document, 'p-percent'),
        '佔據 NAND 快閃記憶體市場 60% 以上份額的這兩大巨頭，迄今尚未宣佈擴產計畫。'
      );
    });

    it('30°C的 → 30°C 的（° 視為 trailing alnum）', () => {
      const { env } = setup();
      // 夏季室溫常達30°C的環境下，BiCS10儲存裝置仍可穩定運行。
      const txt = textOf(env.document, 'p-degree');
      assert.ok(txt.includes('30°C 的'), `「30°C的」必須變成「30°C 的」；實際: ${txt}`);
      assert.ok(txt.includes('BiCS10 儲存'), `「BiCS10儲存」必須變成「BiCS10 儲存」；實際: ${txt}`);
    });

    it('半形括號 ( ) 兩側接 CJK 也補空白', () => {
      const { env } = setup();
      // Jimmy 2026-05-21 明確要求：威騰電子(Western Digital)獨立 → 威騰電子 (Western Digital) 獨立
      assert.strictEqual(
        textOf(env.document, 'p-halfwidth-paren'),
        'Sandisk 於 2025 年從威騰電子 (Western Digital) 獨立成為自家品牌。'
      );
      // 另一條：東芝的(Toshiba)記憶體 → 東芝的 (Toshiba) 記憶體
      assert.strictEqual(
        textOf(env.document, 'p-paren-double'),
        '先看鎧俠。該公司於 2017 年從東芝的 (Toshiba) 記憶體業務拆分而出。'
      );
    });
  });

  describe('(b) 不該動的情境—— 純 CJK / 純 ASCII / 跳過 tag', () => {
    it('純中文段落保持原樣', () => {
      const { env } = setup();
      assert.strictEqual(
        textOf(env.document, 'p-cjk-only'),
        '這段純中文沒有任何英數字應該保持原樣不被插入空白。'
      );
    });

    it('純英文段落保持原樣', () => {
      const { env } = setup();
      assert.strictEqual(
        textOf(env.document, 'p-ascii-only'),
        'This paragraph is pure English so pangu should not touch it.'
      );
    });

    it('純英文含半形括號保持原樣（無 CJK = 不該動）', () => {
      const { env } = setup();
      assert.strictEqual(
        textOf(env.document, 'p-ascii-paren'),
        'Pure English (with parens) stays untouched here.'
      );
    });

    it('<code> 內的文字不被動', () => {
      const { env } = setup();
      // 原文： 啟動指令是 <code>npm run dev</code> 而非<code>yarn-start</code>，請注意。
      // 期望 code 內仍為 'npm run dev' / 'yarn-start'；外層中文間補空白
      const codes = env.document.querySelectorAll('#p-code-wrap code');
      assert.strictEqual(codes[0].textContent, 'npm run dev', '第一個 <code> 不能被 pangu');
      assert.strictEqual(codes[1].textContent, 'yarn-start',  '第二個 <code> 不能被 pangu');
    });

    it('<a> 內的文字不被動（CJK ↔ ASCII 邊界保留原樣）', () => {
      const { env } = setup();
      // <a>Anthropic Claude官方</a> —— 連結文字 'Claude' 和 '官方' 之間不該補空白
      const anchor = env.document.getElementById('anchor-cjk');
      assert.strictEqual(anchor.textContent, 'Anthropic Claude官方',
        '<a> 內文不該被 pangu 動到（避免破壞引用語意 + 內含 URL fragment 風險）');
    });

    it('全形標點不算邊界（《AI與人類》/ 第3版 等已有視覺分隔的位置不動全形側）', () => {
      const { env } = setup();
      // 原文：他寫了《AI與人類》這本書，第3版於2026年出版。
      // 期望：《和AI、AI 和與之間 -> AI 內部不動（因為 AI 是 ASCII，緊鄰全形《》
      //   不該補空白），但 「第3版」 -> 「第 3 版」、「2026年」 -> 「2026 年」 補空白
      const txt = textOf(env.document, 'p-mixed-punct');
      // 全形《和 AI 之間不該補（《不在 CJK 㐀-鿿 範圍）
      assert.ok(txt.includes('《AI'), `全形《 和 AI 之間不該補空白；實際: ${txt}`);
      assert.ok(txt.includes('AI 與人類'), `AI 和 與 之間應補空白；實際: ${txt}`);
      assert.ok(txt.includes('第 3 版'), `第 和 3 之間應補空白；實際: ${txt}`);
      assert.ok(txt.includes('2026 年'), `2026 和 年 之間應補空白；實際: ${txt}`);
    });
  });

  describe('(c) settings.pangu === false 完全不動', () => {
    it('pangu: false 時所有 text node 保持原樣', () => {
      const { env } = setup({ pangu: false });
      // 原文照 fixture
      assert.strictEqual(textOf(env.document, 'title'), 'AI熱潮下NAND快閃記憶體的命運逆轉');
      assert.strictEqual(
        textOf(env.document, 'p-basic'),
        '三星和SK海力士紛紛將重心轉向利潤率更高、以DRAM為核心的HBM。'
      );
      assert.ok(
        textOf(env.document, 'p-percent').includes('60%以上份額'),
        'pangu off 時「60%以上份額」必須保持無空白'
      );
    });

    it('pangu: false 時 styler snapshot 不含 panguSnap（或為 null）', () => {
      const { snapshot } = setup({ pangu: false });
      assert.ok(!snapshot.panguSnap, `pangu off 時 panguSnap 必須為 null/undefined，實際: ${JSON.stringify(snapshot.panguSnap)}`);
    });
  });

  describe('(d) restore 可逆', () => {
    it('apply 後 restore 還原所有 text node 為原值', () => {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
      const articleEl = env.document.querySelector('article');

      // 原值 snapshot（fixture 原文）
      const originals = {
        title:     env.document.getElementById('title').textContent,
        'p-basic': env.document.getElementById('p-basic').textContent,
        'p-percent': env.document.getElementById('p-percent').textContent,
        'p-degree':  env.document.getElementById('p-degree').textContent,
        caption:   env.document.getElementById('caption').textContent
      };

      const snap = env.NS.styler.apply(articleEl, makeSettings());
      // sanity: pangu 確實動過
      assert.notStrictEqual(env.document.getElementById('title').textContent, originals.title);

      env.NS.styler.restore(articleEl, snap);

      // 全部還原回原值
      for (const id of Object.keys(originals)) {
        assert.strictEqual(
          env.document.getElementById(id).textContent,
          originals[id],
          `restore 後 #${id} 必須回到原值；實際仍為 ${env.document.getElementById(id).textContent}`
        );
      }
    });
  });

  describe('(e) MutationObserver 接後續注入的內容', () => {
    it('reader mode 啟動後新插入的 element 內 CJK↔ASCII 也被 pangu', (done) => {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
      const articleEl = env.document.querySelector('article');
      env.NS.styler.apply(articleEl, makeSettings());

      // 模擬 lazy-load 後注入新段落
      const lateP = env.document.createElement('p');
      lateP.id = 'late-injected';
      lateP.textContent = '延遲注入的Apple Intelligence段落應該也被pangu處理。';
      articleEl.appendChild(lateP);

      // MutationObserver 是 microtask，setTimeout(0) 後檢查
      setTimeout(() => {
        try {
          assert.strictEqual(
            env.document.getElementById('late-injected').textContent,
            '延遲注入的 Apple Intelligence 段落應該也被 pangu 處理。'
          );
          done();
        } catch (e) { done(e); }
      }, 0);
    });
  });
});
