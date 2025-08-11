import * as THREE from 'three';

export function setupCube() {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 8;

  // === Platonic solid geometries (factories so we can respawn new ones) ===
  const geometryFactories = [
    () => new THREE.TetrahedronGeometry(2),
    () => new THREE.BoxGeometry(3, 3, 3),
    () => new THREE.OctahedronGeometry(2.4),
    () => new THREE.DodecahedronGeometry(2.1),
    () => new THREE.IcosahedronGeometry(2.2),
  ];

  // === Morse encoding ===
  const morseMap = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
    G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
    M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
    S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..", " ": " "
  };

  const message = "QUEER FIGHT NIGHT";
  let morseString = "";
  for (const char of message.toUpperCase()) {
    if (morseMap[char]) morseString += morseMap[char] + " ";
  }

  const sequence = [];
  for (const symbol of morseString) {
    if (symbol === ".") sequence.push(1);
    else if (symbol === "-") sequence.push(3);
    else if (symbol === " ") sequence.push(2);
    sequence.push(1); // inter-symbol pause
  }

  const unitTime = 1;
  const cycleDuration = sequence.reduce((acc, u) => acc + u * unitTime, 0);

  function getCurrentStepIndex(time) {
    let t = time % cycleDuration;
    for (let i = 0, acc = 0; i < sequence.length; i++) {
      acc += sequence[i] * unitTime;
      if (t < acc) return i;
    }
    return 0;
  }

  // === Infinite spiral params (toward -Z) ===
  const MAX_POOL = 200;        // hard cap
  const MIN_ACTIVE = 1;        // min visible
  const MAX_ACTIVE = 200;      // max visible
  const POPULATION_PERIOD = 60; // seconds for 5 -> 200 -> 5

  const SPAWN_Z = 0;         // in front of us (closer)
  const DESPAWN_Z = -100;    // far away -> recycle
  const RADIUS_MIN = 4;
  const RADIUS_MAX = 30;
  const ANG_SPEED_MIN = 0.3;
  const ANG_SPEED_MAX = 0.9;
  const DRIFT_MIN = -0.5;    // slow radius breathing
  const DRIFT_MAX = 0.5;
  const SPEED_MIN = 2;       // z-units per second
  const SPEED_MAX = 14;

  // Create & recycle helpers
  function makeMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      wireframe: true,
      emissive: new THREE.Color(0x00ff00),
      emissiveIntensity: 0.0,
      transparent: true,
      opacity: 1.0,
      depthWrite: false
    });
  }

  function randomBetween(a, b) {
    return a + Math.random() * (b - a);
  }

  function respawnIntoFront(slot, firstTime = false) {
    // choose a random polyhedron each time
    const newGeo = geometryFactories[Math.floor(Math.random() * geometryFactories.length)]();
    if (slot.mesh.geometry) slot.mesh.geometry.dispose();
    slot.mesh.geometry = newGeo;

    // reset spiral state "in front"
    slot.radius = randomBetween(RADIUS_MIN, RADIUS_MAX);
    slot.radiusDrift = randomBetween(DRIFT_MIN, DRIFT_MAX);
    slot.angle = Math.random() * Math.PI * 2;
    slot.angularSpeed = randomBetween(ANG_SPEED_MIN, ANG_SPEED_MAX);
    slot.z = firstTime ? randomBetween(DESPAWN_Z, SPAWN_Z) : SPAWN_Z; // spread initial depth
    slot.speed = randomBetween(SPEED_MIN, SPEED_MAX);

    // keep a pleasant rotation
    slot.rotationSpeed = {
      x: (Math.random() - 0.5) * 0.6,
      y: (Math.random() - 0.5) * 0.6,
      z: (Math.random() - 0.5) * 0.6
    };

    // small variance in flicker per piece
    slot.flickerStrength = 0.3 + Math.random() * 0.6;

    // place immediately
    slot.mesh.position.set(
      slot.radius * Math.cos(slot.angle),
      slot.radius * Math.sin(slot.angle),
      slot.z
    );
  }

  // === Pool + active set ===
  const pool = [];   // all slots (0..MAX_POOL-1)
  const active = []; // subset we currently animate

  for (let i = 0; i < MAX_POOL; i++) {
    const mat = makeMaterial();
    const mesh = new THREE.Mesh(geometryFactories[i % geometryFactories.length](), mat);
    const slot = {
      mesh,
      material: mat,
      phaseOffset: i * 0.3,
      // dynamic properties set by respawnIntoFront:
      radius: 0,
      radiusDrift: 0,
      angle: 0,
      angularSpeed: 0,
      rotationSpeed: { x: 0, y: 0, z: 0 },
      z: 0,
      speed: 0,
      flickerStrength: 0.5,
      isActive: false
    };
    scene.add(mesh);
    mesh.visible = false; // start hidden; we'll activate as needed
    pool.push(slot);
  }

  // Activate N slots from the pool
  function activateOne() {
    const slot = pool.find(s => !s.isActive);
    if (!slot) return;
    respawnIntoFront(slot, true);
    slot.isActive = true;
    slot.mesh.visible = true;
    active.push(slot);
  }

  // Deactivate one (LIFO for cache friendliness)
  function deactivateOne() {
    const slot = active.pop();
    if (!slot) return;
    slot.isActive = false;
    slot.mesh.visible = false;
  }

  function ensureActiveCount(target) {
    // Clamp to bounds
    target = Math.max(MIN_ACTIVE, Math.min(MAX_ACTIVE, target));
    while (active.length < target) activateOne();
    while (active.length > target) deactivateOne();
  }

  // Start with minimum visible
  ensureActiveCount(MIN_ACTIVE);

  // A pulsing point light synced to the main Morse beat
  const pointLight = new THREE.PointLight(0x00ff00, 1.0, 10);
  pointLight.position.set(2, 2, 2);
  scene.add(pointLight);

  let globalTime = 0;

  function animate(delta) {
    globalTime += delta;

    // master pulse
    const mainIndex = getCurrentStepIndex(globalTime);
    const isMainOn = mainIndex % 2 === 0;
    pointLight.intensity = isMainOn ? 2.0 : 0.25;

    // --- population triangle wave: 5 -> 200 -> 5 ---
    // normalized time in [0,1)
    const tNorm = (globalTime % POPULATION_PERIOD) / POPULATION_PERIOD;
    // triangle wave in [0,1] peaking at t=0.5
    const tri = 1 - Math.abs(2 * tNorm - 1);
    const desiredCount = Math.floor(
      MIN_ACTIVE + tri * (MAX_ACTIVE - MIN_ACTIVE)
    );
    ensureActiveCount(desiredCount);

    // update each ACTIVE object
    for (const obj of active) {
      // emissive flicker using per-object phase
      const localTime = globalTime - obj.phaseOffset;
      const idx = getCurrentStepIndex(localTime);
      const isOn = idx % 2 === 0;
      obj.material.emissiveIntensity = isOn ? obj.flickerStrength : 0.0;

      // whirl + march away
      obj.angle += obj.angularSpeed * delta;
      obj.radius += obj.radiusDrift * delta;                         // gentle breathing
      obj.radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, obj.radius));
      obj.z -= obj.speed * delta;                                    // move toward -Z (away)

      obj.mesh.position.set(
        obj.radius * Math.cos(obj.angle),
        obj.radius * Math.sin(obj.angle),
        obj.z
      );

      // spin the solids
      obj.mesh.rotation.x += delta * obj.rotationSpeed.x;
      obj.mesh.rotation.y += delta * obj.rotationSpeed.y;
      obj.mesh.rotation.z += delta * obj.rotationSpeed.z;

      // recycle when far enough
      if (obj.z < DESPAWN_Z) {
        respawnIntoFront(obj, false);
      }
    }
  }

  return { scene, camera, animate };
}
