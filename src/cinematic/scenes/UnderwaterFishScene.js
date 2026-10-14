/**
 * Short underwater cut (Three.js) — the only thing Three.js draws in the landing film.
 * It is an *illustrative* water column (not a surveyed riverbed): sandy gravel bed with animated caustics,
 * light shafts, suspended sediment, the water surface seen from below, and a small shoal of freshwater fish with
 * a skinned-in-shader body wave (lateral undulation growing toward the tail).
 *
 * Fish model: "Crucian carp" glTF by Yimit (Sketchfab) in /public/models/fish/crucian. No species claim is made for
 * any specific river; the model is a generic cyprinid.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const FISH_LEN_M = 0.42; // typical adult cyprinid ~ 30–50 cm

export function createUnderwaterScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const waterColor = new THREE.Color(0x0b4a52);
  scene.background = waterColor;
  scene.fog = new THREE.FogExp2(0x0b4a52, 0.115);
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 80);

  scene.add(new THREE.HemisphereLight(0x9fe8e0, 0x1b3a2e, 1.4));
  const sun = new THREE.DirectionalLight(0xfff2d0, 2.4);
  sun.position.set(-3, 8, 2);
  scene.add(sun);

  const uniforms = { uTime: { value: 0 } };

  // ---- Riverbed: gravel/sand with animated caustics ----
  const bedMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n(p);p=p*2.1+7.3;a*=.5;}return s;}
      float caustic(vec2 p){
        float t=uTime*.6; vec2 q=p;
        float c=0.;
        for(int i=0;i<3;i++){ q+=vec2(sin(q.y*1.7+t),cos(q.x*1.3-t))*.35; c+=abs(sin(q.x*2.2)+sin(q.y*2.2)); }
        return pow(1.-clamp(c/6.,0.,1.),3.5);
      }
      void main(){
        vec2 p=vW.xz;
        float g=fbm(p*9.); float pebbles=smoothstep(.55,.62,n(p*26.));
        vec3 sand=mix(vec3(.46,.40,.30),vec3(.62,.56,.43),g);
        vec3 stone=mix(vec3(.28,.27,.25),vec3(.5,.46,.40),n(p*40.));
        vec3 col=mix(sand,stone,pebbles*.8);
        col*=.72+.5*caustic(p*.9);
        // ripples on sand
        col*=.96+.06*sin(p.x*7.+fbm(p*2.)*9.);
        // Beer–Lambert style attenuation toward the water colour with distance from the camera.
        float d = distance(vW, cameraPosition);
        col = mix(col, vec3(0.043, 0.29, 0.32), 1.0 - exp(-d * d * 0.0132));
        gl_FragColor=vec4(col,1.);
      }`,
  });
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(60, 80, 1, 1), bedMat);
  bed.rotation.x = -Math.PI / 2;
  scene.add(bed);

  // ---- Water surface seen from below ----
  const surfMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      void main(){
        float w=n(vW.xz*1.6+uTime*.3)*.6+n(vW.xz*4.+vec2(-uTime*.5,uTime*.2))*.4;
        float d=distance(vW.xz, cameraPosition.xz);
        vec3 c=mix(vec3(.12,.55,.58),vec3(.75,.95,.92),smoothstep(.35,.9,w));
        // Seen from below, the surface fades into the water colour with distance (no visible plane edge).
        float att = 1.0 - exp(-d * d * 0.0132);
        c = mix(c, vec3(0.043, 0.29, 0.32), att);
        float a = clamp(.55 + .35 * w, 0., .95) * (1.0 - att * 0.85);
        gl_FragColor=vec4(c,clamp(a,0.,.9));
      }`,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), surfMat);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 3.2;
  scene.add(surface);

  // ---- Light shafts ----
  const shaftMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      void main(){
        float edge=smoothstep(0.,.5,vUv.x)*smoothstep(1.,.5,vUv.x);
        float fall=pow(vUv.y,1.4);
        float fl=.65+.35*sin(uTime*.8+vUv.x*9.);
        gl_FragColor=vec4(vec3(.55,.9,.8)*edge*fall*fl*.16,1.);
      }`,
  });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1 + Math.random() * 1.4, 6.5), shaftMat);
    m.position.set(-6 + Math.random() * 12, 1.6, -2 + Math.random() * 16);
    m.rotation.z = -0.22 + (Math.random() - 0.5) * 0.12;
    m.rotation.y = Math.random() * 0.6;
    scene.add(m);
  }

  // ---- Suspended particles ----
  const pCount = 700;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(pCount * 3);
  for (let i = 0; i < pCount; i++) {
    pPos[i * 3] = (Math.random() - 0.5) * 16;
    pPos[i * 3 + 1] = Math.random() * 3;
    pPos[i * 3 + 2] = Math.random() * 22 - 3;
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  // Round, soft sediment specks (a radial-gradient sprite instead of square points).
  const dot = document.createElement("canvas");
  dot.width = dot.height = 32;
  const dctx = dot.getContext("2d");
  const grad = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, 32, 32);
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      color: 0xcfe9e0,
      size: 0.012,
      map: new THREE.CanvasTexture(dot),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  scene.add(particles);

  // ---- Fish ----
  const fish = [];
  let fishMesh = null;
  const dummy = new THREE.Object3D();
  const N = 15;
  const phases = new Float32Array(N);

  const readyPromise = new Promise((resolve) => {
    new GLTFLoader().load(
      "/models/fish/crucian/scene.gltf",
      (gltf) => {
        let src = null;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (o.isMesh && !src) src = o;
        });
        const geo = src.geometry.clone();
        geo.applyMatrix4(src.matrixWorld);
        geo.computeBoundingBox();
        const size = new THREE.Vector3();
        geo.boundingBox.getSize(size);
        const c = new THREE.Vector3();
        geo.boundingBox.getCenter(c);
        geo.translate(-c.x, -c.y, -c.z);
        // Orient: longest axis -> +Z (head toward +Z). Lateral (thinnest) axis -> X, so the body wave is on X.
        const ax = [size.x, size.y, size.z];
        const longest = ax.indexOf(Math.max(...ax));
        const thinnest = ax.indexOf(Math.min(...ax));
        const m = new THREE.Matrix4();
        const colsFor = (a) => new THREE.Vector3(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0);
        const zAxis = colsFor(longest);
        const xAxis = colsFor(thinnest);
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
        m.makeBasis(xAxis, yAxis, zAxis).invert();
        geo.applyMatrix4(m);
        geo.computeBoundingBox();
        const L = geo.boundingBox.max.z - geo.boundingBox.min.z;
        geo.scale(1 / L, 1 / L, 1 / L); // length = 1
        geo.computeBoundingBox();
        const zmin = geo.boundingBox.min.z;
        const zmax = geo.boundingBox.max.z;
        // Decide head end: the fatter cross-section (taller in Y) end near the head.
        let hHead = 0, hTail = 0;
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const z = pos.getZ(i);
          if (z > zmax - 0.15) hHead = Math.max(hHead, Math.abs(pos.getY(i)));
          if (z < zmin + 0.15) hTail = Math.max(hTail, Math.abs(pos.getY(i)));
        }
        const headIsPosZ = hHead >= hTail * 0.0 && true; // refined below by tail-fin height test
        // Tail fin is the high-aspect (tall) lobe at the far end; the head is the opposite end.
        const flip = hTail > hHead; // tall fin at -z? then the tail is -z, head +z (no flip)
        void headIsPosZ;
        if (!flip) {
          // tail at +z (tall at +z) -> rotate 180° about Y so head is +z
          geo.rotateY(Math.PI);
        }

        const mat = src.material.clone();
        mat.roughness = 0.38;
        mat.metalness = 0.15;
        mat.envMapIntensity = 0.6;
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.uTime = uniforms.uTime;
          sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTime; attribute float aPhase;")
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
               float zt = clamp((0.5 - position.z) / 1.0, 0.0, 1.0);   // 0 at head, 1 at tail (head = +z)
               float amp = 0.02 + 0.16 * zt * zt;
               transformed.x += amp * sin(position.z * 9.0 - uTime * 8.0 + aPhase);`
            );
        };
        mat.side = THREE.DoubleSide;
        const g = geo;
        fishMesh = new THREE.InstancedMesh(g, mat, N);
        fishMesh.frustumCulled = false;
        for (let i = 0; i < N; i++) phases[i] = Math.random() * Math.PI * 2;
        g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
        scene.add(fishMesh);

        // Two small shoals + a few singles, separated and moving in varied directions
        const shoals = [
          { c: new THREE.Vector3(-0.9, 1.15, 5.2), n: 6, dir: 0.15, spread: 0.7 },
          { c: new THREE.Vector3(1.6, 0.8, 8.6), n: 5, dir: -0.45, spread: 0.6 },
          { c: new THREE.Vector3(-1.9, 1.6, 11.0), n: 4, dir: 0.5, spread: 0.9 },
        ];
        let k = 0;
        shoals.forEach((s) => {
          for (let i = 0; i < s.n; i++) {
            fish.push({
              base: s.c.clone().add(new THREE.Vector3((Math.random() - 0.5) * s.spread, (Math.random() - 0.5) * 0.45, (Math.random() - 0.5) * s.spread * 1.6)),
              yaw: s.dir + (Math.random() - 0.5) * 0.35,
              speed: 0.32 + Math.random() * 0.14,
              scale: FISH_LEN_M * (0.85 + Math.random() * 0.35),
              wob: Math.random() * 6.28,
            });
            k++;
          }
        });
        resolve();
      },
      undefined,
      (e) => {
        console.warn("fish model failed", e);
        resolve();
      }
    );
  });

  function resize(w, h) {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const _fw = new THREE.Vector3();
  function render(p, time) {
    uniforms.uTime.value = time;
    // Camera glides forward along the channel, slightly looking down toward the bed
    camera.position.set(0.1 + Math.sin(p * 2.0) * 0.18, 1.05 + Math.sin(p * 3.0) * 0.05, 3.0 + p * 6.0);
    camera.lookAt(-0.2 + Math.sin(p * 1.6) * 0.3, 0.8, camera.position.z + 4.0);
    if (fishMesh) {
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i];
        const yaw = f.yaw + Math.sin(time * 0.7 + f.wob) * 0.12;
        _fw.set(Math.sin(yaw), 0, Math.cos(yaw));
        dummy.position.copy(f.base).addScaledVector(_fw, (time - 19.5) * f.speed);
        dummy.position.y += Math.sin(time * 0.9 + f.wob) * 0.04;
        dummy.rotation.set(Math.sin(time * 1.3 + f.wob) * 0.04, yaw, 0);
        dummy.scale.setScalar(f.scale);
        dummy.updateMatrix();
        fishMesh.setMatrixAt(i, dummy.matrix);
      }
      fishMesh.count = fish.length;
      fishMesh.instanceMatrix.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  return {
    ready: readyPromise,
    render,
    resize,
    dispose() {
      renderer.dispose();
    },
  };
}
