import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const out = process.env.SHOT_DIR || "audit-screenshots/cinematic-final";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[console error]", m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT || 5190}/?quality=low`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__riverEye?.viewer, null, { timeout: 300000, polling: 50 });
await page.evaluate(() => window.__riverEye.pause());

const marks = process.argv.includes("--gorge-only")
  ? [[7.4, "gorge-7.4"], [7.8, "gorge-7.8"]]
  : process.argv.includes("--preview-only")
  ? [[22.4, "lithology-22.4"], [23.0, "lithology-23.0"], [23.6, "flood-23.6"], [24.1, "flood-24.1"], [25.3, "final-water-brand"]]
  : [
  [7.4, "gorge-7.4"], [7.8, "gorge-7.8"], [21.8, "pullback-21.8"],
  [22.4, "lithology-22.4"], [23.0, "lithology-23.0"],
  [23.6, "flood-23.6"], [24.1, "flood-24.1"], [25.3, "final-water-brand"],
  ];
for (const [time, name] of marks) {
  await page.evaluate((t) => window.__riverEye.seek(t), time);
  await page.waitForTimeout([7.4, 7.8, 23.0, 24.1].includes(time) ? 5000 : 1800);
  const state = await page.evaluate(() => {
    const { viewer, Cesium, t } = window.__riverEye;
    const p = viewer.camera.positionCartographic;
    const pose = window.__riverEye.cameraPose();
    return {
      time: +t.toFixed(2),
      camera: { lon: +Cesium.Math.toDegrees(p.longitude).toFixed(5), lat: +Cesium.Math.toDegrees(p.latitude).toFixed(5),
        height: +p.height.toFixed(1), heading: +Cesium.Math.toDegrees(viewer.camera.heading).toFixed(1), pitch: +Cesium.Math.toDegrees(viewer.camera.pitch).toFixed(1),
        targetRange: +Math.exp(pose[5]).toFixed(1), targetLon: +pose[0].toFixed(5), targetLat: +pose[1].toFixed(5) },
      tilesLoaded: viewer.scene.globe.tilesLoaded,
      imageryLayers: viewer.imageryLayers.length,
      previewStatus: window.__riverEye.previewStatus(),
      preview: document.querySelector(".analysis-preview-card")?.innerText ?? null,
      caption: document.querySelector(".scene-caption-overlay")?.innerText ?? null,
    };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name}: ${JSON.stringify(state)}`);
}
await browser.close();
