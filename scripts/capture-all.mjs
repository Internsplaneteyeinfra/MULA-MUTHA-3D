/**
 * Full visual validation suite (A–F) — sequential, timeout-safe.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.MM_URL || "http://localhost:5176";
const OUT = join(process.cwd(), "audit-screenshots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  console.log(`  → ${name}…`);
  await wait(800);
  const dataUrl = await page.evaluate(() => {
    const c = document.getElementById("scene");
    if (!c) return null;
    try {
      return c.toDataURL("image/png");
    } catch {
      return null;
    }
  });
  if (!dataUrl) {
    console.warn(`  ✗ ${name}: no canvas`);
    return 0;
  }
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  await writeFile(join(OUT, `${name}.png`), buf);
  console.log(`  ✓ ${name}: ${(buf.length / 1024).toFixed(0)} KB`);
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
    await wait(26000);

    console.log("Capturing…");
    await page.evaluate(() => window.__MM_SCENE__?.cam?.applyMode?.("overview"));
    await wait(2000);
    await shot(page, "C-city-overview");

    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      const st = ds.corridor.stations[Math.floor(ds.corridor.stations.length * 0.58)];
      const px = -st.flowZ;
      const pz = st.flowX;
      cam.camera.position.set(st.x + px * 42, 16, st.z + pz * 42);
      cam.controls.target.set(st.x + px * 115, 11, st.z + pz * 115);
      cam.camera.lookAt(st.x + px * 115, 11, st.z + pz * 115);
      cam.controls.update();
    });
    await wait(3500);
    await shot(page, "A-building-closeup");

    await page.evaluate(() => window.__MM_SCENE__?.cam?.applyMode?.("overview"));
    await wait(2000);
    await shot(page, "D-river-corridor");

    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      const st = ds.corridor.stations[Math.floor(ds.corridor.stations.length * 0.52)];
      cam.camera.position.set(st.x - 90, 110, st.z + 160);
      cam.controls.target.set(st.x - 30, 16, st.z + 50);
      cam.controls.update();
    });
    await wait(2000);
    await shot(page, "B-residential-area");

    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      const b = ds.activeSceneBounds || ds.kmlOverviewBounds;
      cam.camera.position.set(b.cx, 2100, b.cz + b.spanZ * 0.4);
      cam.controls.target.set(b.cx, 0, b.cz);
      cam.controls.update();
    });
    await wait(2500);
    await shot(page, "E-distant-city-lod");

    const validation = await page.locator("#validate-panel").innerText().catch(() => "");
    await writeFile(join(OUT, "validation-text.txt"), validation);
    await page.evaluate(() => window.__MM_SCENE__?.validationHud?.setVisible?.(true));
    await page.evaluate(() => window.__MM_SCENE__?.cam?.applyMode?.("overview"));
    await wait(1500);
    await shot(page, "F-projection-validation");

    console.log("\nValidation:\n", validation);
    await writeFile(
      join(OUT, "capture-report.json"),
      JSON.stringify({ capturedAt: new Date().toISOString(), validation }, null, 2),
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
