let uid = 0;

/** STREAM KOMBAT 26 logo: stone letters with gold bevel, crowned by a row of broadcast antennas. */
export function logoSvg(): string {
  const id = 'lg' + uid++;
  const antennas = [-3, -2, -1, 0, 1, 2, 3].map((i) => {
    const x = 380 + i * 58;
    const hgt = 118 - Math.abs(i) * 6;
    const top = 150 - hgt;
    const col = i === 0 ? '#ff2a2a' : i % 2 ? '#53fc18' : '#b56bff';
    return `
      <rect x="${x - 7}" y="${top + 16}" width="14" height="${hgt - 10}" rx="4" fill="url(#${id}bronze)" stroke="#3a1f06" stroke-width="2"/>
      <path d="M${x - 16} ${top + 20} L${x} ${top - 4} L${x + 16} ${top + 20} Z" fill="url(#${id}bronze)" stroke="#3a1f06" stroke-width="2"/>
      <circle cx="${x}" cy="${top - 8}" r="${i === 0 ? 9 : 6}" fill="${col}" filter="url(#${id}glow)"/>
      <path d="M${x - 14} ${top - 18} Q${x} ${top - 32} ${x + 14} ${top - 18}" stroke="${col}" stroke-width="3" fill="none" opacity=".8"/>
      <path d="M${x - 22} ${top - 24} Q${x} ${top - 44} ${x + 22} ${top - 24}" stroke="${col}" stroke-width="2.5" fill="none" opacity=".45"/>`;
  }).join('');
  const word = (t: string, y: number, size: number, spacing = 6) => `
    <text x="380" y="${y}" text-anchor="middle" font-family="Cinzel, serif" font-weight="900" font-size="${size}" letter-spacing="${spacing}"
      fill="url(#${id}stone)" stroke="url(#${id}gold)" stroke-width="5" paint-order="stroke" filter="url(#${id}bevel)">${t}</text>`;
  return `
  <svg viewBox="0 0 760 490" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${id}stone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f7f3ec"/><stop offset=".32" stop-color="#cdc5b8"/><stop offset=".52" stop-color="#857d71"/>
        <stop offset=".7" stop-color="#d9d2c6"/><stop offset="1" stop-color="#5f584f"/>
      </linearGradient>
      <linearGradient id="${id}gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff4c8"/><stop offset=".4" stop-color="#e2a948"/><stop offset=".7" stop-color="#8a5418"/><stop offset="1" stop-color="#f6d27a"/>
      </linearGradient>
      <linearGradient id="${id}bronze" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#6b3f12"/><stop offset=".45" stop-color="#f3c572"/><stop offset=".6" stop-color="#b8782c"/><stop offset="1" stop-color="#4a2808"/>
      </linearGradient>
      <filter id="${id}bevel" x="-10%" y="-20%" width="120%" height="150%">
        <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="3" result="noise"/>
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .35 0" result="grain"/>
        <feComposite in="grain" in2="SourceAlpha" operator="in" result="grainIn"/>
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="blur"/>
        <feSpecularLighting in="blur" surfaceScale="5" specularConstant="1.1" specularExponent="22" lighting-color="#fff6e0" result="spec">
          <fePointLight x="-120" y="-260" z="260"/>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>
        <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3=".75" k4="0" result="lit"/>
        <feComposite in="lit" in2="grainIn" operator="arithmetic" k1="0" k2="1" k3="-.6" k4="0" result="gritty"/>
        <feDropShadow in="gritty" dx="0" dy="7" stdDeviation="3" flood-color="#140800" flood-opacity=".9" result="shadow"/>
        <feDropShadow in="shadow" dx="0" dy="0" stdDeviation="14" flood-color="#ff8a2a" flood-opacity=".38"/>
      </filter>
      <filter id="${id}glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path d="M190 160 Q380 196 570 160 L566 176 Q380 212 194 176 Z" fill="url(#${id}bronze)" stroke="#3a1f06" stroke-width="2"/>
    ${antennas}
    ${word('STREAM', 262, 118, 8)}
    ${word('KOMBAT', 378, 122, 8)}
    ${word('26', 478, 118, 4)}
    <path d="M300 424 L330 424 M430 424 L460 424" stroke="url(#${id}gold)" stroke-width="5"/>
    <path d="M380 488 L360 458 L400 458 Z" fill="url(#${id}bronze)"/>
  </svg>`;
}

export function logoEl(cls = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'logo ' + cls;
  d.innerHTML = logoSvg();
  return d;
}
