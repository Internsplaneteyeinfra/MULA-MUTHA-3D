/**
 * Visual proof capture — 8 required screenshots (3D building validation).
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.MM_URL || "http://localhost:5176";
const OUT = join(process.cwd(), "audit-screenshots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  console.log(`  → ${name}`);
  await wait(600);
  const dataUrl = await page.evaluate(() => document.getElementById("scene")?.toDataURL("image/png") ?? null);
  if (!dataUrl) return 0;
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  await writeFile(join(OUT, `${name}.png`), buf);
  console.log(`  ✓ ${(buf.length / 1024).toFixed(0)} KB`);
  return buf.length;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
    await wait(30000);

    // 1 — small houses close angled
    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      const st = ds.corridor.stations[Math.floor(ds.corridor.stations.length * 0.58)];
      const px = -st.flowZ;
      const pz = st.flowX;
      cam.camera.position.set(st.x + px * 38, 14, st.z + pz * 38);
      cam.controls.target.set(st.x + px * 95, 9, st.z + pz * 95);
      cam.controls.update();
    });
    await wait(2500);
    await shot(page, "1-houses-close-angled");

    // 2 — apartments close angled
    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      const st = ds.corridor.stations[Math.floor(ds.corridor.stations.length * 0.48)];
      const px = -st.flowZ;
      const pz = st.flowX;
      cam.camera.position.set(st.x - px * 55, 38, st.z - pz * 55);
      cam.controls.target.set(st.x - px * 140, 22, st.z - pz * 140);
      cam.controls.update();
    });
    await wait(2500);
    await shot(page, "2-apartments-close-angled");

    // 3 — mid-distance dense settlement
    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      const st = ds.corridor.stations[Math.floor(ds.corridor.stations.length * 0.52)];
      cam.camera.position.set(st.x - 110, 75, st.z + 200);
      cam.controls.target.set(st.x - 35, 14, st.z + 65);
      cam.controls.update();
    });
    await wait(2500);
    await shot(page, "3-dense-settlement");

    // 4 — full Pune overview (oblique 42°)
    await page.evaluate(() => window.__MM_SCENE__?.cam?.applyMode?.("overview"));
    await wait(3000);
    await shot(page, "4-pune-overview-oblique");

    // 5 — height comparison (low angle along bank)
    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      const st = ds.corridor.stations[Math.floor(ds.corridor.stations.length * 0.44)];
      const px = -st.flowZ;
      const pz = st.flowX;
      cam.camera.position.set(st.x + px * 28, 10, st.z + pz * 28);
      cam.controls.target.set(st.x + px * 200, 18, st.z + pz * 200);
      cam.controls.update();
    });
    await wait(2500);
    await shot(page, "5-height-comparison");

    // 6 — road hierarchy
    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      if (!ds || !cam) return;
      const b = ds.activeSceneBounds || ds.kmlOverviewBounds || ds.sceneBounds;
      if (!b) return;
      cam.camera.position.set(b.cx + 180, 120, b.cz + 120);
      cam.controls.target.set(b.cx, 12, b.cz);
      cam.controls.update();
    });
    await wait(2500);
    await shot(page, "6-road-hierarchy");

    // 7 — validation mode (KML lines visible)
    await page.evaluate(() => {
      const rb = window.__MM_SCENE__?.riverBanks;
      if (rb) rb.visible = true;
      window.__MM_SCENE__?.validationHud?.setVisible?.(true);
    });
    await page.evaluate(() => window.__MM_SCENE__?.cam?.applyMode?.("overview"));
    await wait(2000);
    await shot(page, "7-validation-mode");

    // 8 — cinematic mode (natural river, no debug lines)
    await page.evaluate(() => {
      const rb = window.__MM_SCENE__?.riverBanks;
      if (rb) rb.visible = false;
    });
    await page.evaluate(() => window.__MM_SCENE__?.cam?.applyMode?.("overview"));
    await wait(2000);
    await shot(page, "8-cinematic-mode");

    console.log("Done — 8 screenshots in audit-screenshots/");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
