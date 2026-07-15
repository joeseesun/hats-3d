// tryon.js — webcam AR "try on your head" mode using MediaPipe FaceMesh.
// Renders the same customized hat over the live camera feed, tracking
// position / scale / roll / yaw / pitch from facial landmarks.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHat } from "./hats.js";

const MP_CDN = "./vendor/face_mesh"; // vendored MediaPipe assets (no CDN dependency)

// MediaPipe FaceMesh landmark indices we rely on.
const IDX = {
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  leftTemple: 234,
  rightTemple: 454,
  noseTip: 6,
  chin: 152,
  forehead: 10,
};

export function initTryOn(video, canvas, state, setStatus, onCycleStyle) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const D = 7;
  const FOV = 35;
  const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 0.1, 100);
  camera.position.set(0, 0, D);

  scene.add(new THREE.DirectionalLight(0xffffff, 1.6).translateX(2));
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.8);
  fill.position.set(-3, 2, 4);
  scene.add(fill);

  const hat = createHat(state);
  scene.add(hat.group);
  // The hat rides on a pivot placed at the skull centre: yaw/pitch/roll rotate
  // the hat around the head (not around its own band) so side turns stay put.
  const pivot = new THREE.Group();
  pivot.rotation.order = "YXZ";
  scene.add(pivot);
  pivot.add(hat.group);

  /* ---------------- face occluder ----------------
   * Depth-only mesh from the MediaPipe face tesselation: hides any hat part
   * that ends up behind the face (brim when the head tilts down, etc.). */
  const occluder = buildFaceOccluder();
  scene.add(occluder.mesh);

  function buildFaceOccluder() {
    const VERTS = 468;
    const positions = new Float32Array(VERTS * 3);
    const smooth = new Float32Array(VERTS * 3);
    const index = [];
    const tess = globalThis.FACEMESH_TESSELATION || [];
    for (let i = 0; i + 2 < tess.length; i += 3) {
      index.push(tess[i][0], tess[i + 1][0], tess[i + 2][0]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    let primed = false;

    function update(lm, k = 1) {
      const zRef = lm[IDX.noseTip].z;
      for (let i = 0; i < VERTS; i++) {
        positions[i * 3] = (lm[i].x - 0.5) * visibleW;
        positions[i * 3 + 1] = (0.5 - lm[i].y) * visibleH;
        positions[i * 3 + 2] = -(lm[i].z - zRef) * visibleW - 0.08;
      }
      if (!primed) {
        smooth.set(positions);
        primed = true;
      } else {
        for (let i = 0; i < smooth.length; i++) {
          smooth[i] += (positions[i] - smooth[i]) * k;
        }
      }
      geo.attributes.position.array.set(smooth);
      geo.attributes.position.needsUpdate = true;
    }

    return { mesh, update };
  }

  /* ---------------- head occluder ----------------
   * A depth-only ellipsoid around the skull: hides the back of the crown
   * when the head turns, so the hat wraps the head instead of floating. */
  const headOcc = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true })
  );
  headOcc.renderOrder = -1;
  headOcc.frustumCulled = false;
  scene.add(headOcc);
  const headCur = { x: 0, y: 0, z: -0.2, rx: 1, ry: 1, rz: 1 };
  const headTgt = { ...headCur };

  const visibleH = 2 * D * Math.tan((FOV * Math.PI) / 360);
  let visibleW = visibleH * (4 / 3);

  // Smoothed pose we ease toward every frame.
  const cur = { x: 0, y: 0, scale: 0.001, roll: 0, yaw: 0, pitch: 0, tw: 1 };
  const tgt = { ...cur };
  let lostFrames = 0;
  let seenFace = false;

  function resize() {
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    visibleW = visibleH * camera.aspect;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  /* ---------------- landmark → pose ---------------- */
  function solvePose(lm) {
    const wX = (nx) => (nx - 0.5) * visibleW;
    const wY = (ny) => (0.5 - ny) * visibleH;

    const le = lm[IDX.leftEyeOuter];
    const re = lm[IDX.rightEyeOuter];
    const eyeMidX = (le.x + re.x) / 2;
    const templeMidX = (lm[IDX.leftTemple].x + lm[IDX.rightTemple].x) / 2;

    // roll from the eye line (world space, y already flipped)
    const roll = Math.atan2(wY(re.y) - wY(le.y), wX(re.x) - wX(le.x));

    // scale from temple-to-temple width vs. the hat's head-band width
    const templeWorld = Math.abs(wX(lm[IDX.rightTemple].x) - wX(lm[IDX.leftTemple].x));
    const scale = (templeWorld / hat.headWidth) * 1.06;

    // yaw/pitch from the 3D face normal (z ≈ depth toward the camera).
    const P = (i) => new THREE.Vector3(lm[i].x, -lm[i].y, -lm[i].z);
    const right = P(IDX.rightTemple).sub(P(IDX.leftTemple));
    const up = P(IDX.forehead).sub(P(IDX.chin));
    const normal = new THREE.Vector3().crossVectors(right, up);
    if (normal.z < 0) normal.negate();
    normal.normalize();
    const yaw = THREE.MathUtils.clamp(Math.atan2(normal.x, normal.z), -0.7, 0.7);
    const pitch = THREE.MathUtils.clamp(-Math.atan2(normal.y, normal.z), -0.6, 0.6);

    // Anchor: the hat band sits at brow level (below the hairline landmark),
    // centred between the temples — worn on the head, not floating above it.
    tgt.x = wX((eyeMidX + templeMidX) / 2);
    tgt.y = wY(lm[IDX.forehead].y) - 0.26 * templeWorld;
    tgt.scale = scale;
    tgt.roll = roll;
    tgt.yaw = yaw;
    // Slight forward tilt so the brim reads when the camera looks up at the face.
    tgt.pitch = pitch + 0.08;
    tgt.tw = templeWorld;

    // Head ellipsoid: centred on the skull, sized from the temple width.
    // Slightly smaller than the crown so it hides the back of the hat on
    // turns without clipping the front.
    headTgt.x = tgt.x;
    headTgt.y = wY(lm[IDX.forehead].y) - 0.3 * templeWorld;
    headTgt.z = -0.25 * templeWorld;
    headTgt.rx = templeWorld * 0.52;
    headTgt.ry = templeWorld * 0.66;
    headTgt.rz = templeWorld * 0.55;
  }

  /* ---------------- swipe left/right to switch hat style ---------------- */
  const gestures = new AbortController();
  const stage = canvas.parentElement;
  let swipeStart = null;
  stage.addEventListener("pointerdown", (e) => {
    swipeStart = { x: e.clientX, y: e.clientY };
  }, { signal: gestures.signal });
  stage.addEventListener("pointerup", (e) => {
    if (!swipeStart || !onCycleStyle) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      onCycleStyle(dx < 0 ? 1 : -1); // swipe left = next style
    }
  }, { signal: gestures.signal });

  /* ---------------- MediaPipe wiring ---------------- */
  let mpCamera = null;
  let stream = null;
  let running = true;

  async function start() {
    try {
      if (!globalThis.FaceMesh || !globalThis.Camera) {
        throw new Error("Face-tracking library failed to load (network?).");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      const faceMesh = new globalThis.FaceMesh({
        locateFile: (f) => `${MP_CDN}/${f}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      faceMesh.onResults((res) => {
        const faces = res.multiFaceLandmarks;
        if (faces && faces.length) {
          solvePose(faces[0]);
          occluder.update(faces[0], 0.35);
          lostFrames = 0;
          if (!seenFace) {
            seenFace = true;
            setStatus("");
          }
        } else {
          lostFrames++;
          if (lostFrames > 12) setStatus("No face detected — step into the frame");
        }
      });

      mpCamera = new globalThis.Camera(video, {
        onFrame: async () => {
          if (running) await faceMesh.send({ image: video });
        },
        width: 640,
        height: 480,
      });
      mpCamera.start();
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Allow the webcam and retry."
          : "Could not start the camera. " + (err.message || "")
      );
    }
  }

  /* ---------------- render loop ---------------- */
  function frame() {
    if (!running) return;
    const k = 0.35; // smoothing
    cur.x += (tgt.x - cur.x) * k;
    cur.y += (tgt.y - cur.y) * k;
    cur.scale += (tgt.scale - cur.scale) * k;
    cur.roll += (tgt.roll - cur.roll) * k;
    cur.yaw += (tgt.yaw - cur.yaw) * k;
    cur.pitch += (tgt.pitch - cur.pitch) * k;
    cur.tw += (tgt.tw - cur.tw) * k;

    const visible = seenFace && lostFrames <= 12;
    pivot.visible = visible;
    occluder.mesh.visible = visible;
    headOcc.visible = visible;
    // hat.update() animates the group transform (pulse/bob/nod) — call it
    // first so the tracked pose below always wins in AR mode.
    hat.update(0.016);
    const g = hat.group;
    const bob = g.position.y;
    const pulse = g.scale.x;
    // Hat-local offset from the skull pivot to the band anchor (unrotated).
    // The band centre sits on the skull axis (slightly forward), not on the
    // face plane — otherwise the whole hat hovers in front of the head.
    g.position.set(cur.x - headCur.x, cur.y - headCur.y + bob, 0.05 * cur.tw);
    g.scale.setScalar(cur.scale * pulse);
    g.rotation.set(g.rotation.x, 0, 0); // keep the tip-nod, clear stale pose

    for (const key of ["x", "y", "z", "rx", "ry", "rz"]) {
      headCur[key] += (headTgt[key] - headCur[key]) * k;
    }
    pivot.position.set(headCur.x, headCur.y, headCur.z);
    pivot.rotation.set(cur.pitch, cur.yaw, cur.roll);
    headOcc.position.set(headCur.x, headCur.y, headCur.z);
    headOcc.scale.set(headCur.rx, headCur.ry, headCur.rz);
    headOcc.rotation.set(cur.pitch, cur.yaw, cur.roll);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  start();

  return {
    applyState: (s) => hat.applyState(s),
    applyStyle: (s) => hat.applyStyle(s),
    stop() {
      running = false;
      ro.disconnect();
      gestures.abort();
      if (mpCamera) mpCamera.stop();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      renderer.dispose();
      pmrem.dispose();
    },
  };
}
