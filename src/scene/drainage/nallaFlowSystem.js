import * as THREE from "three";
import { state } from "../../state.js";
import { resolveNallaFlow } from "./flowDirectionResolver.js";
import { createNallaWaterMaterial } from "./nallaWaterMaterial.js";
import { createJoiningStreamsEffects } from "./joiningStreamsEffects.js";
import { metersToStation } from "../chainageMarkers.js";
import { validateLonLat } from "./joiningStreamsController.js";
import { terrainHeightAt } from "../terrain.js";
import { SURFACE_Y } from "../river.js";
import { lonLatToLocal } from "../../geo/geoReference.js";

/**
 * Continuous nalla water surfaces (shader ribbons).
 * Open ground = surface channel cut into terrain; under buildings = recessed culvert.
 * Joining Streams mode adds slim pipes / arrows / confluence mist via effects child.
 */
export function createNallaFlowSystem(dataset, drainageGroup, opts = {}) {
  const group = new THREE.Group();
  group.name = "nallaFlowSystem";
  group.visible = false;

  const pickables = drainageGroup?.userData?.pickables || [];
  const stations = dataset.corridor?.stations || [];
  const chainagePts = [...(dataset.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  const material = createNallaWaterMaterial();

  if (!pickables.length) {
    group.userData.update = () => {};
    group.userData.records = [];
    group.userData.stats = { nallas: 0, connected: 0, unknownDir: 0 };
    group.userData.playReveal = () => {};
    group.userData.setActive = () => {};
    group.userData.setSelected = () => {};
    group.userData.setHovered = () => {};
    group.userData.setJoiningStreamsMode = () => {};
    return group;
  }

  const records = [];
  let unknownDir = 0;
  let connected = 0;
  const meshes = [];

  for (let i = 0; i < pickables.length; i++) {
    const path = pickables[i];
    if (!path.pts || path.pts.length < 2) continue;
    const rec = resolveNallaFlow(path, stations);
    rec.index = i;

    let ordered = rec.flowTowardEnd ? path.pts.slice() : path.pts.slice().reverse();
    ordered = snapOutletToBank(ordered, rec, stations);

    for (const p of ordered) {
      if (Number.isFinite(p.lon) && Number.isFinite(p.lat)) {
        const fixed = validateLonLat(p.lon, p.lat);
        if (fixed) {
          p.lon = fixed.lon;
          p.lat = fixed.lat;
        }
      }
    }

    enrichChainage(rec, chainagePts, ordered, dataset);

    rec.openGroundShare =
      ordered.reduce((s, p) => s + ((p.under || 0) < 0.2 ? 1 : 0), 0) / Math.max(1, ordered.length);

    const radius = channelRadius(rec);
    rec.channelRadius = radius;

    const curvePts = buildGroundedCurvePts(ordered, stations, rec, radius);
    if (curvePts.length < 2) continue;

    const curve = new THREE.CatmullRomCurve3(curvePts, false, "centripetal", 0.15);
    const length = Math.max(1, curve.getLength());
    rec.curve = curve;
    rec.curveLength = length;
    rec.orderedPts = ordered;

    if (rec.connectsToRiver) connected++;
    if (rec.flowDirectionConfidence === "unknown") {
      unknownDir++;
      console.debug("[nalla-flow] ambiguous direction", rec.name || rec.id, rec.directionReason);
    }

    const tubular = Math.max(16, Math.min(360, Math.floor(length / 3.5)));
    let geo;
    try {
      geo = new THREE.TubeGeometry(curve, tubular, radius, 7, false);
    } catch {
      continue;
    }

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `nallaWater_${rec.id}`;
    mesh.renderOrder = 8;
    mesh.frustumCulled = false;
    mesh.userData.record = rec;
    group.add(mesh);
    meshes.push(mesh);
    records.push(rec);
  }

  const sorted = [...records].sort(
    (a, b) =>
      (a.nearestChainageMeters ?? 1e12) - (b.nearestChainageMeters ?? 1e12) ||
      String(a.meta?.osmId || a.id).localeCompare(String(b.meta?.osmId || b.id)),
  );
  sorted.forEach((r, i) => {
    r.navIndex = i;
    r.displayId = `D-${i + 1}`;
    r.displayName = formatNallaDisplayName(r, r.displayId);
  });

  let revealT = 0;
  let active = false;
  let joiningMode = false;
  /** @type {null | object} */
  let selectedRec = null;
  /** @type {null | object} */
  let hoveredRec = null;

  group.userData.records = records;
  group.userData.material = material;

  const effects = createJoiningStreamsEffects(group, {
    uiRoot: opts.uiRoot,
    getCamera: opts.getCamera,
  });
  group.add(effects);
  group.userData.effects = effects;
  group.userData.stats = {
    nallas: records.length,
    connected,
    unknownDir,
    style: "terrain-draped-channel",
  };

  group.userData.setActive = (on) => {
    active = !!on;
    state.showNallaFlow = active;
    material.uniforms.uActive.value = active ? 1 : 0;
    if (active) {
      revealT = 0;
      material.uniforms.uReveal.value = 0;
      group.visible = true;
    } else {
      group.visible = false;
      material.uniforms.uReveal.value = 0;
      effects.userData.setActive(false);
      selectedRec = null;
      hoveredRec = null;
    }
  };

  group.userData.playReveal = () => {
    revealT = 0;
    material.uniforms.uReveal.value = 0;
    active = true;
    state.showNallaFlow = true;
    material.uniforms.uActive.value = 1;
    group.visible = true;
  };

  group.userData.getRecordByPickMeta = (meta) => {
    if (!meta) return null;
    return (
      records.find((r) => r.meta === meta) ||
      records.find((r) => r.meta?.osmId && r.meta.osmId === meta.osmId) ||
      records.find((r) => r.name === meta.name)
    );
  };

  group.userData.setSelected = (recOrNull) => {
    selectedRec = recOrNull || null;
    effects.userData.setSelected(selectedRec);
    // Shared material — do not boost all channels; selection is mesh scale + pipes/arrows
    material.uniforms.uSelectedBoost.value = 0;
  };

  group.userData.setHovered = (recOrNull) => {
    hoveredRec = recOrNull || null;
    effects.userData.setHovered?.(hoveredRec);
  };

  group.userData.setJoiningStreamsMode = (on) => {
    joiningMode = !!on;
    material.uniforms.uJoiningStyle.value = joiningMode ? 1 : 0;
    material.uniforms.uOpacity.value = joiningMode ? 0.92 : 0.9;
    effects.userData.setActive(joiningMode && active);
    const banks = drainageGroup?.userData?.staticBanks;
    if (banks) banks.visible = !joiningMode;
    const fill = drainageGroup?.userData?.staticFill;
    if (fill) fill.visible = false;
    if (!joiningMode) {
      selectedRec = null;
      hoveredRec = null;
      effects.userData.setSelected(null);
      effects.userData.setHovered?.(null);
      material.uniforms.uSelectedBoost.value = 0;
      if (banks) banks.visible = true;
    }
  };

  console.info("Nalla water surfaces", group.userData.stats);

  function update(dt, camera) {
    const want = !!state.showDrainage;
    if (want !== active) {
      if (want) group.userData.playReveal();
      else group.userData.setActive(false);
    }
    if (!want) {
      group.visible = false;
      effects.userData.setActive(false);
      return;
    }
    group.visible = true;
    const t = state.elapsed != null ? state.elapsed : material.uniforms.uTime.value + dt;
    material.uniforms.uTime.value = t;
    material.uniforms.uFlowSpeed.value =
      joiningMode || state.joiningStreamsMode
        ? Math.min(0.38, state.nallaFlowSpeed ?? 0.38)
        : state.nallaFlowSpeed ?? 0.65;
    material.uniforms.uActive.value = 1;
    material.uniforms.uJoiningStyle.value = joiningMode || state.joiningStreamsMode ? 1 : 0;

    if (revealT < 1) {
      revealT = Math.min(1, revealT + dt * 1.4);
      material.uniforms.uReveal.value = revealT;
    } else {
      material.uniforms.uReveal.value = 1;
    }

    const fxOn = !!(joiningMode || state.joiningStreamsMode);
    effects.userData.setActive(fxOn);
    if (fxOn) effects.userData.update(dt, camera);
  }

  group.userData.update = update;
  return group;
}

/**
 * Densify + re-drape so the full tube sits ON terrain (not half-buried).
 * Center = ground + radius + clearance; only soft-dip under building footprints.
 */
function buildGroundedCurvePts(ordered, stations, rec, radius) {
  const dense = densifyPolyline(ordered, 4);
  const n = dense.length;
  const clearance = 0.55;
  const pts = dense.map((p, i) => {
    const under = p.under || 0;
    let ground = terrainHeightAt(p.x, p.z, stations);
    if (!Number.isFinite(ground)) ground = p.y || SURFACE_Y;

    // Always keep tube center above ground by ~radius so the mesh is visible
    let y = ground + radius + clearance;
    if (under > 0.55) {
      // Culvert under buildings: skim just above ground (building mass covers it)
      y = ground + Math.max(0.4, radius * 0.35);
    } else if (under > 0.18) {
      y = ground + THREE.MathUtils.lerp(radius + clearance, radius * 0.45, under);
    }

    const t = n <= 1 ? 1 : i / (n - 1);
    if (rec.connectsToRiver && t > 0.72) {
      const u = (t - 0.72) / 0.28;
      const target = SURFACE_Y + radius + 0.35;
      y = THREE.MathUtils.lerp(y, target, u * u);
    }

    // Never let center drop below ground + small pad (DTM/mesh mismatch)
    y = Math.max(y, ground + Math.max(0.35, radius * 0.55));

    return new THREE.Vector3(p.x, y, p.z);
  });

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      pts[i].y = pts[i].y * 0.5 + pts[i - 1].y * 0.25 + pts[i + 1].y * 0.25;
    }
  }
  return pts;
}

function densifyPolyline(pts, stepM) {
  if (!pts?.length) return [];
  if (pts.length < 2) return pts.slice();
  const out = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(dist / Math.max(2, stepM)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const under = Math.max(a.under || 0, b.under || 0);
      if (
        Number.isFinite(a.lon) &&
        Number.isFinite(b.lon) &&
        Number.isFinite(a.lat) &&
        Number.isFinite(b.lat)
      ) {
        const lon = a.lon + (b.lon - a.lon) * t;
        const lat = a.lat + (b.lat - a.lat) * t;
        try {
          const loc = lonLatToLocal(lon, lat);
          out.push({
            x: loc.x,
            z: loc.z,
            lon,
            lat,
            y: a.y != null && b.y != null ? a.y + (b.y - a.y) * t : a.y,
            under,
          });
          continue;
        } catch {
          /* XZ fallback */
        }
      }
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        y: a.y != null && b.y != null ? a.y + (b.y - a.y) * t : a.y,
        lon: Number.isFinite(a.lon) && Number.isFinite(b.lon) ? a.lon + (b.lon - a.lon) * t : a.lon,
        lat: Number.isFinite(a.lat) && Number.isFinite(b.lat) ? a.lat + (b.lat - a.lat) * t : a.lat,
        under,
      });
    }
  }
  return out;
}

/** Prefer KML <name> / name:en / int_name — never invent labels. */
export function formatNallaDisplayName(rec, displayId) {
  const m = rec?.meta || {};
  const raw = String(m.name || m.nameEn || m.intName || rec?.name || "").trim();
  const id = displayId || rec?.displayId || "";
  if (raw && !/^unnamed/i.test(raw)) return id ? `${raw} (${id})` : raw;
  return id ? `Unnamed channel (${id})` : "Unnamed channel";
}

function snapOutletToBank(ordered, rec, stations) {
  const bank = rec.connection?.bankPoint;
  if (!bank || !ordered.length) return ordered;
  const last = ordered[ordered.length - 1];
  const gap = Math.hypot(last.x - bank.x, last.z - bank.z);
  const bankY = terrainHeightAt(bank.x, bank.z, stations);
  const y = Number.isFinite(bankY) ? bankY + Math.max(1.2, (rec.channelRadius || 2) + 0.4) : last.y;

  if (gap < 0.75) {
    last.x = bank.x;
    last.z = bank.z;
    last.y = y;
    last.under = 0;
    rec.distanceToRiverM = 0;
    return ordered;
  }
  if (gap > 220) return ordered;
  const out = ordered.slice();
  out.push({
    x: bank.x,
    z: bank.z,
    y,
    lon: last.lon,
    lat: last.lat,
    under: 0,
  });
  rec.distanceToRiverM = Math.round(gap * 10) / 10;
  if (rec.connectsToRiver || gap <= 65) rec.connectsToRiver = true;
  return out;
}

function enrichChainage(rec, chainagePts, ordered, dataset) {
  let meters = rec.nearestChainageMeters;
  const focus =
    rec.connection?.bankPoint ||
    rec.connection?.riverPoint ||
    ordered[ordered.length - 1] ||
    ordered[0];

  if (focus && chainagePts.length) {
    let best = null;
    let bestD = Infinity;
    for (const c of chainagePts) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      const d = Math.hypot(c.x - focus.x, c.z - focus.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best && Number.isFinite(best.meters)) {
      meters = best.meters;
    } else if (Number.isFinite(meters) && chainagePts.length) {
      let near = chainagePts[0];
      let nearD = Infinity;
      for (const c of chainagePts) {
        const d = Math.abs((c.meters ?? 0) - meters);
        if (d < nearD) {
          nearD = d;
          near = c;
        }
      }
      meters = near?.meters ?? meters;
    }
  }

  rec.nearestChainageMeters = Number.isFinite(meters) ? meters : null;
  rec.nearestChainageLabel =
    rec.nearestChainageMeters != null ? metersToStation(rec.nearestChainageMeters) : "—";

  if (rec.distanceToRiverM == null && rec.connection?.distanceToBank != null) {
    rec.distanceToRiverM = rec.connection.distanceToBank;
  } else if (rec.distanceToRiverM == null && rec.connection?.distance != null) {
    rec.distanceToRiverM = rec.connection.distance;
  }

  const end = ordered[ordered.length - 1];
  if (end) {
    if (Number.isFinite(end.lon) && Number.isFinite(end.lat)) {
      const fixed = validateLonLat(end.lon, end.lat);
      rec.outletLon = fixed?.lon ?? end.lon;
      rec.outletLat = fixed?.lat ?? end.lat;
    } else if (dataset?.frame?.toLonLat) {
      const ll = dataset.frame.toLonLat(end.x, end.z);
      const fixed = validateLonLat(ll.lon, ll.lat);
      rec.outletLon = fixed?.lon ?? ll.lon;
      rec.outletLat = fixed?.lat ?? ll.lat;
    }
  }
}

/** Channel radii from KML waterway / width when present. */
function channelRadius(rec) {
  const ww = String(rec.meta?.waterway || "").toLowerCase();
  const L = rec.lengthM || 100;
  const open = rec.openGroundShare ?? 1;
  const widthM = Number(rec.meta?.width);
  let r = 2.0;
  if (Number.isFinite(widthM) && widthM > 0) {
    r = THREE.MathUtils.clamp(widthM * 0.12, 1.4, 3.6);
  } else if (ww === "canal") r = 2.7;
  else if (ww === "drain") r = 2.4;
  else if (ww === "stream") r = 2.2;
  else if (ww === "ditch") r = 1.7;
  if (L > 900) r *= 1.12;
  else if (L > 450) r *= 1.06;
  if (rec.connectsToRiver) r *= 1.04;
  r *= 0.92 + open * 0.12;
  return Math.min(3.4, Math.max(1.4, r));
}
