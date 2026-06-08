#!/bin/bash
cd "$(dirname "$0")/.."

URLS=(
  "https://udn.com/news/story/124844/9460037"
  "https://www.chinatimes.com/realtimenews/20260423000917-260410"
  "https://today.line.me/tw/v3/article/l2G8KyL"
  "https://news.ebc.net.tw/news/society/548318"
  "https://newtalk.tw/news/view/2026-04-24/1031506"
  "https://www.upmedia.mg/tw/focus/comprehensive/256956"
  "https://www.cna.com.tw/news/aopl/202604240301.aspx"
  "https://news.ltn.com.tw/news/world/breakingnews/4973291"
  "https://news.tvbs.com.tw/life/3213619"
  "https://www.thenewslens.com/article/264293"
  "https://www.businessweekly.com.tw/business/blog/3021238"
  "https://www.wealth.com.tw/articles/cf59e096-2b4f-4ed0-9f23-51f29b599c8a"
  "https://www.ctee.com.tw/news/20260424701200-430502"
  "https://news.cnyes.com/news/id/6429386"
  "https://www.cw.com.tw/article/5133011"
  "https://vocus.cc/article/69eb1cbcfd8978000141431d"
  "https://www.twreporter.org/a/hello-world-2026-04-08"
  "https://www.bbc.com/culture/article/20260423-the-enchanting-story-of-oxfords-medieval-library"
  "https://www.bbc.com/news/articles/clyepyy82kxo"
  "https://edition.cnn.com/2026/05/24/us/ai-flying-airplanes"
  "https://www.ms.now/news/law-enforcement-authorities-are-responding-to-reports-of-shots-fired-near-white-house"
  "https://www.engadget.com/2176896/everything-google-announced-io-2026-gemini-omni-spark/"
  "https://www.theregister.com/ai-ml/2026/05/22/microsoft-lets-users-exile-floating-copilot-button-after-interface-rage/5245093"
  "https://www.npr.org/2026/04/21/nx-s1-5776665/surprising-origin-features-superglue-kids-adults-to-screens"
  "https://cn.nytimes.com/opinion/20260424/apple-tim-cook-outsourcing-china/"
  "https://www.cnbc.com/2019/10/23/the-blob-slime-mold-physarum-polycephalum-characteristics.html"
  "https://www.cnbc.com/2026/06/02/nvidias-new-pc-chips-are-ceos-bid-to-own-every-part-of-ai-stack.html"
  "https://www.theverge.com/tech/933415/google-io-2026-biggest-announcements-ai-gemini"
  "https://slate.com/news-and-politics/2026/05/supreme-court-analysis-voting-rights-disaster-america.html"
  "https://techcrunch.com/2026/05/10/anthropic-says-evil-portrayals-of-ai-were-responsible-for-claudes-blackmail-attempts/"
  "https://nautil.us/is-this-why-science-advances-one-funeral-at-a-time-1280650"
  "https://stratechery.com/2026/please-listen-to-my-podcast/"
  "https://www.chinatalk.media/p/quantum-101"
  "https://www.twz.com/space/this-is-how-the-u-s-national-security-apparatus-is-dependent-on-spacex"
  "https://www.lawfaremedia.org/article/china-s-agentic-ai-controversy"
  "https://www.bellingcat.com/news/2026/04/09/the-hungarian-government-passwords-exposed-online/"
  "https://restofworld.org/2026/ai-davos-wef-2026-highlights/"
  "https://www.propublica.org/article/todd-blanche-complaint-conflict-of-interest"
  "https://www.quantamagazine.org/the-ai-revolution-in-math-has-arrived-20260413/"
  "https://www.healthsystemtracker.org/brief/what-drives-health-spending-in-the-u-s-compared-to-other-countries/"
  "https://36kr.com/p/3777437597586178"
  "https://sspai.com/post/105378"
  "https://zh.wikipedia.org/wiki/%E7%8F%8D%E7%8F%A0%E5%A5%B6%E8%8C%B6"
  "https://en.wikipedia.org/wiki/Large_language_model"
  "https://stackoverflow.com/questions/66618136/persistent-service-worker-in-chrome-extension"
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at"
  "https://dev.to/isocyanideisgood/2026-web-dev-trends-that-actually-matter-5520"
  "https://github.blog/engineering/architecture-optimization/from-latency-to-instant-modernizing-github-issues-navigation-performance/"
)

PASS=0
FAIL=0
ERROR=0

for i in "${!URLS[@]}"; do
  url="${URLS[$i]}"
  n=$((i+1))
  HOSTNAME=$(echo "$url" | sed 's|https\?://\(www\.\)\?||;s|/.*||')
  echo ""
  echo "[$n/${#URLS[@]}] $HOSTNAME"

  OUTPUT=$(JREAD_URL="$url" node tools/page-rounds-harness.js 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ]; then
    echo "  ❌ ERROR (exit $EXIT_CODE)"
    ERROR=$((ERROR+1))
  elif echo "$OUTPUT" | grep -q "^✅ PASS"; then
    echo "  ✅ PASS"
    PASS=$((PASS+1))
  elif echo "$OUTPUT" | grep -q "^❌ FAIL"; then
    REASON=$(echo "$OUTPUT" | grep "⚠️" | head -3 | sed 's/^/    /')
    echo "  ❌ FAIL"
    echo "$REASON"
    FAIL=$((FAIL+1))
  else
    echo "  ❓ UNKNOWN"
    ERROR=$((ERROR+1))
  fi
done

echo ""
echo "=============================="
echo "TOTAL: ${#URLS[@]} sites"
echo "  ✅ PASS:  $PASS"
echo "  ❌ FAIL:  $FAIL"
echo "  ⛔ ERROR: $ERROR"
echo "=============================="
