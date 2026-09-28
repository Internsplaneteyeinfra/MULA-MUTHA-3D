import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("docs/documentary", { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function shot(type, file, wait = 20000, extra) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 720 } });
  await page.goto("http://localhost:5176/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__MM_SCENE__?.showBodCod, null, { timeout: 180000 });
  await page.waitForTimeout(4000);
  await page.evaluate((t) => document.querySelector(`[data-analytics="${t}"]`)?.click(), type);
  await page.waitForTimeout(wait);
  if (extra) await extra(page);
  await page.screenshot({ path: `docs/documentary/${file}`, timeout: 150000 }).catch((e) => console.log(file, e.message.slice(0, 80)));
  console.log("done", file);
  await page.close();
}

await shot("Pollution", "pollution.png");
await shot("Climate impact", "climate.png", 25000);
await shot("AQI", "aqi.png", 20000);
await shot("digital_twin", "hydro_intel.png", 15000);
await browser.close();
