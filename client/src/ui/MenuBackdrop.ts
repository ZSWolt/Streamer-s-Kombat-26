import * as THREE from 'three';
import { ROSTER } from '../data/roster';
import { ProceduralFighterView } from '../render/FighterView';
import type { Renderer } from '../render/Renderer';
import { buildStage, type StageScene } from '../render/stages';
import { St } from '../sim/types';
import { newFighter } from '../sim/util';

/** Live 3D scene shown (blurred) behind the menus */
export class MenuBackdrop {
  private group = new THREE.Group();
  private stage: StageScene;
  private views: ProceduralFighterView[] = [];
  private fs = [newFighter(0, 0, 0), newFighter(0, 0, 1)];
  private t = 0;

  constructor(private r: Renderer) {
    this.stage = buildStage(3);
    this.group.add(this.stage.group);
    const a = Math.floor(Math.random() * ROSTER.length);
    let b = Math.floor(Math.random() * ROSTER.length);
    if (a === b) b = (b + 3) % ROSTER.length;
    [a, b].forEach((c, i) => {
      const v = new ProceduralFighterView(c, 0);
      this.views.push(v);
      this.group.add(v.root, v.shadow);
      const f = this.fs[i];
      f.char = c;
      f.x = i === 0 ? -1100 : 1100;
    });
    r.scene.add(this.group);
    r.scene.fog = this.stage.fog;
    r.scene.background = this.stage.bg;
  }

  update(dt: number) {
    this.t += dt;
    for (let i = 0; i < 2; i++) {
      const f = this.fs[i];
      f.stFrame++;
      f.st = St.Idle;
      this.views[i].update(f, f, 1, dt);
    }
    this.stage.update(this.t, dt);
    const cam = this.r.camera;
    cam.fov = 34;
    cam.updateProjectionMatrix();
    cam.position.set(Math.sin(this.t * 0.12) * 3.5, 2.1 + Math.sin(this.t * 0.2) * 0.3, 7.5 + Math.cos(this.t * 0.12) * 1.2);
    cam.lookAt(0, 1.2, -1);
  }

  dispose() {
    this.r.scene.remove(this.group);
    for (const v of this.views) v.dispose();
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}
