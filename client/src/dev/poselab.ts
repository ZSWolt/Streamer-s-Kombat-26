// Dev-only contact sheet (not part of the build): one fighter in many poses, seen the way the game sees it.
//
//   /poselab.html?id=odedsvr&poses=GUARD,CROUCH,jab.hit,lowkick.hit&view=game&shot=name
//
//   id     fighter id (roster); a model is used if assets/models has one. Several ids (a,b,c) = one row each
//   poses  comma list: a state pose (GUARD, WIN ...) or attack.phase (jab.wind / jab.hit / jab.follow);
//          a+b@0.5 blends two of them; default = the states
//   view   game (the match camera's angle, default) | front | side | back | <degrees of yaw>
//   cols   poses per row (default 8)
//   px     width of one cell in pixels (default 250)
//   shot   save the sheet to tools/shots/<shot>.jpg through the dev server
import * as THREE from 'three';
import { ROSTER, fighterIndex } from '../data/roster';
import { preloadModels } from '../render/model';
import * as P from '../render/pose';
import { applyPose, buildRig } from '../render/rig';

const q = new URLSearchParams(location.search);
const ids = (q.get('id') ?? 'odedsvr').split(',');
const view = q.get('view') ?? 'game';
const STATES = ['NEUTRAL', 'STAND', 'GUARD', 'CROUCH', 'BLOCK', 'BLOCK_CROUCH', 'JUMP', 'HIT_HIGH', 'HIT_MID', 'AIR_HIT', 'LYING', 'GETUP', 'DIZZY', 'WIN', 'WIN2', 'TAUNT'];
const poseNames = (q.get('poses') ?? STATES.join(',')).split(',').filter(Boolean);
const cols = ids.length > 1 ? poseNames.length : Number(q.get('cols') ?? 8);
const names = ids.flatMap(() => poseNames);
const AIR = new Set(['JUMP', 'AIR_HIT']);

let LIB: P.PoseLib = P.CLASSIC;
function lookup(name: string): { pose: P.Pose; air: boolean } {
  const lib = { NEUTRAL: P.NEUTRAL, ...LIB } as unknown as Record<string, P.Pose>;
  if (name.includes('.')) {
    const [a, ph] = name.split('.');
    const anim = LIB.ATTACKS[a];
    if (!anim) throw new Error('no attack ' + a);
    return { pose: (anim as unknown as Record<string, P.Pose>)[ph] ?? anim.hit, air: !!anim.air };
  }
  if (!lib[name]) throw new Error('no pose ' + name);
  return { pose: lib[name], air: AIR.has(name) };
}

function resolve(name: string): { pose: P.Pose; air: boolean } {
  const m = /^(.+)\+(.+)@([\d.]+)$/.exec(name);
  if (!m) return lookup(name);
  const a = lookup(m[1]), b = lookup(m[2]);
  return { pose: P.lerpPose(a.pose, b.pose, Number(m[3]), new Float32Array(P.POSE_LEN)), air: a.air && b.air };
}

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
  scene.background = new THREE.Color('#20222a');
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
    const { pose, air } = resolve(name);
    applyPose(rig, pose);
    if (rig.skin) {
      rig.skin.feetOnGround = !air && Math.abs(pose[P.J.hips * 3]) < 0.7;
      rig.skin.update(0);
    }
    const col = i % cols, row = Math.floor(i / cols);
    rig.root.position.set((col + 0.5) * cellW, (rows - 1 - row) * cellH + 0.12 + (air ? 0.25 : 0), 0);
    rig.root.rotation.y = yaw;
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
  renderer.render(scene, cam);
  const shot = q.get('shot');
  if (shot) {
    await fetch('/__shot?name=' + encodeURIComponent(shot), { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.9) });
  }
  document.title = 'done ' + (shot ?? '');
  (window as unknown as { labDone: boolean }).labDone = true;
}

main().catch((e) => { document.getElementById('cap')!.textContent = String(e?.stack ?? e); document.title = 'error'; console.error(e); });
