/**
 * Capture visual evidence screenshots from running dev server.
 * Usage: npm run dev  then  node scripts/capture-evidence.mjs
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.MM_URL || "http://localhost:5176";
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
    return { name, ok: false, reason: "no canvas data" };
  }
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  const path = join(OUT, `${name}.png`);
  await writeFile(path, buf);
  const nonBlack = buf.includes(0xFF) && buf.length > 5000;
  console.log(`  saved ${name}.png (${buf.length} bytes)`);
  return { name, ok: nonBlack, path, bytes: buf.length };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const report = { captures: [], validation: null, ts: new Date().toISOString() };

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector("#loading.hidden", { timeout: 180000 }).catch(() => wait(20000));
    await wait(18000);

    report.captures.push(await captureCanvas(page, "A-validation-overview"));

    const validationText = await page.locator("#validate-panel").innerText().catch(() => "");
    report.validation = validationText;

    await page.click('nav.bar button:has-text("Local 3D")').catch(() => {});
    await wait(2500);
    report.captures.push(await captureCanvas(page, "I-local-3d"));

    await page.evaluate(() => {
      if (window.__MM_SCENE__?.coordinateGrid) window.__MM_SCENE__.coordinateGrid.visible = true;
    });
    await wait(500);
    report.captures.push(await captureCanvas(page, "G-coordinate-grid"));

    await writeFile(join(OUT, "evidence-report.json"), JSON.stringify(report, null, 2));
    console.log("\nValidation panel:\n", validationText);
  } catch (err) {
    console.error("Capture failed:", err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
