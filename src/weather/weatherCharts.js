/**
 * Weather Charts - SVG Builders for the Weather Overview overlay.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function niceScale(min, max, tickCount = 4) {
  const span = Math.max(1e-6, max - min);
  const rawStep = span / tickCount;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / mag;
  let step;
  if (residual <= 1.5) step = mag;
  else if (residual <= 3) step = 2 * mag;
  else if (residual <= 7) step = 5 * mag;
  else step = 10 * mag;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return { min: niceMin, max: niceMax === niceMin ? niceMin + step : niceMax, ticks };
}

function formatTick(v) {
  const abs = Math.abs(v);
  if (abs >= 10) return v.toFixed(0);
  return abs < 1 && abs > 0 ? v.toFixed(1) : v.toFixed(0);
}

export function renderLineChart({ days, values, color, threshold = null }) {
  const w = 320;
  const h = 140;
  const padL = 30;
  const padR = 10;
  const padT = 10;
  const padB = 25;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  
  const nums = values.filter(Number.isFinite);
  if (!nums.length) return "";

  let yMin = Math.min(...nums);
  let yMax = Math.max(...nums);
  
  if (yMax - yMin < 1e-3) yMax = yMin + 2;
  // Ensure starting at 0 for reasonable scales if min is positive but small
  if (yMin > 0 && yMin < yMax * 0.5) yMin = 0;
  
  const nice = niceScale(yMin, yMax, 4);
  yMin = nice.min;
  yMax = nice.max;
  
  if (threshold !== null) {
      yMax = Math.max(yMax, threshold * 1.1);
  }

  const n = days.length;
  const xOf = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yOf = (v) => padT + ((yMax - v) / Math.max(1e-6, yMax - yMin)) * plotH;

  const gridLines = nice.ticks
    .map((v) => {
      const y = yOf(v);
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.1)" stroke-dasharray="3 3" />
        <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.6)" font-size="10">${formatTick(v)}</text>`;
    })
    .join("");

  const xLabels = days
    .map((d, i) => {
      const x = xOf(i);
      const isToday = d.kind === "today";
      const fill = isToday ? "#fff" : "rgba(255,255,255,0.6)";
      const fw = isToday ? "bold" : "normal";
      return `<text x="${x.toFixed(1)}" y="${h - 5}" text-anchor="middle" fill="${fill}" font-weight="${fw}" font-size="10">${escapeHtml(d.date)}</text>`;
    })
    .join("");

  const pts = [];
  const dots = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(values[i])) continue;
    const cx = xOf(i).toFixed(1);
    const cy = yOf(values[i]).toFixed(1);
    pts.push(`${cx},${cy}`);
    dots.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${color}" stroke="#1a2530" stroke-width="1.5" />`);
  }
  
  let thresholdLine = "";
  let thresholdLabel = "";
  if (threshold !== null) {
      const ty = yOf(threshold).toFixed(1);
      thresholdLine = `<line x1="${padL}" y1="${ty}" x2="${padL + plotW}" y2="${ty}" stroke="#5bc8e8" stroke-dasharray="4 2" opacity="0.8" />`;
      thresholdLabel = `<text x="${padL + plotW}" y="${ty - 4}" text-anchor="end" fill="#5bc8e8" font-size="10" opacity="0.9">Moderate (0-50)</text>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%">
    ${gridLines}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.2)" />
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.2)" />
    ${thresholdLine}
    ${thresholdLabel}
    <polyline fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}" />
    ${dots.join("")}
    ${xLabels}
  </svg>`;
}

export function renderBarChart({ days, values, color, aqiMode = false }) {
  const w = 320;
  const h = 140;
  const padL = 30;
  const padR = 10;
  const padT = 10;
  const padB = 25;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const nums = values.filter(Number.isFinite);
  if (!nums.length) return "";

  let yMin = 0;
  let yMax = Math.max(...nums);
  if (yMax < 1e-3) yMax = 1;
  
  // AQI bounds
  if (aqiMode) {
      yMax = Math.max(yMax, 40);
  }

  const nice = niceScale(yMin, yMax, 4);
  yMax = nice.max;

  const n = days.length;
  const xOf = (i) => padL + (i + 0.5) * (plotW / n);
  const yOf = (v) => padT + ((yMax - v) / yMax) * plotH;

  const gridLines = nice.ticks
    .map((v) => {
      const y = yOf(v);
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.1)" stroke-dasharray="3 3" />
        <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="rgba(255,255,255,0.6)" font-size="10">${formatTick(v)}</text>`;
    })
    .join("");

  const xLabels = days
    .map((d, i) => {
      const x = xOf(i);
      const isToday = d.kind === "today";
      const fill = isToday ? "#fff" : "rgba(255,255,255,0.6)";
      const fw = isToday ? "bold" : "normal";
      return `<text x="${x.toFixed(1)}" y="${h - 5}" text-anchor="middle" fill="${fill}" font-weight="${fw}" font-size="10">${escapeHtml(d.date)}</text>`;
    })
    .join("");

  const bw = Math.max(8, (plotW / n) * 0.6);
  
  let thresholdLine = "";
  if (aqiMode) {
      const ty = yOf(25).toFixed(1);
      thresholdLine = `<line x1="${padL}" y1="${ty}" x2="${padL + plotW}" y2="${ty}" stroke="#4ade80" stroke-dasharray="4 2" opacity="0.8" />
      <text x="${padL + plotW}" y="${ty - 4}" text-anchor="end" fill="#4ade80" font-size="10" opacity="0.9">Good (0-25)</text>`;
  }

  const bars = values
    .map((v, i) => {
      if (!Number.isFinite(v)) return "";
      const cx = xOf(i);
      const x = cx - bw / 2;
      const y = yOf(v);
      const bh = Math.max(2, yOf(0) - y);
      
      let barColor = color;
      if (aqiMode) {
          if (v <= 25) barColor = "#4ade80"; // Good
          else if (v <= 50) barColor = "#facc15"; // Moderate
          else if (v <= 100) barColor = "#fb923c"; // Poor
          else barColor = "#ef4444"; // Very Poor
      }

      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${barColor}" rx="2" opacity="0.9" />`;
    })
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%">
    ${gridLines}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.2)" />
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.2)" />
    ${bars}
    ${thresholdLine}
    ${xLabels}
  </svg>`;
}
