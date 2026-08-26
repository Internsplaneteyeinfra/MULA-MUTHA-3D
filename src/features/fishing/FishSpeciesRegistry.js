/**
 * Species registry — natural Indian-river fish look with readable scale (0.6–2.0 m).
 */
export const FISH_SPECIES = {
  // Variant A — silver-grey Rohu
  rohu: {
    id: "rohu",
    label: "Rohu",
    role: "large",
    lengthM: 1.75,
    speed: 1.05,
    depthPref: "surface",
    body: "#c8d2da",
    back: "#6a7870",
    fin: "#8a5048",
    accent: "#5a646c",
    belly: "#eef4f8",
    roughness: 0.46,
  },
  // Variant B — grey-green Catla with golden hint
  catla: {
    id: "catla",
    label: "Catla",
    role: "large",
    lengthM: 1.9,
    speed: 0.95,
    depthPref: "surface",
    body: "#b0c0b8",
    back: "#5a6a58",
    fin: "#a05040",
    accent: "#c4a060",
    belly: "#e4ece8",
    roughness: 0.5,
  },
  // Variant C — silver + warm fin accents (Mrigal)
  mrigal: {
    id: "mrigal",
    label: "Mrigal",
    role: "large",
    lengthM: 1.65,
    speed: 1.1,
    depthPref: "mid",
    body: "#b8c4c0",
    back: "#5a6860",
    fin: "#d06840",
    accent: "#8a9090",
    belly: "#e8f0ec",
    roughness: 0.48,
  },
  // Variant D — olive-brown carp
  carp: {
    id: "carp",
    label: "Common carp",
    role: "large",
    lengthM: 1.55,
    speed: 0.9,
    depthPref: "mid",
    body: "#b89260",
    back: "#6a5030",
    fin: "#8a5830",
    accent: "#3a3020",
    belly: "#e8d8b0",
    roughness: 0.55,
    banded: true,
  },
  // Medium
  tilapia: {
    id: "tilapia",
    label: "Tilapia",
    role: "medium",
    lengthM: 1.15,
    speed: 1.25,
    depthPref: "mid",
    body: "#8a9aa8",
    back: "#4a5860",
    fin: "#607080",
    accent: "#3a4850",
    belly: "#d0dce4",
    roughness: 0.5,
    banded: true,
  },
  mahseer: {
    id: "mahseer",
    label: "Mahseer",
    role: "medium",
    lengthM: 1.35,
    speed: 1.15,
    depthPref: "surface",
    body: "#c8b070",
    back: "#6a5838",
    fin: "#c85830",
    accent: "#e07848",
    belly: "#f0e4c0",
    roughness: 0.48,
  },
  // Variant E — golden showcase school fish
  barb: {
    id: "barb",
    label: "Barb",
    role: "school",
    lengthM: 0.75,
    speed: 2.0,
    depthPref: "surface",
    body: "#d4b878",
    back: "#8a7038",
    fin: "#d05038",
    accent: "#e07850",
    belly: "#f4e8c8",
    roughness: 0.42,
  },
  danio: {
    id: "danio",
    label: "Danio",
    role: "school",
    lengthM: 0.65,
    speed: 2.4,
    depthPref: "mid",
    body: "#b0c8d8",
    back: "#4a6080",
    fin: "#6888a8",
    accent: "#2a3858",
    belly: "#e8f2f8",
    roughness: 0.44,
    striped: true,
  },
  catfish: {
    id: "catfish",
    label: "Catfish",
    role: "bottom",
    lengthM: 1.45,
    speed: 0.7,
    depthPref: "bottom",
    body: "#7a7268",
    back: "#4a443c",
    fin: "#5a544c",
    accent: "#9a9288",
    belly: "#c0b8a8",
    roughness: 0.62,
  },
  loach: {
    id: "loach",
    label: "Loach",
    role: "bottom",
    lengthM: 0.7,
    speed: 1.35,
    depthPref: "bottom",
    body: "#c4a858",
    back: "#6a5028",
    fin: "#8a6830",
    accent: "#3a2818",
    belly: "#e8d8a0",
    roughness: 0.55,
    banded: true,
  },
  eel: {
    id: "eel",
    label: "Eel",
    role: "bottom",
    lengthM: 1.6,
    speed: 0.8,
    depthPref: "bottom",
    body: "#5a6650",
    back: "#3a4430",
    fin: "#4a5440",
    accent: "#7a8868",
    belly: "#a0a888",
    roughness: 0.58,
    elongated: true,
  },
};

/**
 * Per-zone spawn plan with ~40% surface / 40% mid / 20% bottom and more fish.
 * Returns list of { speciesId, layer } — one entry per fish.
 */
export function speciesPlanForZone(zone, seed) {
  const plan = [];
  const deep = zone.depthM > 1.85;
  const wide = zone.halfWidth > 45;

  // Target totals ~28–42 fish; layer mix ~40 / 40 / 20
  const nSurface = wide ? 12 + (seed % 5) : 10 + (seed % 4); // 10–16
  const nMid = wide ? 12 + ((seed * 3) % 5) : 10 + ((seed * 5) % 4); // 10–16
  const nBottom = wide ? 6 + (seed % 4) : 5 + (seed % 3); // 5–9

  // —— SURFACE: 1–3 large showcase + medium + some small ——
  const surfaceLarge = deep
    ? ["rohu", "catla", "mrigal"]
    : ["rohu", "catla", "mahseer"];
  const nLargeSurf = 1 + (wide ? 1 : 0) + (seed % 2); // 1–3
  for (let i = 0; i < nLargeSurf; i++) {
    plan.push({ speciesId: surfaceLarge[(seed + i) % surfaceLarge.length], layer: "surface" });
  }
  const nMedSurf = Math.max(2, Math.floor(nSurface * 0.35));
  for (let i = 0; i < nMedSurf; i++) {
    plan.push({ speciesId: i % 2 === 0 ? "mahseer" : "tilapia", layer: "surface" });
  }
  while (plan.filter((p) => p.layer === "surface").length < nSurface) {
    plan.push({
      speciesId: (seed + plan.length) % 3 === 0 ? "danio" : "barb",
      layer: "surface",
    });
  }

  // —— MID: medium + schools ——
  const midLarge = ["mrigal", "carp", "tilapia"];
  for (let i = 0; i < 1 + (seed % 2); i++) {
    plan.push({ speciesId: midLarge[(seed + i * 2) % midLarge.length], layer: "mid" });
  }
  const nTilapia = 3 + (seed % 4);
  for (let i = 0; i < nTilapia; i++) {
    plan.push({ speciesId: "tilapia", layer: "mid" });
  }
  while (plan.filter((p) => p.layer === "mid").length < nMid) {
    plan.push({
      speciesId: (seed + plan.length) % 2 === 0 ? "danio" : "barb",
      layer: "mid",
    });
  }

  // —— BOTTOM: darker / subtler ——
  const nCat = deep ? 1 + (seed % 2) : 1;
  for (let i = 0; i < nCat; i++) plan.push({ speciesId: "catfish", layer: "bottom" });
  const nLoach = 3 + (seed % 3);
  for (let i = 0; i < nLoach; i++) plan.push({ speciesId: "loach", layer: "bottom" });
  if (deep) plan.push({ speciesId: "eel", layer: "bottom" });
  while (plan.filter((p) => p.layer === "bottom").length < nBottom) {
    plan.push({
      speciesId: (seed + plan.length) % 2 === 0 ? "loach" : "catfish",
      layer: "bottom",
    });
  }

  return plan;
}

export function activityLevel(zone) {
  const score = (zone.depthM - 1.7) * 4 + zone.halfWidth / 80 + (zone.nearBridge ? 0.4 : 0);
  if (score > 1.2) return "High";
  if (score > 0.55) return "Medium";
  return "Low";
}
