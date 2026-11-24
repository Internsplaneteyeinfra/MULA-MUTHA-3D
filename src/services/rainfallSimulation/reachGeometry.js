/**
 * Corridor geometry helpers for rainfall-sim volume / affected-length.
 * Uses existing chainage station widths and along-channel distances.
 * Returns null when geometry is insufficient — callers must show N/A (not invent).
 */

/**
 * @param {object} dataset
 * @returns {{ stations: { meters: number, width: number }[], lengthM: number } | null}
 */
export function buildReachGeometry(dataset) {
  const raw = dataset?.corridor?.stations;
  if (!Array.isArray(raw) || raw.length < 2) return null;

  const stations = [];
  let cum = 0;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (i > 0) {
      const p = raw[i - 1];
      cum += Math.hypot(
        (Number(s.x) || 0) - (Number(p.x) || 0),
        (Number(s.z) || 0) - (Number(p.z) || 0),
      );
    }
    const width = Number.isFinite(Number(s.width))
      ? Number(s.width)
      : Number.isFinite(Number(s.halfWidth))
        ? Number(s.halfWidth) * 2
        : null;
    if (!Number.isFinite(width) || width < 2) continue;

    // Prefer explicit chainage meters when present and finite
    const explicit = Number.isFinite(Number(s.meters))
      ? Number(s.meters)
      : Number.isFinite(Number(s.chainageMeters))
        ? Number(s.chainageMeters)
        : null;

    stations.push({
      meters: explicit != null ? explicit : cum,
      pathM: cum,
      width,
    });
  }
  if (stations.length < 2) return null;

  // Use explicit chainage if monotonic; otherwise path distance
  let mono = true;
  for (let i = 1; i < stations.length; i++) {
    if (!(stations[i].meters > stations[i - 1].meters)) {
      mono = false;
      break;
    }
  }
  for (const st of stations) {
    st.meters = mono ? st.meters : st.pathM;
  }
  const m0 = stations[0].meters;
  for (const st of stations) st.meters -= m0;
  const lengthM = stations[stations.length - 1].meters;
  if (!(lengthM > 10)) return null;
  return { stations, lengthM };
}

/**
 * Integrate rectangular A(x)=width(x)·depth along chainage (trapezoidal).
 * @param {{ stations: { meters: number, width: number }[], lengthM: number }} geom
 * @param {number} depthM hydraulic depth (m)
 * @returns {number|null}
 */
export function volumeFromGeometry(geom, depthM) {
  if (!geom?.stations?.length || !(depthM > 0)) return null;
  let V = 0;
  for (let i = 0; i < geom.stations.length - 1; i++) {
    const a0 = geom.stations[i].width * depthM;
    const a1 = geom.stations[i + 1].width * depthM;
    const dx = geom.stations[i + 1].meters - geom.stations[i].meters;
    if (dx > 0) V += 0.5 * (a0 + a1) * dx;
  }
  return V;
}

/**
 * Affected length (km) for a lumped uniform stage rise on the corridor.
 * Documented: model has one stage for the AOI; stations share that rise.
 * Uses actual chainage span (geom.lengthM), not station_count × constant.
 */
export function affectedLengthKmFromGeometry(geom, stageRiseM, thresholdM) {
  if (!geom?.stations?.length) return null;
  if (!(Number(stageRiseM) >= Number(thresholdM))) return 0;
  return geom.lengthM / 1000;
}

/**
 * Per-station stage results for the lumped model (same rise everywhere).
 */
export function chainageStageResults(geom, baselineStageM, currentRiseM, thresholdM) {
  if (!geom?.stations?.length) return null;
  return geom.stations.map((st) => ({
    chainage_m: st.meters,
    baseline_stage_m: baselineStageM,
    current_stage_m: baselineStageM + currentRiseM,
    stage_change_m: currentRiseM,
    affected: currentRiseM >= thresholdM,
  }));
}
