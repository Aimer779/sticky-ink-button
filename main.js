import { DEFAULT_CONFIG, StickyInkPhysics } from './physics.js';
import { StickyInkRenderer } from './renderer.js';

const stageCard = document.getElementById('stage-card');
const inkCanvas = document.getElementById('ink-canvas');
const collabBtn = document.getElementById('collab-btn');
const customCursor = document.getElementById('custom-cursor');

const tuneDock = document.getElementById('tune-dock');
const tuneToggle = document.getElementById('tune-toggle');
const tunePanel = document.getElementById('tune-panel');
const tuneReset = document.getElementById('tune-reset');

const ctrlStrands = document.getElementById('ctrl-strands');
const ctrlStretch = document.getElementById('ctrl-stretch');
const ctrlElasticity = document.getElementById('ctrl-elasticity');
const ctrlGlossiness = document.getElementById('ctrl-glossiness');
const ctrlCursor = document.getElementById('ctrl-cursor');

const valStrands = document.getElementById('val-strands');
const valStretch = document.getElementById('val-stretch');
const valElasticity = document.getElementById('val-elasticity');
const valGlossiness = document.getElementById('val-glossiness');

// Fingertip hotspot inside the 32x36 custom SVG cursor
const CURSOR_HOTSPOT_X = 11.5;
const CURSOR_HOTSPOT_Y = 2.5;

const physics = new StickyInkPhysics({
  width: stageCard.clientWidth || 1080,
  height: stageCard.clientHeight || 640,
});

const renderer = new StickyInkRenderer(inkCanvas, physics);
if (!renderer.isWebGL2) {
  stageCard.classList.add('no-webgl');
}

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let isReducedMotion = reducedMotionQuery.matches;
let isTuneHovered = false;
let lastFrameTime = performance.now();
let rafId = 0;

function syncStageSize() {
  const rect = stageCard.getBoundingClientRect();
  const w = Math.max(280, Math.round(rect.width));
  const h = Math.max(280, Math.round(rect.height));
  physics.resize(w, h);
  renderer.resize(w, h, window.devicePixelRatio || 1);
  if (isReducedMotion) {
    renderer.render();
  }
}

const resizeObserver = new ResizeObserver(syncStageSize);
resizeObserver.observe(stageCard);
window.addEventListener('resize', syncStageSize);
syncStageSize();

function updateCustomCursorDisplay() {
  const shouldShow =
    physics.config.customCursor &&
    physics.pointer.insideStage &&
    !isTuneHovered &&
    !isReducedMotion;

  stageCard.classList.toggle('use-custom-cursor', physics.config.customCursor && !isReducedMotion);
  stageCard.classList.toggle('tune-hovered', isTuneHovered);

  if (shouldShow) {
    customCursor.hidden = false;
    const tx = physics.pointer.x - CURSOR_HOTSPOT_X;
    const ty = physics.pointer.y - CURSOR_HOTSPOT_Y;
    customCursor.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
  } else {
    customCursor.hidden = true;
  }
}

function pointerEventToStage(e) {
  const rect = stageCard.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

stageCard.addEventListener('pointerenter', (e) => {
  if (isReducedMotion) return;
  const pt = pointerEventToStage(e);
  physics.setPointer(pt.x, pt.y, true);
  updateCustomCursorDisplay();
});

stageCard.addEventListener('pointermove', (e) => {
  if (isReducedMotion) return;
  const pt = pointerEventToStage(e);
  if (e.target && tuneDock.contains(e.target)) {
    isTuneHovered = true;
    physics.leaveStage();
  } else {
    isTuneHovered = false;
    physics.setPointer(pt.x, pt.y, true);
  }
  updateCustomCursorDisplay();
});

stageCard.addEventListener('pointerdown', (e) => {
  if (isReducedMotion) return;
  if (e.target && tuneDock.contains(e.target)) return;
  const pt = pointerEventToStage(e);
  physics.setPointer(pt.x, pt.y, true);
  physics.setPointerDown(true);
  updateCustomCursorDisplay();
});

stageCard.addEventListener('pointerup', () => {
  physics.setPointerDown(false);
});

stageCard.addEventListener('pointerleave', () => {
  isTuneHovered = false;
  physics.leaveStage();
  updateCustomCursorDisplay();
});

stageCard.addEventListener('pointercancel', () => {
  physics.leaveStage();
  updateCustomCursorDisplay();
});

tuneDock.addEventListener('pointerenter', () => {
  isTuneHovered = true;
  physics.leaveStage();
  updateCustomCursorDisplay();
});

tuneDock.addEventListener('pointerleave', () => {
  isTuneHovered = false;
  updateCustomCursorDisplay();
});

collabBtn.addEventListener('click', () => {
  physics.triggerClickPulse();
  collabBtn.classList.add('is-pressed');
  window.setTimeout(() => {
    collabBtn.classList.remove('is-pressed');
  }, 160);
});

// Collapsible Tune Panel
function setTuneOpen(open) {
  tunePanel.hidden = !open;
  tuneToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

tuneToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = tuneToggle.getAttribute('aria-expanded') === 'true';
  setTuneOpen(!isOpen);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tuneToggle.getAttribute('aria-expanded') === 'true') {
    setTuneOpen(false);
    tuneToggle.blur();
  }
});

function syncControlReadouts() {
  ctrlStrands.value = String(physics.config.strandCount);
  ctrlStretch.value = String(physics.config.breakDistance);
  ctrlElasticity.value = physics.config.elasticity.toFixed(2);
  ctrlGlossiness.value = physics.config.glossiness.toFixed(2);
  ctrlCursor.checked = Boolean(physics.config.customCursor);

  valStrands.textContent = String(physics.config.strandCount);
  valStretch.textContent = `${physics.config.breakDistance} px`;
  valElasticity.textContent = physics.config.elasticity.toFixed(2);
  valGlossiness.textContent = physics.config.glossiness.toFixed(2);
}

ctrlStrands.addEventListener('input', () => {
  physics.config.strandCount = Number(ctrlStrands.value);
  valStrands.textContent = String(physics.config.strandCount);
});

ctrlStretch.addEventListener('input', () => {
  physics.config.breakDistance = Number(ctrlStretch.value);
  valStretch.textContent = `${physics.config.breakDistance} px`;
});

ctrlElasticity.addEventListener('input', () => {
  physics.config.elasticity = Number(ctrlElasticity.value);
  valElasticity.textContent = physics.config.elasticity.toFixed(2);
});

ctrlGlossiness.addEventListener('input', () => {
  physics.config.glossiness = Number(ctrlGlossiness.value);
  valGlossiness.textContent = physics.config.glossiness.toFixed(2);
});

ctrlCursor.addEventListener('change', () => {
  physics.config.customCursor = ctrlCursor.checked;
  updateCustomCursorDisplay();
});

tuneReset.addEventListener('click', () => {
  Object.assign(physics.config, DEFAULT_CONFIG);
  syncControlReadouts();
  updateCustomCursorDisplay();
});

syncControlReadouts();

function applyReducedMotionState() {
  isReducedMotion = reducedMotionQuery.matches;
  stageCard.classList.toggle('reduced-motion', isReducedMotion);
  updateCustomCursorDisplay();

  if (isReducedMotion) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    inkCanvas.hidden = true;
  } else {
    inkCanvas.hidden = false;
    lastFrameTime = performance.now();
    if (!rafId) {
      rafId = requestAnimationFrame(tick);
    }
  }
}

reducedMotionQuery.addEventListener('change', applyReducedMotionState);

function tick(now) {
  if (isReducedMotion) {
    rafId = 0;
    return;
  }
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  physics.step(dt);
  renderer.render();
  updateCustomCursorDisplay();

  rafId = requestAnimationFrame(tick);
}

// Expose read-only inspection hooks for runtime verification
window.__stickyInk = {
  physics,
  renderer,
};

applyReducedMotionState();
