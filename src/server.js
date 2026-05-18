// server.js — Servidor Express + API REST para el SurebetScanner
// Expone endpoints que tu index.html (Firebase) puede consumir
//
// Endpoints:
//   GET /api/odds        → todos los partidos con cuotas actuales
//   GET /api/surebets    → solo las surebets detectadas
//   GET /api/status      → estado de cada casa (ok/fail/bloqueada)
//   GET /health          → healthcheck de Railway
//
// Deploy en Railway:
//   1. Sube esta carpeta a GitHub
//   2. Railway → New Project → Deploy from GitHub Repo
//   3. Tu URL queda: https://tu-app.railway.app

const express = require('express');
const cors    = require('cors');
const SurebetEngine = require('./engine');
const store = require('./store');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS: permite que Firebase (y cualquier origen) consuma la API ────────────
app.use(cors({
  origin: '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// ── Instanciar el motor ───────────────────────────────────────────────────────
const engine = new SurebetEngine({
  scanIntervalMs: 60 * 1000,   // escaneo cada 60s
  minProfitPct:   0.5,         // solo surebets ≥ 0.5% de ganancia
  totalStake:     500,         // S/. base para cálculo de stakes
  sports:         ['football'],
});

// Guardar el historial de surebets encontradas en memoria
const surebetHistory = [];
const MAX_HISTORY = 100;

engine.onSurebet = (sb) => {
  surebetHistory.unshift({ ...sb, foundAt: new Date().toISOString() });
  if (surebetHistory.length > MAX_HISTORY) surebetHistory.pop();
};

// Estado de cada scraper
const scraperStatus = {};
engine.scrapers.forEach(s => {
  scraperStatus[s.name] = { status: 'pending', lastOk: null, error: null, matches: 0 };
});

// Monkeypatch para capturar estado de scrapers
const originalScan = engine.scan.bind(engine);
engine.scan = async function() {
  const results = await Promise.allSettled(
    engine.scrapers.map(s => s.run())
  );
  results.forEach((r, i) => {
    const name = engine.scrapers[i].name;
    if (r.status === 'fulfilled') {
      scraperStatus[name] = {
        status: 'ok',
        lastOk: new Date().toISOString(),
        error: null,
        matches: r.value.length,
      };
    } else {
      scraperStatus[name] = {
        status: 'error',
        lastOk: scraperStatus[name]?.lastOk || null,
        error: r.reason?.message || 'Error desconocido',
        matches: 0,
      };
    }
  });
  return originalScan();
};

// ── Iniciar el motor ──────────────────────────────────────────────────────────
engine.start();

// ════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// GET /health — Railway healthcheck
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// GET /api/status — estado de cada casa de apuestas
app.get('/api/status', (req, res) => {
  const casas = Object.entries(scraperStatus).map(([name, info]) => ({
    name,
    ...info,
  }));

  res.json({
    ok: true,
    ts: new Date().toISOString(),
    engine: engine.status(),
    casas,
  });
});

// GET /api/odds — todos los partidos con cuotas (del store en memoria)
app.get('/api/odds', (req, res) => {
  const allMatches = store.getAll ? store.getAll() : [];

  // Agrupar por partido para mostrar cuotas de todas las casas
  const byEvent = {};
  allMatches.forEach(m => {
    const key = `${normalize(m.home)}_vs_${normalize(m.away)}`;
    if (!byEvent[key]) {
      byEvent[key] = {
        home: m.home,
        away: m.away,
        sport: m.sport,
        startTime: m.startTime,
        bookmakers: [],
      };
    }
    byEvent[key].bookmakers.push({
      name: m.bookmaker,
      odds: m.odds,
    });
  });

  const partidos = Object.values(byEvent)
    .filter(e => e.bookmakers.length >= 1)
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

  res.json({
    ok: true,
    ts: new Date().toISOString(),
    total: partidos.length,
    partidos,
  });
});

// GET /api/surebets — surebets detectadas en el último escaneo
app.get('/api/surebets', async (req, res) => {
  try {
    // Ejecutar escaneo bajo demanda si hay parámetro ?refresh=1
    if (req.query.refresh === '1') {
      await engine.scan();
    }

    // Retornar historial en memoria
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      total: surebetHistory.length,
      surebets: surebetHistory,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/scan — forzar escaneo inmediato y devolver surebets
app.get('/api/scan', async (req, res) => {
  try {
    const surebets = await engine.scan();
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      surebets: surebets || [],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Utilidad ──────────────────────────────────────────────────────────────────
function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_');
}

// ── Arrancar servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 SurebetScanner API corriendo en puerto ${PORT}`);
  console.log(`   /api/odds      → todos los partidos`);
  console.log(`   /api/surebets  → surebets detectadas`);
  console.log(`   /api/status    → estado de casas`);
  console.log(`   /api/scan      → escaneo forzado\n`);
});

module.exports = app;
