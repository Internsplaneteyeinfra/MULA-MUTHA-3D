/**
 * Browser verification: 3D hydrology primary, chart modal not primary.
 * node scratch/verify_hydro_viz_browser.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.env.MM_URL || "http://localhost:5185/";
const OUT = path.resolve("scratch/screenshots");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(90000);

const log = [];
function note(msg, extra) {
  const row = { t: new Date().toISOString(), msg, ...extra };
  log.push(row);
  console.log(msg, extra || "");
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Wait for UI chrome
  await page.waitForSelector("[data-analytics='digital_twin'], .analytics-controls, #ui-root", {
    timeout: 60000,
  });
  // Give scene a moment to boot
  await page.waitForTimeout(8000);

  // Close any blocking overlays if present
  await page.keyboard.press("Escape").catch(() => {});

  const dtBtn = page.locator("[data-analytics='digital_twin']").first();
  await dtBtn.click({ force: true });
  await page.waitForTimeout(2500);

  const vizVisible = await page.locator("#hydro-viz-hud:not([hidden])").count();
  const backdropHidden =
    (await page.locator("#hydro-intel-backdrop[hidden]").count()) > 0 ||
    (await page.locator("#hydro-intel-backdrop").evaluate((el) => {
      const s = getComputedStyle(el);
      return el.hidden || s.display === "none" || s.visibility === "hidden";
    }).catch(() => true));

  note("after DT click", { vizVisible, backdropHidden });

  await page.screenshot({
    path: path.join(OUT, "01-digital-twin-3d-viz.png"),
    fullPage: false,
  });

  // Drive chainages via events (same path as ruler / river click)
  async function goChainage(m, label) {
    await page.evaluate((meters) => {
      document.body.classList.add("dt-mode-active");
      document.getElementById("ui-root")?.classList.add("dt-mode-active");
      window.__MM_HYDRO_VIZ__?.show?.();
      window.__MM_SCENE__?.setHydrologyVizFocus?.(meters);
      document.dispatchEvent(
        new CustomEvent("chainage-select", { detail: { meters, source: "verify-script" } }),
      );
      document.dispatchEvent(
        new CustomEvent("river-station-selected", {
          detail: { chainage_m: meters, stationLabel: String(meters) },
        }),
      );
    }, m);
    await page.waitForTimeout(1800);
    const inspect = await page.locator("#hydro-viz-hud .hv-inspect").innerText().catch(() => "");
    const floatTxt = await page.locator("#hydro-viz-hud .hv-float").innerText().catch(() => "");
    const badge = await page.locator("#hydro-viz-hud .hv-badge").innerText().catch(() => "");
    const sceneOk = await page.evaluate(() => {
      const sc = window.__MM_SCENE__;
      return {
        hasShow: typeof sc?.showHydrologyViz === "function",
        vizActive: !!document.body.classList.contains("hydro-viz-active"),
        intelBackdropDisplay: (() => {
          const el = document.getElementById("hydro-intel-backdrop");
          if (!el) return "missing";
          return el.hidden ? "hidden" : getComputedStyle(el).display;
        })(),
        hudHidden: document.getElementById("hydro-viz-hud")?.hidden ?? null,
      };
    });
    note(`CH ${label}`, { inspect: inspect.slice(0, 240), floatTxt, badge, sceneOk });
    await page.screenshot({
      path: path.join(OUT, `ch-${label.replace("+", "")}.png`),
      fullPage: false,
    });
    return { inspect, floatTxt, badge, sceneOk };
  }

  const results = {};
  results.ch0000 = await goChainage(0, "0+000");
  results.ch8790 = await goChainage(8790, "8+790");
  results.ch8820 = await goChainage(8820, "8+820");
  results.ch16790 = await goChainage(16790, "16+790");

  // Switch modes
  for (const mode of ["discharge", "stage", "depth", "forecast"]) {
    await page.evaluate(async (m) => {
      await window.__MM_HYDRO_VIZ__?.setMode?.(m);
    }, mode);
    await page.waitForTimeout(1200);
    const badge = await page.locator("#hydro-viz-hud .hv-badge").innerText().catch(() => "");
    const noteTxt = await page.locator("#hydro-viz-hud .hv-note").innerText().catch(() => "");
    note(`mode ${mode}`, { badge, noteTxt });
    await page.screenshot({ path: path.join(OUT, `mode-${mode}.png`), fullPage: false });
  }

  // Confirm opening "show" does NOT display River Stage chart modal
  await page.evaluate(() => window.__MM_HYDRO_INTEL__?.show?.());
  await page.waitForTimeout(800);
  const modalState = await page.evaluate(() => {
    const intel = document.getElementById("hydro-intel-backdrop");
    const tg = document.getElementById("tg-backdrop");
    const hid = (el) => !el || el.hidden || getComputedStyle(el).display === "none";
    return {
      intelHidden: hid(intel),
      tgHidden: hid(tg),
      hudVisible: !document.getElementById("hydro-viz-hud")?.hidden,
      hasForecastEngineFooter: !!document.body.innerText?.includes(
        "ForecastEngine hydraulic geometry",
      ),
      hasThresholdStatus: !!document.body.innerText?.includes("HYDRAULIC THRESHOLD STATUS"),
    };
  });
  note("show() does not open chart modal", modalState);

  await page.screenshot({ path: path.join(OUT, "02-after-intel-show.png"), fullPage: false });

  fs.writeFileSync(path.join(OUT, "verify-log.json"), JSON.stringify({ log, results, modalState }, null, 2));
  console.log("WROTE", OUT);
  if (!modalState.intelHidden || !modalState.tgHidden || modalState.hasThresholdStatus) {
    process.exitCode = 2;
    console.error("FAIL: chart modal still primary", modalState);
  } else if (!modalState.hudVisible) {
    process.exitCode = 3;
    console.error("FAIL: hydro viz HUD not visible");
  } else {
    console.log("PASS: 3D hydrology primary; chart modals hidden");
  }
} catch (err) {
  console.error(err);
  await page.screenshot({ path: path.join(OUT, "error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
