/**
 * 3D Asset Markers for the Digital Twin Dashboard.
 *
 * Places billboard sprites above each landmark (asset) defined in
 * landmarks.json, with status-based colours + pulse animations.
 *
 * Usage:
 *   import { createAssetMarkers } from './assetMarkers.js';
 *   const markers = createAssetMarkers(scene, { getTerrainY });
 *   markers.update(assets);        // call from twin-state-change listener
 *   markers.setSelected(assetId);  // highlight one
 *   markers.dispose();             // cleanup
 *
 * Raycasting is handled via the exported `pickMarker(raycaster)` helper
 * so world.js can integrate it alongside its existing inspect pipeline.
 */

import * as THREE from "three";
import { lonLatToLocal } from "../geo/geoReference.js";
import { selectTwinAsset } from "../services/digitalTwinService.js";

// ─── Visual constants ─────────────────────────────────────────────────────────

const STATUS_COLORS = {
  ok: new THREE.Color(0x00e5b4),       // cyan-teal
  warn: new THREE.Color(0xffc300),     // amber
  critical: new THREE.Color(0xff3d57), // coral-red
  unknown: new THREE.Color(0x7a8ea4),  // slate
};

const SPRITE_SIZE = 28;       // world units
const HOVER_SCALE = 1.3;
const SELECTED_SCALE = 1.5;
const PULSE_SPEED = 2.2;      // rad/s

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * @param {THREE.Scene} scene
 * @param {{ getTerrainY?: (x:number,z:number) => number }} opts
 */
export function createAssetMarkers(scene, opts = {}) {
  const getTerrainY = opts.getTerrainY ?? (() => 0);

  /** @type {Map<string, MarkerEntry>} */
  const registry = new Map();
  let _selectedId = null;
  let _clock = 0;

  // Root group so all markers can be toggled easily
  const group = new THREE.Group();
  group.name = "asset-markers";
  // Diamonds clutter the river view — area-name banners carry locality identity.
  group.visible = false;
  scene.add(group);

  // ─── Texture builder ───────────────────────────────────────────────────────

  function makeTexture(color, shape = "diamond") {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cx = size / 2, cy = size / 2, r = size * 0.38;

    // Outer glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 1.2);
    const hex = "#" + color.getHexString();
    grad.addColorStop(0, hex + "cc");
    grad.addColorStop(1, hex + "00");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Core shape
    ctx.save();
    ctx.translate(cx, cy);
    if (shape === "diamond") {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-r * 0.58, -r * 0.58, r * 1.16, r * 1.16);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    }
    ctx.fillStyle = hex;
    ctx.shadowBlur = 16;
    ctx.shadowColor = hex;
    ctx.fill();
    ctx.restore();

    // White border ring
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 3;
    ctx.save();
    ctx.translate(cx, cy);
    if (shape === "diamond") {
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-r * 0.58, -r * 0.58, r * 1.16, r * 1.16);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  // Pre-build textures per status
  const textures = {};
  for (const [status, color] of Object.entries(STATUS_COLORS)) {
    textures[status] = makeTexture(color);
  }

  // ─── Marker builder ────────────────────────────────────────────────────────

  function buildMarker(asset) {
    const { id, lon, lat, name, status = "ok" } = asset;
    const local = lonLatToLocal(lon, lat, 0);
    const y = getTerrainY(local.x, local.z) + SPRITE_SIZE * 0.7;

    const mat = new THREE.SpriteMaterial({
      map: textures[status] ?? textures.ok,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(SPRITE_SIZE);
    sprite.position.set(local.x, y, local.z);
    sprite.name = `asset-marker::${id}`;
    sprite.userData = { assetId: id, assetName: name };

    group.add(sprite);
    registry.set(id, { sprite, mat, local, baseY: y, status, asset });
    return sprite;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Sync markers with the latest asset list from TwinState.
   * Creates new sprites, updates colours, removes stale ones.
   * @param {Array} assets
   */
  function update(assets) {
    if (!Array.isArray(assets)) return;

    const seen = new Set();
    for (const asset of assets) {
      const { id, status } = asset;
      seen.add(id);
      if (!registry.has(id)) {
        buildMarker(asset);
      }
      const entry = registry.get(id);
      if (!entry) continue;
      entry.asset = asset;
      if (entry.status !== status) {
        entry.status = status;
        entry.mat.map = textures[status] ?? textures.ok;
        entry.mat.needsUpdate = true;
      }
    }

    // Remove orphans
    for (const [id, entry] of registry) {
      if (!seen.has(id)) {
        group.remove(entry.sprite);
        entry.mat.dispose();
        registry.delete(id);
      }
    }
  }

  /**
   * Highlight a specific asset marker. Pass null to deselect.
   * @param {string|null} id
   */
  function setSelected(id) {
    _selectedId = id;
    for (const [eid, entry] of registry) {
      const isSelected = eid === id;
      const targetScale = isSelected ? SELECTED_SCALE * SPRITE_SIZE : SPRITE_SIZE;
      entry.sprite.scale.setScalar(targetScale);
      entry.mat.opacity = isSelected ? 1.0 : 0.75;
    }
  }

  /**
   * Animate markers — call from the scene render loop with delta seconds.
   * @param {number} dt  seconds since last frame
   */
  function tick(dt) {
    _clock += dt;
    for (const [id, entry] of registry) {
      const isSelected = id === _selectedId;
      const isCritical = entry.status === "critical";
      const isWarn = entry.status === "warn";

      // Pulse critical + warn markers
      if (isCritical || isWarn) {
        const speed = isCritical ? PULSE_SPEED * 1.6 : PULSE_SPEED;
        const pulse = 0.85 + 0.15 * Math.sin(_clock * speed);
        entry.sprite.scale.setScalar((isSelected ? SELECTED_SCALE : 1) * SPRITE_SIZE * pulse);
        entry.mat.opacity = 0.75 + 0.25 * pulse;
      } else {
        if (!isSelected) {
          entry.sprite.scale.setScalar(SPRITE_SIZE);
          entry.mat.opacity = 0.85;
        }
      }

      // Gentle bob
      const bob = Math.sin(_clock * 1.1 + registry.size * 0.3) * 1.8;
      entry.sprite.position.y = entry.baseY + bob;
    }
  }

  /**
   * Test a raycaster against all markers.
   * @param {THREE.Raycaster} raycaster
   * @returns {{ assetId: string, asset: object, sprite: THREE.Sprite } | null}
   */
  function pickMarker(raycaster) {
    const sprites = [...registry.values()].map((e) => e.sprite);
    const hits = raycaster.intersectObjects(sprites, false);
    if (!hits.length) return null;
    const sprite = hits[0].object;
    const { assetId } = sprite.userData;
    const entry = registry.get(assetId);
    if (!entry) return null;
    return { assetId, asset: entry.asset, sprite };
  }

  /**
   * Handle a canvas click — picks and selects.
   * @param {THREE.Raycaster} raycaster
   * @returns {boolean} true if an asset was hit
   */
  function handleClick(raycaster) {
    const hit = pickMarker(raycaster);
    if (hit) {
      selectTwinAsset(hit.assetId);
      return true;
    }
    return false;
  }

  /**
   * Show/hide the entire marker layer.
   * @param {boolean} visible
   */
  function setVisible(visible) {
    group.visible = visible;
  }

  /**
   * Dispose all GPU resources.
   */
  function dispose() {
    for (const entry of registry.values()) {
      entry.mat.dispose();
    }
    for (const tex of Object.values(textures)) {
      tex.dispose();
    }
    scene.remove(group);
    registry.clear();
  }

  return { update, setSelected, tick, pickMarker, handleClick, setVisible, dispose, group };
}
