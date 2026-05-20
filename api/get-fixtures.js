// ============================================================
//  BetIntel — get-fixtures.js  (v2)
//  Enriches every fixture with:
//   · League table position, W/D/L, GF, GA, GD, points
//   · Last 5 results per team with scores + opponents
//  All from ESPN public API — zero API key needed
// ============================================================

const FOOTBALL_LEAGUES = [
  // ── TOP 5 EUROPEAN ──────────────────────────────────────
  { slug: "eng.1",           name: "Premier League",           country: "England"      },
  { slug: "eng.2",           name: "Championship",             country: "England"      },
  { slug: "eng.3",           name: "League One",               country: "England"      },
  { slug: "esp.1",           name: "La Liga",                  country: "Spain"        },
  { slug: "esp.2",           name: "Segunda Division",         country: "Spain"        },
  { slug: "ger.1",           name: "Bundesliga",               country: "Germany"      },
  { slug: "ger.2",           name: "2. Bundesliga",            country: "Germany"      },
  { slug: "ger.3",           name: "3. Liga",                  country: "Germany"      },
  { slug: "ita.1",           name: "Serie A",                  country: "Italy"        },
  { slug: "ita.2",           name: "Serie B",                  country: "Italy"        },
  { slug: "fra.1",           name: "Ligue 1",                  country: "France"       },
  { slug: "fra.2",           name: "Ligue 2",                  country: "France"       },
  // ── REST OF EUROPE ──────────────────────────────────────
  { slug: "ned.1",           name: "Eredivisie",               country: "Netherlands"  },
  { slug: "ned.2",           name: "Eerste Divisie",           country: "Netherlands"  },
  { slug: "por.1",           name: "Primeira Liga",            country: "Portugal"     },
  { slug: "por.2",           name: "Segunda Liga",             country: "Portugal"     },
  { slug: "sco.1",           name: "Scottish Premiership",     country: "Scotland"     },
  { slug: "sco.2",           name: "Scottish Championship",    country: "Scotland"     },
  { slug: "bel.1",           name: "Belgian Pro League",       country: "Belgium"      },
  { slug: "bel.2",           name: "First Division B",         country: "Belgium"      },
  { slug: "tur.1",           name: "Süper Lig",                country: "Turkey"       },
  { slug: "tur.2",           name: "TFF First League",         country: "Turkey"       },
  { slug: "den.1",           name: "Superliga",                country: "Denmark"      },
  { slug: "swe.1",           name: "Allsvenskan",              country: "Sweden"       },
  { slug: "nor.1",           name: "Eliteserien",              country: "Norway"       },
  { slug: "sui.1",           name: "Super League",             country: "Switzerland"  },
  { slug: "aut.1",           name: "Austrian Bundesliga",      country: "Austria"      },
  { slug: "cze.1",           name: "Czech First League",       country: "Czech Rep"    },
  { slug: "pol.1",           name: "Ekstraklasa",              country: "Poland"       },
  { slug: "rou.1",           name: "Liga 1",                   country: "Romania"      },
  { slug: "srb.1",           name: "SuperLiga",                country: "Serbia"       },
  { slug: "cro.1",           name: "HNL",                      country: "Croatia"      },
  { slug: "gre.1",           name: "Super League",             country: "Greece"       },
  { slug: "hun.1",           name: "OTP Bank Liga",            country: "Hungary"      },
  { slug: "svk.1",           name: "Super Liga",               country: "Slovakia"     },
  { slug: "isr.1",           name: "Ligat ha'Al",              country: "Israel"       },
  { slug: "ukr.1",           name: "Premier League",           country: "Ukraine"      },
  // ── AMERICAS ────────────────────────────────────────────
  { slug: "mex.1",           name: "Liga MX",                  country: "Mexico"       },
  { slug: "usa.1",           name: "MLS",                      country: "USA"          },
  { slug: "usa.2",           name: "USL Championship",         country: "USA"          },
  { slug: "bra.1",           name: "Série A",                  country: "Brazil"       },
  { slug: "bra.2",           name: "Série B",                  country: "Brazil"       },
  { slug: "arg.1",           name: "Liga Profesional",         country: "Argentina"    },
  { slug: "col.1",           name: "Primera A",                country: "Colombia"     },
  { slug: "chl.1",           name: "Primera División",         country: "Chile"        },
  { slug: "ecu.1",           name: "LigaPro Serie A",          country: "Ecuador"      },
  { slug: "per.1",           name: "Liga 1",                   country: "Peru"         },
  { slug: "uru.1",           name: "Primera División",         country: "Uruguay"      },
  { slug: "par.1",           name: "División Profesional",     country: "Paraguay"     },
  { slug: "crc.1",           name: "Primera División",         country: "Costa Rica"   },
  // ── AFRICA ──────────────────────────────────────────────
  { slug: "nga.1",           name: "NPFL",                     country: "Nigeria"      },
  { slug: "zaf.1",           name: "Premier Soccer League",    country: "South Africa" },
  { slug: "egy.1",           name: "Premier League",           country: "Egypt"        },
  { slug: "mar.1",           name: "Botola Pro",               country: "Morocco"      },
  { slug: "tun.1",           name: "Ligue Pro 1",              country: "Tunisia"      },
  { slug: "gha.1",           name: "Ghana Premier League",     country: "Ghana"        },
  // ── ASIA / PACIFIC ──────────────────────────────────────
  { slug: "sau.1",           name: "Saudi Pro League",         country: "Saudi Arabia" },
  { slug: "qat.1",           name: "Stars League",             country: "Qatar"        },
  { slug: "uae.1",           name: "UAE Pro League",           country: "UAE"          },
  { slug: "jpn.1",           name: "J1 League",                country: "Japan"        },
  { slug: "jpn.2",           name: "J2 League",                country: "Japan"        },
  { slug: "kor.1",           name: "K League 1",               country: "South Korea"  },
  { slug: "chn.1",           name: "Super League",             country: "China"        },
  { slug: "ind.1",           name: "Indian Super League",      country: "India"        },
  { slug: "aus.1",           name: "A-League",                 country: "Australia"    },
  // ── UEFA CUPS ────────────────────────────────────────────
  { slug: "uefa.champions",  name: "Champions League",         country: "Europe"       },
  { slug: "uefa.europa",     name: "Europa League",            country: "Europe"       },
  { slug: "uefa.conference", name: "Conference League",        country: "Europe"       },
];

const TIMEOUT_MS = 9000;

// ── Fetch standings for a league → name.lower → stats obj ──────
async function fetchStandings(slug) {
  const map = {};
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/standings`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) return map;
    const data = await res.json();

    // ESPN wraps standings differently per competition
    const entries =
      data.standings?.entries ||
      data.children?.[0]?.standings?.entries ||
      data.children?.[0]?.children?.[0]?.standings?.entries ||
      [];

    for (const entry of entries) {
      const name = (entry.team?.displayName || "").toLowerCase();
      if (!name) continue;
      const stat = (k) => {
        const s = entry.stats?.find(x =>
          x.name === k || x.shortDisplayName?.toLowerCase() === k.toLowerCase()
        );
        return s?.value ?? s?.displayValue ?? null;
      };
      map[name] = {
        position: stat("rank") ?? stat("playoffSeed") ?? null,
        points  : stat("points") ?? stat("pts") ?? null,
        played  : stat("gamesPlayed") ?? stat("GP") ?? null,
        wins    : stat("wins") ?? stat("W") ?? null,
        draws   : stat("ties") ?? stat("D") ?? null,
        losses  : stat("losses") ?? stat("L") ?? null,
        gf      : stat("pointsFor") ?? stat("GF") ?? null,
        ga      : stat("pointsAgainst") ?? stat("GA") ?? null,
        gd      : stat("pointDifferential") ?? stat("GD") ?? null,
      };
    }
  } catch { /* silent */ }
  return map;
}

// ── Fetch last 28 days of results → team form map ──────────────
async function fetchRecentForm(slug) {
  const formMap = {}; // name.lower → [{r,score,opp,venue}, ...]
  try {
    const past    = new Date(Date.now() - 28 * 86400000);
    const fromStr = past.toISOString().split("T")[0].replace(/-/g, "");
    const todayStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${fromStr}-${todayStr}&limit=60`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) return formMap;
    const data = await res.json();

    for (const event of (data.events || [])) {
      if (event.status?.type?.state !== "post") continue;
      const comps = event.competitions?.[0]?.competitors;
      if (!comps || comps.length < 2) continue;
      const home = comps.find(c => c.homeAway === "home");
      const away = comps.find(c => c.homeAway === "away");
      if (!home || !away) continue;

      const hs = parseInt(home.score) || 0;
      const as_ = parseInt(away.score) || 0;
      const hk = (home.team?.displayName || "").toLowerCase();
      const ak = (away.team?.displayName || "").toLowerCase();

      if (!formMap[hk]) formMap[hk] = [];
      if (!formMap[ak]) formMap[ak] = [];

      formMap[hk].unshift({
        r: hs > as_ ? "W" : hs < as_ ? "L" : "D",
        score: `${hs}-${as_}`,
        opp: away.team?.displayName || "",
        venue: "H",
      });
      formMap[ak].unshift({
        r: as_ > hs ? "W" : as_ < hs ? "L" : "D",
        score: `${as_}-${hs}`,
        opp: home.team?.displayName || "",
        venue: "A",
      });
    }
  } catch { /* silent */ }
  return formMap;
}

function shortForm(arr) {
  return (arr || []).slice(0, 5).map(f => f.r).join("") || "?????";
}

function detailedForm(arr) {
  if (!arr?.length) return "No recent data";
  return (arr || []).slice(0, 5)
    .map(f => `${f.r} ${f.score} vs ${f.opp} (${f.venue})`)
    .join(" | ");
}

// ── Fetch one league's today fixtures + enrich ──────────────────
async function fetchLeague(league, dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${dateStr}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.events?.length) return [];

    // Only bother enriching if there are matches today in this league
    const [standings, recentForm] = await Promise.all([
      fetchStandings(league.slug),
      fetchRecentForm(league.slug),
    ]);

    const fixtures = [];
    for (const event of data.events) {
      const state = event.status?.type?.state || "";
      if (state === "post" || state === "in") continue;

      const comps = event.competitions?.[0]?.competitors;
      if (!comps || comps.length < 2) continue;

      const home = comps.find(c => c.homeAway === "home");
      const away = comps.find(c => c.homeAway === "away");
      if (!home || !away) continue;

      const hn  = home.team?.displayName || "";
      const an  = away.team?.displayName || "";
      const hk  = hn.toLowerCase();
      const ak  = an.toLowerCase();
      const hSt = standings[hk] || {};
      const aSt = standings[ak] || {};
      const hFm = recentForm[hk] || [];
      const aFm = recentForm[ak] || [];

      const ko = event.date
        ? new Date(event.date).toISOString().substring(11, 16) + " UTC"
        : "";

      fixtures.push({
        country : league.country,
        league  : league.name,
        homeTeam: hn,
        awayTeam: an,
        kickoff : ko,
        venue   : event.competitions?.[0]?.venue?.fullName || "",

        // Table stats
        homePOS : hSt.position ?? "?",
        homePTS : hSt.points   ?? "?",
        homeGP  : hSt.played   ?? "?",
        homeW   : hSt.wins     ?? "?",
        homeD   : hSt.draws    ?? "?",
        homeL   : hSt.losses   ?? "?",
        homeGF  : hSt.gf       ?? "?",
        homeGA  : hSt.ga       ?? "?",
        homeGD  : hSt.gd       ?? "?",

        awayPOS : aSt.position ?? "?",
        awayPTS : aSt.points   ?? "?",
        awayGP  : aSt.played   ?? "?",
        awayW   : aSt.wins     ?? "?",
        awayD   : aSt.draws    ?? "?",
        awayL   : aSt.losses   ?? "?",
        awayGF  : aSt.gf       ?? "?",
        awayGA  : aSt.ga       ?? "?",
        awayGD  : aSt.gd       ?? "?",

        // Form
        homeForm5   : shortForm(hFm),
        homeFormFull: detailedForm(hFm),
        awayForm5   : shortForm(aFm),
        awayFormFull: detailedForm(aFm),

        // Goals averages computed from standing data
        homeAvgScored  : hSt.played ? (hSt.gf / hSt.played).toFixed(2) : "?",
        homeAvgConceded: hSt.played ? (hSt.ga / hSt.played).toFixed(2) : "?",
        awayAvgScored  : aSt.played ? (aSt.gf / aSt.played).toFixed(2) : "?",
        awayAvgConceded: aSt.played ? (aSt.ga / aSt.played).toFixed(2) : "?",
      });
    }
    return fixtures;
  } catch {
    return [];
  }
}

// ── Vercel Handler ───────────────────────────────────────────────
module.exports = async (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  // Seconds until midnight UTC — cache expires at day rollover
  const now            = new Date();
  const midnight       = new Date(today);
  midnight.setDate(midnight.getDate() + 1);
  const secsToMidnight = Math.floor((midnight - now) / 1000);
  const cacheTTL       = Math.min(21600, secsToMidnight);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", `public, s-maxage=${cacheTTL}, stale-while-revalidate=300`);

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const dateStr = today.replace(/-/g, "");
    const BATCH   = 8;
    const all     = [];

    for (let i = 0; i < FOOTBALL_LEAGUES.length; i += BATCH) {
      const batch = FOOTBALL_LEAGUES.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(l => fetchLeague(l, dateStr)));
      results.forEach(r => all.push(...r));
    }

    all.sort((a, b) => a.kickoff.localeCompare(b.kickoff));

    return res.status(200).json({
      date     : today,
      total    : all.length,
      fixtures : all,
      cachedFor: `${Math.round(cacheTTL / 3600)}h`,
    });
  } catch (err) {
    res.removeHeader("Cache-Control"); // don't cache errors
    return res.status(500).json({ error: err.message });
  }
};
