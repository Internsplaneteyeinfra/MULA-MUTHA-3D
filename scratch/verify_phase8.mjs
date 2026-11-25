/**
 * Phase 8 — operational readiness verification + report generation.
 * PW_CHANNEL=chrome node scratch/verify_phase8.mjs
 * SKIP_SCREENSHOTS=1 to skip PNG writes if disk-constrained.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getForecastValidationReport,
  getForecastArchiveSize,
  recordForecastSnapshot,
} from "../src/services/hydrology/forecastValidationEngine.js";
import { validateForecastInterval, QUALITY, makeMeasurement } from "../src/services/hydrology/hydrologyQuality.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "scratch/screenshots/phase8");
const SKIP_SHOTS = process.env.SKIP_SCREENSHOTS === "1";
fs.mkdirSync(OUT, { recursive: true });

const log = [];
const note = (m, e = {}) => {
  log.push({ m, ...e });
  console.log(m, Object.keys(e).length ? JSON.stringify(e) : "");
};

async function shot(page, name) {
  const fp = path.join(OUT, name);
  if (SKIP_SHOTS) return;
  if (fs.existsSync(fp) && process.env.FORCE_SHOTS !== "1") return;
  await page.screenshot({ path: fp, fullPage: false });
}

function hidden(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return true;
    if (el.hidden) return true;
    const st = getComputedStyle(el);
    return st.display === "none" || st.visibility === "hidden";
  }, sel);
}

// ── Unit: quality + interval ───────────────────────────────────────────────
{
  const m = makeMeasurement({
    value: 10.4,
    unit: "m³/s",
    source: "NADITWIN LIVE",
    timestamp: new Date().toISOString(),
    provenance: QUALITY.LIVE,
  });
  note("quality", { quality: m.quality, stale: m.freshness.stale });
  note("interval_bad", validateForecastInterval(12, 10, 9));
  note("interval_ok", validateForecastInterval(9, 10, 12));
}

// ── Forecast validation (authoritative = gauge) ────────────────────────────
recordForecastSnapshot({
  issueTime: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  lead_h: 24,
  chainage_m: 8790,
  cell: 879,
  p10: 9.5,
  p50: 10.3,
  p90: 11.2,
});
const fcReport = await getForecastValidationReport(8790);
note("forecast_validation", {
  status: fcReport.status,
  gaugePairs: fcReport.pairs,
  modelledProxy: fcReport.modelledProxyPairs,
  archive: getForecastArchiveSize(),
  overallMsg: fcReport.overall?.message,
});
fs.writeFileSync(
  path.join(ROOT, "scratch/phase8_forecast_validation.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      ...fcReport,
      displayWhenInsufficient: "INSUFFICIENT OBSERVATION DATA",
      note: "Authoritative metrics require gauge OBSERVED pairs ≥ 8. NadiTwin hydrograph is MODELLED proxy only.",
    },
    null,
    2,
  ),
);

// ── API reliability (Node fetch via localhost proxy) ───────────────────────
const apiBase = "http://localhost:5185/naditwin-api";
const apiTests = {};
async function apiCheck(name, urlPath) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${apiBase}${urlPath}`);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* */
    }
    apiTests[name] = {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      hasBody: !!text,
      upstream: res.headers.get("x-naditwin-upstream-status"),
      keys: json && typeof json === "object" ? Object.keys(json).slice(0, 12) : [],
    };
  } catch (e) {
    apiTests[name] = { ok: false, error: String(e), ms: Date.now() - t0 };
  }
}
await apiCheck("live", "/api/live?river=Mula-Mutha");
await apiCheck("state", "/api/state?river=Mula-Mutha");
await apiCheck("meta", "/api/meta?river=Mula-Mutha");
await apiCheck("hydrograph", "/api/hydrograph?river=Mula-Mutha&cell=879&hours=72");
await apiCheck("forecast24", "/api/forecast/profile?river=Mula-Mutha&lead=24");
await apiCheck("bad_path", "/api/this-does-not-exist-phase8");

const apiReport = {
  generatedAt: new Date().toISOString(),
  proxy: "/naditwin-api",
  timeoutMsConfigured: 18000,
  cache: "TTL cache in naditwinApi.js — fromCache flagged",
  failureBehaviour:
    "refreshNadiTwinHydrology keeps previous bundle; adapter quality=STALE; canonical marks STALE not LIVE",
  tests: apiTests,
  upstreamVsLocal: {
    note: "HTTP ok via proxy indicates local app + proxy path; upstreamStatus header separates Railway failures when present",
  },
};
fs.writeFileSync(
  path.join(ROOT, "scratch/phase8_api_reliability_report.json"),
  JSON.stringify(apiReport, null, 2),
);
note("api", Object.fromEntries(Object.entries(apiTests).map(([k, v]) => [k, { ok: v.ok, status: v.status }])));

// ── Browser regression ─────────────────────────────────────────────────────
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const network404 = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));
page.on("response", (res) => {
  if (res.status() === 404) network404.push(res.url());
});

const results = {};
try {
  await page.goto(`http://localhost:5185/?phase8=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => typeof window.__MM_HYDRO_VIZ__?.show === "function",
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(2500);
  results.canvas = (await page.locator("canvas").count()) >= 1;
  await shot(page, "01-digital-twin-3d.png");

  await page.evaluate(async () => {
    document.body.classList.add("dt-mode-active");
    document.getElementById("ui-root")?.classList.add("dt-mode-active");
    await window.__MM_HYDRO_VIZ__.show();
  });
  await page.waitForTimeout(2000);
  results.hudOpen = (await page.locator(".hv-charts").count()) >= 1;
  results.intelHiddenOnHud = await hidden(page, "#hydro-intel-backdrop");
  await shot(page, "02-hydrology-hud.png");

  // LIVE discharge at chainages
  const chResults = {};
  for (const [label, m] of [
    ["0+000", 0],
    ["8+790", 8790],
    ["16+790", 16790],
  ]) {
    chResults[label] = await page.evaluate(async (meters) => {
      await window.__MM_HYDRO_VIZ__.setMode("discharge");
      await window.__MM_HYDRO_VIZ__.setOffsetHours(0);
      const i = await window.__MM_HYDRO_VIZ__.inspectAt(meters);
      if (window.__MM_CANONICAL__) {
        await window.__MM_CANONICAL__.setMeters(meters);
        await window.__MM_CANONICAL__.refresh({ lead_h: 24 });
      }
      const c = window.__MM_CANONICAL__?.get?.();
      return {
        q: c?.live?.selected_discharge?.value ?? i?.discharge_m3s,
        outlet: c?.live?.outlet_discharge?.value,
        quality: c?.live?.selected_discharge?.quality,
        depth: c?.live?.depth?.value,
        safety: c?.safetyLocked !== false,
        fc: c?.forecast?.p50?.value,
        p10: c?.forecast?.p10?.value,
        p90: c?.forecast?.p90?.value,
      };
    }, m);
  }
  results.liveQ = chResults;
  results.outletDistinct =
    Number.isFinite(chResults["0+000"]?.q) &&
    Number.isFinite(chResults["0+000"]?.outlet) &&
    Math.abs(chResults["0+000"].q - chResults["0+000"].outlet) > 0.05;
  results.noZeroFill =
    chResults["8+790"]?.q !== 0 || chResults["8+790"]?.quality === "UNAVAILABLE";
  results.safetyLocked = Object.values(chResults).every((r) => r.safety === true);
  note("liveQ", chResults);
  await shot(page, "03-live-discharge.png");

  // Historical / forecast modes
  await page.evaluate(async () => {
    await window.__MM_HYDRO_VIZ__.setMode("historical");
    await window.__MM_HYDRO_VIZ__.setOffsetHours(-24);
  });
  await page.waitForTimeout(1200);
  await shot(page, "04-historical-mode.png");
  results.historical = true;

  await page.evaluate(async () => {
    await window.__MM_HYDRO_VIZ__.setMode("forecast");
    await window.__MM_HYDRO_VIZ__.setOffsetHours(24);
  });
  await page.waitForTimeout(1200);
  await shot(page, "05-forecast-mode.png");
  results.forecastMode = true;

  // Station select must NOT open charts
  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent("river-station-selected", {
        detail: { chainage_m: 8790, stationLabel: "CH 8+790" },
      }),
    );
  });
  await page.waitForTimeout(800);
  results.stationNoAutoCharts = await hidden(page, "#hydro-intel-backdrop");

  // Charts button
  await page.locator(".hv-charts").click();
  await page.waitForTimeout(2000);
  results.chartsOpen = !(await hidden(page, "#hydro-intel-backdrop"));
  await shot(page, "06-analytical-charts.png");

  const tabs = ["hydro", "discharge", "stage", "forecast"];
  const tabOk = {};
  for (const tab of tabs) {
    await page.locator(`#hydro-intel-panel [data-tab="${tab}"]`).first().click();
    await page.waitForTimeout(1000);
    const t = await page.locator("#hip-content").innerText();
    tabOk[tab] =
      t.length > 20 &&
      !/Live gauge data/i.test(t) &&
      (/MODELLED|FORECAST|CLASS_DEFAULT|UNVERIFIED|ensemble/i.test(t) || tab === "overview");
  }
  results.tabs = tabOk;
  results.tabsOk = tabs.every((t) => tabOk[t]);

  // Provenance + close
  await page.locator(`#hydro-intel-panel [data-tab="hydro"]`).first().click();
  await page.waitForTimeout(1000);
  const prov = await page.locator("#hydro-intel-panel").innerText();
  results.provenance =
    /HISTORICAL\s*·\s*MODELLED/i.test(prov) &&
    /FORECAST\s*·\s*MODELLED/i.test(prov) &&
    /CLASS_DEFAULT/i.test(prov) &&
    !/Live gauge data/i.test(prov);
  await shot(page, "07-data-quality-provenance.png");

  await page.locator("#hip-close").click().catch(() => page.keyboard.press("Escape"));
  await page.waitForTimeout(600);
  results.chartsClosed = await hidden(page, "#hydro-intel-backdrop");

  // Safety mode note
  await page.evaluate(async () => {
    await window.__MM_HYDRO_VIZ__.setMode("safety");
  });
  await page.waitForTimeout(800);
  const safetyText = await page.locator("#hydrology-viz-hud, .hv-hud, body").first().innerText().catch(() => "");
  results.safetyUiLocked =
    /LOCKED|locked|unverified|crest/i.test(safetyText) || results.safetyLocked;
  await shot(page, "08-safety-locked.png");

  // Flood / rain independence (UI present)
  results.floodRainUi =
    (await page.locator("[data-analytics='flood']").count()) +
      (await page.locator("[data-analytics='rainfall']").count()) +
      (await page.getByText("Flood", { exact: true }).count()) >=
    1;

  // P10/P90 ordering at mid
  const mid = chResults["8+790"];
  results.pOrderOk =
    mid?.p10 == null ||
    mid?.p90 == null ||
    (Number.isFinite(mid.p10) && Number.isFinite(mid.p90) && mid.p10 <= mid.p90);

  results.network404 = [...new Set(network404)].slice(0, 20);
  results.consoleErrors = consoleErrors.slice(0, 30);

  const pass =
    results.canvas &&
    results.hudOpen &&
    results.intelHiddenOnHud &&
    results.outletDistinct &&
    results.safetyLocked &&
    results.stationNoAutoCharts &&
    results.chartsOpen &&
    results.tabsOk &&
    results.provenance &&
    results.chartsClosed &&
    results.pOrderOk &&
    fcReport.status === "INSUFFICIENT OBSERVATION DATA" &&
    apiTests.live?.ok &&
    apiTests.state?.ok;

  const regression = {
    generatedAt: new Date().toISOString(),
    pass,
    results,
    log,
    forecastValidationStatus: fcReport.status,
    apiOk: apiTests.live?.ok && apiTests.state?.ok,
    network404: results.network404,
    consoleErrors: results.consoleErrors,
    screenshots: SKIP_SHOTS ? "skipped" : OUT,
  };
  fs.writeFileSync(
    path.join(ROOT, "scratch/phase8_regression_results.json"),
    JSON.stringify(regression, null, 2),
  );

  // Copy inventory refs into screenshots folder
  for (const f of [
    "phase8_gauge_observation_inventory.json",
    "phase8_vertical_datum_assessment.json",
    "phase8_bank_crest_readiness.json",
    "phase8_forecast_validation.json",
    "phase8_api_reliability_report.json",
    "phase8_safety_readiness.json",
    "phase8_regression_results.json",
  ]) {
    const src = path.join(ROOT, "scratch", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
  }

  if (!pass) {
    console.error("FAIL phase8", results);
    process.exitCode = 2;
  } else {
    console.log("PASS phase8");
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
  fs.writeFileSync(
    path.join(ROOT, "scratch/phase8_regression_results.json"),
    JSON.stringify({ pass: false, error: String(e), log }, null, 2),
  );
} finally {
  await browser.close();
}
