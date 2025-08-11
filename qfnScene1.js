// qfnScene1.js
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

export function setupQFN() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    const loader = new FontLoader();
    let textMesh = null;

    loader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', (font) => {
        const textGeometry = new TextGeometry('QFN', {
            font: font,
            size: 50,
            depth: 2,
            curveSegments: 2,
            bevelEnabled: true,
            bevelThickness: 10,
            bevelSize: 4,
            bevelOffset: 0,
            bevelSegments: 5
        });

        textGeometry.center();
        const material = new THREE.MeshNormalMaterial({ wireframe: true });
        textMesh = new THREE.Mesh(textGeometry, material);
        scene.add(textMesh);
    });
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));



    let cameraAngleX = 0; 
    let cameraAngleZ = 0; 
    let cameraAngleY = 0; 

    const flipInterval = 20;
    let t = 0;
    let flipSign = 1;

    function animate(delta) {
        t += delta;
        const target = (Math.floor(t / flipInterval) % 2 === 0) ? 1 : -1;
        flipSign = THREE.MathUtils.lerp(flipSign, target, 0.005); // ease

        if (textMesh) {
            const speed = (Math.sin(delta) + Math.cos(0.5 * delta) + Math.sin(0.3 * delta)) * 
                        (0.008 + 0.002 * Math.sin(0.1 * delta));
            textMesh.rotation.y += flipSign * speed;

        }

        cameraAngleX += delta * 0.5 * flipSign; 
        camera.position.x = Math.sin(cameraAngleX) * 100;

        cameraAngleZ += delta * 0.4 * flipSign; 
        camera.position.z = Math.cos(cameraAngleZ) * 100;

        cameraAngleY += delta * 0.3; 
        camera.position.y = Math.sin(cameraAngleY) * 50;

        camera.lookAt(0, 0, 0); // always look at the text
    }

    return { scene, camera, animate };
}
