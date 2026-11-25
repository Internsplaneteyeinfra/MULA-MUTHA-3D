/** Margin Board full status-colour cards — capture + validate. */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SHOT = path.resolve("scratch/screenshots/margin-board-full-colours");
fs.mkdirSync(SHOT, { recursive: true });
const BASE = process.env.APP_URL || "http://localhost:5185";
const jpg = (name) => ({ path: path.join(SHOT, name), type: "jpeg", quality: 58 });

const COLOURS = {
  danger: { bg: "#B3262D", border: "#FF6268" },
  warning: { bg: "#D96B16", border: "#FFAA45" },
  watch: { bg: "#C99A16", border: "#F5CD48" },
  safe: { bg: "#238044", border: "#56C77A" },
  unverified: { bg: "#3a4550", border: "#8a969f" },
};

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  colourSpec: COLOURS,
  checks: {},
  consoleErrors: [],
};

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || undefined,
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => {
  if (m.type() === "error") report.consoleErrors.push(m.text());
});

async function openCharts() {
  await page.goto(`${BASE}/?mbc=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForFunction(
    () => typeof window.__MM_HYDRO_INTEL__?.showAnalyticalCharts === "function",
    null,
    { timeout: 120000 },
  );
  await page.evaluate(() => {
    document.body.classList.add("dt-mode-active");
    window.__MM_HYDRO_INTEL__.showAnalyticalCharts();
    document.dispatchEvent(
      new CustomEvent("chainage-select", {
        detail: { meters: 8400, focus: true, source: "mbc" },
      }),
    );
  });
  await page.waitForSelector("#hip-g-hydro svg", { timeout: 180000 });
  await page.waitForTimeout(2000);
}

async function openMarginBoard() {
  await page.locator("#hip-margin-board-btn").click();
  await page.waitForSelector(".hip-mb-card", { timeout: 90000 });
  await page.waitForTimeout(1200);
}

async function closeMarginBoard() {
  const close = page.locator("#hip-mb-close");
  if (await close.count()) await close.click();
  await page.waitForTimeout(400);
}

async function setHistoric(date, time) {
  const hist = page.locator("#hip-mode-hist");
  if (!(await hist.evaluate((el) => el.classList.contains("active")))) {
    await hist.click();
    await page.waitForTimeout(2500);
  }
  await page.fill("#hip-hist-date", date);
  await page.selectOption("#hip-hist-time", time);
  await page.waitForTimeout(5000);
}

async function cardSnapshot() {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll(".hip-mb-card")];
    return cards.map((el) => {
      const cs = getComputedStyle(el);
      const badge = el.querySelector(".hip-mb-card__status");
      const bcs = badge ? getComputedStyle(badge) : null;
      const labels = [...el.querySelectorAll(".hip-mb-card__grid span")].map((s) =>
        s.textContent.trim(),
      );
      const bg = cs.backgroundImage !== "none" ? cs.backgroundImage : cs.backgroundColor;
      return {
        status: el.getAttribute("data-status"),
        badge: badge?.textContent?.trim() || "",
        name: el.querySelector(".hip-mb-card__name")?.textContent?.trim() || "",
        bg,
        border: cs.borderTopColor,
        color: cs.color,
        nameColor: getComputedStyle(el.querySelector(".hip-mb-card__name")).color,
        labelColor: el.querySelector(".hip-mb-card__grid span")
          ? getComputedStyle(el.querySelector(".hip-mb-card__grid span")).color
          : null,
        valueColor: el.querySelector(".hip-mb-card__grid b")
          ? getComputedStyle(el.querySelector(".hip-mb-card__grid b")).color
          : null,
        badgeBg: bcs?.backgroundColor || null,
        badgeColor: bcs?.color || null,
        fieldCount: labels.length,
        labels,
        h: Math.round(el.getBoundingClientRect().height),
      };
    });
  });
}

function rgbOf(cssColor) {
  const m = String(cssColor || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function nearHex(cssColor, hex, tol = 48) {
  const rgb = rgbOf(cssColor);
  if (!rgb) return false;
  const h = hex.replace("#", "");
  const er = parseInt(h.slice(0, 2), 16);
  const eg = parseInt(h.slice(2, 4), 16);
  const eb = parseInt(h.slice(4, 6), 16);
  return Math.abs(rgb[0] - er) <= tol && Math.abs(rgb[1] - eg) <= tol && Math.abs(rgb[2] - eb) <= tol;
}

function bgContainsHex(bgCss, hex, tol = 55) {
  // gradient → check for solid fallback via any rgb near target, or parse first rgb in string
  if (/gradient/i.test(bgCss || "")) {
    const matches = [...String(bgCss).matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/gi)];
    return matches.some((m) => {
      const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
      const h = hex.replace("#", "");
      const er = parseInt(h.slice(0, 2), 16);
      const eg = parseInt(h.slice(2, 4), 16);
      const eb = parseInt(h.slice(4, 6), 16);
      return Math.abs(rgb[0] - er) <= tol && Math.abs(rgb[1] - eg) <= tol && Math.abs(rgb[2] - eb) <= tol;
    });
  }
  return nearHex(bgCss, hex, tol);
}

const REQUIRED_FIELDS = [
  "Margin below danger",
  "Discharge Q",
  "River stage",
  "Water depth",
  "Danger level",
  "Bank height",
  "Q at danger",
  "72 h peak Q",
  "Forecast peak stage",
  "Peak timing",
  "Exceedance P72",
  "Rain now",
  "Rain past 24 h",
  "Rain next 24 h",
  "Most vulnerable CH",
  "Basis",
];

try {
  await openCharts();

  // --- LIVE SAFE (green) ---
  await openMarginBoard();
  let cards = await cardSnapshot();
  report.checks.liveSafe = {
    n: cards.length,
    statuses: cards.map((c) => c.status),
    disclaimer: await page.evaluate(
      () => document.querySelector(".hip-margin-board__disc")?.textContent || "",
    ),
    cards,
  };
  report.checks.sevenCardsLive = cards.length === 7;
  report.checks.liveAllSafe = cards.every((c) => c.status === "safe");
  report.checks.liveFullGreen = cards.every((c) => bgContainsHex(c.bg, "#238044"));
  report.checks.liveBorderGreen = cards.every((c) => nearHex(c.border, "#56C77A", 60));
  report.checks.fieldsIntact = cards.every((c) =>
    REQUIRED_FIELDS.every((f) => c.labels.includes(f)),
  );
  report.checks.disclaimerPresent = /MODELLED|PROVISIONAL|LOCKED/i.test(
    report.checks.liveSafe.disclaimer,
  );
  report.checks.whiteValues = cards.every((c) => {
    const v = rgbOf(c.valueColor);
    return v && v[0] >= 240 && v[1] >= 240 && v[2] >= 240;
  });
  await page.screenshot(jpg("01-live-safe-green-cards.jpg"));
  await page.locator(".hip-mb-card").first().screenshot({
    path: path.join(SHOT, "02-safe-card-detail.jpg"),
    type: "jpeg",
    quality: 70,
  });

  // Close / reopen
  await closeMarginBoard();
  report.checks.closed = await page.evaluate(
    () => document.querySelector("#hip-margin-board")?.hidden === true,
  );
  await openMarginBoard();
  report.checks.reopened = await page.evaluate(
    () =>
      document.querySelector("#hip-margin-board")?.hidden === false &&
      document.querySelectorAll(".hip-mb-card").length === 7,
  );
  await closeMarginBoard();

  // --- HISTORIC DANGER (red) ---
  await setHistoric("2024-07-15", "06:00");
  await openMarginBoard();
  cards = await cardSnapshot();
  report.checks.histDanger = {
    n: cards.length,
    statuses: cards.map((c) => c.status),
    cards: cards.map((c) => ({
      status: c.status,
      bg: c.bg,
      border: c.border,
      badge: c.badge,
    })),
  };
  report.checks.histAllDanger = cards.every((c) => c.status === "danger");
  report.checks.histFullRed = cards.every((c) => bgContainsHex(c.bg, "#B3262D"));
  report.checks.histBorderRed = cards.every((c) => nearHex(c.border, "#FF6268", 70));
  await page.screenshot(jpg("03-historic-danger-red-cards.jpg"));
  await page.locator(".hip-mb-card").first().screenshot({
    path: path.join(SHOT, "04-danger-card-detail.jpg"),
    type: "jpeg",
    quality: 70,
  });
  await closeMarginBoard();

  // --- HISTORIC WATCH + SAFE (yellow + green) ---
  await setHistoric("2024-06-26", "18:00");
  await openMarginBoard();
  cards = await cardSnapshot();
  report.checks.histWatchMix = {
    statuses: cards.map((c) => c.status),
    cards: cards.map((c) => ({ status: c.status, bg: c.bg, border: c.border, badge: c.badge })),
  };
  const watchCards = cards.filter((c) => c.status === "watch");
  report.checks.hasWatch = watchCards.length > 0;
  report.checks.watchFullYellow = watchCards.every((c) => bgContainsHex(c.bg, "#C99A16"));
  report.checks.watchBorderYellow = watchCards.every((c) => nearHex(c.border, "#F5CD48", 70));
  await page.screenshot(jpg("05-historic-watch-yellow-cards.jpg"));
  if (watchCards.length) {
    const idx = cards.findIndex((c) => c.status === "watch");
    await page.locator(".hip-mb-card").nth(idx).screenshot({
      path: path.join(SHOT, "06-watch-card-detail.jpg"),
      type: "jpeg",
      quality: 70,
    });
  }
  await closeMarginBoard();

  // --- HISTORIC WARNING (orange) ---
  await setHistoric("2024-07-06", "00:00");
  await openMarginBoard();
  cards = await cardSnapshot();
  report.checks.histWarningMix = {
    statuses: cards.map((c) => c.status),
    cards: cards.map((c) => ({ status: c.status, bg: c.bg, border: c.border, badge: c.badge })),
  };
  const warnCards = cards.filter((c) => c.status === "warning");
  report.checks.hasWarning = warnCards.length > 0;
  report.checks.warningFullOrange = warnCards.every((c) => bgContainsHex(c.bg, "#D96B16"));
  report.checks.warningBorderOrange = warnCards.every((c) => nearHex(c.border, "#FFAA45", 70));
  await page.screenshot(jpg("07-historic-warning-orange-cards.jpg"));
  if (warnCards.length) {
    const idx = cards.findIndex((c) => c.status === "warning");
    await page.locator(".hip-mb-card").nth(idx).screenshot({
      path: path.join(SHOT, "08-warning-card-detail.jpg"),
      type: "jpeg",
      quality: 70,
    });
  }

  // Inject UNVERIFIED grey card for colour proof (status mapping path)
  await page.evaluate(() => {
    const grid = document.querySelector("#hip-mb-grid");
    if (!grid) return;
    const art = document.createElement("article");
    art.className = "hip-mb-card";
    art.setAttribute("data-status", "unverified");
    art.innerHTML = `
      <header class="hip-mb-card__head">
        <div>
          <div class="hip-mb-card__name">UNVERIFIED DEMO</div>
          <div class="hip-mb-card__range">Status unavailable</div>
        </div>
        <span class="hip-mb-card__status">UNVERIFIED</span>
      </header>
      <div class="hip-mb-card__grid">
        <div><span>Margin below danger</span><b>N/A</b></div>
        <div><span>Basis</span><b>neutral grey when status missing</b></div>
      </div>`;
    grid.appendChild(art);
  });
  const unver = await page.evaluate(() => {
    const el = document.querySelector('.hip-mb-card[data-status="unverified"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundImage !== "none" ? cs.backgroundImage : cs.backgroundColor,
      border: cs.borderTopColor,
      badge: el.querySelector(".hip-mb-card__status")?.textContent,
    };
  });
  report.checks.unverified = unver;
  report.checks.unverifiedGrey = unver && bgContainsHex(unver.bg, "#3a4550", 70);
  await page.screenshot(jpg("09-unverified-grey-card.jpg"));
  await closeMarginBoard();

  // Responsive
  await page.locator("#hip-mode-live").click();
  await page.waitForTimeout(3000);
  await openMarginBoard();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(600);
  report.checks.responsive1600 = await page.evaluate(() => {
    const grid = getComputedStyle(document.querySelector(".hip-margin-board__grid"));
    return { cols: grid.gridTemplateColumns.split(" ").length };
  });
  await page.screenshot(jpg("10-responsive-1600x900.jpg"));

  await page.setViewportSize({ width: 780, height: 900 });
  await page.waitForTimeout(600);
  report.checks.responsive780 = await page.evaluate(() => {
    const grid = getComputedStyle(document.querySelector(".hip-margin-board__grid"));
    return { cols: grid.gridTemplateColumns.split(" ").length };
  });
  await page.screenshot(jpg("11-responsive-780-mobile.jpg"));

  await page.setViewportSize({ width: 1920, height: 1080 });
  await closeMarginBoard();

  // LIVE graphs still present
  report.checks.liveGraphsIntact = await page.evaluate(() => ({
    liveActive: document.querySelector("#hip-mode-live")?.classList.contains("active"),
    order: [...document.querySelectorAll(".hip-three > .hip-graph-section")].map((el) => el.id),
    hydroSvg: !!document.querySelector("#hip-g-hydro svg"),
  }));

  report.finishedAt = new Date().toISOString();
  const bools = {
    sevenCardsLive: report.checks.sevenCardsLive,
    liveAllSafe: report.checks.liveAllSafe,
    liveFullGreen: report.checks.liveFullGreen,
    liveBorderGreen: report.checks.liveBorderGreen,
    fieldsIntact: report.checks.fieldsIntact,
    disclaimerPresent: report.checks.disclaimerPresent,
    whiteValues: report.checks.whiteValues,
    closed: report.checks.closed,
    reopened: report.checks.reopened,
    histAllDanger: report.checks.histAllDanger,
    histFullRed: report.checks.histFullRed,
    histBorderRed: report.checks.histBorderRed,
    hasWatch: report.checks.hasWatch,
    watchFullYellow: report.checks.watchFullYellow,
    watchBorderYellow: report.checks.watchBorderYellow,
    hasWarning: report.checks.hasWarning,
    warningFullOrange: report.checks.warningFullOrange,
    warningBorderOrange: report.checks.warningBorderOrange,
    unverifiedGrey: report.checks.unverifiedGrey,
    liveGraphsIntact:
      report.checks.liveGraphsIntact.liveActive &&
      report.checks.liveGraphsIntact.hydroSvg &&
      report.checks.liveGraphsIntact.order.join(",") ===
        "hip-g-discharge,hip-g-stage,hip-g-hydro",
  };
  report.passSummary = bools;
  report.pass = Object.values(bools).every(Boolean);
  fs.writeFileSync(
    path.resolve("scratch/margin_board_colour_validation.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} catch (err) {
  report.error = err?.message || String(err);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.resolve("scratch/margin_board_colour_validation.json"),
    JSON.stringify(report, null, 2),
  );
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
