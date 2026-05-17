// store.js — Almacén central en memoria de todas las odds
// Estructura: { sportKey: { matchKey: { bookmaker: { home, draw, away, timestamp } } } }

class OddsStore {
  constructor() {
    this.odds = {};        // odds por partido
    this.surebets = [];    // surebets encontradas
    this.lastUpdate = {};  // timestamp por casa
  }

  // Guardar odds de una casa para un partido
  setOdds(bookmaker, sport, matchKey, oddsData) {
    if (!this.odds[sport]) this.odds[sport] = {};
    if (!this.odds[sport][matchKey]) this.odds[sport][matchKey] = {};

    this.odds[sport][matchKey][bookmaker] = {
      ...oddsData,
      timestamp: Date.now(),
    };

    this.lastUpdate[bookmaker] = Date.now();
  }

  // Obtener todos los partidos de un deporte
  getMatches(sport) {
    return this.odds[sport] || {};
  }

  // Obtener odds de un partido específico en todas las casas
  getMatchOdds(sport, matchKey) {
    return this.odds[sport]?.[matchKey] || {};
  }

  // Limpiar odds viejas (más de N minutos)
  cleanup(maxAgeMinutes = 30) {
    const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
    for (const sport of Object.keys(this.odds)) {
      for (const matchKey of Object.keys(this.odds[sport])) {
        for (const bk of Object.keys(this.odds[sport][matchKey])) {
          if (this.odds[sport][matchKey][bk].timestamp < cutoff) {
            delete this.odds[sport][matchKey][bk];
          }
        }
        // Si no quedan casas para ese partido, borrar el partido
        if (Object.keys(this.odds[sport][matchKey]).length === 0) {
          delete this.odds[sport][matchKey];
        }
      }
    }
  }

  // Devolver todos los partidos como array plano (para /api/odds)
  getAll() {
    const result = [];
    for (const sport of Object.keys(this.odds)) {
      for (const [matchKey, bookmakers] of Object.entries(this.odds[sport])) {
        for (const [bookmaker, data] of Object.entries(bookmakers)) {
          result.push({
            bookmaker,
            sport,
            matchKey,
            home: data.home,
            away: data.away,
            startTime: data.startTime,
            odds: {
              home: data.odds?.home || data.home_odd,
              draw: data.odds?.draw || data.draw_odd,
              away: data.odds?.away || data.away_odd,
            },
          });
        }
      }
    }
    return result;
  }

  // Stats rápidas
  stats() {
    let totalMatches = 0;
    let totalOdds = 0;
    for (const sport of Object.values(this.odds)) {
      for (const match of Object.values(sport)) {
        totalMatches++;
        totalOdds += Object.keys(match).length;
      }
    }
    return {
      sports: Object.keys(this.odds).length,
      matches: totalMatches,
      oddsEntries: totalOdds,
      surebets: this.surebets.length,
      lastUpdates: this.lastUpdate,
    };
  }
}

// Singleton compartido por todo el sistema
const store = new OddsStore();
module.exports = store;
