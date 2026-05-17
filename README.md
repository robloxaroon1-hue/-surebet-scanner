# SurebetScanner — Sistema propio de detección de arbitraje

Detecta surebets entre: **Stake, Betano, Doradobet, Betsafe, 20bet, Coolbet PE, Tinbet, Olimpobet PE**

---

## Instalación

```bash
cd surebet
npm install
node src/index.js
```

---

## Estructura del proyecto

```
surebet/
├── src/
│   ├── index.js          ← Punto de entrada
│   ├── engine.js         ← Motor principal (orquesta todo)
│   ├── store.js          ← Almacén en memoria de odds
│   ├── matcher.js        ← Cruce fuzzy de partidos entre casas
│   ├── calculator.js     ← Matemática de surebets
│   └── scrapers/
│       ├── BaseScraper.js  ← Clase base con reintentos y throttle
│       ├── stake.js        ← ✅ Listo (GraphQL público)
│       ├── betano.js       ← ⚠️  Necesita endpoint de DevTools
│       └── otros.js        ← ⚠️  Doradobet, Betsafe, 20bet, Coolbet, Tinbet, Olimpobet
└── README.md
```

---

## Guía DevTools — Encontrar el endpoint de cada casa (5 minutos por casa)

### Pasos exactos:

**1.** Abrir Chrome → ir al sitio de la casa (ej: doradobet.pe)  
**2.** `F12` → pestaña **Network**  
**3.** Hacer click en **"Fetch/XHR"** (filtro)  
**4.** Navegar a la sección **Deportes → Fútbol** dentro del sitio  
**5.** Ver los requests que aparecen en la lista. Buscar uno que diga:
   - `events`, `fixtures`, `prematch`, `sports`, `odds`, `markets`
**6.** Click en ese request → pestaña **Headers**:
   - Copiar **Request URL** completa
   - Anotar cualquier header especial: `Authorization`, `x-api-key`, `Cookie`
**7.** Pestaña **Preview** o **Response** → ver la estructura JSON
**8.** Ir al archivo del scraper correspondiente y:
   - Reemplazar `TODO_ENDPOINT` con la URL real
   - Ajustar el método `parseEvent()` según la estructura vista

### Ejemplo práctico (Betano):

```
URL encontrada: https://www.betano.pe/api/sports/events/1/
Headers: { 'brand': 'betano', 'locale': 'es' }
Estructura respuesta:
{
  "data": {
    "blocks": [{
      "events": [{
        "name": "Real Madrid vs Barcelona",
        "startTime": "2024-01-15T20:00:00Z",
        "participants": [
          { "name": "Real Madrid" },
          { "name": "Barcelona" }
        ],
        "markets": [{
          "name": "1X2",
          "selections": [
            { "name": "1", "odds": 2.10 },
            { "name": "X", "odds": 3.40 },
            { "name": "2", "odds": 3.20 }
          ]
        }]
      }]
    }]
  }
}
```

Entonces en `betano.js`:
```javascript
const ENDPOINT = 'https://www.betano.pe/api/sports/events/1/';
// Y los headers:
headers: { 'brand': 'betano', 'locale': 'es' }
```

### Estado por casa:

| Casa         | Estado          | Notas                                    |
|--------------|-----------------|------------------------------------------|
| Stake        | ✅ Listo        | GraphQL público, sin auth                |
| Betano       | ⚠️  Template    | API REST — 5min en DevTools              |
| Doradobet    | ⚠️  Template    | Cloudflare básico posible                |
| Betsafe      | ⚠️  Template    | Cloudflare moderado — puede necesitar cookie |
| 20bet        | ⚠️  Template    | Suele tener x-api-key en headers         |
| Coolbet      | ⚠️  Template    | API variable                             |
| Tinbet       | ⚠️  Template    | Casa local, probablemente API simple     |
| Olimpobet    | ⚠️  Template    | Casa local, probablemente API simple     |

---

## Cómo agregar una nueva casa (20 líneas de código)

```javascript
// nueva-casa.js
const BaseScraper = require('./BaseScraper');

class NuevaCasaScraper extends BaseScraper {
  constructor() {
    super('NuevaCasa', {
      minInterval: 45000,
      headers: { 'Origin': 'https://nuevacasa.pe' },
    });
  }

  async fetchOdds() {
    const data = await this.request('https://nuevacasa.pe/api/events');
    return (data.events || [])
      .map(ev => this.normalizeMatch({
        home: ev.home,
        away: ev.away,
        sport: 'football',
        startTime: ev.date,
        odds: { home: ev.odd1, draw: ev.oddX, away: ev.odd2 },
      }))
      .filter(m => m.odds.home && m.odds.away);
  }
}

module.exports = NuevaCasaScraper;
```

Luego agregar al array `this.scrapers` en `engine.js`.

---

## Configuración (index.js)

```javascript
const engine = new SurebetEngine({
  scanIntervalMs: 60000,  // cada cuántos ms escanear (60s recomendado)
  minProfitPct: 0.5,      // ganancia mínima % para alertar (0.5% = real)
  totalStake: 500,        // S/. totales a distribuir entre las apuestas
});
```

---

## Matemática de surebets

Una surebet existe cuando:
```
1/cuota_local + 1/empate + 1/visitante < 1
```

El sistema calcula automáticamente cuánto apostar en cada resultado para garantizar ganancia sin importar el resultado del partido.

**Ejemplo:**
- Casa A paga Local @ 3.10
- Casa B paga Empate @ 3.60  
- Casa C paga Visitante @ 3.20

Margen = 1/3.10 + 1/3.60 + 1/3.20 = 0.323 + 0.278 + 0.313 = **0.914 < 1** ✅

Ganancia = (1 - 0.914) / 0.914 = **+9.4%** garantizado

Con S/.500 totales:
- Local @ Casa A: **S/.161.5**
- Empate @ Casa B: **S/.138.9**  
- Visitante @ Casa C: **S/.156.5**

Retorno garantizado: **S/.546.3** (sin importar resultado)
