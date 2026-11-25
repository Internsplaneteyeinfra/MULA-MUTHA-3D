/** Capture three-graph layout + expand screenshots + layout metrics. */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SHOT = path.resolve("scratch/screenshots/three-graph-layout");
fs.mkdirSync(SHOT, { recursive: true });
const BASE = process.env.APP_URL || "http://localhost:5185";
const jpg = (name) => ({ path: path.join(SHOT, name), type: "jpeg", quality: 55, fullPage: false });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: {},
  heights: {},
  consoleErrors: [],
};

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || undefined,
});

async function openCharts(page, meters = 8400) {
  await page.goto(`${BASE}/?cap=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => typeof window.__MM_HYDRO_INTEL__?.showAnalyticalCharts === "function",
    null,
    { timeout: 120000 },
  );
  await page.evaluate((m) => {
    document.body.classList.add("dt-mode-active");
    window.__MM_HYDRO_INTEL__.showAnalyticalCharts();
    document.dispatchEvent(new CustomEvent("chainage-select", { detail: { meters: m, focus: true, source: "cap" } }));
  }, meters);
  await page.waitForSelector("#hip-g-rating svg", { timeout: 120000 });
  await page.waitForTimeout(2500);
}

function measure(page) {
  return page.evaluate(() => {
    const h = (id) => {
      const el = document.querySelector(`#${id} .hip-svg-wrap`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { height: Math.round(r.height), width: Math.round(r.width) };
    };
    return {
      stage: h("hip-g-stage"),
      hydro: h("hip-g-hydro"),
      rating: h("hip-g-rating"),
      visible: {
        stage: !!document.querySelector("#hip-g-stage svg"),
        hydro: !!document.querySelector("#hip-g-hydro svg"),
        rating: !!document.querySelector("#hip-g-rating svg"),
      },
      expandBarHidden: document.querySelector("#hip-expand-bar")?.hidden ?? null,
      expandBtns: document.querySelectorAll(".hip-expand-btn").length,
      histBesideHydro: !!document.querySelector("#hip-g-hydro #hip-hydro-hist"),
      datasetExpand: document.querySelector(".hip-three")?.dataset?.expand || "",
      station: document.querySelector("#hip-station-badge")?.textContent || "",
    };
  });
}

try {
  // ── 1920×1080 normal ─────────────────────────────────────────────
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") report.consoleErrors.push(msg.text());
  });
  await openCharts(page);
  report.heights["1920x1080_normal"] = await measure(page);
  await page.screenshot(jpg("01-normal-all-three-1920.jpg"));

  // Expand stage
  await page.locator('#hip-g-stage .hip-expand-btn').click();
  await page.waitForTimeout(400);
  report.heights["1920x1080_stage_expanded"] = await measure(page);
  report.checks.stageExpanded =
    report.heights["1920x1080_stage_expanded"].datasetExpand === "stage" &&
    report.heights["1920x1080_stage_expanded"].expandBarHidden === false;
  await page.screenshot(jpg("02-stage-expanded.jpg"));

  // Back to all
  await page.locator("#hip-back-all").click();
  await page.waitForTimeout(400);
  report.heights["1920x1080_back_all"] = await measure(page);
  report.checks.backToAll =
    !report.heights["1920x1080_back_all"].datasetExpand &&
    report.heights["1920x1080_back_all"].expandBarHidden === true &&
    report.heights["1920x1080_back_all"].visible.stage &&
    report.heights["1920x1080_back_all"].visible.hydro &&
    report.heights["1920x1080_back_all"].visible.rating;
  await page.screenshot(jpg("03-back-to-all.jpg"));

  // Expand hydro + hist selector
  await page.locator('#hip-g-hydro .hip-expand-btn').click();
  await page.waitForTimeout(400);
  report.heights["1920x1080_hydro_expanded"] = await measure(page);
  report.checks.hydroExpanded =
    report.heights["1920x1080_hydro_expanded"].datasetExpand === "hydro" &&
    report.heights["1920x1080_hydro_expanded"].histBesideHydro === true;
  await page.screenshot(jpg("04-hydro-expanded.jpg"));

  const stationBefore = report.heights["1920x1080_hydro_expanded"].station;
  await page.selectOption("#hip-hydro-hist", "7d");
  await page.waitForTimeout(5000);
  report.heights["1920x1080_hydro_hist_7d"] = await measure(page);
  report.checks.histInExpanded =
    report.heights["1920x1080_hydro_hist_7d"].histBesideHydro === true &&
    report.heights["1920x1080_hydro_hist_7d"].station === stationBefore;
  await page.screenshot(jpg("05-hydro-expanded-hist-7d.jpg"));

  // Expand rating
  await page.locator("#hip-back-all").click();
  await page.waitForTimeout(300);
  await page.locator('#hip-g-rating .hip-expand-btn').click();
  await page.waitForTimeout(400);
  report.heights["1920x1080_rating_expanded"] = await measure(page);
  report.checks.ratingExpanded =
    report.heights["1920x1080_rating_expanded"].datasetExpand === "rating";
  await page.screenshot(jpg("06-rating-expanded.jpg"));

  // Exit fullscreen
  await page.locator("#hip-exit-fs").click();
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => document.querySelector(".hydro-intel-backdrop")?.hidden === true);
  report.checks.exitFullscreen = closed;
  await page.screenshot(jpg("07-exit-fullscreen.jpg"));

  // Re-open for responsive shots
  await openCharts(page);
  report.checks.threeVisibleNormal =
    report.heights["1920x1080_normal"].visible.stage &&
    report.heights["1920x1080_normal"].visible.hydro &&
    report.heights["1920x1080_normal"].visible.rating &&
    report.heights["1920x1080_normal"].expandBtns === 3;
  report.checks.adequateHeights1920 =
    (report.heights["1920x1080_normal"].stage?.height || 0) >= 240 &&
    (report.heights["1920x1080_normal"].hydro?.height || 0) >= 290 &&
    (report.heights["1920x1080_normal"].rating?.height || 0) >= 240;

  // ── 1600×900 ─────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(500);
  // trigger resize paint
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(400);
  report.heights["1600x900"] = await measure(page);
  await page.screenshot(jpg("08-responsive-1600x900.jpg"));

  // ── 1366×768 ─────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(400);
  report.heights["1366x768"] = await measure(page);
  await page.screenshot(jpg("09-responsive-1366x768.jpg"));

  report.checks.noDuplicateExpandBtns = report.heights["1920x1080_normal"].expandBtns === 3;
  report.finishedAt = new Date().toISOString();
  report.pass = Object.values(report.checks).every(Boolean);

  fs.writeFileSync(
    path.resolve("scratch/three_graph_layout_metrics.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  console.log("shots", fs.readdirSync(SHOT));
  if (!report.pass) process.exitCode = 2;
} finally {
  await browser.close();
}
