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

export const CHAINAGE_DESTINATIONS = [
  { id: "sangam", name: "Sangam", chainage_m: 622 },
  { id: "bund-garden", name: "Bund Garden", chainage_m: 3452 },
  { id: "dhanori", name: "Dhanori", chainage_m: 5902 },
  { id: "wadgaon-sheri", name: "Wadgaon Sheri", chainage_m: 7532 },
  { id: "hadapsar", name: "Hadapsar", chainage_m: 9132 },
  { id: "mundhwa", name: "Mundhwa", chainage_m: 9562 },
  { id: "kharadi", name: "Kharadi", chainage_m: 10752 },
  { id: "manjari", name: "Manjari", chainage_m: 15522 }
];

export function getDestinations(sel) {
  let prev = null;
  let next = null;
  let current = null;
  for (const dest of CHAINAGE_DESTINATIONS) {
    // Treat near-hits as arrived so the name banner can grow at the point.
    if (Math.abs(dest.chainage_m - sel) <= 40) {
      current = dest;
    } else if (dest.chainage_m < sel) {
      prev = dest;
    } else if (dest.chainage_m > sel && !next) {
      next = dest;
    }
  }
  return { prev, next, current };
}
