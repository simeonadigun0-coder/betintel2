// ============================================================
//  BetIntel — get-fixtures.js (v6 — clean)
//  Fetches today's fixtures across all leagues in parallel.
//  Returns leagueSlug per fixture so enrich.js knows what to fetch.
// ============================================================

const LEAGUES = [
  { slug:"eng.1",          name:"Premier League",       country:"England"     },
  { slug:"eng.2",          name:"Championship",         country:"England"     },
  { slug:"eng.3",          name:"League One",           country:"England"     },
  { slug:"esp.1",          name:"La Liga",              country:"Spain"       },
  { slug:"esp.2",          name:"Segunda Division",     country:"Spain"       },
  { slug:"ger.1",          name:"Bundesliga",           country:"Germany"     },
  { slug:"ger.2",          name:"2. Bundesliga",        country:"Germany"     },
  { slug:"ger.3",          name:"3. Liga",              country:"Germany"     },
  { slug:"ita.1",          name:"Serie A",              country:"Italy"       },
  { slug:"ita.2",          name:"Serie B",              country:"Italy"       },
  { slug:"fra.1",          name:"Ligue 1",              country:"France"      },
  { slug:"fra.2",          name:"Ligue 2",              country:"France"      },
  { slug:"ned.1",          name:"Eredivisie",           country:"Netherlands" },
  { slug:"por.1",          name:"Primeira Liga",        country:"Portugal"    },
  { slug:"sco.1",          name:"Scottish Prem",        country:"Scotland"    },
  { slug:"bel.1",          name:"Belgian Pro League",   country:"Belgium"     },
  { slug:"tur.1",          name:"Süper Lig",            country:"Turkey"      },
  { slug:"den.1",          name:"Superliga",            country:"Denmark"     },
  { slug:"swe.1",          name:"Allsvenskan",          country:"Sweden"      },
  { slug:"nor.1",          name:"Eliteserien",          country:"Norway"      },
  { slug:"sui.1",          name:"Super League",         country:"Switzerland" },
  { slug:"aut.1",          name:"Austrian Bundesliga",  country:"Austria"     },
  { slug:"cze.1",          name:"Czech First League",   country:"Czech Rep"   },
  { slug:"pol.1",          name:"Ekstraklasa",          country:"Poland"      },
  { slug:"gre.1",          name:"Super League",         country:"Greece"      },
  { slug:"rou.1",          name:"Liga 1",               country:"Romania"     },
  { slug:"nga.1",          name:"NPFL",                 country:"Nigeria"     },
  { slug:"zaf.1",          name:"PSL",                  country:"S.Africa"    },
  { slug:"egy.1",          name:"Premier League",       country:"Egypt"       },
  { slug:"mex.1",          name:"Liga MX",              country:"Mexico"      },
  { slug:"usa.1",          name:"MLS",                  country:"USA"         },
  { slug:"bra.1",          name:"Série A",              country:"Brazil"      },
  { slug:"bra.2",          name:"Série B",              country:"Brazil"      },
  { slug:"arg.1",          name:"Liga Profesional",     country:"Argentina"   },
  { slug:"col.1",          name:"Primera A",            country:"Colombia"    },
  { slug:"chl.1",          name:"Primera División",     country:"Chile"       },
  { slug:"sau.1",          name:"Saudi Pro League",     country:"S.Arabia"    },
  { slug:"jpn.1",          name:"J1 League",            country:"Japan"       },
  { slug:"kor.1",          name:"K League 1",           country:"S.Korea"     },
  { slug:"aus.1",          name:"A-League",             country:"Australia"   },
  { slug:"uefa.champions", name:"Champions League",     country:"Europe"      },
  { slug:"uefa.europa",    name:"Europa League",        country:"Europe"      },
  { slug:"uefa.conference",name:"Conference League",    country:"Europe"      },
];

const handler = async (req, res) => {
  const today   = new Date().toISOString().split("T")[0];
  const midnight = new Date(today);
  midnight.setDate(midnight.getDate() + 1);
  const cacheTTL = Math.min(21600, Math.floor((midnight - new Date()) / 1000));

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", `public, s-maxage=${cacheTTL}, stale-while-revalidate=300`);

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const dateStr = today.replace(/-/g, "");

    const results = await Promise.all(
      LEAGUES.map(async league => {
        try {
          const r = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${dateStr}`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (!r.ok) return [];
          const data = await r.json();
          if (!data.events?.length) return [];
          return data.events
            .filter(e => {
              const s = e.status?.type?.state || "";
              return s !== "post" && s !== "in";
            })
            .map(e => {
              const comps = e.competitions?.[0]?.competitors || [];
              const home  = comps.find(c => c.homeAway === "home");
              const away  = comps.find(c => c.homeAway === "away");
              if (!home || !away) return null;
              return {
                leagueSlug: league.slug,
                country   : league.country,
                league    : league.name,
                homeTeam  : home.team?.displayName || "",
                awayTeam  : away.team?.displayName || "",
                kickoff   : e.date ? new Date(e.date).toISOString().substring(11,16) + " UTC" : "",
              };
            })
            .filter(f => f && f.homeTeam && f.awayTeam);
        } catch { return []; }
      })
    );

    const fixtures    = results.flat().sort((a,b) => a.kickoff.localeCompare(b.kickoff));
    const activeSlugs = [...new Set(fixtures.map(f => f.leagueSlug))];

    return res.status(200).json({ date: today, total: fixtures.length, fixtures, activeSlugs });

  } catch (err) {
    res.removeHeader("Cache-Control");
    return res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
