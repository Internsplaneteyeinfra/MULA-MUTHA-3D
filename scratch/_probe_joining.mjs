// Probe Joining Streams: count, arrow stepping first→last (+wrap), card/brand BOD/COD.
// node scratch/_probe_joining.mjs   (dev server on :5185)
import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:5185/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function boot() {
  await page.goto(`${URL}?probe=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__MM_SCENE__?.setJoiningStreams === "function", null, {
    timeout: 180000,
  });
  await page.waitForTimeout(2500);
  return page.evaluate(() => window.__MM_SCENE__.setJoiningStreams(true));
}

const read = () =>
  page.evaluate(() => {
    const s = window.__MM_SCENE__.getJoiningStreamSelected();
    const q = (sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    return {
      nav: q("#js-nav-meta"),
      name: q("#js-nav-name"),
      chainM: Math.round(s?.riverChainageMeters ?? s?.nearestChainageMeters ?? NaN),
      card: q("#js-bod-rows"),
      brand: q(".water-telemetry-wq"),
    };
  });

async function run() {
  console.log("setJoiningStreams →", JSON.stringify(await boot()));
  const n = await page.evaluate(() => window.__MM_SCENE__.getJoiningStreamCount());
  console.log("count:", n);
  // Immediately after activation: card must already have numbers (no "Loading…")
  await page.waitForTimeout(400);
  console.log("initial:", JSON.stringify(await read()));

  // Walk to first with Prev, then forward through all + 1 (wrap check)
  for (let i = 0; i < n + 2; i++) {
    const r = await read();
    if (r.nav?.startsWith("1 /")) break;
    await page.evaluate(() => document.querySelector("#js-nav-prev").click());
    await page.waitForTimeout(250);
  }
  const seen = [];
  for (let i = 0; i <= n; i++) {
    await page.waitForTimeout(600);
    const r = await read();
    seen.push(r);
    console.log(`#${String(i).padStart(2)}`, JSON.stringify(r));
    await page.evaluate(() => document.querySelector("#js-nav-next").click());
  }
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector("#js-nav-prev").click());
  await page.waitForTimeout(600);
  console.log("prev from 1 →", JSON.stringify(await read()));

  const navs = seen.slice(0, n).map((r) => r.nav);
  const uniq = new Set(seen.slice(0, n).map((r) => r.name));
  const noBod = seen.filter((r) => !/BOD\s*[\d.]+ mg\/L/.test(r.card || ""));
  console.log("SUMMARY", JSON.stringify({
    count: n,
    sequential: navs.every((v, i) => v === `${i + 1} / ${n}`),
    uniqueNames: uniq.size,
    wrappedToFirst: seen[n]?.nav === `1 / ${n}`,
    missingBod: noBod.map((r) => r.nav),
  }));
}

try {
  await run();
} catch (e) {
  console.log("first attempt failed:", String(e).split("\n")[0], "— retrying once");
  await run();
} finally {
  await browser.close();
}
