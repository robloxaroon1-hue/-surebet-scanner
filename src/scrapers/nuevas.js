// nuevas.js — ApuestaTotal, Retabet
// Última actualización: 2026-05-18
//
// ESTADO:
//   ❌ ApuestaTotal — Falta URL (DevTools pendiente)
//   ❌ Retabet      — Falta URL (DevTools pendiente)

const BaseScraper = require('./BaseScraper');

// ── APUESTATOTAL ──────────────────────────────────────────────────────────────
// Sitio: apuestatotal.com.pe
// Estado: ❌ PENDIENTE — falta URL de DevTools
class ApuestaTotalScraper extends BaseScraper {
  constructor() {
    super('ApuestaTotal', {
      minInterval: 60000,
      headers: {
        'Origin': 'https://apuestatotal.com.pe',
        'Referer': 'https://apuestatotal.com.pe/deportes',
        'Accept': 'application/json',
      },
    });
  }

  async fetchOdds() {
    // TODO: Abrir apuestatotal.com.pe → DevTools → Network → buscar request de prematch
    this.log('Pendiente — falta URL de DevTools');
    return [];
  }
}

// ── RETABET ───────────────────────────────────────────────────────────────────
// Sitio: retabet.pe
// Estado: ❌ PENDIENTE — falta URL de DevTools
class RetabetScraper extends BaseScraper {
  constructor() {
    super('Retabet', {
      minInterval: 60000,
      headers: {
        'Origin': 'https://retabet.pe',
        'Referer': 'https://retabet.pe/deportes',
        'Accept': 'application/json',
      },
    });
  }

  async fetchOdds() {
    // TODO: Abrir retabet.pe → DevTools → Network → buscar request de prematch
    this.log('Pendiente — falta URL de DevTools');
    return [];
  }
}

module.exports = { ApuestaTotalScraper, RetabetScraper };
