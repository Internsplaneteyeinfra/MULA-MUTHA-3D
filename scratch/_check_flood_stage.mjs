import { chromium } from "playwright";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto("http://localhost:5185", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__MM_SCENE__?.floodLayer, null, { timeout: 90000 });
await page.click("#layers-btn");
await page.waitForSelector("#flood", { state: "visible" });
const before = await page.evaluate(() => {
  const pos = window.__MM_SCENE__.river.mesh.geometry.attributes.position;
  return { y: pos.getY(0), floodVisible: window.__MM_SCENE__.floodLayer.visible, mode: document.body.dataset ? null : null };
});
await page.evaluate(() => {
  const el = document.querySelector("#flood");
  el.disabled = false;
  el.value = "500";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(4000);
const after = await page.evaluate(() => {
  const scene = window.__MM_SCENE__;
  const pos = scene.river.mesh.geometry.attributes.position;
  let maxY = -1e9;
  for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  return {
    label: document.querySelector("#flood-label")?.textContent,
    floodRiseM: window.state?.floodRiseM,
    maxWaterY: maxY,
    floodVisible: scene.floodLayer.visible,
    disabled: document.querySelector("#flood")?.disabled,
    stageClass: document.querySelector("#lp-illustrative-stage")?.className,
  };
});
await page.screenshot({ path: "scratch/screenshots/flood-stage-5m.png", clip: { x: 200, y: 80, width: 900, height: 560 } });
console.log(JSON.stringify({ before, after }, null, 2));
await browser.close();
