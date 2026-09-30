import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BloomEffect, ChromaticAberrationEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);
  composer: EffectComposer;
  bloom: BloomEffect;
  chroma: ChromaticAberrationEffect;
  vignette: VignetteEffect;
  private chromaAmt = 0;
  private flashEl: HTMLDivElement;
  quality: Quality = 'high';
  resScale = 1;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ intensity: 1.1, luminanceThreshold: 0.72, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 });
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.vignette, tone));
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.15 });
    this.composer.addPass(new EffectPass(this.camera, this.chroma));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

    this.flashEl = document.createElement('div');
    this.flashEl.className = 'screen-flash';
    document.body.appendChild(this.flashEl);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q: Quality, resScale = 1) {
    this.quality = q;
    this.resScale = resScale;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.bloom.intensity = q === 'low' ? 0.6 : 1.1;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dprCap = this.quality === 'ultra' ? 2 : this.quality === 'high' ? 1.5 : this.quality === 'medium' ? 1 : 0.75;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap) * this.resScale);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  kickChroma(a: number) { this.chromaAmt = Math.max(this.chromaAmt, a); }

  flash(color = '#ffffff', opacity = 0.7, ms = 90) {
    const el = this.flashEl;
    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = String(opacity);
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${ms}ms ease-out`;
      el.style.opacity = '0';
    });
  }

  render(dt: number) {
    this.chromaAmt = Math.max(0, this.chromaAmt - dt * 0.02);
    this.chroma.offset.set(this.chromaAmt, this.chromaAmt * 0.6);
    this.composer.render(dt);
  }
}
