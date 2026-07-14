// main.js — shared state, UI wiring and mode switching.

import { initCustomizer } from "./customizer.js";
import { initTryOn } from "./tryon.js";
import { HAT_STYLES } from "./hats.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------- shared customization state ---------------- */
const state = {
  hatStyle: "cap",
  hatMaterial: "cotton",
  hatColor: "#1f3a5f",
  brimCurve: 0.45,
};

const PALETTES = {
  cotton: [
    ["#1f3a5f", "Navy"],
    ["#2b2f36", "Charcoal"],
    ["#a63d2f", "Brick"],
    ["#d9c7a7", "Sand"],
    ["#2f5d50", "Forest"],
  ],
  wool: [
    ["#6e2233", "Burgundy"],
    ["#c8bfa8", "Oatmeal"],
    ["#4a5568", "Slate"],
    ["#c9962f", "Mustard"],
    ["#24483b", "Pine"],
  ],
  denim: [
    ["#3b5a7a", "Classic"],
    ["#7a9cc0", "Light"],
    ["#23262b", "Black"],
    ["#2c3e70", "Indigo"],
    ["#8fa6b8", "Washed"],
  ],
  leather: [
    ["#191919", "Black"],
    ["#5a3825", "Brown"],
    ["#b08247", "Tan"],
    ["#5e2129", "Oxblood"],
    ["#e8e4dc", "White"],
  ],
};

/* ---------------- stage controllers ---------------- */
let customizer = null;
let tryon = null;
let mode = "customize";

function applyState() {
  if (customizer) customizer.applyState(state);
  if (tryon) tryon.applyState(state);
}

/* ---------------- boot ---------------- */
function boot() {
  const canvas = $("#scene");
  customizer = initCustomizer(canvas, state);
  applyState();
  $("#loader").classList.add("is-hidden");

  wireHatControls();
  wireBrimControls();
  wireGestureControls();
  wireViewControls();
  wireModeSwitch();
  renderSwatches();
  syncBrimAvailability();
}

/* ---------------- hat controls ---------------- */
function setHatStyle(style) {
  state.hatStyle = style;
  $$("#hat-style .seg-btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.value === style)
  );
  if (customizer) customizer.applyStyle(style);
  if (tryon) tryon.applyStyle(style);
  syncBrimAvailability();
}

// Brief style-name toast inside the AR stage (used by the swipe gesture).
let toastTimer = 0;
function showStyleToast(style) {
  const toast = $("#ar-toast");
  if (!toast) return;
  const btn = $(`#hat-style .seg-btn[data-value="${style}"]`);
  toast.textContent = btn ? btn.textContent : style;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 900);
}

function cycleHatStyle(dir) {
  const i = HAT_STYLES.indexOf(state.hatStyle);
  const next = HAT_STYLES[(i + dir + HAT_STYLES.length) % HAT_STYLES.length];
  setHatStyle(next);
  showStyleToast(next);
}

// Beanie and beret have no brim — grey out the curve slider for them.
function syncBrimAvailability() {
  const has = customizer ? customizer.hasBrim() : true;
  const input = $("#brim-curve");
  if (!input) return;
  input.disabled = !has;
  const field = input.closest(".slider-field");
  if (field) field.classList.toggle("is-disabled", !has);
}

function wireHatControls() {
  const styleSeg = $("#hat-style");
  styleSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    setHatStyle(btn.dataset.value);
  });

  const seg = $("#hat-material");
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.hatMaterial = btn.dataset.value;
    $$("#hat-material .seg-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    // adopt the first swatch of the new palette for an immediate preview
    const first = PALETTES[state.hatMaterial][0][0];
    setHatColor(first);
    renderSwatches();
  });

  $("#hat-color").addEventListener("input", (e) => setHatColor(e.target.value, false));
}

function setHatColor(hex, syncInput = true) {
  state.hatColor = hex;
  if (syncInput) $("#hat-color").value = hex;
  $$("#hat-swatches .swatch").forEach((s) =>
    s.classList.toggle("is-active", s.dataset.color.toLowerCase() === hex.toLowerCase())
  );
  applyState();
}

function renderSwatches() {
  const wrap = $("#hat-swatches");
  wrap.innerHTML = "";
  for (const [hex, name] of PALETTES[state.hatMaterial]) {
    const el = document.createElement("button");
    el.className = "swatch";
    el.style.background = hex;
    el.dataset.color = hex;
    el.title = name;
    el.setAttribute("aria-label", name);
    if (hex.toLowerCase() === state.hatColor.toLowerCase()) el.classList.add("is-active");
    el.addEventListener("click", () => setHatColor(hex));
    wrap.appendChild(el);
  }
}

/* ---------------- brim controls ---------------- */
function wireBrimControls() {
  bindSlider("#brim-curve", "#v-brim", (v) => (state.brimCurve = v));
}

function bindSlider(inputSel, labelSel, setter) {
  const input = $(inputSel);
  const label = $(labelSel);
  const update = () => {
    const pct = Number(input.value);
    setter(pct / 100);
    label.textContent = pct + "%";
    applyState();
  };
  input.addEventListener("input", update);
  update();
}

/* ---------------- gesture controls ---------------- */
function wireGestureControls() {
  const btn = $("#tip-hat");
  btn.addEventListener("click", () => {
    if (customizer && !customizer.isTipping()) customizer.tipHat();
  });
}

/* ---------------- view controls ---------------- */
function wireViewControls() {
  $("#reset-view").addEventListener("click", () => customizer && customizer.resetView());
  const ar = $("#autorotate");
  ar.addEventListener("click", () => {
    const on = ar.getAttribute("aria-pressed") !== "true";
    ar.setAttribute("aria-pressed", String(on));
    customizer && customizer.setAutoRotate(on);
  });
}

/* ---------------- mode switching ---------------- */
function wireModeSwitch() {
  $("#mode-customize").addEventListener("click", () => setMode("customize"));
  $("#mode-tryon").addEventListener("click", () => setMode("tryon"));
  $("#tryon-cta").addEventListener("click", () => setMode("tryon"));
}

function setMode(next) {
  if (next === mode) return;
  mode = next;
  const isTryOn = next === "tryon";

  $("#viewer").hidden = isTryOn;
  $("#tryon").hidden = !isTryOn;
  $("#mode-customize").classList.toggle("is-active", !isTryOn);
  $("#mode-customize").setAttribute("aria-selected", String(!isTryOn));
  $("#mode-tryon").classList.toggle("is-active", isTryOn);
  $("#mode-tryon").setAttribute("aria-selected", String(isTryOn));

  if (isTryOn) {
    const status = $("#ar-status");
    const setStatus = (msg) => {
      status.textContent = msg;
      status.classList.toggle("is-hidden", !msg);
    };
    setStatus("Starting camera…");
    tryon = initTryOn($("#cam"), $("#ar"), state, setStatus, cycleHatStyle);
    tryon.applyState(state);
  } else if (tryon) {
    tryon.stop();
    tryon = null;
  }
}

/* ---------------- go ---------------- */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
