// JRead — Facebook permalink post reader regression（v0.7.157）
//
// 動機：FB permalink（/<user>/posts/pfbid* 等）DOM 完全沒 semantic markup
// （0 個 <article> / 0 個 <main> / 0 個 schema.org），主貼文 1765 字以 12 層
// 巢狀 DIV>SPAN>DIV 包裝、emotion-hash class、零語意；偵測訊號元素 233 個
// 但只有 1 個過 25 字門檻（且是 sidebar LI）；24 個 [role="article"] 全是
// 留言不是主貼文——detector 四層策略全 null。
//
// 修法：仿 v0.7.135 X / Twitter status thread 模式——新檔 fb-post.js 合成
// `<article data-jread-fb-reader>` 容器注入 body 開頭，detector 短路 isFbPost=
// true、main.js 走 enterFbPostMode 跑 cleaner / styler / keyguard / ESC。
//
// 假設驗證順序（CLAUDE.md 硬規則）：已用 chrome-in-chrome probe 在真實
// facebook.com/<user>/posts/pfbid* 頁面驗過——主貼文 message wrapper =
// 最長的 [data-ad-comet-preview="message"]、author = 對應 profile_name、
// 兩者最近共同祖先 = 主貼文 unit container。本 spec 是 forcing function。
//
// 覆蓋：
//   1. fb-post.js 模組結構（NS.fbPost.{ isFacebookPost, findMainMessage,
//      findAuthorForMessage, findPostContainer, extractAuthorInfo,
//      createSyntheticHeader, pruneReaderClone, enter, exit, isActive,
//      READER_ATTR }）
//   2. isFacebookPost URL 判斷（/<user>/posts/* / /permalink* / /story.php?
//      story_fbid=* / /share/p/* / www / m / mobile 子網域 / 非 FB 站）
//   3. findMainMessage 挑最長（過濾 sidebar 推薦的 truncated 20-字訊息）
//   4. enter() 注入 <article data-jread-fb-reader> 到 body 開頭 + clone 主貼文
//   5. pruneReaderClone 移除 [role="article"] 留言 + 純 Facebook placeholder +
//      reactions/share metadata wrapper
//   6. detector.js detect() FB permalink 短路（回 isFbPost=true / el=null）
//   7. detector.js probe() FB permalink siteMode=fb-post
//   8. main.js enterFbPostMode 流程（NS.fbPost.enter + cleaner.clean +
//      styler.apply + 標 siteMode='fb-post'）+ exitReaderMode 呼叫 NS.fbPost.exit()
//   9. manifest content_scripts 載入順序（fb-post.js 在 detector.js 前）
//  10. namespace.js fbPost: null 佔位

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const FBPOST_SRC    = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'fb-post.js'), 'utf8');
const NAMESPACE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const DETECTOR_SRC  = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'detector.js'), 'utf8');
const MAIN_SRC      = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const MANIFEST      = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));
const FIXTURE       = fs.readFileSync(path.join(__dirname, 'fixtures', 'fb-permalink-post.html'), 'utf8');

function setupJsdom(url, htmlBody) {
  const dom = new JSDOM(htmlBody || '<!doctype html><html><body></body></html>', {
    url,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.7.157' })
    }
  };
  window.eval(NAMESPACE_SRC);
  window.eval(FBPOST_SRC);
  return { window, document: window.document, NS: window.__JRead };
}

describe('fb-post v0.7.157 — 模組結構', () => {
  it('fb-post.js 必須宣告 isFacebookPost / findMainMessage / findAuthorForMessage / findPostContainer / extractAuthorInfo / createSyntheticHeader / pruneReaderClone / enter / exit / isActive', () => {
    assert.match(FBPOST_SRC, /function\s+isFacebookPost\s*\(/, 'fb-post.js 缺 isFacebookPost');
    assert.match(FBPOST_SRC, /function\s+findMainMessage\s*\(/, 'fb-post.js 缺 findMainMessage');
    assert.match(FBPOST_SRC, /function\s+findAuthorForMessage\s*\(/, 'fb-post.js 缺 findAuthorForMessage');
    assert.match(FBPOST_SRC, /function\s+findPostContainer\s*\(/, 'fb-post.js 缺 findPostContainer');
    assert.match(FBPOST_SRC, /function\s+extractAuthorInfo\s*\(/, 'fb-post.js 缺 extractAuthorInfo');
    assert.match(FBPOST_SRC, /function\s+createSyntheticHeader\s*\(/, 'fb-post.js 缺 createSyntheticHeader');
    assert.match(FBPOST_SRC, /function\s+pruneReaderClone\s*\(/, 'fb-post.js 缺 pruneReaderClone');
    assert.match(FBPOST_SRC, /function\s+enter\s*\(/, 'fb-post.js 缺 enter');
    assert.match(FBPOST_SRC, /function\s+exit\s*\(/, 'fb-post.js 缺 exit');
    assert.match(FBPOST_SRC, /function\s+isActive\s*\(/, 'fb-post.js 缺 isActive');
  });

  it('fb-post.js 必須 export NS.fbPost 物件 + READER_ATTR 常數', () => {
    assert.match(FBPOST_SRC, /NS\.fbPost\s*=\s*\{[\s\S]*isFacebookPost[\s\S]*enter[\s\S]*exit[\s\S]*\}/,
      'NS.fbPost 必須暴露 isFacebookPost / enter / exit（main.js / detector.js 依賴）');
    assert.match(FBPOST_SRC, /READER_ATTR\s*=\s*['"]data-jread-fb-reader['"]/,
      'READER_ATTR 常數必須是 data-jread-fb-reader——合成容器 marker，spec 與 source 雙邊綁定');
  });

  it('namespace.js 必須宣告 fbPost: null 佔位', () => {
    assert.match(NAMESPACE_SRC, /fbPost\s*:\s*null/,
      'namespace.js 必須有 fbPost: null 佔位（fb-post.js 掛載點）');
  });
});

// v0.7.167：FB permalink URL 抽 vanity username 給 Readwise author 欄位。
describe('fb-post v0.7.167 — extractAuthorVanityFromUrl', () => {
  let f;
  before(() => {
    const env = setupJsdom('https://example.com/');
    f = env.NS.fbPost.extractAuthorVanityFromUrl;
  });

  it('NS.fbPost 必須暴露 extractAuthorVanityFromUrl', () => {
    assert.strictEqual(typeof f, 'function',
      'NS.fbPost.extractAuthorVanityFromUrl 必須存在(main.js extractAuthor 依賴)');
    assert.match(FBPOST_SRC, /function\s+extractAuthorVanityFromUrl\s*\(/);
    assert.match(FBPOST_SRC, /NS\.fbPost\s*=\s*\{[\s\S]*extractAuthorVanityFromUrl[\s\S]*\}/);
  });

  it('https://www.facebook.com/drdavidchen/posts/pfbid02… → "drdavidchen"', () => {
    assert.strictEqual(f('https://www.facebook.com/drdavidchen/posts/pfbid02UCSG1dpwH7hjrftyrtepKB'), 'drdavidchen');
  });

  it('https://facebook.com/user/posts/123 → "user"(無 www)', () => {
    assert.strictEqual(f('https://facebook.com/user/posts/123'), 'user');
  });

  it('https://m.facebook.com/user/posts/123 → "user"(行動版)', () => {
    assert.strictEqual(f('https://m.facebook.com/user/posts/123'), 'user');
  });

  it('https://www.facebook.com/groups/<gid>/posts/<pid> → ""(社團路徑保留段不送)', () => {
    assert.strictEqual(f('https://www.facebook.com/groups/902748753095551/posts/26919193527691051/'), '',
      'groups 是 reserved path,沒 vanity → 空字串(caller fallback 用 displayName)');
  });

  it('https://www.facebook.com/story.php?story_fbid=…&id=… → ""(無 vanity)', () => {
    assert.strictEqual(f('https://www.facebook.com/story.php?story_fbid=123&id=456'), '');
  });

  it('https://www.facebook.com/permalink.php?story_fbid=… → ""', () => {
    assert.strictEqual(f('https://www.facebook.com/permalink.php?story_fbid=123&id=456'), '');
  });

  it('https://www.facebook.com/share/p/abc → ""(短連結無 vanity)', () => {
    assert.strictEqual(f('https://www.facebook.com/share/p/abc123'), '');
  });

  it('https://www.facebook.com/user(無 /posts/)→ ""(純使用者頁不送)', () => {
    assert.strictEqual(f('https://www.facebook.com/drdavidchen'), '');
  });

  it('https://example.com/user/posts/123 → ""(非 FB 站)', () => {
    assert.strictEqual(f('https://example.com/user/posts/123'), '');
  });

  it('https://fakefacebook.com/user/posts/123 → ""(防 hostname 包含 facebook.com 子字串)', () => {
    assert.strictEqual(f('https://fakefacebook.com/user/posts/123'), '');
  });

  it('無參數時讀 location.href', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02');
    assert.strictEqual(env.NS.fbPost.extractAuthorVanityFromUrl(), 'drdavidchen');
  });
});

describe('fb-post v0.7.157 — isFacebookPost URL 判斷', () => {
  let isFacebookPost;
  before(() => {
    const env = setupJsdom('https://example.com/');
    isFacebookPost = env.NS.fbPost.isFacebookPost;
  });

  it('https://www.facebook.com/<user>/posts/pfbid* → true', () => {
    assert.strictEqual(isFacebookPost('https://www.facebook.com/drdavidchen/posts/pfbid02UCSG1dpwH7hjrftyrtepKB'), true);
  });

  it('https://facebook.com/<user>/posts/<id> → true（無 www 子網域）', () => {
    assert.strictEqual(isFacebookPost('https://facebook.com/user/posts/123456'), true);
  });

  it('https://m.facebook.com/<user>/posts/* → true（行動版）', () => {
    assert.strictEqual(isFacebookPost('https://m.facebook.com/user/posts/123'), true);
  });

  it('https://mobile.facebook.com/<user>/posts/* → true', () => {
    assert.strictEqual(isFacebookPost('https://mobile.facebook.com/user/posts/123'), true);
  });

  it('https://www.facebook.com/permalink.php?story_fbid=123&id=456 → true', () => {
    assert.strictEqual(isFacebookPost('https://www.facebook.com/permalink.php?story_fbid=123&id=456'), true);
  });

  it('https://www.facebook.com/story.php?story_fbid=123&id=456 → true', () => {
    assert.strictEqual(isFacebookPost('https://www.facebook.com/story.php?story_fbid=123&id=456'), true);
  });

  it('https://www.facebook.com/share/p/abc123 → true（FB 短連結）', () => {
    assert.strictEqual(isFacebookPost('https://www.facebook.com/share/p/abc123'), true);
  });

  // v0.7.159 — FB Groups 社團貼文 URL patterns（Jimmy 2026-05-21 實機回報）
  it('https://www.facebook.com/groups/<gid>/?multi_permalinks=<pid> → true（v0.7.159 FB Groups modal preview）', () => {
    assert.strictEqual(
      isFacebookPost('https://www.facebook.com/groups/902748753095551/?multi_permalinks=26919193527691051&hoisted_section_header_type=recently_seen'),
      true,
      'FB Groups modal preview URL（從社團頁點貼文展開）必須命中——Jimmy 實機回報 軍事迷 社團貼文偵測不到'
    );
  });

  it('https://www.facebook.com/groups/<gid>/posts/<pid>/ → true（既有 /posts/ 規則涵蓋）', () => {
    assert.strictEqual(
      isFacebookPost('https://www.facebook.com/groups/902748753095551/posts/26919193527691051/'),
      true
    );
  });

  it('https://www.facebook.com/groups/<gid>/permalink/<pid>/ → true（既有 /permalink/ 規則涵蓋）', () => {
    assert.strictEqual(
      isFacebookPost('https://www.facebook.com/groups/902748753095551/permalink/26919193527691051/'),
      true
    );
  });

  it('https://www.facebook.com/groups/<gid>/ 純社團首頁（無 multi_permalinks query）→ false', () => {
    assert.strictEqual(
      isFacebookPost('https://www.facebook.com/groups/902748753095551/'),
      false,
      '社團首頁列出多則貼文，沒有單一主貼文可閱讀，必須 no-op'
    );
  });

  it('https://www.facebook.com/<user> 純使用者頁 → false', () => {
    assert.strictEqual(isFacebookPost('https://www.facebook.com/drdavidchen'), false);
  });

  it('https://www.facebook.com/marketplace → false（marketplace 頁）', () => {
    assert.strictEqual(isFacebookPost('https://www.facebook.com/marketplace'), false);
  });

  it('https://www.facebook.com/ 首頁 → false', () => {
    assert.strictEqual(isFacebookPost('https://www.facebook.com/'), false);
  });

  it('https://example.com/user/posts/123 → false（非 FB 站）', () => {
    assert.strictEqual(isFacebookPost('https://example.com/user/posts/123'), false);
  });

  it('https://fakefacebook.com/user/posts/123 → false（防 hostname 包含 facebook.com 子字串攻擊）', () => {
    assert.strictEqual(isFacebookPost('https://fakefacebook.com/user/posts/123'), false);
  });

  it('無參數時讀 location.href', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02');
    assert.strictEqual(env.NS.fbPost.isFacebookPost(), true);
    const env2 = setupJsdom('https://example.com/');
    assert.strictEqual(env2.NS.fbPost.isFacebookPost(), false);
  });
});

describe('fb-post v0.7.157 — findMainMessage 挑最長', () => {
  it('多個 data-ad-comet-preview=message 時挑 textLen 最長（過濾 sidebar 推薦 truncated 短訊息）', () => {
    const env = setupJsdom('https://www.facebook.com/u/posts/123', FIXTURE);
    const main = env.NS.fbPost.findMainMessage();
    assert.ok(main, 'findMainMessage 必須回元素');
    assert.ok((main.innerText || main.textContent).includes('川普'),
      '應該命中主貼文（含「川普」），不是 sidebar 推薦的「AI 時代誰被裁員」');
  });

  it('完全沒 data-ad-comet-preview=message → null', () => {
    const env = setupJsdom('https://www.facebook.com/u/posts/123', '<!doctype html><html><body><div>沒貼文</div></body></html>');
    assert.strictEqual(env.NS.fbPost.findMainMessage(), null);
  });
});

describe('fb-post v0.7.157 — findPostContainer 共同祖先', () => {
  it('主 message + 對應 author 的最近共同祖先必須含「川普」貼文 + David Chen 作者', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    const container = env.NS.fbPost.findPostContainer();
    assert.ok(container, 'findPostContainer 必須回容器');
    const text = container.textContent;
    assert.ok(text.includes('川普'), '容器必須含主貼文文字');
    assert.ok(text.includes('David Chen'), '容器必須含作者名');
    assert.ok(!text.includes('AI 時代誰被裁員'),
      '容器不可含 sidebar 推薦貼文（不同 wrapper）');
  });

  it('找不到 message 或 author 時 → null（不誤判）', () => {
    const env = setupJsdom('https://www.facebook.com/u/posts/123',
      '<!doctype html><html><body><div>沒 message 也沒 profile_name</div></body></html>');
    assert.strictEqual(env.NS.fbPost.findPostContainer(), null);
  });
});

describe('fb-post v0.7.157 — enter() 注入合成容器', () => {
  it('enter() 注入 <article data-jread-fb-reader> 到 body 開頭', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    const container = env.NS.fbPost.enter();
    assert.ok(container, 'enter() 必須回容器 element');
    assert.strictEqual(container.tagName, 'ARTICLE');
    assert.strictEqual(container.getAttribute('data-jread-fb-reader'), '1');
    assert.strictEqual(env.document.body.firstElementChild, container,
      '合成容器必須是 body 第一個 child——讓 hideAncestorSiblings 自然清掉原 FB UI');
  });

  it('合成容器內含主貼文文字（clone 進去）', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    const container = env.NS.fbPost.enter();
    assert.ok(container.textContent.includes('川普'),
      '合成容器必須含主貼文文字（cloneNode 後文字保留）');
    assert.ok(container.textContent.includes('華盛頓'),
      '合成容器必須保留多段內文');
  });

  it('markParagraphDivs 給 leaf paragraph div 加 inline margin（FB 用 div 不用 p、strip class 後段落緊貼難讀）', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    const container = env.NS.fbPost.enter();
    const paragraphs = container.querySelectorAll('[data-jread-fb-para]');
    assert.ok(paragraphs.length > 0,
      'enter() 後合成容器內必須有 [data-jread-fb-para] 標記的 leaf 段落 div');
    // 每個段落 div 必須有 inline margin
    for (const p of paragraphs) {
      const margin = p.style.getPropertyValue('margin');
      assert.ok(margin && margin !== '',
        `[data-jread-fb-para] div 必須有 inline margin（FB 段落是 div 不是 p、需要補 margin）；該 div text="${(p.textContent || '').slice(0, 30)}"`);
    }
  });

  // v0.7.163：inline margin 不得有 !important（否則 styler stylesheet 規則被擋）
  // 硬教訓十：inline !important 永遠贏 stylesheet !important。使用者調 paragraphSpacing
  // 是透過 styler 注入的 [data-jread-fb-para] selector 規則，若此處用 !important
  // 鎖死，使用者設定完全不會生效（Jimmy 2026-05-22 回報 FB 段落間距無效根因）。
  it('markParagraphDivs inline margin 不得用 !important（保留給 styler paragraphSpacing 規則覆寫）', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    const container = env.NS.fbPost.enter();
    const paragraphs = container.querySelectorAll('[data-jread-fb-para]');
    assert.ok(paragraphs.length > 0, '前提：fb-para 必須存在');
    for (const p of paragraphs) {
      const priority = p.style.getPropertyPriority('margin');
      assert.strictEqual(priority, '',
        `[data-jread-fb-para] inline margin 不得有 !important（priority="${priority}"），否則使用者調 paragraphSpacing 無效；text="${(p.textContent || '').slice(0, 30)}"`);
    }
  });

  it('share-preview widget（整片 link cluster + 含媒體）→ unwrap 只留 img、砍短網域 / 名字 / 重複文字（Jimmy 2026-05-21 第四次實機回報）', () => {
    // 實機 Nathan Chiu 貼文 chrome-in-chrome probe 結果：share-preview widget 是
    // story_message 之後 sibling（mainMsg 祖父輩 sibling），整片包在 <a> 內，
    // linkRatio = 1.01（textContent 中 <a> 文字佔 100%+）。
    const html = `<!doctype html><html><body>
      <div id="post-container">
        <div data-ad-rendering-role="profile_name"><span>Author</span></div>
        <div id="content-wrapper">
          <div data-ad-rendering-role="story_message">
            <div data-ad-comet-preview="message" data-ad-preview="message">
              <div><span dir="auto">主文文字必須夠長確保 findMainMessage 選中這個 message。歷史故事敘述繼續延展，包含中美交流之始、清朝文人與米國總統的文化連結。這段文字必須累計超過 500 字才能讓 findMainMessage 把這個 message 視為主貼文而非 sidebar 推薦短訊息。再加一句確保長度足夠。share-preview widget 必須被 unwrap 只留 img、砍掉文字。</span></div>
            </div>
          </div>
          <div id="share-preview" role="link">
            <a href="https://share.fb.com/abc">
              <img src="https://scontent.fb.com/og-thumb.jpg" alt="">
              <div><span>Hv9AdSq.com</span></div>
              <div><span>Jimmy Su</span></div>
              <div><span>數日前，川普在北京人民大會堂的國宴上致詞，提到了一段多數人都不知道的歷史。歷史內容描述中美交流之始、華盛頓紀念碑的石頭來源、清朝文人與米國總統的文化連結。重複整篇貼文的 OG description。</span></div>
            </a>
          </div>
        </div>
      </div>
    </body></html>`;
    const env = setupJsdom('https://www.facebook.com/u/posts/abc', html);
    const container = env.NS.fbPost.enter();
    assert.ok(container, 'enter() 必須回容器');
    // unwrap 後 img 保留
    const ogImg = container.querySelector('img[src*="og-thumb.jpg"]');
    assert.ok(ogImg, 'share-preview 內的 img 必須 unwrap 後保留');
    // 短網域 / 名字 / OG description 重複都應被砍
    assert.ok(!container.textContent.includes('Hv9AdSq.com'),
      'share-preview 內的短網域不可殘留');
    assert.ok(!container.textContent.includes('Jimmy Su'),
      'share-preview 內的分享者名字不可殘留');
    assert.ok(!container.textContent.includes('OG description'),
      'share-preview 內的 OG description 不可殘留');
    // unwrap 後 img 沒被 <a> 包住
    assert.strictEqual(ogImg.closest('a'), null,
      'unwrap 後 img 不應仍在 <a> 內（避免點圖跳到 share 對話）');
  });

  it('附帶圖在 mainMsg 祖父輩 sibling（實機 Nathan Chiu 貼文結構）也保留', () => {
    // chrome-in-chrome probe 真實 FB permalink DOM 後發現附帶圖 wrapper 不在
    // mainMsg 同階、而在 mainMsg 祖父輩 sibling（即 mainMsg.parentElement.
    // parentElement 的 next sibling）——這個 sibling 是「純媒體 wrapper」
    // (textLen=0 + 含 img)，必須結構性辨識保留。
    const html = `<!doctype html><html><body>
      <div id="post-container">
        <div data-ad-rendering-role="profile_name"><span>Author</span></div>
        <div id="content-wrapper">
          <div id="inner-wrapper">
            <div id="story_message_wrap" data-ad-rendering-role="story_message">
              <div data-ad-comet-preview="message" data-ad-preview="message">
                <div><span dir="auto">主文文字夠長確保比 sidebar 推薦短訊息更長。歷史故事敘述繼續延展，包含中美交流之始、清朝文人與米國總統的文化連結。這段文字必須累計超過 500 字才能讓 findMainMessage 把這個 message 視為主貼文而非 sidebar 推薦的 truncated 短訊息。所以再加一句：附帶照片必須保留，不可被誤殺。</span></div>
              </div>
            </div>
            <div id="attached-media-wrapper">
              <img src="https://scontent.fb.com/attached-photo.jpg" alt="">
            </div>
          </div>
        </div>
        <div id="og-meta">
          <a href="https://example.com">m7NKy5VBX1.com</a>
          <div>OG description 重複整篇貼文這段文字也很長確保超過 50 字 textLen 閾值會被砍掉。</div>
        </div>
      </div>
    </body></html>`;
    const env = setupJsdom('https://www.facebook.com/u/posts/abc', html);
    const container = env.NS.fbPost.enter();
    assert.ok(container, 'enter() 必須回容器');
    const attachedImg = container.querySelector('img[src*="attached-photo.jpg"]');
    assert.ok(attachedImg,
      '附帶圖在 mainMsg 祖父輩 sibling（純媒體 wrapper：textLen=0 + 含 img）必須保留');
    assert.ok(!container.textContent.includes('m7NKy5VBX1.com'),
      'OG meta widget 在更上層 sibling、textLen 超閾值，必須砍');
  });

  it('story_message 之後 sibling 全清（OG meta widget / reactions / comments——Jimmy 2026-05-21 第一次回報）', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    const container = env.NS.fbPost.enter();
    // fixture i=3a OG meta widget 含短網域 + 重複貼文文字（story_message 同階 sibling，非 mainMsg 同階）
    assert.ok(!container.textContent.includes('m7NKy5VBX1.com'),
      'OG meta widget 短網域不可殘留（Nathan Chiu 貼文實機看到的「m7NKy5VBX1.com / Jimmy Su / 重複內容」block）');
    // fixture i=3 reactions block 含「3,497」/「950 次分享」（story_message 同階 sibling）
    assert.ok(!container.textContent.includes('3,497'),
      'reactions 計數不可殘留');
    assert.ok(!container.textContent.includes('950 次分享'),
      'share 計數不可殘留');
  });

  it('合成容器內不含留言（pruneReaderClone 移除全部 [role="article"]）', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    const container = env.NS.fbPost.enter();
    assert.strictEqual(container.querySelectorAll('[role="article"]').length, 0,
      'pruneReaderClone 必須移除所有留言 [role="article"]');
    assert.ok(!container.textContent.includes('對岸用殘體中文'),
      '留言文字不可殘留在合成容器內');
  });

  it('找不到主貼文 container 時 enter() 回 null（不注入容器）', () => {
    const env = setupJsdom('https://www.facebook.com/u/posts/123',
      '<!doctype html><html><body><main></main></body></html>');
    const container = env.NS.fbPost.enter();
    assert.strictEqual(container, null);
    assert.strictEqual(env.document.querySelector('[data-jread-fb-reader]'), null);
  });

  it('enter() 重複呼叫不會注入第二份容器（冪等）', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    env.NS.fbPost.enter();
    env.NS.fbPost.enter();
    const containers = env.document.querySelectorAll('[data-jread-fb-reader]');
    assert.strictEqual(containers.length, 1, '重複 enter 必須冪等');
  });
});

describe('fb-post v0.7.157 — exit() 清合成容器', () => {
  it('exit() 移除合成容器', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    env.NS.fbPost.enter();
    assert.ok(env.NS.fbPost.isActive(), 'enter 後 isActive=true');
    env.NS.fbPost.exit();
    assert.strictEqual(env.NS.fbPost.isActive(), false, 'exit 後 isActive=false');
    assert.strictEqual(env.document.querySelector('[data-jread-fb-reader]'), null,
      'exit 後合成容器必須消失');
  });

  it('exit() 沒 enter 過時也安全（不丟例外）', () => {
    const env = setupJsdom('https://www.facebook.com/');
    assert.doesNotThrow(() => env.NS.fbPost.exit());
  });
});

describe('fb-post v0.7.157 — detector.detect() FB 短路', () => {
  it('FB permalink URL → detect() 回 isFbPost=true / el=null / strategy=fb-post / confidence=1', () => {
    const env = setupJsdom('https://www.facebook.com/drdavidchen/posts/pfbid02', FIXTURE);
    env.window.eval(DETECTOR_SRC);
    const result = env.NS.detector.detect();
    assert.ok(result, 'FB permalink URL 不應 no-op');
    assert.strictEqual(result.isFbPost, true,
      'detect() 必須帶 isFbPost=true（main.js 依此判斷走 enterFbPostMode）');
    assert.strictEqual(result.strategy, 'fb-post');
    assert.strictEqual(result.confidence, 1);
    assert.strictEqual(result.el, null,
      'FB permalink 場景 el=null——合成容器在 main.js enterFbPostMode 才建立');
  });

  it('非 FB 站 URL → detect() 不回 isFbPost', () => {
    const env = setupJsdom('https://example.com/article');
    env.window.eval(DETECTOR_SRC);
    const result = env.NS.detector.detect();
    if (result) {
      assert.notStrictEqual(result.isFbPost, true);
    }
  });

  it('FB 首頁（非 /posts/）→ detect() 不回 isFbPost', () => {
    const env = setupJsdom('https://www.facebook.com/');
    env.window.eval(DETECTOR_SRC);
    const result = env.NS.detector.detect();
    if (result) {
      assert.notStrictEqual(result.isFbPost, true);
    }
  });
});

describe('fb-post v0.7.157 — detector.probe() FB siteMode', () => {
  it('FB permalink URL → probe() 回 siteMode=fb-post', () => {
    const env = setupJsdom('https://www.facebook.com/u/posts/123');
    env.window.eval(DETECTOR_SRC);
    const probe = env.NS.detector.probe();
    assert.strictEqual(probe.siteMode, 'fb-post');
  });

  it('detector.js probe() 內必須含 NS.fbPost.isFacebookPost check + return siteMode=fb-post', () => {
    assert.match(DETECTOR_SRC, /isFacebookPost[\s\S]{0,200}siteMode:\s*['"]fb-post['"]/,
      'detector.probe() 必須對 NS.fbPost.isFacebookPost() 命中時回 siteMode=fb-post');
  });
});

describe('fb-post v0.7.157 — main.js 整合', () => {
  it('main.js 必須含 enterFbPostMode helper', () => {
    assert.match(MAIN_SRC, /function\s+enterFbPostMode\s*\(/,
      'main.js 缺 enterFbPostMode async function');
  });

  it('main.js enterReaderMode 必須依 result.isFbPost dispatch 到 enterFbPostMode', () => {
    assert.match(MAIN_SRC, /result\.isFbPost[\s\S]{0,200}enterFbPostMode\s*\(/,
      'enterReaderMode 內必須有 if (result.isFbPost) return enterFbPostMode() 分支');
  });

  it('main.js enterFbPostMode 必須呼叫 NS.fbPost.enter() + 跳過 cleaner + 跑 styler', () => {
    // FB 合成容器跳過 cleaner.clean——fb-post.js pruneReaderClone 已做精準清理
    // （留言 / button / placeholder），通用 cleaner 對 FB 巢狀 emotion-hash
    // DIV 結構過於激進會誤殺主貼文文字 wrapper（v0.7.157 probe 實證）。
    assert.match(MAIN_SRC, /NS\.fbPost\.enter\s*\(/,
      'enterFbPostMode 內必須呼叫 NS.fbPost.enter()');
    const m = MAIN_SRC.match(/function\s+enterFbPostMode[\s\S]+?(?=\n\s{0,4}async\s+function|\n\s{0,4}function\s+\w|\n\s{0,4}let\s+enterInFlight)/);
    assert.ok(m, '抓不到 enterFbPostMode body');
    assert.doesNotMatch(m[0], /NS\.cleaner\s*\?\s*NS\.cleaner\.clean\s*\(\s*container/,
      'enterFbPostMode 必須跳過 cleaner.clean()——通用 cleaner 對 FB clone 過於激進會誤殺主貼文');
    assert.match(m[0], /NS\.state\.hiddenEls\s*=\s*\[\]/,
      'enterFbPostMode 必須將 hiddenEls 設為空陣列（沒跑 cleaner、無 snapshot）');
    assert.match(m[0], /NS\.styler\s*\?\s*NS\.styler\.apply\s*\(\s*container/,
      'enterFbPostMode 必須對合成容器呼叫 styler.apply(container)');
    assert.match(m[0], /strategy:\s*['"]fb-post['"]/,
      'enterFbPostMode 必須在 REPORT_DETECTION_RESULT 標 strategy=fb-post');
  });

  it('main.js exitReaderMode 必須呼叫 NS.fbPost.exit() 清合成容器', () => {
    assert.match(MAIN_SRC, /NS\.fbPost\s*&&[\s\S]{0,80}NS\.fbPost\.exit\s*\(/,
      'exitReaderMode 必須呼叫 NS.fbPost.exit() 清合成容器');
  });
});

describe('fb-post v0.7.157 — manifest content_scripts 載入順序', () => {
  it('manifest content_scripts 必須含 content/fb-post.js', () => {
    const js = MANIFEST.content_scripts[0].js;
    assert.ok(js.includes('content/fb-post.js'),
      'manifest content_scripts 必須註冊 fb-post.js');
  });

  it('fb-post.js 必須在 detector.js 之前載入（detector 依賴 NS.fbPost 存在）', () => {
    const js = MANIFEST.content_scripts[0].js;
    const fbIdx = js.indexOf('content/fb-post.js');
    const detectorIdx = js.indexOf('content/detector.js');
    assert.ok(fbIdx >= 0 && detectorIdx >= 0);
    assert.ok(fbIdx < detectorIdx,
      'fb-post.js 必須在 detector.js 之前（detector probe / detect 用 NS.fbPost.isFacebookPost）');
  });

  it('fb-post.js 必須在 namespace.js 之後載入（依賴 window.__JRead）', () => {
    const js = MANIFEST.content_scripts[0].js;
    const fbIdx = js.indexOf('content/fb-post.js');
    const nsIdx = js.indexOf('content/namespace.js');
    assert.ok(nsIdx >= 0 && fbIdx >= 0);
    assert.ok(nsIdx < fbIdx,
      'namespace.js 必須在 fb-post.js 之前（fb-post.js IIFE 開頭讀 window.__JRead）');
  });
});
