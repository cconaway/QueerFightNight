import * as THREE from 'three';

export function setupCorridor() {
  // --- Scene & fog ---
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x06080e, 8, 140);

  // --- Camera (low + forward) ---
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(0, 1.2, 6);

  // --- Headlamp (cool, not neon) ---
  const headlamp = new THREE.PointLight(0x66ffe0, 1.6, 22, 2);
  headlamp.position.set(0, 0.6, 0.5);
  camera.add(headlamp);
  scene.add(camera);

  // === Trench params ===
    // === Trench params ===
    const SEG_LEN = 6;
    const NUM_SEGS = 90;
    const TR_HALF = 2.0;
    const WALL_THICK = 2;
    const WALL_HEIGHT = 10;
    const FLOOR_THICK = 0.6;     // <— new: chunky slab so you can't see behind it
    const SPEED = 18;
    const LIGHTS_PER_EDGE = 5;


  // Smooth lateral path for the trench (sum of sines = “organic” banking)
  const offsetAt = (z) =>
      Math.sin(z * 0.08) * 1.6 +
      Math.sin(z * 0.023 + 1.7) * 0.9 +
      Math.sin(z * 0.011 - 0.4) * 0.5;

  const dOffset = (z) => (offsetAt(z + 0.5) - offsetAt(z - 0.5)); // derivative for roll

  // === Materials ===
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x248842,        // deep slate blue
    emissive: 0x0a1020,
    emissiveIntensity: 0.9,
    metalness: 0.2,
    roughness: 0.9
  });

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x050508,
    emissive: 0x531a6b,     // muted magenta for trench glow
    emissiveIntensity: 0.7,
    metalness: 0.3,
    roughness: 0.35
  });

  const edgeLightMat = new THREE.MeshStandardMaterial({
    color: 0x92fff0,
    emissive: 0x00ffd0,
    emissiveIntensity: 2.8,
    metalness: 0.1,
    roughness: 0.4
  });

  // === Geometries (reused) ===
  const wallGeo = new THREE.BoxGeometry(WALL_THICK, WALL_HEIGHT, SEG_LEN);
  const floorGeo = new THREE.BoxGeometry(TR_HALF * 2 + WALL_THICK * 2, FLOOR_THICK, SEG_LEN + 0.08);
  const lightGeo = new THREE.BoxGeometry(0.05, 0.04, 0.4);

    // === Segment factory ===
    function makeSegment(atZ, index) {
    const g = new THREE.Group();

    // floor: box slab, top surface sits at y = 0 (so walls sit flush on top)
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, -FLOOR_THICK / 2, 0);   // lower so the top face is at y=0
    g.add(floor);

    // left/right walls (unchanged)
    const leftWall = new THREE.Mesh(wallGeo, wallMat);
    leftWall.position.set(-TR_HALF - WALL_THICK / 2, WALL_HEIGHT / 2, 0);
    g.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeo, wallMat);
    rightWall.position.set(TR_HALF + WALL_THICK / 2, WALL_HEIGHT / 2, 0);
    g.add(rightWall);

    // edge lights sit just above the top surface (y ≈ 0)
    for (let i = 0; i < LIGHTS_PER_EDGE; i++) {
        const zLocal = -SEG_LEN / 2 + ((i + 0.5) * SEG_LEN) / LIGHTS_PER_EDGE;

        const l = new THREE.Mesh(lightGeo, edgeLightMat);
        l.position.set(-TR_HALF + 0.15, 0.06, zLocal);
        g.add(l);

        const r = l.clone();
        r.position.x = TR_HALF - 0.15;
        g.add(r);
    }

    g.position.z = atZ;
    trench.add(g);
    segments.push(g);
    }


  // === Infinite trench via recycling ===
  const trench = new THREE.Group();
  scene.add(trench);

  const segments = [];

  for (let i = 0; i < NUM_SEGS; i++) {
    makeSegment(-i * SEG_LEN, i);
  }

  // === Lighting: faint global fill so walls read without neon ===
  scene.add(new THREE.AmbientLight(0x334455, 0.25));
  const hemi = new THREE.HemisphereLight(0x4c6a8a, 0x0a0c10, 0.35);
  scene.add(hemi);

  // === Animation state ===
  let camZ = camera.position.z;
  let wobble = 0;

  // helper: recycle segments to front when far behind camera
  function recycleSegments() {
    const frontMostZ = Math.min(...segments.map(s => s.position.z));
    const backMostZ  = Math.max(...segments.map(s => s.position.z));
    for (const s of segments) {
      // if segment is far behind camera, push it to the frontmost position
      if (s.position.z > camZ + 10) {
        s.position.z = frontMostZ - SEG_LEN;
      }
    }
  }

  // helper: update segment lateral offsets + gentle banking so the whole trench “curves”
// helper: update segment lateral offsets + gentle banking so the whole trench “curves”
    function layoutSegments() {
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const zWorld = s.position.z;
        const xOff = offsetAt(-zWorld);
        s.position.x = xOff;

        // tilt with curve (roll)
        const bank = -dOffset(-zWorld) * 0.5;
        s.rotation.z = bank;

        // gentle X-axis wobble
        const wobbleSpeed = 0.3;      // how fast the wobble cycles
        const wobbleAmp   = 0.05;    // how much to tilt in radians
        s.rotation.x = Math.sin(elapsed * wobbleSpeed + i * 0.7) * wobbleAmp;
    }
    }

  // subtle camera shake
  function cameraShake(t, speed) {
    const jx = Math.sin(t * 7.3) * 0.03 + Math.sin(t * 13.7) * 0.015;
    const jy = Math.sin(t * 5.7) * 0.015 + Math.sin(t * 11.1) * 0.01;
    return { jx, jy };
  }

  // === Main animate ===
  let elapsed = 0;
  function animate(delta) {
    elapsed += delta;

    // forward motion
    camZ -= SPEED * delta;

    // follow the trench centerline with a tiny manual “pilot wobble”
    wobble += delta;
    const pathX = offsetAt(-camZ - 3);          // look slightly ahead
    const pathX2 = offsetAt(-camZ - 10);
    const bank = -dOffset(-camZ - 6) * 0.06;

    const wobX = Math.sin(wobble * 0.9) * 0.08;
    const wobY = Math.sin(wobble * 0.65 + 1.1) * 0.18;  // ↑ amplitude from 0.04 → 0.18, slower phase

    const shake = cameraShake(elapsed, SPEED);
    camera.position.set(pathX + wobX + shake.jx, 1.2 + wobY + shake.jy, camZ);
    camera.rotation.z = bank; // roll with curve
    camera.lookAt(pathX2, 1.1, camZ - 12);

    // trench modules
    recycleSegments();
    layoutSegments();

    // gentle pulse on edge lights to sell speed & depth
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 6.0);
    edgeLightMat.emissiveIntensity = 2.2 + pulse * 0.8;
  }

  return { scene, camera, animate };
}
