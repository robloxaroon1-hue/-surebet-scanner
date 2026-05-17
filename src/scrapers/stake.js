// stake.js — Scraper para Stake.com
// Stake usa GraphQL público sin autenticación para eventos pre-match
// Endpoint: https://sports-api.stake.com/graphql

const BaseScraper = require('./BaseScraper');

const GRAPHQL_URL = 'https://sports-api.stake.com/graphql';

// Query GraphQL para obtener eventos de fútbol con odds 1X2
const EVENTS_QUERY = `
query EventList($sport: String!, $limit: Int) {
  sportEventList(sport: $sport, limit: $limit, status: "pre_match") {
    id
    name
    slug
    startTime
    homeTeam { name }
    awayTeam { name }
    markets {
      name
      outcomes {
        name
        odds
      }
    }
  }
}
`;

// Alternativa: endpoint REST de fixtures (más estable)
const FIXTURES_URL = 'https://sports-api.stake.com/v1/fixtures';

class StakeScraper extends BaseScraper {
  constructor() {
    super('Stake', {
      timeout: 20000,
      minInterval: 45000, // 45s entre fetches
      headers: {
        'Origin': 'https://stake.com',
        'Referer': 'https://stake.com/',
        'x-access-token': '', // Stake permite token vacío para datos públicos
      },
    });
  }

  async fetchOdds() {
    // Intentar con el endpoint REST primero (más confiable)
    try {
      return await this.fetchViaREST();
    } catch (e) {
      this.log('REST falló, intentando GraphQL...');
      return await this.fetchViaGraphQL();
    }
  }

  // ── Método REST ────────────────────────────────────────────────────────────
  async fetchViaREST() {
    const data = await this.request(FIXTURES_URL, {
      params: {
        sport: 'soccer',
        limit: 200,
        status: 'upcoming',
      },
    });

    const events = data?.data || data?.fixtures || data || [];
    return events
      .map(ev => this.parseRESTEvent(ev))
      .filter(m => m !== null);
  }

  parseRESTEvent(ev) {
    try {
      // La estructura exacta depende de la versión del endpoint
      // Ajustar según lo que veas en DevTools
      const home = ev.homeTeam?.name || ev.home;
      const away = ev.awayTeam?.name || ev.away;

      // Buscar mercado 1X2 o Match Winner
      const market = (ev.markets || []).find(m =>
        /1x2|match winner|full time result/i.test(m.name)
      );
      if (!market) return null;

      const outcomes = market.outcomes || [];
      const homeOdd = outcomes.find(o => /home|1/i.test(o.name))?.odds;
      const drawOdd = outcomes.find(o => /draw|x/i.test(o.name))?.odds;
      const awayOdd = outcomes.find(o => /away|2/i.test(o.name))?.odds;

      if (!homeOdd || !awayOdd) return null;

      return this.normalizeMatch({
        home,
        away,
        sport: 'football',
        startTime: ev.startTime || ev.start_time,
        odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
      });
    } catch {
      return null;
    }
  }

  // ── Método GraphQL ─────────────────────────────────────────────────────────
  async fetchViaGraphQL() {
    const data = await this.graphql(GRAPHQL_URL, EVENTS_QUERY, {
      sport: 'soccer',
      limit: 200,
    });

    const events = data?.data?.sportEventList || [];
    return events
      .map(ev => this.parseGQLEvent(ev))
      .filter(m => m !== null);
  }

  parseGQLEvent(ev) {
    try {
      const market = (ev.markets || []).find(m =>
        /1x2|match winner/i.test(m.name)
      );
      if (!market) return null;

      const outcomes = market.outcomes || [];
      const homeOdd = outcomes.find(o => /home|1/i.test(o.name))?.odds;
      const drawOdd = outcomes.find(o => /draw|x/i.test(o.name))?.odds;
      const awayOdd = outcomes.find(o => /away|2/i.test(o.name))?.odds;

      if (!homeOdd || !awayOdd) return null;

      return this.normalizeMatch({
        home: ev.homeTeam?.name || ev.name?.split(' vs ')[0],
        away: ev.awayTeam?.name || ev.name?.split(' vs ')[1],
        sport: 'football',
        startTime: ev.startTime,
        odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
      });
    } catch {
      return null;
    }
  }
}

module.exports = StakeScraper;
