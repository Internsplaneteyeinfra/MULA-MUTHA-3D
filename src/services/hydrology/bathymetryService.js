export class BathymetryService {
  constructor() {
    this.cloud = null;
    this.crossSections = [];
    this.centerline = [];
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    try {
      const [res, centerlineRes] = await Promise.all([
        fetch('/data/naditwin/raw_bathymetry_cloud.json'),
        fetch('/data/naditwin/chainage_profile.json')
      ]);
      this.cloud = await res.json();
      this.crossSections = this.cloud.crossSections || [];
      const cp = await centerlineRes.json();
      this.centerline = cp.map(c => ({
        lat: c.lat || c.latitude,
        lon: c.lon || c.longitude,
        chainageMeters: c.chainage_m || c.chainage || 0
      }));
      this.ready = true;
    } catch (err) {
      console.warn('[BathymetryService] Failed to load bathymetry cloud or centerline:', err);
    }
  }

  /** Priority 1: Exact/Interp in same cross-section. Priority 2: Neighboring. */
  getBathymetryAt({ chainageMeters, lateralOffsetMeters }) {
    if (!this.ready || !this.crossSections.length) {
      return { depthM: null, source: 'UNAVAILABLE', provenance: 'UNAVAILABLE' };
    }

    // Find nearest cross-sections
    let lo = 0;
    let hi = this.crossSections.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.crossSections[mid].chainageMeters < chainageMeters) lo = mid + 1;
      else hi = mid - 1;
    }

    const c1 = this.crossSections[Math.max(0, hi)];
    const c2 = this.crossSections[Math.min(this.crossSections.length - 1, lo)];

    // If perfectly matches a chainage
    if (Math.abs(c1.chainageMeters - chainageMeters) < 0.1) {
      return this._interpolateLateral(c1, lateralOffsetMeters);
    }

    // Longitudinally interpolate between c1 and c2
    const d1 = this._interpolateLateral(c1, lateralOffsetMeters);
    const d2 = this._interpolateLateral(c2, lateralOffsetMeters);

    if (d1.depthM != null && d2.depthM != null) {
      const dist = c2.chainageMeters - c1.chainageMeters;
      const t = dist === 0 ? 0 : (chainageMeters - c1.chainageMeters) / dist;
      const depthM = d1.depthM * (1 - t) + d2.depthM * t;
      return {
        depthM,
        chainageMeters,
        lateralOffsetMeters,
        source: 'mula_mutha_water_depth.xlsx',
        provenance: 'INTERPOLATED',
        confidence: 'HIGH'
      };
    }

    return { depthM: null, source: 'UNAVAILABLE', provenance: 'UNAVAILABLE' };
  }

  _interpolateLateral(cs, lateralOffsetMeters) {
    if (!cs.points.length) return { depthM: null, provenance: 'UNAVAILABLE' };
    
    // Sort by lateral offset
    const pts = [...cs.points].sort((a, b) => a.lateralOffsetMeters - b.lateralOffsetMeters);
    
    let lo = 0;
    let hi = pts.length - 1;
    if (lateralOffsetMeters <= pts[lo].lateralOffsetMeters) {
      return { depthM: pts[lo].depthM, provenance: 'INTERPOLATED_EDGE' };
    }
    if (lateralOffsetMeters >= pts[hi].lateralOffsetMeters) {
      return { depthM: pts[hi].depthM, provenance: 'INTERPOLATED_EDGE' };
    }

    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i].lateralOffsetMeters <= lateralOffsetMeters && lateralOffsetMeters <= pts[i+1].lateralOffsetMeters) {
        const dist = pts[i+1].lateralOffsetMeters - pts[i].lateralOffsetMeters;
        const t = dist === 0 ? 0 : (lateralOffsetMeters - pts[i].lateralOffsetMeters) / dist;
        const depthM = pts[i].depthM * (1 - t) + pts[i+1].depthM * t;
        return { depthM, provenance: 'INTERPOLATED' };
      }
    }
    return { depthM: null, provenance: 'UNAVAILABLE' };
  }
}

export const bathymetryService = new BathymetryService();
