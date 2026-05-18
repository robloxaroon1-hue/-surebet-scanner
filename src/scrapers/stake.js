// stake.js — Scraper para Stake.com
// v2: Playwright intercepta el GraphQL real + fallback REST

const BaseScraper = require('./BaseScraper');

class StakeScraper extends BaseScraper {
  constructor() {
    super('Stake', {
      timeout:    25000,
      minInterval: 60000,
      headers: {
        'Origin':          'https://stake.com',
        'Referer':         'https://stake.com/sports/soccer',
        'Accept':          'application/json',
        'Accept-Language': 'es-PE,es;q=0.9',
        'Content-Type':    'application/json',
      },
    });
    // Cache de la URL real interceptada
    this._realGraphqlUrl = null;
    this._realQuery      = null;
  }

  async fetchOdds() {
    // 1. Si ya tenemos la URL real, usarla directo
    if (this._realGraphqlUrl) {
      try {
        return await this.fetchViaGraphQL(this._realGraphqlUrl);
      } catch (e) {
        this.log(`GraphQL falló (${e.message}), re-interceptando...`);
        this._realGraphqlUrl = null;
      }
    }

    // 2. Playwright intercepta la URL y query reales
    try {
      return await this.fetchViaBrowser();
    } catch (e) {
      this.log(`Browser falló (${e.message})`);
      return [];
    }
  }

  // ── Playwright: interceptar GraphQL real ──────────────────────────────────
  async fetchViaBrowser() {
    this.log('[browser] Interceptando GraphQL de Stake...');
    const pool = require('./BrowserPool');
    const page = await pool.newPage(this.config.headers);

    try {
      let capturedRequest = null;
      let capturedResponse = null;

      // Interceptar requests de GraphQL
      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('graphql') && request.method() === 'POST') {
          try {
            const postData = request.postDataJSON();
            // Buscar la query de eventos de fútbol
            if (postData?.query && /sport|event|soccer|football/i.test(postData.query)) {
              capturedRequest = { url, query: postData.query, variables: postData.variables };
            }
          } catch {}
        }
      });

      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('graphql') && capturedRequest?.url === url) {
          try {
            const body = await response.json();
            // Verificar que tiene eventos de fútbol
            const hasEvents = JSON.stringify(body).includes('soccer') ||
                              JSON.stringify(body).includes('football') ||
                              JSON.stringify(body).includes('startTime');
            if (hasEvents) capturedResponse = body;
          } catch {}
        }
      });

      await page.goto('https://stake.com/sports/soccer', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(3000);

      if (capturedRequest) {
        this._realGraphqlUrl = capturedRequest.url;
        this.log(`[browser] URL GraphQL real: ${this._realGraphqlUrl}`);
      }

      if (capturedResponse) {
        const results = this.parseGraphQLResponse(capturedResponse);
        this.log(`Partidos desde browser: ${results.length}`);
        return results;
      }

      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ── GraphQL directo (usando URL real ya conocida) ─────────────────────────
  async fetchViaGraphQL(url) {
    const QUERY = `
      query getPrematchEvents($sport: String!, $limit: Int!, $offset: Int) {
        sports(slug: $sport) {
          events(status: "pre_match", limit: $limit, offset: $offset) {
            id name startTime status
            home { name }
            away { name }
            markets {
              name status
              outcomes { name price status }
            }
          }
        }
      }
    `;

    const results = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const data = await this.graphql(url, QUERY, { sport: 'soccer', limit, offset });
      const events = data?.data?.sports?.[0]?.events || [];
      if (!events.length) break;

      for (const ev of events) {
        const parsed = this.parseEvent(ev);
        if (parsed) results.push(parsed);
      }

      if (events.length < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 500));
    }

    return results;
  }

  // ── Parsear respuesta GraphQL ─────────────────────────────────────────────
  parseGraphQLResponse(data) {
    const events = data?.data?.sports?.[0]?.events
      || data?.data?.soccer?.events
      || data?.data?.events
      || [];

    return events.map(ev => this.parseEvent(ev)).filter(Boolean);
  }

  parseEvent(ev) {
    try {
      const home = ev.home?.name || ev.name?.split(' v ')?.[0] || ev.name?.split(' vs ')?.[0];
      const away = ev.away?.name || ev.name?.split(' v ')?.[1] || ev.name?.split(' vs ')?.[1];
      if (!home || !away) return null;

      const market = (ev.markets || []).find(m =>
        /1x2|match result|full time|resultado/i.test(m.name) && m.status === 'open'
      );
      if (!market) return null;

      const outcomes  = (market.outcomes || []).filter(o => o.status === 'open');
      const homeOut   = outcomes.find(o => /home|local|1$/i.test(o.name));
      const drawOut   = outcomes.find(o => /draw|empate|x$/i.test(o.name));
      const awayOut   = outcomes.find(o => /away|visit|2$/i.test(o.name));

      const homeOdd = parseFloat(homeOut?.price);
      const drawOdd = parseFloat(drawOut?.price) || null;
      const awayOdd = parseFloat(awayOut?.price);

      if (!homeOdd || !awayOdd || homeOdd < 1.01 || awayOdd < 1.01) return null;

      return this.normalizeMatch({
        home: home.trim(), away: away.trim(),
        sport: 'football', startTime: ev.startTime,
        odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
      });
    } catch {
      return null;
    }
  }
}

module.exports = StakeScraper;
