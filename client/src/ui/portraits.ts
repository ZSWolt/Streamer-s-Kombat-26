import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ROSTER } from '../data/roster';
import { applyPose, buildRig } from '../render/rig';
import * as P from '../render/pose';

// Renders character portraits (select cards, round icons) from the 3D models, so every piece of UI
// automatically matches the models — including the real GLB models once they are added.

const cache = new Map<string, string>();

export function portraitUrl(idx: number, kind: 'card' | 'icon', skin = 0): string {
  return cache.get(`${idx}:${kind}:${skin}`) ?? '';
}

export async function generatePortraits(onProgress?: (p: number) => void) {
  const W = 360, H = 440;
  const canvas = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight('#fff4e6', '#402018', 1.2));
  const key = new THREE.DirectionalLight('#ffe2c4', 3);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ff9a4a', 3.5);
  rim.position.set(3, 2, -3);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight('#9ab8ff', 1.5);
  rim2.position.set(-3, 1, -3);
  scene.add(rim2);
  const cam = new THREE.PerspectiveCamera(24, W / H, 0.1, 50);

  const pose = P.makePose({
    spine: [0.02, 0, 0], head: [-0.08, 0.1, 0.03],
    armL: [-0.25, 0, 0.45], foreL: [-2.1, 0, 0], armR: [-0.3, 0, -0.45], foreR: [-2.0, 0, 0],
    mouth: 0.15,
  }, P.GUARD);

  for (let i = 0; i < ROSTER.length; i++) {
    const f = ROSTER[i];
    for (let s = 0; s < f.skins.length; s++) {
      const rig = buildRig(f, s);
      // real models are shown in their own sculpted stance
      applyPose(rig, rig.skin ? P.HUMAN.GUARD : pose);
      if (rig.skin) rig.skin.update(0);
      rig.root.rotation.y = -0.35;
      scene.add(rig.root);
      rig.root.updateMatrixWorld(true);
      const headPos = new THREE.Vector3();
      rig.faceAnchor.getWorldPosition(headPos);
      const k = rig.headSize / (0.3 * f.look.height); // real models have smaller heads than the bobbleheads: move in
      // card: head + upper body
      r.setSize(W, H, false);
      cam.aspect = W / H;
      cam.fov = 24;
      cam.updateProjectionMatrix();
      cam.position.set(headPos.x + 0.25 * k, headPos.y - 0.05 * k, headPos.z + 3.1 * k);
      cam.lookAt(headPos.x, headPos.y - 0.28 * k, headPos.z);
      r.setClearColor(0x000000, 0);
      r.render(scene, cam);
      cache.set(`${i}:card:${s}`, canvas.toDataURL('image/png'));
      // icon: head close-up
      r.setSize(256, 256, false);
      cam.aspect = 1;
      cam.fov = 22;
      cam.updateProjectionMatrix();
      cam.position.set(headPos.x + 0.15 * k, headPos.y + 0.02 * k, headPos.z + 2.0 * k);
      cam.lookAt(headPos.x, headPos.y - 0.05 * k, headPos.z);
      r.render(scene, cam);
      cache.set(`${i}:icon:${s}`, canvas.toDataURL('image/png'));
      scene.remove(rig.root);
      rig.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      rig.materials.forEach((m) => m.dispose());
    }
    onProgress?.((i + 1) / ROSTER.length);
    await new Promise((res) => setTimeout(res, 0));
  }
  r.dispose();
  r.forceContextLoss();
}
