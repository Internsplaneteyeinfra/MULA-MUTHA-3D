/**
 * Water droplets / spray on the real river surface (rapids, weir splashes, flood turbulence).
 * Simple ballistic particles in each emitter's local East-North-Up frame, drawn as Cesium points and advanced
 * manually every frame with real elapsed seconds (the scene clock is used for sun position, not for physics).
 * Purely visual.
 */
const G = 9.81;
let DROP = null;
let GLINT = null;

export function createWaterSpray(Cesium, scene) {
  DROP = new Cesium.Color(0.88, 0.94, 0.97, 1);
  GLINT = new Cesium.Color(1.0, 0.98, 0.9, 1);
  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT }));
  const emitters = [];
  const tmpLocal = new Cesium.Cartesian3();
  const tmpWorld = new Cesium.Cartesian3();

  /**
   * @param {object} o lon, lat, h (water surface, m), radius (m), rate (particles alive), speed (m/s up),
   *                   spread (m/s horizontal), drift [east,north] m/s (current), size px, flowHeading (deg)
   */
  function addEmitter(o) {
    const origin = Cesium.Cartesian3.fromDegrees(o.lon, o.lat, o.h);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    const parts = [];
    for (let i = 0; i < o.count; i++) {
      const p = points.add({
        position: origin,
        pixelSize: o.size * (0.6 + Math.random() * 0.8),
        color: Cesium.Color.WHITE.withAlpha(0),
        scaleByDistance: new Cesium.NearFarScalar(30, 1.8, 2500, 0.4),
        translucencyByDistance: new Cesium.NearFarScalar(200, 1.0, 6000, 0.0),
        disableDepthTestDistance: 0,
      });
      parts.push({ p, age: Math.random() * 1.5, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, glint: Math.random() < 0.18, ph: Math.random() * 6.28 });
    }
    const e = { ...o, enu, origin, parts, intensity: 1, hidden: false };
    parts.forEach((q) => respawn(e, q, true));
    emitters.push(e);
    return e;
  }

  function respawn(e, q, initial = false) {
    const r = e.radius * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    // Spawn along a short line across/along the water (e.g. a weir crest or a rapid), not a perfect disc.
    const hd = ((e.flowHeading || 0) * Math.PI) / 180;
    const along = (Math.random() - 0.5) * (e.length || e.radius * 2);
    q.x = Math.cos(a) * r * 0.4 + Math.sin(hd) * along;
    q.y = Math.sin(a) * r * 0.4 + Math.cos(hd) * along;
    q.z = 0;
    const up = e.speed * (0.4 + Math.random() * 0.8);
    q.vx = (Math.random() - 0.5) * e.spread + (e.drift ? e.drift[0] : 0);
    q.vy = (Math.random() - 0.5) * e.spread + (e.drift ? e.drift[1] : 0);
    q.vz = up;
    q.life = e.mist ? 1.6 + Math.random() * 1.4 : (2 * up) / G + 0.15;
    q.age = initial ? Math.random() * q.life : 0;
  }

  const scratch = new Cesium.Color();
  const camPos = new Cesium.Cartesian3();
  function update(dt, visible) {
    points.show = visible;
    if (!visible) return;
    Cesium.Cartesian3.clone(scene.camera.positionWC, camPos);
    for (const e of emitters) {
      const k = e.intensity;
      // Emitters far from the camera are sub-pixel: hide and skip them (saves thousands of point updates per frame).
      const far = Cesium.Cartesian3.distance(camPos, e.origin) > 3500;
      if (far !== e.hidden) {
        e.hidden = far;
        for (const q of e.parts) q.p.show = !far;
      }
      if (far) continue;
      for (const q of e.parts) {
        q.age += dt;
        // Mist hangs and drifts (strong drag, slight buoyancy); droplets follow ballistic arcs.
        q.vz -= (e.mist ? 0.6 : G) * dt;
        const drag = e.mist ? 1.8 : 0.6;
        q.vx *= 1 - drag * dt;
        q.vy *= 1 - drag * dt;
        if (e.mist) q.vz *= 1 - drag * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.z += q.vz * dt;
        if (q.age >= q.life || q.z < -0.05) respawn(e, q);
        tmpLocal.x = q.x;
        tmpLocal.y = q.y;
        tmpLocal.z = Math.max(0, q.z);
        Cesium.Matrix4.multiplyByPoint(e.enu, tmpLocal, tmpWorld);
        q.p.position = tmpWorld;
        const fade = Math.min(1, q.age / 0.08) * (1 - Math.max(0, (q.age - q.life * 0.6) / (q.life * 0.4)));
        // Droplets catching the sun flicker brighter; mist stays faint.
        const sparkle = q.glint ? 0.75 + 0.25 * Math.sin(q.age * 38 + q.ph) : 0.7;
        const a = e.mist ? Math.max(0, fade) * 0.16 * k : Math.max(0, fade) * sparkle * k;
        q.p.color = Cesium.Color.fromAlpha(q.glint ? GLINT : e.tint || DROP, a, scratch); // setter copies; no allocation
      }
    }
  }

  return { addEmitter, update, emitters };
}
