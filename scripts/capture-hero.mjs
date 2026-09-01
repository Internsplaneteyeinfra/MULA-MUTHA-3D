/** Single hero building close-up — bank-facing street camera */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.MM_URL || "http://localhost:5176";
const OUT = join(process.cwd(), "audit-screenshots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
    await wait(28000);

    await page.evaluate(() => {
      const ds = window.__MM_SCENE__?.dataset;
      const cam = window.__MM_SCENE__?.cam;
      const st = ds.corridor.stations[Math.floor(ds.corridor.stations.length * 0.58)];
      const px = -st.flowZ;
      const pz = st.flowX;
      cam.camera.position.set(st.x + px * 42, 16, st.z + pz * 42);
      cam.controls.target.set(st.x + px * 115, 11, st.z + pz * 115);
      cam.camera.lookAt(st.x + px * 115, 11, st.z + pz * 115);
      cam.controls.update();
    });
    await wait(3500);

    const dataUrl = await page.evaluate(() => document.getElementById("scene")?.toDataURL("image/png"));
    const buf = Buffer.from(dataUrl.split(",")[1], "base64");
    await writeFile(join(OUT, "A-building-closeup.png"), buf);
    console.log("A closeup:", (buf.length / 1024).toFixed(0), "KB");
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
