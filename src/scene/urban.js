import * as THREE from "three";
import { createBuildingSystem } from "../urban/buildingSystem.js";
import { createRoadSystem } from "../urban/roadSystem.js";
import { updateBuildingLodVisibility, cacheLodGroupCenters } from "../urban/buildingLodTiers.js";

/**
 * Geospatial urban layer: OSM footprints → classify → GLB (near) / extrusion LOD (far) + roads.
 */
export async function createUrban(dataset) {
  const group = new THREE.Group();
  group.name = "urban";

  const [buildings, roads] = await Promise.all([
    createBuildingSystem(dataset),
    Promise.resolve(createRoadSystem(dataset)),
  ]);
  buildings.name = "osmBuildings";
  roads.name = "osmRoads";
  group.add(buildings);
  group.add(roads);
  group.userData.buildings = buildings;
  group.userData.roads = roads;
  group.userData.updateLod = (camera) => updateBuildingLodVisibility(buildings, camera);
  cacheLodGroupCenters(buildings);
  return group;
}
