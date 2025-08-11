import * as THREE from 'three';

const CHARACTERS = 'QUEER';

// --------------------
// Config knobs
// --------------------
const RAIN_COUNT = 200;
const FIELD = { x: 100, y: 100, z: 100 }; // spawn volume centered at (0,0,0)
const FALL_SPEED = { min: 0.5, max: 1.3 }; // global floor/ceiling
const TRAIL = { perLetter: 6, spawnEverySec: 0.05, fadePerSec: 1.5 };
const SPRITE_SCALE = 1.2;
const CAMERA_Z = 60;
const FOG = { near: 10, far: 100 };

// --- per-character speed personality ---
const CHAR_SPEED_FACTOR = { Q: 1.15, U: 0.9, E: 0.7, R: 1.0 };

// --------------------
// Texture cache (one canvas per letter)
// --------------------
function makeLetterTexture(letter, color = 'rgb(0,255,0)') {
  const size = 100;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.font = 'bold 72px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function buildTextureCache(chars) {
  const map = new Map();
  for (const ch of chars) map.set(ch, makeLetterTexture(ch));
  return map;
}

// --------------------
// Helpers
// --------------------
function randRange(a, b) { return a + Math.random() * (b - a); }
function randomChar() { return CHARACTERS[(Math.random() * CHARACTERS.length) | 0]; }

function charSpeedRange(ch) {
  const f = CHAR_SPEED_FACTOR[ch] ?? 1.0;
  const span = (FALL_SPEED.max - FALL_SPEED.min) * 0.7;
  const mid  = (FALL_SPEED.max + FALL_SPEED.min) * 0.5 * f;
  return { min: Math.max(0.05, mid - span * 0.5), max: mid + span * 0.5 };
}

function baseSpeedForChar(ch) {
  const r = charSpeedRange(ch);
  return randRange(r.min, r.max);
}

function recycleSprite(sprite) {
  sprite.position.set(
    (Math.random() - 0.5) * FIELD.x,
    FIELD.y * 0.5,
    (Math.random() - 0.5) * FIELD.z
  );
  const ch = randomChar();
  sprite.userData.char = ch;
  sprite.material.map = sprite.userData.cache.get(ch);
  sprite.material.needsUpdate = true;
  sprite.userData.speedBase = baseSpeedForChar(ch);
  sprite.userData.phase = Math.random() * Math.PI * 2;
  sprite.userData.trailTimer = 0;
}

// --------------------
// NEW: text mask canvas ("HACKER NIGHT")
// white letters on black → used as a mask in shader
// --------------------
function makeTextMaskTexture({
  text = 'HACKER NIGHT',
  width = 2048/2,
  height = 512/2,
  font = 'bold 280px "Arial Black", Impact, system-ui, sans-serif',
  margin = 0.08, // side margin as fraction of width
}) {
  const cvs = document.createElement('canvas');
  cvs.width = width; cvs.height = height;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font;

  // shrink-to-fit horizontally with margin
  let testSize = parseInt(font.match(/(\d+)px/)[1], 10);
  const maxWidth = width * (1 - margin * 2);
  while (ctx.measureText(text).width > maxWidth && testSize > 10) {
    testSize -= 4;
    ctx.font = font.replace(/\d+px/, `${testSize}px`);
  }

  ctx.fillText(text, width / 2, height / 2);

  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}

// --------------------
// Main
// --------------------
export function setupMatrixRain() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, FOG.near, FOG.far);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = CAMERA_Z;

  // ---------- NEW: lightning background plane with masked text ----------
  const textMask = makeTextMaskTexture({});
  const bgUniforms = {
    uFlash: { value: 0 },         // 0..1 intensity
    uMask:  { value: textMask },  // white = letters
  };

  const bgMat = new THREE.ShaderMaterial({
    uniforms: bgUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D uMask;
      uniform float uFlash;
      void main() {
        // sample mask: white where text is, black elsewhere
        float m = texture2D(uMask, vUv).r;
        // base scene is dark; flash adds neon green
        vec3 base = vec3(0.0);
        vec3 green = vec3(0.0, 1.0, 0.0);
        vec3 flashed = mix(base, green, clamp(uFlash, 0.0, 1.0));
        // "HACKER NIGHT" appears as black cutout during flash
        vec3 color = mix(flashed, vec3(0.0), m);
        gl_FragColor = vec4(color, 1.0);
      }`,
    depthWrite: false,
    depthTest: true,
    fog: false, // important: keep lightning vivid even with scene fog
  });

  // Make the plane large and behind everything
    const bgW = FIELD.x * 4;
    const bgH = FIELD.y * 4 * (window.innerHeight / window.innerWidth); // maintain coverage
    const bgGeo = new THREE.PlaneGeometry(bgW, bgH, 1, 1);


  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.position.set(0, 0, - (FIELD.z * 0.75)); // well behind rain
  bgMesh.renderOrder = -1000; // ensure it draws first
  scene.add(bgMesh);

  // ---------- letters + trails ----------
  const texCache = buildTextureCache(CHARACTERS);
  const letters = new Array(RAIN_COUNT);
  const ghosts = [];
  const allSprites = [];

  for (let i = 0; i < RAIN_COUNT; i++) {
    const ch = randomChar();
    const mat = new THREE.SpriteMaterial({ map: texCache.get(ch), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(SPRITE_SCALE, SPRITE_SCALE, 1);
    sprite.userData = {
      char: ch,
      cache: texCache,
      trail: new Array(TRAIL.perLetter),
      trailIndex: 0,
      trailTimer: 0,
      speedBase: baseSpeedForChar(ch),
      phase: Math.random() * Math.PI * 2
    };
    sprite.position.set(
      (Math.random() - 0.5) * FIELD.x,
      Math.random() * FIELD.y,
      (Math.random() - 0.5) * FIELD.z
    );
    letters[i] = sprite;
    allSprites.push(sprite);
  }

  for (let i = 0; i < RAIN_COUNT; i++) {
    const owner = letters[i];
    for (let g = 0; g < TRAIL.perLetter; g++) {
      const ghostMat = new THREE.SpriteMaterial({ map: owner.material.map, transparent: true, opacity: 0.0, depthWrite: false });
      const ghost = new THREE.Sprite(ghostMat);
      ghost.scale.set(SPRITE_SCALE, SPRITE_SCALE, 1);
      ghost.visible = false;
      ghost.userData = { owner, life: 0.0 };
      owner.userData.trail[g] = ghost;
      ghosts.push(ghost);
      allSprites.push(ghost);
    }
  }

  for (let i = 0; i < allSprites.length; i++) scene.add(allSprites[i]);

  function spawnGhost(owner) {
    const ud = owner.userData;
    const idx = ud.trailIndex;
    ud.trailIndex = (idx + 1) % ud.trail.length;
    const ghost = ud.trail[idx];

    if (ghost.material.map !== owner.material.map) {
      ghost.material.map = owner.material.map;
      ghost.material.needsUpdate = true;
    }

    ghost.position.copy(owner.position);
    ghost.material.opacity = 0.7;
    ghost.userData.life = 1.0;
    ghost.visible = true;
  }

  // ---------- NEW: thunder state machine ----------
  let t = 0;
  const thunder = {
    active: false,
    start: 0,
    nextDelay: randRange(15.0, 60.0),
    // a few quick peaks like real lightning
    pattern: [ { d: 0.09, a: 1.00 }, { d: 0.07, a: 0.55 }, { d: 0.16, a: 0.85 } ],
    sigma: 0.020 // width of each pulse (in seconds)
  };

  function updateThunder(dt) {
    // trigger?
    if (!thunder.active) {
      thunder.nextDelay -= dt;
      if (thunder.nextDelay <= 0) {
        thunder.active = true;
        thunder.start = t;
      }
    }

    let flash = 0.0;
    if (thunder.active) {
      const elapsed = t - thunder.start;
      // sum of Gaussian-ish pulses
      for (let i = 0; i < thunder.pattern.length; i++) {
        const p = thunder.pattern[i];
        const x = elapsed - p.d;
        const pulse = Math.exp(-(x * x) / (2.0 * thunder.sigma * thunder.sigma)) * p.a;
        if (pulse > flash) flash = pulse;
      }
      // end after ~0.6s
      if (elapsed > 0.6) {
        thunder.active = false;
        thunder.nextDelay = randRange(15.0, 60.0);
      }
    }
    bgUniforms.uFlash.value = flash;
  }

  function animate(delta) {
    if (delta > 0.1) delta = 0.1;
    t += delta;

    // rain
    for (let i = 0; i < letters.length; i++) {
      const s = letters[i];
      const wobble = 1 + 0.15 * Math.sin(t * 2.0 + s.userData.phase);
      const speed = s.userData.speedBase * wobble;
      s.position.y -= speed * delta * 30;
      s.userData.trailTimer += delta;
      if (s.userData.trailTimer >= TRAIL.spawnEverySec) {
        spawnGhost(s);
        s.userData.trailTimer = 0;
      }
      if (s.position.y < -FIELD.y * 0.5) recycleSprite(s);
    }

    // ghost fade
    const fade = TRAIL.fadePerSec * delta;
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      if (!g.visible) continue;
      g.userData.life -= fade;
      if (g.userData.life <= 0) {
        g.visible = false;
        g.material.opacity = 0.0;
      } else {
        g.material.opacity = g.userData.life;
      }
    }

    // lightning
    updateThunder(delta);
  }

  return { scene, camera, animate };
}
