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
//
// 輸出：
//   docs/excluded/page-rounds/<pass|failed>/<hostname>_<path-hash>/
//     original-page-01.png   — 原頁面（reader mode 前）
//     light-page-01.png      — reader mode 亮色
//     delayed-page-01.png    — 5s 後（C7 延遲雜訊比對）
//     dark-page-01.png       — 暗色模式（set-theme 經 SW gate 驗證實際套上）
//     restored-page-01.png   — 退出 reader mode 後
//     audit.json             — 輔助信號（residual/gap/contrast/overflow/寬度/hero/theme）
// -----------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const crypto = require('crypto');
const os = require('os');

const audits = require(path.join(__dirname, 'audit-lib.js'));
const { NOISE_AUDIT_KEYWORDS } = audits;

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_PATH = path.join(PROJECT_ROOT, 'jread');

// ---- CLI 參數 ----
const urlArg = process.argv.find((a, i) => a === '--url' && process.argv[i + 1]);
const TARGET_URL = (urlArg ? process.argv[process.argv.indexOf('--url') + 1] : null)
  || process.env.JREAD_URL
  || 'https://www.chinatalk.media/p/best-books-q1-2026';
const KEEP = process.argv.includes('--keep');

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

  // 清舊截圖（可能在 pass/ 或 failed/ 下）
  for (const sub of ['pass', 'failed']) {
    const old = path.join(PR_ROOT, sub, dirName);
    if (fs.existsSync(old)) fs.rmSync(old, { recursive: true });
  }
  // 暫存到 _wip/ 下，跑完 audit 後再移到 pass/ 或 failed/
  const outDir = path.join(PR_ROOT, '_wip', dirName);
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jread-pr-'));

  console.log(`Page Rounds: ${TARGET_URL}`);
  console.log(`Output: ${outDir}`);

  // ---- 1. 啟動 Chromium + extension ----
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
      '--window-position=-2400,-2400',
      '--headless=new'
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

  // ---- 3. 原頁截圖 ----
  console.log('Phase: original');
  await setZoom(page, 0.5);
  await sleep(100);
  await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'original' });

  // ---- 3.5. 擷取原頁 hero images（zoom 還原到 1.0 量原始 rect）----
  await setZoom(page, 1);
  const originalHeroImages = await audits.captureOriginalHeroImages(page);
  console.log(`  hero images found: ${originalHeroImages.length}`);
  await setZoom(page, 0.5);

  // ---- 4. 進入 reader mode ----
  const tabId = await sw.evaluate(async (u) => {
    const ts = await chrome.tabs.query({});
    return (ts.find(t => t.url === u) || ts.find(t => t.url && !t.url.startsWith('chrome')))?.id;
  }, TARGET_URL);

  if (!tabId) { console.error('ERROR: 找不到 tab'); process.exit(1); }

  const toggle = await sw.evaluate(async (id) => {
    try { return { ok: true, res: await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' }) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, tabId);
  console.log('toggle enter:', JSON.stringify(toggle));
  await sleep(1200);

  // ---- 5. 確認 reader mode 啟動 ----
  const readerActive = await page.evaluate(() => !!document.querySelector('[data-jread-active="1"]'));
  console.log('reader mode active:', readerActive);

  const audit = { url: TARGET_URL, hostname, dirName, readerModeActive: readerActive,
    contentStats: null, residual: { initial: null, delayed: null },
    gaps: { initial: null, delayed: null },
    contrast: { light: null, dark: null },
    theme: { dark: null, lightRestore: null },
    overflow: null, tail: null, restored: null };

  if (!readerActive) {
    console.log('WARNING: reader mode 未啟動，截圖供 Claude 判定 fallback');
    await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'light' });
    audit.verdict = 'failed';
    fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 2));
    const failDir = path.join(PR_ROOT, 'failed', dirName);
    fs.mkdirSync(path.join(PR_ROOT, 'failed'), { recursive: true });
    fs.renameSync(outDir, failDir);
    try { fs.rmdirSync(path.join(PR_ROOT, '_wip')); } catch {}
    console.log(`\n❌ FAIL (reader mode inactive)\nDone. Screenshots in: ${failDir}`);
    if (!KEEP) await ctx.close();
    return;
  }

  // ---- 6. 亮色截圖 ----
  console.log('Phase: light');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'light' });

  // ---- 7. Residual + gap + contrast audit（輔助信號）----
  audit.contentStats = await audits.runContentStats(page);
  audit.residual.initial = await audits.runResidualText(page, NOISE_AUDIT_KEYWORDS);
  audit.gaps.initial = await audits.runGapAudit(page);

  if (audit.residual.initial.warnings.length > 0) {
    console.log(`  ⚠️  residual warnings: ${audit.residual.initial.warnings.length}`);
    for (const w of audit.residual.initial.warnings.slice(0, 5)) {
      console.log(`    ${w.tag} "${w.text}" [${w.hitKeywords.join(', ')}]`);
    }
  } else {
    console.log('  ✅ residual: 無命中');
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
  audit.residual.delayed = await audits.runResidualText(page, NOISE_AUDIT_KEYWORDS);
  audit.gaps.delayed = await audits.runGapAudit(page);

  if (audit.residual.delayed.warnings.length > 0) {
    console.log(`  ⚠️  delayed residual warnings: ${audit.residual.delayed.warnings.length}`);
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
    console.log(`  ⚠️  dark theme 未套上（bg ${audit.theme.dark.before} → ${audit.theme.dark.after}）——SW gate 拒絕或 storage race，dark 截圖不可信`);
  } else {
    console.log(`  ✅ dark theme applied（bg ${audit.theme.dark.before} → ${audit.theme.dark.after}）`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await audits.takePagedScreenshots(page, { dir: outDir, prefix: 'dark' });

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

  // ---- 12. 判定 pass/fail + 寫 audit.json + 移目錄 ----
  // gap >= 200px 視為異常空白（80-199px 只 warn 不 fail，圖文間距正常範圍）
  const hasLargeGap = [
    ...(audit.gaps?.initial?.gaps || []),
    ...(audit.gaps?.delayed?.gaps || [])
  ].some(g => g.gap >= 200);

  const hasFail =
    !audit.readerModeActive ||
    (audit.residual?.initial?.warnings?.length > 0) ||
    (audit.residual?.delayed?.warnings?.length > 0) ||
    (audit.contrast?.light?.warnings?.length > 0) ||
    (audit.contrast?.dark?.warnings?.length > 0) ||
    !audit.theme?.dark?.applied ||
    (audit.overflow?.overflow) ||
    (audit.heroImage?.missing?.length > 0) ||
    (audit.narrowText?.narrow) ||
    (audit.figcaption?.cramped) ||
    (audit.bodyWidth?.narrow) ||
    hasLargeGap;
  const verdict = hasFail ? 'failed' : 'pass';
  audit.verdict = verdict;

  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 2));

  const finalDir = path.join(PR_ROOT, verdict, dirName);
  fs.mkdirSync(path.join(PR_ROOT, verdict), { recursive: true });
  fs.renameSync(outDir, finalDir);
  // 清 _wip（若空）
  try { fs.rmdirSync(path.join(PR_ROOT, '_wip')); } catch {}

  console.log(`\n${verdict === 'pass' ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Done. Screenshots in: ${finalDir}`);
  console.log('audit.json written.');

  if (!KEEP) {
    await ctx.close();
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  } else {
    console.log('--keep, leaving browser open');
  }
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
