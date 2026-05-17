// betano.js — Scraper para Betano Perú
// Betano usa API REST interceptable — endpoint descubierto via DevTools
// URL base Perú: https://www.betano.pe

const BaseScraper = require('./BaseScraper');

// ── INSTRUCCIONES DEVTOOLS PARA ENCONTRAR EL ENDPOINT ─────────────────────────
// 1. Abrir betano.pe → Deportes → Fútbol
// 2. F12 → Network → Filtrar por "XHR" o "Fetch"
// 3. Buscar request que contenga "events" o "sports" o "fixtures"
// 4. Copiar la URL y los headers exactos (especialmente cookies/auth)
// 5. Reemplazar EVENTS_URL abajo y ajustar parseEvent()
// ──────────────────────────────────────────────────────────────────────────────

// PLACEHOLDER — reemplazar con endpoint real de DevTools
const EVENTS_URL = 'https://www.betano.pe/api/sports/1/events/'; // 1 = fútbol

class BetanoScraper extends BaseScraper {
  constructor() {
    super('Betano', {
      timeout: 15000,
      minInterval: 40000,
      headers: {
        'Origin': 'https://www.betano.pe',
        'Referer': 'https://www.betano.pe/sport/futbol/',
        // Agregar headers/cookies que veas en DevTools si se requieren
      },
    });
  }

  async fetchOdds() {
    const data = await this.request(EVENTS_URL, {
      params: {
        // Ajustar según parámetros que veas en DevTools
        // Ej: lang: 'es', page: 1, sort: 'Popularity'
      },
    });

    // La respuesta típica de Betano tiene una estructura como:
    // { data: { blocks: [{ events: [...] }] } }
    // o: { events: [...] }
    const events = this.extractEvents(data);
    return events.map(ev => this.parseEvent(ev)).filter(m => m !== null);
  }

  extractEvents(data) {
    // Intentar múltiples rutas según versión de API
    return data?.data?.blocks?.[0]?.events
      || data?.data?.events
      || data?.events
      || data?.results
      || [];
  }

  parseEvent(ev) {
    try {
      // Estructura típica de Betano — ajustar según respuesta real
      const participants = ev.participants || ev.teams || [];
      const home = participants[0]?.name || ev.homeName || ev.home;
      const away = participants[1]?.name || ev.awayName || ev.away;

      // Buscar mercado 1X2
      const markets = ev.markets || ev.betGroups || [];
      const market1x2 = markets.find(m =>
        m.name === '1X2' || m.name === 'Resultado Final' || m.marketId === 1
      );

      if (!market1x2) return null;

      const selections = market1x2.selections || market1x2.bets || [];
      const homeOdd = selections.find(s => s.name === '1' || s.type === 'home')?.odds
                   || selections[0]?.odds;
      const drawOdd = selections.find(s => s.name === 'X' || s.type === 'draw')?.odds
                   || selections[1]?.odds;
      const awayOdd = selections.find(s => s.name === '2' || s.type === 'away')?.odds
                   || selections[2]?.odds;

      if (!homeOdd || !awayOdd) return null;

      return this.normalizeMatch({
        home,
        away,
        sport: 'football',
        startTime: ev.startTime || ev.startdate || ev.kickoff,
        odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
      });
    } catch {
      return null;
    }
  }
}

module.exports = BetanoScraper;
