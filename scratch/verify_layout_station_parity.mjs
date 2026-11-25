/**
 * Layout/station parity verify. Prefer SKIP_SCREENSHOTS=1 when disk is low.
 * PW_CHANNEL=chrome node scratch/verify_layout_station_parity.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const ROOT = path.resolve("scratch");
const SHOT = path.join(ROOT, "screenshots", "naditwin-layout-parity");
const SKIP = process.env.SKIP_SCREENSHOTS === "1";
if (!SKIP) fs.mkdirSync(SHOT, { recursive: true });

const NT = "https://naditwin-production.up.railway.app";
const BASE = process.env.APP_URL || "http://localhost:5185";

const [locations, timerange, hydro72] = await Promise.all([
  fetch(`${NT}/api/locations?river=Mula-Mutha`).then((r) => r.json()),
  fetch(`${NT}/api/timerange?river=Mula-Mutha`).then((r) => r.json()),
  fetch(`${NT}/api/hydrograph?river=Mula-Mutha&cell=840&hours=72`).then((r) => r.json()),
]);

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
try {
  await page.goto(`${BASE}/?lp=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__MM_HYDRO_INTEL__?.showAnalyticalCharts === "function", null, { timeout: 120000 });
  await page.evaluate(() => {
    document.body.classList.add("dt-mode-active");
    window.__MM_HYDRO_INTEL__.showAnalyticalCharts();
    document.dispatchEvent(new CustomEvent("chainage-select", { detail: { meters: 8400, focus: true, source: "layout-parity" } }));
  });
  await page.waitForSelector("#hydro-intel-panel .hip-three", { timeout: 90000 });
  await page.waitForTimeout(3500);

  const ui = await page.evaluate(() => {
    const text = document.querySelector("#hydro-intel-panel")?.innerText || "";
    const histInHydroHead = !!document.querySelector("#hip-g-hydro .hip-graph-head #hip-hydro-hist");
    const meta = document.querySelector("#hip-live-meta")?.innerText || "";
    const sections = document.querySelectorAll(".hip-graph-section").length;
    return {
      sections,
      histInHydroHead,
      hasThreeTitles: /River stage/i.test(text) && /Hydrograph/i.test(text) && /Rating curve/i.test(text),
      hasLiveMeta: /Twin date|Twin now/i.test(meta),
      stretchCount: document.querySelectorAll("#hip-stretch-menu .hip-dd-item").length,
      histCount: document.querySelectorAll("#hip-hydro-hist option").length,
      chainage: !!document.querySelector("#hip-chainage-input"),
    };
  });

  const api = await page.evaluate(async () => {
    const { getLocationsSeries, getTimerangeMeta } = await import("/src/services/hydrology/naditwinChartSeries.js");
    const { getNadiTwinHydrographAtChainage } = await import("/src/services/hydrology/naditwinHydrologyAdapter.js");
    const loc = await getLocationsSeries();
    const tr = await getTimerangeMeta();
    const hg = await getNadiTwinHydrographAtChainage(8400, 72);
    return {
      locCount: loc.rows?.length,
      today: tr.today_date,
      hour: tr.today_hour,
      nObs: hg?.times?.length,
      nFc: hg?.forecast_times?.length,
      lastStage: hg?.observed_stage?.at?.(-1),
      lastQ: hg?.observed_q?.at?.(-1),
    };
  });

  const pass =
    ui.sections === 3 &&
    ui.histInHydroHead &&
    ui.hasThreeTitles &&
    ui.hasLiveMeta &&
    api.locCount === locations.length &&
    api.today === timerange.today_date &&
    api.nObs === hydro72.times?.length &&
    Math.abs((api.lastStage ?? 0) - (hydro72.observed?.at(-1) ?? 0)) < 1e-6;

  if (!SKIP) {
    await page.screenshot({ path: path.join(SHOT, "01-full-dashboard-1920.png"), type: "jpeg", quality: 45 });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.screenshot({ path: path.join(SHOT, "responsive-1600x900.jpg"), type: "jpeg", quality: 40 });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: path.join(SHOT, "responsive-1366x768.jpg"), type: "jpeg", quality: 40 });
  }

  const out = { pass, ui, api, nt: { loc: locations.length, today: timerange.today_date, nObs: hydro72.times?.length, lastStage: hydro72.observed?.at(-1) } };
  fs.writeFileSync(path.join(ROOT, "naditwin_three_graph_layout_validation.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!pass) process.exitCode = 1;
} finally {
  await browser.close();
}
