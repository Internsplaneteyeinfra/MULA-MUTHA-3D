/**
 * Short underwater cut (Three.js) — the only thing Three.js draws in the landing film.
 * It is an *illustrative* water column (not a surveyed riverbed): sandy gravel bed with animated caustics,
 * light shafts, suspended sediment, the water surface seen from below, and a small shoal of freshwater fish with
 * a skinned-in-shader body wave (lateral undulation growing toward the tail).
 *
 * Fish models: "Barramundi Fish" glTF (Microsoft, CC0, Khronos sample assets) and a crucian-carp glTF by Yimit
 * (Sketchfab). Illustrative only — no species survey of a specific river is implied.
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
  const pCount = 380;
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

  // ---- Fish: two species models, instanced, each fish with its own size, tint, heading, speed and wave phase ----
  const dummy = new THREE.Object3D();
  const schools = []; // { mesh, fish: [...] }

  /** Normalise a glTF fish: length 1 along +Z (head at +Z), thin axis on X (body wave is lateral). */
  function prepareFish(gltf) {
    let src = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.isMesh && !src) src = o;
    });
    const geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    const c = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    geo.boundingBox.getCenter(c);
    geo.translate(-c.x, -c.y, -c.z);
    const ax = [size.x, size.y, size.z];
    const longest = ax.indexOf(Math.max(...ax));
    const thinnest = ax.indexOf(Math.min(...ax));
    const unit = (a) => new THREE.Vector3(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0);
    const zAxis = unit(longest);
    const xAxis = unit(thinnest);
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).invert());
    geo.computeBoundingBox();
    const L = geo.boundingBox.max.z - geo.boundingBox.min.z;
    geo.scale(1 / L, 1 / L, 1 / L);
    geo.computeBoundingBox();
    // Body height near each end: the caudal fin end is taller than the snout end.
    let hiPos = 0, hiNeg = 0;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const h = Math.abs(pos.getY(i));
      if (z > geo.boundingBox.max.z - 0.12) hiPos = Math.max(hiPos, h);
      if (z < geo.boundingBox.min.z + 0.12) hiNeg = Math.max(hiNeg, h);
    }
    if (hiPos > hiNeg) geo.rotateY(Math.PI); // tail was at +Z -> turn so the head points +Z
    // Keep the dorsal side up.
    geo.computeBoundingBox();
    geo.computeVertexNormals();
    return { geo, material: src.material };
  }

  function fishMaterial(base) {
    const mat = base.clone();
    mat.roughness = Math.min(0.55, mat.roughness ?? 0.45);
    mat.metalness = Math.min(0.2, mat.metalness ?? 0.1);
    mat.side = THREE.DoubleSide;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime; attribute float aPhase; attribute float aFreq; varying vec3 vWorldC;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           // Carangiform swimming: small head yaw, amplitude growing toward the tail (head = +z).
           float zt = clamp(0.5 - position.z, 0.0, 1.0);
           float amp = 0.015 + 0.13 * zt * zt;
           transformed.x += amp * sin(position.z * 8.0 - uTime * aFreq + aPhase);`
        )
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vWorldC = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTime; varying vec3 vWorldC;")
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           // Moving caustics on the upper body, fading with depth below the surface.
           vec2 cq = vWorldC.xz * 2.2 + vec2(uTime * 0.35, uTime * 0.2);
           float cs = 0.0;
           for (int i = 0; i < 3; i++) { cq += vec2(sin(cq.y * 1.7 + uTime), cos(cq.x * 1.3 - uTime)) * 0.35; cs += abs(sin(cq.x * 2.2) + sin(cq.y * 2.2)); }
           cs = pow(1.0 - clamp(cs / 6.0, 0.0, 1.0), 3.0);
           float up = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
           totalEmissiveRadiance += vec3(0.55, 0.75, 0.7) * cs * up * 0.16;`
        );
    };
    return mat;
  }

  function addSchool(prep, specs, lengthM) {
    const n = specs.length;
    const geo = prep.geo.clone();
    const phases = new Float32Array(n);
    const freqs = new Float32Array(n);
    specs.forEach((f, i) => {
      phases[i] = Math.random() * Math.PI * 2;
      freqs[i] = 6.0 + f.speed * 6.0 + Math.random() * 1.5; // faster swimmers beat faster
    });
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    geo.setAttribute("aFreq", new THREE.InstancedBufferAttribute(freqs, 1));
    const mesh = new THREE.InstancedMesh(geo, fishMaterial(prep.material), n);
    mesh.frustumCulled = false;
    const col = new THREE.Color();
    specs.forEach((f, i) => {
      f.scale = lengthM * f.size;
      col.setHSL(0.1 + Math.random() * 0.04, 0.12 + Math.random() * 0.1, 0.78 + Math.random() * 0.2);
      mesh.setColorAt(i, col);
    });
    scene.add(mesh);
    schools.push({ mesh, fish: specs });
  }

  /** Loose shoal: positions jittered, headings around a mean with individual deviation. */
  function shoal(centre, n, dir, spread, speed) {
    return Array.from({ length: n }, () => ({
      base: centre.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * spread * 1.8)),
      yaw: dir + (Math.random() - 0.5) * 0.5,
      speed: speed * (0.8 + Math.random() * 0.4),
      size: 0.8 + Math.random() * 0.45,
      wob: Math.random() * 6.28,
      turn: (Math.random() - 0.5) * 0.25, // slow individual turning rate (rad/s)
    }));
  }

  const loader = new GLTFLoader();
  const load = (url) =>
    new Promise((res) => loader.load(url, (g) => res(prepareFish(g)), undefined, (e) => (console.warn("fish model failed", url, e), res(null))));
  const readyPromise = Promise.all([load("/models/fish/barramundi/BarramundiFish.gltf"), load("/models/fish/crucian/scene.gltf")]).then(
    ([barra, carp]) => {
      // Larger perch-like fish cruise singly or in pairs near the bed; small cyprinids school higher in the column.
      if (barra) addSchool(barra, [...shoal(new THREE.Vector3(-1.2, 0.7, 6.5), 2, 0.35, 1.2, 0.42), ...shoal(new THREE.Vector3(1.8, 0.9, 10.5), 3, -0.6, 1.6, 0.38)], 0.62);
      if (carp)
        addSchool(carp, [...shoal(new THREE.Vector3(1.1, 1.4, 9.0), 7, -0.25, 0.9, 0.5), ...shoal(new THREE.Vector3(-1.9, 1.7, 9.8), 6, 0.6, 1.0, 0.46)], FISH_LEN_M * 0.75);
    }
  );

  function resize(w, h) {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const _fw = new THREE.Vector3();
  function render(p, time) {
    uniforms.uTime.value = time;
    // Camera glides slowly along the channel, slightly looking down toward the bed, rising toward the surface at the end.
    const rise = Math.max(0, (p - 0.75) / 0.25);
    camera.position.set(0.1 + Math.sin(p * 2.0) * 0.18, 1.05 + Math.sin(p * 3.0) * 0.05 + rise * rise * 1.6, 3.0 + p * 4.5);
    camera.lookAt(-0.2 + Math.sin(p * 1.6) * 0.3, 0.8 + rise * 2.2, camera.position.z + 4.0);
    const tc = time - 17.5; // centre of the underwater cut
    for (const s of schools) {
      s.fish.forEach((f, i) => {
        const yaw = f.yaw + f.turn * tc + Math.sin(time * 0.6 + f.wob) * 0.08;
        _fw.set(Math.sin(yaw), 0, Math.cos(yaw));
        // Integrate approximately along a slowly turning heading so motion stays continuous (no wrap/teleport).
        dummy.position.copy(f.base).addScaledVector(_fw, tc * f.speed);
        dummy.position.y += Math.sin(time * 0.8 + f.wob) * 0.035;
        dummy.rotation.set(Math.sin(time * 1.1 + f.wob) * 0.035, yaw, Math.sin(time * 0.9 + f.wob) * 0.03);
        dummy.scale.setScalar(f.scale);
        dummy.updateMatrix();
        s.mesh.setMatrixAt(i, dummy.matrix);
      });
      s.mesh.instanceMatrix.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  /** Compile every material and upload textures while the loading screen is up (canvas stays hidden). */
  function warmup() {
    renderer.compile(scene, camera);
    render(0.5, 17.5);
  }

  return {
    ready: readyPromise,
    warmup,
    render,
    resize,
    dispose() {
      renderer.dispose();
    },
  };
}
