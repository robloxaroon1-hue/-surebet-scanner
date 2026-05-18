// otros.js — Doradobet, Betsafe, 20bet, Coolbet PE, Tinbet, Olimpobet PE
// Última actualización: 2026-05-18
//
// ESTADO:
//   ✅ Olimpobet  — Kambi API, listo
//   ✅ Betsafe    — OBG API + Playwright sesión
//   ✅ 20bet      — platform.20glob.com/api/event/list, listo
//   ✅ Doradobet  — Altenar API directa sin browser (sb2frontend-altenar2.biahosted.com)
//   ✅ Coolbet    — Playwright intercepta API completa
//   ✅ Tinbet     — FSB API, listo

const BaseScraper = require('./BaseScraper');


// ── OLIMPOBET PE ──────────────────────────────────────────────────────────────
class OlimpoScraper extends BaseScraper {
  constructor() {
    super('Olimpobet', {
      minInterval: 45000,
      headers: {
        'Origin':  'https://olimpobet.pe',
        'Referer': 'https://olimpobet.pe/',
        'Accept':  'application/json',
      },
    });
  }

  async fetchOdds() {
    const ENDPOINT = 'https://us.offering-api.kambicdn.com/offering/v2018/nexuspe/listView/football/all/all/all/matches.json'
      + '?channel_id=1&client_id=200&lang=es_PE&market=PE&useCombined=true&useCombinedLive=true';

    try {
      const data = await this.request(ENDPOINT);
      const results = [];

      for (const ev of (data.events || [])) {
        if (ev.event?.state !== 'NOT_STARTED') continue;
        const homeName = ev.event?.homeName;
        const awayName = ev.event?.awayName;
        if (!homeName || !awayName) continue;

        const offer = (ev.betOffers || []).find(o => o.betOfferType?.id === 2);
        if (!offer) continue;

        const outcomes = offer.outcomes || [];
        const home = outcomes.find(o => o.type === 'OT_ONE');
        const draw = outcomes.find(o => o.type === 'OT_CROSS');
        const away = outcomes.find(o => o.type === 'OT_TWO');
        if (!home || !away) continue;

        results.push(this.normalizeMatch({
          home: homeName, away: awayName,
          sport: 'football', startTime: ev.event?.start,
          odds: {
            home: home.odds / 1000,
            draw: draw ? draw.odds / 1000 : null,
            away: away.odds / 1000,
          },
        }));
      }
      return results;
    } catch (err) {
      this.log(`Error: ${err.message}`);
      return [];
    }
  }
}


// ── BETSAFE ───────────────────────────────────────────────────────────────────
// Usa Playwright para obtener cookies reales de sesión, luego axios normal
class BetsafeScraper extends BaseScraper {
  constructor() {
    super('Betsafe', {
      minInterval: 60000,
      useBrowser:  true,
      siteUrl:     'https://www.betsafe.pe/es/apuestas-deportivas/',
      sessionTTL:  8 * 60 * 1000,
      headers: {
        'Origin':           'https://www.betsafe.pe',
        'Referer':          'https://www.betsafe.pe/es/apuestas-deportivas/',
        'Accept':           'application/json',
        'x-sb-country-code': 'PE',
      },
    });
  }

  async fetchOdds() {
    const BASE = 'https://www.betsafe.pe/api/sb/v1/widgets/events-table/v2';
    const results = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await this.request(BASE, {
        params: {
          categoryIds:     1,
          eventPhase:      'Prematch',
          eventSortBy:     'StartDate',
          includeSkeleton: true,
          maxEventCount:   50,
          maxMarketCount:  1,
          pageNumber:      page,
          priceFormats:    1,
        },
      });

      const { events = [], markets = [], selections = [] } = data?.data || {};

      const marketEventMap = {};
      for (const m of markets) marketEventMap[m.id] = m.eventId;

      const oddsMap = {};
      for (const s of selections) {
        const evId = marketEventMap[s.marketId];
        if (!evId || s.status !== 'Open') continue;
        if (!oddsMap[evId]) oddsMap[evId] = {};
        if (s.selectionTemplateId === 'HOME') oddsMap[evId].home = s.odds;
        if (s.selectionTemplateId === 'DRAW') oddsMap[evId].draw = s.odds;
        if (s.selectionTemplateId === 'AWAY') oddsMap[evId].away = s.odds;
      }

      for (const ev of events) {
        if (ev.phase !== 'Prematch' || ev.categoryName !== 'Fútbol') continue;
        const odds = oddsMap[ev.id];
        if (!odds?.home || !odds?.away) continue;

        const [home, away] = ev.label.split(' - ');
        if (!home || !away) continue;

        results.push(this.normalizeMatch({
          home: home.trim(), away: away.trim(),
          sport: 'football', startTime: ev.startDate,
          odds,
        }));
      }

      hasMore = data?.data?.hasMoreEvents && page < (data?.data?.totalPages || 1);
      page++;
      if (hasMore) await new Promise(r => setTimeout(r, 1000));
    }

    return results;
  }
}


// ── DORADOBET ─────────────────────────────────────────────────────────────────
// API Altenar pública — axios directo sin browser, con paginación
class DoradobetScraper extends BaseScraper {
  constructor() {
    super('Doradobet', {
      minInterval: 45000,
      headers: {
        'Origin':          'https://doradobet.pe',
        'Referer':         'https://doradobet.pe/deportes',
        'Accept':          'application/json',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    });
    this._BASE = 'https://sb2frontend-altenar2.biahosted.com/api/widget/GetUpcoming';
    this._PARAMS = {
      culture:        'es-ES',
      timezoneOffset: 300,
      integration:    'doradobet',
      deviceType:     1,
      numFormat:      'es-ES',
      countryCode:    'PE',
      sportId:        66,    // fútbol
      eventCount:     100,   // máximo por página
    };
  }

  async fetchOdds() {
    const results = [];
    let page = 1;
    let pageCount = 1;

    do {
      try {
        const data = await this.request(this._BASE, {
          params: { ...this._PARAMS, page },
        });

        pageCount = data?.pageCount || 1;

        const oddsMap    = {};
        const marketsMap = {};
        for (const odd of (data.odds    || [])) oddsMap[odd.id]    = odd;
        for (const mkt of (data.markets || [])) marketsMap[mkt.id] = mkt;

        for (const ev of (data.events || [])) {
          const parsed = this.parseEvent(ev, marketsMap, oddsMap);
          if (parsed) results.push(parsed);
        }

        page++;
        if (page <= pageCount) await new Promise(r => setTimeout(r, 600));

      } catch (err) {
        this.log(`Error página ${page}: ${err.message}`);
        break;
      }
    } while (page <= pageCount);

    this.log(`Partidos encontrados: ${results.length}`);
    return results;
  }

  parseEvent(ev, marketsMap, oddsMap) {
    try {
      const name = ev.name || '';
      const sep = name.includes(' vs. ') ? ' vs. '
                : name.includes(' vs ')  ? ' vs '
                : name.includes(' - ')   ? ' - '
                : null;
      if (!sep) return null;

      const parts = name.split(sep);
      if (parts.length < 2) return null;
      const home = parts[0].trim();
      const away = parts.slice(1).join(sep).trim();

      let homeOdd = null, drawOdd = null, awayOdd = null;

      for (const mktId of (ev.marketIds || [])) {
        const mkt = marketsMap[mktId];
        if (!mkt || mkt.typeId !== 1) continue;  // typeId 1 = 1X2

        for (const oddId of (mkt.oddIds || [])) {
          const odd = oddsMap[oddId];
          if (!odd || odd.oddStatus !== 0 || !odd.price) continue;
          if      (odd.typeId === 1) homeOdd = odd.price;
          else if (odd.typeId === 2) drawOdd = odd.price;
          else if (odd.typeId === 3) awayOdd = odd.price;
        }
        break;
      }

      if (!homeOdd || !awayOdd) return null;

      return this.normalizeMatch({
        home, away,
        sport:     'football',
        startTime: ev.startDate || ev.startEventDate || null,
        odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
      });
    } catch { return null; }
  }
}


// ── 20BET ─────────────────────────────────────────────────────────────────────
// Sin cambios — API pública que funciona bien
class TwentybetScraper extends BaseScraper {
  constructor() {
    super('20bet', {
      minInterval: 45000,
      headers: {
        'Origin':  'https://20glob.com',
        'Referer': 'https://20glob.com/pe/prematch/football',
        'Accept':  'application/json',
      },
    });
  }

  async fetchOdds() {
    const BASE = 'https://platform.20glob.com/api/event/list'
      + '?lang=es'
      + '&relations=odds&relations=competitors&relations=league'
      + '&relations=withMarketsCount&relations=additionalInfo'
      + '&oddsExists_eq=1&main=1&period=0'
      + '&sportId_eq=1&limit=50&status_in=0&isLive=false';

    const results = [];
    let page = 1;
    let lastPage = 1;

    do {
      try {
        const data = await this.request(`${BASE}&page=${page}`);
        lastPage = data?.data?.lastPage || 1;
        const items     = data?.data?.items     || [];
        const relations = data?.data?.relations || {};

        const competitorMap = {};
        for (const c of (relations.competitors || [])) competitorMap[c.id] = c.name;

        const oddsMap = relations.odds || {};

        for (const ev of items) {
          if (ev.sportId !== 1) continue;
          const home = competitorMap[ev.competitor1Id];
          const away = competitorMap[ev.competitor2Id];
          if (!home || !away) continue;

          const markets = oddsMap[String(ev.id)] || [];
          const odds = this.extract1x2(markets);
          if (!odds) continue;

          results.push(this.normalizeMatch({
            home, away,
            sport: 'football', startTime: ev.time,
            odds,
          }));
        }

        page++;
        if (page <= lastPage) await new Promise(r => setTimeout(r, 800));
      } catch (err) {
        this.log(`Error página ${page}: ${err.message}`);
        break;
      }
    } while (page <= lastPage);

    return results;
  }

  extract1x2(markets) {
    const m = markets.find(mkt =>
      mkt.specifiers === null &&
      mkt.favourite === 1 &&
      (mkt.outcomes || []).filter(o => o.active === 1).length === 3
    );

    const market = m || markets.find(mkt =>
      mkt.specifiers === null &&
      (mkt.outcomes || []).filter(o => o.active === 1).length === 3
    );

    if (!market) return null;

    const outcomes = (market.outcomes || []).filter(o => o.active === 1);
    const home = outcomes.find(o => o.vendorOutcomeId === '1');
    const draw = outcomes.find(o => o.vendorOutcomeId === '2');
    const away = outcomes.find(o => o.vendorOutcomeId === '3');

    if (!home || !away) return null;
    return { home: home.odds, draw: draw?.odds ?? null, away: away.odds };
  }
}


// ── COOLBET PE ────────────────────────────────────────────────────────────────
// Playwright intercepta directamente las respuestas de la API (403 resuelto)
class CoolbetScraper extends BaseScraper {
  constructor() {
    super('Coolbet', {
      minInterval: 60000,
      headers: {
        'Origin':          'https://www.coolbet.pe',
        'Referer':         'https://www.coolbet.pe/pe/deportes/futbol',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'es-PE,es;q=0.9',
        'X-Device':        'DESKTOP',
      },
    });
    this._cachedResults = null;
    this._cacheExpiry   = 0;
    this._cacheTTL      = 60000;
  }

  async fetchOdds() {
    const now = Date.now();
    if (this._cachedResults && now < this._cacheExpiry) return this._cachedResults;

    this.log('[browser] Cargando página de fútbol...');
    const page = await require('./BrowserPool').newPage(this.config.headers);

    try {
      const matchMap     = {};
      const allMarketIds = [];
      const oddsResponses = [];

      page.on('response', async (response) => {
        const url = response.url();

        if (url.includes('fo-category')) {
          try {
            const data = await response.json();
            const categories = Array.isArray(data) ? data : (data?.categories || []);
            for (const cat of categories) {
              for (const match of (cat.matches || [])) {
                if (match.status !== 'OPEN' || match.inplay) continue;
                const parts = (match.name || '').split(' - ');
                if (parts.length < 2) continue;

                const market1x2 = (match.markets || []).find(m =>
                  (m.name === 'Match Result (1X2)' || /1x2|resultado/i.test(m.name)) &&
                  m.status === 'OPEN'
                );
                if (!market1x2) continue;

                const homeOC = market1x2.outcomes.find(o => o.result_key === '[Home]');
                const drawOC = market1x2.outcomes.find(o => o.result_key === 'Draw');
                const awayOC = market1x2.outcomes.find(o => o.result_key === '[Away]');
                if (!homeOC || !awayOC) continue;

                matchMap[market1x2.id] = {
                  home: parts[0].trim(),
                  away: parts.slice(1).join(' - ').trim(),
                  startTime: match.start_time || match.startTime || null,
                  homeId: homeOC.id,
                  drawId: drawOC?.id || null,
                  awayId: awayOC.id,
                };
                allMarketIds.push([market1x2.id]);
              }
            }
          } catch {}
        }

        if (url.includes('fo-line')) {
          try {
            const data = await response.json();
            if (Array.isArray(data)) oddsResponses.push(...data);
          } catch {}
        }
      });

      await page.goto('https://www.coolbet.pe/pe/deportes/futbol', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(3000);

      const oddsMap = {};
      for (const item of oddsResponses) {
        if (item.id != null && item.odds != null) oddsMap[item.id] = item.odds;
      }

      const results = [];
      for (const [, info] of Object.entries(matchMap)) {
        const homeOdd = oddsMap[info.homeId];
        const drawOdd = info.drawId ? oddsMap[info.drawId] : null;
        const awayOdd = oddsMap[info.awayId];
        if (!homeOdd || !awayOdd) continue;
        results.push(this.normalizeMatch({
          home: info.home, away: info.away,
          sport: 'football', startTime: info.startTime,
          odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
        }));
      }

      this.log(`Partidos encontrados: ${results.length}`);
      this._cachedResults = results;
      this._cacheExpiry   = now + this._cacheTTL;
      return results;

    } catch (err) {
      this.log(`Error: ${err.message}`);
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }
}


// ── TINBET ────────────────────────────────────────────────────────────────────
// FSB API — si sigue con 403, agregar header 'x-api-key' capturado de DevTools
class TinbetScraper extends BaseScraper {
  constructor() {
    super('Tinbet', {
      minInterval: 45000,
      headers: {
        'Origin':          'https://tinbet.pe',
        'Referer':         'https://tinbet.pe/sportsbook',
        'Accept':          'application/json',
        'Accept-Language': 'es-PE,es;q=0.9',
      },
    });
  }

  async fetchOdds() {
    const ENDPOINT = 'https://prod20465-178940673.fssb.io/api/eventlist/eu/events/v2/upcoming/initial'
      + '?becomeLiveIn=12&topLeagues=&regionCode=PE&numberOfLeagues=0'
      + '&isNewTime=true&isAllMarkets=false&prioritySports=1'
      + '&isTimeSorted=false&sport=1&language=ES&customerLevel=0'
      + '&minimumOdds=1.18&draft=false';

    try {
      const data   = await this.request(ENDPOINT);
      const events = data?.events?.data || [];
      const results = [];
      for (const ev of events) {
        try {
          const parsed = this.parseEvent(ev);
          if (parsed) results.push(parsed);
        } catch { continue; }
      }
      return results;
    } catch (err) {
      this.log('Error: ' + err.message);
      return [];
    }
  }

  parseEvent(ev) {
    const name = ev[9];
    if (!name || !name.includes(' vs ')) return null;
    const [home, away] = name.split(' vs ');
    if (!home || !away) return null;

    const startTime  = ev[10] || null;
    const markets    = ev[17] || [];
    const market1x2  = markets.find(m => /resultado del partido|1x2|match result/i.test(m[1] || m[2] || ''));
    if (!market1x2) return null;

    const outcomes = market1x2[7] || [];
    let homeOdd = null, drawOdd = null, awayOdd = null;

    for (const oc of outcomes) {
      const id  = String(oc[0] || '');
      const odd = parseFloat(oc[4]);
      if (isNaN(odd) || odd < 1.01) continue;
      if (id.endsWith('H')) homeOdd = odd;
      else if (id.endsWith('D')) drawOdd = odd;
      else if (id.endsWith('A')) awayOdd = odd;
    }

    if (!homeOdd || !awayOdd) return null;

    return this.normalizeMatch({
      home: home.trim(), away: away.trim(),
      sport: 'football', startTime,
      odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
    });
  }
}


module.exports = {
  OlimpoScraper,
  BetsafeScraper,
  DoradobetScraper,
  TwentybetScraper,
  CoolbetScraper,
  TinbetScraper,
};
