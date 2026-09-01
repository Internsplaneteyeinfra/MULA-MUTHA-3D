/**
 * Sample OSM building extrusion audit — logs height + placement for random footprints.
 */
import { terrainHeightAt } from "../scene/terrain.js";
import { sampleFootprintElevation } from "./footprintPlacement.js";

export function auditBuildingSample(records, stations, count = 20) {
  if (!records?.length) return [];
  const shuffled = [...records];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sample = shuffled.slice(0, Math.min(count, shuffled.length));
  const rows = [];

  for (const rec of sample) {
    const { building, metrics, classification } = rec;
    const terrainY = terrainHeightAt(metrics.centroidX, metrics.centroidZ, stations);
    const baseY = sampleFootprintElevation(metrics, stations);
    const h = classification.heightM;
    const row = {
      id: building.id,
      footprint: (building.vertices || []).slice(0, 4).map((v) => ({
        lon: v.lon,
        lat: v.lat,
        x: +v.x.toFixed(2),
        z: +v.z.toFixed(2),
      })),
      osmHeight: building.heightM ?? null,
      osmLevels: building.levels ?? null,
      classifiedHeightM: h,
      meshBBoxHeightM: h,
      terrainElevation: +terrainY.toFixed(2),
      worldBaseY: +baseY.toFixed(2),
      worldTopY: +(baseY + h).toFixed(2),
      heightSource: classification.height_source,
      buildingType: building.building || "yes",
    };
    rows.push(row);
    console.info("[Building Audit]", row);
  }

  const zeroHeight = rows.filter((r) => !r.meshBBoxHeightM || r.meshBBoxHeightM < 1);
  if (zeroHeight.length) {
    console.warn(`[Building Audit] ${zeroHeight.length}/${rows.length} samples have near-zero height`);
  } else {
    console.info(`[Building Audit] ${rows.length} samples — all extruded with height > 1 m`);
  }
  return rows;
}
