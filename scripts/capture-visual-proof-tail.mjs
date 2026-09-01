/** Capture screenshots 5–8 only */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = "http://localhost:5176";
const OUT = join(process.cwd(), "audit-screenshots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await wait(800);
  const dataUrl = await page.evaluate(() => document.getElementById("scene")?.toDataURL("image/png") ?? null);
  if (!dataUrl) return;
  await writeFile(join(OUT, `${name}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("✓", name);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await wait(28000);

    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      if (!ds || !cam) return;
      const st = ds.corridor.stations[Math.floor(ds.corridor.stations.length * 0.44)];
      const px = -st.flowZ, pz = st.flowX;
      cam.camera.position.set(st.x + px * 28, 10, st.z + pz * 28);
      cam.controls.target.set(st.x + px * 200, 18, st.z + pz * 200);
      cam.controls.update();
    });
    await wait(2000);
    await shot(page, "5-height-comparison");

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
    await wait(2000);
    await shot(page, "6-road-hierarchy");

    await page.evaluate(() => {
      window.__MM_SCENE__?.riverBanks && (window.__MM_SCENE__.riverBanks.visible = true);
      window.__MM_SCENE__?.cam?.applyMode?.("overview");
    });
    await wait(2000);
    await shot(page, "7-validation-mode");

    await page.evaluate(() => {
      window.__MM_SCENE__?.riverBanks && (window.__MM_SCENE__.riverBanks.visible = false);
      window.__MM_SCENE__?.cam?.applyMode?.("overview");
    });
    await wait(2000);
    await shot(page, "8-cinematic-mode");
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
