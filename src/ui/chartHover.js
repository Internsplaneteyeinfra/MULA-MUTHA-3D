/**
 * Hover crosshair + tooltip for SVG line charts (light glass panels).
 *
 * spec: {
 *   L: { padL, padT, plotW, plotH },
 *   xs, scX, scY, fmtX, unit, decimals, lineColor,
 *   series: [{ label, color, ys, dot?, fmt? }]
 * }
 */
const SVG_NS = "http://www.w3.org/2000/svg";

function ensureStyles() {
  if (document.getElementById("chart-hover-styles")) return;
  const s = document.createElement("style");
  s.id = "chart-hover-styles";
  s.textContent = `
.chart-tip {
  position: absolute;
  z-index: 5;
  min-width: 150px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 8px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
  pointer-events: none;
  font-size: 11px;
  color: #0f172a;
}
.chart-tip[hidden] { display: none; }
.chart-tip__title { font-weight: 800; margin-bottom: 5px; }
.chart-tip__row { display: flex; align-items: center; gap: 6px; line-height: 1.7; }
.chart-tip__row .sw { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
.chart-tip__row .lb { color: #475569; flex: 1; }
.chart-tip__row .vl { font-weight: 700; font-variant-numeric: tabular-nums; }
`;
  document.head.appendChild(s);
}

function mk(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

export function attachChartHover(svg, spec) {
  if (!svg || !spec?.xs?.length) return;
  ensureStyles();
  const {
    L, xs, scX, scY, series, fmtX = String, unit = "", decimals = 2, lineColor = "#0f172a",
  } = spec;

  const g = mk("g", { "pointer-events": "none" });
  g.style.display = "none";
  const line = mk("line", {
    y1: L.padT, y2: L.padT + L.plotH, stroke: lineColor, "stroke-width": 1, "stroke-dasharray": "3,3", opacity: 0.55,
  });
  g.appendChild(line);
  const dots = series.map((s) => {
    const c = mk("circle", { r: s.dot === false ? 0 : 4, fill: s.color, stroke: "#fff", "stroke-width": 1.8 });
    g.appendChild(c);
    return c;
  });
  svg.appendChild(g);

  const hit = mk("rect", {
    x: L.padL, y: L.padT, width: L.plotW, height: L.plotH, fill: "transparent", style: "cursor:crosshair",
  });
  svg.appendChild(hit);

  const wrap = svg.parentElement;
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

  function onMove(e) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    let i = 0;
    let best = Infinity;
    for (let k = 0; k < pxs.length; k++) {
      const d = Math.abs(pxs[k] - p.x);
      if (d < best) { best = d; i = k; }
    }
    const x = pxs[i];
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    let rows = "";
    series.forEach((s, j) => {
      const v = s.ys?.[i];
      const ok = v != null && Number.isFinite(v);
      dots[j].style.display = ok ? "" : "none";
      if (!ok) return;
      dots[j].setAttribute("cx", x);
      dots[j].setAttribute("cy", scY(v));
      const text = s.fmt ? s.fmt(v, i) : `${v.toFixed(decimals)} ${unit}`;
      rows += `<div class="chart-tip__row"><span class="sw" style="background:${s.color}"></span>` +
        `<span class="lb">${s.label}</span><span class="vl">${text}</span></div>`;
    });
    if (!rows) { onLeave(); return; }
    g.style.display = "";
    tip.innerHTML = `<div class="chart-tip__title">${fmtX(xs[i])}</div>${rows}`;
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = e.clientX - wr.left + 14;
    if (left + tw > wr.width - 4) left = e.clientX - wr.left - tw - 14;
    let top = e.clientY - wr.top - th / 2;
    top = Math.max(4, Math.min(wr.height - th - 4, top));
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${top}px`;
  }

  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerleave", onLeave);
}
