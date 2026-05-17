// nuevas.js — Apuesta Total PE y Retabet PE
// ─────────────────────────────────────────────────────────────────────────────
// GUÍA DEVTOOLS RÁPIDA:
//  1. Chrome → sitio de la casa → sección Deportes/Fútbol
//  2. F12 → Network → filtro "Fetch/XHR"
//  3. Navegar a partidos del día
//  4. Buscar request con: events, odds, fixtures, prematch, sports
//  5. Headers → copiar Request URL y headers especiales
//  6. Response → ver estructura JSON
//  7. Reemplazar TODO_ENDPOINT y ajustar parseEvent()
// ─────────────────────────────────────────────────────────────────────────────

const BaseScraper = require('./BaseScraper');


// ══════════════════════════════════════════════════════════════════════════════
// APUESTA TOTAL PE
// Sitio: apuestatotal.pe
// Protección: Normalmente API REST simple (casa local peruana)
// ══════════════════════════════════════════════════════════════════════════════
class ApuestaTotalScraper extends BaseScraper {
  constructor() {
    super('ApuestaTotal', {
      minInterval: 45000,
      headers: {
        'Origin':   'https://apuestatotal.pe',
        'Referer':  'https://apuestatotal.pe/deportes/futbol',
        // Si encuentras headers especiales en DevTools, agrégalos aquí:
        // 'Authorization': 'Bearer XXX',
        // 'x-api-key': 'XXX',
      },
    });
  }

  async fetchOdds() {
    // ─── PASO 1: Reemplaza esta URL con la encontrada en DevTools ─────────────
    // Posibles patrones de URL en casas peruanas:
    //   https://apuestatotal.pe/api/sports/events
    //   https://apuestatotal.pe/api/v1/prematch/football
    //   https://api.apuestatotal.pe/events?sport=football
    const ENDPOINT = 'https://apuestatotal.pe/api/TODO_ENDPOINT';
    // ─────────────────────────────────────────────────────────────────────────

    try {
      const data = await this.request(ENDPOINT, {
        params: {
          // Agrega params encontrados en DevTools, ej:
          // sport: 'football', limit: 100
        },
      });

      // Intenta detectar la estructura automáticamente
      const events =
        data?.events          ||
        data?.data?.events    ||
        data?.data            ||
        data?.result          ||
        data?.partidos        ||
        (Array.isArray(data) ? data : []);

      return events.map(ev => this.parseEvent(ev)).filter(Boolean);
    } catch (err) {
      if (err.response?.status === 403) {
        this.log('⚠️  403 — Agrega headers de autenticación en DevTools');
      } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        this.log('⚠️  TODO_ENDPOINT sin configurar — busca en DevTools');
      }
      return [];
    }
  }

  parseEvent(ev) {
    try {
      // Intenta múltiples formatos de campo
      const home =
        ev.home             ||
        ev.homeTeam?.name   ||
        ev.equipo_local     ||
        ev.local            ||
        ev.equipo1          ||
        ev.team1;

      const away =
        ev.away             ||
        ev.awayTeam?.name   ||
        ev.equipo_visitante ||
        ev.visitante        ||
        ev.equipo2          ||
        ev.team2;

      const odds = this.extract1x2(ev);
      if (!home || !away || !odds) return null;

      return this.normalizeMatch({
        home,
        away,
        sport: 'football',
        startTime: ev.startTime || ev.fecha || ev.date || ev.start,
        odds,
      });
    } catch { return null; }
  }

  extract1x2(ev) {
    // Formato plano (cuotas directas en el evento)
    if (ev.cuota1 && ev.cuota2) {
      return {
        home: ev.cuota1,
        draw: ev.cuotaX || ev.cuotaEmpate || null,
        away: ev.cuota2,
      };
    }
    if (ev.odd1 && ev.odd2) {
      return { home: ev.odd1, draw: ev.oddX, away: ev.odd2 };
    }

    // Formato con array de mercados
    const markets = ev.markets || ev.mercados || ev.betGroups || [];
    const m = markets.find(x =>
      /1x2|resultado|full.?time|1\s*x\s*2/i.test(x.name || x.nombre || x.type || '')
    );
    if (!m) return null;

    const sels = m.selections || m.outcomes || m.opciones || m.bets || [];
    return {
      home: sels[0]?.odds || sels[0]?.cuota || sels[0]?.odd || sels[0]?.value,
      draw: sels[1]?.odds || sels[1]?.cuota || sels[1]?.odd || sels[1]?.value,
      away: sels[2]?.odds || sels[2]?.cuota || sels[2]?.odd || sels[2]?.value,
    };
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// RETABET PE
// Sitio: retabet.pe
// Protección: Variable — pueden tener x-requested-with o tokens CSRF
// ══════════════════════════════════════════════════════════════════════════════
class RetabetScraper extends BaseScraper {
  constructor() {
    super('Retabet', {
      minInterval: 50000,
      headers: {
        'Origin':            'https://retabet.pe',
        'Referer':           'https://retabet.pe/deportes',
        'X-Requested-With':  'XMLHttpRequest',
        // Si el request en DevTools incluye un token o cookie:
        // 'Authorization': 'Bearer XXX',
        // 'Cookie': 'session=XXX',
      },
    });
  }

  async fetchOdds() {
    // ─── PASO 1: Reemplaza con URL de DevTools ────────────────────────────────
    // Patrones comunes en plataformas Retabet:
    //   https://retabet.pe/api/events?sport=football&type=prematch
    //   https://retabet.pe/sportsbook/football/events
    //   https://api.retabet.pe/v1/sports/soccer/markets
    const ENDPOINT = 'https://retabet.pe/api/TODO_ENDPOINT';
    // ─────────────────────────────────────────────────────────────────────────

    try {
      const data = await this.request(ENDPOINT);

      const events =
        data?.events            ||
        data?.data?.events      ||
        data?.result?.events    ||
        data?.items             ||
        data?.fixtures          ||
        (Array.isArray(data) ? data : []);

      return events.map(ev => this.parseEvent(ev)).filter(Boolean);
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        this.log('⚠️  Auth requerida — busca Authorization header en DevTools');
        this.log('    F12 → Network → click en el request de odds → Headers');
      } else if (err.code === 'ENOTFOUND') {
        this.log('⚠️  TODO_ENDPOINT sin configurar');
      }
      return [];
    }
  }

  parseEvent(ev) {
    try {
      const home =
        ev.home               ||
        ev.homeTeam?.name     ||
        ev.homeName           ||
        ev.contestant_home    ||
        ev.team_home          ||
        ev.local;

      const away =
        ev.away               ||
        ev.awayTeam?.name     ||
        ev.awayName           ||
        ev.contestant_away    ||
        ev.team_away          ||
        ev.visitante;

      const odds = this.extract1x2(ev);
      if (!home || !away || !odds) return null;

      return this.normalizeMatch({
        home,
        away,
        sport: 'football',
        startTime: ev.startTime || ev.kickoff || ev.date || ev.start_time,
        odds,
      });
    } catch { return null; }
  }

  extract1x2(ev) {
    // Formato plano
    if (ev.odds_home && ev.odds_away) {
      return { home: ev.odds_home, draw: ev.odds_draw, away: ev.odds_away };
    }

    // Formato con mercados
    const markets =
      ev.markets      ||
      ev.marketGroups ||
      ev.bet_offers   ||
      ev.apuestas     ||
      [];

    const m = markets.find(x =>
      /1x2|resultado|match\s*winner|full.?time/i.test(
        x.name || x.marketName || x.type || x.bet_type || ''
      )
    );
    if (!m) return null;

    const o = m.selections || m.outcomes || m.odds || m.picks || [];
    return {
      home: o[0]?.odds || o[0]?.price || o[0]?.odd || o[0]?.value,
      draw: o[1]?.odds || o[1]?.price || o[1]?.odd || o[1]?.value,
      away: o[2]?.odds || o[2]?.price || o[2]?.odd || o[2]?.value,
    };
  }
}


module.exports = { ApuestaTotalScraper, RetabetScraper };
