// Screenshot of the GIS digital-twin view (?mode=gis) after it finishes loading.
import { chromium } from "playwright";
const b = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto(`http://localhost:${process.env.PORT || 5190}/?mode=gis`, { waitUntil: "domcontentloaded" });
await p.waitForSelector("#loading.hidden", { timeout: 240000, state: "attached" });
await p.waitForTimeout(4000);
await p.screenshot({ path: "audit-screenshots/gis.png" });
console.log("wl:", await p.locator(".brand-wl").innerText());
await p.screenshot({ path: "audit-screenshots/gis-brand.png", clip: { x: 0, y: 0, width: 560, height: 260 } });
await b.close();
