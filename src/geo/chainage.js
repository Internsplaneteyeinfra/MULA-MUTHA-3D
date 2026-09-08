/** Binary-search interpolation over the authoritative KML chainage points. */
export function interpolateChainage(points, meters) {
  const sorted = points || [];
  if (!sorted.length) return null;
  const value = Number(meters);
  if (!Number.isFinite(value)) return { ...sorted[0] };
  if (value <= sorted[0].meters) return { ...sorted[0], meters: sorted[0].meters };
  const last = sorted[sorted.length - 1];
  if (value >= last.meters) return { ...last, meters: last.meters };

  let lo = 0;
  let hi = sorted.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].meters <= value) lo = mid;
    else hi = mid;
  }
  const a = sorted[lo];
  const b = sorted[hi];
  const t = (value - a.meters) / Math.max(1e-9, b.meters - a.meters);
  const out = { ...a, meters: value, label: formatStation(value) };
  for (const key of ["lon", "lat", "x", "z", "easting", "northing"]) {
    if (Number.isFinite(a[key]) && Number.isFinite(b[key])) out[key] = a[key] + (b[key] - a[key]) * t;
  }
  return out;
}

export function formatStation(meters) {
  const value = Math.max(0, Math.round(Number(meters) || 0));
  return `${Math.floor(value / 1000)}+${String(value % 1000).padStart(3, "0")}`;
}
