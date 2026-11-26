import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const outDir = path.resolve("scratch/screenshots/floodplain-water-rendering");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(150000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5185/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__MM_SCENE__?.floodLayer && window.__MM_SCENE__?.dataset?.corridor?.stations?.length);

const pose = await page.evaluate(() => {
  const stations = window.__MM_SCENE__.dataset.corridor.stations;
  let best = stations[Math.floor(stations.length / 2)];
  let bd = Infinity;
  for (const s of stations) {
    const d = Math.abs((Number(s.chainage_m) || 0) - 8720);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  const cs = window.__MM_SCENE__.cameraSystem;
  cs.ensurePerspective?.({ dur: 0 });
  const cam = cs.camera;
  const controls = cs.controls;
  cam.up.set(0, 1, 0);
  cam.position.set(best.x + 220, 520, best.z + 980);
  controls.target.set(best.x - 40, 18, best.z);
  cam.lookAt(controls.target);
  controls.update();
  const terrain = [];
  window.__MM_SCENE__.scene.traverse((o) => {
    if (o.name === "terrain" && o.geometry) {
      const p = o.geometry.attributes.position;
      terrain.push(p.getY(30), p.getY(800), p.getY(4000));
    }
  });
  const bed = [];
  window.__MM_SCENE__.scene.traverse((o) => {
    if (o.name === "riverBed" && o.geometry) {
      const p = o.geometry.attributes.position;
      bed.push(p.getY(20), p.getY(400));
    }
  });
  return { x: best.x, z: best.z, chainage: best.chainage_m, terrain, bed };
});
console.log("POSE", JSON.stringify(pose));

async function shot(name, rise) {
  await page.evaluate((r) => {
    window.__MM_SCENE__.clearHydrologySimulation?.();
    if (r > 0) window.__MM_SCENE__.setHydrologySimulationRise(r, true);
  }, rise);
  await page.waitForTimeout(rise >= 20 ? 1600 : 700);
  await page.evaluate(() => {
    const stations = window.__MM_SCENE__.dataset.corridor.stations;
    let best = stations[Math.floor(stations.length / 2)];
    let bd = Infinity;
    for (const s of stations) {
      const d = Math.abs((Number(s.chainage_m) || 0) - 8720);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    const cs = window.__MM_SCENE__.cameraSystem;
    window.__MM_SCENE__.stopCinematic?.();
    const cam = cs.camera;
    const controls = cs.controls;
    controls.enabled = false;
    cam.up.set(0, 1, 0);
    cam.position.set(best.x + 80, 640, best.z + 1100);
    controls.target.set(best.x - 120, 20, best.z - 80);
    cam.lookAt(controls.target);
    if (cam.isPerspectiveCamera) {
      cam.fov = 48;
      cam.updateProjectionMatrix();
    }
  });
  await page.waitForTimeout(250);
  const info = await page.evaluate(() => {
    const flood = window.__MM_SCENE__.floodLayer;
    const geo = flood.geometry;
    const pos = geo.attributes.position.array;
    const idx = geo.index.array;
    const n = geo.drawRange.count;
    let maxEdge = 0;
    let samples = 0;
    const step = Math.max(1, Math.floor(n / 3 / 4000));
    for (let t = 0; t < n / 3; t += step) {
      const a = idx[t * 3] * 3;
      const b = idx[t * 3 + 1] * 3;
      const c = idx[t * 3 + 2] * 3;
      const e = (i, j) => Math.hypot(pos[i] - pos[j], pos[i + 2] - pos[j + 2]);
      maxEdge = Math.max(maxEdge, e(a, b), e(b, c), e(c, a));
      samples++;
    }
    let waterY = null;
    window.__MM_SCENE__.scene.traverse((o) => {
      if (waterY == null && o.name === "riverSurface") waterY = o.geometry.attributes.position.getY(100);
    });
    let terrainY = null;
    let bedY = null;
    window.__MM_SCENE__.scene.traverse((o) => {
      if (o.name === "terrain") terrainY = o.geometry.attributes.position.getY(800);
      if (o.name === "riverBed") bedY = o.geometry.attributes.position.getY(400);
    });
    return {
      rise: window.__MM_SCENE__.getHydrologySimulationRise(),
      waterY,
      floodY: flood.position.y,
      visible: flood.visible,
      tris: n / 3,
      maxEdge,
      samples,
      stats: flood.userData.floodStats,
      terrainY,
      bedY,
    };
  });
  await page.screenshot({ path: path.join(outDir, name) });
  console.log(name, JSON.stringify(info));
  return info;
}

const a = await shot("01-normal.png", 0);
const b = await shot("02-low.png", 3);
const c = await shot("03-medium.png", 12);
const d = await shot("04-high.png", 40);
const e = await shot("05-recession.png", 5);
console.log("ERRORS", errors);
console.log("TERRAIN", pose.terrain[1], a.terrainY, d.terrainY, e.terrainY);
console.log("BED", pose.bed[1], a.bedY, d.bedY, e.bedY);
await browser.close();
