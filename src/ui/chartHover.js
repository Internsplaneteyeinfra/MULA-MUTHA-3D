/**
 * Hover crosshair + tooltip for SVG charts (fullscreen Charts panel).
 *
 * spec: {
 *   L: { padL, padT, plotW, plotH },
 *   xs, scX, scY, fmtX, unit, decimals, lineColor,
 *   series: [{ label, color, ys, unit?, dot?, fmt? }],
 *   subtitle?: string
 * }
 */
const SVG_NS = "http://www.w3.org/2000/svg";

function ensureStyles() {
  let s = document.getElementById("chart-hover-styles");
  if (!s) {
    s = document.createElement("style");
    s.id = "chart-hover-styles";
    document.head.appendChild(s);
  }
  s.textContent = `
.chart-tip {
  position: absolute;
  z-index: 40;
  min-width: 168px;
  max-width: min(320px, 70vw);
  padding: 10px 12px;
  background: linear-gradient(165deg, rgba(18, 42, 54, 0.96), rgba(8, 22, 30, 0.96));
  border: 1px solid rgba(91, 200, 232, 0.4);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(91, 200, 232, 0.12);
  pointer-events: none;
  font-size: 12px;
  color: #eaf8fb;
  backdrop-filter: blur(10px);
}
.chart-tip[hidden] { display: none !important; }
.chart-tip__title {
  font-weight: 800;
  margin-bottom: 6px;
  letter-spacing: 0.04em;
  color: #dff8ff;
}
.chart-tip__sub {
  font-size: 10px;
  color: rgba(190, 220, 230, 0.72);
  margin: -2px 0 6px;
}
.chart-tip__row {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.65;
}
.chart-tip__row .sw {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
  box-shadow: 0 0 6px currentColor;
}
.chart-tip__row .lb { color: rgba(190, 220, 230, 0.75); flex: 1; min-width: 0; }
.chart-tip__row .vl {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #ffffff;
  white-space: nowrap;
}
.hip-svg-wrap { touch-action: none; }
.hip-svg-wrap svg { cursor: crosshair; }
`;
}

function mk(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function fmtVal(v, decimals, unit) {
  if (!Number.isFinite(v)) return "—";
  const text = Number(v).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${text} ${unit}` : text;
}

/**
 * Attach interactive hover to a chart SVG inside `.hip-svg-wrap`.
 */
export function attachChartHover(svg, spec) {
  if (!svg || !spec?.xs?.length || !spec?.series?.length) return;
  ensureStyles();
  const {
    L,
    xs,
    scX,
    scY,
    series,
    fmtX = String,
    unit = "",
    decimals = 2,
    lineColor = "rgba(223, 248, 255, 0.55)",
    subtitle = "",
  } = spec;

  // Remove prior hover layer if re-binding the same svg
  svg.querySelectorAll(":scope > .chart-hover-layer, :scope > .chart-hover-hit").forEach((n) => n.remove());

  const g = mk("g", { class: "chart-hover-layer", "pointer-events": "none" });
  g.style.display = "none";
  const line = mk("line", {
    y1: L.padT,
    y2: L.padT + L.plotH,
    stroke: lineColor,
    "stroke-width": 1.25,
    "stroke-dasharray": "4,3",
    opacity: 0.75,
  });
  g.appendChild(line);
  const dots = series.map((s) => {
    const c = mk("circle", {
      r: s.dot === false ? 0 : 5,
      fill: s.color,
      stroke: "#fff",
      "stroke-width": 2,
    });
    g.appendChild(c);
    return c;
  });
  svg.appendChild(g);

  const hit = mk("rect", {
    class: "chart-hover-hit",
    x: L.padL,
    y: L.padT,
    width: Math.max(1, L.plotW),
    height: Math.max(1, L.plotH),
    fill: "transparent",
    style: "cursor:crosshair",
  });
  svg.appendChild(hit);

  const wrap = svg.closest(".hip-svg-wrap") || svg.parentElement;
  if (!wrap) return;
  if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
  wrap.querySelectorAll(":scope > .chart-tip").forEach((n) => n.remove());
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  wrap.appendChild(tip);

  const pxs = xs.map((x) => scX(x));

  function onLeave() {
    g.style.display = "none";
    tip.hidden = true;
  }

  function nearestIndex(px) {
    let i = 0;
    let best = Infinity;
    for (let k = 0; k < pxs.length; k++) {
      const d = Math.abs(pxs[k] - px);
      if (d < best) {
        best = d;
        i = k;
      }
    }
    return i;
  }

  function onMove(e) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const i = nearestIndex(p.x);
    const x = pxs[i];
    if (!Number.isFinite(x)) {
      onLeave();
      return;
    }
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);

    let rows = "";
    let any = false;
    series.forEach((s, j) => {
      const v = Number(s.ys?.[i]);
      const ok = Number.isFinite(v);
      if (!ok) {
        dots[j].style.display = "none";
        return;
      }
      any = true;
      const u = s.unit != null ? s.unit : unit;
      // Never place a hover marker on the primary Y-scale when units differ
      // (e.g. Stage m / Rain mm/h on a Discharge m³/s chart).
      const sameAxis = !u || !unit || u === unit;
      const showDot = s.dot !== false && sameAxis;
      dots[j].style.display = showDot ? "" : "none";
      if (showDot) {
        const cy = scY(v);
        if (Number.isFinite(cy) && cy >= L.padT - 2 && cy <= L.padT + L.plotH + 2) {
          dots[j].setAttribute("cx", x);
          dots[j].setAttribute("cy", cy);
        } else {
          dots[j].style.display = "none";
        }
      }
      const text = s.fmt ? s.fmt(v, i) : fmtVal(v, s.decimals ?? decimals, u);
      rows +=
        `<div class="chart-tip__row"><span class="sw" style="background:${s.color}"></span>` +
        `<span class="lb">${s.label}</span><span class="vl">${text}</span></div>`;
    });
    if (!any) {
      onLeave();
      return;
    }

    g.style.display = "";
    tip.innerHTML =
      `<div class="chart-tip__title">${fmtX(xs[i], i)}</div>` +
      (subtitle ? `<div class="chart-tip__sub">${subtitle}</div>` : "") +
      rows;
    tip.hidden = false;

    const wr = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth || 180;
    const th = tip.offsetHeight || 80;
    let left = e.clientX - wr.left + 16;
    if (left + tw > wr.width - 6) left = e.clientX - wr.left - tw - 16;
    let top = e.clientY - wr.top - th / 2;
    top = Math.max(4, Math.min(wr.height - th - 4, top));
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${top}px`;
  }

  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerleave", onLeave);
  hit.addEventListener("pointerdown", onMove);
}
