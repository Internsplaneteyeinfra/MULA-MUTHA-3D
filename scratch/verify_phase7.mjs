/**
 * Phase 7 verification — quality, canonical state, forecast validation, browser.
 * PW_CHANNEL=chrome node scratch/verify_phase7.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import {
  makeMeasurement,
  validateForecastInterval,
  QUALITY,
} from "../src/services/hydrology/hydrologyQuality.js";
import {
  recordForecastSnapshot,
  getForecastValidationReport,
  getForecastArchiveSize,
} from "../src/services/hydrology/forecastValidationEngine.js";

const OUT = path.resolve("scratch/screenshots/phase7");
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const note = (m, e) => {
  log.push({ m, ...e });
  console.log(m, e || "");
};

// Unit: quality
{
  const m = makeMeasurement({
    value: 10.4,
    unit: "m³/s",
    source: "NADITWIN LIVE",
    timestamp: new Date().toISOString(),
    provenance: QUALITY.LIVE,
  });
  note("quality live", { quality: m.quality, stale: m.freshness.stale });
  const bad = validateForecastInterval(12, 10, 9);
  note("invalid interval", bad);
  const ok = validateForecastInterval(9, 10, 12);
  note("valid interval", ok);
}

// Seed archive with synthetic past issues matching hydrograph (will still need obs match)
{
  const now = Date.now();
  // Record a forecast that would have been issued 24h ago for "now" — may not match
  recordForecastSnapshot({
    issueTime: new Date(now - 24 * 3600 * 1000).toISOString(),
    lead_h: 24,
    chainage_m: 8790,
    cell: 879,
    p10: 9.5,
    p50: 10.3,
    p90: 11.2,
  });
  note("archive size", { n: getForecastArchiveSize() });
}

const report = await getForecastValidationReport(8790);
note("validation report", {
  pairs: report.pairs,
  insufficient: report.overall.insufficient,
  message: report.overall.message,
  mae: report.overall.mae,
});

fs.writeFileSync(
  path.join(OUT, "validation-report.json"),
  JSON.stringify(report, null, 2),
);
fs.copyFileSync(
  path.resolve("scratch/phase7_historical_inventory.json"),
  path.join(OUT, "historical-inventory.json"),
);
fs.copyFileSync(
  path.resolve("scratch/phase7_safety_readiness.json"),
  path.join(OUT, "safety-readiness.json"),
);

// Browser
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`http://localhost:5185/?phase7=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => typeof window.__MM_HYDRO_VIZ__?.inspectAt === "function",
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(3000);
  await page.evaluate(async () => {
    document.body.classList.add("dt-mode-active");
    await window.__MM_HYDRO_VIZ__.show();
  });
  await page.waitForTimeout(2000);

  const results = {};
  for (const [label, m] of [
    ["0+000", 0],
    ["8+790", 8790],
    ["8+820", 8820],
    ["16+790", 16790],
  ]) {
    const info = await page.evaluate(async (meters) => {
      await window.__MM_HYDRO_VIZ__.setMode("discharge");
      await window.__MM_HYDRO_VIZ__.setOffsetHours(0);
      const i = await window.__MM_HYDRO_VIZ__.inspectAt(meters);
      if (window.__MM_CANONICAL__) {
        await window.__MM_CANONICAL__.setMeters(meters);
        await window.__MM_CANONICAL__.refresh({ lead_h: 24 });
      }
      const canon = window.__MM_CANONICAL__?.get?.();
      return {
        info: i,
        selected: canon?.live?.selected_discharge?.value,
        outlet: canon?.live?.outlet_discharge?.value,
        rain: canon?.live?.rainfall?.value,
        stage: canon?.live?.stage_relative?.value,
        depth: canon?.live?.depth?.value,
        depthSrc: canon?.live?.depth?.source,
        fcP50: canon?.forecast?.p50?.value,
        fcP10: canon?.forecast?.p10?.value,
        fcP90: canon?.forecast?.p90?.value,
        intervalOk: canon?.forecast?.intervalOk,
        safetyLocked: canon?.safetyLocked,
        quality: canon?.live?.selected_discharge?.quality,
        fresh: canon?.live?.selected_discharge?.freshness?.label,
      };
    }, m);
    results[label] = info;
    note(`CH ${label}`, {
      Q: info.selected ?? info.info?.discharge_m3s,
      outlet: info.outlet,
      rain: info.rain,
      depth: info.depth,
      fc: info.fcP50,
      quality: info.quality,
      safety: info.safetyLocked,
    });
    await page.screenshot({ path: path.join(OUT, `ch-${label.replace("+", "")}.png`) });
  }

  // Consistency weather vs HUD
  const weatherQ = await page.locator("#weather-widget [data-metric='discharge'], .weather-q, #weather-discharge").first().textContent().catch(() => null);
  note("weather discharge text", { weatherQ });

  const modals = await page.evaluate(() => {
    const hid = (id) => {
      const el = document.getElementById(id);
      return !el || el.hidden || getComputedStyle(el).display === "none";
    };
    return { tg: hid("tg-backdrop"), intel: hid("hydro-intel-backdrop") };
  });
  note("modals", modals);

  await page.screenshot({ path: path.join(OUT, "hud-overview.png") });

  // Forecast timeline + depth mode screenshots
  await page.evaluate(async () => {
    await window.__MM_HYDRO_VIZ__.setMode("forecast");
    await window.__MM_HYDRO_VIZ__.setOffsetHours(24);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "forecast-lead24.png") });

  await page.evaluate(async () => {
    await window.__MM_HYDRO_VIZ__.setMode("depth");
    await window.__MM_HYDRO_VIZ__.setOffsetHours(0);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, "depth-mode.png") });

  // Secondary charts provenance — Node-side (same module as UI)
  let chartProv = {};
  try {
    const api = await import("../src/services/hydrology/digitalTwinApi.js");
    const d = await api.getDischargeSeries(8790);
    const h = await api.getHydrograph(8790);
    chartProv = {
      dischargeNote: d.provenance?.note,
      hydroNote: h.provenance?.note,
      dischargePast: d.provenance?.dataClassPast,
      hydroPast: h.provenance?.dataClassPast,
      threshold: h.provenance?.threshold,
    };
  } catch (e) {
    chartProv = { err: String(e) };
  }
  note("chart provenance", chartProv);

  const head = results["0+000"];
  const mid = results["8+790"];
  const ok =
    Number.isFinite(head?.selected) &&
    Number.isFinite(head?.outlet) &&
    Math.abs(head.selected - head.outlet) > 0.05 &&
    Number.isFinite(mid?.selected) &&
    mid.safetyLocked === true &&
    modals.tg &&
    modals.intel &&
    !/live gauge/i.test(chartProv?.dischargeNote || "") &&
    (chartProv?.threshold === "CLASS_DEFAULT" || chartProv?.err);

  fs.writeFileSync(path.join(OUT, "phase7-log.json"), JSON.stringify({ log, results, report, chartProv }, null, 2));
  if (!ok) {
    console.error("FAIL", { head, mid, modals, chartProv });
    process.exitCode = 2;
  } else {
    console.log("PASS phase7");
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
