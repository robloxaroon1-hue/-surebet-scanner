// engine.js — Motor principal del surebet scanner
// v3: removido Playwright/BrowserPool — solo scrapers con API directa

const store      = require('./store');
const { groupMatchesByEvent }              = require('./matcher');
const { checkSurebet, calculateRealStakes } = require('./calculator');

// Scrapers activos (solo API directa, sin browser)
const {
  DoradobetScraper, TwentybetScraper,
  TinbetScraper,   OlimpoScraper,
} = require('./scrapers/otros');
const { ApuestaTotalScraper, RetabetScraper } = require('./scrapers/nuevas');

// Scrapers desactivados temporalmente (requieren Playwright):
// StakeScraper, BetanoScraper, BetsafeScraper, CoolbetScraper

class SurebetEngine {
  constructor(config = {}) {
    this.config = {
      scanIntervalMs: config.scanIntervalMs || 60000,
      minProfitPct:   config.minProfitPct   ?? -4,
      totalStake:     config.totalStake     || 100,
      sports:         config.sports         || ['football'],
    };

    this.scrapers = [
      new DoradobetScraper(),
      new TwentybetScraper(),
      new TinbetScraper(),
      new OlimpoScraper(),
      new ApuestaTotalScraper(),
      new RetabetScraper(),
    ];

    this.isRunning    = false;
    this.scanCount    = 0;
    this.surebetsFound = 0;
    this.onSurebet    = null;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('\n🎯 SurebetScanner iniciado');
    console.log(`   Casas: ${this.scrapers.map(s => s.name).join(', ')}`);
    console.log(`   Intervalo: ${this.config.scanIntervalMs / 1000}s`);
    console.log(`   Ganancia mínima: ${this.config.minProfitPct}%\n`);

    await this.scan();
    this.interval = setInterval(() => this.scan(), this.config.scanIntervalMs);
  }

  async stop() {
    this.isRunning = false;
    if (this.interval) clearInterval(this.interval);
    console.log('\n⏹  Scanner detenido');
  }

  async scan() {
    this.scanCount++;
    const start = Date.now();
    console.log(`\n── Escaneo #${this.scanCount} ──────────────────────────────`);

    const results = await Promise.allSettled(
      this.scrapers.map(s => s.run())
    );

    const allMatches = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        allMatches.push(...r.value);
      } else {
        console.log(`⚠️  ${this.scrapers[i].name}: ${r.reason?.message}`);
      }
    });

    console.log(`📊 Total partidos recibidos: ${allMatches.length}`);

    const events   = groupMatchesByEvent(allMatches);
    console.log(`🔍 Eventos cruzados (≥2 casas): ${events.length}`);

    const surebets = [];
    for (const event of events) {
      const sb = checkSurebet(event);
      if (sb && sb.profitPct >= this.config.minProfitPct) surebets.push(sb);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`⚡ Duración: ${elapsed}s`);

    if (surebets.length === 0) {
      console.log('💤 Sin surebets en este escaneo');
    } else {
      this.surebetsFound += surebets.length;
      surebets.forEach(sb => this.alertSurebet(sb));
    }

    store.cleanup(30);
    return surebets;
  }

  alertSurebet(sb) {
    const realBets = calculateRealStakes(sb, this.config.totalStake);
    console.log('\n🚨 ═══════════════════ SUREBET ═══════════════════');
    console.log(`   ${sb.teams.home} vs ${sb.teams.away}`);
    console.log(`   Deporte: ${sb.sport} | Tipo: ${sb.type}`);
    console.log(`   Ganancia: +${sb.profitPct}% garantizado`);
    console.log(`   Base: S/${this.config.totalStake} → Retorno: S/${sb.guaranteedReturn}`);
    console.log('   Apuestas:');
    realBets.forEach(b => {
      console.log(`     ${b.outcome.padEnd(5)} → ${b.bookmaker.padEnd(12)} @ ${b.odd} → S/${b.realStake}`);
    });
    console.log('═══════════════════════════════════════════════════\n');

    if (typeof this.onSurebet === 'function') this.onSurebet({ ...sb, realBets });
  }

  status() {
    return {
      running:       this.isRunning,
      scans:         this.scanCount,
      surebetsFound: this.surebetsFound,
      store:         store.stats(),
    };
  }
}

module.exports = SurebetEngine;
