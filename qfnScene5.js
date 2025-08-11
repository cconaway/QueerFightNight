import * as THREE from "three";

// ===============
// Public API
// ===============
export function setupPerlin() {
	const scene = new THREE.Scene();

	const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
	camera.position.set(0, 0.3, 3.5);
	camera.lookAt(0, 0.2, 0);

	// Scene fog
	scene.fog = new THREE.Fog(0x000000, 4, 60);

	// Plane (ocean-like) mesh with animated simplex in the vertex shader
	const PLANE_SIZE = 12;
	const plane = createOceanPlane(PLANE_SIZE);
	scene.add(plane);

	// Light
	const pointLight = new THREE.PointLight(0x00ffff, 1.5, 12);
	pointLight.position.set(2, 3, 2);
	scene.add(pointLight);

	// Stars spelling FIGHT
    const { points: fightPoints, update: updateFightStars } = createFightStars({
    canvasSize : { w: 1000, h: 300 },
    text: "FIGHT",
    worldWidth: 106,  // ≈ 106.3
    size: 0.3,              // ≈ 0.29
    alphaThreshold: 160,
    step: 4,
    jitterFactor: 5,
    keepFraction: 0.09,
    color: 0xffff66,
    position: new THREE.Vector3(0, 12.4, -50)
    });
    scene.add(fightPoints);

        // --- Background star field ---
    const { points: bgStars, update: updateBgStars } = createStarField({
        count: 2000,
        spread: 400,
        size: 0.6,
        color: 0xffff66
    });
    scene.add(bgStars);

	// Camera "float" helpers (CPU-evaluated height sampling)
	const heightSampler = createHeightSampler(plane.material, PLANE_SIZE);
	const camHover = 0.58;  // how high above the surface to sit
	const lookAhead = 10.0; // aim look target this far forward (-Z)
	const damp = 1.8;       // smoothing factor for less jitter
	let targetY = camera.position.y;

	function animate(delta) {
		// Advance shader time
		plane.material.uniforms.uTime.value += delta;
		const t = plane.material.uniforms.uTime.value;

		// Update star field
		updateFightStars(t);
        updateBgStars(t);


		// Current camera XZ
		const cx = camera.position.x;
		const cz = camera.position.z;

		// Sample surface height at camera and ahead for stable horizon
		const hHere = heightSampler.heightAtXZ(cx, cz, t);
		const hAhead = heightSampler.heightAtXZ(cx, cz - lookAhead, t);

		// Smooth vertical motion
		targetY = hHere + camHover;
		camera.position.y += (targetY - camera.position.y) * damp;

		// Keep looking slightly forward, hugging the surface shape
		camera.lookAt(cx, hAhead + camHover * 0.9, cz - lookAhead);
	}

	return { scene, camera, animate };
}

// ================================
// Ocean plane (shader + geometry)
// ================================
function createOceanPlane(size = 12) {
	const geometry = new THREE.PlaneGeometry(size, size, 128, 128);
	const material = createPerlinMaterial();

	const mesh = new THREE.Mesh(geometry, material);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = 0.0;
	return mesh;
}

function createPerlinMaterial() {
	return new THREE.ShaderMaterial({
		vertexShader: VERT_SRC,
		fragmentShader: FRAG_SRC,
		uniforms: {
			uTime:     { value: 0.0 },
			uCycleSec: { value: 120.0 }, // lengthen for longer gentle→big→gentle cycles
			uAmpMin:   { value: 0.3 },
			uAmpMax:   { value: 0.6 },
			uFreqMin:  { value: 2.0 },
			uFreqMax:  { value: 6.0 },
			uEaseK:    { value: 2.0 }   // 1–2 slows the middle a bit more
		},
		wireframe: true
	});
}

const VERT_SRC = `
	varying vec2 vUv;
	uniform float uTime;
	uniform float uCycleSec;
	uniform float uAmpMin;
	uniform float uAmpMax;
	uniform float uFreqMin;
	uniform float uFreqMax;
	uniform float uEaseK;

	vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
	vec2 mod289(vec2 x){return x - floor(x*(1.0/289.0))*289.0;}
	vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);} 

	float noise(vec2 v){
		const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
		vec2 i = floor(v + dot(v, C.yy));
		vec2 x0 = v - i + dot(i, C.xx);
		vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
		vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
		i = mod289(i);
		vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
		vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
		m = m*m; m = m*m;
		vec3 x = 2.0 * fract(p * C.www) - 1.0;
		vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox;
		m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
		vec3 g; g.x = a0.x*x0.x + h.x*x0.y; g.y = a0.y*x12.x + h.y*x12.y; g.z = a0.z*x12.z + h.z*x12.w;
		return 130.0 * dot(m, g);
	}

	float ease01(float x, float k) {
		x = clamp(x, 0.0, 1.0);
		float s = x*x*(3.0 - 2.0*x);
		return mix(x, s, clamp(k, 0.0, 4.0));
	}

	void main(){
		vUv = uv;
		vec3 pos = position;
		float w = 6.28318530718 / uCycleSec; // 2π / T
		float raw = 0.5 + 0.5 * sin(uTime * w);
		float phase = ease01(raw, uEaseK);
		float amp  = mix(uAmpMin,  uAmpMax,  phase);
		float freq = mix(uFreqMin, uFreqMax, phase);
		float n = noise(uv * freq + vec2(uTime * 0.12, uTime * 0.07));
		float swell = noise(uv * 1.2 + vec2(uTime * 0.05, -uTime * 0.03)) * 0.25;
		pos.z += (n + swell) * amp;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
	}
`;

const FRAG_SRC = `
	varying vec2 vUv;
	void main(){
		gl_FragColor = vec4(vec3(vUv.x, vUv.y, 1.0), 1.0);
	}
`;

// ==========================
// Text-to-stars ("FIGHT")
// ==========================
function createFightStars({
    text = "FIGHT",
    font = 'bold 220px "Arial Black", Impact, system-ui, sans-serif',
    canvasSize = { w: 1400, h: 300 },
    worldWidth = 50.5,
    alphaThreshold = 160,
    step = 4,
    jitterFactor = 0.6,
    keepFraction = 1.0,   // << new
    color = 0xffffff,
    size = 0.4,
    position = new THREE.Vector3(0, 0, 0)
} = {}) {
    const cvs = makeTextCanvas(text, font, canvasSize);
    const positions = sampleCanvasToPositions(cvs, {
        worldWidth,
        alphaThreshold,
        step,
        jitterFactor,
        keepFraction
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    mat.fog = false; // ignore scene fog

    const points = new THREE.Points(geo, mat);
    points.position.copy(position);

    const baseSize = mat.size;
    function update(t) {
        points.rotation.z = 0.03 * Math.sin(t * 0.22);
        points.position.x = position.x + 0.15 * Math.sin(t * 0.11);
        mat.size = baseSize * (0.9 + 0.2 * Math.sin(t * 1.6));
        mat.opacity = 0.78 + 0.22 * Math.sin(t * 0.7);
    }

    return { points, update };
}

function sampleCanvasToPositions(cvs, { worldWidth, alphaThreshold, step, jitterFactor, keepFraction }) {
    const ctx = cvs.getContext("2d");
    const { width, height } = cvs;
    const img = ctx.getImageData(0, 0, width, height).data;
    const scale = worldWidth / width;
    const jitter = scale * jitterFactor;

    const positions = [];
    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const idx = (y * width + x) * 4;
            const a = img[idx + 3];
            if (a > alphaThreshold && Math.random() < keepFraction) {
                const wx = (x - width / 2) * scale + (Math.random() - 0.5) * jitter;
                const wy = (height / 2 - y) * scale + (Math.random() - 0.5) * jitter;
                positions.push(wx, wy, 0);
            }
        }
    }
    return positions;
}

function makeTextCanvas(text, font, { w, h }) {
	const cvs = document.createElement("canvas");
	cvs.width = w;
	cvs.height = h;
	const ctx = cvs.getContext("2d");
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = font;
	ctx.fillText(text, w / 2, h / 2);
	return cvs;
}

// --- Star field (background) ---
function createStarField({
    count = 2000,
    spread = 200,
    color = 0xffffff,
    size = 0.05
} = {}) {
    const positions = [];
    for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * spread;
        const y = (Math.random() - 0.5) * spread;
        const z = (Math.random() - 0.5) * spread;
        positions.push(x, y, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    mat.fog = false;

    const points = new THREE.Points(geo, mat);

    function update(t) {
        mat.opacity = 0.7 + 0.3 * Math.sin(t * 0.5 + Math.random()); // soft twinkle
    }

    return { points, update };
}


// =========================================
// CPU-side height sampling for camera float
// =========================================
function createHeightSampler(shaderMaterial, planeSize) {
	const noise2D = makeNoise2D();

	function ease01(x, k) {
		x = Math.max(0, Math.min(1, x));
		const s = x * x * (3 - 2 * x);
		const kk = Math.max(0, Math.min(4, k));
		return (1 - kk) * x + kk * s;
	}

	function worldXZtoUV(x, z) {
		return new THREE.Vector2(0.5 + x / planeSize, 0.5 + z / planeSize);
	}

	function heightAtXZ(x, z, time) {
		const u = shaderMaterial.uniforms;
		const uv = worldXZtoUV(x, z); // 0..1
		const w = (2 * Math.PI) / u.uCycleSec.value;
		const raw = 0.5 + 0.5 * Math.sin(time * w);
		const phase = ease01(raw, u.uEaseK.value);
		const amp = THREE.MathUtils.lerp(u.uAmpMin.value, u.uAmpMax.value, phase);
		const freq = THREE.MathUtils.lerp(u.uFreqMin.value, u.uFreqMax.value, phase);
		const n = noise2D(uv.x * freq + time * 0.12, uv.y * freq + time * 0.07);
		const swell = noise2D(uv.x * 1.2 + time * 0.05, uv.y * 1.2 - time * 0.03) * 0.25;
		return (n + swell) * amp; // displaced along +Z, which maps to world +Y after rotation
	}

	return { heightAtXZ };
}

function makeNoise2D() {
	// Stefan Gustavson-style 2D simplex noise (tiny JS port, deterministic)
	const F2 = 0.5 * (Math.sqrt(3) - 1);
	const G2 = (3 - Math.sqrt(3)) / 6;
	const grad2 = [
		[1, 1], [-1, 1], [1, -1], [-1, -1],
		[1, 0], [-1, 0], [0, 1], [0, -1]
	];
	const p = new Uint8Array(256);
	let s = 1337;
	for (let i = 0; i < 256; i++) {
		s = (s * 1103515245 + 12345) >>> 0;
		p[i] = s & 255;
	}
	const perm = new Uint16Array(512);
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

	function dot(g, x, y) { return g[0] * x + g[1] * y; }

	return function (xin, yin) {
		const s = (xin + yin) * F2;
		const i = Math.floor(xin + s);
		const j = Math.floor(yin + s);
		const t = (i + j) * G2;
		const X0 = i - t;
		const Y0 = j - t;
		const x0 = xin - X0;
		const y0 = yin - Y0;
		let i1, j1;
		if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
		const x1 = x0 - i1 + G2;
		const y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2;
		const y2 = y0 - 1 + 2 * G2;
		const ii = i & 255;
		const jj = j & 255;
		const gi0 = grad2[perm[ii + perm[jj]] & 7];
		const gi1 = grad2[perm[ii + i1 + perm[jj + j1]] & 7];
		const gi2 = grad2[perm[ii + 1 + perm[jj + 1]] & 7];
		let n0 = 0, n1 = 0, n2 = 0;
		let t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * dot(gi0, x0, y0); }
		let t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * dot(gi1, x1, y1); }
		let t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * dot(gi2, x2, y2); }
		return 70 * (n0 + n1 + n2); // roughly [-1,1]
	};
}
