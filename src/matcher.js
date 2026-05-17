// matcher.js — Motor de cruce de partidos entre casas
// Problema: "Real Madrid" en Betano puede ser "R. Madrid" en Stake
// Solución: normalización + distancia de Levenshtein + ventana de tiempo

// ── Normalización ──────────────────────────────────────────────────────────────
function normalize(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcd\b|\bcf\b/g, '') // quitar prefijos de club
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Distancia de Levenshtein ───────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Similitud entre dos nombres (0 a 1) ───────────────────────────────────────
function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;

  // Chequeo rápido: ¿uno contiene al otro?
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

// ── Umbral de similitud configurable ──────────────────────────────────────────
const TEAM_THRESHOLD = 0.75;   // mínimo para considerar mismo equipo
const TIME_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 horas de margen para mismo partido

// ── Clave de partido normalizada ──────────────────────────────────────────────
// Genera una clave canónica para identificar partidos sin importar el orden
function makeMatchKey(home, away, sport) {
  const h = normalize(home);
  const a = normalize(away);
  // Orden alfabético para que A vs B == B vs A en la clave
  const [t1, t2] = [h, a].sort();
  return `${sport}::${t1}__${t2}`;
}

// ── Comparar dos partidos de distintas casas ──────────────────────────────────
// Devuelve { match: bool, score: float, swapped: bool }
// swapped = true si los equipos están en orden inverso
function compareMatches(m1, m2) {
  const timeOk = Math.abs((m1.startTime || 0) - (m2.startTime || 0)) <= TIME_WINDOW_MS;
  if (!timeOk) return { match: false, score: 0, swapped: false };

  const h1h2 = similarity(m1.home, m2.home);
  const a1a2 = similarity(m1.away, m2.away);
  const straightScore = (h1h2 + a1a2) / 2;

  const h1a2 = similarity(m1.home, m2.away);
  const a1h2 = similarity(m1.away, m2.home);
  const swappedScore = (h1a2 + a1h2) / 2;

  if (straightScore >= TEAM_THRESHOLD && straightScore >= swappedScore) {
    return { match: true, score: straightScore, swapped: false };
  }
  if (swappedScore >= TEAM_THRESHOLD) {
    return { match: true, score: swappedScore, swapped: true };
  }
  return { match: false, score: Math.max(straightScore, swappedScore), swapped: false };
}

// ── Agrupar partidos de varias casas en el mismo evento ───────────────────────
// Input: [{ bookmaker, home, away, sport, startTime, odds: {home, draw, away} }]
// Output: [{ matchId, teams, bookmakers: [{bookmaker, odds, swapped}] }]
function groupMatchesByEvent(allMatches) {
  const events = [];

  for (const match of allMatches) {
    let placed = false;

    for (const event of events) {
      const ref = event.ref;
      if (ref.sport !== match.sport) continue;

      const { match: isMatch, swapped } = compareMatches(ref, match);
      if (isMatch) {
        event.bookmakers.push({
          bookmaker: match.bookmaker,
          odds: swapped
            ? { home: match.odds.away, draw: match.odds.draw, away: match.odds.home }
            : match.odds,
          raw: match,
        });
        placed = true;
        break;
      }
    }

    if (!placed) {
      events.push({
        ref: match,
        matchId: makeMatchKey(match.home, match.away, match.sport),
        teams: { home: match.home, away: match.away },
        sport: match.sport,
        startTime: match.startTime,
        bookmakers: [{
          bookmaker: match.bookmaker,
          odds: match.odds,
          raw: match,
        }],
      });
    }
  }

  // Solo devolver eventos con al menos 2 casas (para poder comparar)
  return events.filter(e => e.bookmakers.length >= 2);
}

module.exports = { normalize, similarity, compareMatches, groupMatchesByEvent, makeMatchKey };
