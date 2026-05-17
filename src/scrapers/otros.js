// scrapers-restantes.js — Doradobet, Betsafe, 20bet, Coolbet PE, Tinbet, Olimpobet PE
// Cada uno incluye la guía exacta para encontrar el endpoint en DevTools

const BaseScraper = require('./BaseScraper');

// ══════════════════════════════════════════════════════════════════════════════
// GUÍA DEVTOOLS (aplica para TODAS las casas):
//
//  1. Abrir el sitio en Chrome → ir a la sección Fútbol / Deportivos
//  2. F12 → pestaña Network → seleccionar "Fetch/XHR"
//  3. Hacer click en un deporte para que cargue los partidos
//  4. Buscar en la lista el request que traiga eventos (busca palabras como
//     "events", "odds", "fixtures", "sports", "prematch")
//  5. Click en ese request → pestaña "Headers":
//     - Copiar la URL completa (Request URL)
//     - Copiar los headers relevantes: Authorization, x-api-key, Cookie, etc.
//  6. Pestaña "Preview" o "Response" → ver la estructura JSON
//  7. Reemplazar la URL y ajustar el parseEvent() de cada clase
//
//  Para endpoints con autenticación: buscar en la pestaña "Payload" 
//  si hay tokens que se envían en el body o como query params
// ══════════════════════════════════════════════════════════════════════════════


// ── DORADOBET ─────────────────────────────────────────────────────────────────
// Sitio: doradobet.pe
// Protección: Variable (puede tener Cloudflare básico)
class DoradobetScraper extends BaseScraper {
  constructor() {
    super('Doradobet', {
      minInterval: 45000,
      headers: {
        'Origin': 'https://doradobet.pe',
        'Referer': 'https://doradobet.pe/sports',
        // Agregar headers encontrados en DevTools
      },
    });
  }

  async fetchOdds() {
    // TODO: Reemplazar con URL encontrada en DevTools
    const ENDPOINT = 'https://doradobet.pe/api/TODO_ENDPOINT';

    const data = await this.request(ENDPOINT);
    const events = data?.events || data?.data || data?.matches || [];
    return events.map(ev => this.parseEvent(ev)).filter(Boolean);
  }

  parseEvent(ev) {
    try {
      // TODO: Ajustar según estructura real de la respuesta
      const home = ev.home || ev.homeTeam?.name || ev.participants?.[0]?.name;
      const away = ev.away || ev.awayTeam?.name || ev.participants?.[1]?.name;
      const odds  = this.extract1x2(ev);
      if (!home || !away || !odds) return null;
      return this.normalizeMatch({ home, away, sport: 'football',
        startTime: ev.startTime || ev.date, odds });
    } catch { return null; }
  }

  // Helper reutilizable para extraer cuotas 1X2 de distintas estructuras
  extract1x2(ev) {
    const markets = ev.markets || ev.betGroups || ev.odds || [];
    const m = Array.isArray(markets)
      ? markets.find(m => /1x2|resultado|winner|full.?time/i.test(m.name || m.type))
      : markets;
    if (!m) return null;
    const s = m.selections || m.outcomes || m.bets || Object.values(m);
    if (!s?.length) return null;
    return {
      home: s[0]?.odds || s[0]?.value || s[0]?.price,
      draw: s[1]?.odds || s[1]?.value || s[1]?.price,
      away: s[2]?.odds || s[2]?.value || s[2]?.price,
    };
  }
}


// ── BETSAFE ───────────────────────────────────────────────────────────────────
// Sitio: betsafe.pe  
// Protección: Cloudflare moderado — puede requerir puppeteer si axios falla
class BetsafeScraper extends BaseScraper {
  constructor() {
    super('Betsafe', {
      minInterval: 60000, // más conservador por Cloudflare
      headers: {
        'Origin': 'https://www.betsafe.pe',
        'Referer': 'https://www.betsafe.pe/es/sports',
        // IMPORTANTE: Betsafe con Cloudflare puede requerir:
        // - Cookie 'cf_clearance' obtenida de navegador real
        // - Header 'cf-turnstile-response'
        // Si axios da 403, agregar la cookie aquí
        // 'Cookie': 'cf_clearance=XXX; session=YYY',
      },
    });
  }

  async fetchOdds() {
    // TODO: Endpoint encontrado en DevTools
    // Betsafe suele usar algo como: /api/v2/sports/events o /sportsbook/events
    const ENDPOINT = 'https://www.betsafe.pe/api/TODO_ENDPOINT';

    try {
      const data = await this.request(ENDPOINT);
      const events = this.extractEvents(data);
      return events.map(ev => this.parseEvent(ev)).filter(Boolean);
    } catch (err) {
      if (err.response?.status === 403) {
        this.log('⚠️  403 Cloudflare — necesitas agregar cookie cf_clearance');
        this.log('    Ve a betsafe.pe en Chrome, F12 → Application → Cookies');
        this.log('    Copia el valor de cf_clearance y ponlo en los headers');
      }
      return [];
    }
  }

  extractEvents(data) {
    return data?.data?.events || data?.events || data?.results || data || [];
  }

  parseEvent(ev) {
    try {
      const home = ev.home?.name || ev.homeTeam || ev.teams?.[0];
      const away = ev.away?.name || ev.awayTeam || ev.teams?.[1];
      const odds = this.extract1x2(ev);
      if (!home || !away || !odds) return null;
      return this.normalizeMatch({ home, away, sport: 'football',
        startTime: ev.kickoffTime || ev.startTime, odds });
    } catch { return null; }
  }

  extract1x2(ev) {
    const markets = ev.markets || ev.oddsGroups || [];
    const m = markets.find(x => /1x2|1\.1|resultado/i.test(x.name || x.id));
    if (!m) return null;
    const o = m.odds || m.selections || [];
    return { home: o[0]?.value, draw: o[1]?.value, away: o[2]?.value };
  }
}


// ── 20BET ─────────────────────────────────────────────────────────────────────
// Sitio: 20bet.pe o 20bet.com (ver cuál funciona en PE)
// Protección: API REST con headers específicos
class TwentybetScraper extends BaseScraper {
  constructor() {
    super('20bet', {
      minInterval: 40000,
      headers: {
        'Origin': 'https://20bet.pe',
        'Referer': 'https://20bet.pe/sports/football',
        // 20bet suele requerir header 'X-Api-Key' o 'Authorization: Bearer XXX'
        // Encuéntralo en DevTools → Network → Headers del request de odds
        // 'X-Api-Key': 'tu-api-key-aqui',
      },
    });
  }

  async fetchOdds() {
    // TODO: Endpoint de DevTools. 20bet suele tener algo como:
    // /api/v1/sports/1/events o /api/sports/football/prematch
    const ENDPOINT = 'https://20bet.pe/api/TODO_ENDPOINT';

    const data = await this.request(ENDPOINT, {
      params: {
        // Parámetros que veas en DevTools (sportId, limit, etc.)
      },
    });

    const events = data?.data || data?.events || data?.result || [];
    return events.map(ev => this.parseEvent(ev)).filter(Boolean);
  }

  parseEvent(ev) {
    try {
      const home = ev.team1 || ev.home || ev.homeTeam?.name;
      const away = ev.team2 || ev.away || ev.awayTeam?.name;
      const odds = this.extract1x2(ev);
      if (!home || !away || !odds) return null;
      return this.normalizeMatch({ home, away, sport: 'football',
        startTime: ev.date || ev.start || ev.startTime, odds });
    } catch { return null; }
  }

  extract1x2(ev) {
    // 20bet suele tener odds directamente en el evento
    if (ev.odds?.['1'] && ev.odds?.['2']) {
      return { home: ev.odds['1'], draw: ev.odds['X'], away: ev.odds['2'] };
    }
    const markets = ev.markets || ev.bets || [];
    const m = markets.find(x => /1x2|resultado|full/i.test(x.name));
    if (!m) return null;
    const o = m.outcomes || m.odds || [];
    return { home: o[0]?.odd, draw: o[1]?.odd, away: o[2]?.odd };
  }
}


// ── COOLBET PE ────────────────────────────────────────────────────────────────
// Sitio: coolbet.com (opera en PE)
// Protección: Variable
class CoolbetScraper extends BaseScraper {
  constructor() {
    super('Coolbet', {
      minInterval: 50000,
      headers: {
        'Origin': 'https://www.coolbet.com',
        'Referer': 'https://www.coolbet.com/es/sports/football',
      },
    });
  }

  async fetchOdds() {
    // Coolbet tiene API pública en algunos países
    // TODO: Buscar en DevTools el endpoint exacto
    // Posibles URLs:
    // https://www.coolbet.com/api/fixtures/football
    // https://api.coolbet.com/v1/sports/soccer/events
    const ENDPOINT = 'https://www.coolbet.com/api/TODO_ENDPOINT';

    const data = await this.request(ENDPOINT);
    const events = data?.fixtures || data?.events || data?.data || [];
    return events.map(ev => this.parseEvent(ev)).filter(Boolean);
  }

  parseEvent(ev) {
    try {
      const home = ev.homeTeam?.name || ev.home || ev.contestant1;
      const away = ev.awayTeam?.name || ev.away || ev.contestant2;
      const odds = this.extract1x2(ev);
      if (!home || !away || !odds) return null;
      return this.normalizeMatch({ home, away, sport: 'football',
        startTime: ev.startTime || ev.kickoff, odds });
    } catch { return null; }
  }

  extract1x2(ev) {
    const markets = ev.markets || ev.betOffers || [];
    const m = markets.find(x =>
      x.betOfferType?.name === 'Match' ||
      /1x2|resultado|winner/i.test(x.name)
    );
    if (!m) return null;
    const o = m.outcomes || m.betOfferOutcomes || [];
    return {
      home: o.find(x => /home|1/i.test(x.type || x.label))?.odds,
      draw: o.find(x => /draw|x/i.test(x.type || x.label))?.odds,
      away: o.find(x => /away|2/i.test(x.type || x.label))?.odds,
    };
  }
}


// ── TINBET ────────────────────────────────────────────────────────────────────
// Sitio: tinbet.pe (casa local peruana)
// Protección: Desconocida — puede ser más sencilla al ser local
class TinbetScraper extends BaseScraper {
  constructor() {
    super('Tinbet', {
      minInterval: 45000,
      headers: {
        'Origin': 'https://tinbet.pe',
        'Referer': 'https://tinbet.pe/deportes',
      },
    });
  }

  async fetchOdds() {
    // TODO: Endpoint de DevTools
    // Casas locales peruanas suelen tener APIs simples sin mucha protección
    const ENDPOINT = 'https://tinbet.pe/api/TODO_ENDPOINT';

    const data = await this.request(ENDPOINT);
    const events = data?.events || data?.data?.events || data || [];
    return Array.isArray(events)
      ? events.map(ev => this.parseEvent(ev)).filter(Boolean)
      : [];
  }

  parseEvent(ev) {
    try {
      const home = ev.home || ev.local || ev.equipo1;
      const away = ev.away || ev.visitante || ev.equipo2;
      const odds = this.extract1x2(ev);
      if (!home || !away || !odds) return null;
      return this.normalizeMatch({ home, away, sport: 'football',
        startTime: ev.fecha || ev.startTime || ev.date, odds });
    } catch { return null; }
  }

  extract1x2(ev) {
    // Las casas locales a veces tienen estructura más plana
    if (ev.cuota1 && ev.cuota2) {
      return { home: ev.cuota1, draw: ev.cuotaX || ev.cuotaEmpate, away: ev.cuota2 };
    }
    const markets = ev.markets || ev.mercados || [];
    const m = markets.find(x => /1x2|resultado/i.test(x.nombre || x.name));
    if (!m) return null;
    const o = m.opciones || m.selections || [];
    return { home: o[0]?.cuota || o[0]?.odd, draw: o[1]?.cuota || o[1]?.odd,
             away: o[2]?.cuota || o[2]?.odd };
  }
}


// ── OLIMPOBET PE ──────────────────────────────────────────────────────────────
// Sitio: olimpobet.pe (casa local peruana)
// Protección: Desconocida
class OlimpoScraper extends BaseScraper {
  constructor() {
    super('Olimpobet', {
      minInterval: 45000,
      headers: {
        'Origin': 'https://olimpobet.pe',
        'Referer': 'https://olimpobet.pe/deportes',
      },
    });
  }

  async fetchOdds() {
    // TODO: Endpoint de DevTools
    const ENDPOINT = 'https://olimpobet.pe/api/TODO_ENDPOINT';

    const data = await this.request(ENDPOINT);
    const events = data?.events || data?.data || data?.partidos || [];
    return Array.isArray(events)
      ? events.map(ev => this.parseEvent(ev)).filter(Boolean)
      : [];
  }

  parseEvent(ev) {
    try {
      const home = ev.home || ev.equipo_local || ev.homeTeam;
      const away = ev.away || ev.equipo_visitante || ev.awayTeam;
      const odds = this.extract1x2(ev);
      if (!home || !away || !odds) return null;
      return this.normalizeMatch({ home, away, sport: 'football',
        startTime: ev.startTime || ev.fecha, odds });
    } catch { return null; }
  }

  extract1x2(ev) {
    if (ev.odd1 && ev.odd2) {
      return { home: ev.odd1, draw: ev.oddX, away: ev.odd2 };
    }
    const markets = ev.markets || ev.apuestas || [];
    const m = markets.find(x => /1x2|resultado/i.test(x.name || x.tipo));
    if (!m) return null;
    const o = m.selections || m.opciones || [];
    return { home: o[0]?.odds, draw: o[1]?.odds, away: o[2]?.odds };
  }
}


module.exports = {
  DoradobetScraper,
  BetsafeScraper,
  TwentybetScraper,
  CoolbetScraper,
  TinbetScraper,
  OlimpoScraper,
};
