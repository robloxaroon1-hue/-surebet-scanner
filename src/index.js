// index.js — Punto de entrada del SurebetScanner
// Ejecutar: node src/index.js

const SurebetEngine = require('./engine');

// ── Configuración ─────────────────────────────────────────────────────────────
const engine = new SurebetEngine({
  scanIntervalMs: 60 * 1000,   // escanear cada 60 segundos
  minProfitPct: 0.5,           // solo mostrar surebets con >0.5% de ganancia
  totalStake: 100,             // monto base en S/. para calcular apuestas
  sports: ['football'],
});

// ── Callback opcional: hacer algo cuando aparece una surebet ──────────────────
// Por ejemplo: guardar en archivo, enviar notificación por Telegram, etc.
engine.onSurebet = (surebet) => {
  // Ejemplo: guardar en archivo de log
  const fs = require('fs');
  const line = JSON.stringify({ ...surebet, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync('surebets.log', line);
};

// ── Iniciar ───────────────────────────────────────────────────────────────────
engine.start();

// ── Mostrar stats cada 5 minutos ──────────────────────────────────────────────
setInterval(() => {
  const s = engine.status();
  console.log(`\n📈 Stats: ${s.scans} escaneos | ${s.surebetsFound} surebets | ${s.store.matches} partidos en memoria`);
}, 5 * 60 * 1000);

// ── Manejo de cierre limpio ───────────────────────────────────────────────────
process.on('SIGINT', () => {
  engine.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  engine.stop();
  process.exit(0);
});
