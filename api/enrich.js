// ============================================================
//  BetIntel — enrich.js (v2 — clean, no config bugs)
//  GET /api/enrich?slug=eng.1
//  Returns standings + last 5 form for ONE league.
// ============================================================

const TIMEOUT_MS = 6000;

async function getStandings(slug) {
  const map = {};
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/standings`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!r.ok) return map;
    const data = await r.json();
    const entries =
      data.standings?.entries ||
      data.children?.[0]?.standings?.entries ||
      data.children?.[0]?.children?.[0]?.standings?.entries ||
      [];
    for (const e of entries) {
      const name = (e.team?.displayName || "").toLowerCase();
      if (!name) continue;
      const s = k => e.stats?.find(x =>
        x.name === k || x.shortDisplayName?.toLowerCase() === k.toLowerCase()
      )?.value ?? null;
      map[name] = {
        position: s("rank")   ?? s("playoffSeed")  ?? null,
        points  : s("points") ?? s("pts")          ?? null,
        played  : s("gamesPlayed") ?? s("GP")       ?? null,
        wins    : s("wins")   ?? s("W")             ?? null,
        draws   : s("ties")   ?? s("D")             ?? null,
        losses  : s("losses") ?? s("L")             ?? null,
        gf      : s("pointsFor")      ?? s("GF")   ?? null,
        ga      : s("pointsAgainst")  ?? s("GA")   ?? null,
        gd      : s("pointDifferential") ?? s("GD") ?? null,
      };
    }
  } catch (e) {
    console.error("standings error:", e.message);
  }
  return map;
}

async function getForm(slug) {
  const map = {};
  try {
    const past = new Date(Date.now() - 28 * 86400000)
      .toISOString().split("T")[0].replace(/-/g, "");
    const now  = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const r    = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${past}-${now}&limit=60`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!r.ok) return map;
    const data = await r.json();
    for (const ev of data.events || []) {
      if (ev.status?.type?.state !== "post") continue;
      const comps = ev.competitions?.[0]?.competitors;
      if (!comps || comps.length < 2) continue;
      const home = comps.find(c => c.homeAway === "home");
      const away = comps.find(c => c.homeAway === "away");
      if (!home || !away) continue;
      const hs  = parseInt(home.score) || 0;
      const as_ = parseInt(away.score) || 0;
      const hk  = (home.team?.displayName || "").toLowerCase();
      const ak  = (away.team?.displayName || "").toLowerCase();
      if (!map[hk]) map[hk] = [];
      if (!map[ak]) map[ak] = [];
      map[hk].unshift({ r: hs > as_ ? "W" : hs < as_ ? "L" : "D", score: `${hs}-${as_}`, opp: away.team?.displayName || "", venue: "H" });
      map[ak].unshift({ r: as_ > hs ? "W" : as_ < hs ? "L" : "D", score: `${as_}-${hs}`, opp: home.team?.displayName || "", venue: "A" });
    }
  } catch (e) {
    console.error("form error:", e.message);
  }
  return map;
}

const handler = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=10800, stale-while-revalidate=300");

  if (req.method === "OPTIONS") return res.status(200).end();

  const slug = req.query?.slug || "";
  if (!slug) return res.status(400).json({ error: "Missing ?slug= parameter" });

  try {
    const [standings, formRaw] = await Promise.all([
      getStandings(slug),
      getForm(slug),
    ]);

    // Format form into readable strings
    const form = {};
    for (const [team, arr] of Object.entries(formRaw)) {
      const last5 = arr.slice(0, 5);
      form[team] = {
        short   : last5.map(f => f.r).join(""),
        detailed: last5.map(f => `${f.r} ${f.score} vs ${f.opp} (${f.venue})`).join(" | "),
      };
    }

    return res.status(200).json({ slug, standings, form });

  } catch (err) {
    console.error("enrich error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
