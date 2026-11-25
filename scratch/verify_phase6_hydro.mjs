/**
 * Phase 6 browser verification — stage/depth/forecast timeline/chainage sync.
 * PW_CHANNEL=chrome node scratch/verify_phase6_hydro.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.env.MM_URL || "http://localhost:5185/";
const OUT = path.resolve("scratch/screenshots/phase6");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(90000);
const log = [];
const note = (msg, extra) => {
  log.push({ t: new Date().toISOString(), msg, ...extra });
  console.log(msg, extra || "");
};

try {
  page.on("pageerror", (err) => console.warn("PAGEERROR", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.warn("CONSOLE", msg.text());
  });

  await page.goto(`${BASE}?phase6=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof window.__MM_HYDRO_VIZ__?.inspectAt === "function" && !!window.__MM_SCENE__,
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(4000);
  await page.keyboard.press("Escape").catch(() => {});

  await page.evaluate(async () => {
    document.body.classList.add("dt-mode-active");
    document.getElementById("ui-root")?.classList.add("dt-mode-active");
    await window.__MM_HYDRO_VIZ__.show();
  });
  await page.waitForTimeout(2000);

  const boot = await page.evaluate(() => ({
    hud: !document.getElementById("hydro-viz-hud")?.hidden,
    tg: (() => {
      const el = document.getElementById("tg-backdrop");
      return !el || el.hidden || getComputedStyle(el).display === "none";
    })(),
    intel: (() => {
      const el = document.getElementById("hydro-intel-backdrop");
      return !el || el.hidden || getComputedStyle(el).display === "none";
    })(),
  }));
  note("boot", boot);
  if (!boot.hud || !boot.tg || !boot.intel) throw new Error("Primary 3D HUD not active / chart modal open");

  async function go(m, label) {
    const info = await page.evaluate(async (meters) => {
      await window.__MM_HYDRO_VIZ__?.show?.();
      await window.__MM_HYDRO_VIZ__?.setMode?.("discharge");
      await window.__MM_HYDRO_VIZ__?.setOffsetHours?.(0);
      return window.__MM_HYDRO_VIZ__?.inspectAt?.(meters);
    }, m);
    note(`CH ${label}`, {
      Q: info?.discharge_m3s,
      depth: info?.survey_depth_m ?? info?.flow_depth_m,
      stage: info?.stage_m_relative,
      src: info?.dischargeSource,
      outlet: info?.outlet_discharge_m3s,
      timeClass: info?.timeClass,
    });
    await page.screenshot({ path: path.join(OUT, `ch-${label.replace("+", "")}.png`) });
    return info;
  }

  const ch = {
    a: await go(0, "0+000"),
    b: await go(8790, "8+790"),
    c: await go(8820, "8+820"),
    d: await go(16790, "16+790"),
  };

  // Modes
  for (const mode of ["discharge", "stage", "depth", "forecast", "historical"]) {
    await page.evaluate(async (m) => {
      await window.__MM_HYDRO_VIZ__?.setMode?.(m);
    }, mode);
    await page.waitForTimeout(1400);
    const badge = await page.locator("#hydro-viz-hud .hv-badge").innerText();
    const noteTxt = await page.locator("#hydro-viz-hud .hv-note").innerText();
    const tlVisible = await page.locator("#hydro-viz-hud .hv-timeline:not([hidden])").count();
    note(`mode ${mode}`, { badge, noteTxt: noteTxt.slice(0, 120), tlVisible });
    await page.screenshot({ path: path.join(OUT, `mode-${mode}.png`) });
  }

  // Forecast lead +24 via API (not range fill)
  await page.evaluate(async () => {
    await window.__MM_HYDRO_VIZ__?.setMode?.("forecast");
    await window.__MM_HYDRO_VIZ__?.setOffsetHours?.(24);
  });
  await page.waitForTimeout(2500);
  const fcInfo = await page.evaluate(() => ({
    info: window.__MM_HYDRO_VIZ__?.getLastInfo?.(),
    snap: window.__MM_HYDRO_VIZ__?.getSnapshot?.(),
  }));
  note("forecast +24 at last CH", {
    Q: fcInfo.info?.discharge_m3s,
    src: fcInfo.info?.dischargeSource,
    timeClass: fcInfo.info?.timeClass,
    lead: fcInfo.info?.forecast_lead_h,
    offsetH: fcInfo.snap?.offsetH,
    p10: fcInfo.info?.forecast_p10,
    p90: fcInfo.info?.forecast_p90,
  });
  await page.screenshot({ path: path.join(OUT, "forecast-plus24.png") });

  // Historical −6
  await page.evaluate(async () => {
    await window.__MM_HYDRO_VIZ__?.setMode?.("historical");
    await window.__MM_HYDRO_VIZ__?.setOffsetHours?.(-6);
  });
  await page.waitForTimeout(2500);
  const histInfo = await page.evaluate(() => ({
    info: window.__MM_HYDRO_VIZ__?.getLastInfo?.(),
    snap: window.__MM_HYDRO_VIZ__?.getSnapshot?.(),
  }));
  note("historical -6", {
    Q: histInfo.info?.discharge_m3s,
    src: histInfo.info?.dischargeSource,
    timeClass: histInfo.info?.timeClass,
    ts: histInfo.info?.timestamp,
    offsetH: histInfo.snap?.offsetH,
  });
  await page.screenshot({ path: path.join(OUT, "historical-minus6.png") });

  // Ensure chart modals still closed
  const modals = await page.evaluate(() => {
    const hid = (id) => {
      const el = document.getElementById(id);
      return !el || el.hidden || getComputedStyle(el).display === "none";
    };
    return {
      tg: hid("tg-backdrop"),
      intel: hid("hydro-intel-backdrop"),
      hasThreshold: document.body.innerText.includes("HYDRAULIC THRESHOLD STATUS"),
      hasFE: document.body.innerText.includes("ForecastEngine hydraulic geometry"),
    };
  });
  note("modals", modals);

  // Outlet ≠ selected at head (and mid-reach)
  const okOutlet =
    ch.a?.discharge_m3s != null &&
    ch.a.outlet_discharge_m3s != null &&
    Math.abs(ch.a.discharge_m3s - ch.a.outlet_discharge_m3s) > 0.05 &&
    ch.b?.discharge_m3s != null &&
    Math.abs(ch.b.discharge_m3s - ch.b.outlet_discharge_m3s) > 0.05;

  fs.writeFileSync(
    path.join(OUT, "phase6-log.json"),
    JSON.stringify({ log, ch, fcInfo, histInfo, modals, okOutlet }, null, 2),
  );

  const fcClass = fcInfo.info?.timeClass;
  const histClass = histInfo.info?.timeClass;
  const fail =
    !modals.tg ||
    !modals.intel ||
    modals.hasThreshold ||
    modals.hasFE ||
    fcClass !== "FORECAST" ||
    histClass !== "HISTORICAL" ||
    !okOutlet;

  if (fail) {
    console.error("FAIL", { modals, fcClass, histClass, okOutlet });
    process.exitCode = 2;
  } else {
    console.log("PASS phase6");
  }
} catch (err) {
  console.error(err);
  await page.screenshot({ path: path.join(OUT, "error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
