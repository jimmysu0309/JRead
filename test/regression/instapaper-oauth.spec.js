// JRead — Instapaper OAuth 1.0a 簽章（v1.6.0）
// lib/instapaper.js 的純函式：RFC 3986 percent-encode、RFC 5849 參數正規化 /
// base string / signing key、HMAC-SHA1 簽章、authHeader 組裝。這是「送到 /
// 讀入 Instapaper」的認證基礎，簽錯一個字元整包被 401 退——高價值守門。
// 移植自姊妹專案 Shinkansen（已實測可用），此處以固定 nonce/timestamp + 注入
// signImpl 做確定性斷言，不需真 consumer key。

const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const IP = require(path.join(__dirname, '..', '..', 'jread', 'lib', 'instapaper.js'));

describe('instapaper-oauth: oauthPercentEncode（RFC 3986）', () => {
  it('unreserved 不編碼、! * \' ( ) 補編成 %XX', () => {
    assert.strictEqual(IP.oauthPercentEncode("aAzZ09-_.~"), "aAzZ09-_.~");
    assert.strictEqual(IP.oauthPercentEncode("a!b*c'd(e)"), "a%21b%2Ac%27d%28e%29");
  });
  it('空白 → %20（非 +）、中文逐 byte %XX', () => {
    assert.strictEqual(IP.oauthPercentEncode("a b"), "a%20b");
    assert.strictEqual(IP.oauthPercentEncode("中"), "%E4%B8%AD");
  });
  // v1.7.42（review I1）：lone surrogate（標題被上游截半的 emoji 等來源）原本
  // 會讓 encodeURIComponent throw URIError、一路被上層誤分類成 NETWORK。
  // 修法：編碼前把不成對的 surrogate 換成 U+FFFD（%EF%BF%BD）。
  it('lone surrogate 不 throw、替換成 U+FFFD 編碼', () => {
    // lone high surrogate（截半 emoji 的典型殘骸）
    assert.strictEqual(IP.oauthPercentEncode('a\uD83Db'), 'a%EF%BF%BDb');
    // lone low surrogate
    assert.strictEqual(IP.oauthPercentEncode('a\uDC00b'), 'a%EF%BF%BDb');
    // 字串尾端截半（真實場景：標題長度截斷剛好切在 pair 中間）
    assert.strictEqual(IP.oauthPercentEncode('title\uD83D'), 'title%EF%BF%BD');
  });
  it('合法 surrogate pair（完整 emoji）不受影響', () => {
    // 😀 U+1F600 = 😀 → UTF-8 F0 9F 98 80
    assert.strictEqual(IP.oauthPercentEncode('😀'), '%F0%9F%98%80');
    assert.strictEqual(IP.oauthPercentEncode('a😀b'), 'a%F0%9F%98%80b');
  });
});

describe('instapaper-oauth: normalizeOAuthParams（字典序 + 編碼）', () => {
  it('依編碼後 key 字典序排序，key=value 以 & 連接', () => {
    const out = IP.normalizeOAuthParams({ b: '2', a: '1', c: '3' });
    assert.strictEqual(out, 'a=1&b=2&c=3');
  });
  it('value 含特殊字元先各自編碼', () => {
    const out = IP.normalizeOAuthParams({ url: 'https://x.com/a b', title: 'a&b' });
    assert.strictEqual(out, 'title=a%26b&url=https%3A%2F%2Fx.com%2Fa%20b');
  });
});

describe('instapaper-oauth: base string / signing key', () => {
  it('base string = METHOD&pctEncode(URL)&pctEncode(normalized params)', () => {
    const bs = IP.buildOAuthBaseString({
      method: 'post', url: 'https://www.instapaper.com/api/1/bookmarks/add',
      params: { url: 'https://x.com', oauth_nonce: 'abc' }
    });
    assert.strictEqual(bs,
      'POST&https%3A%2F%2Fwww.instapaper.com%2Fapi%2F1%2Fbookmarks%2Fadd&oauth_nonce%3Dabc%26url%3Dhttps%253A%252F%252Fx.com');
  });
  it('signing key = pctEncode(consumerSecret)&pctEncode(tokenSecret)', () => {
    assert.strictEqual(IP.buildOAuthSigningKey({ consumerSecret: 'cs', tokenSecret: 'ts' }), 'cs&ts');
    assert.strictEqual(IP.buildOAuthSigningKey({ consumerSecret: 'c s', tokenSecret: '' }), 'c%20s&');
  });
});

describe('instapaper-oauth: signRequest（authHeader 組裝）', () => {
  it('固定 nonce/timestamp + 注入 signImpl → authHeader 含排序 oauth 參數 + signature', async () => {
    const { authHeader, baseString } = await IP.signRequest({
      method: 'POST', url: 'https://www.instapaper.com/api/1/bookmarks/add',
      consumerKey: 'ck', consumerSecret: 'cs', token: 'tok', tokenSecret: 'ts',
      bodyParams: { url: 'https://x.com' },
      nonce: 'NONCE', timestamp: 1700000000,
      signImpl: async () => 'SIGVALUE'
    });
    // header 只列 oauth_ 參數（不含 bodyParams），字典序、值 pctEncode 後包雙引號
    assert.ok(authHeader.startsWith('OAuth '));
    assert.match(authHeader, /oauth_consumer_key="ck"/);
    assert.match(authHeader, /oauth_nonce="NONCE"/);
    assert.match(authHeader, /oauth_signature_method="HMAC-SHA1"/);
    assert.match(authHeader, /oauth_timestamp="1700000000"/);
    assert.match(authHeader, /oauth_token="tok"/);
    assert.match(authHeader, /oauth_version="1.0"/);
    assert.match(authHeader, /oauth_signature="SIGVALUE"/);
    // bodyParams（url）納入 base string 但不進 header
    assert.ok(!/url=/.test(authHeader.replace(/oauth_\w+/g, '')));
    assert.ok(baseString.includes('url%3Dhttps'));
  });
  it('無 token（xAuth 換取階段）不列 oauth_token', async () => {
    const { authHeader } = await IP.signRequest({
      method: 'POST', url: 'https://www.instapaper.com/api/1/oauth/access_token',
      consumerKey: 'ck', consumerSecret: 'cs', token: null, tokenSecret: null,
      bodyParams: { x_auth_mode: 'client_auth' },
      nonce: 'N', timestamp: 1, signImpl: async () => 'S'
    });
    assert.ok(!/oauth_token=/.test(authHeader), '無 token 時不該列 oauth_token');
  });
});

describe('instapaper-oauth: defaultSign（HMAC-SHA1 → base64）', () => {
  it('與 node:crypto createHmac(sha1) 一致', async () => {
    // defaultSign 用 crypto.subtle（Node 20+ 有 global crypto.subtle）；比對 node:crypto
    if (!(globalThis.crypto && globalThis.crypto.subtle)) return; // 環境無 subtle 則跳過
    const signingKey = 'cs&ts';
    const baseString = 'POST&https%3A%2F%2Fx.com&a%3D1';
    const got = await IP.defaultSign(signingKey, baseString);
    const expected = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    assert.strictEqual(got, expected);
  });
});

describe('instapaper-oauth: encodeFormBody', () => {
  it('用 oauthPercentEncode（space→%20，與 base string 一致）', () => {
    assert.strictEqual(IP.encodeFormBody({ a: 'x y', b: 'a&b' }), 'a=x%20y&b=a%26b');
  });
});

describe('instapaper-oauth: parseTokenResponse', () => {
  it('解析 oauth_token / oauth_token_secret', () => {
    assert.deepStrictEqual(
      IP.parseTokenResponse('oauth_token=T&oauth_token_secret=S'),
      { token: 'T', tokenSecret: 'S' });
  });
  it('缺欄位回 null', () => {
    assert.strictEqual(IP.parseTokenResponse('oauth_token=T'), null);
    assert.strictEqual(IP.parseTokenResponse(''), null);
  });
});
