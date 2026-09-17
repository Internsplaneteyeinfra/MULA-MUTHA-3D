/**
 * RiverEye Climate Impact — flood / surface-water heatmap timeseries.
 * Live API: https://rivereye-production.up.railway.app/asset/mula-mutha-flood-water.json
 * Mirrored locally (CORS-safe for Pages/dev): public/data/hydrology/climate/
 */

const REMOTE_BASE = "https://rivereye-production.up.railway.app";

/** Override with VITE_RIVEREYE_ASSET_BASE to force remote (needs CORS) or a proxy. */
export const CLIMATE_IMPACT_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_RIVEREYE_ASSET_BASE) ||
  null;

function appBase() {
  const b =
    (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
  return String(b).endsWith("/") ? String(b) : `${b}/`;
}

/** Prefer local mirror; fall back to remote when VITE_RIVEREYE_ASSET_BASE is set. */
function indexCandidates() {
  const local = `${appBase()}data/hydrology/climate/mula-mutha-flood-water.json`;
  if (CLIMATE_IMPACT_BASE) {
    const remote = `${String(CLIMATE_IMPACT_BASE).replace(/\/$/, "")}/asset/mula-mutha-flood-water.json`;
    return [remote, local];
  }
  return [local, `${REMOTE_BASE}/asset/mula-mutha-flood-water.json`];
}

/** @type {object | null} */
let indexCache = null;
/** @type {Map<number, object>} */
const periodCache = new Map();
/** @type {"local" | "remote" | null} */
let resolvedSource = null;

/**
 * @returns {Promise<{
 *   name:string, note:string, bounds:object, default_period:number,
 *   classes:{ water:{label:string,color:string}, flood:{label:string,color:string} },
 *   periods: Array<{
 *     id:number, pre_date:string, post_date:string,
 *     water_area_ha:number, flood_area_ha:number,
 *     n_flood:number, n_water:number, points:string, label:string
 *   }>
 * }>}
 */
export async function fetchClimateImpactIndex() {
  if (indexCache) return indexCache;
  let lastErr = null;
  for (const url of indexCandidates()) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Climate impact index HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.periods) || !data.periods.length) {
        throw new Error("Climate impact index has no periods");
      }
      const isLocal = /\/data\/hydrology\/climate\//.test(url);
      resolvedSource = isLocal ? "local" : "remote";
      data.periods = data.periods.map((p) => ({
        ...p,
        label: formatPeriodLabel(p.pre_date, p.post_date),
        pointsUrl: resolveAssetUrl(p.points, p.id, isLocal),
      }));
      indexCache = data;
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Climate impact index unavailable");
}

/**
 * Period points: { flood: [lon,lat][], water: [lon,lat][] }
 * @param {number} periodId
 */
export async function fetchClimateImpactPeriod(periodId) {
  const id = Number(periodId);
  if (periodCache.has(id)) return periodCache.get(id);

  const index = await fetchClimateImpactIndex();
  const period = index.periods.find((p) => p.id === id) || index.periods[0];
  if (!period) throw new Error("Climate period not found");

  const res = await fetch(period.pointsUrl, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`Climate points HTTP ${res.status}`);
  const raw = await res.json();
  const flood = normalizePairs(raw.flood);
  const water = normalizePairs(raw.water);
  const payload = {
    periodId: period.id,
    period,
    flood,
    water,
    classes: index.classes,
  };
  periodCache.set(period.id, payload);
  return payload;
}

export function formatPeriodLabel(pre, post) {
  try {
    const a = new Date(`${pre}T12:00:00Z`);
    const b = new Date(`${post}T12:00:00Z`);
    const sameMonth = a.getUTCMonth() === b.getUTCMonth();
    const fmtDay = (d) => d.getUTCDate();
    const fmtMon = (d) =>
      d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
    if (sameMonth) {
      return `${fmtDay(a)}–${fmtDay(b)} ${fmtMon(a)}`;
    }
    return `${fmtDay(a)} ${fmtMon(a)}–${fmtDay(b)} ${fmtMon(b)}`;
  } catch {
    return `${pre} → ${post}`;
  }
}

/**
 * @param {string} path
 * @param {number} periodId
 * @param {boolean} preferLocal
 */
function resolveAssetUrl(path, periodId, preferLocal) {
  if (path && /^https?:\/\//i.test(path)) return path;
  const file =
    path?.split("/").pop() ||
    `mula-mutha-flood-water-${Number.isFinite(periodId) ? periodId : 0}.json`;
  if (preferLocal || resolvedSource === "local") {
    return `${appBase()}data/hydrology/climate/${file}`;
  }
  if (CLIMATE_IMPACT_BASE) {
    const base = String(CLIMATE_IMPACT_BASE).replace(/\/$/, "");
    if (path?.startsWith("/")) return `${base}${path}`;
    return `${base}/asset/${file}`;
  }
  return `${REMOTE_BASE}/asset/${file}`;
}

function normalizePairs(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const p of arr) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lon = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push([lon, lat]);
  }
  return out;
}

/** WRD survey flood/bank lines (blue / red / green). Independent of image period. */
const WRD_FILE = "mula-mutha-wrd-floodlines.geojson";

/** @type {object | null} */
let wrdCache = null;

export const WRD_FLOODLINE_LEGEND = [
  { id: "blue", label: "Blue flood line", color: "#1565c0", kind: "survey" },
  { id: "red", label: "Red flood line", color: "#c62828", kind: "survey" },
  { id: "green", label: "Green bank line", color: "#2e7d32", kind: "survey" },
];

/**
 * @returns {Promise<{
 *   type:string,
 *   features: Array<{
 *     line:string, color:string, sheet_title?:string, note?:string,
 *     coordinates:number[][]
 *   }>
 * }>}
 */
export async function fetchWrdFloodLines() {
  if (wrdCache) return wrdCache;
  const urls = [
    `${appBase()}data/hydrology/climate/${WRD_FILE}`,
  ];
  if (CLIMATE_IMPACT_BASE) {
    urls.push(
      `${String(CLIMATE_IMPACT_BASE).replace(/\/$/, "")}/asset/${WRD_FILE}`,
    );
  }
  urls.push(`${REMOTE_BASE}/asset/${WRD_FILE}`);

  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`WRD flood lines HTTP ${res.status}`);
      const text = await res.text();
      // Vite SPA fallback returns HTML when a public asset is watcher-ignored
      if (/^\s*</.test(text)) {
        throw new Error(`WRD asset returned HTML instead of GeoJSON (${url})`);
      }
      const raw = JSON.parse(text);
      const features = [];
      for (const f of raw?.features || []) {
        const geom = f?.geometry;
        if (!geom) continue;
        const rings =
          geom.type === "MultiLineString"
            ? geom.coordinates
            : geom.type === "LineString"
              ? [geom.coordinates]
              : [];
        for (const coords of rings) {
          if (!Array.isArray(coords) || coords.length < 2) continue;
          const line = String(f?.properties?.line || "").toLowerCase();
          const color =
            f?.properties?.color ||
            WRD_FLOODLINE_LEGEND.find((x) => x.id === line)?.color ||
            "#888888";
          features.push({
            line: line || "unknown",
            color,
            sheet_title: f?.properties?.sheet_title || "",
            note: f?.properties?.note || "",
            coordinates: coords
              .map((c) => [Number(c[0]), Number(c[1])])
              .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)),
          });
        }
      }
      if (!features.length) throw new Error("WRD flood lines empty");
      wrdCache = {
        type: "FeatureCollection",
        name: raw?.name || "WRD flood lines",
        features,
        legend: WRD_FLOODLINE_LEGEND,
      };
      return wrdCache;
    } catch (err) {
      lastErr = err;
      console.warn("[climate-impact] WRD fetch failed", url, err?.message || err);
    }
  }
  throw lastErr || new Error("WRD flood lines unavailable");
}

export function clearClimateImpactCache() {
  indexCache = null;
  periodCache.clear();
  wrdCache = null;
  resolvedSource = null;
}
