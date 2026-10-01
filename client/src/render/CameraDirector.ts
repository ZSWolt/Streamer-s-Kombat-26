import * as THREE from 'three';

export type CamMode = 'fight' | 'focus' | 'orbit' | 'free';

/** How much larger the fighters are on screen than in the first framing of the game. */
const ZOOM = 1.3;
/** Room (metres) kept between a fighter and the edge of the picture when they stand far apart. */
const FIT_MARGIN = 1.1;

export class CameraDirector {
  pos = new THREE.Vector3(0, 1.6, 9);
  look = new THREE.Vector3(0, 1.2, 0);
  private tPos = new THREE.Vector3();
  private tLook = new THREE.Vector3();
  private shakeAmt = 0;
  private shakeT = 0;
  mode: CamMode = 'fight';
  focusTarget = new THREE.Vector3();
  focusDist = 3;
  focusSide = 1;
  orbitAngle = 0;
  lerpSpeed = 6;
  shakeScale = 1;
  zoomPunch = 0;

  constructor(public cam: THREE.PerspectiveCamera) {}

  shake(a: number) { this.shakeAmt = Math.max(this.shakeAmt, a * this.shakeScale); }
  punch(a: number) { this.zoomPunch = Math.max(this.zoomPunch, a); }

  snap() { this.pos.copy(this.tPos); this.look.copy(this.tLook); }

  update(dt: number, p1: THREE.Vector3, p2: THREE.Vector3, stageHalf = 5.4) {
    if (this.mode === 'fight') {
      const mid = (p1.x + p2.x) / 2;
      const sep = Math.abs(p1.x - p2.x);
      const aspect = this.cam.aspect;
      const narrow = Math.max(1, 16 / 9 / aspect);
      const hyTop = Math.max(p1.y, p2.y);
      // Close enough that the fighters fill the screen (30% larger than the first framing: 5.2 + 0.62 sep, min 6.4),
      // but never so close that either of them gets nearer than FIT_MARGIN to the edge of the picture.
      const perZ = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * aspect; // half the picture's width per metre of distance
      const zFit = (sep / 2 + FIT_MARGIN) / perZ;
      const z = THREE.MathUtils.clamp(Math.max((4 + sep * 0.477) * narrow, zFit) + hyTop * 0.9, 6.4 / ZOOM, 11.5 * narrow);
      const halfView = perZ * z;
      const lim = Math.max(0, stageHalf + 1.2 - halfView);
      const x = THREE.MathUtils.clamp(mid, -lim, lim);
      const hy = hyTop;
      this.tPos.set(x, 1.55 + hy * 0.45 + (z - 7) * 0.05, z - this.zoomPunch);
      this.tLook.set(x, 1.15 + hy * 0.5, 0);
    } else if (this.mode === 'focus') {
      const f = this.focusTarget;
      this.tPos.set(f.x + this.focusSide * this.focusDist * 0.45, f.y + 0.25, f.z + this.focusDist);
      this.tLook.copy(f);
    } else if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.35;
      const f = this.focusTarget;
      this.tPos.set(f.x + Math.sin(this.orbitAngle) * this.focusDist, f.y + 0.3, f.z + Math.cos(this.orbitAngle) * this.focusDist);
      this.tLook.copy(f);
    }
    const k = 1 - Math.exp(-this.lerpSpeed * dt);
    this.pos.lerp(this.tPos, k);
    this.look.lerp(this.tLook, k);
    this.zoomPunch = Math.max(0, this.zoomPunch - dt * 4);
    this.shakeT += dt * 60;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    const s = this.shakeAmt * this.shakeAmt;
    this.cam.position.set(
      this.pos.x + (Math.sin(this.shakeT * 1.7) + Math.sin(this.shakeT * 3.1)) * s * 0.12,
      this.pos.y + (Math.cos(this.shakeT * 2.3) + Math.sin(this.shakeT * 4.7)) * s * 0.1,
      this.pos.z,
    );
    this.cam.lookAt(this.look);
  }
}
