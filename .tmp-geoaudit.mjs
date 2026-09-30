import { chromium } from "playwright";
import fs from "node:fs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto("http://localhost:5176", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForFunction(() => !!window.__MM_SCENE__?.dataset, null, { timeout: 300000 });
await p.waitForFunction(() => {
  const s = window.__MM_SCENE__.scene;
  const g = (n) => s.getObjectByName(n);
  const has = (n) => { let k = 0; g(n)?.traverse((o) => { if (o.isInstancedMesh) k++; }); return k > 0; };
  return has("vegetation") && has("vegetationTypePermanent");
}, null, { timeout: 400000, polling: 3000 }).catch(() => console.log("WARN: vegetation groups not all ready"));
await wait(5000);

const out = await p.evaluate(async () => {
  const S = window.__MM_SCENE__;
  const ds = S.dataset;
  const frame = ds.frame;
  const ring = ds.ringLocal;
  const idx = await (await fetch("/data/hydrology/lulc/index.json")).json();
  const anchors = {
    2026: [["Water", 0, 72, 224], ["Settlements", 224, 0, 0], ["Forest", 0, 104, 0], ["Crop", 248, 208, 0], ["Barren", 144, 72, 0]],
    2025: [["Water", 0, 136, 248], ["Settlements", 200, 0, 0], ["Forest", 0, 104, 0], ["Crop", 240, 144, 0], ["Barren", 176, 176, 176]],
  };
  async function loadLulc(year) {
    const e = idx.years.find((y) => y.year === year);
    const bm = await createImageBitmap(await (await fetch(e.overlay)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height);
    const g = c.getContext("2d");
    g.drawImage(bm, 0, 0);
    const d = g.getImageData(0, 0, bm.width, bm.height).data;
    const { north, south, east, west } = e.bounds;
    const W = bm.width, H = bm.height, A = anchors[year];
    return (lon, lat) => {
      if (lon < west || lon > east || lat < south || lat > north) return null;
      const px = Math.min(W - 1, Math.floor(((lon - west) / (east - west)) * W));
      const py = Math.min(H - 1, Math.floor(((north - lat) / (north - south)) * H));
      const i = (py * W + px) * 4;
      if (d[i + 3] < 20) return null;
      let best = null, bd = Infinity;
      for (const [n, r, gg, bb] of A) { const q = (d[i] - r) ** 2 + (d[i + 1] - gg) ** 2 + (d[i + 2] - bb) ** 2; if (q < bd) { bd = q; best = n; } }
      return best;
    };
  }
  const L26 = await loadLulc(2026);
  const L25 = await loadLulc(2025);

  // --- rasterise polygon on a 10 m local grid (scanline) ---
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of ring) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); }
  const M = 400, C = 10;
  minX -= M; maxX += M; minZ -= M; maxZ += M;
  const NX = Math.ceil((maxX - minX) / C), NZ = Math.ceil((maxZ - minZ) / C);
  const P = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) {
    const z = minZ + (j + 0.5) * C;
    const xs = [];
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const a = ring[i], b = ring[k];
      if ((a.z > z) !== (b.z > z)) xs.push(a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));
    }
    xs.sort((a, b) => a - b);
    for (let t = 0; t + 1 < xs.length; t += 2) {
      const i0 = Math.max(0, Math.ceil((xs[t] - minX) / C - 0.5)), i1 = Math.min(NX - 1, Math.floor((xs[t + 1] - minX) / C - 0.5));
      for (let i = i0; i <= i1; i++) P[j * NX + i] = 1;
    }
  }
  const inPoly = (x, z) => { const i = Math.floor((x - minX) / C), j = Math.floor((z - minZ) / C); return i >= 0 && j >= 0 && i < NX && j < NZ && P[j * NX + i] === 1; };

  // corridor = within 300 m of a chainage station
  const ch = ds.chainage;
  const HB = 300, hash = new Map();
  for (const s of ch) { const k = `${Math.floor(s.x / HB)},${Math.floor(s.z / HB)}`; if (!hash.has(k)) hash.set(k, []); hash.get(k).push(s); }
  const nearCorr = (x, z) => { const cx = Math.floor(x / HB), cz = Math.floor(z / HB); for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const s of hash.get(`${cx + a},${cz + c}`) || []) if ((s.x - x) ** 2 + (s.z - z) ** 2 < HB * HB) return true; return false; };

  const Wm = new Uint8Array(NX * NZ), Corr = new Uint8Array(NX * NZ);
  const polyClass = {}; let polyCells = 0, polyCorr = 0;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = minX + (i + 0.5) * C, z = minZ + (j + 0.5) * C;
    if (!nearCorr(x, z)) continue;
    Corr[j * NX + i] = 1;
    const ll = frame.toLonLat(x, z);
    const c = L26(ll.lon, ll.lat);
    if (c === "Water") Wm[j * NX + i] = 1;
    if (P[j * NX + i]) { polyCorr++; polyClass[c] = (polyClass[c] || 0) + 1; }
  }
  for (const v of P) polyCells += v;
  let wCount = 0; for (let k = 0; k < Wm.length; k++) wCount += Wm[k];
  const shifts = [];
  for (let dj = -10; dj <= 10; dj++) for (let di = -10; di <= 10; di++) {
    let inter = 0, pc = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      if (!P[j * NX + i] || !Corr[j * NX + i]) continue;
      pc++;
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < NX && jj < NZ && Wm[jj * NX + ii]) inter++;
    }
    shifts.push({ dx: di * C, dz: dj * C, iou: inter / (pc + wCount - inter), precision: inter / pc, recall: inter / wCount });
  }
  shifts.sort((a, b) => b.iou - a.iou);
  const zero = shifts.find((s) => s.dx === 0 && s.dz === 0);

  // --- control points ---
  const targets = [0, 622, 3450, 5970, 8000, 10752, 12000, 16960];
  const nearestCh = (m) => ch.reduce((a, s) => (Math.abs(s.meters - m) < Math.abs(a.meters - m) ? s : a), ch[0]);
  const control = targets.map((m) => {
    const s = nearestCh(m);
    const k = ch.indexOf(s);
    const a = ch[Math.max(0, k - 3)], bb = ch[Math.min(ch.length - 1, k + 3)];
    let tx = bb.x - a.x, tz = bb.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const re = frame.projectLonLat(s.lon, s.lat);
    const back = frame.toLonLat(s.x, s.z);
    const samples = [];
    for (let d = -400; d <= 400; d += 2) {
      const x = s.x + nx * d, z = s.z + nz * d, ll = frame.toLonLat(x, z);
      samples.push({ d, c26: L26(ll.lon, ll.lat), c25: L25(ll.lon, ll.lat), poly: inPoly(x, z) });
    }
    const run = (pred) => {
      let c0 = null, best = Infinity;
      samples.forEach((q, i) => { if (pred(q) && Math.abs(q.d) < best && Math.abs(q.d) <= 150) { best = Math.abs(q.d); c0 = i; } });
      if (c0 == null) return null;
      let l = c0, r = c0, gap = 0;
      for (let i = c0 - 1; i >= 0; i--) { if (pred(samples[i])) { l = i; gap = 0; } else if (++gap > 3) break; }
      gap = 0;
      for (let i = c0 + 1; i < samples.length; i++) { if (pred(samples[i])) { r = i; gap = 0; } else if (++gap > 3) break; }
      return { left: samples[l].d, right: samples[r].d, width: samples[r].d - samples[l].d, mid: (samples[l].d + samples[r].d) / 2 };
    };
    const lw = run((q) => q.c26 === "Water"), lw25 = run((q) => q.c25 === "Water"), pw = run((q) => q.poly);
    const bank = (from, dir) => { const out = {}; if (!from) return out; for (let i = 0; i < samples.length; i++) { const q = samples[i]; if (dir < 0 ? q.d < from.left && q.d >= from.left - 60 : q.d > from.right && q.d <= from.right + 60) out[q.c26] = (out[q.c26] || 0) + 1; } return out; };
    return {
      target: m, label: s.label, lon: +s.lon.toFixed(6), lat: +s.lat.toFixed(6),
      utm: [Math.round(re.easting), Math.round(re.northing)], local: [+s.x.toFixed(1), +s.z.toFixed(1)],
      roundTripM: +Math.hypot(re.x - s.x, re.z - s.z).toFixed(3), inverseErrDeg: +Math.max(Math.abs(back.lon - s.lon), Math.abs(back.lat - s.lat)).toExponential(1),
      centreClass26: samples.find((q) => q.d === 0).c26, centreInPoly: samples.find((q) => q.d === 0).poly,
      lulc26: lw, lulc25: lw25, polygon: pw,
      edgeDelta: lw && pw ? [pw.left - lw.left, pw.right - lw.right] : null,
      bankLeft60m: bank(pw, -1), bankRight60m: bank(pw, 1),
    };
  });

  // --- bathymetry vs LULC / polygon ---
  const bath = { n: 0, water26: 0, water25: 0, inPoly: 0, cls: {} };
  for (const q of ds.points || []) {
    const ll = frame.toLonLat(q.x, q.z);
    bath.n++;
    const c = L26(ll.lon, ll.lat); bath.cls[c] = (bath.cls[c] || 0) + 1;
    if (c === "Water") bath.water26++;
    if (L25(ll.lon, ll.lat) === "Water") bath.water25++;
    if (inPoly(q.x, q.z)) bath.inPoly++;
  }

  // --- vegetation instances vs LULC ---
  const veg = {};
  const m4 = new S.scene.matrixWorld.constructor(), v3 = new (S.scene.position.constructor)();
  const topName = (o) => { let t = o; const names = []; while (t && t.parent) { names.push(t.name); t = t.parent; } return names.reverse().filter(Boolean).slice(0, 2).join("/") || "(unnamed)"; };
  S.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.count) return;
    const key = topName(o);
    if (!/veget|ripar|tree|forest/i.test(key)) return;
    o.updateMatrixWorld(true);
    const e = veg[key] || (veg[key] = { n: 0, cls: {}, inPoly: 0 });
    const step = Math.max(1, Math.floor(o.count / 1500));
    for (let i = 0; i < o.count; i += step) {
      o.getMatrixAt(i, m4); m4.premultiply(o.matrixWorld); v3.setFromMatrixPosition(m4);
      const ll = frame.toLonLat(v3.x, v3.z);
      const c = L26(ll.lon, ll.lat) || "outside";
      e.n++; e.cls[c] = (e.cls[c] || 0) + 1; if (inPoly(v3.x, v3.z)) e.inPoly++;
    }
  });
  const pct = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(100 * v / n).toFixed(1)]));
  for (const k in veg) { veg[k].clsPct = pct(veg[k].cls, veg[k].n); veg[k].inPolyPct = +(100 * veg[k].inPoly / veg[k].n).toFixed(1); delete veg[k].cls; delete veg[k].inPoly; }

  const ringLL = ds.ringGeo;
  const bboxLL = (arr) => ({ minLon: Math.min(...arr.map((q) => q.lon)), maxLon: Math.max(...arr.map((q) => q.lon)), minLat: Math.min(...arr.map((q) => q.lat)), maxLat: Math.max(...arr.map((q) => q.lat)) });
  return {
    origin: { lon: ds.validation?.origin, E0: frame.originE, N0: frame.originN, flipX: frame.flipX, crs: frame.crs },
    sources: { river: ds.validation?.riverSource, ringVerts: ring.length, centerlineVerts: ds.centerlineLocal?.length, chainage: ch.length, chFirst: ch[0]?.label, chLast: ch[ch.length - 1]?.label },
    bbox: { polygon: bboxLL(ringLL), chainage: bboxLL(ch), lulc2026: idx.years.find((y) => y.year === 2026).bounds, lulc2025: idx.years.find((y) => y.year === 2025).bounds },
    corridor: { polyCells10m: polyCells, polyCellsInCorridor: polyCorr, lulcWaterCellsInCorridor: wCount, polyClassPct: pct(polyClass, polyCorr), zeroShift: zero, bestShifts: shifts.slice(0, 5) },
    control, bath: { ...bath, water26Pct: +(100 * bath.water26 / bath.n).toFixed(1), water25Pct: +(100 * bath.water25 / bath.n).toFixed(1), inPolyPct: +(100 * bath.inPoly / bath.n).toFixed(1), clsPct: pct(bath.cls, bath.n) }, veg,
  };
});
fs.writeFileSync("audit-screenshots/geo-audit.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await b.close();
