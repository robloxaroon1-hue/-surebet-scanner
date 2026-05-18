// scrapers/betano.js — Betano PE
// Plataforma propia de Betano (danae-webapi)
// v2: Playwright como fallback si axios falla (400/403/etc)

const BaseScraper = require('./BaseScraper');

class BetanoScraper extends BaseScraper {
  constructor() {
    super('Betano', {
      minInterval: 45000,
      headers: {
        'Origin':          'https://www.betano.pe',
        'Referer':         'https://www.betano.pe/sport/futbol/lista/',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'es-PE,es;q=0.9',
      },
    });
  }

  async fetchOdds() {
    const ENDPOINT = 'https://www.betano.pe/danae-webapi/api/live/overview/latest?includeVirtuals=false';

    // Intentar axios primero (rápido, sin overhead)
    try {
      const data = await this.request(ENDPOINT);
      if (data && typeof data === 'object') {
        const results = this.parseData(data);
        if (results.length > 0) return results;
        // Si vino 200 pero sin datos, también caer al browser
        throw new Error('Respuesta vacía');
      }
    } catch (err) {
      this.log(`Axios falló (${err.message}), usando browser...`);
    }

    // Fallback: Playwright intercepta la respuesta real
    return this.fetchViaBrowser();
  }

  // ── Fallback browser ──────────────────────────────────────────────────────
  async fetchViaBrowser() {
    try {
      const captured = await this.browserIntercept(
        'https://www.betano.pe/sport/futbol/lista/',
        'danae-webapi',
        { timeout: 25000, waitFor: 'networkidle' }
      );

      this.log(`[browser] URL capturada: ${captured.url}`);
      return this.parseData(captured.body);

    } catch (err) {
      this.log(`Browser también falló: ${err.message}`);
      return [];
    }
  }

  // ── Parser (sin cambios) ──────────────────────────────────────────────────
  parseData(data) {
    const results    = [];
    const events     = data.events     || {};
    const markets    = data.markets    || {};
    const selections = data.selections || {};
    const leagues    = data.leagues    || {};

    for (const eventId of Object.keys(events)) {
      try {
        const ev = events[eventId];

        if (ev.sportId !== 'FOOT') continue;
        if (ev.isVirtual) continue;

        const leagueName = (leagues[ev.leagueId]?.name || '').toLowerCase();
        if (/esoccer|esports|simulated|virtual|eadriatic|battle|gt league|h2h gg/i.test(leagueName)) continue;

        const participants = ev.participants || [];
        const home = participants.find(p => p.isHome)?.name  || participants[0]?.name;
        const away = participants.find(p => !p.isHome)?.name || participants[1]?.name;
        if (!home || !away) continue;

        let homeOdds = null, drawOdds = null, awayOdds = null;

        for (const marketId of (ev.marketIdList || [])) {
          const market = markets[marketId];
          if (!market || market.type !== 'MRES' || market.isSuspended) continue;

          for (const selId of (market.selectionIdList || [])) {
            const sel = selections[selId];
            if (!sel || sel.isSuspended) continue;
            if (sel.name === '1') homeOdds = parseFloat(sel.price);
            if (sel.name === 'X') drawOdds = parseFloat(sel.price);
            if (sel.name === '2') awayOdds = parseFloat(sel.price);
          }
          break;
        }

        if (!homeOdds || !awayOdds || homeOdds < 1.01 || awayOdds < 1.01) continue;

        results.push(this.normalizeMatch({
          home, away,
          sport:     'football',
          startTime: ev.startTime ? new Date(ev.startTime).toISOString() : null,
          odds: { home: homeOdds, draw: drawOdds, away: awayOdds },
        }));

      } catch (parseErr) {
        this.log(`Error parseando evento ${eventId}: ${parseErr.message}`);
        continue;
      }
    }

    this.log(`Partidos encontrados: ${results.length}`);
    return results;
  }
}

module.exports = BetanoScraper;
