// BaseScraper.js — Clase base que todos los scrapers extienden
// Maneja: reintentos, throttling, logging, formato estándar de salida
// v3: BrowserPool se carga lazy (solo si useBrowser está activo)

const axios = require('axios');

class BaseScraper {
  constructor(name, config = {}) {
    this.name = name;
    this.config = {
      timeout:      config.timeout      || 15000,
      retries:      config.retries      || 2,
      retryDelay:   config.retryDelay   || 2000,
      headers:      config.headers      || {},
      useBrowser:   config.useBrowser   || false,
      ...config,
    };
    this.lastFetch   = 0;
    this.minInterval = config.minInterval || 30000;

    this._session = null;
    this._sessionExpiry = 0;
    this._sessionTTL = config.sessionTTL || 10 * 60 * 1000;
  }

  // Carga BrowserPool solo si se necesita
  _getPool() {
    return require('./BrowserPool');
  }

  async fetchOdds() {
    throw new Error(`${this.name}: fetchOdds() no implementado`);
  }

  async browserIntercept(siteUrl, interceptMatch, options = {}) {
    const timeout = options.timeout || 20000;
    const waitFor = options.waitFor || 'networkidle';

    this.log(`[browser] Abriendo ${siteUrl}`);
    const page = await this._getPool().newPage(this.config.headers);

    try {
      const captured = await new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout interceptando API')), timeout);

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
          } catch {}
        });

        try {
          await page.goto(siteUrl, { waitUntil: waitFor, timeout });
          if (typeof options.triggerFn === 'function') {
            await options.triggerFn(page);
          }
        } catch (navErr) {
          clearTimeout(timer);
          reject(navErr);
        }
      });

      return captured;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async getSession(siteUrl) {
    const now = Date.now();
    if (this._session && now < this._sessionExpiry) return this._session;

    this.log('[browser] Renovando sesión...');
    const page = await this._getPool().newPage();

    try {
      await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const cookies = await page.context().cookies();
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

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

  async request(url, options = {}) {
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

        if ((status === 401 || status === 403) && this.config.useBrowser) {
          this._sessionExpiry = 0;
        }

        await this.sleep(this.config.retryDelay * attempt);
      }
    }
  }

  async post(url, body, options = {}) {
    return this.request(url, {
      method: 'POST',
      data:   body,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
  }

  async graphql(url, query, variables = {}) {
    return this.post(url, { query, variables });
  }

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

  async throttle() {
    const now     = Date.now();
    const elapsed = now - this.lastFetch;
    if (elapsed < this.minInterval) await this.sleep(this.minInterval - elapsed);
    this.lastFetch = Date.now();
  }

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
