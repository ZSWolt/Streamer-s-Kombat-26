// Dev-only model check (not part of the build): put every model through every pose a fighter passes through and
// measure what breaks, so that a broken shoulder is found by a number and not by a player.
//
//   /qa.html?id=odedsvr,maorameleh&out=qa1[&views=66,0,45,90,135,180,225,270,315][&poses=GUARD,jab.hit][&mirror=1]
//
// Four things are measured, per model and pose:
//   back   pixels where the nearest surface is the inside of a single-sided mesh: you are looking through the body
//          (per view; 66 degrees of yaw is the match camera, 0 the front)
//   lid    pixels showing one of the dark patches that close a garment's openings (materials named inside_*): some
//          always show (up a sleeve, under a hem); a lot of them means something has opened up
//   smear  triangles stretched to more than twice their size (skin pulled between two bones)
//   gap    seams that have come apart: vertices of two parts that were one point of the sculpt before it was cut
//          (a sleeve and the shirt it grows out of). The rig build writes them down (tools/models/dbg2/<id>.seams.json,
//          served by the dev server); without that file they are guessed from what touches with the arms held out
// The report goes to tools/shots/<out>.json; `lab` in it is a ready pose-lab query for the worst cases.
import * as THREE from 'three';
import { ROSTER, fighterIndex } from '../data/roster';
import { modelIds, preloadModels } from '../render/model';
import * as P from '../render/pose';
import { applyPose, buildRig } from '../render/rig';
import { allPoses, resolve } from './poses';

const q = new URLSearchParams(location.search);
const VIEWS = (q.get('views') ?? '66,0,45,90,135,180,225,270,315').split(',').map(Number);
const W = 340, H = 300; // 1 px = 1 cm
const SMEAR = 2.0;
const flip = !!q.get('flip'); // self-test: count the outsides instead, every body pixel should turn up as `back`
const cap = document.getElementById('cap')!;
const say = (s: string) => { cap.textContent += s + '\n'; };

interface MeshData {
  mesh: THREE.SkinnedMesh; name: string; n: number; bind: Float32Array; idx: Uint16Array | Uint32Array; si: Uint16Array; sw: Float32Array;
  rest: Float32Array; out: Float32Array; double: boolean; lid: boolean;
}

function meshData(mesh: THREE.SkinnedMesh, double: boolean, lid: boolean): MeshData {
  const g = mesh.geometry;
  const pos = g.getAttribute('position'), ji = g.getAttribute('skinIndex'), jw = g.getAttribute('skinWeight');
  const n = pos.count;
  const bind = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    bind[i * 3] = v.x; bind[i * 3 + 1] = v.y; bind[i * 3 + 2] = v.z;
    let sum = 0;
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = ji.getComponent(i, k); sw[i * 4 + k] = jw.getComponent(i, k); sum += sw[i * 4 + k]; }
    if (sum > 0) for (let k = 0; k < 4; k++) sw[i * 4 + k] /= sum;
  }
  const index = g.getIndex();
  const idx = index ? (index.array as Uint16Array | Uint32Array) : Uint32Array.from({ length: n }, (_, i) => i);
  const rest = new Float32Array(idx.length);
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e] * 3, b = idx[t + (e + 1) % 3] * 3;
      rest[t + e] = Math.hypot(bind[a] - bind[b], bind[a + 1] - bind[b + 1], bind[a + 2] - bind[b + 2]);
    }
  }
  // (a part with two materials arrives as a group of two meshes: the part's name is the group's)
  const up = mesh.parent && mesh.parent.type === 'Group' && mesh.parent.children.every((c) => (c as THREE.Mesh).isMesh) ? mesh.parent.name : '';
  return { mesh, name: (up || mesh.name || '?') + (lid ? ':inside' : ''), n, bind, idx, si, sw, rest, out: new Float32Array(n * 3), double, lid };
}

/** world positions of every vertex in the current pose (the same sum the vertex shader does) */
function skin(d: MeshData) {
  d.mesh.skeleton.update();
  const m = d.mesh.skeleton.boneMatrices as Float32Array;
  const { bind, si, sw, out, n } = d;
  for (let i = 0; i < n; i++) {
    const x = bind[i * 3], y = bind[i * 3 + 1], z = bind[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[i * 4 + k];
      if (w === 0) continue;
      const o = si[i * 4 + k] * 16;
      ox += w * (m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12]);
      oy += w * (m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13]);
      oz += w * (m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14]);
    }
    out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
  }
}

interface Pair { a: number; i: number; b: number; j: number; d: number }

/** vertices of different meshes that touch in the rest pose */
function seamPairs(ds: MeshData[], at: Float32Array[], eps: number): Pair[] {
  const cell = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  ds.forEach((d, a) => {
    const bind = at[a];
    for (let i = 0; i < d.n; i++) {
      const k = key(Math.floor(bind[i * 3] / eps), Math.floor(bind[i * 3 + 1] / eps), Math.floor(bind[i * 3 + 2] / eps));
      let c = cell.get(k);
      if (!c) cell.set(k, c = []);
      c.push(a, i);
    }
  });
  const pairs: Pair[] = [];
  ds.forEach((d, a) => {
    if (d.lid || d.double) return;
    const bind = at[a];
    for (let i = 0; i < d.n; i++) {
      const x = bind[i * 3], y = bind[i * 3 + 1], z = bind[i * 3 + 2];
      const cx = Math.floor(x / eps), cy = Math.floor(y / eps), cz = Math.floor(z / eps);
      let best = eps, bb = -1, bj = -1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const c = cell.get(key(cx + dx, cy + dy, cz + dz));
        if (!c) continue;
        for (let k = 0; k < c.length; k += 2) {
          const b = c[k];
          if (b <= a || ds[b].lid || ds[b].double) continue;
          if (d.name.startsWith('leg') && ds[b].name.startsWith('leg')) continue; // thighs that touch are no seam
          const o = at[b], j = c[k + 1];
          const dd = Math.hypot(o[j * 3] - x, o[j * 3 + 1] - y, o[j * 3 + 2] - z);
          if (dd < best) { best = dd; bb = b; bj = j; }
        }
      }
      if (bb >= 0) pairs.push({ a, i, b: bb, j: bj, d: best });
    }
  });
  return pairs;
}

/** the seams the rig build wrote down: points of the rest pose, two by two, each with the part it is on */
async function seamFile(id: string, ds: MeshData[], eps: number): Promise<Pair[] | null> {
  let rows: [string, number[], string, number[]][];
  try {
    const r = await fetch('/__file?name=' + encodeURIComponent(id + '.seams.json'));
    if (!r.ok) return null;
    rows = (await r.json()).pairs;
  } catch { return null; }
  const clean = (n: string) => n.replace(/[.\s]/g, '').toLowerCase();
  const byName = new Map<string, number[]>();
  ds.forEach((d, a) => { if (!d.lid) { const k = clean(d.name); byName.set(k, [...(byName.get(k) ?? []), a]); } });
  const nearest = (name: string, at: number[]): [number, number] | null => {
    let best = eps * eps * 4, ba = -1, bi = -1;
    for (const a of byName.get(clean(name)) ?? []) {
      const b = ds[a].bind;
      for (let i = 0; i < ds[a].n; i++) {
        const dx = b[i * 3] - at[0], dy = b[i * 3 + 1] - at[1], dz = b[i * 3 + 2] - at[2];
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < best) { best = dd; ba = a; bi = i; }
      }
    }
    return ba < 0 ? null : [ba, bi];
  };
  const pairs: Pair[] = [];
  for (const [na, pa, nb, pb] of rows) {
    const A = nearest(na, pa), B = nearest(nb, pb);
    if (A && B) pairs.push({ a: A[0], i: A[1], b: B[0], j: B[1], d: Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) });
  }
  return pairs;
}

async function main() {
  await preloadModels();
  const ids = (q.get('id') ?? modelIds().join(',')).split(',').filter(Boolean);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(W, H);
  document.body.prepend(renderer.domElement);
  const target = new THREE.WebGLRenderTarget(W, H);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  const cam = new THREE.OrthographicCamera(-W / 200, W / 200, H / 100 - 0.45, -0.45, -50, 50);
  cam.position.set(0, 0, 10);
  const px = new Uint8Array(W * H * 4);
  const report: Record<string, unknown> = {};
  for (const id of ids) {
    const t0 = performance.now();
    const rig = buildRig(ROSTER[fighterIndex(id)], 0);
    if (!rig.skin) { say(`${id}: no model`); continue; }
    if (q.get('mirror')) rig.body.scale.x *= -1;
    scene.add(rig.root);
    const ds: MeshData[] = [];
    rig.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!(o as THREE.Mesh).isMesh) return;
      if (!m.isSkinnedMesh) { o.visible = false; return; }
      const src = m.material as THREE.Material;
      const lid = src.name.startsWith('inside_');
      const fingers = new Set(m.skeleton.bones.map((b, i) => (/^f[LR]\d/.test(b.name) ? i : -1)).filter((i) => i >= 0));
      const ji = m.geometry.getAttribute('skinIndex');
      let double = false;
      for (let i = 0; i < ji.count && !double; i += 7) double = fingers.has(ji.getX(i)) || fingers.has(ji.getY(i));
      // red = 255 where a single-sided mesh shows its inside; green = which mesh; blue = a lid
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      mat.color.setRGB(lid ? 1 : 0, (ds.length + 1) / 255, double ? 1 : 0, THREE.LinearSRGBColorSpace);
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>',
          `#include <dithering_fragment>\n\tgl_FragColor = vec4(((gl_FrontFacing || diffuse.b > 0.5) != ${flip}) ? 0.0 : 1.0, diffuse.g, diffuse.r, 1.0);`);
      };
      m.material = mat;
      ds.push(meshData(m, double, lid));
    });
    rig.root.updateMatrixWorld(true);
    let lo = Infinity, hi = -Infinity;
    for (const d of ds) for (let i = 1; i < d.bind.length; i += 3) { lo = Math.min(lo, d.bind[i]); hi = Math.max(hi, d.bind[i]); }
    const height = hi - lo;
    const s = Math.cbrt(Math.abs(ds[0].mesh.matrixWorld.determinant()));
    const lib = P.HUMAN;
    // Seams are looked for with the arms held out, the way the sculpt stood when it was cut into parts: in the
    // rest pose the underside of a sleeve lies against the shirt's side, and that is no seam.
    const tpose = P.makePose({ armL: [0, 0, Math.PI / 2], armR: [0, 0, -Math.PI / 2], grip: 0 });
    applyPose(rig, tpose);
    rig.skin.feetOnGround = true;
    rig.skin.grip[0] = rig.skin.grip[1] = 0;
    rig.skin.update(0);
    rig.root.updateMatrixWorld(true);
    const at: Float32Array[] = [];
    for (const d of ds) {
      skin(d);
      const t = d.out.map((x) => x / s);
      at.push(t);
      // ... and a triangle's own size is the larger of its sizes in the two: the underside of a sleeve lies folded
      // against the body in the rest pose, and unfolding is not stretching
      for (let k = 0; k < d.idx.length; k += 3) {
        for (let e = 0; e < 3; e++) {
          const a = d.idx[k + e] * 3, b = d.idx[k + (e + 1) % 3] * 3;
          d.rest[k + e] = Math.max(d.rest[k + e], Math.hypot(t[a] - t[b], t[a + 1] - t[b + 1], t[a + 2] - t[b + 2]));
        }
      }
    }
    const known = await seamFile(id, ds, 0.0035 * height);
    const pairs = known ?? seamPairs(ds, at, 0.0035 * height);
    const poses = (q.get('poses') ?? allPoses(lib).join(',')).split(',').filter(Boolean);
    const back: { pose: string; view: number; px: number; body: number; at: number[]; parts: Record<string, number> }[] = [];
    const lids: { pose: string; view: number; px: number; parts: Record<string, number> }[] = [];
    const smear: { pose: string; tris: number; max: number; part: string }[] = [];
    const gap: { pose: string; cm: number; n: number; pair: string; h: number }[] = [];
    for (const name of poses) {
      const { pose, air } = resolve(lib, name);
      applyPose(rig, pose);
      rig.skin.feetOnGround = !air && Math.abs(pose[P.J.hips * 3]) < 0.7;
      rig.skin.grip[0] = pose[P.EX_GRIPL];
      rig.skin.grip[1] = pose[P.EX_GRIPR];
      rig.skin.update(0);
      rig.root.rotation.y = 0;
      rig.root.updateMatrixWorld(true);
      // ---- smear and gaps
      let tris = 0, max = 0, part = '';
      for (const d of ds) {
        skin(d);
        if (d.lid || d.double) continue; // membranes stretch as they must, and a closing fist folds its skin
        const { idx, out, rest } = d;
        let mine = 0;
        for (let t = 0; t < idx.length; t += 3) {
          let r = 0;
          for (let e = 0; e < 3; e++) {
            if (rest[t + e] < 1e-6) continue;
            const a = idx[t + e] * 3, b = idx[t + (e + 1) % 3] * 3;
            r = Math.max(r, Math.hypot(out[a] - out[b], out[a + 1] - out[b + 1], out[a + 2] - out[b + 2]) / (s * rest[t + e]));
          }
          if (r > SMEAR) mine++;
          if (r > max) { max = r; part = d.name; }
        }
        tris += mine;
      }
      smear.push({ pose: name, tris, max: +max.toFixed(2), part });
      let far = 0, nfar = 0, who = '', hh = 0;
      for (const p of pairs) {
        const A = ds[p.a], B = ds[p.b];
        const sep = Math.hypot(A.out[p.i * 3] - B.out[p.j * 3], A.out[p.i * 3 + 1] - B.out[p.j * 3 + 1], A.out[p.i * 3 + 2] - B.out[p.j * 3 + 2]) / s - p.d;
        if (sep > 0.01 * height) nfar++;
        if (sep > far) { far = sep; who = `${A.name} / ${B.name}`; hh = (A.bind[p.i * 3 + 1] - lo) / height; }
      }
      gap.push({ pose: name, cm: +((far / height) * 175).toFixed(1), n: nfar, pair: who, h: +hh.toFixed(2) });
      // ---- looking through the body
      for (const view of VIEWS) {
        rig.root.rotation.y = (view * Math.PI) / 180;
        renderer.setRenderTarget(target);
        renderer.render(scene, cam);
        renderer.readRenderTargetPixels(target, 0, 0, W, H, px);
        let n = 0, body = 0, sx = 0, sy = 0, nl = 0;
        const parts: Record<string, number> = {}, lparts: Record<string, number> = {};
        for (let i = 0; i < px.length; i += 4) {
          if (!px[i + 1]) continue;
          body++;
          if (px[i + 2] > 128) { nl++; const nm = ds[px[i + 1] - 1]?.name ?? '?'; lparts[nm] = (lparts[nm] ?? 0) + 1; continue; }
          if (px[i] < 128) continue;
          n++;
          const pi = i >> 2;
          sx += pi % W; sy += Math.floor(pi / W);
          const nm = ds[px[i + 1] - 1]?.name ?? '?';
          parts[nm] = (parts[nm] ?? 0) + 1;
        }
        if (n) back.push({ pose: name, view, px: n, body, at: [+((sx / n - W / 2) / 100).toFixed(2), +(sy / n / 100 - 0.45).toFixed(2)], parts });
        if (nl) lids.push({ pose: name, view, px: nl, parts: lparts });
      }
    }
    renderer.setRenderTarget(null);
    scene.remove(rig.root);
    back.sort((a, b) => b.px - a.px);
    lids.sort((a, b) => b.px - a.px);
    smear.sort((a, b) => b.tris - a.tris);
    gap.sort((a, b) => b.cm - a.cm);
    const sum = (v: number) => back.filter((b) => b.view === v).reduce((t, b) => t + b.px, 0);
    const worst = back.slice(0, 12).map((b) => `${b.pose}^${b.view}`);
    report[id] = {
      poses: poses.length, meshes: ds.length, pairs: pairs.length, seams: known ? 'from the build' : 'guessed', seconds: +((performance.now() - t0) / 1000).toFixed(1),
      backTotal: back.reduce((t, b) => t + b.px, 0), backByView: Object.fromEntries(VIEWS.map((v) => [v, sum(v)])),
      lidTotal: lids.reduce((t, b) => t + b.px, 0), lidMax: lids[0]?.px ?? 0,
      smearTotal: smear.reduce((t, b) => t + b.tris, 0), gapMax: gap[0]?.cm ?? 0, gapPoses: gap.filter((g) => g.cm > 1.5).length,
      lab: `id=${id}&poses=${worst.join(',')}&mat=back&px=330&bg=8a8f98`,
      labLids: `id=${id}&poses=${lids.slice(0, 12).map((b) => `${b.pose}^${b.view}`).join(',')}&px=330&bg=8a8f98`,
      back: back.slice(0, 60), lids: lids.slice(0, 40), smear: smear.slice(0, 25), gap: gap.slice(0, 25),
    };
    const r = report[id] as { backTotal: number; lidTotal: number; lidMax: number; smearTotal: number; gapMax: number; gapPoses: number; seconds: number };
    say(`${id.padEnd(14)} back ${String(r.backTotal).padStart(7)} px   lids ${String(r.lidTotal).padStart(7)} px (max ${r.lidMax})   smear ${String(r.smearTotal).padStart(7)} tris   gap ${String(r.gapMax).padStart(5)} cm in ${r.gapPoses} poses   (${poses.length} poses, ${ds.length} meshes, ${pairs.length} seam pairs${known ? '' : ' (guessed)'}, ${r.seconds}s)`);
    if (back[0]) say(`    worst look-through: ${back.slice(0, 4).map((b) => `${b.pose}^${b.view} ${b.px}px ${Object.keys(b.parts)[0]}`).join(' | ')}`);
    await new Promise((res) => setTimeout(res, 0));
  }
  const out = q.get('out');
  if (out) await fetch('/__save?name=' + encodeURIComponent(out + '.json'), { method: 'POST', body: JSON.stringify(report, null, 1) });
  document.title = 'done ' + (out ?? '');
  (window as unknown as { qaDone: boolean }).qaDone = true;
}

main().catch((e) => { say(String(e?.stack ?? e)); document.title = 'error'; console.error(e); });
