/** Final three-graph sequence: Discharge → Stage → Hydro. */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SHOT = path.resolve("scratch/screenshots/final-three-graph-sequence");
fs.mkdirSync(SHOT, { recursive: true });
const BASE = process.env.APP_URL || "http://localhost:5185";
const jpg = (name) => ({ path: path.join(SHOT, name), type: "jpeg", quality: 55 });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: {},
  order: [],
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
  await page.waitForSelector("#hip-g-hydro svg", { timeout: 180000 });
  await page.waitForTimeout(3000);
}

function inspect(page) {
  return page.evaluate(() => {
    const sections = [...document.querySelectorAll(".hip-three > .hip-graph-section")].map((el) => ({
      id: el.id,
      title: el.querySelector(".hip-graph-title")?.childNodes?.[0]?.textContent?.trim()
        || el.querySelector(".hip-graph-title")?.textContent?.trim()?.split("\n")[0]?.trim()
        || "",
      height: Math.round(el.querySelector(".hip-svg-wrap")?.getBoundingClientRect().height || 0),
      width: Math.round(el.querySelector(".hip-svg-wrap")?.getBoundingClientRect().width || 0),
      display: getComputedStyle(el).display,
    }));
    return {
      sections,
      hasRating: !!document.querySelector("#hip-g-rating"),
      ratingText: /\bRating curve\b/i.test(document.querySelector("#hip-content")?.innerText || ""),
      expandBtns: document.querySelectorAll(".hip-expand-btn").length,
      histBesideHydro: !!document.querySelector("#hip-g-hydro #hip-hydro-hist"),
      expand: document.querySelector(".hip-three")?.dataset?.expand || "",
      expandBarHidden: document.querySelector("#hip-expand-bar")?.hidden ?? null,
      station: document.querySelector("#hip-station-badge")?.textContent || "",
      fullWidth: sections.every((s) => s.width >= 1200 || s.display === "none"),
    };
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") report.consoleErrors.push(msg.text());
  });

  await openCharts(page);
  const normal = await inspect(page);
  report.order = normal.sections.map((s) => s.id);
  report.heights.normal = normal;
  report.checks.orderDischargeStageHydro =
    normal.sections.map((s) => s.id).join(",") === "hip-g-discharge,hip-g-stage,hip-g-hydro";
  report.checks.noRatingDom = !normal.hasRating;
  report.checks.noRatingText = !normal.ratingText;
  report.checks.threeExpandBtns = normal.expandBtns === 3;
  report.checks.histBesideHydro = normal.histBesideHydro;
  report.checks.fullWidth = normal.sections.every((s) => s.width >= 1700);
  report.checks.titles = {
    discharge: /Discharge at every chainage/i.test(normal.sections[0]?.title || ""),
    stage: /River stage/i.test(normal.sections[1]?.title || ""),
    hydro: /Hydrograph/i.test(normal.sections[2]?.title || ""),
  };
  report.checks.titlesOk = Object.values(report.checks.titles).every(Boolean);
  await page.screenshot(jpg("01-normal-discharge-stage-hydro.jpg"));

  // Expand discharge
  await page.locator('#hip-g-discharge .hip-expand-btn').click();
  await page.waitForTimeout(400);
  report.heights.dischargeExpanded = await inspect(page);
  report.checks.dischargeExpanded = report.heights.dischargeExpanded.expand === "discharge"
    && report.heights.dischargeExpanded.expandBarHidden === false;
  await page.screenshot(jpg("02-discharge-expanded.jpg"));

  await page.locator("#hip-back-all").click();
  await page.waitForTimeout(350);

  await page.locator('#hip-g-stage .hip-expand-btn').click();
  await page.waitForTimeout(400);
  report.heights.stageExpanded = await inspect(page);
  report.checks.stageExpanded = report.heights.stageExpanded.expand === "stage";
  await page.screenshot(jpg("03-stage-expanded.jpg"));

  await page.locator("#hip-back-all").click();
  await page.waitForTimeout(350);

  await page.locator('#hip-g-hydro .hip-expand-btn').click();
  await page.waitForTimeout(400);
  const beforeHist = await inspect(page);
  report.checks.hydroExpanded = beforeHist.expand === "hydro" && beforeHist.histBesideHydro;
  await page.selectOption("#hip-hydro-hist", "7d");
  await page.waitForTimeout(5500);
  const afterHist = await inspect(page);
  report.heights.hydroExpandedHist = afterHist;
  report.checks.histKeepsStation = afterHist.station === beforeHist.station
    && afterHist.expand === "hydro"
    && afterHist.histBesideHydro;
  await page.screenshot(jpg("04-hydro-expanded-hist-7d.jpg"));

  await page.locator("#hip-exit-fs").click();
  await page.waitForTimeout(500);
  report.checks.exitFullscreen = await page.evaluate(
    () => document.querySelector(".hydro-intel-backdrop")?.hidden === true,
  );
  await page.screenshot(jpg("05-exit-fullscreen.jpg"));

  // Reopen + stretch sync
  await openCharts(page);
  await page.locator("#hip-stretch-trigger").click();
  await page.waitForTimeout(200);
  await page.locator('#hip-stretch-menu .hip-dd-item[data-value="L1"]').click();
  await page.waitForTimeout(4500);
  report.heights.stretchL1 = await inspect(page);
  report.checks.stretchStillThree =
    report.heights.stretchL1.sections.map((s) => s.id).join(",") === "hip-g-discharge,hip-g-stage,hip-g-hydro";
  report.checks.stretchSync = report.checks.stretchStillThree
    && report.heights.stretchL1.sections.every((s) => s.height >= 200);
  await page.screenshot(jpg("06-stretch-L1-sync.jpg"));

  report.finishedAt = new Date().toISOString();
  const flatChecks = {
    ...report.checks,
    titlesOk: report.checks.titlesOk,
  };
  delete flatChecks.titles;
  report.pass = Object.entries(flatChecks).every(([, v]) => v === true)
    && report.checks.titlesOk;

  fs.writeFileSync(
    path.resolve("scratch/final_three_graph_sequence_metrics.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  console.log("shots", fs.readdirSync(SHOT));
  if (!report.pass) process.exitCode = 2;
} finally {
  await browser.close();
}
