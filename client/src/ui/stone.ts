// Stone-carved gold-rimmed text (the look of the menus/HUD), built from a procedurally generated rock texture.
import { h } from './dom';

function noise2(w: number, h: number, seed: number) {
  let s = seed;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const grid = new Float32Array((w + 1) * (h + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const at = (a: number, b: number) => grid[((b % h + h) % h) * (w + 1) + ((a % w + w) % w)];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
  };
}

export function makeStoneTexture(size = 256): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const n1 = noise2(8, 8, 7), n2 = noise2(24, 24, 13), n3 = noise2(64, 64, 29);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let t = n1(u * 8, v * 8) * 0.55 + n2(u * 24, v * 24) * 0.3 + n3(u * 64, v * 64) * 0.15;
      t = Math.pow(t, 1.25);
      const base = 92 + t * 120;
      const i = (y * size + x) * 4;
      img.data[i] = base * 1.02;
      img.data[i + 1] = base * 0.97;
      img.data[i + 2] = base * 0.9;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // cracks
  let s = 99;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  g.lineCap = 'round';
  for (let k = 0; k < 14; k++) {
    let x = r() * size, y = r() * size;
    g.strokeStyle = `rgba(30,22,14,${0.35 + r() * 0.35})`;
    g.lineWidth = 0.6 + r() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < 7; j++) { x += (r() - 0.5) * 34; y += (r() - 0.5) * 34; g.lineTo(x, y); }
    g.stroke();
  }
  // pits / specks
  for (let k = 0; k < 900; k++) {
    g.fillStyle = r() < 0.5 ? 'rgba(20,14,8,0.35)' : 'rgba(255,248,230,0.18)';
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  return c.toDataURL('image/png');
}

export function installStone() {
  const url = makeStoneTexture();
  document.documentElement.style.setProperty('--stone-tex', `url(${url})`);
}

/** <span class="stone" data-t="...">...</span> */
export function stone(text: string, cls = ''): HTMLSpanElement {
  return h('span', { class: 'stone' + (cls ? ' ' + cls : ''), 'data-t': text }, [text]);
}
