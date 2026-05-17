// BaseScraper.js — Clase base que todos los scrapers extienden
// Maneja: reintentos, throttling, logging, formato estándar de salida

const axios = require('axios');

class BaseScraper {
  constructor(name, config = {}) {
    this.name = name;
    this.config = {
      timeout: config.timeout || 15000,
      retries: config.retries || 2,
      retryDelay: config.retryDelay || 2000,
      headers: config.headers || {},
      ...config,
    };
    this.lastFetch = 0;
    this.minInterval = config.minInterval || 30000; // 30s entre fetches por default
  }

  // ── Método principal que cada scraper debe implementar ────────────────────
  // Debe devolver: [{ home, away, sport, startTime, odds: { home, draw?, away } }]
  async fetchOdds() {
    throw new Error(`${this.name}: fetchOdds() no implementado`);
  }

  // ── Request HTTP con reintentos ───────────────────────────────────────────
  async request(url, options = {}) {
    const config = {
      url,
      method: options.method || 'GET',
      headers: { ...this.defaultHeaders(), ...this.config.headers, ...options.headers },
      timeout: this.config.timeout,
      data: options.data,
      params: options.params,
      responseType: options.responseType || 'json',
    };

    for (let attempt = 1; attempt <= this.config.retries + 1; attempt++) {
      try {
        const res = await axios(config);
        return res.data;
      } catch (err) {
        const isLast = attempt > this.config.retries;
        if (isLast) throw err;

        const status = err.response?.status;
        this.log(`Intento ${attempt} falló (${status || err.code}). Reintentando...`);
        await this.sleep(this.config.retryDelay * attempt);
      }
    }
  }

  // ── POST JSON ─────────────────────────────────────────────────────────────
  async post(url, body, options = {}) {
    return this.request(url, {
      method: 'POST',
      data: body,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
  }

  // ── GraphQL ───────────────────────────────────────────────────────────────
  async graphql(url, query, variables = {}) {
    return this.post(url, { query, variables });
  }

  // ── Headers por defecto (anti-detección básica) ───────────────────────────
  defaultHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    };
  }

  // ── Throttle: respetar intervalo mínimo entre fetches ─────────────────────
  async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastFetch;
    if (elapsed < this.minInterval) {
      await this.sleep(this.minInterval - elapsed);
    }
    this.lastFetch = Date.now();
  }

  // ── Normalizar un partido al formato estándar ─────────────────────────────
  normalizeMatch({ home, away, sport, startTime, odds }) {
    return {
      bookmaker: this.name,
      home: String(home).trim(),
      away: String(away).trim(),
      sport: sport || 'football',
      startTime: startTime ? new Date(startTime).getTime() : null,
      odds: {
        home: this.parseOdd(odds.home),
        draw: odds.draw != null ? this.parseOdd(odds.draw) : null,
        away: this.parseOdd(odds.away),
      },
    };
  }

  parseOdd(val) {
    const n = parseFloat(val);
    return isNaN(n) || n < 1.01 ? null : n;
  }

  // ── Ejecutar scraper con throttle y manejo de error ───────────────────────
  async run() {
    await this.throttle();
    this.log('Iniciando fetch...');
    try {
      const matches = await this.fetchOdds();
      this.log(`✓ ${matches.length} partidos obtenidos`);
      return matches;
    } catch (err) {
      this.log(`✗ Error: ${err.message}`);
      return [];
    }
  }

  log(msg) {
    const time = new Date().toLocaleTimeString('es-PE');
    console.log(`[${time}] [${this.name}] ${msg}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BaseScraper;
