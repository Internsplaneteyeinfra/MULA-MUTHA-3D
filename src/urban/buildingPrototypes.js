import * as THREE from "three";
import { mergeMeshesForInstancing } from "./geometryMerge.js";

/**
 * Enriched procedural building kits (Pune/Indian urban typology).
 * Used as authoritative near-corridor geometry (GLB files may lag this kit).
 */
const DEFS = {
  "residential/house_01": { w: 10, d: 8, h: 7.2, roof: "flat", floors: 2, balconies: true, parapet: true, tank: true },
  "residential/house_02": { w: 9, d: 9, h: 6.8, roof: "hip", floors: 2, balconies: false, parapet: false, tank: false },
  "residential/house_03": { w: 12, d: 7, h: 8.4, roof: "gable", floors: 2, balconies: true, parapet: false, tank: true },
  "residential/row_house_01": { w: 18, d: 8, h: 9.2, roof: "flat", floors: 3, balconies: true, parapet: true, tank: false },
  "apartments/apartment_lowrise": { w: 18, d: 12, h: 14, roof: "flat", floors: 4, balconies: true, parapet: true, tank: true },
  "apartments/apartment_midrise": { w: 22, d: 14, h: 24, roof: "flat", floors: 7, balconies: true, parapet: true, tank: true },
  "apartments/apartment_highrise": { w: 20, d: 16, h: 42, roof: "flat", floors: 12, balconies: true, parapet: true, tank: true },
  "commercial/commercial_01": { w: 24, d: 16, h: 12, roof: "flat", floors: 3, balconies: false, parapet: true, shop: true, tank: false },
  "commercial/shop_block_01": { w: 20, d: 10, h: 8.5, roof: "flat", floors: 2, balconies: false, parapet: true, shop: true, tank: false },
  "industrial/warehouse_01": { w: 30, d: 18, h: 10, roof: "gable", floors: 1, balconies: false, parapet: false, warehouse: true, tank: false },
};

function mat(color, roughness = 0.88, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export function createProceduralPrototype(id, entry) {
  const def = DEFS[id] || {
    w: entry?.nativeW || 10,
    d: entry?.nativeD || 8,
    h: entry?.nativeH || 8,
    roof: "flat",
    floors: 2,
    balconies: false,
    parapet: true,
  };

  const root = new THREE.Group();
  const wallMat = mat("#cfc8bc", 0.86, 0.03);
  const roofMat = mat("#5a6068", 0.8, 0.08);
  const trimMat = mat("#a8a098", 0.9, 0.02);
  const glassMat = mat("#5a8898", 0.22, 0.35);
  const railMat = mat("#6a7078", 0.55, 0.25);
  const darkMat = mat("#4a5058", 0.75, 0.08);

  const floors = Math.max(1, def.floors || Math.round(def.h / 3.2));
  const floorH = def.h / (floors + (def.roof === "flat" ? 0.15 : 0.35));
  const bodyH = floors * floorH;
  const plinthH = 0.45;

  // Plinth / compound base
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(def.w * 1.04, plinthH, def.d * 1.04),
    darkMat,
  );
  plinth.position.y = plinthH / 2;
  root.add(plinth);

  // Main body
  const body = new THREE.Mesh(new THREE.BoxGeometry(def.w, bodyH, def.d), wallMat);
  body.position.y = plinthH + bodyH / 2;
  root.add(body);

  // Floor band ledges (apartments / mid+)
  if (floors >= 3) {
    for (let f = 1; f < floors; f++) {
      const ledge = new THREE.Mesh(
        new THREE.BoxGeometry(def.w * 1.015, 0.12, def.d * 1.015),
        trimMat,
      );
      ledge.position.y = plinthH + f * floorH;
      root.add(ledge);
    }
  }

  // Windows on front (+Z) and back (−Z)
  const cols = Math.max(2, Math.floor(def.w / (def.warehouse ? 5.5 : 3.2)));
  for (const face of [1, -1]) {
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        if (def.shop && f === 0 && face === 1) continue; // shop front separate
        const x = -def.w / 2 + (c + 0.5) * (def.w / cols);
        const y = plinthH + 0.95 + f * floorH;
        const ww = def.warehouse ? 1.6 : 1.05;
        const wh = def.warehouse ? 1.8 : 1.25;
        const win = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, 0.1), glassMat);
        win.position.set(x, y, face * (def.d / 2 + 0.06));
        root.add(win);

        // Frame
        const frame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.12, wh + 0.12, 0.06), trimMat);
        frame.position.set(x, y, face * (def.d / 2 + 0.03));
        root.add(frame);
      }
    }
  }

  // Side windows (sparser)
  const sideCols = Math.max(1, Math.floor(def.d / 4));
  for (const face of [1, -1]) {
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < sideCols; c++) {
        const z = -def.d / 2 + (c + 0.5) * (def.d / sideCols);
        const y = plinthH + 0.95 + f * floorH;
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.9), glassMat);
        win.position.set(face * (def.w / 2 + 0.05), y, z);
        root.add(win);
      }
    }
  }

  // Main entrance door on front facade (+Z), road-facing in placement pass
  {
    const doorW = 1.05 + (def.shop ? 0.15 : 0);
    const doorH = def.shop ? 2.35 : 2.1;
    const doorMat = mat("#5c4030", 0.78, 0.06);
    const frameMat = mat("#8a8078", 0.88, 0.02);
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.14), doorMat);
    door.position.set(0, plinthH + doorH * 0.5, def.d / 2 + 0.09);
    root.add(door);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.16, doorH + 0.12, 0.08), frameMat);
    frame.position.set(0, plinthH + doorH * 0.5, def.d / 2 + 0.04);
    root.add(frame);
    // Entrance steps
    const steps = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.5, 0.18, 0.55), trimMat);
    steps.position.set(0, plinthH + 0.09, def.d / 2 + 0.32);
    root.add(steps);
  }

  // Shop front glazing
  if (def.shop) {
    const shop = new THREE.Mesh(
      new THREE.BoxGeometry(def.w * 0.88, floorH * 0.72, 0.12),
      glassMat,
    );
    shop.position.set(0, plinthH + floorH * 0.45, def.d / 2 + 0.08);
    root.add(shop);
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(def.w * 0.92, 0.12, 1.1),
      darkMat,
    );
    awning.position.set(0, plinthH + floorH * 0.85, def.d / 2 + 0.55);
    root.add(awning);
  }

  // Balconies (residential / apartments)
  if (def.balconies) {
    for (let f = 1; f < floors; f++) {
      const balW = Math.min(def.w * 0.7, cols * 2.8);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(balW, 0.14, 1.15), trimMat);
      slab.position.set(0, plinthH + f * floorH + 0.05, def.d / 2 + 0.55);
      root.add(slab);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(balW, 0.85, 0.08), railMat);
      rail.position.set(0, plinthH + f * floorH + 0.55, def.d / 2 + 1.05);
      root.add(rail);
      for (const side of [-1, 1]) {
        const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 1.0), railMat);
        sideRail.position.set(side * balW * 0.48, plinthH + f * floorH + 0.55, def.d / 2 + 0.55);
        root.add(sideRail);
      }
    }
  }

  // Roof
  const roofBase = plinthH + bodyH;
  if (def.roof === "flat") {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(def.w * 1.02, 0.35, def.d * 1.02),
      roofMat,
    );
    roof.position.y = roofBase + 0.18;
    root.add(roof);
    if (def.parapet) {
      const ph = 0.75;
      const pw = 0.18;
      // Four parapet walls
      const front = new THREE.Mesh(new THREE.BoxGeometry(def.w * 1.04, ph, pw), trimMat);
      front.position.set(0, roofBase + ph * 0.5, def.d / 2 + 0.02);
      root.add(front);
      const back = front.clone();
      back.position.z = -def.d / 2 - 0.02;
      root.add(back);
      const left = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, def.d * 1.04), trimMat);
      left.position.set(-def.w / 2 - 0.02, roofBase + ph * 0.5, 0);
      root.add(left);
      const right = left.clone();
      right.position.x = def.w / 2 + 0.02;
      root.add(right);
    }
  } else if (def.roof === "hip") {
    const rh = Math.max(1.2, def.h - bodyH);
    const geo = new THREE.ConeGeometry(Math.max(def.w, def.d) * 0.72, rh, 4);
    geo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(geo, roofMat);
    roof.position.y = roofBase + rh * 0.5;
    root.add(roof);
  } else {
    // Gable
    const rh = Math.max(1.0, def.h * 0.28);
    const shape = new THREE.Shape();
    shape.moveTo(-def.w / 2, 0);
    shape.lineTo(def.w / 2, 0);
    shape.lineTo(0, rh);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: def.d * 1.02, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -def.d * 0.51);
    const roof = new THREE.Mesh(geo, roofMat);
    roof.position.y = roofBase;
    root.add(roof);
  }

  // Rooftop water tank (selective)
  if (def.tank) {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.6, 1.1, 8),
      mat("#7a8890", 0.45, 0.35),
    );
    tank.position.set(def.w * 0.22, roofBase + 1.0, -def.d * 0.18);
    root.add(tank);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.2), darkMat);
    stand.position.set(def.w * 0.22, roofBase + 0.35, -def.d * 0.18);
    root.add(stand);
  }

  // Stair bulkhead for apartments
  if (floors >= 4) {
    const bulk = new THREE.Mesh(
      new THREE.BoxGeometry(def.w * 0.22, 2.2, def.d * 0.28),
      trimMat,
    );
    bulk.position.set(-def.w * 0.28, roofBase + 1.1, def.d * 0.15);
    root.add(bulk);
  }

  const merged = mergeMeshesForInstancing(root);
  // Dispose temps
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
    }
  });

  return {
    id,
    url: entry?.url || "",
    geometry: merged.geometry,
    material: wallMat.clone(),
    nativeW: merged.nativeW || def.w,
    nativeD: merged.nativeD || def.d,
    nativeH: merged.nativeH || def.h + plinthH,
  };
}
