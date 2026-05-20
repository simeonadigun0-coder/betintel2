// ============================================================
//  BetIntel — analyze.js  (v3)
//  Fixes:
//   · Groq 429 rate-limit detection + exponential backoff retry
//   · Longer sleep between batches (2.5s default)
//   · Returns a real error when ALL batches fail (not silent empty)
//   · Surfaces partial results even if some batches fail
//   · Max 5 batches per scan to stay within free-tier limits
// ============================================================

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const BATCH_SIZE = 20;   // bigger batches = fewer API calls
const MAX_BATCHES = 5;   // never exceed 5 Groq calls per scan (free tier safe)
const BATCH_DELAY = 2500; // ms between batches
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Format fixture into rich data block for prompt ──────────────
function formatFixture(f, i) {
  const hTable = `${f.homePOS}th | ${f.homePTS}pts | ${f.homeW}W-${f.homeD}D-${f.homeL}L | GF:${f.homeGF} GA:${f.homeGA} GD:${f.homeGD} | Avg scored:${f.homeAvgScored} Avg conceded:${f.homeAvgConceded}`;
  const aTable = `${f.awayPOS}th | ${f.awayPTS}pts | ${f.awayW}W-${f.awayD}D-${f.awayL}L | GF:${f.awayGF} GA:${f.awayGA} GD:${f.awayGD} | Avg scored:${f.awayAvgScored} Avg conceded:${f.awayAvgConceded}`;
  return [
    `MATCH ${i + 1}: ${f.homeTeam} vs ${f.awayTeam} | ${f.country} — ${f.league} | KO: ${f.kickoff}`,
    `  HOME [${f.homeTeam}]: ${hTable}`,
    `  HOME Form (last 5): ${f.homeForm5} | ${f.homeFormFull}`,
    `  AWAY [${f.awayTeam}]: ${aTable}`,
    `  AWAY Form (last 5): ${f.awayForm5} | ${f.awayFormFull}`,
  ].join("\n");
}

// ── Build the analyst prompt ─────────────────────────────────────
function buildPrompt(fixtures, targetPicks, minConfidence) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const fixtureBlocks = fixtures.map((f, i) => formatFixture(f, i)).join("\n\n");

  return `You are a professional football betting analyst with 15 years of experience. You write like a real person — sharp, direct, no fluff. Today is ${today}.

You have REAL live data for each fixture: league table position, W/D/L, goals scored/conceded, goals averages, and last 5 results with actual scores. USE THIS DATA as your primary source. Back it up with your knowledge of the teams and leagues.

════════════════════════════════════════
FIXTURES WITH LIVE DATA (${fixtures.length} matches)
════════════════════════════════════════
${fixtureBlocks}
════════════════════════════════════════

YOUR TASK: Find ${targetPicks} strong value bets. Every pick must be grounded in the numbers above.

AVAILABLE MARKETS — use EXACT text:
• "Home Win" | "Draw" | "Away Win"
• "Over 1.5 Goals" | "Over 2.5 Goals" | "Over 3.5 Goals" | "Under 2.5 Goals" | "Under 3.5 Goals"
• "Both Teams To Score - Yes" | "Both Teams To Score - No"
• "Home Win or Over 2.5 Goals" | "Away Win or Over 2.5 Goals"
• "No Team To Lead By 3 Goals"
• "Over 7.5 Corners" | "Over 8.5 Corners" | "Over 9.5 Corners" | "Over 10.5 Corners" | "Under 8.5 Corners" | "Under 9.5 Corners"
• "Over 3.5 Cards" | "Over 4.5 Cards" | "Under 3.5 Cards"

MARKET GUIDE:
• Goals Over — when combined avg goals (home scored + away conceded OR away scored + home conceded) exceeds 2.5
• BTTS Yes — both teams averaging ≥1.2 goals scored AND both conceding regularly
• BTTS No — one side has GA under 0.9 and the opponent rarely scores (GF under 1.0)
• Home/Away Win or Over 2.5 — when a side is strong but match could be tight; covers both result AND goals
• No Team Leads By 3 — tight form, similar positions, derbies, cup-style knockout legs; hits ~80% of all matches
• Corners Over 7.5/8.5 — pressing teams, wide play, attack vs defence mismatches that generate many set pieces
• Corners Over 9.5/10.5 — only for elite attack-heavy clashes like UCL, top-5 league title battles

RULES:
✓ Minimum ${minConfidence}% probability — nothing weaker
✓ One pick per match — pick the market where you have the clearest edge
✓ Star Pick = 88%+ — use it only when data is overwhelmingly one-sided
✓ Lower league matches count — Série B, Championship, 2. Bundesliga patterns can be crystal clear
✓ "No Team To Lead By 3 Goals" is valid and often the safest pick — do not ignore it
✗ Skip a match entirely if most stats show "?" and you have no real confidence
✗ Never guess. Only pick where the numbers and context genuinely support it.

ANALYSIS FORMAT (natural, like a real analyst talking to a friend):
1. What the actual data says (quote specific numbers)
2. The pattern that makes this market the right call
3. Any H2H or contextual knowledge backing it
4. One risk factor a sharp bettor would weigh

Return ONLY a valid JSON array. Nothing before it, nothing after it. No markdown fences.

[{"country":"Germany","league":"Bundesliga","homeTeam":"Bayer Leverkusen","awayTeam":"RB Leipzig","pick":"Over 2.5 Goals","market":"Goals","probability":"81","confidence":"High","starPick":false,"analysis":"Leverkusen are averaging 2.3 goals per game at home and only conceding 1.1 — so goals are in the air before Leipzig even kick off. Leipzig are putting up 1.9 on the road and their defence has been leaky in each of their last four away trips. That combination of free-scoring home side and porous away defence almost always opens this line. H2H backs it up with 3 of the last 4 meetings going over 2.5. Only real risk is Leverkusen rotating heavily ahead of their midweek European fixture.","kickoff":"17:30 UTC"}]`;
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
exports.handler = async (event) => {
  const headers = {
    "Content-Type"                : "application/json",
    "Access-Control-Allow-Origin" : "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };

  try {
    const body     = JSON.parse(event.body || "{}");
    const { fixtures = [], settings = {} } = body;

    const apiKey   = process.env.GROQ_API_KEY || settings.groqKey || "";
    const minConf  = parseInt(settings.minConfidence) || 70;
    const maxPicks = parseInt(settings.maxPicks)      || 15;

    if (!apiKey)          return { statusCode: 400, headers, body: JSON.stringify({ error: "No Groq API key. Add GROQ_API_KEY to Netlify environment variables, or enter it in app Settings." }) };
    if (!fixtures.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "No fixtures were found for today." }) };

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
          ? "Groq rate limit reached. Wait 1–2 minutes then scan again. This happens when you scan multiple times quickly on the free tier."
          : `Analysis failed: ${batchErrors[0]}`
        : "The AI found no picks meeting your confidence threshold. Try lowering it in Settings (currently ${minConf}%).";
      return { statusCode: 200, headers, body: JSON.stringify({ picks: [], total: 0, starPicks: 0, error: errMsg, fixturesIn: fixtures.length, scannedAt: new Date().toISOString() }) };
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        picks      : final,
        total      : final.length,
        starPicks  : final.filter(p => p.starPick).length,
        scannedAt  : new Date().toISOString(),
        fixturesIn : fixtures.length,
        batchesRun : batches.length,
        batchErrors: batchErrors.length,
      }),
    };

  } catch (err) {
    console.error("analyze handler:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
