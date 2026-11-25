/** Extra layout-parity screenshots. PW_CHANNEL=chrome node scratch/capture_layout_parity_shots.mjs */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SHOT = path.resolve("scratch/screenshots/naditwin-layout-parity");
fs.mkdirSync(SHOT, { recursive: true });
const BASE = process.env.APP_URL || "http://localhost:5185";
const NT = "https://naditwin-production.up.railway.app/?river=Mula-Mutha";
const jpg = (name) => ({ path: path.join(SHOT, name), type: "jpeg", quality: 50 });

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
try {
  await page.goto(`${BASE}/?cap=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__MM_HYDRO_INTEL__?.showAnalyticalCharts === "function", null, { timeout: 120000 });
  await page.evaluate(() => {
    document.body.classList.add("dt-mode-active");
    window.__MM_HYDRO_INTEL__.showAnalyticalCharts();
    document.dispatchEvent(new CustomEvent("chainage-select", { detail: { meters: 8400, focus: true, source: "cap" } }));
  });
  await page.waitForSelector("#hip-g-rating svg", { timeout: 90000 });
  await page.waitForTimeout(3000);

  await page.locator("#hip-mode-live").click();
  await page.waitForTimeout(1500);
  await page.screenshot(jpg("02-live-datetime.jpg"));

  await page.locator("#hip-mode-hist").click();
  await page.waitForTimeout(500);
  await page.selectOption("#hip-hydro-hist", "7d");
  await page.waitForTimeout(4500);
  await page.screenshot(jpg("03-historic-selector-beside-hydro.jpg"));

  await page.locator("#hip-stretch-trigger").click();
  await page.waitForTimeout(400);
  await page.screenshot(jpg("04-all-locations-menu.jpg"));
  await page.locator('#hip-stretch-menu .hip-dd-item[data-value="L1"]').click();
  await page.waitForTimeout(4000);
  await page.screenshot(jpg("05-stretch-L1.jpg"));

  await page.locator("#hip-station-trigger").click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const item = [...document.querySelectorAll("#hip-station-menu .hip-dd-item")].find((el) => /Bund Garden/i.test(el.textContent));
    item?.click();
  });
  await page.waitForTimeout(4000);
  await page.screenshot(jpg("06-station-bund-garden.jpg"));

  const nt = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await nt.goto(NT, { waitUntil: "domcontentloaded", timeout: 90000 });
  await nt.waitForTimeout(6000);
  await nt.screenshot(jpg("07-naditwin-reference.jpg"));
  await nt.close();

  console.log("shots", fs.readdirSync(SHOT));
} finally {
  await browser.close();
}
