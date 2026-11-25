/** HISTORIC date/time sync + Margin Board capture. */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SHOT = path.resolve("scratch/screenshots/naditwin-historic-margin-board");
fs.mkdirSync(SHOT, { recursive: true });
const BASE = process.env.APP_URL || "http://localhost:5185";
const jpg = (name) => ({ path: path.join(SHOT, name), type: "jpeg", quality: 52 });

const report = { startedAt: new Date().toISOString(), base: BASE, checks: {}, consoleErrors: [] };

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(m.text()); });

async function openCharts() {
  await page.goto(`${BASE}/?cap=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => typeof window.__MM_HYDRO_INTEL__?.showAnalyticalCharts === "function", null, { timeout: 120000 });
  await page.evaluate(() => {
    document.body.classList.add("dt-mode-active");
    window.__MM_HYDRO_INTEL__.showAnalyticalCharts();
    document.dispatchEvent(new CustomEvent("chainage-select", { detail: { meters: 8400, focus: true, source: "cap" } }));
  });
  await page.waitForSelector("#hip-g-hydro svg", { timeout: 180000 });
  await page.waitForTimeout(2500);
}

try {
  await openCharts();

  // 1 LIVE unchanged
  report.checks.liveVisible = await page.evaluate(() => ({
    liveActive: document.querySelector("#hip-mode-live")?.classList.contains("active"),
    histCtrlsHidden: document.querySelector("#hip-historic-controls")?.hidden === true,
    order: [...document.querySelectorAll(".hip-three > .hip-graph-section")].map((el) => el.id),
    hasMarginBtn: !!document.querySelector("#hip-margin-board-btn"),
  }));
  report.checks.liveOk =
    report.checks.liveVisible.liveActive &&
    report.checks.liveVisible.histCtrlsHidden &&
    report.checks.liveVisible.order.join(",") === "hip-g-discharge,hip-g-stage,hip-g-hydro";
  await page.screenshot(jpg("01-live-unchanged.jpg"));

  // 2 HISTORIC controls
  await page.locator("#hip-mode-hist").click();
  await page.waitForTimeout(5000);
  report.checks.histUi = await page.evaluate(() => ({
    histActive: document.querySelector("#hip-mode-hist")?.classList.contains("active"),
    ctrlsVisible: document.querySelector("#hip-historic-controls")?.hidden === false,
    date: document.querySelector("#hip-hist-date")?.value || "",
    time: document.querySelector("#hip-hist-time")?.value || "",
    clock: document.querySelector("#hip-hist-clock")?.textContent || "",
    dischargeTitle: document.querySelector("#hip-g-discharge .hip-graph-title")?.textContent || "",
  }));
  report.checks.histControls =
    report.checks.histUi.histActive &&
    report.checks.histUi.ctrlsVisible &&
    !!report.checks.histUi.date &&
    !!report.checks.histUi.time;
  await page.screenshot(jpg("02-historic-controls.jpg"));

  // 3 pick known flood-ish date
  await page.fill("#hip-hist-date", "2024-07-15");
  await page.selectOption("#hip-hist-time", "06:00");
  await page.waitForTimeout(8000);
  report.checks.histSnapshot = await page.evaluate(() => {
    const disc = document.querySelector("#hip-g-discharge");
    const stage = document.querySelector("#hip-g-stage");
    const hydro = document.querySelector("#hip-g-hydro");
    return {
      clock: document.querySelector("#hip-hist-clock")?.textContent || "",
      dischargeHasSvg: !!disc?.querySelector("svg"),
      dischargeErr: disc?.querySelector(".hip-error")?.textContent || "",
      stageHasSvg: !!stage?.querySelector("svg"),
      stageErr: stage?.querySelector(".hip-error")?.textContent || "",
      hydroHasSvg: !!hydro?.querySelector("svg"),
      selectedMarker: /SELECTED/.test(hydro?.innerHTML || ""),
      liveQText: /LIVE · MODELLED/.test(disc?.querySelector(".hip-prov-row")?.textContent || ""),
      histProv: /HISTORICAL/.test(disc?.querySelector(".hip-prov-row")?.textContent || ""),
    };
  });
  report.checks.histGraphs =
    report.checks.histSnapshot.dischargeHasSvg &&
    !report.checks.histSnapshot.dischargeErr &&
    report.checks.histSnapshot.stageHasSvg &&
    !report.checks.histSnapshot.stageErr &&
    report.checks.histSnapshot.hydroHasSvg &&
    report.checks.histSnapshot.selectedMarker &&
    report.checks.histSnapshot.histProv &&
    !report.checks.histSnapshot.liveQText;
  await page.screenshot(jpg("03-historic-timestamp-selected.jpg"));
  await page.locator("#hip-g-discharge").scrollIntoViewIfNeeded();
  await page.screenshot(jpg("04-historic-discharge.jpg"));
  await page.locator("#hip-g-stage").scrollIntoViewIfNeeded();
  await page.screenshot(jpg("05-historic-stage.jpg"));
  await page.locator("#hip-g-hydro").scrollIntoViewIfNeeded();
  await page.screenshot(jpg("06-historic-hydrograph.jpg"));

  // step
  const before = report.checks.histSnapshot.clock;
  await page.locator("#hip-hist-next").click();
  await page.waitForTimeout(5000);
  const afterStep = await page.evaluate(() => document.querySelector("#hip-hist-clock")?.textContent || "");
  report.checks.stepWorks = afterStep && afterStep !== before;
  await page.screenshot(jpg("07-historic-step-next.jpg"));

  // Margin board LIVE first
  await page.locator("#hip-mode-live").click();
  await page.waitForTimeout(4000);
  await page.locator("#hip-margin-board-btn").click();
  await page.waitForSelector(".hip-mb-card", { timeout: 60000 });
  report.checks.marginLive = await page.evaluate(() => ({
    open: document.querySelector("#hip-margin-board")?.hidden === false,
    cards: document.querySelectorAll(".hip-mb-card").length,
    provisional: /PROVISIONAL|LOCKED/i.test(document.querySelector("#hip-margin-board")?.innerText || ""),
    names: [...document.querySelectorAll(".hip-mb-card__name")].map((el) => el.textContent.trim()),
  }));
  report.checks.sevenCards = report.checks.marginLive.cards === 7;
  await page.screenshot(jpg("08-margin-board-open.jpg"));
  await page.screenshot(jpg("09-seven-location-cards.jpg"));

  // Every 1 km
  await page.locator('.hip-mb-tab[data-view="chainage"]').click();
  await page.waitForTimeout(3000);
  report.checks.margin1km = await page.evaluate(() => document.querySelectorAll(".hip-mb-card").length);
  report.checks.oneKmWorks = report.checks.margin1km >= 10;
  await page.screenshot(jpg("10-margin-board-1km.jpg"));

  await page.locator("#hip-mb-close").click();
  await page.waitForTimeout(400);
  report.checks.marginClosed = await page.evaluate(() => document.querySelector("#hip-margin-board")?.hidden === true);
  report.checks.graphsStillThere = await page.evaluate(() => !!document.querySelector("#hip-g-hydro svg"));
  await page.screenshot(jpg("11-margin-board-closed.jpg"));

  // Historic margins
  await page.locator("#hip-mode-hist").click();
  await page.waitForTimeout(4000);
  await page.fill("#hip-hist-date", "2024-07-15");
  await page.selectOption("#hip-hist-time", "06:00");
  await page.waitForTimeout(5000);
  await page.locator("#hip-margin-board-btn").click();
  await page.waitForTimeout(4000);
  report.checks.marginHist = await page.evaluate(() => ({
    open: document.querySelector("#hip-margin-board")?.hidden === false,
    cards: document.querySelectorAll(".hip-mb-card").length,
    text: document.querySelector("#hip-mb-meta")?.textContent || "",
    unavailable: /HISTORICAL MARGIN BOARD DATA UNAVAILABLE/i.test(document.querySelector("#hip-margin-board")?.innerText || ""),
  }));
  // Reset to By location for historic margin check
  await page.locator('.hip-mb-tab[data-view="locations"]').click();
  await page.waitForTimeout(2500);
  report.checks.marginHist = await page.evaluate(() => ({
    open: document.querySelector("#hip-margin-board")?.hidden === false,
    cards: document.querySelectorAll(".hip-mb-card").length,
    text: document.querySelector("#hip-mb-meta")?.textContent || "",
    unavailable: /HISTORICAL MARGIN BOARD DATA UNAVAILABLE/i.test(document.querySelector("#hip-margin-board")?.innerText || ""),
  }));
  report.checks.marginHistOk =
    report.checks.marginHist.open &&
    (report.checks.marginHist.cards === 7 || report.checks.marginHist.unavailable);
  await page.screenshot(jpg("12-margin-board-historic.jpg"));

  report.finishedAt = new Date().toISOString();
  const bools = {
    liveOk: report.checks.liveOk,
    histControls: report.checks.histControls,
    histGraphs: report.checks.histGraphs,
    stepWorks: report.checks.stepWorks,
    sevenCards: report.checks.sevenCards,
    oneKmWorks: report.checks.oneKmWorks,
    marginClosed: report.checks.marginClosed,
    graphsStillThere: report.checks.graphsStillThere,
    marginHistOk: report.checks.marginHistOk,
    provisionalLabel: report.checks.marginLive.provisional,
  };
  report.passSummary = bools;
  report.pass = Object.values(bools).every(Boolean);
  fs.writeFileSync(path.resolve("scratch/naditwin_historic_snapshot_validation.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("shots", fs.readdirSync(SHOT));
  if (!report.pass) process.exitCode = 2;
} finally {
  await browser.close();
}
