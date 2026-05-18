// BrowserPool.js — Un solo Chromium compartido entre todos los scrapers
// Evita abrir/cerrar un browser por cada request (muy costoso en RAM y tiempo)

const { chromium } = require('playwright');

class BrowserPool {
  constructor() {
    this.browser = null;
    this.launching = null; // Promise en curso para evitar doble lanzamiento
  }

  // Obtener el browser (lo lanza si no existe)
  async getBrowser() {
    if (this.browser?.isConnected()) return this.browser;

    // Si ya se está lanzando, esperar esa Promise en lugar de lanzar otro
    if (this.launching) return this.launching;

    this.launching = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // ocultar que es headless
        '--disable-infobars',
        '--window-size=1280,720',
      ],
    }).then(b => {
      this.browser = b;
      this.launching = null;

      // Si el browser se cierra inesperadamente, limpiar referencia
      b.on('disconnected', () => {
        this.browser = null;
        console.log('[BrowserPool] Browser desconectado, se relanzará al próximo uso');
      });

      return b;
    });

    return this.launching;
  }

  // Crear una nueva página con configuración anti-detección
  async newPage(extraHeaders = {}) {
    const browser = await this.getBrowser();

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'es-PE',
      timezoneId: 'America/Lima',
      geolocation: { latitude: -12.046, longitude: -77.042 },
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
        ...extraHeaders,
      },
      viewport: { width: 1280, height: 720 },
    });

    // Script para ocultar webdriver flag (anti-detección)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    return context.newPage();
  }

  // Cerrar todo limpiamente
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Singleton — una sola instancia para todo el proceso
module.exports = new BrowserPool();
