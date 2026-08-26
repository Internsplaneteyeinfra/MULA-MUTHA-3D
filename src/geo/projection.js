import proj4 from "proj4";

proj4.defs("EPSG:32643", "+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs +type=crs");

const WGS84 = "EPSG:4326";
const UTM43 = "EPSG:32643";

/** Lon/Lat (EPSG:4326) -> UTM 43N metres. */
export function projectLonLat(lon, lat) {
  const [easting, northing] = proj4(WGS84, UTM43, [lon, lat]);
  return { easting, northing, lon, lat };
}

/** UTM easting/northing -> Lon/Lat. */
export function unprojectUtm(easting, northing) {
  const [lon, lat] = proj4(UTM43, WGS84, [easting, northing]);
  return { lon, lat, easting, northing };
}

/** Aliases kept for existing call sites. */
export const lonLatToUtm = projectLonLat;
export const utmToLonLat = (e, n) => {
  const r = unprojectUtm(e, n);
  return { lon: r.lon, lat: r.lat };
};

/**
 * Local scene frame: one origin for ALL layers.
 * Three.js: Y = up, Z = north.
 * X is mirrored (−east) so left/right banks match the KML / Google Earth view.
 *
 * @param {Array<{easting:number,northing:number}>} points
 * @param {{ originLonLat?: { lon:number, lat:number } }} [opts]
 */
export function createLocalFrame(points, opts = {}) {
  let e0;
  let n0;
  if (opts.originLonLat && Number.isFinite(opts.originLonLat.lon) && Number.isFinite(opts.originLonLat.lat)) {
    const o = projectLonLat(opts.originLonLat.lon, opts.originLonLat.lat);
    e0 = o.easting;
    n0 = o.northing;
  } else {
    e0 = 0;
    n0 = 0;
    for (const p of points) {
      e0 += p.easting;
      n0 += p.northing;
    }
    e0 /= Math.max(1, points.length);
    n0 /= Math.max(1, points.length);
  }

  /** Scene +X = west (mirrored easting). Keeps Z = north. */
  const flipX = true;

  function toLocal(easting, northing) {
    const x = easting - e0;
    const z = northing - n0;
    return { x: flipX ? -x : x, z };
  }

  function toUtm(x, z) {
    return {
      easting: (flipX ? -x : x) + e0,
      northing: z + n0,
    };
  }

  return {
    crs: "EPSG:32643",
    originE: e0,
    originN: n0,
    flipX,
    projectLonLat(lon, lat) {
      const u = projectLonLat(lon, lat);
      const loc = toLocal(u.easting, u.northing);
      return { ...u, x: loc.x, z: loc.z };
    },
    /** Local X/Z -> lon/lat + UTM */
    unprojectXY(x, z) {
      const u = toUtm(x, z);
      const ll = unprojectUtm(u.easting, u.northing);
      return { x, z, easting: u.easting, northing: u.northing, lon: ll.lon, lat: ll.lat };
    },
    toLocal,
    toUtm,
    toLonLat(x, z) {
      const u = toUtm(x, z);
      return unprojectUtm(u.easting, u.northing);
    },
  };
}
