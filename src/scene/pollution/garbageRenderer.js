/**
 * Garbage visuals — proposed style:
 * far = compact amber dots · near/selected = glowing stem + orb + dark site label
 * + readable waste pile (bottles / bags / foam / crates).
 */
import * as THREE from "three";
import { LOD, markerScaleForCamera } from "./garbageLOD.js";

const AMBER = "#E89A1C";
const AMBER_LIGHT = "#FFE08A";
const AMBER_HOT = "#FFB347";
const DEBRIS = "#8B7355";
const PLASTIC = "#C4D4E0";
const FOAM = "#F2EDE4";
const STEM_H = 0.9; // Much shorter stem: 0.9m height

export function createGarbageRenderer() {
  const root = new THREE.Group();
  root.name = "garbageRenderer";
  root.frustumCulled = false;

  const markers = new THREE.Group();
  markers.name = "garbageMarkers";
  const debris = new THREE.Group();
  debris.name = "garbageDebris";
  const densityGroup = new THREE.Group();
  densityGroup.name = "garbageDensity";
  densityGroup.visible = false;
  root.add(markers, debris, densityGroup);

  // Very small ground indicator (far / overview dots)
  const discGeo = new THREE.CircleGeometry(0.4, 12); // Much smaller: 0.4m radius
  discGeo.rotateX(-Math.PI / 2);
  const rimGeo = new THREE.RingGeometry(0.35, 0.55, 16); // Much smaller
  rimGeo.rotateX(-Math.PI / 2);
  const coreGeo = new THREE.CircleGeometry(0.15, 8); // Much smaller
  coreGeo.rotateX(-Math.PI / 2);

  // Very small site marker: tiny sphere + short thin stem
  const stemGeo = new THREE.CylinderGeometry(0.008, 0.012, 0.9, 6); // Thin, short: 0.9m height
  const orbGeo = new THREE.SphereGeometry(0.08, 12, 8); // Tiny sphere: 0.08m radius
  const orbHaloGeo = new THREE.SphereGeometry(0.14, 8, 6); // Small halo
  const glowDiscGeo = new THREE.CircleGeometry(0.35, 16); // Small ripple: 0.35m radius
  glowDiscGeo.rotateX(-Math.PI / 2);

  const fillMat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.62,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: AMBER_LIGHT,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: "#fff6d8",
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const selectMat = new THREE.MeshBasicMaterial({
    color: "#FF6B2C",
    transparent: true,
    opacity: 0.78,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Realistic small debris geometries
  const boxGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0); // Base unit cube, will be scaled down
  const bagGeo = new THREE.SphereGeometry(1.0, 8, 6); // Base unit sphere, will be deformed
  // Improved bottle geometry with neck
  const bottleBodyGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.85, 8); // Bottle body
  const bottleNeckGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.3, 6); // Bottle neck
  const bottleCapGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6); // Small cap
  // Paper/newspaper geometry (irregular plane)
  const paperGeo = new THREE.PlaneGeometry(1.0, 1.0, 1, 1); // Will be deformed
  const foamGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0); // Base unit cube
  const crateGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0); // Base unit cube

  const debrisMat = new THREE.MeshStandardMaterial({
    color: DEBRIS,
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
  });
  const plasticMat = new THREE.MeshStandardMaterial({
    color: PLASTIC,
    roughness: 0.42,
    metalness: 0.12,
    flatShading: true,
  });
  const bagMat = new THREE.MeshStandardMaterial({
    color: "#4f6a48",
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  });
  const foamMat = new THREE.MeshStandardMaterial({
    color: FOAM,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: "#D4A76A", // Light brown for wrappers/paper, NOT bright orange
    roughness: 0.7,
    metalness: 0.05,
    flatShading: true,
  });
  
  const wrapperMat = new THREE.MeshStandardMaterial({
    color: "#E8D4B0", // Light beige for wrappers
    roughness: 0.6,
    metalness: 0.1,
    flatShading: true,
  });
  
  // Paper materials
  const paperWhiteMat = new THREE.MeshStandardMaterial({
    color: "#F5F0E6", // Dirty white paper
    roughness: 0.75,
    metalness: 0.02,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  
  const paperBeigeMat = new THREE.MeshStandardMaterial({
    color: "#E8D8C0", // Beige/yellowed paper
    roughness: 0.7,
    metalness: 0.03,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  
  const paperNewspaperMat = new THREE.MeshStandardMaterial({
    color: "#E0D0B0", // Newspaper color
    roughness: 0.8,
    metalness: 0.01,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  
  // Cardboard material
  const cardboardMat = new THREE.MeshStandardMaterial({
    color: "#A09070", // Brown cardboard
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true,
  });
  
  // Additional plastic colors for bottles
  const plasticBlueMat = new THREE.MeshStandardMaterial({
    color: "#B0C8E0", // Pale blue plastic
    roughness: 0.45,
    metalness: 0.1,
    flatShading: true,
  });
  
  const plasticGreenMat = new THREE.MeshStandardMaterial({
    color: "#A0C0A0", // Pale green plastic
    roughness: 0.4,
    metalness: 0.08,
    flatShading: true,
  });
  
  const plasticGrayMat = new THREE.MeshStandardMaterial({
    color: "#C0C0C0", // Gray plastic
    roughness: 0.5,
    metalness: 0.12,
    flatShading: true,
  });

  const stemMat = new THREE.MeshBasicMaterial({
    color: AMBER_HOT,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const orbMat = new THREE.MeshBasicMaterial({
    color: AMBER_LIGHT,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
  });
  const orbHaloMat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.28,
    depthTest: false,
    depthWrite: false,
  });
  const glowDiscMat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /** @type {{ record:object, marker:THREE.Group, debris:THREE.Group|null, beacon:THREE.Group|null, baseY:number, fill?:THREE.Mesh, label?:THREE.Sprite }[]} */
  let entries = [];
  let selectedId = null;
  let showDensity = false;
  let labelsEnabled = false;
  /** @type {null | 'LOW' | 'MEDIUM' | 'HIGH' | 'ALL'} */
  let classFilter = null;
  /** @type {string|null} */
  let sideFilter = null;

  function sitePassesFilter(e) {
    if (sideFilter && String(e.record.sideId || "") !== sideFilter) return false;
    if (!classFilter || classFilter === "ALL") return true;
    return String(e.record.densityLevel || "").toUpperCase() === classFilter;
  }

  function syncVisibility() {
    for (const e of entries) {
      const pass = sitePassesFilter(e);
      e.marker.userData.filteredOut = !pass;
      if (!pass) {
        e.marker.visible = false;
        if (e.debris) e.debris.visible = false;
        if (e.beacon) e.beacon.visible = false;
        if (e.label) e.label.visible = false;
      }
    }
    for (const child of densityGroup.children) {
      const level = String(child.userData?.level || "").toUpperCase();
      child.visible = !classFilter || classFilter === "ALL" || level === classFilter;
    }
  }

  function setLabelsEnabled(v) {
    labelsEnabled = !!v;
  }

  function setClassFilter(level) {
    const raw = String(level || "").toUpperCase();
    if (!raw || raw === "ALL" || raw.includes("GARBAGE")) classFilter = "ALL";
    else if (raw.includes("HIGH")) classFilter = "HIGH";
    else if (raw.includes("MED")) classFilter = "MEDIUM";
    else if (raw.includes("LOW")) classFilter = "LOW";
    else classFilter = "ALL";
    syncVisibility();
  }

  function setSideFilter(sideId) {
    sideFilter = sideId ? String(sideId) : null;
    syncVisibility();
  }

  function build(records) {
    clear();
    entries = [];

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const marker = new THREE.Group();
      marker.name = `garbageMarker_${r.id}`;
      marker.userData.recordId = r.id;
      marker.frustumCulled = false;
      marker.renderOrder = 42;

      const fill = new THREE.Mesh(discGeo, fillMat);
      fill.position.y = 0.02; // Lower
      fill.renderOrder = 43;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = 0.015; // Lower
      rim.renderOrder = 42;
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 0.03; // Lower
      core.renderOrder = 44;
      marker.add(rim, fill, core);

      const title = siteDisplayName(r);
      const ch = siteChainageLabel(r);
      const label = makeSiteLabel(title, ch);
      label.position.set(0, STEM_H + 0.8, 0); // Much closer to marker
      label.visible = false;
      marker.add(label);

      marker.position.set(r.homeX, r.baseY, r.homeZ);
      markers.add(marker);

      const debrisG = buildDebrisCluster(r);
      debrisG.visible = true;
      debrisG.position.set(r.homeX, r.baseY, r.homeZ);
      debris.add(debrisG);

      const beacon = buildBeacon();
      beacon.visible = false;
      beacon.position.set(r.homeX, r.baseY, r.homeZ);
      markers.add(beacon);

      entries.push({
        record: r,
        marker,
        debris: debrisG,
        beacon,
        baseY: r.baseY,
        fill,
        label,
      });
    }
  }

  /** Medium-sized scattered river debris - clearly visible pollution */
  function buildDebrisCluster(r) {
    const g = new THREE.Group();
    g.name = `garbageDebris_${r.id}`;
    g.userData.recordId = r.id;
    
    // Determine number of debris items based on density level
    // LOW: 4-7 objects, MEDIUM: 8-14 objects, HIGH: 15-24 objects
    let minCount = 4, maxCount = 7; // LOW density
    if (r.densityLevel === "MEDIUM") { minCount = 8; maxCount = 14; }
    if (r.densityLevel === "HIGH") { minCount = 15; maxCount = 24; }
    
    // Add deterministic variation based on site ID
    const seed = r.sourceIndex * 137;
    const n = minCount + Math.floor((seed % 100) * 0.01 * (maxCount - minCount + 1));
    
    // Create medium-sized, clearly visible debris objects
    for (let k = 0; k < n; k++) {
      const kind = (k + r.sourceIndex) % 10; // 10 different debris types (expanded from 8)
      let mesh;
      const itemSeed = r.sourceIndex * 1000 + k * 37;
      
      // Base scale multiplier for all objects (1.5-2.0x increase)
      const sizeMultiplier = 1.7 + (itemSeed % 100) * 0.003; // 1.7-2.0
      
      if (kind === 0) {
        // Plastic bottle (realistic assembly) - increased visibility
        const bottle = new THREE.Group();
        const body = new THREE.Mesh(bottleBodyGeo, plasticBlueMat);
        const neck = new THREE.Mesh(bottleNeckGeo, plasticGrayMat);
        neck.position.y = 0.75; // Bottle neck height
        const cap = new THREE.Mesh(bottleCapGeo, accentMat);
        cap.position.y = 1.05; // Cap above neck
        bottle.add(body, neck, cap);
        mesh = bottle;
        const bottleScale = (0.25 + (itemSeed % 100) * 0.002) * sizeMultiplier; // 0.25-0.45m
        mesh.scale.setScalar(bottleScale);
      } else if (kind === 1) {
        // Plastic bag (medium, flattened)
        mesh = new THREE.Mesh(bagGeo, bagMat);
        mesh.scale.set(
          (0.35 + (itemSeed % 100) * 0.003) * sizeMultiplier,  // Width: 0.35-0.65
          (0.18 + (itemSeed % 50) * 0.002) * sizeMultiplier,   // Height: 0.18-0.28
          (0.30 + (itemSeed % 100) * 0.0025) * sizeMultiplier  // Depth: 0.30-0.55
        );
      } else if (kind === 2) {
        // Small wrapper/packaging (thin, medium)
        mesh = new THREE.Mesh(boxGeo, wrapperMat);
        mesh.scale.set(
          (0.18 + (itemSeed % 100) * 0.002) * sizeMultiplier,  // Width: 0.18-0.38
          (0.08 + (itemSeed % 50) * 0.001) * sizeMultiplier,   // Height: 0.08-0.13
          (0.22 + (itemSeed % 100) * 0.0015) * sizeMultiplier  // Depth: 0.22-0.37
        );
      } else if (kind === 3) {
        // Paper debris (crumpled, irregular) - NEW
        mesh = new THREE.Mesh(paperGeo, paperWhiteMat);
        // Apply deformation to create irregular shape
        const positionAttr = mesh.geometry.attributes.position;
        const vertexCount = positionAttr.count;
        for (let v = 0; v < vertexCount; v++) {
          const x = positionAttr.getX(v);
          const y = positionAttr.getY(v);
          const z = positionAttr.getZ(v);
          
          // Random noise for crumpled paper effect
          const noiseX = Math.sin(x * 4.5 + itemSeed) * 0.1;
          const noiseY = Math.cos(y * 3.2 + itemSeed * 0.5) * 0.15;
          const noiseZ = Math.sin(z * 5.1 + itemSeed * 0.3) * 0.08;
          
          positionAttr.setX(v, x + noiseX);
          positionAttr.setY(v, y + noiseY);
          positionAttr.setZ(v, z + noiseZ);
        }
        positionAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        
        mesh.scale.set(
          (0.20 + (itemSeed % 100) * 0.0025) * sizeMultiplier,  // Width: 0.20-0.45
          (0.02 + (itemSeed % 30) * 0.0005) * sizeMultiplier,   // Height: 0.02-0.035
          (0.25 + (itemSeed % 100) * 0.002) * sizeMultiplier    // Depth: 0.25-0.45
        );
      } else if (kind === 4) {
        // Newspaper debris (yellowed, with subtle print marks) - NEW
        mesh = new THREE.Mesh(paperGeo, paperNewspaperMat);
        // Add some subtle text-like markings
        const positionAttr = mesh.geometry.attributes.position;
        const vertexCount = positionAttr.count;
        for (let v = 0; v < vertexCount; v++) {
          const x = positionAttr.getX(v);
          const y = positionAttr.getY(v);
          const z = positionAttr.getZ(v);
          
          // Create subtle linear pattern that looks like text lines
          const linePattern = Math.sin(x * 8 + z * 4) * 0.04;
          const crumple = Math.sin(x * 3.5 + z * 2.7 + itemSeed) * 0.06;
          
          positionAttr.setY(v, y + linePattern + crumple);
        }
        positionAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        
        mesh.scale.set(
          (0.25 + (itemSeed % 100) * 0.003) * sizeMultiplier,  // Width: 0.25-0.55
          (0.03 + (itemSeed % 30) * 0.0007) * sizeMultiplier,  // Height: 0.03-0.05
          (0.30 + (itemSeed % 100) * 0.0025) * sizeMultiplier  // Depth: 0.30-0.55
        );
      } else if (kind === 5) {
        // Cardboard/paperboard (thicker) - NEW
        mesh = new THREE.Mesh(boxGeo, cardboardMat);
        mesh.scale.set(
          (0.18 + (itemSeed % 100) * 0.002) * sizeMultiplier,  // Width: 0.18-0.38
          (0.12 + (itemSeed % 50) * 0.0015) * sizeMultiplier,  // Height: 0.12-0.195
          (0.22 + (itemSeed % 100) * 0.0018) * sizeMultiplier  // Depth: 0.22-0.40
        );
      } else if (kind === 6) {
        // Branch/twig (medium cylinder)
        mesh = new THREE.Mesh(bottleBodyGeo, debrisMat);
        mesh.scale.set(
          (0.10 + (itemSeed % 50) * 0.0012) * sizeMultiplier,   // Radius: 0.10-0.16
          (0.50 + (itemSeed % 100) * 0.006) * sizeMultiplier,   // Length: 0.50-1.10
          (0.10 + (itemSeed % 50) * 0.0012) * sizeMultiplier    // Radius: 0.10-0.16
        );
      } else if (kind === 7) {
        // Floating vegetation (medium)
        mesh = new THREE.Mesh(bagGeo, bagMat);
        mesh.material = new THREE.MeshStandardMaterial({
          color: "#2a4c2a", // Dark muted green
          roughness: 0.9,
          metalness: 0.03,
          flatShading: true,
        });
        mesh.scale.setScalar((0.30 + (itemSeed % 100) * 0.003) * sizeMultiplier); // 0.30-0.60
      } else if (kind === 8) {
        // Construction debris fragment (medium)
        mesh = new THREE.Mesh(boxGeo, debrisMat);
        mesh.scale.setScalar((0.22 + (itemSeed % 100) * 0.002) * sizeMultiplier); // 0.22-0.42
      } else {
        // Mixed municipal debris (medium) - plastic container
        mesh = new THREE.Mesh(foamGeo, foamMat);
        mesh.scale.setScalar((0.25 + (itemSeed % 100) * 0.0025) * sizeMultiplier); // 0.25-0.50
      }

      // Natural scattering - irregular organic patch, NOT circular
      // Create irregular pollution patch shape
      const patchSeedX = (itemSeed * 1.237) % 1;
      const patchSeedZ = (itemSeed * 0.873) % 1;
      
      // Density-based patch size: LOW: 2-4m, MEDIUM: 4-7m, HIGH: 6-10m
      let patchRadius = 2.0;
      if (r.densityLevel === "MEDIUM") patchRadius = 3.5;
      if (r.densityLevel === "HIGH") patchRadius = 5.0;
      
      // Create irregular organic distribution (not circular)
      // Use noise-like pattern for more natural scattering
      const noiseX = Math.sin(patchSeedX * 3.14) * Math.cos(patchSeedZ * 2.18);
      const noiseZ = Math.cos(patchSeedX * 2.47) * Math.sin(patchSeedZ * 3.05);
      
      const offsetX = noiseX * patchRadius * (0.7 + patchSeedZ * 0.6);
      const offsetZ = noiseZ * patchRadius * (0.7 + patchSeedX * 0.6);
      
      // Some objects closer, some farther for natural look
      const distanceFactor = 0.6 + patchSeedX * 0.8;
      const finalOffsetX = offsetX * distanceFactor;
      const finalOffsetZ = offsetZ * distanceFactor;
      
      // Height variation for floating debris
      const heightOffset = 0.18 + (patchSeedX * 0.15); // 0.18-0.33 (slightly higher for visibility)
      
      mesh.position.set(
        finalOffsetX,
        heightOffset,
        finalOffsetZ
      );
      
      // Natural rotation - varied (bottles mostly horizontal/diagonal)
      const rotationScale = 0.8 + (itemSeed % 100) * 0.004; // 0.8-1.2 scale variation
      
      // Special rotation for bottles (more horizontal/angled)
      if (kind === 0) {
        // Bottles: mostly horizontal with slight tilt
        const bottleTilt = (itemSeed * 0.015) % 0.45; // 0-0.45 radians tilt
        mesh.rotation.set(
          bottleTilt,  // Tilt forward/backward
          (itemSeed * 0.06) % (Math.PI * 2),  // Random Y rotation
          (itemSeed * 0.01) % 0.15  // Small Z tilt
        );
      } else if (kind === 3 || kind === 4 || kind === 5) {
        // Paper/newspaper: mostly flat with some tilt
        mesh.rotation.set(
          Math.PI/2 + ((itemSeed * 0.008) % 0.3),  // Mostly flat (π/2) with small variation
          (itemSeed * 0.06) % (Math.PI * 2),      // Random Y rotation
          (itemSeed * 0.01) % 0.25                // Small Z tilt
        );
      } else {
        // Other debris: varied rotations
        mesh.rotation.set(
          (itemSeed * 0.012) % 0.35 * rotationScale,  // Tilt X
          (itemSeed * 0.06) % (Math.PI * 2),          // Random Y rotation
          (itemSeed * 0.018) % 0.28 * rotationScale   // Tilt Z
        );
      }
      
      mesh.traverse?.((c) => {
        if (c.isMesh) c.castShadow = false;
      });
      if (mesh.isMesh) mesh.castShadow = false;
      g.add(mesh);
    }

    // Moderate overall scale based on density
    const densityScale = r.densityLevel === "HIGH" ? 1.0 : r.densityLevel === "MEDIUM" ? 0.9 : 0.8;
    g.scale.setScalar(densityScale);
    
    return g;
  }

  /** Glowing stem + orb (proposed marker, not triangular flag). */
  function buildBeacon() {
    const g = new THREE.Group();
    g.name = "garbageBeacon";

    const glow = new THREE.Mesh(glowDiscGeo, glowDiscMat);
    glow.position.y = 0.02; // Very low
    glow.renderOrder = 48;

    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = STEM_H * 0.5;
    stem.renderOrder = 50;

    const halo = new THREE.Mesh(orbHaloGeo, orbHaloMat);
    halo.position.y = STEM_H;
    halo.renderOrder = 51;

    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = STEM_H;
    orb.renderOrder = 52;

    g.add(glow, stem, halo, orb);
    return g;
  }

  function setDensityCells(cells) {
    while (densityGroup.children.length) {
      const c = densityGroup.children.pop();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    if (!cells?.length) return;
    const geo = new THREE.CircleGeometry(28, 20);
    geo.rotateX(-Math.PI / 2);
    for (const cell of cells) {
      const color =
        cell.level === "HIGH" ? "#C0392B" : cell.level === "MEDIUM" ? "#E67E22" : "#27AE60";
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16 + Math.min(0.28, cell.count * 0.04),
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cell.x, SURFACE_APPROX, cell.z);
      m.renderOrder = 12;
      m.userData.level = cell.level;
      densityGroup.add(m);
    }
    syncVisibility();
  }

  const SURFACE_APPROX = 9.55;

  function setShowDensity(v) {
    showDensity = !!v;
    densityGroup.visible = showDensity;
  }

  function setSelected(id) {
    selectedId = id;
    for (const e of entries) {
      const on = e.record.id === id;
      if (e.fill) e.fill.material = on ? selectMat : fillMat;
      if (e.beacon) e.beacon.visible = on && !e.marker.userData.filteredOut;
      if (e.label) {
        const title = siteDisplayName(e.record);
        const ch = siteChainageLabel(e.record);
        paintSiteLabel(e.label, title, ch);
      }
    }
  }

  function applyLOD(lod, camera, selected = selectedId) {
    const boost = markerScaleForCamera(camera);
    const camY = camera?.position?.y ?? 800;
    const far = lod === LOD.FAR;
    const medium = lod === LOD.MEDIUM;

    for (const e of entries) {
      if (e.marker.userData.filteredOut) {
        e.marker.visible = false;
        if (e.debris) e.debris.visible = false;
        if (e.beacon) e.beacon.visible = false;
        if (e.label) e.label.visible = false;
        continue;
      }

      const isSel = e.record.id === selected;
      e.marker.visible = true;
      // Far overview: small dots; selected slightly larger
      const ringScale = boost * (isSel ? 0.9 : far ? 0.6 : 0.8);
      e.marker.scale.set(ringScale, ringScale, ringScale);

      if (e.debris) {
        // Show debris at MEDIUM and closer distances for better visibility
        const showPile = isSel || (!far && (medium || lod === LOD.NEAR || lod === LOD.VERY_NEAR));
        e.debris.visible = showPile;
        // Enhanced LOD scaling for better visibility: far: 0.9, medium: 1.0, near: 1.05-1.1, selected: 1.15 max
        let scale = 1.0;
        if (far) scale = 0.9;          // Increased from 0.85
        else if (medium) scale = 1.0;  // Keep at 1.0
        else if (lod === LOD.NEAR) scale = 1.05; // Increased
        else if (lod === LOD.VERY_NEAR) scale = 1.1; // Increased
        if (isSel) scale *= 1.15; // Selected: 15% larger max (from 10%)
        e.debris.scale.setScalar(scale);
      }

      if (e.beacon) {
        e.beacon.visible = isSel;
        e.beacon.scale.setScalar(isSel ? 1.05 : 1);
      }

      if (e.label) {
        // Selected always shows proposed dark label; optional labelsEnabled for all
        e.label.visible = isSel || (labelsEnabled && !far);
        const ls = THREE.MathUtils.clamp(camY * 0.008, 4, 12); // Smaller label scale
        e.label.scale.set(ls * 1.2, ls * 0.35, 1); // Smaller label
        e.label.position.y = STEM_H + 0.6 + Math.min(4, camY * 0.004); // Closer to marker
      }
    }
  }

  function getEntry(id) {
    return entries.find((e) => e.record.id === id) || null;
  }

  function getEntries() {
    return entries;
  }

  function clear() {
    for (const e of entries) {
      disposeLabel(e.label);
    }
    while (markers.children.length) markers.remove(markers.children[0]);
    while (debris.children.length) debris.remove(debris.children[0]);
    entries = [];
  }

  function dispose() {
    clear();
    while (densityGroup.children.length) {
      const c = densityGroup.children.pop();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    for (const g of [
      discGeo,
      rimGeo,
      coreGeo,
      stemGeo,
      orbGeo,
      orbHaloGeo,
      glowDiscGeo,
      boxGeo,
      bagGeo,
      bottleBodyGeo,
      bottleNeckGeo,
      bottleCapGeo,
      paperGeo,
      foamGeo,
      crateGeo,
    ]) {
      g.dispose();
    }
    for (const m of [
      fillMat,
      rimMat,
      coreMat,
      selectMat,
      debrisMat,
      plasticMat,
      bagMat,
      foamMat,
      accentMat,
      wrapperMat,
      paperWhiteMat,
      paperBeigeMat,
      paperNewspaperMat,
      cardboardMat,
      plasticBlueMat,
      plasticGreenMat,
      plasticGrayMat,
      stemMat,
      orbMat,
      orbHaloMat,
      glowDiscMat,
    ]) {
      m.dispose();
    }
  }

  return {
    root,
    build,
    setDensityCells,
    setShowDensity,
    getShowDensity: () => showDensity,
    setLabelsEnabled,
    getLabelsEnabled: () => labelsEnabled,
    setClassFilter,
    getClassFilter: () => classFilter,
    setSideFilter,
    getSideFilter: () => sideFilter,
    setSelected,
    applyLOD,
    getEntry,
    getEntries,
    dispose,
  };
}

function siteDisplayName(r) {
  const raw = String(r?.name || "").trim();
  if (raw && !/^\d+$/.test(raw)) return raw;
  const n = raw || String(r?.sourceIndex != null ? r.sourceIndex + 1 : r?.id || "?");
  return `Site ${n}`;
}

function siteChainageLabel(r) {
  const m = Number(r?.riverChainageMeters ?? r?.nearestChainageMeters);
  if (!Number.isFinite(m)) return "";
  const km = Math.floor(m / 1000);
  const rem = Math.round(m % 1000);
  return `CH ${km}+${String(rem).padStart(3, "0")}`;
}

function makeSiteLabel(title, subtitle) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 140;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const sprMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const spr = new THREE.Sprite(sprMat);
  spr.userData.canvas = canvas;
  spr.renderOrder = 55;
  spr.frustumCulled = false;
  spr.center.set(0.5, 0);
  paintSiteLabel(spr, title, subtitle);
  spr.scale.set(36, 8, 1);
  return spr;
}

function paintSiteLabel(spr, title, subtitle) {
  const canvas = spr.userData.canvas || spr.material.map?.image;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const line = subtitle ? `${title}, ${subtitle}` : String(title || "Site");
  ctx.font = "800 44px Inter, system-ui, sans-serif";
  const tw = Math.min(w - 48, ctx.measureText(line).width + 48);
  const bx = (w - tw) / 2;
  const by = h * 0.22;
  const bh = h * 0.56;

  roundRect(ctx, bx, by, tw, bh, 18);
  ctx.fillStyle = "rgba(6, 10, 16, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(232, 154, 28, 0.55)";
  ctx.lineWidth = 3;
  roundRect(ctx, bx, by, tw, bh, 18);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = "#fff8ec";
  ctx.fillText(line.slice(0, 36), w / 2, by + bh * 0.52);
  ctx.shadowBlur = 0;
  spr.material.map.needsUpdate = true;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function disposeLabel(label) {
  if (!label) return;
  label.material?.map?.dispose?.();
  label.material?.dispose?.();
}
