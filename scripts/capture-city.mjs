/**
 * City quality screenshot capture — requires dev server on :5176
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.MM_URL || "http://localhost:5176";
const OUT = join(process.cwd(), "audit-screenshots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const dataUrl = await page.evaluate(() => document.getElementById("scene")?.toDataURL("image/png") ?? null);
  if (!dataUrl) return null;
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  await writeFile(join(OUT, `${name}.png`), buf);
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
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForSelector("#loading.hidden", { timeout: 180000 }).catch(() => wait(25000));
    await wait(28000);

    await shot(page, "C-city-overview");
    const validation = await page.locator("#validate-panel").innerText().catch(() => "");
    await writeFile(join(OUT, "validation-text.txt"), validation);

    await page.click('nav.bar button:has-text("Local 3D")').catch(() => {});
    await wait(3500);
    await shot(page, "A-building-closeup");

    await page.evaluate(() => {
      window.__MM_SCENE__?.cam?.applyMode?.("overview");
    });
    await wait(2000);
    await shot(page, "D-river-corridor");

    console.log("Validation:\n", validation);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
