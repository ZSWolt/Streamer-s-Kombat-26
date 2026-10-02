// Dev-only contact sheet (not part of the build): one fighter in many poses, seen the way the game sees it.
//
//   /poselab.html?id=odedsvr&poses=GUARD,CROUCH,jab.hit,lowkick.hit&view=game&shot=name
//
//   id     fighter id (roster); a model is used if assets/models has one. Several ids (a,b,c) = one row each
//   poses  comma list: a state pose (GUARD, WIN ...) or attack.phase (jab.wind / jab.hit / jab.follow);
//          a+b@0.5 blends two of them; default = the states (see dev/poses.ts); POSE^135 = that cell seen from
//          135 degrees of yaw whatever `view` says; POSE~0.5 = with the hands half closed
//   view   game (the match camera's angle, default) | front | side | back | <degrees of yaw>
//   cols   poses per row (default 8)
//   px     width of one cell in pixels (default 250)
//   grip   force how closed the hands are (0 open .. 1 fist) instead of what each pose says
//   zoom   magnify (e.g. 3) and aim at height `at` (metres) to look at hands or a face
//   on     with zoom: keep this joint (handL, handR, head ...) in the middle of every cell
//   bg     background colour (hex without #)
//   mat    back = back faces in red | lids = the dark insides of openings in magenta | wire | double
//   only   draw only the meshes whose names start with one of these (only=leg_2,torso)
//   shot   save the sheet to tools/shots/<shot>.jpg through the dev server
import * as THREE from 'three';
import { ROSTER, fighterIndex } from '../data/roster';
import { preloadModels } from '../render/model';
import * as P from '../render/pose';
import { applyPose, buildRig } from '../render/rig';
import { resolve as resolvePose, STATES } from './poses';

const q = new URLSearchParams(location.search);
const ids = (q.get('id') ?? 'odedsvr').split(',');
const view = q.get('view') ?? 'game';
const zoom = Number(q.get('zoom') ?? 1), at = Number(q.get('at') ?? 1);
const poseNames = (q.get('poses') ?? STATES.join(',')).split(',').filter(Boolean);
const cols = ids.length > 1 ? poseNames.length : Number(q.get('cols') ?? 8);
const names = ids.flatMap(() => poseNames);

let LIB: P.PoseLib = P.CLASSIC;
const resolve = (name: string) => resolvePose(LIB, name);

async function main() {
  await preloadModels();
  const rows = Math.ceil(names.length / cols);
  const cellW = 1.9, cellH = 2.25;
  const W = Math.min(2000, Math.round(cols * Number(q.get('px') ?? 250))), H = Math.round(W * (rows * cellH) / (cols * cellW));
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#' + (q.get('bg') ?? '20222a')); // bg=8a8f98 shows dark clothes
  scene.add(new THREE.HemisphereLight('#ffffff', '#404050', 1.5));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(2, 5, 6);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(0, cols * cellW, rows * cellH, 0, -50, 50);
  cam.position.set(0, 0, 10);
  const yaw = view === 'game' ? Math.PI / 2 - 0.42 : view === 'front' ? 0 : view === 'side' ? Math.PI / 2 : view === 'back' ? Math.PI : (Number(view) * Math.PI) / 180;
  const grid = new THREE.GridHelper(40, 40, '#444', '#333');
  names.forEach((name, i) => {
    const rig = buildRig(ROSTER[fighterIndex(ids.length > 1 ? ids[Math.floor(i / cols)] : ids[0])], 0);
    LIB = rig.skin && q.get('lib') !== 'classic' ? P.HUMAN : P.CLASSIC;
    const [nameYaw, ownYaw] = name.split('^'); // GUARD^135 = that pose seen from 135 degrees
    const [poseName, ownGrip] = nameYaw.split('~'); // GUARD~0.5 = that pose with the hands half closed
    const { pose, air } = resolve(poseName);
    applyPose(rig, pose);
    if (rig.skin) {
      rig.skin.feetOnGround = !air && Math.abs(pose[P.J.hips * 3]) < 0.7;
      const grip = ownGrip ?? q.get('grip');
      rig.skin.grip[0] = grip != null ? Number(grip) : pose[P.EX_GRIPL];
      rig.skin.grip[1] = grip != null ? Number(grip) : pose[P.EX_GRIPR];
      rig.skin.update(0);
    }
    const col = i % cols, row = Math.floor(i / cols);
    rig.root.position.set((col + 0.5) * cellW, (rows - 1 - row) * cellH + 0.12 + (air ? 0.25 : 0), 0);
    if (zoom !== 1) {
      rig.root.scale.setScalar(zoom);
      rig.root.position.y = (rows - 1 - row) * cellH + cellH * 0.45 - at * zoom;
      rig.root.position.x -= Number(q.get('dx') ?? 0) * zoom; // look this far to the side of the body's middle (metres, on screen)
    }
    rig.root.rotation.y = ownYaw != null ? (Number(ownYaw) * Math.PI) / 180 : yaw;
    const on = q.get('on') as P.JointName | null; // put this joint (handL, head ...) in the middle of the cell
    const bone = on && rig.skin ? (rig.skin as unknown as { bones: THREE.Object3D[] }).bones[P.J[on]] : null;
    if (bone) {
      rig.root.updateMatrixWorld(true);
      const w = bone.getWorldPosition(new THREE.Vector3());
      rig.root.position.x += (col + 0.5) * cellW - w.x;
      rig.root.position.y += (rows - 1 - row) * cellH + cellH * 0.42 - w.y;
    }
    scene.add(rig.root);
    ((window as unknown as { rigs: unknown[] }).rigs ??= []).push(rig);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(cellW * 0.9, 0.012), new THREE.MeshBasicMaterial({ color: '#566' }));
    line.position.set((col + 0.5) * cellW, (rows - 1 - row) * cellH + 0.12, -3);
    scene.add(line);
    // label
    const c = document.createElement('canvas');
    c.width = 256; c.height = 40;
    const g = c.getContext('2d')!;
    g.fillStyle = '#cdd'; g.font = '24px monospace'; g.textAlign = 'center';
    g.fillText(name.length > 20 ? name.slice(0, 20) : name, 128, 28);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(cellW * 0.95, cellW * 0.95 * 40 / 256), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    lab.position.set((col + 0.5) * cellW, (rows - 1 - row) * cellH + cellH - 0.16, 5);
    scene.add(lab);
  });
  void grid;
  // one cell at a time, each fighter clipped to its own cell (zoomed in they are wider than a cell)
  const roots = (window as unknown as { rigs: { root: THREE.Object3D }[] }).rigs.map((r) => r.root);
  const only = q.get('only')?.split(','); // draw only the meshes whose name starts with one of these (leg_2,torso ...)
  if (only) for (const root of roots) root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.visible = only.some((s) => o.name.startsWith(s)); });
  const mat = q.get('mat'); // double = both sides of every face | wire = the mesh itself | back = back faces in red | lids = the patches that close openings in magenta
  if (mat) {
    for (const root of roots) {
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!m || !(o as THREE.SkinnedMesh).isSkinnedMesh || !o.visible) return;
        if (mat === 'double') m.side = THREE.DoubleSide;
        if (mat === 'lids' && m.name.startsWith('inside_')) (o as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: '#f0f' });
        if (mat === 'wire') { m.wireframe = true; m.side = THREE.DoubleSide; }
        if (mat === 'normals') (o as THREE.Mesh).material = new THREE.MeshNormalMaterial({ side: THREE.FrontSide });
        if (mat === 'grey') { m.map = null; m.normalMap = null; m.color.set('#b0b0b0'); m.needsUpdate = true; }
        if (mat === 'back') {
          const b = new THREE.SkinnedMesh((o as THREE.SkinnedMesh).geometry, new THREE.MeshBasicMaterial({ color: '#f02', side: THREE.BackSide }));
          b.bind((o as THREE.SkinnedMesh).skeleton, (o as THREE.SkinnedMesh).bindMatrix);
          b.frustumCulled = false;
          o.parent!.add(b);
        }
      });
    }
  }
  renderer.autoClear = false;
  renderer.clear();
  renderer.setScissorTest(true);
  roots.forEach((root, i) => {
    for (const r of roots) r.visible = r === root;
    const col = i % cols, row = Math.floor(i / cols);
    renderer.setScissor(Math.round((col * W) / cols), Math.round(((rows - 1 - row) * H) / rows), Math.round(W / cols), Math.round(H / rows));
    renderer.render(scene, cam);
  });
  renderer.setScissorTest(false);
  const shot = q.get('shot');
  if (shot) {
    await fetch('/__shot?name=' + encodeURIComponent(shot), { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.9) });
  }
  document.title = 'done ' + (shot ?? '');
  (window as unknown as { labDone: boolean }).labDone = true;
}

main().catch((e) => { document.getElementById('cap')!.textContent = String(e?.stack ?? e); document.title = 'error'; console.error(e); });
