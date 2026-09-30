import * as THREE from 'three';

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

export function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export function planks(base: string, dark: string) {
  return canvasTex(1024, 1024, (g, w, h) => {
    const r = rnd(7);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const col = new THREE.Color(base).lerp(new THREE.Color(dark), r() * 0.5);
      g.fillStyle = '#' + col.getHexString();
      g.fillRect(0, (i * h) / n, w, h / n);
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
        g.lineWidth = 1 + r() * 2;
        const y = (i * h) / n + r() * (h / n);
        g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + r() * 6, w * 0.6, y - r() * 6, w, y); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, (i * h) / n, w, 3);
      const cut = r() * w;
      g.fillRect(cut, (i * h) / n, 3, h / n);
    }
  }, [3, 2]);
}

export function concrete(base: string) {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const r = rnd(3);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() * 0.035})`;
      g.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 6);
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke(); g.beginPath(); g.moveTo(0, (i * h) / 4); g.lineTo(w, (i * h) / 4); g.stroke(); }
    for (let i = 0; i < 14; i++) {
      const x = r() * w, y = r() * h;
      const grd = g.createRadialGradient(x, y, 0, x, y, 40 + r() * 120);
      grd.addColorStop(0, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    }
  }, [4, 2]);
}

export function neonGrid(bg: string, line: string) {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = line; g.lineWidth = 3;
    g.shadowColor = line; g.shadowBlur = 18;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo((i * w) / 8, 0); g.lineTo((i * w) / 8, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i * h) / 8); g.lineTo(w, (i * h) / 8); g.stroke();
    }
  }, [4, 2]);
}

export function skyline(seed: number, sky: [string, string], windowColor: string, azrieli = false) {
  return canvasTex(2048, 1024, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, sky[0]); grd.addColorStop(1, sky[1]);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const r = rnd(seed);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.8})`; g.fillRect(r() * w, r() * h * 0.5, 2, 2); }
    // moon
    g.fillStyle = '#fff7d6'; g.shadowColor = '#fff7d6'; g.shadowBlur = 40;
    g.beginPath(); g.arc(w * 0.78, h * 0.18, 42, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    const layers = [{ c: '#141625', hmin: 0.25, hmax: 0.55 }, { c: '#0b0c16', hmin: 0.15, hmax: 0.42 }];
    for (const L of layers) {
      let x = 0;
      while (x < w) {
        const bw = 40 + r() * 110;
        const bh = h * (L.hmin + r() * (L.hmax - L.hmin));
        g.fillStyle = L.c;
        g.fillRect(x, h - bh, bw, bh);
        for (let wy = h - bh + 10; wy < h - 10; wy += 16) for (let wx = x + 6; wx < x + bw - 8; wx += 12) {
          if (r() < 0.32) { g.fillStyle = r() < 0.8 ? windowColor : '#9fd8ff'; g.globalAlpha = 0.5 + r() * 0.5; g.fillRect(wx, wy, 6, 8); g.globalAlpha = 1; }
        }
        x += bw + r() * 8;
      }
    }
    if (azrieli) {
      const base = h;
      const cx = w * 0.42;
      g.fillStyle = '#1c2033';
      // round, triangle, square towers
      g.fillRect(cx - 150, base - h * 0.78, 90, h * 0.78);
      g.beginPath(); g.moveTo(cx, base); g.lineTo(cx + 45, base - h * 0.74); g.lineTo(cx + 90, base); g.fill();
      g.fillRect(cx + 140, base - h * 0.66, 85, h * 0.66);
      g.fillStyle = windowColor;
      for (let yy = base - h * 0.75; yy < base; yy += 14) {
        for (let xx = cx - 146; xx < cx - 64; xx += 10) if (r() < 0.4) g.fillRect(xx, yy, 5, 7);
        for (let xx = cx + 146; xx < cx + 222; xx += 10) if (r() < 0.4 && yy > base - h * 0.64) g.fillRect(xx, yy, 5, 7);
      }
      g.fillStyle = '#ff3355';
      g.fillRect(cx - 108, base - h * 0.79, 6, 6);
    }
  });
}

export function crowd(seed: number, tint: string) {
  return canvasTex(2048, 512, (g, w, h) => {
    g.fillStyle = '#05050a'; g.fillRect(0, 0, w, h);
    const r = rnd(seed);
    for (let row = 0; row < 5; row++) {
      const y = h * 0.25 + row * 60;
      for (let x = -20; x < w; x += 26 + r() * 10) {
        const s = 0.8 + r() * 0.4 + row * 0.12;
        g.fillStyle = `rgba(${20 + r() * 40},${20 + r() * 30},${30 + r() * 50},1)`;
        g.beginPath(); g.arc(x, y, 12 * s, 0, Math.PI * 2); g.fill();
        g.fillRect(x - 16 * s, y + 10 * s, 32 * s, 60 * s);
        if (r() < 0.12) {
          g.fillStyle = r() < 0.5 ? tint : '#ffffff';
          g.shadowColor = g.fillStyle as string; g.shadowBlur = 12;
          g.fillRect(x + 8, y - 40 - r() * 20, 5, 34);
          g.shadowBlur = 0;
        }
        if (r() < 0.05) { g.fillStyle = '#ffffff'; g.shadowColor = '#fff'; g.shadowBlur = 10; g.fillRect(x - 4, y - 10, 8, 12); g.shadowBlur = 0; }
      }
    }
  });
}

export function screenTex(title: string, sub: string, bg: string, fg: string, accent: string) {
  return canvasTex(1024, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, bg); grd.addColorStop(1, '#000');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = accent; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = accent; g.shadowBlur = 30;
    g.font = '900 150px "Bebas Neue", Impact, sans-serif';
    g.fillText(title, w / 2, h * 0.44);
    g.shadowBlur = 0;
    g.font = '700 54px "Heebo", Arial, sans-serif';
    g.fillStyle = accent;
    g.fillText(sub, w / 2, h * 0.78);
    for (let y = 0; y < h; y += 4) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y, w, 2); }
  });
}

export function liveBadge() {
  return canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#e91916'; roundRect(g, 0, 0, w, h, 30); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(80, h / 2, 26, 0, Math.PI * 2); g.fill();
    g.font = '900 110px "Bebas Neue", Impact, sans-serif'; g.textBaseline = 'middle'; g.fillText('LIVE', 140, h / 2 + 6);
  });
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

export function plaque(kind: 'silver' | 'gold' | 'diamond', name: string) {
  const col = kind === 'silver' ? ['#f2f2f2', '#9aa0a6'] : kind === 'gold' ? ['#ffe38a', '#b8860b'] : ['#e8fbff', '#7fd6ff'];
  return canvasTex(512, 640, (g, w, h) => {
    g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, col[0]); grd.addColorStop(0.5, col[1]); grd.addColorStop(1, col[0]);
    g.fillStyle = grd; roundRect(g, 60, 70, w - 120, 340, 60); g.fill();
    g.fillStyle = '#111';
    g.beginPath(); g.moveTo(w / 2 - 50, 170); g.lineTo(w / 2 + 70, 240); g.lineTo(w / 2 - 50, 310); g.closePath(); g.fill();
    g.fillStyle = col[0]; g.textAlign = 'center'; g.font = '700 44px "Heebo", Arial';
    g.fillText(name, w / 2, 500);
    g.font = '400 26px Arial'; g.fillText(kind === 'diamond' ? '10,000,000 SUBSCRIBERS' : kind === 'gold' ? '1,000,000 SUBSCRIBERS' : '100,000 SUBSCRIBERS', w / 2, 560);
  });
}

export function rackTex() {
  return canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#0c0c12'; g.fillRect(0, 0, w, h);
    const r = rnd(9);
    for (let y = 10; y < h - 10; y += 44) {
      g.fillStyle = '#1b1b26'; g.fillRect(12, y, w - 24, 38);
      g.fillStyle = '#2a2a38'; g.fillRect(16, y + 4, w - 32, 4);
      for (let k = 0; k < 6; k++) {
        const c = r() < 0.6 ? '#39ff88' : r() < 0.5 ? '#b14dff' : '#ff3355';
        g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 8;
        g.fillRect(24 + k * 12, y + 20, 6, 6);
        g.shadowBlur = 0;
      }
      g.fillStyle = '#101018';
      for (let v = 110; v < w - 20; v += 8) g.fillRect(v, y + 12, 4, 20);
    }
  });
}

export function posterTex(title: string, color: string) {
  return canvasTex(256, 360, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, color); grd.addColorStop(1, '#0b0b10');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '900 64px "Bebas Neue", Impact'; g.textAlign = 'center';
    g.fillText(title, w / 2, h * 0.8);
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(12, 12, w - 24, h - 24);
  });
}

export function radialGlow(color: string) {
  return canvasTex(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, color); grd.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.35)')); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}
