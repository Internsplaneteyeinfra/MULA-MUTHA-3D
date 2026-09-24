/**
 * Complete Mula–Mutha garbage / pollution visualization system.
 * Authoritative data: mula-mutha-garbage-locations.kml (bundled via Vite ?raw).
 */
import * as THREE from "three";
import { state } from "../../state.js";
import { SURFACE_Y } from "../river.js";
import garbageKmlRaw from "../../data/mula-mutha-garbage-locations.kml?raw";
import { loadGarbageKml } from "./garbageDataLoader.js";
import { processGarbageAgainstRiver, computeGarbageDensity } from "./garbageGeoProcessor.js";
import { createGarbageRenderer } from "./garbageRenderer.js";
import { createGarbageEffects } from "./garbageEffects.js";
import { resolveGarbageLOD } from "./garbageLOD.js";
import { computeGarbageCameraPose } from "./garbageCamera.js";
import { buildPollutionSides } from "./pollutionSides.js";

/**
 * @param {{ stations?: object[] }} [opts]
 */
export function createGarbageSystem({ stations = [] } = {}) {
  const root = new THREE.Group();
  root.name = "pollutionGarbage";
  root.visible = false;
  root.renderOrder = 40;

  const renderer = createGarbageRenderer();
  const effects = createGarbageEffects();
  root.add(renderer.root);
  root.add(effects.root);

  /** @type {object[]} */
  let records = [];
  /** @type {object|null} */
  let loadReport = null;
  /** @type {object|null} */
  let density = null;
  /** @type {ReturnType<typeof buildPollutionSides>} */
  let sides = [];
  let loaded = false;
  let loading = null;
  let selectedId = null;
  let time = 0;
  let labelsEnabled = false;

  /** Live positions for bobbing / tethered drift */
  const positions = new Map();

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  async function load(url) {
    if (loaded) return { ok: true, count: records.length, report: loadReport };
    if (loading) return loading;

    loading = (async () => {
      console.info("[GarbageSystem] KML URL:", url || "(bundled)");
      console.info("[GarbageSystem] KML loading (bundled authoritative src/data KML)");
      const { records: raw, report: parseReport } = await loadGarbageKml(url, {
        bundledText: garbageKmlRaw,
      });
      console.info("[GarbageSystem] KML loaded", parseReport);

      const geo = processGarbageAgainstRiver(raw, stations, state.floodRiseM || 0);
      records = geo.records;
      console.info(`[GarbageSystem] Geo processing complete: ${records.length}`);
      density = computeGarbageDensity(records);
      // Stamp density class onto each site so labels / filters can use it
      const levelById = new Map();
      for (const cell of density.cells) {
        for (const id of cell.ids || []) levelById.set(id, cell.level);
      }
      for (const r of records) {
        r.densityLevel = levelById.get(r.id) || "LOW";
        r.displayLabel = formatSiteName(r);
        r.chainageLabel = formatChainageLabel(r.riverChainageMeters);
      }
      sides = buildPollutionSides(records);
      renderer.build(records);
      console.info(`[GarbageRenderer] Markers created: ${records.length}`);
      renderer.setDensityCells(density.cells);
      effects.build(records);
      console.info(
        "[GarbageSystem] Sides:",
        sides.map((s) => `${s.name}=${s.count}`).join(", "),
      );

      for (const r of records) {
        positions.set(r.id, { x: r.homeX, y: r.baseY, z: r.homeZ, yaw: 0 });
      }

      loadReport = {
        ...parseReport,
        ...geo.report,
        densityCells: density.cells.length,
        densityQ1: density.q1,
        densityQ2: density.q2,
        source: "bundled:?raw",
      };

      console.info("[GarbageSystem] Records:", records.length);
      console.info(
        "[GarbageSystem] River-associated:",
        (geo.report.riverAssociated || 0) + (geo.report.nearRiver || 0),
      );
      console.info("[GarbageSystem] Sanity report:", loadReport);

      loaded = true;
      loading = null;
      return { ok: true, count: records.length, report: loadReport };
    })().catch((err) => {
      loading = null;
      console.error("[GarbageSystem] Initialization failed:", err);
      throw err;
    });

    return loading;
  }

  function setVisible(v) {
    root.visible = !!v;
    if (!v) {
      selectedId = null;
      renderer.setSelected(null);
      renderer.setLabelsEnabled(false);
      renderer.setClassFilter(null);
      renderer.setSideFilter?.(null);
      labelsEnabled = false;
    }
  }

  function setShowDensity(v) {
    renderer.setShowDensity(v);
  }

  function setLabelsEnabled(v) {
    labelsEnabled = !!v;
    renderer.setLabelsEnabled(labelsEnabled);
  }

  function setClassFilter(label) {
    renderer.setClassFilter(label);
    // Density classes → auto-show density overlay for L/M/H
    const s = String(label || "");
    if (/density/i.test(s)) renderer.setShowDensity(true);
  }

  function getKeyPoints({ nearMeters = null, limit = 8, densityLevel = null } = {}) {
    let list = records.slice();
    if (densityLevel) {
      const want = String(densityLevel).toUpperCase();
      list = list.filter((r) => String(r.densityLevel || "").toUpperCase() === want);
    }
    if (Number.isFinite(nearMeters)) {
      list.sort(
        (a, b) =>
          Math.abs((a.riverChainageMeters ?? 0) - nearMeters) -
          Math.abs((b.riverChainageMeters ?? 0) - nearMeters),
      );
    } else {
      list.sort((a, b) => (a.riverChainageMeters ?? 0) - (b.riverChainageMeters ?? 0));
    }
    return list.slice(0, Math.max(1, limit)).map((r) => ({
      id: r.id,
      name: r.displayLabel || formatSiteName(r),
      chainageLabel: r.chainageLabel || formatChainageLabel(r.riverChainageMeters),
      meters: r.riverChainageMeters ?? null,
      densityLevel: r.densityLevel || null,
      lon: r.lon,
      lat: r.lat,
      sideId: r.sideId || null,
      sideName: r.sideName || null,
    }));
  }

  function getSides() {
    // Rebuild so sort/order stays correct after hot reload
    sides = buildPollutionSides(records);
    return sides;
  }

  /**
   * Focus a corridor side (and optional site within that side).
   * Highlights only that side’s sites with labels so the tour covers all locations.
   */
  function focusSide(sideId, { siteIndex = 0 } = {}) {
    const list = getSides();
    const side = list.find((s) => s.id === sideId) || list[0];
    if (!side) return null;

    // Filter markers to this side so the view reads as one named cluster
    renderer.setSideFilter?.(side.id);
    setLabelsEnabled(true);

    const sites = side.sites || [];
    const idx = Math.max(0, Math.min(sites.length - 1, Number(siteIndex) || 0));
    const focus = sites[idx] || null;
    let rec = null;
    if (focus?.id) {
      rec = select(focus.id, { focusCamera: true });
    } else {
      // Empty side — still report anchor
      clearSelection();
    }

    return {
      side,
      siteIndex: idx,
      siteCount: sites.length,
      record: rec,
      meters: rec?.riverChainageMeters ?? focus?.meters ?? side.meters ?? null,
      id: rec?.id ?? focus?.id ?? null,
    };
  }

  function clearSideFilter() {
    renderer.setSideFilter?.(null);
  }

  function formatSiteName(r) {
    const raw = String(r?.name || "").trim();
    if (raw && !/^\d+$/.test(raw)) return raw;
    const n = raw || String(r?.sourceIndex != null ? r.sourceIndex + 1 : r?.id || "?");
    return `Site ${n}`;
  }

  function formatChainageLabel(m) {
    if (!Number.isFinite(Number(m))) return null;
    const v = Number(m);
    const km = Math.floor(v / 1000);
    const rem = Math.round(v % 1000);
    return `${km}+${String(rem).padStart(3, "0")}`;
  }

  function getSelected() {
    return records.find((r) => r.id === selectedId) || null;
  }

  function select(id, { focusCamera = false } = {}) {
    const rec = records.find((r) => r.id === id) || null;
    selectedId = rec?.id ?? null;
    renderer.setSelected(selectedId);
    if (rec) {
      console.info("[GarbageSystem] Selected:", {
        id: rec.id,
        name: rec.name,
        lon: rec.lon,
        lat: rec.lat,
        chainage: rec.riverChainageMeters,
        status: rec.associationStatus,
      });
    }
    if (focusCamera && rec) {
      focusGarbage(rec);
    }
    return rec;
  }

  function clearSelection() {
    selectedId = null;
    renderer.setSelected(null);
  }

  function focusGarbage(record) {
    if (!record) return;
    const pose = computeGarbageCameraPose(record, {
      isMap2D: !!window.__MM_SCENE__?.isMap2D?.(),
    });
    console.info("[GarbageSystem] Camera focus:", record.id, pose.toL);
    // Prefer dedicated garbage flight; fall back to drainage-style flight
    if (typeof window.__MM_SCENE__?.startGarbageFlight === "function") {
      window.__MM_SCENE__.startGarbageFlight(pose.toP, pose.toL, {
        durMs: pose.durMs,
        fov: pose.fov,
      });
    } else if (typeof window.__MM_SCENE__?.startDrainageFlight === "function") {
      window.__MM_SCENE__.startDrainageFlight(pose.toP, pose.toL, {
        durMs: pose.durMs,
        fov: pose.fov,
      });
    }
  }

  function pickAt(x, z, maxDist = 32) {
    if (!root.visible || !records.length) return null;
    const filter = renderer.getClassFilter?.();
    const side = renderer.getSideFilter?.();
    const r2 = maxDist * maxDist * 6;
    let best = null;
    let bestD = r2;
    for (const s of records) {
      if (side && String(s.sideId || "") !== side) continue;
      if (filter && filter !== "ALL") {
        if (String(s.densityLevel || "").toUpperCase() !== filter) continue;
      }
      const pos = positions.get(s.id) || s;
      const d = (pos.x - x) ** 2 + (pos.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return null;
    return toPickPayload(best, Math.sqrt(bestD));
  }

  function toPickPayload(best, distance) {
    const chainageLabel =
      best.riverChainageMeters != null
        ? formatChainage(best.riverChainageMeters)
        : null;
    return {
      ...best,
      hydrology: "pollution",
      class_label: "General waste",
      color: "#E89A1C",
      distance,
      chainageLabel,
      // Explicit flags for UI — omit fabricated fields
      displayName: best.displayLabel || best.name || null,
      displayType: best.category || null,
      visualType: "General waste",
      densityLevel: best.densityLevel || null,
    };
  }

  function formatChainage(m) {
    return formatChainageLabel(m) || "—";
  }

  function update(dt, camera) {
    if (!root.visible || !records.length) return;
    time += dt;

    const lod = resolveGarbageLOD(camera?.position?.y ?? 800);
    renderer.applyLOD(lod, camera, selectedId);

    // Get current flood state (consider API flood mode)
    const apiFloodActive = state.floodMode === "api";
    const floodRise = apiFloodActive ? 0 : (state.floodRiseM ?? 0);
    const currentWaterY = SURFACE_Y + Math.max(0, floodRise);

    for (const r of records) {
      const pos = positions.get(r.id);
      if (!pos) continue;

      let x = r.homeX;
      let z = r.homeZ;
      
      // Calculate base Y based on current flood state
      let baseY;
      if (r.onWater) {
        // Water garbage: float on current water surface
        baseY = currentWaterY + r.waterOffset;
      } else {
        // Non-water garbage: stay on terrain or above water if flooded
        baseY = Math.max(r.terrainHeight, currentWaterY) + r.waterOffset;
      }
      
      // Store updated baseY for reference
      r.baseY = baseY;
      
      let y = baseY;
      let yaw = pos.yaw || 0;

      if (!reduceMotion) {
        // Extremely slow bob
        y = baseY + Math.sin(time * 0.7 + r.phase) * (r.onWater ? 0.08 : 0.03);

        if (r.onWater && r.velocity > 0) {
          // Tethered downstream sway — stays near real KML location
          const sway = Math.sin(time * 0.12 + r.phase) * 0.55;
          x = r.homeX + r.flowDirection.x * sway;
          z = r.homeZ + r.flowDirection.z * sway;
          yaw += r.rotationSpeed * dt * 0.25;
        }
      }

      pos.x = x;
      pos.y = y;
      pos.z = z;
      pos.yaw = yaw;
      r.x = x;
      r.y = y;
      r.z = z;

      const entry = renderer.getEntry(r.id);
      if (entry?.marker) {
        entry.marker.position.set(r.homeX, y, r.homeZ);
      }
      if (entry?.beacon) {
        entry.beacon.position.set(r.homeX, y, r.homeZ);
      }
      if (entry?.debris) {
        entry.debris.position.set(x, y, z);
        entry.debris.rotation.y = yaw;
      }
    }

    effects.update(time, lod, selectedId, positions);
  }

  function dispose() {
    renderer.dispose();
    effects.dispose();
    records = [];
    positions.clear();
    loaded = false;
  }

  function getInfoPanel(record) {
    if (!record) return null;
    const rows = [];
    if (record.name) rows.push({ k: "Name", v: String(record.name) });
    if (record.sideName) rows.push({ k: "Side", v: String(record.sideName) });
    // Only show type when KML provided a category
    if (record.category) rows.push({ k: "Type", v: String(record.category) });
    else rows.push({ k: "Type", v: "General waste" });
    rows.push({
      k: "Location",
      v: `${Number(record.lat).toFixed(6)}° N, ${Number(record.lon).toFixed(6)}° E`,
    });
    if (record.riverChainageMeters != null) {
      rows.push({ k: "River Chainage", v: formatChainage(record.riverChainageMeters) });
      console.info("[GarbageSystem] Chainage:", formatChainage(record.riverChainageMeters));
    }
    if (record.distanceToRiver != null) {
      rows.push({ k: "Distance to River", v: `${record.distanceToRiver.toFixed(1)} m` });
    }
    rows.push({ k: "Status", v: record.associationStatus || "—" });
    if (record.description) rows.push({ k: "Description", v: record.description });
    if (record.date) rows.push({ k: "Date", v: String(record.date) });
    if (record.quantity != null) rows.push({ k: "Quantity", v: String(record.quantity) });
    return {
      title: record.displayLabel || "GARBAGE LOCATION",
      rows,
      record,
    };
  }

  root.userData = {
    load,
    setVisible,
    setShowDensity,
    getShowDensity: () => renderer.getShowDensity(),
    setLabelsEnabled,
    getLabelsEnabled: () => labelsEnabled,
    setClassFilter,
    getKeyPoints,
    getSides,
    focusSide,
    clearSideFilter,
    update,
    pickAt,
    select,
    clearSelection,
    getSelected,
    focusGarbage,
    getInfoPanel,
    dispose,
    isLoaded: () => loaded,
    getSites: () => records,
    getRecords: () => records,
    getCount: () => records.length,
    getReport: () => loadReport,
    getDensity: () => density,
  };

  return root;
}
