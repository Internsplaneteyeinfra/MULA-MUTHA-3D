/**
 * Headless visual audit — captures screenshots of the running app.
 * Run: node scripts/visual-audit.mjs  (dev server must be on :5176)
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = "http://localhost:5176";
const OUT = join(process.cwd(), "audit-screenshots");

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  captured: ${name}.png`);
  return path;
}

async function clickCam(page, label) {
  await page.click(`nav.bar button:has-text("${label}")`, { timeout: 8000 }).catch(() => {});
  await wait(1200);
}

async function toggleLayer(page, id) {
  await page.click("#layers-btn").catch(() => {});
  await wait(400);
  const el = page.locator(`#${id}`);
  if (await el.count()) {
    await el.check({ force: true }).catch(() => {});
  }
  await wait(800);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  const audit = { capturedAt: new Date().toISOString(), shots: [], checks: [] };

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#loading.hidden", { timeout: 90000 }).catch(async () => {
      await wait(12000);
    });
    await wait(12000);

    audit.shots.push(await shot(page, "01-overview-default"));
    await clickCam(page, "Local 3D");
    audit.shots.push(await shot(page, "08-local-3d"));

    await clickCam(page, "Overview");
    await toggleLayer(page, "validate-hud");
    audit.shots.push(await shot(page, "09-projection-validation"));

    await toggleLayer(page, "coord-grid");
    audit.shots.push(await shot(page, "10-coordinate-grid"));

    await clickCam(page, "Bathymetry");
    audit.shots.push(await shot(page, "02-river-closeup-bathymetry"));

    await clickCam(page, "River Path Follow");
    await wait(2000);
    audit.shots.push(await shot(page, "03-river-follow"));

    await clickCam(page, "Overview");
    await wait(1500);

    // Hover center for tooltip
    const canvas = page.locator("#scene");
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
      await wait(600);
      audit.shots.push(await shot(page, "07-river-hover"));
      const tip = await page.locator(".tooltip.visible").count();
      audit.checks.push({ feature: "river hover tooltip", visible: tip > 0 });
    }

    // Validation panel visible?
    const valPanel = await page.locator("#validate-panel:not([hidden])").count();
    audit.checks.push({ feature: "projection validation panel", visible: valPanel > 0 });

    const gridOn = await page.evaluate(() => {
      const g = window.__MM_SCENE__?.coordinateGrid;
      return g?.visible ?? false;
    }).catch(() => false);
    audit.checks.push({ feature: "coordinate grid in scene", visible: gridOn });

    const doorCount = await page.evaluate(() => {
      let n = 0;
      window.__MM_SCENE__?.scene?.traverse((o) => {
        if (o.name === "doorInstances") n = o.count ?? 0;
      });
      return n;
    }).catch(() => 0);
    audit.checks.push({ feature: "door instances in scene graph", count: doorCount });

    const buildingMeshes = await page.evaluate(() => {
      let glb = 0;
      let far = 0;
      window.__MM_SCENE__?.scene?.traverse((o) => {
        if (o.name?.startsWith("glb:")) glb++;
        if (o.name === "buildingsFarLodChunk") far++;
      });
      return { glb, far };
    }).catch(() => ({ glb: 0, far: 0 }));
    audit.checks.push({ feature: "building layers", ...buildingMeshes });

    await writeFile(join(OUT, "audit-report.json"), JSON.stringify(audit, null, 2));
    console.log("\nAudit report:", JSON.stringify(audit.checks, null, 2));
    console.log(`\nScreenshots saved to: ${OUT}`);
  } catch (err) {
    console.error("Audit failed:", err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
