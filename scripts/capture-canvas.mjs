/**
 * Capture WebGL canvas via toDataURL (avoids full-page screenshot timeout).
 * Run: node scripts/capture-canvas.mjs  (dev server on :5176)
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = join(process.cwd(), "audit-screenshots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureCanvas(page, name) {
  const dataUrl = await page.evaluate(() => {
    const c = document.getElementById("scene");
    if (!c) return null;
    try {
      return c.toDataURL("image/png");
    } catch {
      return null;
    }
  });
  if (!dataUrl?.startsWith("data:image")) {
    console.warn(`  skip ${name}: canvas toDataURL failed`);
    return null;
  }
  const b64 = dataUrl.split(",")[1];
  const path = join(OUT, `${name}.png`);
  await writeFile(path, Buffer.from(b64, "base64"));
  console.log(`  saved ${name}.png`);
  return path;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  try {
    await page.goto("http://localhost:5176", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#loading.hidden", { timeout: 120000 }).catch(() => wait(15000));
    await wait(15000);

    await captureCanvas(page, "01-overview");
    await page.click('nav.bar button:has-text("Local 3D")').catch(() => {});
    await wait(2000);
    await captureCanvas(page, "08-local-3d");

    const report = {
      validationVisible: await page.locator("#validate-panel:not([hidden])").count(),
      tooltipVisible: await page.locator(".tooltip.visible").count(),
    };
    await writeFile(join(OUT, "capture-report.json"), JSON.stringify(report, null, 2));
    console.log("Report:", report);
  } catch (err) {
    console.error("Capture failed:", err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
