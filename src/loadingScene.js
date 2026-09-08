import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL = "/assets/butterfly.glb";

export function createLoadingScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x071723, 0.055);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 40);
  camera.position.set(0, 1.05, 8.6);
  camera.lookAt(0, 1.0, 0);

  scene.add(new THREE.HemisphereLight(0x79c9ed, 0x06101a, 1.7));
  const moon = new THREE.DirectionalLight(0x9adfff, 2.2);
  moon.position.set(-3, 6, 5);
  scene.add(moon);

  const water = createWater();
  water.position.set(0, -1.25, -0.8);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const farBank = new THREE.Mesh(
    new THREE.SphereGeometry(5, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0x0b2635, roughness: 1, transparent: true, opacity: 0.88 }),
  );
  farBank.scale.set(2.5, 0.24, 0.48);
  farBank.position.set(0, -0.66, -2.6);
  scene.add(farBank);

  const nearBank = farBank.clone();
  nearBank.material = farBank.material.clone();
  nearBank.material.color.set(0x031019);
  nearBank.material.opacity = 0.94;
  nearBank.scale.set(2.8, 0.3, 0.55);
  nearBank.position.set(0, -1.26, 1.0);
  scene.add(nearBank);

  const butterflyRoot = new THREE.Group();
  butterflyRoot.visible = false;
  scene.add(butterflyRoot);
  const flightPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6.4, 0.35, 0.9),
    new THREE.Vector3(-4.6, 0.82, 0.35),
    new THREE.Vector3(-2.8, 1.65, 0.05),
    new THREE.Vector3(-0.75, 1.9, -0.2),
    new THREE.Vector3(1.15, 1.72, -0.42),
    new THREE.Vector3(3.35, 1.1, -0.75),
    new THREE.Vector3(6.1, 0.42, -1.0),
  ], false, "catmullrom", 0.55);
  const tangent = new THREE.Vector3();
  const nextTangent = new THREE.Vector3();
  const desiredQuaternion = new THREE.Quaternion();
  const forward = new THREE.Vector3(0, 0, 1);
  const loader = new GLTFLoader();
  let mixer = null;
  let modelReady = false;
  let disposed = false;
  let progress = 0;
  let last = performance.now();

  loader.load(MODEL_URL, (gltf) => {
    if (disposed) return;
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 1.25 / Math.max(size.x, size.y, size.z, 0.001);
    model.scale.setScalar(scale);
    bounds.setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
      if (node.material) node.material.roughness = 0.58;
    });
    butterflyRoot.add(model);
    mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find((item) => /flying/i.test(item.name)) || gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
    modelReady = true;
    butterflyRoot.visible = true;
  }, undefined, (error) => console.warn("Loading butterfly asset:", error));

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  function render(now) {
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    progress = (progress + dt * 0.022) % 1;
    const point = flightPath.getPointAt(progress);
    const ahead = flightPath.getPointAt((progress + 0.006) % 1);
    tangent.subVectors(ahead, point).normalize();
    nextTangent.copy(tangent);
    butterflyRoot.position.copy(point);
    desiredQuaternion.setFromUnitVectors(forward, tangent);
    butterflyRoot.quaternion.slerp(desiredQuaternion, 1 - Math.exp(-dt * 4.5));
    butterflyRoot.rotation.z += Math.sin(now * 0.0017) * 0.0012;
    if (mixer) mixer.update(dt * (modelReady ? 1 : 0));
    water.material.uniforms.uTime.value = now * 0.00008;
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(render);

  return {
    setVisible(visible) {
      canvas.classList.toggle("is-fading", !visible);
      if (!visible) window.setTimeout(() => { canvas.hidden = true; }, 1100);
    },
    dispose() {
      disposed = true;
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };
}

function createWater() {
  const geometry = new THREE.PlaneGeometry(18, 12, 72, 48);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(p.x * 1.2 + uTime * 1.8) * 0.035 + cos(p.y * 2.1 + uTime) * 0.022;
        p.z += sin((p.x + p.y) * 3.8 + uTime * 2.2) * 0.012;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float ripple = sin(vUv.x * 42.0 + uTime * 6.0) * 0.5 + 0.5;
        float bands = smoothstep(0.34, 0.82, ripple) * 0.08;
        vec3 deep = vec3(0.015, 0.11, 0.17);
        vec3 light = vec3(0.12, 0.43, 0.55);
        vec3 color = mix(deep, light, smoothstep(0.05, 0.85, vUv.y) * 0.55 + bands);
        float edge = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
        gl_FragColor = vec4(color, 0.72 * edge);
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
}
