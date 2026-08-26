import * as THREE from "three";
import { SURFACE_Y } from "./river.js";

/** Overlay: KML + OSM bridges/roads/buildings + KMZ depth GroundOverlay. */
export function createProjectionValidation(dataset) {
  const group = new THREE.Group();
  group.name = "projectionValidation";
  group.visible = false;

  const kmlPts = dataset.ringLocal.map((c) => new THREE.Vector3(c.x, SURFACE_Y + 18, c.z));
  kmlPts.push(kmlPts[0].clone());
  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(kmlPts),
      new THREE.LineBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.95 }),
    ),
  );

  const bridgeMat = new THREE.LineBasicMaterial({ color: 0xff3355 });
  for (const b of dataset.bridges) {
    const pts = b.vertices.map((v) => new THREE.Vector3(v.x, SURFACE_Y + 22, v.z));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), bridgeMat));
    const start = new THREE.Mesh(
      new THREE.SphereGeometry(4.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x44ffaa }),
    );
    start.position.set(b.start.x, SURFACE_Y + 22, b.start.z);
    const end = start.clone();
    end.material = new THREE.MeshBasicMaterial({ color: 0x66aaff });
    end.position.set(b.end.x, SURFACE_Y + 22, b.end.z);
    group.add(start);
    group.add(end);
  }

  const roadMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.75 });
  for (const r of dataset.osm?.roads || []) {
    if (r.vertices.length < 2) continue;
    const pts = r.vertices.map((v) => new THREE.Vector3(v.x, SURFACE_Y + 14, v.z));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), roadMat));
  }

  const bldgMat = new THREE.LineBasicMaterial({ color: 0x33e0ff, transparent: true, opacity: 0.55 });
  for (const b of dataset.osm?.buildings || []) {
    const pts = b.vertices.map((v) => new THREE.Vector3(v.x, SURFACE_Y + 12, v.z));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), bldgMat));
  }

  // Sparse bathymetry sample markers
  const pts = dataset.points || [];
  const step = Math.max(1, Math.floor(pts.length / 400));
  const bathPos = [];
  for (let i = 0; i < pts.length; i += step) {
    bathPos.push(pts[i].x, SURFACE_Y + 8, pts[i].z);
  }
  if (bathPos.length) {
    const bathGeo = new THREE.BufferGeometry();
    bathGeo.setAttribute("position", new THREE.Float32BufferAttribute(bathPos, 3));
    group.add(
      new THREE.Points(
        bathGeo,
        new THREE.PointsMaterial({ color: 0x88ddff, size: 3.5, sizeAttenuation: true, transparent: true, opacity: 0.55 }),
      ),
    );
  }

  if (dataset.overlay?.corners?.length === 4) {
    const c = dataset.overlay.corners;
    const boxPts = [
      new THREE.Vector3(c[0].x, SURFACE_Y + 16, c[0].z),
      new THREE.Vector3(c[1].x, SURFACE_Y + 16, c[1].z),
      new THREE.Vector3(c[2].x, SURFACE_Y + 16, c[2].z),
      new THREE.Vector3(c[3].x, SURFACE_Y + 16, c[3].z),
      new THREE.Vector3(c[0].x, SURFACE_Y + 16, c[0].z),
    ];
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(boxPts),
        new THREE.LineBasicMaterial({ color: 0x66eeff, transparent: true, opacity: 0.85 }),
      ),
    );

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([
      c[0].x, SURFACE_Y + 0.35, c[0].z,
      c[1].x, SURFACE_Y + 0.35, c[1].z,
      c[2].x, SURFACE_Y + 0.35, c[2].z,
      c[3].x, SURFACE_Y + 0.35, c[3].z,
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const tex = new THREE.TextureLoader().load(dataset.overlay.url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    plane.name = "kmzDepthOverlay";
    plane.renderOrder = 3;
    group.add(plane);
  }

  return group;
}
