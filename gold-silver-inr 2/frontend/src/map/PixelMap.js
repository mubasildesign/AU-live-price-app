import { feature } from "topojson-client";
import { geoNaturalEarth1, geoContains, geoBounds } from "d3-geo";

const GRID_W = 480;
const GRID_H = 240;
const GRID_ASPECT = GRID_W / GRID_H;
const DOT_SCALE = 0.76;
const NAME_ALIASES = {
  unitedstatesofamerica: "US",
  unitedstates: "US",
  russianfederation: "RU",
  unitedkingdom: "GB",
  southkorea: "KR",
  northkorea: "KP",
  vietnam: "VN",
  laos: "LA",
  syria: "SY",
  iran: "IR",
  bolivia: "BO",
  venezuela: "VE",
  tanzania: "TZ",
  moldova: "MD",
  czechia: "CZ",
  northmacedonia: "MK",
  eswatini: "SZ",
  myanmar: "MM",
  ivorycoast: "CI",
  caboverde: "CV",
  easttimor: "TL",
  brunei: "BN",
  micronesia: "FM",
};

let worldTopology = null;
let gridBuildPromise = null;

async function loadWorldTopology() {
  if (worldTopology) return worldTopology;
  const res = await fetch("/world-110m.json");
  if (!res.ok) throw new Error("Failed to load world map");
  worldTopology = await res.json();
  return worldTopology;
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function buildIsoLookup(countryData) {
  const lookup = { ...NAME_ALIASES };
  for (const [iso, meta] of Object.entries(countryData)) {
    lookup[normalizeName(meta.name)] = iso;
  }
  return lookup;
}

function pointInBounds(lng, lat, bounds) {
  return lng >= bounds[0][0] && lng <= bounds[1][0] && lat >= bounds[0][1] && lat <= bounds[1][1];
}

async function buildStaticGrid() {
  if (gridBuildPromise) return gridBuildPromise;

  gridBuildPromise = (async () => {
    const world = await loadWorldTopology();
    const raw = feature(world, world.objects.countries).features;
    const projection = geoNaturalEarth1()
      .fitSize([GRID_W, GRID_H], { type: "FeatureCollection", features: raw });

    const features = raw.map((f) => ({
      feature: f,
      bounds: geoBounds(f),
    }));

    const cells = new Array(GRID_W * GRID_H).fill(null);

    for (let row = 0; row < GRID_H; row++) {
      for (let col = 0; col < GRID_W; col++) {
        const lngLat = projection.invert([col + 0.5, row + 0.5]);
        if (!lngLat) continue;

        const [lng, lat] = lngLat;
        for (const { feature: f, bounds } of features) {
          if (!pointInBounds(lng, lat, bounds)) continue;
          if (geoContains(f, lngLat)) {
            cells[row * GRID_W + col] = normalizeName(f.properties?.name || "");
            break;
          }
        }
      }
    }

    return { cells, projection, raw };
  })();

  return gridBuildPromise;
}

export function createPixelMap(canvas, { onSelect, onHover }) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let isoLookup = {};
  let countryData = {};
  let staticGrid = null;
  let dots = [];
  let colorCache = new Map();
  let hoveredIso = null;
  let selectedIso = "IN";
  let width = 0;
  let height = 0;
  let cellSize = 1;
  let mapX = 0;
  let mapY = 0;
  let mapW = 0;
  let mapH = 0;
  let rafHover = null;
  let pendingHover = null;
  let destroyed = false;

  function resolveIso(nameKey) {
    if (!nameKey) return null;
    return isoLookup[nameKey] || NAME_ALIASES[nameKey] || null;
  }

  function rebuildDots() {
    if (!staticGrid) return;

    const size = Math.max(1, cellSize * DOT_SCALE);
    const inset = (cellSize - size) / 2;

    dots = [];
    for (let row = 0; row < GRID_H; row++) {
      for (let col = 0; col < GRID_W; col++) {
        const nameKey = staticGrid.cells[row * GRID_W + col];
        const iso = resolveIso(nameKey);
        if (!iso) continue;
        dots.push({
          iso,
          x: mapX + col * cellSize + inset,
          y: mapY + row * cellSize + inset,
          w: size,
          h: size,
        });
      }
    }
  }

  function dotColor(iso) {
    if (iso === selectedIso) return "#e2b45a";
    if (iso === hoveredIso) return "rgba(246,240,230,0.85)";

    const cached = colorCache.get(iso);
    if (cached) return cached;

    const c = countryData[iso];
    if (!c) return "rgba(246,240,230,0.08)";

    const usd10g = c.gold.spotPer10g ?? c.gold.per10g / (c.gold.retailFactor || 1);
    const t = colorCache.has("__max")
      ? (usd10g - colorCache.get("__min")) / (colorCache.get("__max") - colorCache.get("__min") || 1)
      : 0.5;
    const alpha = 0.12 + t * 0.36;
    const color = `rgba(246,240,230,${alpha.toFixed(2)})`;
    colorCache.set(iso, color);
    return color;
  }

  function rebuildColorScale() {
    colorCache.clear();
    const usdValues = Object.values(countryData).map(
      (c) => c.gold.spotPer10g ?? c.gold.per10g / (c.gold.retailFactor || 1)
    );
    if (!usdValues.length) return;
    colorCache.set("__min", Math.min(...usdValues));
    colorCache.set("__max", Math.max(...usdValues));
    for (const iso of Object.keys(countryData)) colorCache.delete(iso);
  }

  function draw() {
    if (!width || !height) return;
    ctx.fillStyle = "#141218";
    ctx.fillRect(0, 0, width, height);

    for (const dot of dots) {
      ctx.fillStyle = dotColor(dot.iso);
      ctx.fillRect(dot.x, dot.y, dot.w, dot.h);
    }
  }

  function resize() {
    if (destroyed) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = width;
    canvas.height = height;

    // Keep Natural Earth aspect ratio — letterbox instead of stretch
    const pad = 24;
    const availW = Math.max(1, width - pad * 2);
    const availH = Math.max(1, height - pad * 2);
    if (availW / availH > GRID_ASPECT) {
      mapH = availH;
      mapW = availH * GRID_ASPECT;
    } else {
      mapW = availW;
      mapH = availW / GRID_ASPECT;
    }
    mapX = (width - mapW) / 2;
    mapY = (height - mapH) / 2;
    cellSize = mapW / GRID_W;

    rebuildDots();
    draw();
  }

  function isoAt(x, y) {
    const localX = x - mapX;
    const localY = y - mapY;
    if (localX < 0 || localY < 0 || localX >= mapW || localY >= mapH) return null;
    const col = Math.floor(localX / cellSize);
    const row = Math.floor(localY / cellSize);
    if (col < 0 || col >= GRID_W || row < 0 || row >= GRID_H) return null;
    const nameKey = staticGrid?.cells[row * GRID_W + col];
    return resolveIso(nameKey);
  }

  async function setData(data) {
    countryData = data.countries || {};
    isoLookup = buildIsoLookup(countryData);
    staticGrid = await buildStaticGrid();
    rebuildColorScale();
    resize();
  }

  function setSelected(iso) {
    if (!iso || !countryData[iso]) return;
    selectedIso = iso;
    draw();
    onSelect?.(iso, countryData[iso]);
  }

  function handleHover(iso, pos) {
    if (iso === hoveredIso) {
      if (iso && pos) onHover?.(iso, countryData[iso], pos);
      return;
    }
    hoveredIso = iso;
    draw();
    onHover?.(iso, iso ? countryData[iso] : null, pos);
    canvas.style.cursor = iso ? "pointer" : "default";
  }

  canvas.addEventListener("mousemove", (e) => {
    pendingHover = {
      iso: isoAt(e.offsetX, e.offsetY),
      pos: { x: e.clientX, y: e.clientY },
    };
    if (rafHover) return;
    rafHover = requestAnimationFrame(() => {
      rafHover = null;
      if (pendingHover) handleHover(pendingHover.iso, pendingHover.pos);
    });
  });

  canvas.addEventListener("mouseleave", () => {
    pendingHover = null;
    handleHover(null, null);
  });

  canvas.addEventListener("click", () => {
    if (hoveredIso) setSelected(hoveredIso);
  });

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  return {
    setData,
    setSelected,
    resize,
    destroy() {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      if (rafHover) cancelAnimationFrame(rafHover);
    },
  };
}
