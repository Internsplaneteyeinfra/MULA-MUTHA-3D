/**
 * Production Mula–Mutha model forecast service.
 *
 * Adapted from the NadiTwin TwinEngine forecast_profile / q_quantiles /
 * refresh_forecast / wse_profile logic (stdlib ensemble → WSE).
 *
 * Runs entirely in the browser against public/data/naditwin/*.json.
 * Does NOT depend on river_digital_twin2-main or localhost:8080.
 *
 * MODELLED forecast — not live gauge / NWP.
 */

const PAST_HOURS = 72;
const FORECAST_HOURS = 72;
const N_MEMBERS = 50;
const TRUTH_HOURS = PAST_HOURS + 480;
const WSE_DATUM_M = 0.0;
const TOY_SLOPE = 0.0009;
const DEPTH_COEF = 0.1;
const DEPTH_EXP = 0.6;

/** Supported Forecast horizon buttons (hours). */
export const FORECAST_HORIZONS = [6, 12, 24, 48, 72];

let enginePromise = null;

/**
 * Load (once) and return the forecast engine for Mula–Mutha.
 */
export function getForecastEngine() {
  if (!enginePromise) {
    enginePromise = createForecastEngine().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * @param {number} leadH
 * @returns {Promise<{ lead_h: number, median: number[], p10: number[], p90: number[], chainage_m: number[] }>}
 */
export async function forecastProfile(leadH = 24) {
  const eng = await getForecastEngine();
  return eng.forecastProfile(leadH);
}

async function createForecastEngine() {
  const [chainage, depth] = await Promise.all([
    fetchJson("/data/naditwin/chainage_profile.json"),
    fetchJson("/data/naditwin/depth_profile.json").catch(() => null),
  ]);
  if (!Array.isArray(chainage) || !chainage.length) {
    throw new Error("Forecast geometry unavailable (chainage profile missing)");
  }
  return new ForecastEngine(chainage, depth, 42);
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json();
}

/** Mulberry32 — deterministic PRNG matching seedable Random(seed) behaviour closely enough for demos. */
function createRng(seed) {
  let t = (seed >>> 0) || 1;
  return {
    next() {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    },
    gauss(mu = 0, sigma = 1) {
      // Box–Muller
      let u = 0;
      let v = 0;
      while (u === 0) u = this.next();
      while (v === 0) v = this.next();
      const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
      return mu + z * sigma;
    },
    uniform(a, b) {
      return a + (b - a) * this.next();
    },
  };
}

class ForecastEngine {
  /**
   * @param {Array<{chainage_m:number, width_m:number}>} stations
   * @param {Array<{depth_m:number, flagged?:boolean}>|null} depthStations
   * @param {number} seed
   */
  constructor(stations, depthStations, seed = 42) {
    this.seed = seed;
    this.nCells = stations.length;
    this.chainageM = stations.map((s) => Number(s.chainage_m) || 0);
    this.realWidthM = stations.map((s) => Number(s.width_m) || 1);
    this.reachLenM = this.chainageM[this.nCells - 1] || 1;
    this.meanWidth = this.realWidthM.reduce((a, b) => a + b, 0) / this.nCells;

    if (depthStations?.length === this.nCells) {
      this.hasRealDepth = true;
      this.realDepthM = depthStations.map((d) => Number(d.depth_m) || 0);
      this.depthFlagged = depthStations.map((d) => !!d.flagged);
      this.meanDepth = this.realDepthM.reduce((a, b) => a + b, 0) / this.nCells;
    } else {
      this.hasRealDepth = false;
      this.realDepthM = new Array(this.nCells).fill(0);
      this.depthFlagged = new Array(this.nCells).fill(false);
      this.meanDepth = 0;
    }

    this.nowIdx = PAST_HOURS + 24;
    this._buildGeometry();
    this._buildTruthDischarge();
    this.refreshForecast();
  }

  _buildGeometry() {
    const rng = createRng(this.seed + 1);
    this.bed = [];
    this.widthFactor = [];
    for (let i = 0; i < this.nCells; i += 1) {
      const x = this.chainageM[i];
      const slopeComponent = WSE_DATUM_M - TOY_SLOPE * x;
      let bed;
      if (this.hasRealDepth) {
        bed = slopeComponent - (this.realDepthM[i] - this.meanDepth);
      } else {
        const pools =
          0.6 * Math.sin((2 * Math.PI * x) / 500.0) +
          0.3 * Math.sin((2 * Math.PI * x) / 140.0 + 1.3);
        bed = slopeComponent + pools + rng.gauss(0, 0.12);
      }
      this.bed.push(bed);
      const wf = this.realWidthM[i] / this.meanWidth;
      this.widthFactor.push(Math.max(0.15, Math.min(2.2, wf)));
    }
  }

  _buildTruthDischarge() {
    const rng = createRng(this.seed + 2);
    const base = 180.0;
    const pulses = [];
    let t = 20;
    while (t < TRUTH_HOURS) {
      pulses.push({
        t,
        amp: rng.uniform(200, 1400),
        width: rng.uniform(6, 20),
      });
      t += Math.floor(rng.uniform(40, 110));
    }
    const q = [];
    for (let h = 0; h < TRUTH_HOURS; h += 1) {
      let v = base + 30 * Math.sin((2 * Math.PI * h) / 240.0);
      for (const p of pulses) {
        v += p.amp * Math.exp(-0.5 * ((h - p.t) / p.width) ** 2);
      }
      v *= 1 + rng.gauss(0, 0.015);
      q.push(Math.max(40.0, v));
    }
    this.qTruth = q;
  }

  refreshForecast() {
    this.members = [];
    for (let m = 0; m < N_MEMBERS; m += 1) {
      const rng = createRng(this.seed * 1000 + this.nowIdx * 7 + m);
      const phase = rng.gauss(0, 2.5);
      const bias = rng.gauss(0, 0.04);
      const series = [];
      let noise = 0.0;
      for (let k = 1; k <= FORECAST_HOURS; k += 1) {
        noise += rng.gauss(0, 0.012);
        const idx = this.nowIdx + k + phase;
        const i0 = Math.max(0, Math.min(TRUTH_HOURS - 2, Math.floor(idx)));
        const frac = Math.min(1.0, Math.max(0.0, idx - i0));
        const q = this.qTruth[i0] * (1 - frac) + this.qTruth[i0 + 1] * frac;
        series.push(Math.max(30.0, q * (1 + bias + noise)));
      }
      this.members.push(series);
    }
  }

  qQuantiles(k, qs = [0.1, 0.5, 0.9]) {
    const vals = this.members.map((m) => m[k]).sort((a, b) => a - b);
    return qs.map((q) => {
      const pos = q * (vals.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, vals.length - 1);
      return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo);
    });
  }

  _depthFromQ(q, cell) {
    return (DEPTH_COEF * q ** DEPTH_EXP) / Math.max(0.4, this.widthFactor[cell]);
  }

  wseProfile(q) {
    const prof = [];
    for (let i = 0; i < this.nCells; i += 1) {
      const att = 1.0 - 0.08 * (i / this.nCells);
      const d = this._depthFromQ(q * att, i);
      prof.push(this.bed[i] + d);
    }
    return prof;
  }

  /**
   * @param {number} leadH 1..72
   */
  forecastProfile(leadH) {
    const lead = Math.round(Number(leadH) || 24);
    const k = Math.max(0, Math.min(FORECAST_HOURS - 1, lead - 1));
    const [q10, q50, q90] = this.qQuantiles(k);
    const round3 = (v) => Math.round(v * 1000) / 1000;
    return {
      lead_h: lead,
      median: this.wseProfile(q50).map(round3),
      p10: this.wseProfile(q10).map(round3),
      p90: this.wseProfile(q90).map(round3),
      chainage_m: this.chainageM.slice(),
      modelled: true,
      source: "MODEL FORECAST · ensemble hydraulic geometry (no live gauge)",
    };
  }

  cellForChainage(meters) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.nCells; i += 1) {
      const d = Math.abs(this.chainageM[i] - meters);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}

/**
 * Downsample parallel arrays for chart rendering (keeps endpoints + selected cell).
 */
export function downsampleProfile(payload, maxPoints = 160, selectedMeters = null) {
  const n = payload.median?.length || 0;
  if (!n) return payload;
  if (n <= maxPoints) return payload;

  const step = Math.ceil(n / maxPoints);
  const keep = new Set([0, n - 1]);
  for (let i = 0; i < n; i += step) keep.add(i);
  if (selectedMeters != null && payload.chainage_m?.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = Math.abs(payload.chainage_m[i] - selectedMeters);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    keep.add(best);
  }
  const idx = [...keep].sort((a, b) => a - b);
  const pick = (arr) => idx.map((i) => arr[i]);
  return {
    ...payload,
    median: pick(payload.median),
    p10: pick(payload.p10),
    p90: pick(payload.p90),
    chainage_m: pick(payload.chainage_m),
  };
}
