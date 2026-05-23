// ============================================================
//  BetIntel — analyze.js (v6 — fits within Vercel 60s limit)
//  Vercel Hobby plan = 60s hard max. No exceptions.
//  Strategy: max 2 Groq calls, 10 fixtures each, 3s gap = ~50s total
// ============================================================

const GROQ_URL    = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL  = "llama-3.3-70b-versatile";
const BATCH_SIZE  = 10;  // 10 fixtures × ~3s each = ~30s per batch
const MAX_BATCHES = 2;   // 2 batches × 30s + 3s gap = ~63s — tight but safe
const BATCH_DELAY = 2000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function formatFixture(f, i) {
  const h = f.homeStanding || {};
  const a = f.awayStanding || {};
  const hf = f.homeForm    || {};
  const af = f.awayForm    || {};
  const hAvgS = h.played && h.gf ? (h.gf/h.played).toFixed(1) : "?";
  const hAvgC = h.played && h.ga ? (h.ga/h.played).toFixed(1) : "?";
  const aAvgS = a.played && a.gf ? (a.gf/a.played).toFixed(1) : "?";
  const aAvgC = a.played && a.ga ? (a.ga/a.played).toFixed(1) : "?";
  return [
    `${i+1}. ${f.homeTeam} vs ${f.awayTeam} | ${f.country}/${f.league} | KO:${f.kickoff}`,
    `   H: P${h.position??"?"} Pts${h.points??"?"} ${h.wins??"?"}W${h.draws??"?"}D${h.losses??"?"}L AvgS:${hAvgS} AvgC:${hAvgC} Form:${hf.short??"?????"} ${hf.detailed??""}`,
    `   A: P${a.position??"?"} Pts${a.points??"?"} ${a.wins??"?"}W${a.draws??"?"}D${a.losses??"?"}L AvgS:${aAvgS} AvgC:${aAvgC} Form:${af.short??"?????"} ${af.detailed??""}`,
  ].join("\n");
}

function buildPrompt(fixtures, targetPicks, minConf) {
  const today = new Date().toLocaleDateString("en-GB", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  return `You are a professional football betting analyst. Today is ${today}.

FIXTURES WITH LIVE DATA (${fixtures.length} matches):
${fixtures.map((f,i) => formatFixture(f,i)).join("\n\n")}

Find ${targetPicks} value bets. Use the live data above. Fill gaps with your knowledge.

3-SIGNAL RULE: Every pick needs 3 independent signals. If you can't find 3 → SKIP.

MARKETS (exact text):
"Home Win"|"Draw"|"Away Win"
"Over 1.5 Goals"|"Over 2.5 Goals"|"Over 3.5 Goals"|"Under 2.5 Goals"|"Under 3.5 Goals"
"Both Teams To Score - Yes"|"Both Teams To Score - No"
"Home Win or Over 2.5 Goals"|"Away Win or Over 2.5 Goals"
"No Team To Lead By 3 Goals"
"Over 7.5 Corners"|"Over 8.5 Corners"|"Over 9.5 Corners"|"Over 10.5 Corners"
"Under 8.5 Corners"|"Under 9.5 Corners"
"Over 3.5 Cards"|"Over 4.5 Cards"|"Under 3.5 Cards"

RULES:
✓ Min ${minConf}% confidence | ✓ 3 signals per pick | ✓ Star Pick = 90%+ only
✓ Prioritise lower leagues when patterns are clearest
✗ No Away Win without overwhelming evidence
✗ Skip end-of-season dead rubbers
✗ Skip matches where data is mostly "?"

ANALYSIS: Quote actual numbers. Name 3 signals. State one risk. Natural tone.

Return ONLY valid JSON array. No markdown. Nothing else.
[{"country":"","league":"","homeTeam":"","awayTeam":"","pick":"","market":"","probability":"75","confidence":"High","starPick":false,"analysis":"","kickoff":""}]`;
}

async function callGroq(prompt, apiKey) {
  const r = await fetch(GROQ_URL, {
    method : "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body   : JSON.stringify({ model: GROQ_MODEL, messages: [{ role:"user", content:prompt }], temperature:0.25, max_tokens:3000 }),
    signal : AbortSignal.timeout(28000), // 28s per call — leaves room for 2 calls + delay
  });
  if (r.status === 429) {
    const wait = (parseInt(r.headers.get("retry-after")||"15")+2)*1000;
    throw new Error(`RATE_LIMIT:${wait}`);
  }
  if (!r.ok) throw new Error(`Groq HTTP ${r.status}`);
  const data = await r.json();
  let text = data.choices?.[0]?.message?.content || "";
  text = text.replace(/```json/gi,"").replace(/```/g,"").trim();
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("No JSON in Groq response");
  return JSON.parse(m[0]);
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type","application/json");
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method==="OPTIONS") return res.status(200).end();
  if (req.method!=="POST")    return res.status(405).json({error:"POST only"});

  try {
    const { fixtures=[], settings={} } = req.body || {};
    const apiKey   = process.env.GROQ_API_KEY || settings.groqKey || "";
    const minConf  = parseInt(settings.minConfidence) || 70;
    const maxPicks = parseInt(settings.maxPicks)      || 15;

    if (!apiKey)          return res.status(400).json({error:"No Groq API key set. Add GROQ_API_KEY in Vercel environment variables."});
    if (!fixtures.length) return res.status(400).json({error:"No fixtures provided."});

    // Hard cap — only analyse top 20 fixtures (2 batches × 10)
    // Prioritise fixtures with enriched data (homeStanding has data)
    const sorted = [...fixtures].sort((a,b) => {
      const aRich = Object.keys(a.homeStanding||{}).length > 2 ? 0 : 1;
      const bRich = Object.keys(b.homeStanding||{}).length > 2 ? 0 : 1;
      return aRich - bRich;
    });
    const toAnalyse = sorted.slice(0, MAX_BATCHES * BATCH_SIZE);
    const batches   = [];
    for (let i=0; i<toAnalyse.length; i+=BATCH_SIZE) batches.push(toAnalyse.slice(i,i+BATCH_SIZE));

    const picksPerBatch = Math.max(3, Math.ceil(maxPicks / batches.length) + 2);
    const allPicks = [];
    const errors   = [];

    for (let i=0; i<batches.length; i++) {
      try {
        const picks = await callGroq(buildPrompt(batches[i], picksPerBatch, minConf), apiKey);
        for (const p of picks) {
          const prob = parseFloat(p.probability)||0;
          if (!p.homeTeam||!p.pick||prob<minConf) continue;
          allPicks.push({
            country:p.country||"", league:p.league||"",
            homeTeam:p.homeTeam||"", awayTeam:p.awayTeam||"",
            pick:p.pick||"", market:p.market||"Other",
            probability:Math.min(99,Math.max(50,prob)),
            confidence:p.confidence||"Medium",
            starPick:prob>=90||p.starPick===true,
            analysis:p.analysis||"", kickoff:p.kickoff||"",
          });
        }
      } catch(e) {
        errors.push(e.message);
        if (e.message?.startsWith("RATE_LIMIT")) break;
      }
      if (i<batches.length-1) await sleep(BATCH_DELAY);
    }

    if (!allPicks.length) {
      const msg = errors[0]?.startsWith("RATE_LIMIT")
        ? "Groq rate limit reached. Wait 1-2 minutes then scan again."
        : errors[0] || "No picks found. Try lowering confidence threshold in Settings.";
      return res.status(200).json({picks:[],total:0,starPicks:0,error:msg,fixturesIn:fixtures.length,scannedAt:new Date().toISOString()});
    }

    allPicks.sort((a,b) => {
      if (a.starPick&&!b.starPick) return -1;
      if (!a.starPick&&b.starPick) return 1;
      return b.probability-a.probability;
    });
    const seen=new Set();
    const final = allPicks
      .filter(p=>{ const k=`${p.homeTeam}|${p.awayTeam}`.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, Math.max(5,maxPicks));

    return res.status(200).json({ picks:final, total:final.length, starPicks:final.filter(p=>p.starPick).length, scannedAt:new Date().toISOString(), fixturesIn:fixtures.length });

  } catch(err) {
    return res.status(500).json({error:err.message});
  }
};

const GROQ_URL    = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL  = "llama-3.3-70b-versatile";
const BATCH_SIZE  = 12;
const MAX_BATCHES = 4;
const BATCH_DELAY = 3000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function formatFixture(f, i) {
  const hSt = f.homeStanding || {};
  const aSt = f.awayStanding || {};
  const hFm = f.homeForm     || {};
  const aFm = f.awayForm     || {};

  const hAvgS = hSt.played && hSt.gf
    ? (hSt.gf / hSt.played).toFixed(2) : "?";
  const hAvgC = hSt.played && hSt.ga
    ? (hSt.ga / hSt.played).toFixed(2) : "?";
  const aAvgS = aSt.played && aSt.gf
    ? (aSt.gf / aSt.played).toFixed(2) : "?";
  const aAvgC = aSt.played && aSt.ga
    ? (aSt.ga / aSt.played).toFixed(2) : "?";

  return [
    `${i+1}. ${f.homeTeam} vs ${f.awayTeam} | ${f.country} — ${f.league} | KO:${f.kickoff}`,
    `   HOME: Pos${hSt.position??"?"} Pts${hSt.points??"?"} ${hSt.wins??"?"}W${hSt.draws??"?"}D${hSt.losses??"?"}L GF${hSt.gf??"?"} GA${hSt.ga??"?"} AvgScored:${hAvgS} AvgConceded:${hAvgC}`,
    `   HOME Form: ${hFm.short??"?????"} | ${hFm.detailed??"No data"}`,
    `   AWAY: Pos${aSt.position??"?"} Pts${aSt.points??"?"} ${aSt.wins??"?"}W${aSt.draws??"?"}D${aSt.losses??"?"}L GF${aSt.gf??"?"} GA${aSt.ga??"?"} AvgScored:${aAvgS} AvgConceded:${aAvgC}`,
    `   AWAY Form: ${aFm.short??"?????"} | ${aFm.detailed??"No data"}`,
  ].join("\n");
}

function buildPrompt(fixtures, targetPicks, minConf) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday:"long", year:"numeric", month:"long", day:"numeric"
  });
  const blocks = fixtures.map((f,i) => formatFixture(f,i)).join("\n\n");

  return `You are a professional football betting analyst with 15 years of experience. Today is ${today}.

You have REAL live data below — league standings, W/D/L records, goals scored and conceded, goals averages, and last 5 results with actual scores and opponents. This is your PRIMARY source. Use it hard and quote specific numbers in your analysis.

════════════════════════════════════════
LIVE FIXTURE DATA (${fixtures.length} matches)
════════════════════════════════════════
${blocks}
════════════════════════════════════════

STEP 1 — SCREEN EVERY MATCH BEFORE PICKING

A) FORM QUALITY
   — Consistent form (WWWDW) beats erratic (WLLWL)
   — Quality of recent opponents matters enormously
   — A loss away to a title contender means very little

B) GOALS PATTERN
   — Calculate: home AvgScored + away AvgConceded. Also: away AvgScored + home AvgConceded
   — If both exceed 2.0 → goals market strongly in play
   — Look at actual recent scores — 3-1, 2-2 type OR 0-0, 1-0 type?

C) TABLE CONTEXT
   — Teams within 4 positions / 5 points = expect tight match
   — 8+ point gap = clearer win market
   — END OF SEASON: teams with nothing to play for = DANGEROUS. Flag and avoid.
   — Relegation/promotion battles = intense, often tight, often low scoring

D) THE 3-SIGNAL RULE — MANDATORY
   Must find 3 independent signals per pick:
   Over 2.5: (1) home AvgScored 2.0+, (2) away AvgConceded 1.5+, (3) H2H shows goals
   Home Win: (1) 8+ point gap, (2) home won 4 of last 5 at home, (3) away lost 3 of last 5 away
   If 3 signals not found → SKIP that match

E) LOWER LEAGUE PRIORITY
   Championship, Série B, 2. Bundesliga — bigger quality gaps, stronger home advantage.
   A clear lower league signal beats an uncertain top-league pick every time.

STEP 2 — MARKETS (EXACT text required)
• "Home Win" | "Draw" | "Away Win"
• "Over 1.5 Goals" | "Over 2.5 Goals" | "Over 3.5 Goals"
• "Under 2.5 Goals" | "Under 3.5 Goals"
• "Both Teams To Score - Yes" | "Both Teams To Score - No"
• "Home Win or Over 2.5 Goals" | "Away Win or Over 2.5 Goals"
• "No Team To Lead By 3 Goals"
• "Over 7.5 Corners" | "Over 8.5 Corners" | "Over 9.5 Corners" | "Over 10.5 Corners"
• "Under 8.5 Corners" | "Under 9.5 Corners"
• "Over 3.5 Cards" | "Over 4.5 Cards" | "Under 3.5 Cards"

STEP 3 — RULES
✓ Return 5 to ${targetPicks} picks — quality over quantity always
✓ Minimum ${minConf}% confidence
✓ Every pick needs 3 signals — no exceptions
✓ Star Pick = 90%+ only
✓ Prioritise lower leagues when data is clearest there
✗ Never pick Away Win without overwhelming multi-signal evidence
✗ Never pick teams with nothing to play for at end of season
✗ If data shows "?" for most stats and you have no confidence — SKIP

STEP 4 — ANALYSIS FORMAT
Write like an experienced analyst:
- Quote actual numbers from the data
- Name your 3 signals explicitly
- Mention H2H if known
- State one genuine risk

Return ONLY a valid JSON array. Nothing before it, nothing after it. No markdown.

[{"country":"England","league":"Championship","homeTeam":"Leeds United","awayTeam":"Millwall","pick":"Over 2.5 Goals","market":"Goals","probability":"78","confidence":"High","starPick":false,"analysis":"Three clear signals. Leeds average 2.4 goals per game at home with last 5 home results reading 3-1, 2-2, 3-0, 1-1, 2-1 — not a single low-scoring game. Millwall conceding 1.8 away per game is soft for a defensive side. H2H shows 5 of last 6 meetings went over 2.5. Both teams are mid-table safe so neither will park the bus. Risk: Millwall going direct and physical to disrupt Leeds rhythm.","kickoff":"19:45 UTC"}]`;
}

async function callGroq(prompt, apiKey, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(GROQ_URL, {
        method : "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body   : JSON.stringify({
          model      : GROQ_MODEL,
          messages   : [{ role: "user", content: prompt }],
          temperature: 0.25,
          max_tokens : 5000,
        }),
        signal: AbortSignal.timeout(55000),
      });

      if (r.status === 429) {
        const wait = (parseInt(r.headers.get("retry-after") || "15") + 2) * 1000;
        if (attempt < retries) { await sleep(wait); continue; }
        throw new Error("RATE_LIMIT: Groq rate limit. Wait 1-2 minutes then scan again.");
      }
      if (!r.ok) throw new Error(`Groq HTTP ${r.status}`);

      const data  = await r.json();
      let   text  = data.choices?.[0]?.message?.content || "";
      text = text.replace(/```json/gi,"").replace(/```/g,"").trim();
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("No JSON array in Groq response");
      return JSON.parse(match[0]);

    } catch (err) {
      if (err.message?.startsWith("RATE_LIMIT") || attempt === retries) throw err;
      await sleep(3000 * (attempt + 1));
    }
  }
  return [];
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  try {
    const { fixtures = [], settings = {} } = req.body || {};
    const apiKey   = process.env.GROQ_API_KEY || settings.groqKey || "";
    const minConf  = parseInt(settings.minConfidence) || 70;
    const maxPicks = parseInt(settings.maxPicks)      || 15;

    if (!apiKey)          return res.status(400).json({ error: "No Groq API key set." });
    if (!fixtures.length) return res.status(400).json({ error: "No fixtures provided." });

    // Split into batches
    const toAnalyse = fixtures.slice(0, MAX_BATCHES * BATCH_SIZE);
    const batches   = [];
    for (let i = 0; i < toAnalyse.length; i += BATCH_SIZE) {
      batches.push(toAnalyse.slice(i, i + BATCH_SIZE));
    }

    const picksPerBatch = Math.max(3, Math.ceil((maxPicks * 1.5) / batches.length));
    const allPicks      = [];
    const errors        = [];

    for (let i = 0; i < batches.length; i++) {
      try {
        const picks = await callGroq(buildPrompt(batches[i], picksPerBatch, minConf), apiKey);
        for (const p of picks) {
          const prob = parseFloat(p.probability) || 0;
          if (!p.homeTeam || !p.pick || prob < minConf) continue;
          allPicks.push({
            country    : p.country    || "",
            league     : p.league     || "",
            homeTeam   : p.homeTeam   || "",
            awayTeam   : p.awayTeam   || "",
            pick       : p.pick       || "",
            market     : p.market     || "Other",
            probability: Math.min(99, Math.max(50, prob)),
            confidence : p.confidence || "Medium",
            starPick   : prob >= 90   || p.starPick === true,
            analysis   : p.analysis   || "",
            kickoff    : p.kickoff    || "",
          });
        }
      } catch (e) {
        errors.push(e.message);
        if (e.message?.startsWith("RATE_LIMIT")) break;
      }
      if (i < batches.length - 1) await sleep(BATCH_DELAY);
    }

    if (!allPicks.length) {
      const msg = errors.length
        ? errors[0].startsWith("RATE_LIMIT")
          ? "Groq rate limit reached. Wait 1-2 minutes then scan again."
          : `Analysis failed: ${errors[0]}`
        : "No picks found meeting your confidence threshold. Try lowering it in Settings.";
      return res.status(200).json({ picks:[], total:0, starPicks:0, error:msg, fixturesIn:fixtures.length, scannedAt:new Date().toISOString() });
    }

    // Sort + deduplicate
    allPicks.sort((a,b) => {
      if (a.starPick && !b.starPick) return -1;
      if (!a.starPick && b.starPick) return 1;
      return b.probability - a.probability;
    });
    const seen   = new Set();
    const unique = allPicks.filter(p => {
      const k = `${p.homeTeam}|${p.awayTeam}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    const final = unique.slice(0, Math.max(5, maxPicks));

    return res.status(200).json({
      picks      : final,
      total      : final.length,
      starPicks  : final.filter(p => p.starPick).length,
      scannedAt  : new Date().toISOString(),
      fixturesIn : fixtures.length,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
