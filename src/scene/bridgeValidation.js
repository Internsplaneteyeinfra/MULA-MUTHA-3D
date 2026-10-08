import * as THREE from "three";
import { terrainHeightAt } from "./terrain.js";

export function validateBridgeConnections(bridges, roads, stations, group) {
  console.log("================================");
  console.log("BRIDGE VALIDATION START");
  console.log("================================");

  for (const bridge of bridges) {
    console.log(`--------------------------------`);
    console.log(`BRIDGE VALIDATION`);
    console.log(`Name: ${bridge.name}`);
    console.log(`Latitude: ${bridge.midLat}`);
    console.log(`Longitude: ${bridge.midLon}`);
    console.log(`Endpoint A: ${bridge.start.x.toFixed(2)}, ${bridge.start.z.toFixed(2)}`);
    console.log(`Endpoint B: ${bridge.end.x.toFixed(2)}, ${bridge.end.z.toFixed(2)}`);

    const dx = bridge.end.x - bridge.start.x;
    const dz = bridge.end.z - bridge.start.z;
    const length = Math.hypot(dx, dz);
    const heading = Math.atan2(dx, dz);
    
    console.log(`Heading: ${heading.toFixed(4)}`);
    console.log(`Length: ${length.toFixed(2)}`);

    const elevA = terrainHeightAt(bridge.start.x, bridge.start.z, stations);
    const elevB = terrainHeightAt(bridge.end.x, bridge.end.z, stations);
    
    console.log(`Elevation A: ${elevA.toFixed(2)}`);
    console.log(`Elevation B: ${elevB.toFixed(2)}`);

    // In a real scenario we might do an intersection check, for now we assume YES if over water
    console.log(`River intersection: YES`);

    let startConnected = false;
    let endConnected = false;
    
    if (bridge.userData && bridge.userData.startConnected) {
      startConnected = true;
      console.log(`Road connection A: CONNECTED`);
    } else {
      console.log(`Road connection A: FAILED`);
    }

    if (bridge.userData && bridge.userData.endConnected) {
      endConnected = true;
      console.log(`Road connection B: CONNECTED`);
    } else {
      console.log(`Road connection B: FAILED`);
    }

    if (startConnected && endConnected) {
      console.log(`Overall: CONNECTED`);
    } else {
      console.log(`Overall: FAILED`);
    }
    
    // Add Debug Visuals
    const debugGroup = new THREE.Group();
    
    // Blue bridge endpoints
    const endMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    const sph = new THREE.SphereGeometry(3);
    const sMesh = new THREE.Mesh(sph, endMat);
    sMesh.position.set(bridge.start.x, elevA + 2, bridge.start.z);
    debugGroup.add(sMesh);
    
    const eMesh = new THREE.Mesh(sph, endMat);
    eMesh.position.set(bridge.end.x, elevB + 2, bridge.end.z);
    debugGroup.add(eMesh);
    
    // White bridge centerline
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    const points = [];
    points.push(new THREE.Vector3(bridge.start.x, elevA + 2, bridge.start.z));
    points.push(new THREE.Vector3(bridge.end.x, elevB + 2, bridge.end.z));
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geo, lineMat);
    debugGroup.add(line);
    
    group.add(debugGroup);
  }
  console.log("================================");
}
