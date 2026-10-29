# Live Metals Map

Local app that shows live gold & silver prices on a pixelated world map. Click any country to see prices in that currency, plus a gram calculator.

## Run locally

```bash
cd ~/Projects/gold-silver-inr
npm install
npm install --prefix frontend
npm run dev
```

Then open:

| Service | URL |
|---------|-----|
| **App** | http://localhost:5173 |
| **API** | http://localhost:3456/api/world-prices |

## What you get

- Pixel world map — hover / click countries
- Live gold & silver in local currency
- India priced with est. import duty + GST (retail estimate)
- Gram calculator (24K / 22K / 18K for gold)
- Auto-refresh every 60 seconds

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/world-prices` | All countries with gold/silver prices |
| `GET /api/prices` | India-only |
| `GET /api/health` | Health check |

## Production (single port)

```bash
npm start
```

Opens everything on http://localhost:3456

## Data sources

- Spot: [Minted Metal](https://mintedmetal.com/api/) (LBMA)
- FX: [Open ExchangeRate-API](https://www.exchangerate-api.com/) (Frankfurter fallback)
- Countries: local dataset in `backend/data/countries.json`
