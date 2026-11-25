/** Historic visualization correction — compact unavailable panels, hydro priority, LIVE unchanged. */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SHOT = path.resolve("scratch/screenshots/historic-visualization-correction");
fs.mkdirSync(SHOT, { recursive: true });
const BASE = process.env.APP_URL || "http://localhost:5185";
const jpg = (name) => ({ path: path.join(SHOT, name), type: "jpeg", quality: 55 });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: {},
  consoleErrors: [],
  api: {},
};

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => {
  if (m.type() === "error") report.consoleErrors.push(m.text());
});

async function openCharts() {
  await page.goto(`${BASE}/?hvc=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => typeof window.__MM_HYDRO_INTEL__?.showAnalyticalCharts === "function",
    null,
    { timeout: 120000 },
  );
  await page.evaluate(() => {
    document.body.classList.add("dt-mode-active");
    window.__MM_HYDRO_INTEL__.showAnalyticalCharts();
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters: 8400, focus: true, source: "hvc" } }),
    );
  });
  await page.waitForSelector("#hip-g-hydro svg", { timeout: 180000 });
  await page.waitForTimeout(2500);
}

function panelMetrics(id) {
  return page.evaluate((elId) => {
    const el = document.querySelector(`#${elId}`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      h: Math.round(r.height),
      compact: el.classList.contains("hip-graph-section--compact"),
      hasSvg: !!el.querySelector("svg"),
      hasAvail: !!el.querySelector(".hip-avail"),
      title: el.querySelector(".hip-graph-title")?.textContent?.trim()?.slice(0, 80) || "",
      msg: el.querySelector(".hip-avail__msg")?.textContent || el.querySelector(".hip-error")?.textContent || "",
      station: el.querySelector(".hip-avail__station")?.innerText || "",
    };
  }, id);
}

try {
  // API validation (proxy)
  const at = "2024-07-15T06:00:00+05:30";
  const enc = encodeURIComponent(at);
  const histRes = await page.request.get(`${BASE}/naditwin-api/api/state?river=Mula-Mutha&at=${enc}`);
  const histJson = await histRes.json();
  const liveRes = await page.request.get(`${BASE}/naditwin-api/api/state?river=Mula-Mutha`);
  const liveJson = await liveRes.json();
  const asked = Date.parse(at);
  const got = Date.parse(histJson.at);
  report.api = {
    histLive: histJson.live,
    histAt: histJson.at,
    histQ: histJson.q_station?.[840],
    liveLive: liveJson.live,
    liveAt: liveJson.at,
    tsMatch: Number.isFinite(asked) && Number.isFinite(got) && Math.abs(got - asked) <= 2 * 3600_000,
    notSameAsLive: histJson.at !== liveJson.at,
  };
  report.checks.apiHistoricNotLive =
    histJson.live === false && report.api.tsMatch && report.api.notSameAsLive;

  await openCharts();

  // LIVE baseline
  report.checks.live = await page.evaluate(() => ({
    liveActive: document.querySelector("#hip-mode-live")?.classList.contains("active"),
    histHidden: document.querySelector("#hip-historic-controls")?.hidden === true,
    order: [...document.querySelectorAll(".hip-three > .hip-graph-section")].map((el) => el.id),
    status: document.querySelector("#hip-status-badge")?.textContent || "",
    safeLabel: /SAFE/i.test(document.querySelector("#hip-status-badge")?.textContent || ""),
    dischargeSvg: !!document.querySelector("#hip-g-discharge svg"),
    stageSvg: !!document.querySelector("#hip-g-stage svg"),
    hydroSvg: !!document.querySelector("#hip-g-hydro svg"),
  }));
  report.checks.liveUnchanged =
    report.checks.live.liveActive &&
    report.checks.live.histHidden &&
    report.checks.live.order.join(",") === "hip-g-discharge,hip-g-stage,hip-g-hydro" &&
    report.checks.live.dischargeSvg &&
    report.checks.live.stageSvg &&
    report.checks.live.hydroSvg &&
    !report.checks.live.safeLabel;
  await page.screenshot(jpg("01-live-baseline-unchanged.jpg"));

  // HISTORIC
  await page.locator("#hip-mode-hist").click();
  await page.waitForTimeout(6000);
  await page.fill("#hip-hist-date", "2024-07-15");
  await page.selectOption("#hip-hist-time", "06:00");
  await page.waitForTimeout(9000);

  report.checks.histHeader = await page.evaluate(() => ({
    histActive: document.querySelector("#hip-mode-hist")?.classList.contains("active"),
    clock: document.querySelector("#hip-hist-clock")?.textContent || "",
    status: document.querySelector("#hip-status-badge")?.textContent || "",
    coverage: document.querySelector("#hip-coverage")?.innerText || "",
    meta: document.querySelector("#hip-live-meta")?.innerText || "",
    selectedMarker: /SELECTED TIME|SELECTED/.test(document.querySelector("#hip-g-hydro")?.innerHTML || ""),
  }));

  const disc = await panelMetrics("hip-g-discharge");
  const stage = await panelMetrics("hip-g-stage");
  const hydro = await panelMetrics("hip-g-hydro");
  report.checks.panels = { disc, stage, hydro };

  const bothUnavailable = disc?.hasAvail && stage?.hasAvail;
  const bothSpatial = disc?.hasSvg && stage?.hasSvg && !disc?.hasAvail && !stage?.hasAvail;

  report.checks.compactWhenUnavailable = bothUnavailable
    ? disc.h <= 140 && stage.h <= 140 && hydro.h >= 320
    : true; // if spatial available, compact rule N/A but still pass
  report.checks.hydroPrimaryWhenUnavailable = bothUnavailable ? hydro.h > disc.h && hydro.h > stage.h : true;
  report.checks.noEmptyChartShells = bothUnavailable
    ? !disc.hasSvg && !stage.hasSvg && !!hydro.hasSvg
    : (disc.hasSvg || disc.hasAvail) && (stage.hasSvg || stage.hasAvail) && hydro.hasSvg;
  const dischargeText = await page.evaluate(
    () => document.querySelector("#hip-g-discharge")?.innerText || "",
  );
  report.checks.noLiveSubstitute =
    !/LIVE · MODELLED/.test(disc?.msg || "") &&
    !/current LIVE/i.test(dischargeText);
  report.checks.statusHonest = /MODELLED|PROVISIONAL|UNVERIFIED/i.test(report.checks.histHeader.status)
    && !/SAFE/i.test(report.checks.histHeader.status);
  report.checks.selectedTimeMarker = report.checks.histHeader.selectedMarker;
  report.checks.headerProminent = /Selected IST|Selected \(IST\)|HISTORICAL/i.test(
    `${report.checks.histHeader.coverage} ${report.checks.histHeader.meta}`,
  );
  report.checks.spatialOrHonestUnavailable = bothSpatial || bothUnavailable;

  await page.screenshot(jpg("02-historic-overview-1920.jpg"));
  await page.locator("#hip-g-discharge").scrollIntoViewIfNeeded();
  await page.screenshot(jpg("03-discharge-panel.jpg"));
  await page.locator("#hip-g-stage").scrollIntoViewIfNeeded();
  await page.screenshot(jpg("04-stage-panel.jpg"));
  await page.locator("#hip-g-hydro").scrollIntoViewIfNeeded();
  await page.screenshot(jpg("05-hydrograph-primary.jpg"));

  // Step next
  const beforeClock = report.checks.histHeader.clock;
  await page.locator("#hip-hist-next").click();
  await page.waitForTimeout(6000);
  const afterClock = await page.evaluate(() => document.querySelector("#hip-hist-clock")?.textContent || "");
  report.checks.stepUpdates = !!afterClock && afterClock !== beforeClock;
  await page.screenshot(jpg("06-historic-step-next.jpg"));

  // Back to LIVE
  await page.locator("#hip-mode-live").click();
  await page.waitForTimeout(5000);
  report.checks.backToLive = await page.evaluate(() => ({
    liveActive: document.querySelector("#hip-mode-live")?.classList.contains("active"),
    histHidden: document.querySelector("#hip-historic-controls")?.hidden === true,
    dischargeSvg: !!document.querySelector("#hip-g-discharge svg"),
    stageSvg: !!document.querySelector("#hip-g-stage svg"),
    hydroSvg: !!document.querySelector("#hip-g-hydro svg"),
    noCompact: !document.querySelector(".hip-graph-section--compact"),
  }));
  report.checks.liveRestored =
    report.checks.backToLive.liveActive &&
    report.checks.backToLive.histHidden &&
    report.checks.backToLive.dischargeSvg &&
    report.checks.backToLive.stageSvg &&
    report.checks.backToLive.hydroSvg &&
    report.checks.backToLive.noCompact;
  await page.screenshot(jpg("07-back-to-live.jpg"));

  // Responsive viewports in HISTORIC
  await page.locator("#hip-mode-hist").click();
  await page.waitForTimeout(5000);
  await page.fill("#hip-hist-date", "2024-07-15");
  await page.selectOption("#hip-hist-time", "06:00");
  await page.waitForTimeout(7000);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(800);
  await page.screenshot(jpg("08-historic-1600x900.jpg"));
  report.checks.responsive1600 = await panelMetrics("hip-g-hydro");

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(800);
  await page.screenshot(jpg("09-historic-1366x768.jpg"));
  report.checks.responsive1366 = await panelMetrics("hip-g-hydro");

  report.finishedAt = new Date().toISOString();
  const bools = {
    apiHistoricNotLive: report.checks.apiHistoricNotLive,
    liveUnchanged: report.checks.liveUnchanged,
    compactWhenUnavailable: report.checks.compactWhenUnavailable,
    hydroPrimaryWhenUnavailable: report.checks.hydroPrimaryWhenUnavailable,
    noEmptyChartShells: report.checks.noEmptyChartShells,
    noLiveSubstitute: report.checks.noLiveSubstitute,
    statusHonest: report.checks.statusHonest,
    selectedTimeMarker: report.checks.selectedTimeMarker,
    headerProminent: report.checks.headerProminent,
    spatialOrHonestUnavailable: report.checks.spatialOrHonestUnavailable,
    stepUpdates: report.checks.stepUpdates,
    liveRestored: report.checks.liveRestored,
  };
  report.passSummary = bools;
  report.pass = Object.values(bools).every(Boolean);
  fs.writeFileSync(
    path.resolve("scratch/historic_visualization_correction_validation.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} catch (err) {
  report.error = err?.message || String(err);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.resolve("scratch/historic_visualization_correction_validation.json"),
    JSON.stringify(report, null, 2),
  );
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
