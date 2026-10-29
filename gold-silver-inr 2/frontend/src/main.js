import "./styles.css";
import { fetchWorldPrices, checkHealth } from "./api/prices.js";
import { createPixelMap } from "./map/PixelMap.js";
import { fmtMoney, fmtUsd, formatUpdated, changeHtml } from "./lib/format.js";

const REFRESH_MS = 60_000;
const WEIGHT_PRESETS = ["1", "5", "10", "20", "50"];

const state = {
  data: null,
  selectedIso: "IN",
  apiConnected: false,
  loading: true,
  error: null,
  mapReady: false,
  selectedMetal: "gold",
  grams: "10",
  purity: "1",
};

let map = null;
let tooltipEl = null;

function selectedCountry() {
  return state.data?.countries?.[state.selectedIso] || null;
}

function countryOptions() {
  if (!state.data?.countries) return "";
  return Object.entries(state.data.countries)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(
      ([iso, c]) =>
        `<option value="${iso}" ${iso === state.selectedIso ? "selected" : ""}>${c.name}</option>`
    )
    .join("");
}

function calcTotal(country) {
  if (!country) return { total: null, breakdown: "Select a country on the map" };
  const grams = parseFloat(state.grams);
  if (!grams || grams <= 0) return { total: null, breakdown: "Enter grams to calculate" };

  const ratePerGram =
    state.selectedMetal === "gold"
      ? country.gold.perGram * parseFloat(state.purity)
      : country.silver.perGram;

  return {
    total: ratePerGram * grams,
    breakdown: `${grams} g × ${fmtMoney(ratePerGram, country.currency, country.symbol)}/g`,
  };
}

function updateHeader() {
  const pill = document.querySelector(".pill");
  const time = document.querySelector(".topbar__time");
  const banner = document.querySelector(".banner");

  if (pill) {
    pill.className = `pill ${state.apiConnected ? "pill--live" : "pill--off"}`;
    pill.innerHTML = `<span class="pill__dot"></span>${state.apiConnected ? "Live" : "Offline"}`;
  }
  if (time && state.data) {
    time.textContent = formatUpdated(state.data.fetchedAt || state.data.updatedAt);
  }
  if (banner) {
    if (state.error && !state.data) {
      banner.hidden = false;
      banner.className = "banner banner--error";
      banner.innerHTML = state.error;
    } else if (state.loading && !state.data) {
      banner.hidden = false;
      banner.className = "banner";
      banner.textContent = "Loading world prices…";
    } else {
      banner.hidden = true;
    }
  }
}

function selectCountry(iso) {
  if (!state.data?.countries?.[iso]) return;
  state.selectedIso = iso;
  map?.setSelected(iso);
  renderPanel();
}

function renderPanel() {
  const panel = document.getElementById("panel");
  if (!panel) return;

  const c = selectedCountry();
  const calc = calcTotal(c);

  if (!state.data || !c) {
    panel.innerHTML = `<div class="panel__empty">${state.mapReady ? "Click a country on the map" : "Building map…"}</div>`;
    return;
  }

  panel.innerHTML = `
    <div class="panel__country">
      <span class="panel__flag">${state.selectedIso}</span>
      <div>
        <h2 class="panel__name">${c.name}</h2>
        <p class="panel__currency">${c.currency} · 1 USD = ${c.fxRate.toFixed(2)} ${c.currency}</p>
      </div>
    </div>

    <div class="panel__search">
      <label class="field">
        <span class="field__label">Country</span>
        <select id="country-select">${countryOptions()}</select>
      </label>
    </div>

    <div class="panel__cards">
      <article class="stat stat--gold">
        <div class="stat__head"><span>Gold</span>${changeHtml(c.gold.changePct)}</div>
        <div class="stat__value">${fmtMoney(c.gold.per10g, c.currency, c.symbol)}</div>
        <p class="stat__unit">per 10g · 24K ${c.gold.retailFactor > 1 ? "(est. retail)" : "spot"}</p>
        <dl class="stat__meta">
          <div><dt>Per gram</dt><dd>${fmtMoney(c.gold.perGram, c.currency, c.symbol)}</dd></div>
          <div><dt>Live spot</dt><dd>${fmtUsd.format(state.data.spot.goldUsd)}/oz</dd></div>
        </dl>
      </article>

      <article class="stat stat--silver">
        <div class="stat__head"><span>Silver</span>${changeHtml(c.silver.changePct)}</div>
        <div class="stat__value">${fmtMoney(c.silver.perKg, c.currency, c.symbol)}</div>
        <p class="stat__unit">per kg · 999 ${c.silver.retailFactor > 1 ? "(est. retail)" : "spot"}</p>
        <dl class="stat__meta">
          <div><dt>Per gram</dt><dd>${fmtMoney(c.silver.perGram, c.currency, c.symbol)}</dd></div>
          <div><dt>Live spot</dt><dd>${fmtUsd.format(state.data.spot.silverUsd)}/oz</dd></div>
        </dl>
      </article>
    </div>

    <section class="calc">
      <h3 class="calc__title">Price calculator</h3>
      <div class="calc__tabs" role="tablist">
        <button type="button" class="calc__tab ${state.selectedMetal === "gold" ? "calc__tab--on" : ""}" data-metal="gold">Gold</button>
        <button type="button" class="calc__tab ${state.selectedMetal === "silver" ? "calc__tab--on" : ""}" data-metal="silver">Silver</button>
      </div>
      <div class="calc__presets">
        ${WEIGHT_PRESETS.map(
          (g) =>
            `<button type="button" class="calc__preset" data-grams="${g}">${g}g</button>`
        ).join("")}
      </div>
      <div class="calc__fields">
        <label class="field ${state.selectedMetal !== "gold" ? "field--hidden" : ""}">
          <span class="field__label">Purity</span>
          <select id="purity" class="field__input">
            <option value="1" ${state.purity === "1" ? "selected" : ""}>24K</option>
            <option value="0.916" ${state.purity === "0.916" ? "selected" : ""}>22K</option>
            <option value="0.75" ${state.purity === "0.75" ? "selected" : ""}>18K</option>
          </select>
        </label>
        <label class="field ${state.selectedMetal !== "gold" ? "field--full" : ""}">
          <span class="field__label">Weight</span>
          <input id="grams" class="field__input" type="number" min="0" step="0.01" placeholder="10" value="${state.grams}" />
        </label>
      </div>
      <div class="calc__result">
        <span class="calc__result-label">Total value</span>
        <strong class="calc__result-value">${calc.total != null ? fmtMoney(calc.total, c.currency, c.symbol) : "—"}</strong>
        <p class="calc__breakdown">${calc.breakdown}</p>
      </div>
    </section>
  `;

  bindPanelEvents();
}

function updateCalcOnly() {
  const c = selectedCountry();
  const calc = calcTotal(c);
  const valueEl = document.querySelector(".calc__result-value");
  const breakdownEl = document.querySelector(".calc__breakdown");
  if (valueEl) {
    valueEl.textContent =
      calc.total != null && c ? fmtMoney(calc.total, c.currency, c.symbol) : "—";
  }
  if (breakdownEl) breakdownEl.textContent = calc.breakdown;
}

function bindPanelEvents() {
  document.getElementById("country-select")?.addEventListener("change", (e) => {
    selectCountry(e.target.value);
  });

  document.querySelectorAll(".calc__tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.selectedMetal = tab.dataset.metal;
      renderPanel();
    });
  });

  document.querySelectorAll(".calc__preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.grams = btn.dataset.grams;
      const gramsEl = document.getElementById("grams");
      if (gramsEl) gramsEl.value = state.grams;
      updateCalcOnly();
    });
  });

  document.getElementById("grams")?.addEventListener("input", (e) => {
    state.grams = e.target.value;
    updateCalcOnly();
  });

  document.getElementById("purity")?.addEventListener("change", (e) => {
    state.purity = e.target.value;
    updateCalcOnly();
  });
}

function mountShell() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="dashboard">
      <header class="topbar">
        <div class="topbar__brand">
          <span class="topbar__logo">Au</span>
          <div>
            <h1>Bullion Map</h1>
            <p>Live gold & silver · every country</p>
          </div>
        </div>
        <div class="topbar__meta">
          <span class="pill pill--off"><span class="pill__dot"></span>Offline</span>
          <span class="topbar__time">—</span>
        </div>
      </header>

      <div class="banner" hidden>Loading world prices…</div>

      <div class="dashboard__body">
        <section class="map-wrap">
          <div class="map-wrap__chrome">
            <span class="map-wrap__label">World</span>
            <span class="map-wrap__hint">Hover · click to select</span>
          </div>
          <canvas id="map" aria-label="Interactive world map of metal prices"></canvas>
          <div id="tooltip" class="tooltip" hidden></div>
        </section>
        <aside id="panel" class="panel"></aside>
      </div>

      <footer class="foot" id="foot"></footer>
    </div>
  `;

  tooltipEl = document.getElementById("tooltip");
  const canvas = document.getElementById("map");

  map = createPixelMap(canvas, {
    onSelect(iso) {
      state.selectedIso = iso;
      renderPanel();
    },
    onHover(iso, country, pos) {
      if (!tooltipEl) return;
      if (!iso || !country || !pos) {
        tooltipEl.hidden = true;
        return;
      }
      tooltipEl.hidden = false;
      tooltipEl.style.left = `${pos.x + 12}px`;
      tooltipEl.style.top = `${pos.y + 12}px`;
      tooltipEl.innerHTML = `
        <strong>${country.name}</strong>
        <span>Au ${fmtMoney(country.gold.per10g, country.currency, country.symbol)} / 10g</span>
        <span>Ag ${fmtMoney(country.silver.perKg, country.currency, country.symbol)} / kg</span>
      `;
    },
  });

  renderPanel();
  updateHeader();
}

async function loadData() {
  try {
    state.error = null;
    state.loading = true;
    updateHeader();

    state.data = await fetchWorldPrices();
    state.apiConnected = true;
    state.loading = false;

    if (map) {
      await map.setData(state.data);
      map.setSelected(state.selectedIso);
      state.mapReady = true;
    }

    const foot = document.getElementById("foot");
    if (foot) {
      foot.textContent = `${state.data.priceNote || ""} · ${state.data.attribution}`;
    }

    renderPanel();
    updateHeader();
  } catch (err) {
    state.error = `Could not reach API: ${err.message}. Run <code>npm run dev</code> in the project folder.`;
    state.apiConnected = false;
    state.loading = false;
    updateHeader();
    renderPanel();
  }
}

async function init() {
  mountShell();

  try {
    await checkHealth();
    state.apiConnected = true;
  } catch {
    state.apiConnected = false;
  }
  updateHeader();

  await loadData();
  setInterval(loadData, REFRESH_MS);
}

init();
