// main.js
import * as THREE from 'three';
import { setupQFN } from './qfnScene1.js';
import { setupCube } from './qfnScene2.js';
import { setupSkyscraper } from './qfnScene3.js';
import { setupCorridor } from './qfnScene4.js';
import { setupPerlin } from './qfnScene5.js';
import { setupMatrixRain } from './qfnScene6.js';

// ---------------------------------------------------------
// Renderer
// ---------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

// ---------------------------------------------------------
// Fullscreen button
// ---------------------------------------------------------
const fullscreenBtn = document.createElement('button');
fullscreenBtn.innerText = '⛶';
Object.assign(fullscreenBtn.style, {
  position: 'fixed',
  bottom: '10px',
  right: '10px',
  padding: '8px 12px',
  fontSize: '16px',
  background: 'rgba(0,0,0,0.6)',
  color: 'white',
  border: '1px solid white',
  borderRadius: '4px',
  cursor: 'pointer',
  zIndex: 999
});
fullscreenBtn.addEventListener('click', () => {
  const canvas = renderer.domElement;
  if (!document.fullscreenElement) {
    canvas.requestFullscreen?.() || canvas.webkitRequestFullscreen?.();
  } else {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.();
  }
});
document.body.appendChild(fullscreenBtn);

// ---------------------------------------------------------
// Clock
// ---------------------------------------------------------
const clock = new THREE.Clock();

// ---------------------------------------------------------
// Scene registry
// ---------------------------------------------------------
const scenes = {
  1: setupQFN,
  2: setupCube,
  3: setupSkyscraper,
  4: setupCorridor,
  5: setupPerlin,
  6: setupMatrixRain,
};
const sceneIds = Object.keys(scenes).map(Number);
let currentSceneIndex = 0;

// Active scene bundle
let activeScene = null;
let activeCamera = null;
let activeAnimate = () => {};

// ---------------------------------------------------------
// Transition plumbing (render targets + fullscreen mix shader)
// ---------------------------------------------------------
const rtParams = {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  depthBuffer: true,
  stencilBuffer: false
};

let rtA = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, rtParams);
let rtB = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, rtParams);

const screenScene = new THREE.Scene();
const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const mixMat = new THREE.ShaderMaterial({
  uniforms: {
    tFrom: { value: null },
    tTo: { value: null },
    progress: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tFrom;
    uniform sampler2D tTo;
    uniform float progress;

    float ease(float x) {
      // smoothstep - can swap for fancier easing later
      return smoothstep(0.0, 1.0, x);
    }

    void main() {
      float p = ease(progress);
      vec4 a = texture2D(tFrom, vUv);
      vec4 b = texture2D(tTo,   vUv);
      gl_FragColor = mix(a, b, p);
    }
  `,
  depthTest: false,
  depthWrite: false,
  transparent: false
});

const mixQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mixMat);
screenScene.add(mixQuad);

// Transition state
let transitioning = false;
let nextBundle = null;          // { scene, camera, animate }
let nextSceneId = null;
let transitionStart = 0;
let transitionDuration = 1.5;   // seconds

// ---------------------------------------------------------
// Helpers: dispose + load/prep scenes
// ---------------------------------------------------------
function disposeObject(obj) {
  // Dispose geometry/material/texture recursively
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose?.();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.());
      else child.material.dispose?.();
    }
    if (child.texture) child.texture.dispose?.();
  });
}

function disposeScene(scene) {
  if (!scene) return;
  // Remove children so they can be GC'd
  while (scene.children.length) {
    const child = scene.children.pop();
    scene.remove(child);
    disposeObject(child);
  }
}

function loadScene(sceneId) {
  const setup = scenes[sceneId];
  if (!setup) return;

  const { scene, camera, animate } = setup();
  if (activeScene) disposeScene(activeScene);

  activeScene = scene;
  activeCamera = camera;
  activeAnimate = animate || (() => {});
}

function prepNextScene(sceneId) {
  const setup = scenes[sceneId];
  if (!setup) return null;
  const { scene, camera, animate } = setup();
  return { scene, camera, animate: animate || (() => {}) };
}

// ---------------------------------------------------------
// Transition control
// ---------------------------------------------------------
function startTransition(toSceneId) {
  if (transitioning) return; // ignore re-entrancy
  nextSceneId = toSceneId;
  nextBundle = prepNextScene(toSceneId);
  if (!nextBundle) return;

  transitioning = true;
  transitionStart = clock.getElapsedTime();
  mixMat.uniforms.progress.value = 0.0;
}

function finishTransition() {
  // Swap "to" scene as active
  disposeScene(activeScene);
  activeScene = nextBundle.scene;
  activeCamera = nextBundle.camera;
  activeAnimate = nextBundle.animate;

  // Cleanup
  nextBundle = null;
  nextSceneId = null;
  transitioning = false;
}

// ---------------------------------------------------------
// Initial load
// ---------------------------------------------------------
loadScene(sceneIds[currentSceneIndex]);

// ---------------------------------------------------------
// Animate loop
// ---------------------------------------------------------
function animateLoop() {
  requestAnimationFrame(animateLoop);
  const delta = clock.getDelta();

  if (!transitioning) {
    // Normal render
    activeAnimate(delta);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(activeScene, activeCamera);
    return;
  }

  // During transition, drive both scenes
  activeAnimate(delta);
  nextBundle.animate(delta);

  // Render current to rtA
  renderer.setRenderTarget(rtA);
  renderer.clear();
  renderer.render(activeScene, activeCamera);

  // Render next to rtB
  renderer.setRenderTarget(rtB);
  renderer.clear();
  renderer.render(nextBundle.scene, nextBundle.camera);

  // Mix to screen
  renderer.setRenderTarget(null);
  mixMat.uniforms.tFrom.value = rtA.texture;
  mixMat.uniforms.tTo.value = rtB.texture;

  const t = (clock.getElapsedTime() - transitionStart) / transitionDuration;
  mixMat.uniforms.progress.value = Math.min(Math.max(t, 0), 1);
  renderer.render(screenScene, screenCam);

  if (t >= 1) {
    finishTransition();
  }
}
animateLoop();

// ---------------------------------------------------------
// Controls: number keys & spacebar auto-cycle
// ---------------------------------------------------------
let cycling = false;
let cycleTimeout = null; // add this


function startCycle() {
  cycling = true;

  function scheduleNextCycle() {
    // Random duration between 30s and 5min
    const min = 10 * 1000;      // 30 seconds
    const max = 5* 60 * 1000;  // 5 minutes
    const delay = Math.random() * (max - min) + min;

    cycleTimeout = setTimeout(() => {
      const nextIndex = (currentSceneIndex + 1) % sceneIds.length;
      startTransition(sceneIds[nextIndex]);
      currentSceneIndex = nextIndex;

      if (cycling) {
        scheduleNextCycle(); // Schedule again
      }
    }, delay);
  }

  scheduleNextCycle();
}

function stopCycle() {
  cycling = false;
  clearTimeout(cycleTimeout);
}


window.addEventListener('keydown', (e) => {
  // Number keys 1–9
  const sceneNumber = parseInt(e.key, 10);
  if (sceneNumber && scenes[sceneNumber]) {
    stopCycle(); // stop auto-cycling if manual switch
    const idx = sceneIds.indexOf(sceneNumber);
    if (idx !== -1) {
      startTransition(sceneIds[idx]);
      currentSceneIndex = idx;
    }
  }

  // Space bar toggles auto-cycle
  if (e.code === 'Space') {
    e.preventDefault();
    cycling ? stopCycle() : startCycle();
  }
});

// ---------------------------------------------------------
// Resize handling (renderer + render targets + camera)
// ---------------------------------------------------------
function resizeRendererToWindow() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);

  if (activeCamera && activeCamera.isPerspectiveCamera) {
    activeCamera.aspect = width / height;
    activeCamera.updateProjectionMatrix();
  }

  rtA.setSize(width, height);
  rtB.setSize(width, height);
}

// Resize on fullscreen change and window resize
document.addEventListener('fullscreenchange', resizeRendererToWindow);
document.addEventListener('webkitfullscreenchange', resizeRendererToWindow);
window.addEventListener('resize', resizeRendererToWindow);
