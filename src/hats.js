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
  cotton: { roughness: 0.82, clearcoat: 0.06, sheen: 0.25, sheenRoughness: 0.5 },
  wool: { roughness: 0.96, clearcoat: 0.0, sheen: 0.7, sheenRoughness: 0.55 },
  denim: { roughness: 0.88, clearcoat: 0.03, sheen: 0.4, sheenRoughness: 0.6 },
  leather: { roughness: 0.38, clearcoat: 0.7, sheen: 0.0, sheenRoughness: 0.3 },
};

function makeFabricMaterial(state, darken = 1) {
  const p = MATERIAL_PARAMS[state.hatMaterial] || MATERIAL_PARAMS.cotton;
  const color = new THREE.Color(state.hatColor).multiplyScalar(darken);
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.0,
    roughness: p.roughness,
    clearcoat: p.clearcoat,
    clearcoatRoughness: 0.25,
    sheen: p.sheen,
    sheenRoughness: p.sheenRoughness,
    sheenColor: color.clone().lerp(new THREE.Color(0xffffff), 0.15),
    emissive: color,
    emissiveIntensity: 0.0,
    envMapIntensity: 0.25,
  });
}

/* ------------------------------------------------------------------ *
 *  Geometry helpers
 * ------------------------------------------------------------------ */

// Bend brim vertices downward past a z threshold (cap-style droop).
function droopForward(geo, curve, zStart, strength) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > zStart) {
      pos.setY(i, pos.getY(i) - curve * Math.pow(z - zStart, 1.7) * strength);
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

// Crescent brim outline in 2D (x,y), extruded thin, then laid flat (x,z).
function crescentBrimGeo(tip, cornerX, innerY) {
  const s = new THREE.Shape();
  s.moveTo(-cornerX, 0.3);
  s.quadraticCurveTo(-cornerX * 1.45, tip * 0.5, 0, tip);
  s.quadraticCurveTo(cornerX * 1.45, tip * 0.5, cornerX, 0.3);
  s.quadraticCurveTo(cornerX * 0.75, innerY * 0.9, 0, innerY);
  s.quadraticCurveTo(-cornerX * 0.75, innerY * 0.9, -cornerX, 0.3);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05,
    bevelSegments: 2, curveSegments: 40,
  });
  geo.rotateX(Math.PI / 2); // lay flat, extending toward +z (face forward)
  return geo;
}

/* ------------------------------------------------------------------ *
 *  Brim builders (rebuilt when the curve slider changes)
 * ------------------------------------------------------------------ */
function buildBrim(style, curve, mat) {
  let mesh = null;
  if (style === "cap") {
    const geo = droopForward(crescentBrimGeo(7.8, 3.5, 3.3), curve, 3.6, 0.3);
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0.0, 0.05);
  } else if (style === "snapback") {
    const geo = droopForward(crescentBrimGeo(8.2, 3.6, 3.4), curve, 3.8, 0.16);
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0.0, 0.05);
  } else if (style === "bucket") {
    const bottomR = THREE.MathUtils.lerp(4.3, 5.7, curve);
    const geo = new THREE.CylinderGeometry(3.18, bottomR, 1.5, 56, 1, true);
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -0.1;
    mesh.material.side = THREE.DoubleSide;
  } else if (style === "fedora") {
    const geo = new THREE.RingGeometry(2.98, 6.0, 64, 1);
    geo.rotateX(-Math.PI / 2);
    droopRing(geo, curve, 4.4, 0.34);
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.12;
    mesh.rotation.x = 0.06; // front-down tilt
    mesh.material.side = THREE.DoubleSide;
  }
  if (mesh) mesh.castShadow = true;
  return mesh; // null for beanie / beret
}

/* ------------------------------------------------------------------ *
 *  Crown builders (built once per style swap)
 * ------------------------------------------------------------------ */
function scaledSphere(rx, ry, rz, thetaLength = Math.PI / 2) {
  const geo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, thetaLength);
  geo.scale(rx, ry, rz);
  return geo;
}

function buildCrown(style, mats) {
  const g = new THREE.Group();

  if (style === "cap" || style === "snapback") {
    const tall = style === "snapback" ? 3.5 : 3.1;
    const crown = new THREE.Mesh(scaledSphere(3.35, tall, 3.6, Math.PI * 0.54), mats.main);
    crown.position.y = 0.25;
    crown.castShadow = true;
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12), mats.detail);
    button.scale.y = 0.7;
    button.position.set(0, 0.25 + tall - 0.05, -0.1);
    g.add(crown, button);
  } else if (style === "beanie") {
    const dome = new THREE.Mesh(scaledSphere(3.3, 3.55, 3.38), mats.main);
    dome.position.y = 0.5;
    dome.castShadow = true;
    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(3.34, 3.42, 1.25, 48, 1, true), mats.detail
    );
    cuff.position.y = 0.0;
    cuff.material.side = THREE.DoubleSide;
    g.add(dome, cuff);
  } else if (style === "bucket") {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.78, 3.16, 2.6, 48), mats.main);
    crown.position.y = 1.35;
    crown.castShadow = true;
    g.add(crown);
  } else if (style === "fedora") {
    const geo = new THREE.CylinderGeometry(2.62, 2.96, 2.9, 48);
    geo.scale(1, 1, 0.88); // slight front-back pinch
    // Center crease along the crown top.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 1.3) {
        pos.setY(i, pos.getY(i) - 0.62 * Math.exp(-Math.pow(pos.getX(i) / 1.05, 2)));
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const crown = new THREE.Mesh(geo, mats.main);
    crown.position.y = 1.5;
    crown.castShadow = true;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(2.99, 3.03, 0.78, 48, 1, true), mats.detail
    );
    band.position.y = 0.62;
    band.material.side = THREE.DoubleSide;
    g.add(crown, band);
  } else if (style === "beret") {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(3.0, 3.06, 0.72, 48, 1, true), mats.detail
    );
    band.position.y = 0.34;
    band.material.side = THREE.DoubleSide;
    // Flat wide disc with a bound edge, slouched hard to one side.
    const discGeo = scaledSphere(5.2, 1.25, 4.6);
    droopRing(discGeo, 1.0, 4.0, 0.5); // soft fabric droop at the rim
    const disc = new THREE.Mesh(discGeo, mats.main);
    disc.position.set(-1.6, 1.0, 0);
    disc.rotation.z = -0.45; // slouch
    disc.castShadow = true;
    // Bound edge around the disc rim (reads as the beret's welt).
    const welt = new THREE.Mesh(new THREE.TorusGeometry(4.95, 0.14, 10, 64), mats.detail);
    welt.rotation.x = Math.PI / 2;
    welt.scale.z = 4.6 / 5.2;
    disc.add(welt);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 12), mats.detail);
    stem.position.set(-2.1, 2.5, 0);
    stem.rotation.z = -0.45;
    g.rotation.x = 0.45; // tip the disc toward the camera so it reads as a beret
    g.rotation.y = 0.3; // show the slouched side from the default angle
    g.add(band, disc, stem);
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
    detail: makeFabricMaterial(state, 0.8),
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
      brim.geometry.dispose();
      brim = null;
    }
    brim = buildBrim(currentStyle, currentCurve, mats.main);
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
    new THREE.SphereGeometry(5.2, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
  );
  hoverProxy.position.set(0, 2.0, 0.4);

  buildAll();

  /* ---- live material application ---- */
  function applyState(s) {
    for (const [mat, darken] of [[mats.main, 1], [mats.detail, 0.8]]) {
      const p = MATERIAL_PARAMS[s.hatMaterial] || MATERIAL_PARAMS.cotton;
      const color = new THREE.Color(s.hatColor).multiplyScalar(darken);
      mat.color.copy(color);
      mat.roughness = p.roughness;
      mat.clearcoat = p.clearcoat;
      mat.sheen = p.sheen;
      mat.sheenRoughness = p.sheenRoughness;
      mat.sheenColor.copy(color).lerp(new THREE.Color(0xffffff), 0.15);
      mat.emissive.copy(color);
      mat.needsUpdate = true;
    }
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
