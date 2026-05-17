// engine.js — Motor principal del surebet scanner
// Orquesta: scrapers → store → matching → calculadora → alertas

const store = require('./store');
const { groupMatchesByEvent } = require('./matcher');
const { checkSurebet, calculateRealStakes } = require('./calculator');

// Importar todos los scrapers
const StakeScraper    = require('./scrapers/stake');
const BetanoScraper   = require('./scrapers/betano');
const {
  DoradobetScraper,
  BetsafeScraper,
  TwentybetScraper,
  CoolbetScraper,
  TinbetScraper,
  OlimpoScraper,
} = require('./scrapers/otros');
const { ApuestaTotalScraper, RetabetScraper } = require('./scrapers/nuevas');

class SurebetEngine {
  constructor(config = {}) {
    this.config = {
      scanIntervalMs: config.scanIntervalMs || 60000,  // escanear cada 60s
      minProfitPct:   config.minProfitPct   || 0.5,    // % mínimo de ganancia
      totalStake:     config.totalStake     || 100,    // monto base en soles
      sports:         config.sports         || ['football'],
    };

    // Instanciar todos los scrapers (10 casas)
    this.scrapers = [
      new StakeScraper(),
      new BetanoScraper(),
      new DoradobetScraper(),
      new BetsafeScraper(),
      new TwentybetScraper(),
      new CoolbetScraper(),
      new TinbetScraper(),
      new OlimpoScraper(),
      new ApuestaTotalScraper(),   // ← nueva
      new RetabetScraper(),        // ← nueva
    ];

    this.isRunning = false;
    this.scanCount = 0;
    this.surebetsFound = 0;
    this.onSurebet = null; // callback para cuando se encuentra una surebet
  }

  // ── Iniciar el motor ───────────────────────────────────────────────────────
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('\n🎯 SurebetScanner iniciado');
    console.log(`   Casas: ${this.scrapers.map(s => s.name).join(', ')}`);
    console.log(`   Intervalo: ${this.config.scanIntervalMs / 1000}s`);
    console.log(`   Ganancia mínima: ${this.config.minProfitPct}%\n`);

    // Primer escaneo inmediato
    await this.scan();

    // Escaneos periódicos
    this.interval = setInterval(() => this.scan(), this.config.scanIntervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.interval) clearInterval(this.interval);
    console.log('\n⏹  Scanner detenido');
  }

  // ── Ciclo principal de escaneo ─────────────────────────────────────────────
  async scan() {
    this.scanCount++;
    const start = Date.now();
    console.log(`\n── Escaneo #${this.scanCount} ──────────────────────────────`);

    // 1. Ejecutar todos los scrapers en paralelo
    const results = await Promise.allSettled(
      this.scrapers.map(s => s.run())
    );

    // 2. Recolectar todos los partidos
    const allMatches = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        allMatches.push(...r.value);
      } else {
        console.log(`⚠️  ${this.scrapers[i].name}: ${r.reason?.message}`);
      }
    });

    console.log(`📊 Total partidos recibidos: ${allMatches.length}`);

    // 3. Agrupar partidos del mismo evento entre casas
    const events = groupMatchesByEvent(allMatches);
    console.log(`🔍 Eventos cruzados (≥2 casas): ${events.length}`);

    // 4. Detectar surebets
    const surebets = [];
    for (const event of events) {
      const sb = checkSurebet(event);
      if (sb && sb.profitPct >= this.config.minProfitPct) {
        surebets.push(sb);
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`⚡ Duración: ${elapsed}s`);

    if (surebets.length === 0) {
      console.log('💤 Sin surebets en este escaneo');
    } else {
      this.surebetsFound += surebets.length;
      surebets.forEach(sb => this.alertSurebet(sb));
    }

    // Limpiar odds viejas del store
    store.cleanup(30);

    return surebets;
  }

  // ── Mostrar y notificar surebet ────────────────────────────────────────────
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

    // Ejecutar callback externo si existe
    if (typeof this.onSurebet === 'function') {
      this.onSurebet({ ...sb, realBets });
    }
  }

  // ── Stats del sistema ──────────────────────────────────────────────────────
  status() {
    return {
      running: this.isRunning,
      scans: this.scanCount,
      surebetsFound: this.surebetsFound,
      store: store.stats(),
    };
  }
}

module.exports = SurebetEngine;
