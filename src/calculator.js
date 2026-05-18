// calculator.js — Matemática de surebets (arbitraje deportivo)
//
// Una SUREBET existe cuando la suma de los inversos de las mejores cuotas < 1
// Fórmula: 1/oddH + 1/oddD + 1/oddA < 1  (3-way)
//          1/oddH + 1/oddA < 1             (2-way, solo si no hay empate)
//
// Fix: las mejores cuotas de cada resultado deben ser de casas DISTINTAS

// ── Calcular si hay surebet en un set de cuotas ───────────────────────────────
function checkSurebet(event) {
  const { bookmakers, teams, sport, startTime } = event;

  const bestHome = getBest(bookmakers, 'home');
  const bestDraw = getBest(bookmakers, 'draw');
  const bestAway = getBest(bookmakers, 'away');

  // ── Umbral: solo ignorar combinaciones con pérdida peor que -4% ─────────
  // profitPct = ((1 - margin) / margin) * 100
  // -4% de profit → margin = 1 / (1 - 0.04) ≈ 1.0417
  const MIN_MARGIN_ALLOWED = 1.0417;

  // ── 3-way (con empate) ────────────────────────────────────────────────────
  if (bestHome && bestDraw && bestAway) {
    const books3 = [bestHome.bookmaker, bestDraw.bookmaker, bestAway.bookmaker];
    const unique3 = new Set(books3);
    if (unique3.size >= 2) {
      const margin3 = 1/bestHome.odd + 1/bestDraw.odd + 1/bestAway.odd;
      if (margin3 <= MIN_MARGIN_ALLOWED) {
        const profit3 = ((1 - margin3) / margin3) * 100;
        return buildSurebet(3, { home: bestHome, draw: bestDraw, away: bestAway },
          margin3, profit3, teams, sport, startTime);
      }
    }
  }

  // ── 2-way (solo para deportes sin empate: tenis, baloncesto, etc.) ────────
  if (sport !== 'football' && bestHome && bestAway) {
    if (bestHome.bookmaker !== bestAway.bookmaker) {
      const margin2 = 1/bestHome.odd + 1/bestAway.odd;
      if (margin2 <= MIN_MARGIN_ALLOWED) {
        const profit2 = ((1 - margin2) / margin2) * 100;
        return buildSurebet(2, { home: bestHome, away: bestAway },
          margin2, profit2, teams, sport, startTime);
      }
    }
  }

  return null;
}

// ── Encontrar la mejor cuota para un resultado entre todas las casas ──────────
function getBest(bookmakers, outcome) {
  let best = null;
  for (const bk of bookmakers) {
    const odd = bk.odds?.[outcome];
    if (!odd || odd < 1.01) continue;
    if (!best || odd > best.odd) {
      best = { odd, bookmaker: bk.bookmaker };
    }
  }
  return best;
}

// ── Construir objeto surebet ──────────────────────────────────────────────────
function buildSurebet(ways, bests, margin, profitPct, teams, sport, startTime) {
  const BASE_STAKE = 100;
  const stakes = {};

  if (ways === 3) {
    stakes.home = round((BASE_STAKE * (1/bests.home.odd)) / margin);
    stakes.draw = round((BASE_STAKE * (1/bests.draw.odd)) / margin);
    stakes.away = round((BASE_STAKE * (1/bests.away.odd)) / margin);
  } else {
    stakes.home = round((BASE_STAKE * (1/bests.home.odd)) / margin);
    stakes.away = round((BASE_STAKE * (1/bests.away.odd)) / margin);
  }

  const guaranteed = round(BASE_STAKE / margin);

  return {
    type: `${ways}-way`,
    sport,
    teams,
    startTime,
    profitPct: round(profitPct),
    margin: round(margin * 100),
    guaranteedReturn: guaranteed,
    bets: buildBets(ways, bests, stakes),
    foundAt: new Date().toISOString(),
  };
}

function buildBets(ways, bests, stakes) {
  const bets = [
    { outcome: 'home', bookmaker: bests.home.bookmaker, odd: bests.home.odd, stake: stakes.home },
    { outcome: 'away', bookmaker: bests.away.bookmaker, odd: bests.away.odd, stake: stakes.away },
  ];
  if (ways === 3) {
    bets.splice(1, 0,
      { outcome: 'draw', bookmaker: bests.draw.bookmaker, odd: bests.draw.odd, stake: stakes.draw }
    );
  }
  return bets;
}

// ── Calcular stakes para un monto real ────────────────────────────────────────
function calculateRealStakes(surebet, totalAmount) {
  const base = surebet.bets.reduce((sum, b) => sum + b.stake, 0);
  const factor = totalAmount / base;
  return surebet.bets.map(b => ({
    ...b,
    realStake: round(b.stake * factor),
    realReturn: round(b.stake * factor * b.odd),
  }));
}

function round(n) { return Math.round(n * 100) / 100; }

module.exports = { checkSurebet, calculateRealStakes };
