// Dev helper: capture the WebGL canvas (and a simplified overlay of visible UI text) to tools/shots/<name>.jpg
export async function devShot(name: string, render: () => void, w = 1280) {
  const src = document.getElementById('gl') as HTMLCanvasElement;
  render();
  const h = Math.round((w * src.height) / src.width);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.filter = getComputedStyle(src).filter || 'none';
  g.drawImage(src, 0, 0, w, h);
  g.filter = 'none';
  const url = c.toDataURL('image/jpeg', 0.85);
  await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
  return url.length;
}
