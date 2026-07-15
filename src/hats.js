// hats.js — procedural PBR hat models.
// Everything is generated in code (no external GLTF): six hat styles, live
// material/color swap, a brim-curve control that reshapes geometry, a "tip
// hat" nod animation and a hover glow.

import * as THREE from "three";

// Order used by the try-on swipe gesture and the style segment control.
export const HAT_STYLES = ["cap", "snapback", "beanie", "bucket", "fedora", "beret"];

const BAND_WIDTH = 6.4; // head-band diameter in model units (AR scale reference)

/* ------------------------------------------------------------------ *
 *  Materials
 * ------------------------------------------------------------------ */
const MATERIAL_PARAMS = {
  cotton: { roughness: 0.95, clearcoat: 0.0, sheen: 0.3, sheenRoughness: 0.7, normalScale: 0.45 },
  wool: { roughness: 1.0, clearcoat: 0.0, sheen: 0.55, sheenRoughness: 0.75, normalScale: 0.6 },
  denim: { roughness: 0.92, clearcoat: 0.0, sheen: 0.28, sheenRoughness: 0.6, normalScale: 0.75 },
  leather: { roughness: 0.45, clearcoat: 0.5, sheen: 0.0, sheenRoughness: 0.3, normalScale: 0.12 },
};

// Procedural twill-weave normal map — breaks the "smooth plastic" look and
// gives fabric a woven micro-surface under the key light.
let weaveTex = null;
function makeWeaveTexture() {
  if (weaveTex) return weaveTex;
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(s, s);
  const d = img.data;
  const REP = 8;
  const h = (x, y) => {
    const u = (((x % s) + s) % s) / s * REP;
    const v = (((y % s) + s) % s) / s * REP;
    const over = (Math.floor(u) + Math.floor(v)) % 2 === 0;
    return (over ? Math.cos(u * Math.PI * 2) : Math.cos(v * Math.PI * 2)) * 0.5;
  };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 0.5;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 0.5;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  weaveTex = new THREE.CanvasTexture(c);
  weaveTex.wrapS = weaveTex.wrapT = THREE.RepeatWrapping;
  weaveTex.repeat.set(10, 10);
  weaveTex.anisotropy = 4;
  return weaveTex;
}

function makeFabricMaterial(state, darken = 1) {
  const p = MATERIAL_PARAMS[state.hatMaterial] || MATERIAL_PARAMS.cotton;
  const color = new THREE.Color(state.hatColor).multiplyScalar(darken);
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.0,
    roughness: p.roughness,
    clearcoat: p.clearcoat,
    clearcoatRoughness: 0.35,
    sheen: p.sheen,
    sheenRoughness: p.sheenRoughness,
    sheenColor: color.clone().lerp(new THREE.Color(0xffffff), 0.15),
    emissive: color,
    emissiveIntensity: 0.0,
    envMapIntensity: 0.35,
    normalMap: makeWeaveTexture(),
    normalScale: new THREE.Vector2(p.normalScale, p.normalScale),
  });
}

// Dark unlit lining: reads as the hat's interior shadow, so the open bottom
// never shows background/scalp through the shell.
function makeLiningMaterial(state) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(state.hatColor).multiplyScalar(0.22),
    side: THREE.BackSide,
  });
}

/* ------------------------------------------------------------------ *
 *  Geometry helpers
 * ------------------------------------------------------------------ */
function scaledSphere(rx, ry, rz, thetaLength = Math.PI / 2) {
  const geo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, thetaLength);
  geo.scale(rx, ry, rz);
  return geo;
}

// Caps are domed, not egg-shaped: compress the very top of the dome.
const FLATTEN_Y = 2.4;
const FLATTEN_K = 0.82;
const flattenTop = (y) => (y > FLATTEN_Y ? FLATTEN_Y + (y - FLATTEN_Y) * FLATTEN_K : y);

// Bend brim vertices downward past a z threshold (cap-style droop).
function droopForward(geo, curve, zStart, strength) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > zStart) {
      pos.setY(i, pos.getY(i) - curve * Math.pow(z - zStart, 1.6) * strength);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Bend a flat ring's outer edge downward all the way around (fedora-style).
function droopRing(geo, curve, rStart, strength) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    if (r > rStart) {
      pos.setY(i, pos.getY(i) - curve * Math.pow(r - rStart, 1.6) * strength);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Cap visor: a crescent that starts at the band line and reaches forward.
// Lies in the x-z plane after construction, top surface at y ≈ 0.
function visorGeo(bandR, length, halfWidth) {
  const z0 = bandR * 0.88;
  const s = new THREE.Shape();
  s.moveTo(-halfWidth, z0 + 0.35);
  s.quadraticCurveTo(-halfWidth * 1.08, z0 + length * 0.6, 0, z0 + length);
  s.quadraticCurveTo(halfWidth * 1.08, z0 + length * 0.6, halfWidth, z0 + 0.35);
  s.quadraticCurveTo(halfWidth * 0.82, z0 - bandR * 0.16, 0, z0 - bandR * 0.2);
  s.quadraticCurveTo(-halfWidth * 0.82, z0 - bandR * 0.16, -halfWidth, z0 + 0.35);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 48,
  });
  geo.rotateX(Math.PI / 2); // lay flat, extending toward +z (face forward)
  return geo;
}

// Raised seams along the dome meridians (the classic 6-panel cap look).
function domeSeams(rx, ry, rz, thetaMax, count, mat) {
  const g = new THREE.Group();
  for (let s = 0; s < count; s++) {
    const a = (s / count) * Math.PI * 2;
    const pts = [];
    const N = 14;
    for (let i = 1; i <= N; i++) {
      const phi = 0.12 + (thetaMax - 0.12) * (i / N);
      const k = 1.008;
      pts.push(
        new THREE.Vector3(
          Math.sin(phi) * Math.cos(a) * rx * k,
          flattenTop(Math.cos(phi) * ry) * k,
          Math.sin(phi) * Math.sin(a) * rz * k
        )
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 6, false), mat));
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  Brim builders (rebuilt when the curve slider changes)
 * ------------------------------------------------------------------ */
function buildBrim(style, curve, mats) {
  let mesh = null;
  if (style === "cap" || style === "snapback") {
    const snap = style === "snapback";
    const geo = visorGeo(3.3, snap ? 3.0 : 2.7, snap ? 2.8 : 2.6);
    droopForward(geo, curve, 3.3 * 0.88, snap ? 0.14 : 0.3);
    mesh = new THREE.Mesh(geo, mats.main);
    mesh.position.set(0, -0.05, 0);
  } else if (style === "bucket") {
    const bottomR = THREE.MathUtils.lerp(4.4, 5.5, curve);
    const geo = new THREE.CylinderGeometry(3.38, bottomR, 1.3, 56, 1, true);
    droopRing(geo, curve, 3.8, 0.3);
    mesh = new THREE.Mesh(geo, mats.main);
    mesh.position.y = -0.45;
    mesh.material.side = THREE.DoubleSide;
    // Stitch ring circling the brim.
    const midR = THREE.MathUtils.lerp(3.38, bottomR, 0.5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(midR, 0.045, 8, 56), mats.detail);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.65 - curve * Math.pow(Math.max(0, midR - 3.8), 1.6) * 0.15;
    mesh.add(ring);
  } else if (style === "fedora") {
    const geo = new THREE.RingGeometry(3.45, 5.5, 72, 1);
    geo.rotateX(-Math.PI / 2);
    geo.scale(1, 1, 0.92);
    droopRing(geo, curve, 4.3, 0.42);
    mesh = new THREE.Mesh(geo, mats.main);
    mesh.position.y = 0.18;
    mesh.rotation.x = 0.05; // front-down tilt
    mesh.material.side = THREE.DoubleSide;
    // Rolled edge around the brim rim.
    const edge = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.1, 10, 72), mats.detail);
    edge.rotation.x = Math.PI / 2;
    edge.scale.z = 0.92;
    edge.position.y = -curve * Math.pow(5.5 - 4.3, 1.6) * 0.42;
    mesh.add(edge);
  }
  if (mesh) mesh.castShadow = true;
  return mesh; // null for beanie / beret
}

/* ------------------------------------------------------------------ *
 *  Crown builders (built once per style swap)
 * ------------------------------------------------------------------ */
function buildCrown(style, mats) {
  const g = new THREE.Group();

  if (style === "cap" || style === "snapback") {
    const snap = style === "snapback";
    const rx = 3.3;
    const ry = snap ? 4.0 : 3.8;
    const rz = 3.45;
    const theta = Math.PI * 0.56; // rim dips below the band line, wraps the brow

    const domeGeo = scaledSphere(rx, ry, rz, theta);
    const dp = domeGeo.attributes.position;
    for (let i = 0; i < dp.count; i++) dp.setY(i, flattenTop(dp.getY(i)));
    dp.needsUpdate = true;
    domeGeo.computeVertexNormals();
    const crown = new THREE.Mesh(domeGeo, mats.main);
    crown.position.y = 0.1;
    crown.castShadow = true;

    const seams = domeSeams(rx, ry, rz, theta, 6, mats.detail);
    seams.position.y = 0.1;

    const topY = flattenTop(ry);
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 10), mats.detail);
    button.scale.y = 0.55;
    button.position.set(0, 0.1 + topY - 0.02, 0);

    // Base trim: an elliptical ring following the dome rim.
    const rimK = Math.sin(theta);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 72), mats.detail);
    trim.scale.set(rx * rimK, 1, rz * rimK);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.1 + ry * Math.cos(theta);

    const lining = new THREE.Mesh(
      scaledSphere(rx * 0.94, ry * 0.94, rz * 0.94, Math.PI * 0.58),
      mats.lining
    );
    lining.position.y = 0.1;

    g.add(crown, seams, button, trim, lining);
  } else if (style === "beanie") {
    const domeGeo = scaledSphere(3.22, 3.55, 3.18, Math.PI * 0.62);
    // Slouch: the soft top folds toward the back (front stays covering).
    const pos = domeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (y > 1.6 && z < 0.5) {
        const t = (y - 1.6) / (3.55 - 1.6);
        pos.setZ(i, z - t * 0.85);
        pos.setY(i, y - t * 0.3);
      }
    }
    pos.needsUpdate = true;
    domeGeo.computeVertexNormals();
    const dome = new THREE.Mesh(domeGeo, mats.main);
    dome.position.y = 0.15;
    dome.castShadow = true;

    // Ribbed cuff.
    const cuffGeo = new THREE.CylinderGeometry(3.28, 3.28, 1.35, 88, 6, true);
    const cp = cuffGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i);
      const z = cp.getZ(i);
      const rib = 1 + 0.045 * Math.sin(Math.atan2(z, x) * 40);
      cp.setX(i, x * rib);
      cp.setZ(i, z * rib);
    }
    cp.needsUpdate = true;
    cuffGeo.computeVertexNormals();
    const cuff = new THREE.Mesh(cuffGeo, mats.main);
    cuff.position.y = -0.55;
    cuff.material.side = THREE.DoubleSide;

    const lining = new THREE.Mesh(
      scaledSphere(2.95, 2.8, 2.9, Math.PI * 0.62),
      mats.lining
    );
    lining.position.y = 0.15;

    g.add(dome, cuff, lining);
  } else if (style === "bucket") {
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 3.38, 2.4, 56, 1),
      mats.main
    );
    crown.position.y = 1.3;
    crown.castShadow = true;
    // Rounded top so the crown reads as soft fabric, not a tin can.
    const top = new THREE.Mesh(scaledSphere(2.92, 1.5, 2.92), mats.main);
    top.position.y = 2.45;
    top.castShadow = true;

    const lining = new THREE.Mesh(scaledSphere(2.5, 2.1, 2.5, Math.PI * 0.55), mats.lining);
    lining.position.y = 1.5;

    g.add(crown, top, lining);
  } else if (style === "fedora") {
    const geo = new THREE.CylinderGeometry(2.9, 3.45, 3.6, 56, 5);
    geo.scale(1, 1, 0.97); // slight front-back pinch
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Center crease along the crown top.
      if (y > 1.45) pos.setY(i, y - 0.38 * Math.exp(-(x * x) / 1.8));
      // Front pinch.
      if (z > 0 && y > 0.4) {
        pos.setZ(i, z - 0.32 * Math.exp(-(x * x) / 1.6) * Math.min(1, (y - 0.4) / 1.6));
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const crown = new THREE.Mesh(geo, mats.main);
    crown.position.y = 1.85;
    crown.castShadow = true;

    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(3.47, 3.51, 0.8, 56, 1, true),
      mats.detail
    );
    band.position.y = 0.6;
    band.material.side = THREE.DoubleSide;

    const lining = new THREE.Mesh(scaledSphere(2.75, 2.2, 2.6, Math.PI * 0.55), mats.lining);
    lining.position.y = 1.3;

    g.add(crown, band, lining);
  } else if (style === "beret") {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(3.3, 3.36, 0.72, 48, 1, true),
      mats.detail
    );
    band.position.y = 0.34;
    band.material.side = THREE.DoubleSide;

    // Flat wide disc with a bound edge, slouched to one side.
    // The shell curls under at the rim (theta > π/2) so no gap shows below it.
    const discGeo = scaledSphere(4.4, 1.8, 4.05, Math.PI * 0.6);
    droopRing(discGeo, 1.0, 3.7, 0.3); // soft fabric droop at the rim
    const disc = new THREE.Mesh(discGeo, mats.main);
    disc.position.set(-0.7, 1.7, 0);
    disc.rotation.z = -0.3; // slouch
    disc.castShadow = true;
    // Bound edge around the disc rim (reads as the beret's welt).
    const welt = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.15, 10, 64), mats.detail);
    welt.rotation.x = Math.PI / 2;
    welt.scale.z = 4.05 / 4.4;
    welt.position.y = -0.05;
    disc.add(welt);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 12), mats.detail);
    stem.position.set(-0.9, 3.45, 0);
    stem.rotation.z = -0.3;

    const lining = new THREE.Mesh(scaledSphere(3.2, 1.9, 3.0), mats.lining);
    lining.position.y = 0.6;

    g.rotation.x = 0.2; // tip the disc slightly toward the camera
    g.rotation.y = 0.12; // show the slouched side from the default angle
    g.add(band, disc, stem, lining);
  }

  return g;
}

/* ------------------------------------------------------------------ *
 *  Public factory
 * ------------------------------------------------------------------ */
export function createHat(state) {
  const group = new THREE.Group();
  group.name = "hat";

  const mats = {
    main: makeFabricMaterial(state),
    detail: makeFabricMaterial(state, 0.78),
    lining: makeLiningMaterial(state),
  };

  let currentStyle = state.hatStyle || "cap";
  let currentCurve = state.brimCurve ?? 0.45;
  let crown = null;
  let brim = null;

  const front = new THREE.Group();
  group.add(front);

  function disposeKids(parent) {
    for (const child of [...parent.children]) {
      child.traverse((o) => o.geometry && o.geometry.dispose());
      parent.remove(child);
    }
  }

  function rebuildBrim() {
    if (brim) {
      front.remove(brim);
      brim.traverse((o) => o.geometry && o.geometry.dispose());
      brim = null;
    }
    brim = buildBrim(currentStyle, currentCurve, mats);
    if (brim) front.add(brim);
  }

  function buildAll() {
    disposeKids(front);
    crown = buildCrown(currentStyle, mats);
    front.add(crown);
    rebuildBrim();
    front.add(hoverProxy);
  }

  // Invisible hover proxy covering the whole hat.
  const hoverProxy = new THREE.Mesh(
    new THREE.SphereGeometry(5.8, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
  );
  hoverProxy.position.set(0, 2.2, 0.3);

  buildAll();

  /* ---- live material application ---- */
  function applyState(s) {
    const p = MATERIAL_PARAMS[s.hatMaterial] || MATERIAL_PARAMS.cotton;
    for (const [mat, darken] of [[mats.main, 1], [mats.detail, 0.78]]) {
      const color = new THREE.Color(s.hatColor).multiplyScalar(darken);
      mat.color.copy(color);
      mat.roughness = p.roughness;
      mat.clearcoat = p.clearcoat;
      mat.sheen = p.sheen;
      mat.sheenRoughness = p.sheenRoughness;
      mat.sheenColor.copy(color).lerp(new THREE.Color(0xffffff), 0.15);
      mat.emissive.copy(color);
      mat.normalScale.setScalar(p.normalScale);
      mat.needsUpdate = true;
    }
    mats.lining.color.copy(new THREE.Color(s.hatColor).multiplyScalar(0.22));
    const curve = s.brimCurve ?? 0.45;
    if (Math.abs(curve - currentCurve) > 0.001) {
      currentCurve = curve;
      rebuildBrim();
      hoverProxy && front.add(hoverProxy); // keep proxy present after rebuild
    }
  }

  /* ---- style swap ---- */
  function applyStyle(style) {
    if (!HAT_STYLES.includes(style) || style === currentStyle) return;
    currentStyle = style;
    buildAll();
  }

  const hasBrim = () => ["cap", "snapback", "bucket", "fedora"].includes(currentStyle);

  /* ---- tip-hat nod animation ---- */
  let tipPhase = -1; // <0 = idle
  function tipHat() {
    if (tipPhase < 0) tipPhase = 0;
  }
  const isTipping = () => tipPhase >= 0;

  /* ---- hover glow ---- */
  let glow = 0;
  let glowTarget = 0;
  function setHoverGlow(on) {
    glowTarget = on ? 1 : 0;
  }

  /* ---- per-frame update ---- */
  const BASE_Y = 0;
  function update(dt) {
    // hover glow
    glow += (glowTarget - glow) * Math.min(1, dt * 12);
    mats.main.emissiveIntensity = glow * 0.14;
    mats.detail.emissiveIntensity = glow * 0.14;
    const pulse = 1 + glow * (0.015 + Math.sin(performance.now() * 0.006) * 0.006);
    group.scale.setScalar(pulse);

    // tip-hat nod
    let nod = 0;
    let bob = 0;
    if (tipPhase >= 0) {
      tipPhase += dt / 0.9;
      if (tipPhase >= 1) tipPhase = -1;
      else {
        const s = Math.sin(tipPhase * Math.PI);
        nod = -s * 0.38;
        bob = s * 0.4;
      }
    }
    group.rotation.x = nod;
    group.position.y = BASE_Y + bob;
  }

  applyState(state);

  return {
    group,
    front,
    mats,
    applyState,
    applyStyle,
    update,
    tipHat,
    isTipping,
    setHoverGlow,
    hasBrim,
    hoverTargets: [hoverProxy],
    headWidth: BAND_WIDTH,
  };
}
