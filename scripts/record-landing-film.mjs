/**
 * Record the live CesiumJS landing film into a stored video (public/video/landing-film.mp4).
 *
 * The page is opened in capture mode (?capture=1). For every output frame the film is set to that exact time,
 * the recorder waits until the frame's satellite tiles (and, around the underwater cut, the fish scene) are
 * loaded, then screenshots the page — so every frame is fully sharp, however slow the tiles are to arrive.
 * Frames are piped into ffmpeg (H.264, +faststart so playback starts before the file is downloaded).
 *
 * Needs: a built app served locally (npm run build && npm start), ffmpeg on PATH, a GPU.
 *
 *   node scripts/record-landing-film.mjs [--url http://localhost:4183/] [--fps 30]
 *        [--width 1920] [--height 1080] [--crf 20] [--maxrate 12M] [--out public/video/landing-film.mp4]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const URL_BASE = arg("url", "http://localhost:4183/");
const FPS = Number(arg("fps", 30));
const W = Number(arg("width", 1920));
const H = Number(arg("height", 1080));
const CRF = String(arg("crf", 20));
// Bitrate cap keeps the file web-sized (~12 Mbit/s → ~40 MB for 26 s) so it streams instantly.
const MAXRATE = String(arg("maxrate", "12M"));
const OUT = arg("out", "public/video/landing-film.mp4");
const MAX_WAIT_MS = Number(arg("max-wait", 25000));
const FROM = Number(arg("from", 0));
const TO = arg("to", null);

mkdirSync(dirname(OUT), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--force_high_performance_gpu"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.warn("[page error]", String(e).slice(0, 200)));

const url = new URL(URL_BASE);
url.searchParams.set("capture", "1");
console.info("Opening", url.href);
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__filmCapture, null, { timeout: 300000 });
const duration = await page.evaluate(() => window.__filmCapture.duration);
const end = TO != null ? Math.min(Number(TO), duration) : duration;
const frames = Math.round((end - FROM) * FPS) + 1;
console.info(`Recording ${frames} frames (${FROM}–${end} s) at ${W}×${H}, ${FPS} fps → ${OUT}`);

const ff = spawn(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", CRF, "-maxrate", MAXRATE, "-bufsize", "24M",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
    "-movflags", "+faststart", "-an",
    OUT,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const ffDone = new Promise((res, rej) => {
  ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
});
const write = (buf) =>
  new Promise((res) => {
    if (ff.stdin.write(buf)) res();
    else ff.stdin.once("drain", res);
  });

/** Set the film time and wait until the frame is complete (tiles in, two stable checks, HUD updated). */
async function settleAt(t) {
  await page.evaluate((tt) => window.__filmCapture.setTime(tt), t);
  return page.evaluate(
    ({ maxWait }) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let stable = 0;
        const tick = () => {
          const ok = window.__filmCapture.settled();
          stable = ok ? stable + 1 : 0;
          const waited = performance.now() - t0;
          // ≥ 3 settled frames and ≥ 180 ms (HUD state updates every 125 ms).
          if ((stable >= 3 && waited >= 180) || waited > maxWait) resolve({ waited, timedOut: !ok });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { maxWait: MAX_WAIT_MS },
  );
}

const started = Date.now();
let timeouts = 0;
for (let i = 0; i < frames; i++) {
  const t = FROM + i / FPS;
  const r = await settleAt(t);
  if (r.timedOut) timeouts++;
  const jpg = await page.screenshot({ type: "jpeg", quality: 95 });
  await write(jpg);
  if (process.env.REC_DEBUG) console.info(`  t=${t.toFixed(3)} waited ${r.waited.toFixed(0)} ms${r.timedOut ? " (timeout)" : ""}`);
  if (i % FPS === 0 || i === frames - 1) {
    const el = (Date.now() - started) / 1000;
    const eta = (el / (i + 1)) * (frames - i - 1);
    console.info(`frame ${i + 1}/${frames}  t=${t.toFixed(2)} s  elapsed ${el.toFixed(0)} s  eta ${eta.toFixed(0)} s  tile timeouts ${timeouts}`);
  }
}
ff.stdin.end();
await ffDone;

// Web copies the landing page streams (master is too heavy to stream: ~11 Mbit/s).
const run = (args) =>
  new Promise((res, rej) => {
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`))));
  });
const dir = dirname(OUT);
const web = ["-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", "60", "-movflags", "+faststart", "-an"];
await run(["-i", OUT, ...web, "-maxrate", "5M", "-bufsize", "10M", "-level", "4.1", `${dir}/landing-film-1080.mp4`]);
await run(["-i", OUT, "-vf", "scale=1280:720:flags=lanczos", ...web, "-maxrate", "2.5M", "-bufsize", "5M", "-level", "4.0", `${dir}/landing-film-720.mp4`]);
await run(["-i", OUT, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4", `${dir}/landing-film-poster.jpg`]);
console.info("Web copies: landing-film-1080.mp4, landing-film-720.mp4, landing-film-poster.jpg");
await browser.close();
console.info(`Done → ${OUT} (${((Date.now() - started) / 1000).toFixed(0)} s, ${timeouts} frames hit the tile wait limit)`);
