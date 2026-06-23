#!/usr/bin/env node
// Page Rounds harness — JRead 批次視覺驗收 Playwright 工具
// -----------------------------------------------------------------------------
// 對單一 URL 執行完整 A-F 視覺驗收流程，產出 5 組分頁截圖 + audit.json。
// Claude 用 Read tool 看截圖做視覺判定——截圖是主角，audit 是輔助信號。
// audit 邏輯與 NOISE_AUDIT_KEYWORDS 在 tools/audit-lib.js（與 debug-harness
// 共用單一資料源，v0.8.39 抽出）。
//
// 用法：
//   JREAD_URL="https://udn.com/..." node tools/page-rounds-harness.js
//   node tools/page-rounds-harness.js --url "https://udn.com/..."
//   node tools/page-rounds-harness.js --keep    # 跑完不關瀏覽器
//   node tools/page-rounds-harness.js --profile miniflux --login --url https://site/  # Tier 2 一次性登入
//   node tools/page-rounds-harness.js --profile miniflux --url https://site/entry/...  # 帶登入態跑驗收
//
// --profile <name>（Tier 2，需登入態的站）：用 ~/.jread-debug/profiles/<name>
// 持久 profile 取代預設 /tmp 暫存 profile，登入態跨 run 留存（與 debug-harness
// 共用同一 profile 目錄，登入過一次兩支工具都帶登入態）。不給時維持舊行為。
// --login：搭配 --profile，headed 開站讓 Jimmy 手動登入一次後關視窗，跳過所有驗收。
//
// 輸出：
//   docs/excluded/page-rounds/<pass|review|failed|blocked>/<hostname>_<path-hash>/
//     original-page-01.png   — 原頁面（reader mode 前）
//     light-page-01.png      — reader mode 亮色
//     delayed-page-01.png    — 5s 後（C7 延遲雜訊比對）
//     dark-page-01.png       — 暗色模式（set-theme 經 SW gate 驗證實際套上）
//     restored-page-01.png   — 退出 reader mode 後
//     audit.json             — 輔助信號 + failReasons / reviewReasons
//
// verdict 四態（2026-06-11 誤報 / 誤放整治——舊 binary pass/fail 把高低精度
// 信號混在一起，12 FAIL 內 5 假陽性 + 3 bot-block，fail 桶失去鑑別力）：
//   pass    — 全部信號乾淨（Claude 仍應抽看 light-page-01 首屏）
//   review  — 只命中低精度信號（contextual residual / hero / links /
//             retention），需 Claude 看截圖判定真偽，截圖保留
//   failed  — 命中高精度信號（strict residual / overflow / contrast /
//             narrowText / gap>=200(delayed) / theme / restore），近乎必為真 bug
//   blocked — bot challenge / 空頁，環境問題非 JRead bug，改用 cage 重測
// -----------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const crypto = require('crypto');
const os = require('os');

const audits = require(path.join(__dirname, 'audit-lib.js'));
const { NOISE_KEYWORD_TIERS } = audits;

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_PATH = path.join(PROJECT_ROOT, 'jread');

// ---- CLI 參數 ----
const urlArg = process.argv.find((a, i) => a === '--url' && process.argv[i + 1]);
const TARGET_URL = (urlArg ? process.argv[process.argv.indexOf('--url') + 1] : null)
  || process.env.JREAD_URL
  || 'https://www.chinatalk.media/p/best-books-q1-2026';
const KEEP = process.argv.includes('--keep');

// --profile <name>：用 ~/.jread-debug/profiles/<name> 持久 profile（與 debug-harness
// 共用），登入態跨 run 留存。不給時用 /tmp 暫存 profile（每跑必清，無登入態）。
const profileArgIdx = process.argv.indexOf('--profile');
const PROFILE_NAME = (profileArgIdx >= 0 && process.argv[profileArgIdx + 1]) || null;
// --login：搭配 --profile，headed 開站手動登入一次後關視窗，跳過驗收。
const LOGIN = process.argv.includes('--login');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// bot challenge / 封鎖頁標記（lowercase 比對 title + innerText 前 3000 chars）。
// 用高特異性片語——bare 'cloudflare' 不行，談 Cloudflare 的文章會誤中。
const BLOCK_PAGE_MARKERS = [
  'just a moment', 'checking your browser', 'verify you are human',
  'you have been blocked', 'attention required', 'access denied',
  'enable javascript and cookies', 'pardon our interruption',
  'cloudflare ray id', 'performance & security by cloudflare',
  '請完成驗證', '安全驗證'
];

// 偵測目前頁面是否為 bot challenge / 封鎖頁（toggle 前 + reader 未啟動時各跑一次）
function checkBlockSignal(page) {
  return page.evaluate((markers) => {
    const text = ((document.title || '') + ' ' +
      (document.body ? document.body.innerText.slice(0, 3000) : '')).toLowerCase();
    return {
      hits: markers.filter(m => text.includes(m)),
      bodyTextLen: document.body ? document.body.innerText.replace(/\s+/g, '').length : 0
    };
  }, BLOCK_PAGE_MARKERS);
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
}

function outDirName(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const hash = crypto.createHash('md5').update(u.pathname).digest('hex').slice(0, 6);
    return `${host}_${hash}`;
  } catch { return 'unknown'; }
}

// zoom 切換 helper：量 rect 的 audit 必須在 zoom 1.0 下跑（0.5 會把 rect 全
// 砍半）；截圖在 0.5 下拍。v0.8.39 起需要 zoom 1.0 的 audit 集中在同一個
// block 跑（舊版 hero / narrowText / figcaption / bodyWidth 各自切一輪，
// 來回 5 次白吃 reflow）。
async function setZoom(page, z) {
  await page.evaluate((v) => { document.body.style.zoom = v; }, String(z));
  await sleep(200);
}

(async () => {
  const hostname = hostnameOf(TARGET_URL);
  const dirName = outDirName(TARGET_URL);
  const PR_ROOT = path.join(PROJECT_ROOT, 'docs', 'excluded', 'page-rounds');

  // 清舊截圖（可能在任一 verdict 目錄下）
  for (const sub of ['pass', 'review', 'failed', 'blocked']) {
    const old = path.join(PR_ROOT, sub, dirName);
    if (fs.existsSync(old)) fs.rmSync(old, { recursive: true });
  }
  // 暫存到 _wip/ 下，跑完 audit 後再移到 pass/ 或 failed/
  const outDir = path.join(PR_ROOT, '_wip', dirName);
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const PROFILE_DIR = PROFILE_NAME
    ? path.join(os.homedir(), '.jread-debug', 'profiles', PROFILE_NAME)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'jread-pr-'));
  if (PROFILE_NAME) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log(`Page Rounds: ${TARGET_URL}`);
  console.log(`Output: ${outDir}`);

  // ---- 1. 啟動 Chromium + extension ----
  // --login 必須 headed + 視窗上螢幕讓 Jimmy 登入；其餘推到螢幕外背景跑。
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      LOGIN ? '--window-position=40,40' : '--window-position=-2400,-2400',
      ...(LOGIN ? [] : ['--headless=new'])
    ]
  });

  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  if (!sw) { console.error('ERROR: service worker 未啟動'); process.exit(1); }
  console.log('SW ready:', sw.url());

  // 關掉 about:blank
  for (const p of ctx.pages()) { try { await p.close(); } catch {} }
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message.slice(0, 200)));

  // ---- 2. 開頁面 ----
  console.log('Loading:', TARGET_URL);
  try {
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 60000 });
  } catch (e) {
    console.log('load timeout, fallback domcontentloaded:', e.message.slice(0, 80));
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await sleep(2500);

  // ===== --login 短路（Tier 2 一次性登入）=====
  // 純粹開站讓 Jimmy 在螢幕上手動登入，跳過 toggle + 所有 audit + 截圖。
  // 登入完成後關閉視窗即可——session 寫進該 --profile，之後同 --profile 的
  // 背景跑（螢幕外）會自動帶登入態。
  if (LOGIN) {
    if (!PROFILE_NAME) {
      console.error('⚠️  --login 必須搭配 --profile <name>，否則登入態存進 /tmp 重開機就沒了');
    }
    console.log('\n===== LOGIN 模式 =====');
    console.log(`profile: ${PROFILE_DIR}`);
    console.log('視窗已開在螢幕左上角，請在裡面手動登入這個站台。');
    console.log('登入完成後直接關閉該 Chromium 視窗即可（session 會留存）。');
    console.log(`之後驗收跑：node tools/page-rounds-harness.js --profile ${PROFILE_NAME || '<name>'} --url <文章URL>`);
    console.log('======================\n');
    await new Promise((resolve) => ctx.on('close', resolve));
    console.log('視窗已關閉，登入態已存入 profile。');
    return;
  }

  // ---- 3. 原頁截圖 ----
  console.log('Phase: original');
  await setZoom(page, 0.5);
  await sleep(100);
  await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'original' });

  // ---- 3.5. 擷取原頁 hero images（zoom 還原到 1.0 量原始 rect）+ 原頁文字量 ----
  await setZoom(page, 1);
  const originalHeroImages = await audits.captureOriginalHeroImages(page);
  console.log(`  hero images found: ${originalHeroImages.length}`);
  // 內文掉圖 audit：toggle 前標記內容圖候選（高精度窄版，見 audit-lib 頭註解）。
  // 補 hero audit 的洞——hero 只驗頂端前 3 張，文章深處內容圖被誤殺抓不到。
  const taggedFigures = await audits.tagOriginalContentFigures(page);
  console.log(`  content figures tagged: ${taggedFigures}`);
  // 誤殺長段落 audit：toggle 前標記可見 leaf 長散文塊（高精度位置無關，補 retention
  // 全域純量的洞——v0.8.168 Miniflux 開頭 502 chars 被誤殺仍 retention 76% 漏抓）。
  const taggedProse = await audits.tagOriginalLongProse(page);
  console.log(`  long-prose blocks tagged: ${taggedProse}`);
  // B3 基準：原頁 visible p 文字總量（retention ratio 用，見 audit-lib 頭註解）
  const originalTextStats = await audits.collectOriginalTextStats(page);
  console.log(`  original p text: ${originalTextStats.pTextLength} chars (${originalTextStats.pCount} p)`);
  await setZoom(page, 0.5);

  const audit = { url: TARGET_URL, hostname, dirName, readerModeActive: false,
    originalTextStats, blockSignal: null,
    contentStats: null, residual: { initial: null, delayed: null },
    links: null, retention: null,
    gaps: { initial: null, delayed: null },
    contrast: { light: null, dark: null },
    theme: { dark: null, lightRestore: null },
    overflow: null, tail: null, restored: null, droppedFigures: null,
    droppedProse: null, titlePresence: null,
    failReasons: [], reviewReasons: [] };

  // verdict 收尾共用：寫 audit.json、移目錄、印 VERDICT 行（batch script 解析這行）
  function finalize(verdict) {
    audit.verdict = verdict;
    fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 2));
    const finalDir = path.join(PR_ROOT, verdict, dirName);
    fs.mkdirSync(path.join(PR_ROOT, verdict), { recursive: true });
    fs.renameSync(outDir, finalDir);
    try { fs.rmdirSync(path.join(PR_ROOT, '_wip')); } catch {}
    const mark = { pass: '✅ PASS', review: '🔍 REVIEW', failed: '❌ FAIL', blocked: '⛔ BLOCKED' }[verdict];
    console.log(`\nVERDICT: ${verdict}${audit.failReasons.length ? ' fail=[' + audit.failReasons.join(', ') + ']' : ''}${audit.reviewReasons.length ? ' review=[' + audit.reviewReasons.join(', ') + ']' : ''}`);
    console.log(`${mark}\nDone. Screenshots in: ${finalDir}`);
    return finalDir;
  }

  // ---- 3.7. 封鎖頁偵測（toggle 前）----
  // 必須在 toggle 前跑：封鎖頁也有標題 + 段落，detector 會把它當主文、
  // reader mode 照樣啟動且全信號乾淨直接 pass（thenewslens Cloudflare
  // 封鎖頁判 pass 的誤放實案）。這裡只看 marker、不看文字量——SPA 慢 render
  // 的低文字量不該在這層誤判成 blocked
  audit.blockSignal = await checkBlockSignal(page);
  if (audit.blockSignal.hits.length > 0) {
    console.log(`WARNING: 封鎖頁標記命中 [${audit.blockSignal.hits.join(', ')}]——bot challenge / 封鎖頁，不進 reader mode`);
    audit.reviewReasons.push(`bot-block: ${audit.blockSignal.hits.join(',')}`);
    finalize('blocked');
    if (!KEEP) await ctx.close();
    return;
  }

  // ---- 4. 進入 reader mode ----
  const tabId = await sw.evaluate(async (u) => {
    const ts = await chrome.tabs.query({});
    return (ts.find(t => t.url === u) || ts.find(t => t.url && !t.url.startsWith('chrome')))?.id;
  }, TARGET_URL);

  if (!tabId) { console.error('ERROR: 找不到 tab'); process.exit(1); }

  // v0.8.40：清掉閱讀位置記憶——profile 跨 run 重用，上一輪同 URL 的記錄會讓
  // enter 直接跳回上次位置（分頁截圖預期從第 1 頁起、audit 預期從頁首掃起）
  await sw.evaluate(() => chrome.storage.local.remove('readingPositions'));

  // 2026-06-11：enter 前必須還原 zoom 1.0——cleaner / styler 的所有 rect 判定
  // （icon-link 門檻、content-img 200px、header zone 32px、sidebar 高度等）
  // 會在 body zoom 0.5 下全部減半失真。dev.to 實證：cover（zoom 0.5 下高
  // 128 < content-img 門檻 200）被當 icon link 誤殺、hero audit 報 missing
  // ——Jimmy 實機（zoom 1.0 enter）完全正常。真實使用者不會在 body zoom
  // 0.5 下 enter，harness 必須在同條件下觸發。light 截圖前再切回 0.5。
  await setZoom(page, 1);

  const toggle = await sw.evaluate(async (id) => {
    try { return { ok: true, res: await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' }) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, tabId);
  console.log('toggle enter:', JSON.stringify(toggle));
  await sleep(1200);

  // ---- 5. 確認 reader mode 啟動 ----
  const readerActive = await page.evaluate(() => !!document.querySelector('[data-jread-active="1"]'));
  console.log('reader mode active:', readerActive);

  audit.readerModeActive = readerActive;

  if (!readerActive) {
    // 分流：bot challenge（toggle 後才 redirect / render 出來的）或空頁 =
    // 環境問題（blocked，非 JRead bug），其餘才是真 fail（detector no-op /
    // content script 沒起來）。舊版一律記 failed，Cloudflare 站混進真 bug
    // 堆要人工 triage（2026-05-27 報告 3 站）。
    const blockSignal = await checkBlockSignal(page);
    audit.blockSignal = blockSignal;
    const isBlocked = blockSignal.hits.length > 0 || blockSignal.bodyTextLen < 200;
    console.log(`WARNING: reader mode 未啟動（${isBlocked ? 'bot-block/空頁：' + (blockSignal.hits.join(',') || `bodyText=${blockSignal.bodyTextLen}`) : '頁面正常但 detector no-op'}），截圖供 Claude 判定`);
    await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'light' });
    if (isBlocked) audit.reviewReasons.push('bot-block-or-empty-page');
    else audit.failReasons.push('reader-mode-inactive');
    finalize(isBlocked ? 'blocked' : 'failed');
    if (!KEEP) await ctx.close();
    return;
  }

  // ---- 6. 亮色截圖 ----
  console.log('Phase: light');
  await setZoom(page, 0.5); // enter 在 zoom 1.0 跑（rect 判定不可失真），截圖回 0.5
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'light' });

  // ---- 7. Residual + links + gap + contrast audit（輔助信號）----
  audit.contentStats = await audits.runContentStats(page);
  audit.residual.initial = await audits.runResidualText(page, NOISE_KEYWORD_TIERS);
  audit.gaps.initial = await audits.runGapAudit(page);

  if (audit.residual.initial.warnings.length > 0) {
    console.log(`  ⚠️  residual warnings: ${audit.residual.initial.warnings.length}（strict ${audit.residual.initial.strictCount}）`);
    for (const w of audit.residual.initial.warnings.slice(0, 5)) {
      console.log(`    [${w.severity}] ${w.tag} "${w.text}" [${w.hitKeywords.join(', ')}]`);
    }
  } else {
    console.log('  ✅ residual: 無命中');
  }

  // 連結 / 按鈕殘留（C1）——debug-harness 一直有、page rounds 漏接的訊號層
  // （share/social class、社群 href、icon button 文字）。低精度 → review 信號
  audit.links = await audits.runResidualLinks(page, NOISE_KEYWORD_TIERS);
  if (audit.links.warnings.length > 0) {
    console.log(`  ⚠️  links/buttons 可疑: ${audit.links.warnings.length}`);
    for (const w of audit.links.warnings.slice(0, 5)) {
      console.log(`    ${w.tag} "${w.text}" cls="${w.cls.slice(0, 30)}" href="${w.href}"`);
    }
  } else {
    console.log('  ✅ links/buttons: 無可疑項');
  }

  // Retention（B3 信號）：reader 內 p 文字量 / 原頁 p 文字量。過低 = detector
  // 選錯容器 / cleaner 誤殺主文的疑點。留言 / 推薦也是 p、被合法清掉會拉低
  // ratio，所以是 review 信號不 fail；原頁 p 文字 < 800 chars（論壇 div 排版）跳過
  if (originalTextStats.pTextLength >= 800 && audit.contentStats) {
    const ratio = audit.contentStats.pTextLength / originalTextStats.pTextLength;
    audit.retention = { ratio: Math.round(ratio * 100) / 100,
      readerPText: audit.contentStats.pTextLength, originalPText: originalTextStats.pTextLength };
    if (ratio < 0.3) {
      console.log(`  ⚠️  retention: reader 僅保留原頁 ${Math.round(ratio * 100)}% p 文字（${audit.contentStats.pTextLength}/${originalTextStats.pTextLength}）——B3 疑點，看截圖確認主文完整`);
    } else {
      console.log(`  ✅ retention: ${Math.round(ratio * 100)}%（${audit.contentStats.pTextLength}/${originalTextStats.pTextLength}）`);
    }
  } else {
    console.log('  ℹ️  retention: 原頁 p 文字量不足，跳過判定');
  }
  if (audit.gaps.initial.gaps.length > 0) {
    console.log(`  ⚠️  gap warnings: ${audit.gaps.initial.gaps.length}`);
    for (const g of audit.gaps.initial.gaps.slice(0, 3)) {
      console.log(`    ${g.gap}px: ${g.prev} → ${g.next}`);
    }
  } else {
    console.log('  ✅ gaps: 無 >= 80px');
  }
  console.log('  content stats:', JSON.stringify(audit.contentStats));

  // 亮色 contrast audit（v0.8.39 新增——「東西在、看不見」類 bug residual /
  // gap / 截圖肉眼都容易漏，page rounds verdict 從此含對比訊號）
  audit.contrast.light = await audits.runContrastAudit(page);
  if (audit.contrast.light.warnings && audit.contrast.light.warnings.length > 0) {
    console.log(`  ⚠️  contrast (light): ${audit.contrast.light.warnings.length} 項 < 3:1`);
    for (const w of audit.contrast.light.warnings.slice(0, 3)) {
      console.log(`    ${w.ratio}:1 ${w.tag} fg=${w.color} bg=${w.bg} "${w.text}"`);
    }
  } else {
    console.log(`  ✅ contrast (light): 無 < 3:1（掃描 ${audit.contrast.light.scanned} 項）`);
  }

  // ---- 7b. Overflow audit（水平溢出）----
  audit.overflow = await audits.runOverflowAudit(page);
  if (audit.overflow.overflow) {
    const docOverflow = audit.overflow.docScrollWidth > audit.overflow.docClientWidth;
    if (docOverflow) {
      console.log(`  ⚠️  OVERFLOW (page): doc ${audit.overflow.docScrollWidth}px > viewport ${audit.overflow.docClientWidth}px, card ${audit.overflow.cardWidth}px`);
    } else {
      console.log(`  ⚠️  OVERFLOW (${audit.overflow.items.length} elements outside card): card ${audit.overflow.cardWidth}px`);
    }
    for (const it of audit.overflow.items.slice(0, 5)) {
      console.log(`    ${it.tag}.${it.cls.split(' ')[0]} width=${it.width}px overflow=${it.overflowPx}px "${it.text}"`);
    }
  } else {
    console.log('  ✅ overflow: 無水平溢出');
  }

  // ---- 7c. 需要 zoom 1.0 的 audit 集中跑（hero / narrowText / figcaption /
  // bodyWidth；v0.8.39 合併——舊版各自切 zoom 來回 5 次）----
  await setZoom(page, 1);

  if (originalHeroImages.length > 0) {
    await audits.waitForReaderImagesLoaded(page);
    audit.heroImage = await audits.runHeroImageAudit(page, originalHeroImages);
    if (audit.heroImage.missing.length > 0) {
      console.log(`  ⚠️  hero image missing: ${audit.heroImage.missing.length}/${audit.heroImage.originalCount}`);
      for (const m of audit.heroImage.missing) {
        console.log(`    MISSING: ${m.naturalW}x${m.naturalH} ${m.src?.slice(0, 80)}`);
      }
    } else {
      console.log(`  ✅ hero images: ${audit.heroImage.originalCount} found, all preserved`);
    }
  } else {
    console.log('  ℹ️  hero images: none detected on original page');
  }

  // 內文掉圖 audit（toggle 後 collect；tag 已在 toggle 前做）
  if (taggedFigures > 0) {
    audit.droppedFigures = await audits.runDroppedFigureAudit(page);
    if (audit.droppedFigures.dropped.length > 0) {
      console.log(`  ⚠️  內文掉圖: ${audit.droppedFigures.dropped.length}/${audit.droppedFigures.tagged}（cleaner 誤殺嫌疑）`);
      for (const d of audit.droppedFigures.dropped) {
        console.log(`    DROPPED: "${d.alt}" ${d.src?.slice(0, 70)}`);
      }
    } else {
      console.log(`  ✅ 內文掉圖: ${audit.droppedFigures.tagged} 張內容圖全保留`);
    }
  } else {
    console.log('  ℹ️  內文掉圖: 原頁無內容圖候選');
  }

  // 誤殺長段落（A，high-precision → fail）：cleaner 把 article 內可見長散文藏掉
  if (taggedProse > 0) {
    audit.droppedProse = await audits.runDroppedProseAudit(page);
    if (audit.droppedProse.dropped.length > 0) {
      console.log(`  ⚠️  誤殺長段落: ${audit.droppedProse.dropped.length}/${audit.droppedProse.tagged}（cleaner 吃掉主文散文）`);
      for (const d of audit.droppedProse.dropped) {
        console.log(`    DROPPED-PROSE <${d.tag}> "${d.text}"`);
      }
    } else {
      console.log(`  ✅ 長段落: ${audit.droppedProse.tagged} 塊主文散文全保留`);
    }
  } else {
    console.log('  ℹ️  長段落: 原頁無長散文候選');
  }

  // 標題進 reader card（B，review-tier）：article 標題文字要出現在 reader 可見內容
  audit.titlePresence = await audits.runTitlePresenceAudit(page);
  if (audit.titlePresence.checked) {
    if (audit.titlePresence.missing) {
      console.log(`  ⚠️  標題缺失: reader 可見內容找不到標題「${audit.titlePresence.title}」`);
    } else {
      console.log('  ✅ 標題: 已出現在 reader card');
    }
  } else {
    console.log('  ℹ️  標題: 無 og/doc title 基準或 reader 未啟動，跳過');
  }

  audit.narrowText = await audits.runNarrowTextAudit(page);
  if (audit.narrowText.narrow) {
    console.log(`  ⚠️  narrow text: ${audit.narrowText.narrowCount} paragraphs with < 10 chars/line`);
    for (const it of audit.narrowText.items.slice(0, 3)) {
      console.log(`    ${it.charsPerLine} chars/line (${it.lines} lines, ${it.chars} chars): "${it.text}"`);
    }
  } else {
    console.log('  ✅ narrow text: 無過窄段落');
  }

  audit.figcaption = await audits.runFigcaptionAudit(page);
  if (audit.figcaption.cramped) {
    console.log(`  ⚠️  figcaption cramped: ${audit.figcaption.crampedCount} captions < 50% of image width`);
    for (const it of audit.figcaption.items.slice(0, 3)) {
      console.log(`    ${it.fcWidth}px / ${it.refWidth}px = ${it.ratio}%: "${it.text}"`);
    }
  } else {
    console.log('  ✅ figcaption: 無過窄圖說');
  }

  // bodyWidth：補 narrowText 抓不到的中度縮窄（twreporter sidebar layout 實案）
  audit.bodyWidth = await audits.runBodyWidthAudit(page);
  if (audit.bodyWidth.narrow) {
    console.log(`  ⚠️  body width narrow: ${audit.bodyWidth.narrowCount}/${audit.bodyWidth.totalP} paragraphs < 80% of card (${audit.bodyWidth.narrowFraction}%)`);
    for (const s of (audit.bodyWidth.samples || []).slice(0, 3)) {
      console.log(`    ${s.pWidth}px (${s.ratio}% of ${audit.bodyWidth.cardWidth}px card): "${s.text}"`);
    }
  } else {
    console.log('  ✅ body width: 內文寬度正常');
  }

  await setZoom(page, 0.5);

  // ---- 7e. Tail audit（文末元素 dump）----
  audit.tail = await audits.runTailAudit(page);
  const tailItems = audit.tail.items;
  const tailLast = tailItems.slice(-10);
  console.log(`  tail audit: ${tailItems.length} items (last 20% of ${audit.tail.total}), showing last ${tailLast.length}:`);
  for (const t of tailLast) {
    console.log(`    ${t.tag}${t.cls ? '.' + t.cls.split(' ')[0] : ''} "${t.text}"`);
  }

  // ---- 8. 等 5s + scroll 觸發 lazy-load ----
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1000);

  // ---- 9. 延遲截圖（C7）----
  console.log('Phase: delayed');
  await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'delayed' });
  audit.residual.delayed = await audits.runResidualText(page, NOISE_KEYWORD_TIERS);
  audit.gaps.delayed = await audits.runGapAudit(page);

  if (audit.residual.delayed.warnings.length > 0) {
    console.log(`  ⚠️  delayed residual warnings: ${audit.residual.delayed.warnings.length}（strict ${audit.residual.delayed.strictCount}）`);
    for (const w of audit.residual.delayed.warnings.slice(0, 5)) {
      console.log(`    [${w.severity}] ${w.tag} "${w.text}" [${w.hitKeywords.join(', ')}]`);
    }
  } else {
    console.log('  ✅ delayed residual: 無命中');
  }

  // ---- 10. 暗色模式 ----
  // v0.8.36 起 set-theme 走 SW 中繼 + development install gate——dispatch 不
  // 保證生效。setThemeAndVerify poll card bg 變色才算 applied；沒套上仍照拍
  // 截圖（留證據）但 verdict 直接 fail——防「dark 截圖 silently 拍成亮色、
  // 五張全錯而綠燈」的偽陰性（v0.8.39 harness review 抓到的盲點）。
  console.log('Phase: dark');
  audit.theme.dark = await audits.setThemeAndVerify(page, 'dark');
  if (!audit.theme.dark.applied) {
    // SW gate / storage race 偶發——重試一次再定罪，避免環境抖動記成站點 FAIL
    console.log('  dark theme 第一次未套上，重試一次…');
    await sleep(800);
    audit.theme.dark = await audits.setThemeAndVerify(page, 'dark');
    audit.theme.dark.retried = true;
  }
  if (!audit.theme.dark.applied) {
    console.log(`  ⚠️  dark theme 未套上（bg ${audit.theme.dark.before} → ${audit.theme.dark.after}）——SW gate 拒絕或 storage race，dark 截圖不可信`);
  } else {
    console.log(`  ✅ dark theme applied（bg ${audit.theme.dark.before} → ${audit.theme.dark.after}）`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  // 第五輪調校：每頁截圖前重驗 theme 還在（cnbc 實證 SPA 捲動 re-render 把
  // dark 弄掉、page-02 起拍成亮色而 audit 全綠——E 層實際只驗到第一屏）。
  // 掉了就重套並記 reasserts，audit.json 留痕。
  audit.theme.dark.reasserts = 0;
  const darkBg = audit.theme.dark.after;
  await audits.takePagedScreenshots(page, {
    dir: outDir, prefix: 'dark',
    ensure: audit.theme.dark.applied ? (async () => {
      const bg = await page.evaluate(() => {
        const art = document.querySelector('[data-jread-active="1"]');
        return art ? getComputedStyle(art).backgroundColor : null;
      });
      if (bg && darkBg && bg !== darkBg) {
        audit.theme.dark.reasserts++;
        await audits.setThemeAndVerify(page, 'dark', 2500);
      }
    }) : undefined
  });
  if (audit.theme.dark.reasserts > 0) {
    console.log(`  ⚠️  dark theme 在分頁截圖期間掉了 ${audit.theme.dark.reasserts} 次，已重套（SPA re-render 競態）`);
  }

  // 暗色 contrast audit（v0.8.39 新增——對比 bug 常只在 dark 重現，tymscar
  // 教訓；dark theme 沒套上時跳過，量到的會是亮色數據沒意義）
  if (audit.theme.dark.applied) {
    audit.contrast.dark = await audits.runContrastAudit(page);
    if (audit.contrast.dark.warnings && audit.contrast.dark.warnings.length > 0) {
      console.log(`  ⚠️  contrast (dark): ${audit.contrast.dark.warnings.length} 項 < 3:1`);
      for (const w of audit.contrast.dark.warnings.slice(0, 3)) {
        console.log(`    ${w.ratio}:1 ${w.tag} fg=${w.color} bg=${w.bg} "${w.text}"`);
      }
    } else {
      console.log(`  ✅ contrast (dark): 無 < 3:1（掃描 ${audit.contrast.dark.scanned} 項）`);
    }
  }

  // ---- 11. 還原 ----
  console.log('Phase: restored');
  // 切回亮色（applied 與否只記錄不 fail——dark 沒套上時這裡本來就不會變色）
  audit.theme.lightRestore = await audits.setThemeAndVerify(page, 'light');
  // 退出 reader mode
  const toggleOff = await sw.evaluate(async (id) => {
    try { return { ok: true, res: await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' }) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, tabId);
  console.log('toggle exit:', JSON.stringify(toggleOff));
  await sleep(800);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'restored' });

  // 確認還原
  audit.restored = await page.evaluate(() => ({
    jreadActive: !!document.querySelector('[data-jread-active]'),
    jreadStyle: !!document.getElementById('__jread-style')
  }));
  console.log('restored state:', JSON.stringify(audit.restored));

  // ---- 12. 判定 verdict + 寫 audit.json + 移目錄 ----
  // 高精度信號 → failReasons（近乎必為真 bug）；低精度信號 → reviewReasons
  //（需 Claude 看截圖判定真偽）。分層依據：2026-05-27 報告的假陽性盤點
  //（contextual keyword / hero missing 是 FP 慣犯；overflow / contrast /
  // narrowText / strict keyword 無 FP 紀錄）。
  const fail = audit.failReasons;
  const review = audit.reviewReasons;

  // residual：strict 命中 = fail，contextual-only = review
  for (const [label, r] of [['initial', audit.residual.initial], ['delayed', audit.residual.delayed]]) {
    if (!r || !r.warnings) continue;
    if (r.strictCount > 0) fail.push(`residual-strict(${label})x${r.strictCount}`);
    else if (r.warnings.length > 0) review.push(`residual-contextual(${label})x${r.warnings.length}`);
  }
  if (audit.links?.warnings?.length > 0) review.push(`links-suspicious x${audit.links.warnings.length}`);
  if (audit.retention && audit.retention.ratio < 0.3) review.push(`retention ${Math.round(audit.retention.ratio * 100)}%`);
  // gap：只用 delayed（lazy-load 展開後）量測——initial 的 placeholder 假 gap
  // 在 delayed 會消失；>= 200px 視為異常空白（80-199px 只 warn）
  const largeGapsDelayed = (audit.gaps?.delayed?.gaps || []).filter(g => g.gap >= 200);
  if (largeGapsDelayed.length > 0) fail.push(`gap>=200(delayed)x${largeGapsDelayed.length}`);
  if (audit.contrast?.light?.warnings?.length > 0) fail.push(`contrast(light)x${audit.contrast.light.warnings.length}`);
  if (audit.contrast?.dark?.warnings?.length > 0) fail.push(`contrast(dark)x${audit.contrast.dark.warnings.length}`);
  if (!audit.theme?.dark?.applied) fail.push('dark-theme-not-applied');
  if (audit.overflow?.overflow) fail.push('overflow');
  if (audit.heroImage?.missing?.length > 0) review.push(`hero-missing x${audit.heroImage.missing.length}`);
  // 內文掉圖：review-tier（高精度窄版，FP 已壓到近 0，但仍歸低精度由 Claude
  // 看截圖確認——保守不 fail build，與 hero-missing 同層）
  if (audit.droppedFigures?.dropped?.length > 0) review.push(`content-img-dropped x${audit.droppedFigures.dropped.length}`);
  // 誤殺長段落（A）：high-precision → fail（cleaner 吃掉 article 內可見長散文，
  // 近乎必為真 bug——v0.8.168 Miniflux 開頭段落消失正是此 family）
  if (audit.droppedProse?.dropped?.length > 0) fail.push(`prose-dropped x${audit.droppedProse.dropped.length}`);
  // 標題缺失（B）：review-tier（strict 字串存在性、低 stakes，由 Claude 看截圖確認）
  if (audit.titlePresence?.missing) review.push('title-missing');
  if (audit.narrowText?.narrow) fail.push('narrow-text');
  if (audit.figcaption?.cramped) fail.push('figcaption-cramped');
  if (audit.bodyWidth?.narrow) fail.push('body-width-narrow');
  // F1 還原失敗（舊版只記錄不判定——誤放）
  if (audit.restored && (audit.restored.jreadActive || audit.restored.jreadStyle)) fail.push('restore-failed');

  finalize(fail.length > 0 ? 'failed' : (review.length > 0 ? 'review' : 'pass'));
  console.log('audit.json written.');

  if (!KEEP) {
    await ctx.close();
    // 持久 profile（--profile）保留登入態，不刪；只清暫存 profile
    if (!PROFILE_NAME) fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  } else {
    console.log('--keep, leaving browser open');
  }
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
