// customizer.js — the main 3D stage: renderer, orbit, reflections, shadows,
// responsive framing, hat hover-glow raycasting and the render loop.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHat } from "./hats.js";

// Soft round contact-shadow texture generated on a canvas.
function makeShadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, "rgba(0,0,0,0.55)");
  grd.addColorStop(0.55, "rgba(0,0,0,0.28)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function initCustomizer(canvas, state) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  // Studio reflections from a procedural room — no HDR file needed.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.68;
  controls.autoRotateSpeed = 1.6;

  // Key + rim lights to add specular sparkle on top of the env light.
  const key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(5, 8, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 0.45);
  rim.position.set(-6, 3, -5);
  scene.add(rim);

  // The hat.
  const hat = createHat(state);
  scene.add(hat.group);

  // Fake contact shadow under the hat.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 16),
    new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -3.4;
  scene.add(shadow);

  /* ---------------- responsive framing ---------------- */
  // Fit the hat body so the model never clips, whatever the aspect ratio.
  const frontSize = new THREE.Vector3();
  const frontCenter = new THREE.Vector3();
  function computeFrontBox() {
    hat.group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(hat.front);
    box.getSize(frontSize);
    box.getCenter(frontCenter);
  }
  computeFrontBox();
  controls.target.copy(frontCenter);

  // Recompute bounds + reframe after the geometry changes (style swap).
  function refit() {
    computeFrontBox();
    controls.target.copy(frontCenter);
    frameView(true);
  }

  const HOME_DIR = new THREE.Vector3(0.32, 0.28, 1).normalize();

  function frameView(preserveDir) {
    const vfov = (camera.fov * Math.PI) / 180;
    const fitH = frontSize.y / (2 * Math.tan(vfov / 2));
    const fitW = frontSize.x / (2 * Math.tan(vfov / 2) * Math.max(camera.aspect, 0.3));
    const dist = Math.max(fitH, fitW) * 1.5;

    let dir = HOME_DIR.clone();
    if (preserveDir) {
      const d = camera.position.clone().sub(controls.target);
      if (d.lengthSq() > 1e-6) dir = d.normalize();
    }
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.near = Math.max(0.1, dist / 100);
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    controls.minDistance = dist * 0.55;
    controls.maxDistance = dist * 2.6;
    controls.update();
  }

  /* ---------------- hover raycasting ---------------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(-2, -2);
  let hovered = false;

  function onPointerMove(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", () => pointer.set(-2, -2));

  function updateHover() {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hat.hoverTargets, false);
    const on = hit.length > 0;
    if (on !== hovered) {
      hat.setHoverGlow(on);
      canvas.style.cursor = on ? "pointer" : "grab";
      hovered = on;
    }
  }

  /* ---------------- sizing ---------------- */
  function resize() {
    const parent = canvas.parentElement;
    const w = canvas.clientWidth || (parent && parent.clientWidth);
    const h = canvas.clientHeight || (parent && parent.clientHeight);
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    frameView(true);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);

  frameView(false); // initial home angle
  resize();

  /* ---------------- loop ---------------- */
  const clock = new THREE.Clock();
  let running = true;
  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    controls.update();
    updateHover();
    hat.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();

  /* ---------------- public API ---------------- */
  return {
    applyState: (s) => hat.applyState(s),
    applyStyle: (style) => {
      hat.applyStyle(style);
      refit();
    },
    tipHat: () => hat.tipHat(),
    isTipping: () => hat.isTipping(),
    hasBrim: () => hat.hasBrim(),
    resetView: () => frameView(false),
    setAutoRotate(on) {
      controls.autoRotate = on;
    },
    dispose() {
      running = false;
      ro.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      renderer.dispose();
      pmrem.dispose();
    },
  };
}
