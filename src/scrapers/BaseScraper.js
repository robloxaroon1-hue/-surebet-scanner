// BaseScraper.js — Clase base que todos los scrapers extienden
// Maneja: reintentos, throttling, logging, formato estándar de salida
// v2: agrega soporte opcional de Playwright para sitios con protección anti-bot

const axios  = require('axios');
const pool   = require('./BrowserPool');

class BaseScraper {
  constructor(name, config = {}) {
    this.name = name;
    this.config = {
      timeout:      config.timeout      || 15000,
      retries:      config.retries      || 2,
      retryDelay:   config.retryDelay   || 2000,
      headers:      config.headers      || {},
      useBrowser:   config.useBrowser   || false, // ← activa modo Playwright
      ...config,
    };
    this.lastFetch   = 0;
    this.minInterval = config.minInterval || 30000;

    // Sesión robada del browser (cookies + headers reales)
    this._session = null;
    this._sessionExpiry = 0;
    this._sessionTTL = config.sessionTTL || 10 * 60 * 1000; // 10 min por default
  }

  // ── Método principal que cada scraper debe implementar ────────────────────
  async fetchOdds() {
    throw new Error(`${this.name}: fetchOdds() no implementado`);
  }

  // ── [NUEVO] Interceptar una API mientras el browser carga el sitio ─────────
  // siteUrl:        página que abre el browser (ej: 'https://coolbet.pe/...')
  // interceptMatch: string o RegExp que identifica la URL de la API a capturar
  // options:        { timeout, waitFor, triggerFn }
  //
  // Devuelve: { url, headers, body } de la primera respuesta que coincida
  async browserIntercept(siteUrl, interceptMatch, options = {}) {
    const timeout  = options.timeout  || 20000;
    const waitFor  = options.waitFor  || 'networkidle';

    this.log(`[browser] Abriendo ${siteUrl}`);
    const page = await pool.newPage(this.config.headers);

    try {
      const captured = await new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout interceptando API')), timeout);

        // Escuchar respuestas de red
        page.on('response', async (response) => {
          const url = response.url();
          const matches = typeof interceptMatch === 'string'
            ? url.includes(interceptMatch)
            : interceptMatch.test(url);

          if (!matches) return;

          try {
            const body    = await response.json();
            const headers = response.headers();
            clearTimeout(timer);
            resolve({ url, headers, body });
          } catch {
            // La respuesta coincidió pero no era JSON, ignorar
          }
        });

        // Navegar al sitio
        try {
          await page.goto(siteUrl, { waitUntil: waitFor, timeout });
          // Si hay función adicional que disparar (click, scroll, etc.)
          if (typeof options.triggerFn === 'function') {
            await options.triggerFn(page);
          }
        } catch (navErr) {
          // Si es timeout de navegación pero ya capturamos algo, está bien
          // Si no, rechazar
          clearTimeout(timer);
          reject(navErr);
        }
      });

      return captured;
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ── [NUEVO] Robar sesión del browser para usarla en axios ─────────────────
  // Carga el sitio con Playwright, extrae cookies reales y headers de sesión.
  // Los reutiliza durante sessionTTL ms antes de renovar.
  async getSession(siteUrl) {
    const now = Date.now();
    if (this._session && now < this._sessionExpiry) return this._session;

    this.log('[browser] Renovando sesión...');
    const page = await pool.newPage();

    try {
      await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // Esperar un poco para que se carguen cookies de sesión
      await page.waitForTimeout(2000);

      const cookies = await page.context().cookies();
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      // Intentar leer token del localStorage si el sitio lo usa
      const token = await page.evaluate(() => {
        return localStorage.getItem('authToken')
          || localStorage.getItem('token')
          || localStorage.getItem('accessToken')
          || sessionStorage.getItem('token')
          || null;
      }).catch(() => null);

      this._session = { cookieStr, token };
      this._sessionExpiry = now + this._sessionTTL;
      this.log('[browser] Sesión obtenida OK');
      return this._session;
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ── Request HTTP con reintentos (axios) ───────────────────────────────────
  async request(url, options = {}) {
    // Si useBrowser está activo, enriquecer headers con sesión real
    let sessionHeaders = {};
    if (this.config.useBrowser && this.config.siteUrl) {
      try {
        const session = await this.getSession(this.config.siteUrl);
        if (session.cookieStr) sessionHeaders['Cookie'] = session.cookieStr;
        if (session.token)    sessionHeaders['Authorization'] = `Bearer ${session.token}`;
      } catch (e) {
        this.log(`[browser] No se pudo obtener sesión: ${e.message}`);
      }
    }

    const config = {
      url,
      method:       options.method || 'GET',
      headers:      { ...this.defaultHeaders(), ...this.config.headers, ...sessionHeaders, ...options.headers },
      timeout:      this.config.timeout,
      data:         options.data,
      params:       options.params,
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

        // Si es 401/403, forzar renovación de sesión en el próximo intento
        if ((status === 401 || status === 403) && this.config.useBrowser) {
          this._sessionExpiry = 0;
        }

        await this.sleep(this.config.retryDelay * attempt);
      }
    }
  }

  // ── POST JSON ─────────────────────────────────────────────────────────────
  async post(url, body, options = {}) {
    return this.request(url, {
      method: 'POST',
      data:   body,
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
      'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':           'application/json, text/plain, */*',
      'Accept-Language':  'es-PE,es;q=0.9,en;q=0.8',
      'Accept-Encoding':  'gzip, deflate, br',
      'Connection':       'keep-alive',
      'Sec-Fetch-Dest':   'empty',
      'Sec-Fetch-Mode':   'cors',
      'Sec-Fetch-Site':   'same-origin',
      'Sec-Ch-Ua':        '"Chromium";v="124", "Google Chrome";v="124"',
      'Sec-Ch-Ua-Mobile': '?0',
    };
  }

  // ── Throttle ──────────────────────────────────────────────────────────────
  async throttle() {
    const now     = Date.now();
    const elapsed = now - this.lastFetch;
    if (elapsed < this.minInterval) await this.sleep(this.minInterval - elapsed);
    this.lastFetch = Date.now();
  }

  // ── Normalizar partido ────────────────────────────────────────────────────
  normalizeMatch({ home, away, sport, startTime, odds }) {
    return {
      bookmaker: this.name,
      home:      String(home).trim(),
      away:      String(away).trim(),
      sport:     sport || 'football',
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

  // ── run() con throttle y manejo de error ──────────────────────────────────
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
