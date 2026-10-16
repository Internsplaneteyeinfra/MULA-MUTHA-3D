import { chromium } from "playwright";
const times = (process.argv[2] || "0.5,3.9").split(",").map(Number);
const out = (process.env.SHOT_DIR || "audit-screenshots");
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const hook = (page) => { page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log("[console." + m.type() + "]", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 400))); };
for (const t of times) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  hook(page);
  await page.goto(`http://localhost:${process.env.PORT || 5190}/?t=${t}`, { waitUntil: "domcontentloaded" });
  try { await page.waitForFunction(() => window.__riverEye, null, { timeout: 120000 }); } catch (e) { console.log("never ready", t); await page.screenshot({ path: `${out}/fail_${t}.png` }); await page.close(); continue; }
  // wait for tiles to settle
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => window.__riverEye.tilesLoaded())) break; }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/t_${t}.png`, timeout: 120000 });
  console.log("shot", t);
  await page.close();
}
await browser.close();
