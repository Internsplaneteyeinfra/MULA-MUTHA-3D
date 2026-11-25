/**
 * Verify analytical charts use NadiTwin digital twin numbers (not ForecastEngine static).
 * PW_CHANNEL=chrome node scratch/verify_live_charts.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = path.resolve("scratch/screenshots/live-charts");
fs.mkdirSync(OUT, { recursive: true });
const SKIP = process.env.SKIP_SCREENSHOTS === "1";

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`http://localhost:5185/?livecharts=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => typeof window.__MM_HYDRO_VIZ__?.show === "function", null, {
    timeout: 90000,
  });
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    document.body.classList.add("dt-mode-active");
    await window.__MM_HYDRO_VIZ__.show();
    document.dispatchEvent(
      new CustomEvent("river-station-selected", {
        detail: { chainage_m: 8790, stationLabel: "CH 8+790" },
      }),
    );
  });
  await page.waitForTimeout(1500);
  await page.locator(".hv-charts").click();
  await page.waitForTimeout(2500);

  const checks = {};
  for (const tab of ["stage", "hydro", "discharge", "forecast", "overview", "threshold"]) {
    await page.locator(`#hydro-intel-panel [data-tab="${tab}"]`).first().click();
    await page.waitForTimeout(1800);
    const text = await page.locator("#hydro-intel-panel").innerText();
    checks[tab] = {
      hasNadiTwin: /NADITWIN|NadiTwin|Digital twin/i.test(text),
      noSyntheticEngine: !/ForecastEngine synthetic|50 members · stochastic|Simulated past/i.test(text),
      noClassDefaultThr: tab === "stage" || tab === "hydro" || tab === "forecast"
        ? !/CLASS_DEFAULT/i.test(text)
        : true,
      snippet: text.replace(/\s+/g, " ").slice(0, 220),
    };
    if (!SKIP) await page.screenshot({ path: path.join(OUT, `tab-${tab}.png`) });
  }

  // Numeric sanity via page evaluate of APIs
  const nums = await page.evaluate(async () => {
    const api = await import("/src/services/hydrology/digitalTwinApi.js");
    const stage = await api.getRiverStageSeries(24);
    const hg = await api.getHydrograph(8790);
    const q = await api.getDischargeSeries(8790);
    const st = await api.getStationState(8790);
    return {
      stageN: stage.chainage_m?.length,
      stageProv: stage.provenance?.wse_now,
      stageWseMid: stage.wse_now?.[Math.floor((stage.wse_now?.length || 1) / 2)],
      hgObs: hg.observed?.wse?.at?.(-1) ?? hg.observed?.wse?.slice?.(-1)?.[0],
      hgThr: hg.threshold_m,
      qNow: q.now_q,
      stQ: st.current?.discharge_m3s,
      stWse: st.current?.wse_m,
      stThr: st.current?.threshold_m,
      stProv: st.provenance?.wse,
    };
  });

  const pass =
    nums.stageN > 50 &&
    nums.stageProv === "NADITWIN LIVE" &&
    Number.isFinite(nums.hgObs) &&
    Number.isFinite(nums.qNow) &&
    Math.abs(nums.qNow - 10.4) < 3 &&
    nums.stProv === "NADITWIN LIVE" &&
    checks.stage.hasNadiTwin &&
    checks.hydro.hasNadiTwin &&
    checks.discharge.hasNadiTwin;

  console.log(JSON.stringify({ pass, nums, checks }, null, 2));
  fs.writeFileSync(path.join(OUT, "live-charts-log.json"), JSON.stringify({ pass, nums, checks }, null, 2));
  if (!pass) process.exitCode = 2;
  else console.log("PASS live-charts");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
