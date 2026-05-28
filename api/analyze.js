// ============================================================
//  BetIntel — analyze.js (v8 — clean, no config bugs)
//  Single Groq call. 8 fixtures. ~20s. Well under 60s limit.
// ============================================================

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function formatFixture(f, i) {
  const h  = f.homeStanding || {};
  const a  = f.awayStanding || {};
  const hf = f.homeForm     || {};
  const af = f.awayForm     || {};
  const hAvgS = (h.played && h.gf) ? (h.gf / h.played).toFixed(1) : "?";
  const hAvgC = (h.played && h.ga) ? (h.ga / h.played).toFixed(1) : "?";
  const aAvgS = (a.played && a.gf) ? (a.gf / a.played).toFixed(1) : "?";
  const aAvgC = (a.played && a.ga) ? (a.ga / a.played).toFixed(1) : "?";
  return [
    `${i+1}. ${f.homeTeam} vs ${f.awayTeam} | ${f.country}/${f.league} | KO:${f.kickoff}`,
    `   H: Pos${h.position??"?"} Pts${h.points??"?"} ${h.wins??"?"}W${h.draws??"?"}D${h.losses??"?"}L AvgS:${hAvgS} AvgC:${hAvgC} Form:${hf.short??""} ${hf.detailed??""}`,
    `   A: Pos${a.position??"?"} Pts${a.points??"?"} ${a.wins??"?"}W${a.draws??"?"}D${a.losses??"?"}L AvgS:${aAvgS} AvgC:${aAvgC} Form:${af.short??""} ${af.detailed??""}`,
  ].join("\n");
}

function buildPrompt(fixtures, maxPicks, minConf) {
  const today = new Date().toLocaleDateString("en-GB", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  return `You are a professional football betting analyst. Today is ${today}.

FIXTURES WITH LIVE DATA:
${fixtures.map((f, i) => formatFixture(f, i)).join("\n\n")}

Find up to ${maxPicks} value bets. Use the live data. Fill gaps with your knowledge.

3-SIGNAL RULE: Every pick needs 3 independent signals. Cannot find 3 signals = SKIP that match.

MARKETS (use exact text only):
"Home Win"|"Draw"|"Away Win"
"Over 1.5 Goals"|"Over 2.5 Goals"|"Over 3.5 Goals"|"Under 2.5 Goals"|"Under 3.5 Goals"
"Both Teams To Score - Yes"|"Both Teams To Score - No"
"Home Win or Over 2.5 Goals"|"Away Win or Over 2.5 Goals"
"No Team To Lead By 3 Goals"
"Over 7.5 Corners"|"Over 8.5 Corners"|"Over 9.5 Corners"|"Over 10.5 Corners"
"Under 8.5 Corners"|"Under 9.5 Corners"
"Over 3.5 Cards"|"Over 4.5 Cards"|"Under 3.5 Cards"

RULES:
- Minimum ${minConf}% confidence only
- Star Pick = 90%+ only, used sparingly
- Skip end-of-season dead rubbers
- Skip Away Win without overwhelming evidence
- Quote actual numbers in analysis
- Name all 3 signals explicitly
- State one genuine risk

Return ONLY a valid JSON array. Absolutely nothing before or after the array. No markdown fences.

[{"country":"England","league":"Championship","homeTeam":"Leeds United","awayTeam":"Millwall","pick":"Over 2.5 Goals","market":"Goals","probability":"78","confidence":"High","starPick":false,"analysis":"Three signals: Leeds average 2.4 goals at home, Millwall concede 1.8 away, H2H shows 5 of last 6 over 2.5. Risk: Millwall physical approach disrupting Leeds rhythm.","kickoff":"19:45 UTC"}]`;
}

const handler = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  try {
    // Vercel parses JSON body automatically — handle both object and string
    const body     = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const fixtures = Array.isArray(body.fixtures) ? body.fixtures : [];
    const settings = body.settings || {};
    const apiKey   = process.env.GROQ_API_KEY || settings.groqKey || "";
    const minConf  = parseInt(settings.minConfidence) || 70;
    const maxPicks = parseInt(settings.maxPicks)      || 10;

    if (!apiKey) {
      return res.status(400).json({ error: "No Groq API key. Add GROQ_API_KEY in Vercel environment variables." });
    }

    // Take top 8 fixtures — single Groq call = ~20s max
    const sorted = [...fixtures].sort((a, b) => {
      const aRich = Object.keys(a.homeStanding || {}).length + Object.keys(a.homeForm || {}).length;
      const bRich = Object.keys(b.homeStanding || {}).length + Object.keys(b.homeForm || {}).length;
      return bRich - aRich;
    });
    const toAnalyse = sorted.slice(0, 8);

    if (!toAnalyse.length) {
      return res.status(200).json({ picks: [], total: 0, starPicks: 0, error: "No fixtures to analyse.", fixturesIn: 0, scannedAt: new Date().toISOString() });
    }

    // Call Groq
    const groqRes = await fetch(GROQ_URL, {
      method : "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body   : JSON.stringify({
        model      : GROQ_MODEL,
        messages   : [{ role: "user", content: buildPrompt(toAnalyse, maxPicks, minConf) }],
        temperature: 0.25,
        max_tokens : 3000,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (groqRes.status === 429) {
      return res.status(200).json({
        picks: [], total: 0, starPicks: 0,
        error: "Groq rate limit reached. Wait 1-2 minutes and scan again.",
        fixturesIn: fixtures.length, scannedAt: new Date().toISOString(),
      });
    }

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      throw new Error(`Groq error ${groqRes.status}: ${errText.substring(0, 150)}`);
    }

    const groqData = await groqRes.json();
    let text = groqData.choices?.[0]?.message?.content || "";
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const arrMatch = text.match(/\[[\s\S]*\]/);

    if (!arrMatch) {
      return res.status(200).json({
        picks: [], total: 0, starPicks: 0,
        error: "AI returned no picks. Try scanning again.",
        fixturesIn: fixtures.length, scannedAt: new Date().toISOString(),
      });
    }

    const rawPicks = JSON.parse(arrMatch[0]);
    const picks = rawPicks
      .filter(p => p.homeTeam && p.pick && parseFloat(p.probability) >= minConf)
      .map(p => ({
        country    : p.country    || "",
        league     : p.league     || "",
        homeTeam   : p.homeTeam   || "",
        awayTeam   : p.awayTeam   || "",
        pick       : p.pick       || "",
        market     : p.market     || "Other",
        probability: Math.min(99, Math.max(50, parseFloat(p.probability) || 70)),
        confidence : p.confidence || "Medium",
        starPick   : parseFloat(p.probability) >= 90 || p.starPick === true,
        analysis   : p.analysis   || "",
        kickoff    : p.kickoff    || "",
      }))
      .sort((a, b) => {
        if (a.starPick && !b.starPick) return -1;
        if (!a.starPick && b.starPick) return 1;
        return b.probability - a.probability;
      })
      .slice(0, maxPicks);

    return res.status(200).json({
      picks,
      total      : picks.length,
      starPicks  : picks.filter(p => p.starPick).length,
      scannedAt  : new Date().toISOString(),
      fixturesIn : fixtures.length,
    });

  } catch (err) {
    console.error("analyze error:", err.message);
    return res.status(500).json({ error: "Analysis failed: " + (err.message || "Unknown error") });
  }
};

module.exports = handler;
