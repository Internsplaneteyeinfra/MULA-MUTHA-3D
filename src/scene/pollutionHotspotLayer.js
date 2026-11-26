/**
 * Ranked Mula–Mutha pollution hotspot markers.
 * Positions come from public/data/mula_mutha/pollution_hotspots.json.
 */
import * as THREE from "three";
import { state } from "../state.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { metersToStation, nearestChainage } from "./chainageMarkers.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";
import {
  MAIN_BODCOD_EVENT,
  loadBodCodPixels,
  mainBodCodLabel,
  mainBodCodStatus,
  peakBodCodInBox,
} from "../services/bodCodPixelService.js";

export const POLLUTION_HOTSPOTS_URL = "/data/mula_mutha/pollution_hotspots.json";

export function createPollutionHotspotLayer(dataset = {}) {
  const group = new THREE.Group();
  group.name = "pollutionHotspotLayer";
  group.visible = false;
  group.renderOrder = 46;

  let data = null;
  const nodes = [];
  let loadPromise = null;
  let selectedId = null;
  const stations = dataset?.corridor?.stations || [];

  function clear() {
    for (const n of nodes) {
      n.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            m.map?.dispose?.();
            m.dispose?.();
          });
        }
      });
      group.remove(n);
    }
    nodes.length = 0;
  }

  function ring(inner, outer, color, opacity) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 64),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 47;
    return mesh;
  }

  function mg(v) {
    return Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "N/A";
  }

  function label(h) {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 250;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    const x = 16;
    const y = 10;
    const w = 608;
    const hgt = 176;
    const r = 18;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + hgt, r);
    ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
    ctx.arcTo(x, y + hgt, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = "rgba(7, 18, 26, 0.94)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#E53935";
    ctx.stroke();
    const tip = y + hgt;
    ctx.beginPath();
    ctx.moveTo(304, tip - 1);
    ctx.lineTo(336, tip - 1);
    ctx.lineTo(320, tip + 22);
    ctx.closePath();
    ctx.fillStyle = "rgba(7, 18, 26, 0.94)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(306, tip);
    ctx.lineTo(320, tip + 20);
    ctx.lineTo(334, tip);
    ctx.strokeStyle = "#E53935";
    ctx.stroke();
    const sev = String(h.severity || h.shadeLabel || "Hotspot");
    ctx.textAlign = "center";
    ctx.fillStyle = "#E53935";
    ctx.font = "700 28px Segoe UI, Arial, sans-serif";
    ctx.fillText(`#${h.rank}  ·  ${sev}`, 320, 58);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 40px Segoe UI, Arial, sans-serif";
    ctx.fillText(`CH ${h.chainageLabel || "N/A"}`, 320, 112);
    ctx.font = "600 24px Segoe UI, Arial, sans-serif";
    ctx.fillText(`BOD  ${mg(h.maxBod)} mg/L    |    COD  ${mg(h.maxCod)} mg/L`, 320, 158);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }));
    spr.scale.set(13.2, 13.2 * (250 / 640), 1);
    spr.center.set(0.5, 0);
    spr.position.y = 5.1;
    spr.visible = false;
    spr.renderOrder = 50;
    return spr;
  }

  function build(hotspots) {
    clear();
    const chain = dataset?.chainage || [];
    for (const h of hotspots || []) {
      let local;
      try { local = lonLatToLocal(h.lon, h.lat); } catch { continue; }
      if (!Number.isFinite(local?.x) || !Number.isFinite(local?.z)) continue;
      const near = nearestChainage(local.x, local.z, chain);
      if (near && Number.isFinite(near.meters)) {
        h.chainageMeters = near.meters;
        h.chainageLabel = near.label || metersToStation(near.meters);
        h.name = `CH ${h.chainageLabel}`;
      }
      const ground = terrainHeightAt(local.x, local.z, stations);
      const y = Math.max(SURFACE_Y, Number.isFinite(ground) ? ground : SURFACE_Y) + 0.55;
      const root = new THREE.Group();
      root.name = `pollutionHotspot_${h.rank}`;
      root.position.set(local.x, y, local.z);
      root.userData.hotspot = h;
      const outer = ring(5.6, 9.4, 0xffd600, 0.38);
      const mid = ring(2.5, 4.7, 0xe53935, 0.9);
      const edge = ring(9.05, 9.7, 0xffd600, 0.85);
      const pinMat = new THREE.MeshBasicMaterial({ color: 0xffd600 });
      const pin = new THREE.Mesh(new THREE.ConeGeometry(0.78, 3.1, 16), pinMat);
      pin.rotation.x = Math.PI;
      pin.position.y = 1.9;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), pinMat);
      head.position.y = 3.35;
      const card = label(h);
      root.userData.parts = { outer, mid, edge, pinMat, card };
      root.add(outer, mid, edge, pin, head, card);
      group.add(root);
      nodes.push(root);
    }
  }

  /**
   * Replace each cell's BOD/COD with the current JalNetra main BOD/COD (live → most recent →
   * saved): the highest pixel inside the hotspot's 0.008° cell, else the nearest pixel.
   * Rank/score stay as analysed offline; only the displayed mg/L values change.
   */
  const CELL_DEG = 0.008;
  function applyMainBodCod() {
    const list = data?.hotspots || [];
    const status = mainBodCodStatus();
    if (!list.length || status.source === "none") return false;
    const label = mainBodCodLabel(status);
    for (const h of list) {
      const [kLon, kLat] = String(h.id || "").split(":").map(Number);
      const box = Number.isFinite(kLon) && Number.isFinite(kLat)
        ? [kLon, kLat, kLon + CELL_DEG, kLat + CELL_DEG]
        : [h.lon - CELL_DEG / 2, h.lat - CELL_DEG / 2, h.lon + CELL_DEG / 2, h.lat + CELL_DEG / 2];
      const hit = peakBodCodInBox(...box);
      if (!hit) continue;
      if (h.savedMaxBod === undefined) {
        h.savedMaxBod = h.maxBod ?? null;
        h.savedMaxCod = h.maxCod ?? null;
      }
      h.maxBod = h.bod = +hit.bod.toFixed(2);
      h.maxCod = h.cod = +hit.cod.toFixed(2);
      h.bodCodSource = status.source;
      h.bodCodSourceLabel = hit.inCell ? label : `${label} · nearest pixel ${hit.distM} m`;
      h.observationDate = status.imageDate || "N/A";
    }
    if (data.availability) {
      data.availability.bodCod =
        status.source === "live" ? "LIVE" : status.source === "recent" ? "MOST RECENT" : "SAVED";
    }
    return true;
  }

  function refreshFromMainBodCod() {
    if (!applyMainBodCod()) return;
    const sel = selectedId;
    build(data.hotspots || []);
    if (sel) setSelected(sel);
    document.dispatchEvent(new CustomEvent("pollution-hotspots-updated", { detail: { data } }));
  }
  document.addEventListener(MAIN_BODCOD_EVENT, () => {
    if (data) refreshFromMainBodCod();
  });

  async function ensureLoaded() {
    if (data) return data;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const res = await fetch(POLLUTION_HOTSPOTS_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Pollution hotspots HTTP ${res.status}`);
      data = await res.json();
      // Most recent / saved values now; the live POST upgrades them via MAIN_BODCOD_EVENT.
      await loadBodCodPixels().catch(() => {});
      applyMainBodCod();
      build(data.hotspots || []);
      return data;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
    return loadPromise;
  }

  function setVisible(on) { group.visible = !!on; }

  function setSelected(idOrRank) {
    const match = nodes.find((n) => n.userData.hotspot?.id === idOrRank || n.userData.hotspot?.rank === idOrRank);
    selectedId = match?.userData.hotspot?.id ?? selectedId;
    for (const n of nodes) {
      const h = n.userData.hotspot;
      const on = !!(h && (h.id === idOrRank || h.rank === idOrRank));
      const parts = n.userData.parts;
      n.scale.setScalar(on ? 1 : 0.62);
      if (!parts) continue;
      const sev = new THREE.Color(h?.color || "#E53935");
      parts.outer.material.color.set(on ? 0xffd600 : sev);
      parts.outer.material.opacity = on ? 0.4 : 0.22;
      parts.mid.material.color.set(on ? 0xe53935 : sev);
      parts.mid.material.opacity = on ? 0.92 : 0.4;
      parts.edge.material.color.set(on ? 0xffd600 : sev);
      parts.edge.material.opacity = on ? 0.9 : 0.2;
      parts.pinMat.color.set(on ? 0xffd600 : sev);
      parts.card.visible = on;
    }
  }

  function focusHotspot(idOrRank, opts = {}) {
    const node = nodes.find((n) => n.userData.hotspot?.id === idOrRank || n.userData.hotspot?.rank === idOrRank);
    const h = node?.userData?.hotspot;
    if (!h || !node) return null;
    setSelected(h.id);
    const x = node.position.x;
    const z = node.position.z;
    const y = node.position.y;
    const toP = { x: x + 28, y: y + 32, z: z + 36 };
    const toL = { x, y, z };
    try {
      window.__MM_SCENE__?.startGarbageFlight?.(toP, toL, { dur: (opts.durMs ?? 900) / 1000, fov: 48 });
    } catch (err) {
      console.warn("[pollution-hotspot] camera", err?.message || err);
    }
    const meters = Number.isFinite(h.chainageMeters) ? h.chainageMeters : null;
    if (meters != null) {
      state.selectedChainageMeters = Math.round(meters / 10) * 10;
      document.dispatchEvent(new CustomEvent("chainage-select", {
        detail: { meters, focus: false, fromPollutionHotspot: true, label: h.chainageLabel, lon: h.lon, lat: h.lat },
      }));
    }
    document.dispatchEvent(new CustomEvent("pollution-hotspot-select", {
      detail: {
        id: h.id,
        rank: h.rank,
        name: h.name,
        lon: h.lon,
        lat: h.lat,
        meters,
        bod: Number.isFinite(h.maxBod) ? h.maxBod : null,
        cod: Number.isFinite(h.maxCod) ? h.maxCod : null,
        bodCodSource: h.bodCodSource || null,
        bodCodSourceLabel: h.bodCodSourceLabel || "",
        eutrophication: h.eutrophication || null,
        nitrogen: h.nitrogen || null,
        coliform: h.coliform || null,
        composite: h.composite,
        severity: h.severity || h.shadeLabel,
        color: h.color,
        contributingLayers: h.contributingLayers || h.layersPresent,
        provenance: h.provenance || [],
        observationDate: h.observationDate || null,
        dataQuality: h.dataQuality || null,
      },
    }));
    const paintStation = () => {
      const station = document.querySelector("#chainage-step-station");
      if (station && h.chainageLabel) station.textContent = h.chainageLabel;
    };
    paintStation();
    requestAnimationFrame(paintStation);
    return { hotspot: h, x, z };
  }

  group.userData = {
    ensureLoaded,
    setVisible,
    setSelected,
    focusHotspot,
    getData: () => data,
    getHotspots: () => data?.hotspots || [],
    clear,
  };
  return group;
}
