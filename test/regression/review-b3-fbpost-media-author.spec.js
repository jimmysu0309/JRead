// JRead — v1.7.41（review 批次 3 F1 + F2）：fb-post 附圖保留 + 作者選取單一資料源
// -----------------------------------------------------------------------------
// F1：pruneReaderClone 兩階段自相矛盾——第一階段沿 mainMsg 祖先鏈刻意保留的
//     純媒體 wrapper（含自建 data-jread-fb-media 容器），位在 clone 直系子層級
//     時被第二階段「空文字即移除」無差別清掉 → 附圖結構性消失。修法：空文字
//     移除前豁免含 img/picture/video 或 data-jread-fb-media 的子樹。
// F2：作者選取雙 path——findPostContainer 內 findAuthorForMessage 已算好
//     「距 message 最近」的作者節點卻丟棄，enter() 重新 querySelector 取 DOM
//     第一個 profile_name（分享貼文會抓到被分享貼文的作者）。修法：
//     findPostContext 回傳 { container, mainMsg, author } 三元組，enter() 沿用；
//     findPostContainer 保留舊契約（element | null）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const FBPOST_SRC    = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'fb-post.js'), 'utf8');
const NAMESPACE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');

function setupJsdom(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml || ''}</body></html>`, {
    url: 'https://www.facebook.com/someone/posts/pfbid0abc',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }) } };
  window.eval(NAMESPACE_SRC);
  window.eval(FBPOST_SRC);
  return { window, document: window.document, NS: window.__JRead };
}

const LONG_MSG = '這是主貼文的完整內容，字數足夠通過 findMainMessage 的長度篩選門檻，' +
  '描述一段生活觀察與心得，持續補充細節讓文字長度明顯超過側欄推薦的截斷訊息。';

describe('fb-post v1.7.41 — 直系子層級的純媒體 wrapper 不可被空文字清除（F1）', () => {
  it('clone 直系子的無文字附帶圖 wrapper 必須存活 pruneReaderClone', () => {
    const { document, NS } = setupJsdom();
    const clone = document.createElement('div');
    const msgWrap = document.createElement('div');
    const msg = document.createElement('div');
    msg.setAttribute('data-ad-comet-preview', 'message');
    msg.textContent = LONG_MSG;
    msgWrap.appendChild(msg);
    clone.appendChild(msgWrap);
    // 直系子層級的純媒體 wrapper：零文字、含 img——第一階段（祖先鏈 sibling
    // 掃描）linkRatio 低 + 含媒體 → 刻意保留；舊版第二階段「!text 即 remove」
    // 把它清掉
    const mediaWrap = document.createElement('div');
    const img = document.createElement('img');
    img.src = 'https://scontent.xx.fbcdn.net/photo.jpg';
    mediaWrap.appendChild(img);
    clone.appendChild(mediaWrap);
    NS.fbPost.pruneReaderClone(clone, null);
    assert.ok(clone.contains(mediaWrap),
      '純媒體 wrapper 被第二階段空文字清除——附帶圖結構性消失');
    assert.ok(clone.querySelector('img'), '附帶圖必須保留');
  });

  it('data-jread-fb-media 容器（share-preview unwrap 產物）同樣必須存活', () => {
    const { document, NS } = setupJsdom();
    const clone = document.createElement('div');
    const msgWrap = document.createElement('div');
    const msg = document.createElement('div');
    msg.setAttribute('data-ad-comet-preview', 'message');
    msg.textContent = LONG_MSG;
    msgWrap.appendChild(msg);
    clone.appendChild(msgWrap);
    const fbMedia = document.createElement('div');
    fbMedia.setAttribute('data-jread-fb-media', '1');
    const img = document.createElement('img');
    img.src = 'https://scontent.xx.fbcdn.net/preview.jpg';
    fbMedia.appendChild(img);
    clone.appendChild(fbMedia);
    NS.fbPost.pruneReaderClone(clone, null);
    assert.ok(clone.contains(fbMedia),
      'data-jread-fb-media 容器被空文字清除——第一階段自建的保留容器被第二階段打掉');
  });

  it('對照組：無媒體的空殼 wrapper 仍要被清（豁免不過寬）', () => {
    const { document, NS } = setupJsdom();
    const clone = document.createElement('div');
    const msgWrap = document.createElement('div');
    const msg = document.createElement('div');
    msg.setAttribute('data-ad-comet-preview', 'message');
    msg.textContent = LONG_MSG;
    msgWrap.appendChild(msg);
    // 空殼放在 msgWrap **之前**——第一階段只掃 nextElementSibling，前置空殼
    // 會存活到第二階段，才能驗到「!text 移除」豁免沒有過寬
    const shell = document.createElement('div');
    shell.appendChild(document.createElement('div'));
    clone.appendChild(shell);
    clone.appendChild(msgWrap);
    NS.fbPost.pruneReaderClone(clone, null);
    assert.ok(!clone.contains(shell), '無媒體的空殼 wrapper 必須照清');
  });
});

describe('fb-post v1.7.41 — 作者選取單一資料源（F2）', () => {
  function buildSharedPostDom() {
    // 分享貼文結構：DOM order 第一個 profile_name 是「被分享貼文的作者」
    //（在含大量文字的 shared 區塊內），真作者的 profile_name 與 mainMsg 同包
    // 在較小的 post 區塊——findAuthorForMessage 以共同祖先 textLen 最小者勝出
    return `
      <div id="unit">
        <div id="shared">
          <span data-ad-rendering-role="profile_name" id="p-shared">被分享的原作者</span>
          <div>${'被分享貼文的預覽文字，重複灌長讓共同祖先 textLen 明顯變大。'.repeat(20)}</div>
        </div>
        <div id="post">
          <span data-ad-rendering-role="profile_name" id="p-real">真正的貼文作者</span>
          <div data-ad-comet-preview="message">${LONG_MSG}</div>
        </div>
      </div>`;
  }

  it('findPostContext 必須回傳 findAuthorForMessage 選出的作者（非 DOM 第一個）', () => {
    const { document, NS } = setupJsdom(buildSharedPostDom());
    const ctx = NS.fbPost.findPostContext();
    assert.ok(ctx, 'findPostContext 必須回三元組');
    assert.strictEqual(ctx.author, document.getElementById('p-real'),
      'author 必須是距 mainMsg 最近的 profile_name——DOM 第一個是被分享貼文的作者');
    assert.strictEqual(ctx.container, document.getElementById('post'),
      'container 必須是 mainMsg 與正確作者的最近共同祖先');
    assert.ok(ctx.mainMsg && ctx.mainMsg.getAttribute('data-ad-comet-preview') === 'message');
  });

  it('findPostContainer 舊契約不變（element | null）', () => {
    const { document, NS } = setupJsdom(buildSharedPostDom());
    assert.strictEqual(NS.fbPost.findPostContainer(), document.getElementById('post'));
    const empty = setupJsdom('');
    assert.strictEqual(empty.NS.fbPost.findPostContainer(), null);
  });

  it('結構 forcing：enter() 必須沿用 ctx.author / ctx.mainMsg，不得重新 querySelector 作者', () => {
    const m = FBPOST_SRC.match(/function enter\(\)[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 enter()');
    assert.match(m[0], /const ctx = findPostContext\(\)/, 'enter() 必須走 findPostContext');
    assert.match(m[0], /const author = ctx\.author/, 'enter() 的 author 必須沿用 ctx.author');
    assert.ok(!/container\.querySelector\('\[data-ad-rendering-role="profile_name"\]'\)/.test(m[0]),
      'enter() 不得再對 container 重新 querySelector profile_name（雙 path drift 根源）');
  });
});
