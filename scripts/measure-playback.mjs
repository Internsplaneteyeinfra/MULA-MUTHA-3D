/**
 * Real-time playback verification (no ?t freeze): measures loading time, the film's wall-clock duration
 * (rivereye-film-start -> rivereye-film-complete), frame-interval statistics and main-thread long tasks, and saves
 * screenshots at each scene transition as they happen during live playback.
 *
 *   PORT=5190 node scripts/measure-playback.mjs [--gpu]
 * Software rendering (default) is much slower than a real GPU, so fps numbers are a lower bound.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const OUT = process.env.SHOT_DIR || "audit-screenshots/playback";
await mkdir(OUT, { recursive: true });
const gpu = process.argv.includes("--gpu");
const browser = await chromium.launch({
  headless: true,
  args: gpu ? ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.WIDTH || 1280), height: Number(process.env.HEIGHT || 720) } });
const imageryNet = { requested: 0, completed: 0, failed: 0 };
const requestUrls = new Set();
let duplicateRequests = 0;
let failedRequests = 0;
page.on("request", (r) => {
  if (requestUrls.has(r.url())) duplicateRequests++;
  requestUrls.add(r.url());
});
page.on("requestfailed", (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || "")) failedRequests++; });
page.on("request", (r) => { if (/World_Imagery\/MapServer\/tile/.test(r.url())) imageryNet.requested++; });
page.on("requestfinished", (r) => { if (/World_Imagery\/MapServer\/tile/.test(r.url())) imageryNet.completed++; });
page.on("requestfailed", (r) => { if (/World_Imagery\/MapServer\/tile/.test(r.url())) imageryNet.failed++; });
// --slow: emulate a weaker setup (throttled network + forced low quality profile)
const slow = process.argv.includes("--slow");
if (slow) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8 });
}
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));
page.on("console", (m) => {
  if ((m.type() === "error" && !/KML|bod-cod|404/.test(m.text())) || m.text().startsWith("[perf]")) console.log(`[${m.type()}]`, m.text().slice(0, 300));
});
await page.addInitScript(() => {
  window.__metrics = { start: null, end: null, wall: null, frames: [], longTasks: [], hitches: [], heap: [] };
  addEventListener("rivereye-film-start", () => (window.__metrics.start = performance.now()));
  addEventListener("rivereye-film-complete", (e) => {
    window.__metrics.end = performance.now();
    window.__metrics.wall = e.detail?.wallSeconds ?? null;
  });
  addEventListener("rivereye-gis-ready", () => (window.__metrics.gisReady = performance.now()));
  setInterval(() => {
    if (window.__metrics.start && !window.__metrics.end && performance.memory?.usedJSHeapSize) {
      window.__metrics.heap.push(performance.memory.usedJSHeapSize);
    }
  }, 500);
  let last = 0;
  const loop = (t) => {
    if (window.__metrics.start && !window.__metrics.end && last) {
      window.__metrics.frames.push(t - last);
      if (t - last > 150) window.__metrics.hitches.push([+(window.__riverEye?.t ?? -1).toFixed(2), Math.round(t - last)]);
    }
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (window.__metrics.start && !window.__metrics.end) window.__metrics.longTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: true });
  } catch {}
});

const t0 = Date.now();
await page.goto(`http://localhost:${process.env.PORT || 5190}/?${process.argv.includes("--perf") ? "perf=1&" : ""}${slow ? "quality=low" : ""}`, { waitUntil: "domcontentloaded" });
// What the viewer sees while loading (must not be a black page)
for (const ms of [2000, 5000]) {
  await page.waitForTimeout(ms - (Date.now() - t0) > 0 ? ms - (Date.now() - t0) : 0);
  if (!(await page.evaluate(() => window.__metrics?.start))) await page.screenshot({ path: `${OUT}/0-loading-${ms / 1000}s.png` });
}
await page.waitForFunction(() => window.__metrics?.start, null, { timeout: 300000 });
const loadSec = (Date.now() - t0) / 1000;
console.log(`loading (page open -> film start): ${loadSec.toFixed(1)} s`);

const marks = [
  [0.4, "1-landing-to-earth"], [3.4, "2-earth-india-mountains"], [6.3, "3-mountains-to-river"], [7.4, "3a-gorge-transition-7.4"], [7.8, "3b-gorge-transition-7.8"], [8.6, "4-river-bends-tracking"],
  [11.35, "5a-cut-to-dam"], [12.4, "5b-dam-spillway"], [13.5, "5c-dam-water-detail"], [16.1, "6-above-to-underwater"], [18.9, "7-underwater-to-river"],
  [21.8, "8-final-pullback"], [22.4, "9-lithology-preview"], [23.0, "9a-lithology-detail"], [23.6, "10-flood-preview"], [24.1, "10a-flood-detail"], [24.8, "11-final-brand"], [25.9, "12-end"],
];
for (const [ft, name] of process.argv.includes("--noshots") ? [] : marks) {
  await page.waitForFunction((ft) => (window.__riverEye?.t ?? 0) >= ft, ft, { timeout: 120000, polling: 16 });
  const actual = await page.evaluate(() => window.__riverEye.t);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name} at film t=${actual.toFixed(2)} s`);
  if (ft >= 11 && ft <= 14) console.log(`prefetch at t=${actual.toFixed(2)} s: ${JSON.stringify(await page.evaluate(() => window.__riverEye.prefetchProgress()))}`);
  if (ft === 13.5) {
    console.log(`imagery requests by t=${actual.toFixed(2)} s: ${JSON.stringify(imageryNet)}`);
    const camera = await page.evaluate(() => {
      const v = window.__riverEye.viewer, C = window.Cesium, p = v.camera.positionCartographic;
      return { lon: +(C.Math.toDegrees(p.longitude)).toFixed(5), lat: +(C.Math.toDegrees(p.latitude)).toFixed(5),
        height: +p.height.toFixed(1), heading: +C.Math.toDegrees(v.camera.heading).toFixed(1),
        pitch: +C.Math.toDegrees(v.camera.pitch).toFixed(1),
        tilesLoaded: v.scene.globe.tilesLoaded, imageryLayers: v.imageryLayers.length };
    });
    console.log(`camera at dam detail: ${JSON.stringify(camera)}`);
  }
  if (ft === 7.4 || ft === 7.8 || ft === 21.8 || ft === 23.0 || ft === 24.1) {
    const camera = await page.evaluate(() => {
      const v = window.__riverEye.viewer, C = window.Cesium, p = v.camera.positionCartographic;
      const look = v.camera.positionCartographic;
      return { lon: +(C.Math.toDegrees(look.longitude)).toFixed(5), lat: +(C.Math.toDegrees(look.latitude)).toFixed(5),
        height: +look.height.toFixed(1), heading: +C.Math.toDegrees(v.camera.heading).toFixed(1), pitch: +C.Math.toDegrees(v.camera.pitch).toFixed(1),
        tilesLoaded: v.scene.globe.tilesLoaded, preview: document.querySelector(".analysis-preview-card")?.innerText ?? null };
    });
    console.log(`camera/preview at film t=${actual.toFixed(2)} s: ${JSON.stringify(camera)}`);
  }
}
await page.waitForFunction(() => window.__metrics.end, null, { timeout: 120000 });
const m = await page.evaluate(() => window.__metrics);
const fr = m.frames.slice().sort((a, b) => a - b);
const pct = (q) => fr[Math.min(fr.length - 1, Math.floor(fr.length * q))];
console.log(`film duration (wall clock, start->complete): ${((m.end - m.start) / 1000).toFixed(2)} s (director reports ${m.wall?.toFixed(2)} s)`);
console.log(`frames: ${fr.length}, avg fps ${(1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)).toFixed(1)}, median ${pct(0.5).toFixed(1)} ms, p95 ${pct(0.95).toFixed(1)} ms, max ${fr[fr.length - 1].toFixed(1)} ms`);
console.log(`hitches >150 ms [film t, ms]: ${JSON.stringify(m.hitches)}`);
console.log(`long tasks during film: ${m.longTasks.length}, total ${m.longTasks.reduce((a, b) => a + b, 0).toFixed(0)} ms, max ${Math.max(0, ...m.longTasks).toFixed(0)} ms`);
console.log(`requests: ${requestUrls.size} unique URLs, ${duplicateRequests} repeated URLs, ${failedRequests} failed (non-abort)`);
console.log(`JS heap: end ${await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null) ?? "unavailable"}, sampled peak ${Math.max(0, ...m.heap).toLocaleString()} bytes`);
if (process.argv.includes("--handoff")) {
  await page.waitForFunction(() => window.__metrics.gisReady, null, { timeout: 180000 });
  console.log(`GIS handoff ready: ${((await page.evaluate(() => window.__metrics.gisReady)) - m.end).toFixed(0)} ms after film end`);
  const sameViewer = await page.evaluate(() => {
    const viewer = window.__riverEye.viewer;
    window.__riverEye.restart();
    return viewer === window.__riverEye.viewer;
  });
  await page.waitForFunction(() => window.__riverEye?.t < 1, null, { timeout: 5000 });
  console.log(`Replay reuses cinematic viewer: ${sameViewer}`);
}
await browser.close();
