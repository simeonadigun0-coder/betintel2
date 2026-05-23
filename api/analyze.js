// ============================================================
//  BetIntel — analyze.js  (v4)
//  Fixes:
//   · Groq 413 TPM limit — reduced BATCH_SIZE to 10, trimmed fixture format
//   · Groq 429 rate-limit detection + exponential backoff retry
//   · Longer sleep between batches (3s)
//   · Returns real error when ALL batches fail
//   · Max 4 batches per scan to stay within free-tier limits
// ============================================================

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const BATCH_SIZE  = 10;   // reduced from 20 — keeps each request under TPM limit
const MAX_BATCHES = 4;    // max 4 Groq calls per scan
const BATCH_DELAY = 3000; // 3s between batches
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Compact fixture format — fewer tokens per fixture ───────────
function formatFixture(f, i) {
  // Trim form to just the result letters + score, skip opponent names to save tokens
  const hForm = (f.homeFormFull || "").split(" | ").slice(0, 5)
    .map(s => s.split(" vs ")[0]).join(" | ") || f.homeForm5 || "?";
  const aForm = (f.awayFormFull || "").split(" | ").slice(0, 5)
    .map(s => s.split(" vs ")[0]).join(" | ") || f.awayForm5 || "?";

  return [
    `${i + 1}. ${f.homeTeam} vs ${f.awayTeam} [${f.country}/${f.league}] KO:${f.kickoff}`,
    `  H: Pos${f.homePOS} Pts${f.homePTS} ${f.homeW}W${f.homeD}D${f.homeL}L GF${f.homeGF} GA${f.homeGA} AvgS${f.homeAvgScored} AvgC${f.homeAvgConceded} Form:${hForm}`,
    `  A: Pos${f.awayPOS} Pts${f.awayPTS} ${f.awayW}W${f.awayD}D${f.awayL}L GF${f.awayGF} GA${f.awayGA} AvgS${f.awayAvgScored} AvgC${f.awayAvgConceded} Form:${aForm}`,
  ].join("\n");
}

// ── Build the analyst prompt ─────────────────────────────────────
function buildPrompt(fixtures, targetPicks, minConfidence) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const fixtureBlocks = fixtures.map((f, i) => formatFixture(f, i)).join("\n\n");

  return `You are a seasoned football betting analyst with 15 years of professional experience finding genuine edges. You think independently, respect the data, and ONLY recommend a bet when multiple factors align clearly. You have seen enough bad tips to know that fewer, stronger picks always beats a long list of weak ones. Today is ${today}.

You have REAL live data for every fixture below. This is your foundation — use it hard and be specific.

════════════════════════════════════════
LIVE FIXTURE DATA (${fixtures.length} matches)
════════════════════════════════════════
${fixtureBlocks}
════════════════════════════════════════

══════════════════════════════════════════════════════
STEP 1 — SCREEN EVERY MATCH INTERNALLY BEFORE PICKING
══════════════════════════════════════════════════════

For each fixture ask yourself:

A) FORM QUALITY
— Is form consistent (WWWDW) or erratic (WLLWL)? Erratic = SKIP unless goals/corners market is clearly independent
— Were wins/losses against strong or weak opponents? A win vs bottom-3 is worth far less than a win vs top-6
— A loss away to a title contender means very little — do not count it as negative form

B) GOALS PATTERN
— Calculate: home avg scored + away avg conceded. Also: away avg scored + home avg conceded
— If BOTH exceed 2.0 → goals market strongly in play
— Look at actual scores in last 5 — are they 1-0, 0-0 type OR 2-1, 3-1 type? Actual scores confirm or deny the avg
— If one team has GA under 0.8 → Under or BTTS No becomes attractive

C) TABLE CONTEXT
— Teams within 4 positions / 5 points of each other → expect tight match → consider Draw, Under, No Team Leads By 3
— One team 8+ points / 6+ positions ahead → consider that team to win or Win or Over 2.5
— END OF SEASON WARNING: A team already safe, already relegated, or already promoted with nothing to play for is DANGEROUS — flag this and only pick markets that do not depend on their motivation
— Teams in relegation/promotion battles play with desperation — often tight, physical, low-scoring

D) THE 3-SIGNAL RULE — MANDATORY
You MUST identify at least 3 independent signals before including any pick.
Example — Over 2.5: (1) home avg scored 2.1, (2) away avg conceded 1.7, (3) last 4 H2H all over 2.5
Example — Home Win: (1) home team 6 positions higher, (2) away team lost 4 of last 5 away, (3) home team won 4 of last 5 at home
If you cannot find 3 signals → DO NOT PICK that match. Move on.

E) LOWER LEAGUE PRIORITY
Championship, Série B, 2. Bundesliga, Liga 2, Eerste Divisie, TFF First League, and similar second/third tier leagues often show MORE predictable patterns than top leagues:
— Bigger quality gaps between positions mean more one-sided results
— Less tactical complexity means goals patterns repeat more consistently
— Home advantage is stronger and more reliable
ACTIVELY LOOK for lower league picks where the pattern is crystal clear. A clean Championship signal beats an uncertain UCL pick every time.

══════════════════════════════════════════════════════
STEP 2 — AVAILABLE MARKETS (use EXACT text)
══════════════════════════════════════════════════════

• "Home Win" | "Draw" | "Away Win"
• "Over 1.5 Goals" | "Over 2.5 Goals" | "Over 3.5 Goals"
• "Under 2.5 Goals" | "Under 3.5 Goals"
• "Both Teams To Score - Yes" | "Both Teams To Score - No"
• "Home Win or Over 2.5 Goals" | "Away Win or Over 2.5 Goals"
• "No Team To Lead By 3 Goals"
• "Over 7.5 Corners" | "Over 8.5 Corners" | "Over 9.5 Corners" | "Over 10.5 Corners"
• "Under 8.5 Corners" | "Under 9.5 Corners"
• "Over 3.5 Cards" | "Over 4.5 Cards" | "Under 3.5 Cards"

WHEN TO USE EACH:
→ Over 2.5/3.5 Goals: combined attack+defence averages clearly support it AND actual recent scores confirm it
→ Under 2.5 Goals: both teams show low-scoring patterns in recent results (multiple 0-0, 1-0, 1-1 in last 5)
→ BTTS Yes: BOTH teams have scored in 4+ of their last 5 AND both have conceded in 4+ of their last 5
→ BTTS No: at least one team genuinely not scoring (GF avg under 0.9) — not just a clean sheet team, actively not scoring
→ Home Win: home side clearly superior on table + strong home form + away side poor away record — all three needed
→ Away Win: use sparingly — must have overwhelming multi-signal confidence. Away wins are the most commonly wrong pick
→ Draw: teams closely matched in table + similar recent form + low scoring tendencies in H2H
→ Win or Over 2.5: strong team but not dominant enough for clean win — this covers them winning OR a goal-fest draw
→ No Team Leads By 3: teams within 4 positions on table, or any derby/rivalry, or relegation/promotion match — extremely reliable
→ Corners Over 7.5-8.5: teams known for wide play, pressing, or high set-piece generation. Over 9.5-10.5 only for elite pressing matches
→ Cards: known derby fixtures, physical leagues (Turkey, South America), or referees known for being strict

══════════════════════════════════════════════════════
STEP 3 — FINAL RULES
══════════════════════════════════════════════════════

✓ Return 5 to ${targetPicks} picks — STOP when quality runs out, do not fill up with weak picks
✓ Minimum ${minConfidence}% confidence threshold — nothing below this regardless of how many fixtures there are
✓ Every pick must pass the 3-Signal Rule above — no exceptions
✓ Star Pick = 90%+ ONLY — when data is so one-sided it would be negligent not to flag it. Use maximum once or twice per scan
✓ Prioritise lower leagues when patterns are clearer there than in top leagues
✗ Never pick "Away Win" without overwhelming evidence — it is the riskiest market in football
✗ Never pick a team with nothing to play for at end of season unless market is independent of motivation
✗ Never fill the list with weak picks — 5 strong picks is a far better day than 15 questionable ones
✗ Skip any match where form data is mostly "?" — incomplete data means no pick

══════════════════════════════════════════════════════
STEP 4 — ANALYSIS WRITING STYLE
══════════════════════════════════════════════════════

Write like an experienced analyst talking to a smart friend — direct, specific, no fluff:
1. Quote actual numbers from the data (e.g. "averaging 2.1 at home", "conceded in 4 of last 5")
2. Comment on the quality of opponents faced in recent form where relevant
3. Explicitly name your 3 signals that back this pick
4. State one genuine risk that could kill the pick
5. For lower league picks, briefly explain why the pattern in this league is reliable

Return ONLY a valid JSON array. Nothing before it. Nothing after it. No markdown fences. No explanation text.

[{"country":"England","league":"Championship","homeTeam":"Leeds United","awayTeam":"Millwall","pick":"Over 2.5 Goals","market":"Goals","probability":"78","confidence":"High","starPick":false,"analysis":"Three clear signals backing this. Signal one: Leeds average 2.4 goals per game at home this season — one of the highest rates in the Championship — and their last five home results read 3-1, 2-2, 3-0, 1-1, 2-1. Not a single low-scoring game in that run. Signal two: Millwall have been conceding 1.8 per game away from home, which is soft for a side that prides themselves on defensive structure. Signal three: H2H between these two has gone over 2.5 in five of the last six meetings across all competitions. The Championship context actually helps here — both sides are mid-table with nothing critical riding on this, so neither will set up to kill the game. The one risk is Millwall going extremely direct and physical to disrupt Leeds early, which they are capable of doing — but even in those games Leeds usually find a way to score.","kickoff":"19:45 UTC"}]`;
}

// ── Groq call with retry on 429 rate limit ───────────────────────
async function callGroqWithRetry(prompt, apiKey, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GROQ_URL, {
        method : "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type" : "application/json",
        },
        body: JSON.stringify({
          model      : GROQ_MODEL,
          messages   : [{ role: "user", content: prompt }],
          temperature: 0.25,
          max_tokens : 6000,
        }),
        signal: AbortSignal.timeout(60000),
      });

      // Rate limit — wait and retry
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "15");
        const waitMs = (retryAfter + 2) * 1000;
        console.log(`Rate limited. Waiting ${waitMs}ms before retry ${attempt + 1}/${retries}`);
        if (attempt < retries) {
          await sleep(waitMs);
          continue;
        } else {
          throw new Error(`RATE_LIMIT: Groq rate limit hit. Try again in ${retryAfter} seconds.`);
        }
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq HTTP ${res.status}: ${errText.substring(0, 200)}`);
      }

      const data = await res.json();
      let text = data.choices?.[0]?.message?.content || "";
      text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("No JSON array in Groq response");

      return JSON.parse(match[0]);

    } catch (err) {
      // If it's a rate limit error on last attempt, rethrow
      if (err.message?.startsWith("RATE_LIMIT") || attempt === retries) throw err;
      // Otherwise wait and retry
      await sleep(3000 * (attempt + 1));
    }
  }
  return [];
}

// ── Main handler ─────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  try {
    const { fixtures = [], settings = {} } = req.body || {};

    const apiKey   = process.env.GROQ_API_KEY || settings.groqKey || "";
    const minConf  = parseInt(settings.minConfidence) || 70;
    const maxPicks = parseInt(settings.maxPicks)      || 15;

    if (!apiKey)          return res.status(400).json({ error: "No Groq API key. Add GROQ_API_KEY to Vercel environment variables, or enter it in app Settings." });
    if (!fixtures.length) return res.status(400).json({ error: "No fixtures were found for today." });

    // ── Batch setup ──────────────────────────────────────────────
    // Cap at MAX_BATCHES to protect free-tier rate limit
    // Prioritise fixtures with richer data (those with form/stats)
    const richFirst = [...fixtures].sort((a, b) => {
      const aRich = (a.homeForm5 !== "?????" && a.homePOS !== "?") ? 0 : 1;
      const bRich = (b.homeForm5 !== "?????" && b.homePOS !== "?") ? 0 : 1;
      return aRich - bRich;
    });

    const maxFixtures = MAX_BATCHES * BATCH_SIZE; // e.g. 5 × 20 = 100 fixtures max
    const toAnalyse   = richFirst.slice(0, maxFixtures);

    const batches = [];
    for (let i = 0; i < toAnalyse.length; i += BATCH_SIZE) {
      batches.push(toAnalyse.slice(i, i + BATCH_SIZE));
    }

    // How many picks to ask per batch
    const picksPerBatch = Math.max(3, Math.ceil((maxPicks * 1.5) / batches.length));

    const allPicks   = [];
    const batchErrors = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        console.log(`Batch ${i + 1}/${batches.length}: ${batch.length} fixtures, requesting ${picksPerBatch} picks`);
        const prompt = buildPrompt(batch, picksPerBatch, minConf);
        const picks  = await callGroqWithRetry(prompt, apiKey);

        let added = 0;
        for (const p of picks) {
          if (!p.homeTeam || !p.awayTeam || !p.pick) continue;
          const prob = parseFloat(p.probability) || 0;
          if (prob < minConf) continue;
          allPicks.push({
            country    : p.country    || "",
            league     : p.league     || "",
            homeTeam   : p.homeTeam   || "",
            awayTeam   : p.awayTeam   || "",
            pick       : p.pick       || "",
            market     : p.market     || "Other",
            probability: Math.min(99, Math.max(50, prob)),
            confidence : p.confidence || "Medium",
            starPick   : prob >= 88 || p.starPick === true,
            analysis   : p.analysis   || "",
            kickoff    : p.kickoff    || "",
          });
          added++;
        }
        console.log(`Batch ${i + 1} returned ${picks.length} raw, ${added} above threshold`);

      } catch (e) {
        console.error(`Batch ${i + 1} failed: ${e.message}`);
        batchErrors.push(e.message);
        // If rate limited, stop trying further batches — they'll all fail too
        if (e.message?.startsWith("RATE_LIMIT")) {
          console.log("Rate limit hit — stopping batch processing");
          break;
        }
      }

      // Delay between batches — enough to stay within Groq's RPM limit
      if (i < batches.length - 1) await sleep(BATCH_DELAY);
    }

    // ── If zero picks and we have errors, return a useful error ──
    if (allPicks.length === 0) {
      const errMsg = batchErrors.length
        ? batchErrors[0].startsWith("RATE_LIMIT")
          ? "Groq rate limit reached. Wait 1–2 minutes then scan again."
          : `Analysis failed: ${batchErrors[0]}`
        : `The AI found no picks meeting your confidence threshold. Try lowering it in Settings (currently ${minConf}%).`;
      return res.status(200).json({ picks: [], total: 0, starPicks: 0, error: errMsg, fixturesIn: fixtures.length, scannedAt: new Date().toISOString() });
    }

    // ── Sort + deduplicate ────────────────────────────────────────
    allPicks.sort((a, b) => {
      if (a.starPick && !b.starPick) return -1;
      if (!a.starPick && b.starPick) return 1;
      return b.probability - a.probability;
    });

    const seen = new Set();
    const unique = allPicks.filter(p => {
      const key = `${p.homeTeam}|${p.awayTeam}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const final = unique.slice(0, Math.max(5, maxPicks));

    return res.status(200).json({
      picks      : final,
      total      : final.length,
      starPicks  : final.filter(p => p.starPick).length,
      scannedAt  : new Date().toISOString(),
      fixturesIn : fixtures.length,
      batchesRun : batches.length,
      batchErrors: batchErrors.length,
    });

  } catch (err) {
    console.error("analyze handler:", err);
    return res.status(500).json({ error: err.message });
  }
};
