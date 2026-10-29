import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const TROY_OZ_GRAMS = 31.1034768;
const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Approximate retail markup over international spot (import duty, GST, local premium). */
const RETAIL_FACTOR = {
  IN: { gold: 1.13, silver: 1.1 },
  default: { gold: 1.02, silver: 1.02 },
};

let countryCurrenciesCache = null;
let fxCache = null;
let fxFetchedAt = 0;
const FX_CACHE_MS = 5 * 60 * 1000;

/** Remember last live prices so we can show session change %. */
let previousLive = { gold: null, silver: null };

async function fetchCoinbaseSpot(symbol) {
  const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Coinbase ${symbol} failed`);
  const data = await res.json();
  const amount = Number(data?.data?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Bad ${symbol} price`);
  return amount;
}

async function fetchMintedFallback() {
  const res = await fetch("https://mintedmetal.com/api/prices.json", {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("Failed to fetch spot prices");
  const data = await res.json();
  return {
    updatedAt: data.updatedAt || new Date().toISOString(),
    gold: data.metals.gold.price,
    silver: data.metals.silver.price,
    goldPrev: data.metals.gold.previousPrice ?? null,
    silverPrev: data.metals.silver.previousPrice ?? null,
    source: "Minted Metal (LBMA)",
  };
}

export async function fetchSpotPrices() {
  try {
    const [gold, silver] = await Promise.all([
      fetchCoinbaseSpot("XAU"),
      fetchCoinbaseSpot("XAG"),
    ]);

    const goldPrev = previousLive.gold;
    const silverPrev = previousLive.silver;
    previousLive = { gold, silver };

    return {
      updatedAt: new Date().toISOString(),
      gold,
      silver,
      goldPrev,
      silverPrev,
      source: "Coinbase live spot",
    };
  } catch {
    const fallback = await fetchMintedFallback();
    previousLive = { gold: fallback.gold, silver: fallback.silver };
    return fallback;
  }
}

export async function fetchUsdRates() {
  if (fxCache && Date.now() - fxFetchedAt < FX_CACHE_MS) {
    return fxCache;
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("open.er-api failed");
    const data = await res.json();
    if (data.result !== "success" || !data.rates) throw new Error("Bad FX payload");
    fxCache = {
      rates: data.rates,
      date: data.time_last_update_utc || new Date().toISOString(),
    };
  } catch {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", {
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error("Failed to fetch exchange rates");
    const data = await res.json();
    fxCache = { rates: { USD: 1, ...data.rates }, date: data.date };
  }

  fxFetchedAt = Date.now();
  return fxCache;
}

async function fetchCountryCurrencies() {
  if (countryCurrenciesCache) return countryCurrenciesCache;
  const raw = await readFile(join(__dirname, "data", "countries.json"), "utf8");
  countryCurrenciesCache = JSON.parse(raw);
  return countryCurrenciesCache;
}

function retailFactor(iso, metal) {
  return (RETAIL_FACTOR[iso] || RETAIL_FACTOR.default)[metal];
}

function perGram(usdPerOz, fxRate, factor = 1) {
  return ((usdPerOz * fxRate) / TROY_OZ_GRAMS) * factor;
}

function changePercent(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export async function getWorldPrices() {
  const [spot, fx, countries] = await Promise.all([
    fetchSpotPrices(),
    fetchUsdRates(),
    fetchCountryCurrencies(),
  ]);

  const goldUsd = spot.gold;
  const silverUsd = spot.silver;
  const goldChange = changePercent(goldUsd, spot.goldPrev);
  const silverChange = changePercent(silverUsd, spot.silverPrev);

  const countryPrices = {};
  for (const [iso, meta] of Object.entries(countries)) {
    const rate = fx.rates[meta.currency] ?? (meta.currency === "USD" ? 1 : null);
    if (rate == null) continue;

    const goldFactor = retailFactor(iso, "gold");
    const silverFactor = retailFactor(iso, "silver");
    const goldPerGram = perGram(goldUsd, rate, goldFactor);
    const silverPerGram = perGram(silverUsd, rate, silverFactor);

    countryPrices[iso] = {
      name: meta.name,
      currency: meta.currency,
      symbol: meta.symbol,
      latlng: meta.latlng,
      fxRate: rate,
      gold: {
        perGram: goldPerGram,
        per10g: goldPerGram * 10,
        perOz: goldUsd * rate * goldFactor,
        spotPer10g: perGram(goldUsd, rate, 1) * 10,
        changePct: goldChange,
        retailFactor: goldFactor,
      },
      silver: {
        perGram: silverPerGram,
        perKg: silverPerGram * 1000,
        perOz: silverUsd * rate * silverFactor,
        spotPerKg: perGram(silverUsd, rate, 1) * 1000,
        changePct: silverChange,
        retailFactor: silverFactor,
      },
    };
  }

  return {
    updatedAt: spot.updatedAt,
    fetchedAt: new Date().toISOString(),
    fxDate: fx.date,
    spot: {
      goldUsd,
      silverUsd,
      goldChangePct: goldChange,
      silverChangePct: silverChange,
      source: spot.source,
    },
    countries: countryPrices,
    priceNote:
      "India includes est. import duty & GST. Other countries include a small local premium over spot.",
    attribution: `Spot: ${spot.source}. FX: Open ExchangeRate-API. Refreshes every 60s.`,
  };
}

export async function getPricesInr() {
  const world = await getWorldPrices();
  const india = world.countries.IN;
  if (!india) throw new Error("India pricing unavailable");

  return {
    updatedAt: world.updatedAt,
    fx: { usdInr: india.fxRate, date: world.fxDate },
    gold: {
      usdPerOz: world.spot.goldUsd,
      inrPerOz: india.gold.perOz,
      inrPer10g: india.gold.per10g,
      inrPerGram: india.gold.perGram,
      changePct: india.gold.changePct,
      source: world.spot.source,
    },
    silver: {
      usdPerOz: world.spot.silverUsd,
      inrPerOz: india.silver.perOz,
      inrPerKg: india.silver.perKg,
      inrPerGram: india.silver.perGram,
      changePct: india.silver.changePct,
      source: world.spot.source,
    },
    attribution: world.attribution,
  };
}
