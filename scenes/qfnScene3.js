// qfnScene3.js
import * as THREE from 'three';

class InfinitePlane {
  constructor(size = 100, divisions = 10) {
    const planeHeight = -1.5;

    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        color: 0x3c1a4f,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide
      })
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = planeHeight;

    this.grid = new THREE.GridHelper(size, divisions, 0xbb99ff, 0xbb99ff);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.7;
    this.grid.material.depthWrite = false;
    this.grid.renderOrder = 1;
    this.grid.position.y = planeHeight;
  }

  getObjects() {
    return [this.plane, this.grid];
  }
}

// Tunables
const CITY_INNER_RADIUS = 0.1;            // 0 = allow center
const CITY_OUTER_RADIUS = 0.48;         // fraction of planeSize (0.48 ≈ stay inside grid)

// --- helpers for cell snapping (unchanged) ---
function cellCenterFromIndex(i, j, planeSize, divisions) {
  const cellSize = planeSize / divisions;
  const min = -planeSize / 2;
  const cx = min + (i + 0.5) * cellSize;
  const cz = min + (j + 0.5) * cellSize;
  return { x: cx, z: cz, cellSize };
}

// Sample a free cell roughly along `angle`, with radius in [innerR, outerR]
function pickFreeCellNearAngle(angle, innerR, outerR, planeSize, divisions, occupied) {
  const min = -planeSize / 2;
  const cellSize = planeSize / divisions;

  // area-uniform radius sampling across the whole band
  const Rmin = innerR;
  const Rmax = outerR;

  // try a few different target radii
  const tries = 8;
  for (let t = 0; t < tries; t++) {
    const u = Math.random();
    const r = Math.sqrt(u) * (Rmax - Rmin) + Rmin;  // area-uniform
    const rx = Math.cos(angle) * r;
    const rz = Math.sin(angle) * r;

    // march a few cell steps around that radius to find a free neighbor
    const radialJitter = 2;     // how many cells to look forward/back
    const angularJitter = 2;    // how many cells sideways to try
    const stepR = cellSize;     // 1 cell at a time
    const stepTheta = (cellSize / Math.max(1, r + 1e-3)); // ~1 cell lateral

    for (let dr = -radialJitter; dr <= radialJitter; dr++) {
      for (let dθ = -angularJitter; dθ <= angularJitter; dθ++) {
        const rr = Math.max(0, r + dr * stepR);
        const θ = angle + dθ * stepTheta;

        const x = Math.cos(θ) * rr;
        const z = Math.sin(θ) * rr;

        // snap to cell
        const i = Math.max(0, Math.min(divisions - 1, Math.floor((x - min) / cellSize)));
        const j = Math.max(0, Math.min(divisions - 1, Math.floor((z - min) / cellSize)));
        const key = `${i},${j}`;

        if (!occupied.has(key)) {
          return { i, j, key };
        }
      }
    }
  }

  // Fallback: random free cell within outer radius band
  const maxTries = 300;
  for (let t = 0; t < maxTries; t++) {
    const i = Math.floor(Math.random() * divisions);
    const j = Math.floor(Math.random() * divisions);
    const key = `${i},${j}`;
    if (occupied.has(key)) continue;
    const { x, z } = cellCenterFromIndex(i, j, planeSize, divisions);
    const d = Math.hypot(x, z);
    if (d >= Rmin && d <= Rmax) return { i, j, key };
  }

  return null;
}

function getBuildingHeight(x, z, planeSize) {
  // Normalize position to [-1, 1]
  const nx = x / (planeSize / 2);
  const nz = z / (planeSize / 2);

  // Taller near center
  const dist = Math.sqrt(nx * nx + nz * nz);
  const centerBias = Math.max(0, 1 - dist);

  // Simple repeating variation pattern
  const pattern = (Math.sin(nx * 5) + Math.cos(nz * 5)) * 0.5 + 0.5; // 0..1

  // Blend bias and pattern
  const mix = 0.7 * centerBias + 0.3 * pattern;

  const minHeight = 6;
  const maxHeight = 60;
  return minHeight + (maxHeight - minHeight) * mix;
}

function createMountainRing({
  innerRadius,
  outerRadius,
  segments = 256,
  planeY = -1.5,
  amp = 60,            // vertical amplitude
  base = 2,           // base lift off plane
  freq = 2.5,         // wave frequency around circle
  detail = 0.5,       // extra higher-frequency detail amount
  phase = 0,          // phase offset
  color = 0x1a0f24,
  opacity = 1.0
}) {
  // Build a triangle strip ring with sloped sides:
  // inner vertices = ridge height (vary by angle)
  // outer vertices = near plane height (close to horizon)
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices = new Uint32Array(segments * 6);

  let p = 0;
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const theta = t * Math.PI * 2;

    // layered wave — big gentle + small detail
    const w1 = Math.sin(theta * freq + phase);
    const w2 = Math.sin(theta * (freq * 2.13) + phase * 1.7);
    const height = planeY + base + amp * (0.7 * w1 + detail * 0.3 * w2);

    const ci = Math.cos(theta);
    const si = Math.sin(theta);

    // inner (high) ridge
    const ix = ci * innerRadius;
    const iz = si * innerRadius;
    positions[p++] = ix;
    positions[p++] = height;
    positions[p++] = iz;

    // outer (low) skirt near the “horizon”
    const ox = ci * outerRadius;
    const oz = si * outerRadius;
    positions[p++] = ox;
    positions[p++] = planeY + 0.2; // slightly lifted to avoid z-fighting
    positions[p++] = oz;
  }

  // indices
  let k = 0;
  for (let s = 0; s < segments; s++) {
    const a = s * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices[k++] = a;
    indices[k++] = c;
    indices[k++] = b;
    indices[k++] = c;
    indices[k++] = d;
    indices[k++] = b;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.0,
    roughness: 1.0,
    emissive: new THREE.Color(color).multiplyScalar(0.05),
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false // helps with layered translucency
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = false;
  mesh.castShadow = false;

  // optional outline to accent the silhouette
  const lineGeom = new THREE.BufferGeometry();
  const linePositions = new Float32Array((segments + 1) * 3);
  let lp = 0;
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const theta = t * Math.PI * 2;
    const w1 = Math.sin(theta * freq + phase);
    const w2 = Math.sin(theta * (freq * 2.13) + phase * 1.7);
    const height = planeY + base + amp * (0.7 * w1 + detail * 0.3 * w2);
    const ci = Math.cos(theta);
    const si = Math.sin(theta);
    linePositions[lp++] = ci * innerRadius;
    linePositions[lp++] = height + 0.05;
    linePositions[lp++] = si * innerRadius;
  }
  lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const line = new THREE.LineLoop(
    lineGeom,
    new THREE.LineBasicMaterial({ color: 0x553377, transparent: true, opacity: 0.5 })
  );

  const group = new THREE.Group();
  group.add(mesh);
  group.add(line);
  return group;
}

function addMountainRanges(group, planeSize, planeY) {
  const half = planeSize * 0.5; // grid edge ≈ horizon

  const rings = [
    // FAR ridge: tallest, softest frequency, most translucent
    {
      innerRadius: half - 1.4,
      outerRadius: half + 0.6,
      amp: 40.5,           // <- your max amplitude
      base: -10,           // sinks feet below plane for big silhouettes
      freq: 3.8,           // broad undulations
      detail: 0.5,
      phase: Math.random() * Math.PI * 2,
      color: 0x9f86ff,     // light lavender-purple
      opacity: 0.38
    },
    // MID ridge: medium amplitude, a bit more frequency/contrast
    {
      innerRadius: half - 3.2,
      outerRadius: half - 1.2,
      amp: 26.0,
      base: -6,
      freq: 4.8,
      detail: 0.65,
      phase: Math.random() * Math.PI * 2 + 0.9,
      color: 0x8a66ff,     // mid purple
      opacity: 0.46
    },
    // NEAR ridge: lowest amplitude but most opaque to pop in front
    {
      innerRadius: half - 5.6,
      outerRadius: half - 3.4,
      amp: 14.0,
      base: -3.5,
      freq: 6.0,
      detail: 0.75,
      phase: Math.random() * Math.PI * 2 + 1.8,
      color: 0x6f4cff,     // deeper purple
      opacity: 0.58
    }
  ];

  rings.forEach(cfg => {
    const ring = createMountainRing({
      ...cfg,
      planeY,
      segments: 256
    });
    group.add(ring);
  });
}

function createGlowSprite(color, size = 10, opacity = 0.35) {
  // build a radial gradient texture once
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  const c = new THREE.Color(color);
  const rgb = `rgb(${Math.floor(c.r*255)},${Math.floor(c.g*255)},${Math.floor(c.b*255)})`;
  g.addColorStop(0.0, rgb);
  g.addColorStop(0.4, `rgba(255,255,255,0.4)`);
  g.addColorStop(1.0, `rgba(255,255,255,0.0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0,0,256,256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    opacity,
    blending: THREE.AdditiveBlending
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

// --- PLANET FACTORY ---
function createPlanet({ color=0xffee88, radius=1.6, glowSize=12 }) {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.5),
    roughness: 0.6,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0
  });
  const sphere = new THREE.Mesh(geo, mat);
  sphere.castShadow = false;
  sphere.receiveShadow = false;

  const glow = createGlowSprite(color, glowSize, 0.4);

  const g = new THREE.Group();
  g.add(glow);
  g.add(sphere);
  glow.position.set(0,0,0.01); // tiny offset to avoid z-fighting with sphere

  g.userData = { sphere, glow, baseOpacity: { sphere: 1.0, glow: 0.4 } };
  return g;
}

function addPlanets(parentGroup, { planeY = -1.5, horizonFade = 3.0, halfSizeForHorizon = 2.0 } = {}) {
  const skyGroup = new THREE.Group();
  parentGroup.add(skyGroup);

  const planets = [];

  function addOne({
    orbitRadius = 45,
    azimuthSpeed = 0.08,   // radians/sec around Y
    verticalAmp = 8.0,     // rise/fall amplitude
    verticalSpeed = 0.5,   // radians/sec for bobbing
    phase = 0.0,
    color = 0xffcf73,
    radius = 4.0,
    glowSize = 14,
    tilt = 0.0
  }) {
    const p = createPlanet({ color, radius, glowSize });
    p.userData.motion = { orbitRadius, azimuthSpeed, verticalAmp, verticalSpeed, phase, tilt };
    skyGroup.add(p);
    planets.push(p);
  }

    // warm planet — long, lazy arc; crests at ~40
    addOne({
    orbitRadius: 90,
    azimuthSpeed: 0.06,
    verticalAmp: 41.22,     // 40 - (planeY + 0.2) - sin(0.08)
    verticalSpeed: 0.18,    // slower vertical => longer horizontal run
    phase: Math.random() * Math.PI * 2,
    color: 0xffb36a,
    radius: 6.4,
    glowSize: 20,
    tilt: 0.08
    });

    // cool planet — farther orbit, even slower vertical
    addOne({
    orbitRadius: 140,
    azimuthSpeed: -0.045,
    verticalAmp: 41.35,     // 40 - (planeY + 0.2) - sin(-0.05)
    verticalSpeed: 0.16,
    phase: Math.random() * Math.PI * 2 + 1.2,
    color: 0x9fd0ff,
    radius: 3.0,
    glowSize: 16,
    tilt: -0.05
    });

    // distant purple — smaller, slowest vertical
    addOne({
    orbitRadius: 80,
    azimuthSpeed: 0.1,
    verticalAmp: 41.27,     // 40 - (planeY + 0.2) - sin(0.03)
    verticalSpeed: 0.14,
    phase: Math.random() * Math.PI * 2 + 2.1,
    color: 0xc9a0ff,
    radius: 10.6,
    glowSize: 30,
    tilt: 0.03
    });


  function updatePlanets(t) {
    for (let idx = 0; idx < planets.length; idx++) {
      const g = planets[idx];
      const { orbitRadius, azimuthSpeed, verticalAmp, verticalSpeed, phase, tilt } = g.userData.motion;

      const az = t * azimuthSpeed + phase;
      const yBob = Math.sin(t * verticalSpeed + phase) * verticalAmp;

      const x = Math.cos(az) * orbitRadius;
      const z = Math.sin(az) * orbitRadius;
      const y = (planeY + 0.2) + yBob + Math.sin(tilt) * 1.0;

      g.position.set(x, y, z);

      // fade when near/below horizon
      const over = (y - planeY);
      const vis = THREE.MathUtils.clamp((over + halfSizeForHorizon) / (horizonFade + halfSizeForHorizon), 0, 1);

      const { sphere, glow, baseOpacity } = g.userData;
      sphere.material.opacity = baseOpacity.sphere * vis;
      glow.material.opacity   = baseOpacity.glow   * vis;
    }
  }

  return { updatePlanets };
}

function addSkyscraper(sceneGroup, planeSize, divisions, planeY, occupied, angleOffset = 0) {
  const angle = angleOffset + Math.random() * Math.PI * 2;

  // Band across the grid
  const inner = CITY_INNER_RADIUS * planeSize;
  const outer = CITY_OUTER_RADIUS * planeSize;

  const choice = pickFreeCellNearAngle(angle, inner, outer, planeSize, divisions, occupied);
  if (!choice) return null;

  const { i, j } = choice; // don't add to occupied yet — we might place a multi-cell footprint
  const { cellSize } = cellCenterFromIndex(0, 0, planeSize, divisions);

  // --- Random building footprint in cells (1..4) ---
  const maxCells = 4;
  const wCells = 1 + Math.floor(Math.random() * maxCells);
  const dCells = 1 + Math.floor(Math.random() * maxCells);

  // Try to center the rectangle on the chosen cell and find a nearby valid anchor
  function tryAnchor(ai, aj) {
    // center-aligned anchor
    const i0 = Math.max(0, Math.min(divisions - wCells, ai - Math.floor(wCells / 2)));
    const j0 = Math.max(0, Math.min(divisions - dCells, aj - Math.floor(dCells / 2)));

    // Check occupancy for the rectangle
    const keys = [];
    for (let di = 0; di < wCells; di++) {
      for (let dj = 0; dj < dCells; dj++) {
        const ii = i0 + di;
        const jj = j0 + dj;
        const key = `${ii},${jj}`;
        if (occupied.has(key)) return null;
        keys.push(key);
      }
    }
    return { i0, j0, keys };
  }

  // probe a small neighborhood around (i, j) for a spot
  const offsets = [
    [0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],
    [2,0],[-2,0],[0,2],[0,-2]
  ];
  let placed = null;
  for (const [di, dj] of offsets) {
    placed = tryAnchor(i + di, j + dj);
    if (placed) break;
  }
  if (!placed) return null;

  const { i0, j0, keys } = placed;

  // World-space center for the rectangle
  const min = -planeSize / 2;
  const centerX = min + (i0 + wCells * 0.5) * cellSize;
  const centerZ = min + (j0 + dCells * 0.5) * cellSize;

  // Height based on center; you could also average corners if you want
  const height = getBuildingHeight(centerX, centerZ, planeSize);

  // World footprint sizes
  const footprintX = cellSize * wCells * 0.9;
  const footprintZ = cellSize * dCells * 0.9;

  const geometry = new THREE.BoxGeometry(footprintX, height, footprintZ);

  const neonMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    metalness: 0.3,
    roughness: 0.6,
    transparent: true,
    opacity: 1
  });
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    wireframe: true,
    transparent: true,
    opacity: 0.9
  });

  const baseMesh = new THREE.Mesh(geometry, neonMaterial);
  const wireMesh = new THREE.Mesh(geometry, wireframeMaterial);

  const skyscraper = new THREE.Group();
  skyscraper.add(baseMesh);
  skyscraper.add(wireMesh);

  skyscraper.position.set(centerX, planeY + height / 2, centerZ);
  skyscraper.userData = {
    angle: Math.atan2(centerZ, centerX),
    keys // store ALL occupied cells
  };

  // mark cells as occupied
  for (const k of keys) occupied.add(k);

  sceneGroup.add(skyscraper);
  return skyscraper;
}
export function setupSkyscraper() {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 5;

  // Sun-free lighting: gentle ambient + sky/ground tint
  scene.add(new THREE.AmbientLight(0x404040, 0.6));
  scene.add(new THREE.HemisphereLight(0x6677ff, 0x332244, 0.6));

  const rotatingGroup = new THREE.Group();
  scene.add(rotatingGroup);

  const planeSize = 100;
  const divisions = 50;
  const planeY = -1.5;

  // Ground + grid
  const plane = new InfinitePlane(planeSize, divisions);
  plane.getObjects().forEach(obj => rotatingGroup.add(obj));

  // Mountains
  addMountainRanges(rotatingGroup, planeSize, planeY);

  // Planets (no sun/light tracking inside)
  const { updatePlanets } = addPlanets(rotatingGroup, { planeY });

  // Skyscrapers
  const occupied = new Set();
  const skyscrapers = [];
  const total = 10;
  for (let i = 0; i < total; i++) {
    const sk = addSkyscraper(rotatingGroup, planeSize, divisions, planeY, occupied);
    if (sk) skyscrapers.push(sk);
  }

  // Single animate loop
  let elapsed = 0;
  function animate(delta) {
    elapsed += delta;

    // slow scene spin
    rotatingGroup.rotation.y += delta * 0.2;

    // planets rise/fall + fade at horizon
    updatePlanets(elapsed);

    // despawn/respawn buildings behind the “camera” bearing
    const viewAngle = rotatingGroup.rotation.y;
    const threshold = Math.PI; // ~180°
    for (let i = 0; i < skyscrapers.length; i++) {
      const sk = skyscrapers[i];
      if (!sk) continue;

      const relative = sk.userData.angle - viewAngle;
      const angle = Math.atan2(Math.sin(relative), Math.cos(relative)); // [-π, π]

      if (angle < -threshold) {
        // free cells
        if (sk.userData?.keys) for (const k of sk.userData.keys) occupied.delete(k);
        rotatingGroup.remove(sk);

        // respawn ahead of camera
        const newSk = addSkyscraper(
          rotatingGroup,
          planeSize,
          divisions,
          planeY,
          occupied,
          viewAngle + Math.PI + Math.random() * 0.5
        );
        skyscrapers[i] = newSk;
      }
    }
  }

  return { scene, camera, animate };
}
