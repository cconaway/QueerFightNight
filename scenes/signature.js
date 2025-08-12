// signature.js
import * as THREE from 'three';

/* ===========================
   Helpers: QR → Canvas
=========================== */
function loadQRCodeLib() {
  if (window.QRCode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load qrcodejs'));
    document.head.appendChild(s);
  });
}

function addQuietZone(srcCanvas, fraction = 0.08) {
  const border = Math.round(Math.min(srcCanvas.width, srcCanvas.height) * fraction);
  const out = document.createElement('canvas');
  out.width = srcCanvas.width + border * 2;
  out.height = srcCanvas.height + border * 2;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(srcCanvas, border, border);
  return out;
}

async function makeQrCanvas(text, size = 512, level = 'M') {
  await loadQRCodeLib();
  const holder = document.createElement('div');
  new window.QRCode(holder, {
    text,
    width: size,
    height: size,
    colorDark: '#FFFFFF',
    colorLight: '#000000',
    correctLevel: window.QRCode.CorrectLevel[level] ?? window.QRCode.CorrectLevel.M
  });
  const c = holder.querySelector('canvas');
  if (!c) throw new Error('QR library did not produce a canvas');
  return addQuietZone(c);
}

/* ===========================
   Sample bright pixels → targets
=========================== */
function sampleQrTargets(canvas, {
  worldSize = 16,
  step = 3,
  threshold = 180,
  jitter = 0.15
} = {}) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const img = ctx.getImageData(0, 0, W, H).data;

  const aspect = W / H;
  const worldW = worldSize;
  const worldH = worldSize / aspect;

  const pts = [];
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const idx = (y * W + x) * 4;
      const r = img[idx + 0], g = img[idx + 1], b = img[idx + 2];
      const bright = (r + g + b) / 3;
      if (bright >= threshold) {
        const u = (x / (W - 1)) * 2 - 1;
        const v = (y / (H - 1)) * 2 - 1;
        const px = (u * worldW / 2) + (Math.random() - 0.5) * jitter;
        const py = (-v * worldH / 2) + (Math.random() - 0.5) * jitter;
        const pz = 0;
        pts.push(px, py, pz);
      }
    }
  }
  return new Float32Array(pts);
}

/* ===========================
   Tiny PRNG + noise-ish wander
=========================== */
function randUniform(min, max) { return min + Math.random() * (max - min); }

function hash3(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  const y = Math.sin((i + 1.234) * 78.233) * 12345.678;
  const z = Math.sin((i + 4.567) * 0.12345) * 98765.4321;
  return new THREE.Vector3(x - Math.floor(x), y - Math.floor(y), z - Math.floor(z));
}

/* ===========================
   Main setup
=========================== */
export function setupSignature(opts = {}) {
  const {
    link = 'https://www.instagram.com/illb3bach/', // URL to encode in the QR code

    worldSize = 16, // Width/height of the QR code in 3D space (scene units)

    // ==== particle look ====
    particleSize = 0.09,        // Size of each particle in the QR code
    backgroundColor = 0x000000, // Scene background color

    // ==== QR sampling & density ====
    sampleStep = 3,   // How many pixels we skip when sampling QR image — lower = more particles
    threshold = 180,  // Brightness cutoff to decide if a QR pixel becomes a particle
    jitter = 0.12,    // Random positional offset to break up perfect grid (in scene units)

    // ==== motion dynamics ====
    spring = 9.0,         // Attraction strength towards target position during assemble
    damping = 0.85,       // How much velocity is reduced each frame (lower = more bouncy)
    wanderStrength = 1.5, // Magnitude of random movement when in "wander" mode
    zRange = 3.0,         // Max Z-axis travel range before pushback (keeps points in a slab)

    // ==== timing between state changes ====
    wanderRange = [10, 12],  // Random seconds to spend wandering before assembling
    assembleRange = [4, 8],  // Random seconds to spend moving into QR code form
    holdSeconds = 10,        // Seconds to keep QR code assembled before blasting
    disperseRange = [4, 8],  // Random seconds to spend dispersing before wandering again

    // ==== blast tuning (for 'disperse') ====
    blastSpeedMin = 10.0,    // lower bound of initial speed
    blastSpeedMax = 22.0,    // upper bound of initial speed
    blastDrag = 0.995,        // per-frame drag while blasting (closer to 1 = less drag)

    spawnSpreadXY = 2.2,   // multiplies worldSize for initial XY placement (was ~1.2)
    spawnSpreadZ  = 3.0,  
  } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(backgroundColor);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 0, 18);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  // State
  let disposed = false;
  let targets = new Float32Array(0);
  let state = 'wander'; // 'wander' | 'assemble' | 'hold' | 'disperse'
  let stateTime = 0;
  let stateDuration = randUniform(...wanderRange);
  let geometry, points, positions, velocities, targetIndexMap;

    function createParticles() {
    const N = targets.length / 3;
    positions = new Float32Array(N * 3);
    velocities = new Float32Array(N * 3);
    targetIndexMap = new Uint32Array(N);

    // bigger initial volume
    const spawnHalfW = (worldSize * spawnSpreadXY) * 0.5; // XY half-extent
    const spawnHalfH = (worldSize * spawnSpreadXY) * 0.5;
    const spawnHalfZ = (zRange   * spawnSpreadZ);         // Z half-extent (a bit deeper)

    for (let i = 0; i < N; i++) {
        const j = i * 3;

        // distribute deterministically but wide
        const r = hash3(i);
        positions[j + 0] = (r.x - 0.5) * 2 * spawnHalfW;
        positions[j + 1] = (r.y - 0.5) * 2 * spawnHalfH;
        positions[j + 2] = (r.z - 0.5) * 2 * spawnHalfZ;

        // light initial motion so it feels alive
        velocities[j + 0] = (Math.random() - 0.5) * 0.15;
        velocities[j + 1] = (Math.random() - 0.5) * 0.15;
        velocities[j + 2] = (Math.random() - 0.5) * 0.15;

        targetIndexMap[i] = i;
    }

    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        size: particleSize,
        color: 0xffffff,
        sizeAttenuation: true,
        transparent: true,
        opacity: 1.0
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);
    }


  async function rebuildTargetsFor(linkText) {
    const qrCanvas = await makeQrCanvas(linkText, 512, 'M');
    if (disposed) return;
    targets = sampleQrTargets(qrCanvas, {
      worldSize,
      step: sampleStep,
      threshold,
      jitter
    });
    if (points) {
      scene.remove(points);
      geometry.dispose();
      points.material.dispose();
    }
    createParticles();
    jumpToState('wander');
  }

  function jumpToState(next) {
    state = next;
    stateTime = 0;

    if (state === 'wander') {
      stateDuration = randUniform(...wanderRange);

    } else if (state === 'assemble') {
      stateDuration = randUniform(...assembleRange);

    } else if (state === 'hold') {
      stateDuration = holdSeconds;

    } else if (state === 'disperse') {
      stateDuration = randUniform(...disperseRange);

      // give every particle a fresh random velocity (uniform over sphere)
      const N = targets.length / 3;
      for (let i = 0; i < N; i++) {
        const j = i * 3;

        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const z = 2 * v - 1;              // cos(phi) in [-1,1]
        const r = Math.sqrt(1 - z * z);   // sin(phi)
        const dirx = r * Math.cos(theta);
        const diry = r * Math.sin(theta);
        const dirz = z;

        const speed = randUniform(blastSpeedMin, blastSpeedMax);
        velocities[j + 0] = dirx * speed;
        velocities[j + 1] = diry * speed;
        velocities[j + 2] = dirz * speed;
      }
    }
  }

  function advanceState(dt) {
    stateTime += dt;
    if (stateTime < stateDuration) return;

    if (state === 'wander') jumpToState('assemble');
    else if (state === 'assemble') jumpToState('hold');     // settle
    else if (state === 'hold') jumpToState('disperse');     // blast out
    else if (state === 'disperse') jumpToState('wander');
  }

  function stepParticles(dt) {
    if (!points) return;
    const N = targets.length / 3;

    for (let i = 0; i < N; i++) {
      const j = i * 3;

      let px = positions[j + 0];
      let py = positions[j + 1];
      let pz = positions[j + 2];
      let vx = velocities[j + 0];
      let vy = velocities[j + 1];
      let vz = velocities[j + 2];

      if (state === 'assemble' || state === 'hold') {
        // spring to target
        const tj = targetIndexMap[i] * 3;
        const tx = targets[tj + 0], ty = targets[tj + 1], tz = targets[tj + 2];
        const ax = (tx - px) * spring;
        const ay = (ty - py) * spring;
        const az = (tz - pz) * spring;

        vx = vx * damping + ax * dt;
        vy = vy * damping + ay * dt;
        vz = vz * damping + az * dt;

      } else if (state === 'disperse') {
        // pure ballistic flight with gentle drag; no wander noise, no z-slab pushback
        const dragPow = Math.pow(blastDrag, Math.max(1, dt * 60)); // frame-rate friendly
        vx *= dragPow;
        vy *= dragPow;
        vz *= dragPow;

      } else { // 'wander'
        const r = hash3(i * 17 + Math.floor((performance.now() * 0.001 + i) % 1000));
        vx = vx * 0.98 + (r.x - 0.5) * wanderStrength * dt;
        vy = vy * 0.98 + (r.y - 0.5) * wanderStrength * dt;
        vz = vz * 0.98 + (r.z - 0.5) * (wanderStrength * 0.6) * dt;

        // keep wander in a slab
        if (pz > zRange) vz -= (pz - zRange) * 0.5 * dt;
        if (pz < -zRange) vz += (-zRange - pz) * 0.5 * dt;
      }

      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;

      positions[j + 0] = px;
      positions[j + 1] = py;
      positions[j + 2] = pz;
      velocities[j + 0] = vx;
      velocities[j + 1] = vy;
      velocities[j + 2] = vz;
    }

    geometry.attributes.position.needsUpdate = true;
  }

  let lastT = performance.now() * 0.001;
  function animate() {
    const t = performance.now() * 0.001;
    const dt = Math.min(0.05, Math.max(0.0005, t - lastT));
    lastT = t;

    advanceState(dt);
    stepParticles(dt);
  }

  function dispose() {
    disposed = true;
    if (points) {
      scene.remove(points);
      geometry.dispose();
      points.material.dispose();
    }
  }

  function onResize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  rebuildTargetsFor(link);

  return {
    scene,
    camera,
    animate,
    dispose,
    onResize,
    setLink: (newLink) => rebuildTargetsFor(newLink),
    jumpToState
  };
}
