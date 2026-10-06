import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
await page.goto("http://localhost:4176/", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__MM_SCENE__, null, { timeout: 240000 });
await page.waitForFunction(() => {
  const s = window.__MM_SCENE__;
  const st = s.dataset.corridor.stations;
  let i = st.findIndex((p) => p.chainage_m >= 1882);
  const a = st[i], b = st[Math.min(st.length - 1, i + 18)];
  const P = s.cameraSystem.camera?.position?.constructor;
  if (!P) return false;
  return s.cameraSystem.setPose(new P(a.x, 8.88, a.z), new P(b.x, 4.5, b.z)) !== false;
}, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const s = window.__MM_SCENE__;
  let terrain;
  s.scene.traverse((o) => { if (o.name === "terrain") terrain = o; });
  return {
    camY: +s.cameraSystem.camera.position.y.toFixed(2),
    bg: s.scene.background?.getHexString?.() ?? String(s.scene.background),
    fogD: s.scene.fog?.density,
    terrainSide: terrain?.material.side,
  };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: "scripts/_1882.png", timeout: 180000 });
await browser.close();
