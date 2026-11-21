/* Workforce office preview B: flat SVG illustration. Plain JS, no libraries. */
(() => {
'use strict';
const W = 1600, H = 1000, LANE = 515, SPEED = 270;
const $ = (s) => document.querySelector(s);
const svg = $('#office');
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const SANS = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- people & places ---------- */
const PEOPLE = {
  simha: { name: 'Simha', sign: '♌', role: 'Lead', shirt: '#e3a52f', shirt2: '#c98b1c', hair: '#3b2a20', skin: '#e2b48c', style: 'short', pants: '#3f4a5f' },
  mesha: { name: 'Mesha', sign: '♈', role: 'Worker', shirt: '#f0705d', shirt2: '#d85a48', hair: '#2a1d1a', skin: '#f0c7a4', style: 'long', pants: '#38425a' },
  kanya: { name: 'Kanya', sign: '♍', role: 'Worker', shirt: '#22a48e', shirt2: '#178a76', hair: '#5a3424', skin: '#c99470', style: 'bun', pants: '#3a4558' },
};
// cabins: x, width, row ('top' glass at y=420, 'bot' glass at y=610), door x, desk centre
const CABINS = {
  ceo:   { x: 40,  w: 440, row: 'top', door: 420, desk: 250, label: 'You (CEO)', color: '#4f6bed' },
  simha: { x: 500, w: 300, row: 'top', door: 560, desk: 660, label: 'Simha ♌ Lead', color: '#e3a52f' },
  mesha: { x: 40,  w: 320, row: 'bot', door: 92,  desk: 215, label: 'Mesha ♈ Worker', color: '#f0705d' },
  kanya: { x: 380, w: 320, row: 'bot', door: 432, desk: 555, label: 'Kanya ♍ Worker', color: '#22a48e' },
};
const ROW = { top: { glass: 420, mon: 96, desk: 158, seat: 264 }, bot: { glass: 610, mon: 634, desk: 696, seat: 802 } };
const LOC = {
  ceo:   { door: [420, 420], visit: [345, 300] },
  simha: { door: [560, 420], seat: [660, 264], visit: [762, 300] },
  mesha: { door: [92, 610],  seat: [215, 802], visit: [312, 842] },
  kanya: { door: [432, 610], seat: [555, 802], visit: [652, 842] },
  plan:  { visit: [1020, 372] },
  gate:  { visit: [1505, 420] },
  lounge:{ visit: [1210, 720], coffee: [1430, 872], sofa: [880, 760], w1: [1000, 690], w2: [1290, 800], w3: [1120, 860] },
};

/* ---------- svg helpers ---------- */
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const grp = (parent, html, attrs) => { const g = el('g', attrs, parent); if (html) g.innerHTML = html; return g; };
const R = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const T = (x, y, txt, extra = '') => `<text x="${x}" y="${y}" ${extra}>${esc(txt)}</text>`;

svg.innerHTML = `<defs>
<linearGradient id="gFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f5f1"/><stop offset="1" stop-color="#efebe4"/></linearGradient>
<linearGradient id="gWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1ede7"/><stop offset="1" stop-color="#e2dcd3"/></linearGradient>
<linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcdcf2"/><stop offset="1" stop-color="#eaf4fb"/></linearGradient>
<linearGradient id="gGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe6f3" stop-opacity=".55"/><stop offset="1" stop-color="#e4f1f8" stop-opacity=".25"/></linearGradient>
<linearGradient id="gWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efdcc2"/><stop offset="1" stop-color="#e2c7a4"/></linearGradient>
<linearGradient id="gWoodF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d3b48c"/><stop offset="1" stop-color="#c4a37a"/></linearGradient>
<linearGradient id="gScreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3550"/><stop offset="1" stop-color="#1b2335"/></linearGradient>
<linearGradient id="gLounge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6eee2"/><stop offset="1" stop-color="#f0e5d5"/></linearGradient>
<linearGradient id="gGate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ff" stop-opacity=".9"/><stop offset="1" stop-color="#eef1ff" stop-opacity=".2"/></linearGradient>
<radialGradient id="gLeaf" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#7fc79a"/><stop offset="1" stop-color="#3f9466"/></radialGradient>
<filter id="fSh" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#5a4a30" flood-opacity=".15"/></filter>
<filter id="fSm" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#3a3020" flood-opacity=".16"/></filter>
</defs>`;
const world = grp(svg, '', { id: 'world' });
const lFloor = grp(world), lFurn = grp(world), lActors = grp(world), lFx = grp(world);

/* ---------- static art ---------- */
function plant(x, y, s = 1, pot = '#e8e2d8') {
  return `<g transform="translate(${x},${y}) scale(${s})" filter="url(#fSm)">
    <ellipse cx="0" cy="-34" rx="20" ry="22" fill="url(#gLeaf)"/><ellipse cx="-14" cy="-22" rx="12" ry="14" fill="#55a878"/>
    <ellipse cx="13" cy="-24" rx="12" ry="13" fill="#4b9d6e"/><ellipse cx="2" cy="-48" rx="10" ry="11" fill="#8fd1a7"/>
    <path d="M-13,-12 L13,-12 L10,8 Q0,12 -10,8 Z" fill="${pot}"/><rect x="-14" y="-15" width="28" height="5" rx="2.5" fill="#d9d1c4"/></g>`;
}
function chair(x, y, c = '#5d6577') {
  return `<g transform="translate(${x},${y})"><ellipse cx="0" cy="10" rx="18" ry="6" fill="rgba(60,50,30,.12)"/>
    <rect x="-17" y="-8" width="34" height="16" rx="7" fill="${c}"/><rect x="-14" y="-30" width="28" height="22" rx="7" fill="${c}" opacity=".92"/>
    <rect x="-10" y="-27" width="20" height="4" rx="2" fill="#fff" opacity=".12"/></g>`;
}
function desk(cx, y, w) {
  return `<g filter="url(#fSh)"><rect x="${cx - w / 2}" y="${y}" width="${w}" height="40" rx="7" fill="url(#gWood)"/>
    <rect x="${cx - w / 2}" y="${y + 34}" width="${w}" height="16" rx="5" fill="url(#gWoodF)"/></g>
    <rect x="${cx - 26}" y="${y + 20}" width="52" height="9" rx="3" fill="#f7f7f9" stroke="#d8d8de"/>
    <rect x="${cx + w / 2 - 34}" y="${y + 12}" width="11" height="13" rx="3" fill="#fff" stroke="#e3ddd3"/>`;
}
function monitor(id, cx, y, w = 172) {
  return `<g filter="url(#fSh)"><rect x="${cx - 7}" y="${y + 58}" width="14" height="16" fill="#9aa1ae"/><ellipse cx="${cx}" cy="${y + 76}" rx="24" ry="5" fill="#a9afbb"/>
    <rect x="${cx - w / 2}" y="${y}" width="${w}" height="62" rx="7" fill="#313849"/></g>
    <rect x="${cx - w / 2 + 5}" y="${y + 5}" width="${w - 10}" height="52" rx="4" fill="url(#gScreen)"/>
    <g id="scr-${id}"><text class="l1" x="${cx - w / 2 + 13}" y="${y + 22}" font-family="${MONO}" font-size="9.5" fill="#9fb3d9"></text>
    <text class="l2" x="${cx - w / 2 + 13}" y="${y + 36}" font-family="${MONO}" font-size="10.5" font-weight="600" fill="#eef3ff"></text>
    <g class="code" opacity="0">${[0, 1, 2].map((i) => `<rect class="cl" x="${cx - w / 2 + 13}" y="${y + 43 + i * 0}" height="3" rx="1.5" fill="${['#7fd1b9', '#f3c36b', '#9db8ff'][i]}" width="20"/>`).join('')}</g>
    <rect class="cur" x="${cx - w / 2 + 13}" y="${y + 41}" width="5" height="9" fill="#eef3ff" opacity="0"/></g>`;
}
function cabinArt(id) {
  const c = CABINS[id], r = ROW[c.row], top = c.row === 'top';
  const y0 = top ? 20 : 610, y1 = top ? 420 : 985;
  let s = R(c.x, y0, c.w, y1 - y0, top ? '#f4f2ee' : '#f3f1ed');
  s += `<rect x="${c.x + 24}" y="${top ? 212 : 762}" width="${c.w - 48}" height="${top ? 160 : 150}" rx="22" fill="${c.color}" opacity=".08"/>`;
  if (top) { // back wall with a window
    s += R(c.x, 20, c.w, 76, 'url(#gWall)') + R(c.x, 94, c.w, 4, '#d8d1c6');
    s += `<rect x="${c.x + 22}" y="32" width="${c.w - 44}" height="48" rx="6" fill="url(#gSky)" stroke="#fff" stroke-width="3"/>`;
    s += `<path d="M${c.x + 40},80 L${c.x + 90},32 L${c.x + 110},32 L${c.x + 60},80Z" fill="#fff" opacity=".35"/>`;
  } else s += R(c.x, 958, c.w, 27, '#e4ded5');
  s += `<g id="pick-${id}" data-pick="${id}" class="pickable">` + R(c.x, y0, c.w, y1 - y0, 'transparent') + '</g>';
  s += desk(c.desk, r.desk, id === 'ceo' ? 250 : 200) + monitor(id, c.desk, r.mon, id === 'ceo' ? 190 : 172);
  s += chair(c.desk, r.seat, id === 'ceo' ? '#4f6bed' : '#5d6577');
  if (id === 'ceo') {
    s += `<g filter="url(#fSh)"><rect x="70" y="260" width="58" height="120" rx="14" fill="#c9cfdc"/><rect x="78" y="268" width="42" height="104" rx="10" fill="#d8dde8"/></g>`;
    s += plant(445, 150, 1.05) + plant(95, 175, .8);
    s += `<g filter="url(#fSm)"><rect x="410" y="250" width="44" height="44" rx="22" fill="#fff"/><circle cx="432" cy="272" r="13" fill="#f3efe8"/></g>`;
  } else s += plant(c.x + c.w - 34, top ? 160 : 950, .78) + `<g filter="url(#fSm)"><rect x="${c.x + 22}" y="${top ? 150 : 700}" width="44" height="64" rx="5" fill="#e8e1d6"/>` +
    [0, 1, 2].map((i) => R(c.x + 27 + i * 12, (top ? 158 : 708), 9, 22, ['#f0705d', '#e3a52f', '#4f6bed'][i], 'rx="2"')).join('') +
    [0, 1].map((i) => R(c.x + 27 + i * 14, (top ? 186 : 736), 11, 22, ['#22a48e', '#9aa1ae'][i], 'rx="2"')).join('') + '</g>';
  return s;
}
function glassArt(id) {
  const c = CABINS[id], gy = ROW[c.row].glass, x0 = c.x, x1 = c.x + c.w, d0 = c.door - 30, d1 = c.door + 30;
  const pane = (a, b) => {
    let s = `<rect x="${a}" y="${gy - 46}" width="${b - a}" height="46" fill="url(#gGlass)"/>`;
    for (let m = a + 70; m < b - 20; m += 70) s += R(m, gy - 46, 2, 46, '#ffffff', 'opacity=".75"');
    s += `<path d="M${a + 18},${gy} L${a + 44},${gy - 46} L${a + 58},${gy - 46} L${a + 32},${gy}Z" fill="#fff" opacity=".38"/>`;
    return s;
  };
  let s = pane(x0, d0) + pane(d1, x1);
  s += R(x0, gy - 49, d0 - x0, 4, '#cdd4dd', 'rx="2"') + R(d1, gy - 49, x1 - d1, 4, '#cdd4dd', 'rx="2"');
  s += R(x0, gy - 2, d0 - x0, 4, '#bfc6d0') + R(d1, gy - 2, x1 - d1, 4, '#bfc6d0');
  s += R(d0 - 3, gy - 50, 5, 52, '#b9c1cc', 'rx="2"') + R(d1 - 2, gy - 50, 5, 52, '#b9c1cc', 'rx="2"');
  const nx = id === 'mesha' || id === 'kanya' ? d1 + 14 : x0 + 16, nw = Math.max(108, c.label.length * 6.6 + 30);
  s += `<g data-pick="${id}" class="pickable" filter="url(#fSm)"><rect x="${nx}" y="${gy - 37}" width="${nw}" height="22" rx="7" fill="#fff"/>
    <circle id="light-${id}" cx="${nx + 12}" cy="${gy - 26}" r="4.5" fill="#b4b8c2"/>
    ${T(nx + 22, gy - 22, c.label, `font-family="${SANS}" font-size="11.5" font-weight="600" fill="#2b2f3a"`)}</g>`;
  return s;
}
function planWallArt() {
  let s = R(810, 20, 430, 400, '#f5f3ef') + R(810, 20, 430, 76, 'url(#gWall)') + R(810, 94, 430, 4, '#d8d1c6');
  s += `<g filter="url(#fSh)"><rect x="842" y="60" width="366" height="236" rx="10" fill="#fff"/></g>`;
  s += T(860, 82, 'Plan', `font-family="${SANS}" font-size="13" font-weight="700" fill="#2b2f3a"`);
  ['To do', 'Working', 'Review', 'Done'].forEach((n, i) => {
    const x = 852 + i * 88;
    s += `<rect x="${x}" y="92" width="82" height="194" rx="7" fill="${i === 3 ? '#eef8f2' : '#f5f4f1'}"/>`;
    s += T(x + 8, 108, n, `font-family="${SANS}" font-size="10.5" font-weight="600" fill="#7a7f8c"`);
  });
  s += plant(1215, 404, .9);
  return s;
}
function gateArt() {
  let s = R(1240, 20, 340, 400, '#f3f2f6') + R(1240, 20, 340, 76, 'url(#gWall)') + R(1240, 94, 340, 4, '#d8d1c6');
  s += `<rect x="1262" y="196" width="296" height="196" rx="30" fill="#4f6bed" opacity=".05"/>`;
  s += T(1410, 70, 'Review gate', `text-anchor="middle" font-family="${SANS}" font-size="13" font-weight="700" fill="#4a4f5c"`);
  s += T(1410, 86, 'the owner merges here', `text-anchor="middle" font-family="${SANS}" font-size="10" fill="#9a9fab"`);
  return s;
}
function gateFront() { // posts + beam + tray, drawn in actor layer
  return `<g filter="url(#fSh)"><rect x="1318" y="128" width="16" height="210" rx="6" fill="#dfe3ec"/><rect x="1486" y="128" width="16" height="210" rx="6" fill="#dfe3ec"/>
    <rect x="1304" y="118" width="212" height="26" rx="10" fill="#fff"/></g>
    <rect x="1334" y="146" width="152" height="190" fill="url(#gGate)"/>
    <circle id="gateLight" cx="1410" cy="131" r="6" fill="#c9cede"/>
    <g filter="url(#fSh)"><rect x="1340" y="336" width="140" height="22" rx="8" fill="#eceef4"/><rect x="1340" y="352" width="140" height="10" rx="4" fill="#d4d8e2"/></g>`;
}
function loungeArt() {
  let s = R(720, 610, 860, 375, 'url(#gLounge)') + R(720, 958, 860, 27, '#e4ded5');
  s += `<ellipse cx="1110" cy="790" rx="190" ry="90" fill="#e9dcc6" opacity=".7"/><ellipse cx="1110" cy="790" rx="150" ry="66" fill="none" stroke="#fff" stroke-width="3" opacity=".6"/>`;
  s += `<g filter="url(#fSh)"><ellipse cx="1110" cy="772" rx="46" ry="26" fill="#fff"/><rect x="1104" y="772" width="12" height="28" fill="#d9d3c8"/></g>`;
  s += `<circle cx="1098" cy="766" r="6" fill="#f0705d" opacity=".75"/><circle cx="1124" cy="770" r="6" fill="#4f6bed" opacity=".6"/>`;
  s += T(745, 640, 'Lounge', `font-family="${SANS}" font-size="13" font-weight="700" fill="#b39a7a"`);
  s += plant(745, 700, .9) + plant(1555, 690, 1.1) + plant(1015, 945, .8);
  return s;
}
function loungeFront() { // sofa + coffee counter (actors, so people stand behind them)
  return `<g filter="url(#fSh)"><rect x="770" y="880" width="210" height="66" rx="20" fill="#9fb0d8"/><rect x="782" y="852" width="186" height="44" rx="16" fill="#b6c4e4"/>
      <rect x="770" y="872" width="34" height="70" rx="15" fill="#8d9fcb"/><rect x="946" y="872" width="34" height="70" rx="15" fill="#8d9fcb"/></g>
    <rect x="814" y="866" width="54" height="22" rx="10" fill="#f3c36b" opacity=".9"/>
    <g filter="url(#fSh)"><rect x="1330" y="890" width="220" height="64" rx="10" fill="#fff"/><rect x="1330" y="934" width="220" height="20" rx="6" fill="#e8e2d8"/>
      <rect x="1400" y="842" width="52" height="66" rx="9" fill="#3a4254"/><rect x="1408" y="850" width="36" height="16" rx="4" fill="#58627a"/></g>
    <circle cx="1440" cy="858" r="3" fill="#7fe0b0"/><rect x="1418" y="884" width="16" height="15" rx="3" fill="#fff"/>
    <g id="steam" opacity="0"><path d="M1422,878 q-5,-8 0,-15 q5,-7 0,-14" stroke="#c9ccd4" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M1431,878 q-5,-8 0,-15 q5,-7 0,-14" stroke="#c9ccd4" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>
    ${T(1480, 925, 'Coffee', `font-family="${SANS}" font-size="11" font-weight="600" fill="#b39a7a"`)}
    <g filter="url(#fSm)"><rect x="1490" y="876" width="34" height="18" rx="5" fill="#e3a52f" opacity=".85"/></g>`;
}
// floor: building, corridor runner
lFloor.innerHTML = `<rect x="10" y="10" width="1580" height="985" rx="26" fill="#e7e2da"/>
  <rect x="20" y="20" width="1560" height="965" rx="20" fill="url(#gFloor)"/>
  <rect x="20" y="420" width="1560" height="190" fill="#f1eee8"/>
  <rect x="60" y="490" width="1480" height="50" rx="25" fill="#ebe6dd"/>
  ${Array.from({ length: 19 }, (_, i) => `<rect x="${100 + i * 76}" y="513" width="26" height="4" rx="2" fill="#fff" opacity=".8"/>`).join('')}
  ${plant(1555, 455, .75)}`;
lFurn.innerHTML = Object.keys(CABINS).map(cabinArt).join('') + planWallArt() + gateArt() + loungeArt() +
  [490, 810].map((x) => R(x - 6, 20, 12, 400, '#e2dcd3', 'rx="3"')).join('') + [370, 710].map((x) => R(x - 6, 610, 12, 375, '#e2dcd3', 'rx="3"')).join('');
const notesLayer = grp(lFurn, '', { id: 'notes' });

/* ---------- depth-sorted actors ---------- */
const actors = [];
const addActor = (html, base, attrs) => { const g = grp(lActors, html, attrs); actors.push({ g, base: () => base }); return g; };
Object.keys(CABINS).forEach((id) => addActor(glassArt(id), ROW[CABINS[id].row].glass));
addActor(gateFront(), 362);
const trayG = addActor('', 363);
addActor(loungeFront(), 955);
let lastOrder = '';
function sortActors() {
  actors.sort((a, b) => a.base() - b.base());
  const order = actors.map((a) => a.base() | 0).join(',');
  if (order !== lastOrder) { lastOrder = order; actors.forEach((a) => lActors.appendChild(a.g)); }
}

/* ---------- characters ---------- */
function hairPaths(style) {
  if (style === 'long') return {
    front: 'M-12.5,-49 C-14,-66 14,-66 12.5,-49 L12.5,-35 C10,-33 8.6,-36 8.8,-41 L8.8,-52 C4,-56 -4,-56 -8.8,-52 L-8.8,-41 C-8.6,-36 -10,-33 -12.5,-35Z',
    back: 'M-12.5,-50 C-14,-66 14,-66 12.5,-50 L12.5,-33 C6,-30 -6,-30 -12.5,-33Z' };
  if (style === 'bun') return {
    front: 'M-11.8,-49 C-13,-64 13,-64 11.8,-49 C9,-55 3,-57 -1,-55 C-5,-57 -10,-54 -11.8,-49Z M0,-70 a6,6 0 1,0 0.1,0Z',
    back: 'M-12,-50 C-13,-64 13,-64 12,-50 C12,-42 -12,-42 -12,-50Z M0,-70 a6,6 0 1,0 0.1,0Z' };
  return {
    front: 'M-11.6,-50 C-13,-63 -3,-65 1,-64 C8,-64 13,-60 11.6,-50 C9,-55 4,-56.5 0,-55.5 C-4,-56 -9,-54 -11.6,-50Z',
    back: 'M-11.8,-50 C-12.5,-64 12.5,-64 11.8,-50 C11,-43 -11,-43 -11.8,-50Z' };
}
const people = {};
function makePerson(id) {
  const P = PEOPLE[id], hp = hairPaths(P.style);
  const g = grp(null, `
    <ellipse class="ring" cx="0" cy="0" rx="22" ry="8" fill="none" stroke="${P.shirt}" stroke-width="2.5" opacity="0"/>
    <ellipse cx="0" cy="0" rx="15" ry="5" fill="rgba(50,40,30,.18)"/>
    <g class="body">
      <g class="stand">
        <g class="legL"><rect x="-8" y="-21" width="7" height="21" rx="3.5" fill="${P.pants}"/><ellipse cx="-4.5" cy="-1" rx="5" ry="3" fill="#2b2f3a"/></g>
        <g class="legR"><rect x="1" y="-21" width="7" height="21" rx="3.5" fill="${P.pants}"/><ellipse cx="4.5" cy="-1" rx="5" ry="3" fill="#2b2f3a"/></g>
      </g>
      <g class="up">
        <g class="armL"><rect x="-16" y="-39" width="6" height="19" rx="3" fill="${P.shirt2}"/><circle cx="-13" cy="-20" r="3.4" fill="${P.skin}"/></g>
        <g class="armR"><rect x="10" y="-39" width="6" height="19" rx="3" fill="${P.shirt2}"/><circle cx="13" cy="-20" r="3.4" fill="${P.skin}"/></g>
        <rect x="-11.5" y="-41" width="23" height="25" rx="9" fill="${P.shirt}"/>
        <rect class="neck" x="-3.5" y="-44" width="7" height="5" fill="${P.skin}"/>
        <circle cx="0" cy="-51" r="11.5" fill="${P.skin}"/>
        <g class="face"><ellipse class="eL" cx="-4" cy="-50" rx="1.5" ry="1.6" fill="#2b2f3a"/><ellipse class="eR" cx="4" cy="-50" rx="1.5" ry="1.6" fill="#2b2f3a"/>
          <circle cx="-7" cy="-46" r="2" fill="#f08c7a" opacity=".35"/><circle cx="7" cy="-46" r="2" fill="#f08c7a" opacity=".35"/>
          <path d="M-2.5,-45.5 Q0,-43.5 2.5,-45.5" stroke="#8a4a3a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
          <path class="hf" d="${hp.front}" fill="${P.hair}"/></g>
        <path class="hb" d="${hp.back}" fill="${P.hair}" display="none"/>
        <g class="parcel" display="none" filter="url(#fSm)"><rect x="-15" y="-33" width="30" height="20" rx="3" fill="#f3c36b"/><rect x="-15" y="-33" width="30" height="6" rx="3" fill="#e8ad45"/>
          <text x="0" y="-17" text-anchor="middle" font-family="${SANS}" font-size="7.5" font-weight="700" fill="#6b4a10"></text></g>
      </g>
      <rect class="back" x="-15" y="-27" width="30" height="21" rx="7" fill="#5d6577" display="none"/>
    </g>
    <g class="tag" transform="translate(0,-82)"><rect x="-27" y="-9" width="54" height="17" rx="8.5" fill="#fff" opacity=".95" filter="url(#fSm)"/>
      <circle cx="-17" cy="-0.5" r="3.5" fill="${P.shirt}"/>${T(-10, 3.5, `${P.name} ${P.sign}`, `font-family="${SANS}" font-size="9.5" font-weight="600" fill="#2b2f3a"`)}</g>
    <rect x="-20" y="-80" width="40" height="84" fill="transparent"/>`, { 'data-pick': id, class: 'pickable person' });
  const q = (s) => g.querySelector(s);
  const p = { id, ...P, g, x: 0, y: 0, pose: 'sit', loc: id, phase: 0, face: 1, back: true, moving: null, typing: false, carry: null,
    parts: { stand: q('.stand'), legL: q('.legL'), legR: q('.legR'), armL: q('.armL'), armR: q('.armR'), up: q('.up'), face: q('.face'),
      hb: q('.hb'), back: q('.back'), body: q('.body'), parcel: q('.parcel'), ptxt: q('.parcel text'), tag: q('.tag'), eL: q('.eL'), eR: q('.eR') },
    status: 'idle', task: '—', history: [], term: [] };
  lActors.appendChild(g);
  actors.push({ g, base: () => p.y + (p.pose === 'sit' ? 4 : 0) });
  people[id] = p;
  return p;
}
Object.keys(PEOPLE).forEach(makePerson);

function drawPerson(p, t) {
  const k = p.parts, sit = p.pose === 'sit', walking = !!p.moving;
  p.g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
  k.stand.setAttribute('display', sit ? 'none' : '');
  k.back.setAttribute('display', sit ? '' : 'none');
  const back = sit || p.back;
  k.face.setAttribute('display', back ? 'none' : '');
  k.hb.setAttribute('display', back ? '' : 'none');
  k.parcel.setAttribute('display', p.carry ? '' : 'none');
  const sw = walking ? Math.sin(p.phase) * 26 : 0;
  k.legL.setAttribute('transform', `rotate(${sw.toFixed(1)},-4.5,-21)`);
  k.legR.setAttribute('transform', `rotate(${(-sw).toFixed(1)},4.5,-21)`);
  let aL = -sw * 0.8, aR = sw * 0.8;
  if (p.carry) aL = aR = 0;
  if (sit && p.typing) { aL = 8 + Math.sin(t * 22) * 6; aR = -8 - Math.sin(t * 22 + 1.7) * 6; }
  k.armL.setAttribute('transform', `rotate(${aL.toFixed(1)},-13,-37)`);
  k.armR.setAttribute('transform', `rotate(${aR.toFixed(1)},13,-37)`);
  const bob = walking ? -Math.abs(Math.cos(p.phase)) * 2 : Math.sin(t * 2 + p.x) * 0.6;
  k.up.setAttribute('transform', `translate(0,${(sit ? 10 : 0) + bob})`);
  k.tag.setAttribute('transform', `translate(0,${sit ? -72 : -82})`);
  k.body.setAttribute('transform', p.face < 0 ? 'scale(-1,1)' : '');
  const blink = (t + p.x * 0.01) % 4 < 0.12 ? 0.3 : 1;
  k.eL.setAttribute('ry', 1.6 * blink); k.eR.setAttribute('ry', 1.6 * blink);
  k.face.setAttribute('transform', walking ? 'translate(1.2,0)' : '');
}

/* ---------- game-time scheduler (pauses with the tab) ---------- */
let now = 0, runId = 0, focus = null, autoCam = true;
const timers = [];
class Cancel extends Error {}
const guard = (id) => { if (id !== runId) throw new Cancel(); };
const wait = (ms) => { const id = runId; return new Promise((res) => timers.push({ at: now + ms, res })).then(() => guard(id)); };
function tickTimers() {
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= now) { timers[i].res(); timers.splice(i, 1); }
}

/* ---------- movement ---------- */
function route(p, loc, spot) {
  const from = LOC[p.loc], to = LOC[loc], end = spot === 'seat' ? [to.seat[0], to.seat[1] + 14] : (to[spot] || to.visit), pts = [[p.x, p.y]];
  if (p.loc !== loc) {
    const inside = (d) => [d[0], d[1] + (d[1] < 500 ? -28 : 28)];
    if (from.door) pts.push(inside(from.door), from.door, [from.door[0], LANE]); else pts.push([p.x, LANE]);
    if (to.door) pts.push([to.door[0], LANE], to.door, inside(to.door)); else pts.push([end[0], LANE]);
  }
  pts.push(end);
  return pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 0.5);
}
async function walk(p, loc, spot) {
  const id = runId;
  if (p.pose === 'sit') { p.pose = 'stand'; p.typing = false; p.y += 14; await wait(250); }
  const pts = route(p, loc, spot);
  let len = 0; const segs = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); len += l; }
  p.loc = loc; focus = p;
  if (len < 1) return;
  await new Promise((res) => { p.moving = { pts, segs, len, t0: now, dur: Math.max(700, (len / SPEED) * 1000), res, last: 0 }; });
  guard(id);
  p.back = false; p.face = 1;
}
function stepMove(p) {
  const m = p.moving; if (!m) return;
  const u = clamp((now - m.t0) / m.dur, 0, 1), d = ease(u) * m.len;
  let acc = 0, i = 0;
  while (i < m.segs.length - 1 && acc + m.segs[i] < d) acc += m.segs[i++];
  const a = m.pts[i], b = m.pts[i + 1], f = m.segs[i] ? (d - acc) / m.segs[i] : 1;
  p.x = lerp(a[0], b[0], f); p.y = lerp(a[1], b[1], f);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  p.back = dy < -Math.abs(dx) * 0.6; if (Math.abs(dx) > 2) p.face = dx < 0 ? -1 : 1;
  p.phase += (d - m.last) / 7.5; m.last = d;
  if (u >= 1) { p.moving = null; m.res(); }
}
async function sit(p) {
  await walk(p, p.id, 'seat');
  const s = LOC[p.id].seat; p.x = s[0]; p.y = s[1]; p.pose = 'sit'; p.back = true;
}

/* ---------- bubbles, envelope, confetti ---------- */
const bubbles = [];
function say(p, text, ms = 2200) {
  const w = Math.max(44, text.length * 6.4 + 24);
  const g = grp(lFx, `<g class="bin" filter="url(#fSh)"><rect x="${-w / 2}" y="-30" width="${w}" height="26" rx="13" fill="#fff"/>
    <path d="M-6,-5 L0,4 L6,-5Z" fill="#fff"/></g>${T(0, -13, text, `text-anchor="middle" font-family="${SANS}" font-size="11.5" font-weight="500" fill="#2b2f3a"`)}`);
  const b = { p, g, w, born: now, until: ms ? now + ms : Infinity }; focus = p;
  bubbles.push(b);
  logAct(p, `said “${text}”`, false);
  return ms ? wait(ms).then(() => kill(b)) : Promise.resolve(b);
}
function kill(b) { b.until = Math.min(b.until, now); }
function drawBubbles() {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i], p = b.p, age = now - b.born, out = now - b.until;
    if (out > 220) { b.g.remove(); bubbles.splice(i, 1); continue; }
    const s = out > 0 ? 1 - out / 220 : Math.min(1, age / 180), sc = 0.6 + 0.4 * ease(s);
    const x = clamp(p.x, b.w / 2 + 25, W - b.w / 2 - 25), y = p.y - (p.pose === 'sit' ? 82 : 94);
    b.g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${sc.toFixed(3)})`);
    b.g.setAttribute('opacity', s.toFixed(2));
  }
}
const flyers = [];
function envelope(from, to, ms = 1600) {
  const g = grp(lFx, `<g filter="url(#fSh)"><rect x="-14" y="-10" width="28" height="20" rx="3" fill="#fff"/></g><path d="M-14,-9 L0,2 L14,-9" stroke="#4f6bed" stroke-width="1.8" fill="none"/>`);
  return new Promise((res) => flyers.push({ g, from, to, t0: now, ms, res })).then(() => g.remove());
}
function drawFlyers() {
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i], u = clamp((now - f.t0) / f.ms, 0, 1), e = ease(u);
    const x = lerp(f.from[0], f.to[0], e), y = lerp(f.from[1], f.to[1], e) - Math.sin(u * Math.PI) * 90;
    f.g.setAttribute('transform', `translate(${x},${y}) rotate(${Math.sin(u * Math.PI * 2) * 10}) scale(${1 + Math.sin(u * Math.PI) * 0.25})`);
    if (u >= 1) { flyers.splice(i, 1); f.res(); }
  }
}
const confetti = [];
function celebrate(x, y) {
  const cols = ['#f0705d', '#e3a52f', '#22a48e', '#4f6bed', '#f3c36b', '#9db8ff'];
  for (let i = 0; i < 46; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 260 + Math.random() * 260;
    const n = el(i % 3 ? 'rect' : 'circle', i % 3 ? { width: 7, height: 4, rx: 1, fill: cols[i % 6] } : { r: 3, fill: cols[i % 6] }, lFx);
    confetti.push({ n, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 360, vr: (Math.random() - 0.5) * 720, life: 1.6 + Math.random() * 0.6 });
  }
  const ring = el('circle', { cx: x, cy: y, r: 10, fill: 'none', stroke: '#e3a52f', 'stroke-width': 4 }, lFx);
  confetti.push({ ring, t0: now });
}
function drawConfetti(dt) {
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    if (c.ring) { const u = (now - c.t0) / 700; c.ring.setAttribute('r', 10 + u * 90); c.ring.setAttribute('opacity', Math.max(0, 1 - u)); if (u >= 1) { c.ring.remove(); confetti.splice(i, 1); } continue; }
    c.vy += 620 * dt; c.vx *= 0.985; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.life -= dt;
    c.n.setAttribute('transform', `translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${c.r.toFixed(0)})`);
    c.n.setAttribute('opacity', clamp(c.life * 2, 0, 1).toFixed(2));
    if (c.life <= 0) { c.n.remove(); confetti.splice(i, 1); }
  }
}

/* ---------- screens & status ---------- */
const STATUS = { working: ['#2fae7a', 'Working'], waiting: ['#e8a23a', 'Waiting for you'], idle: ['#b4b8c2', 'Idle'], review: ['#4f6bed', 'In review'] };
const screens = {};
Object.keys(CABINS).forEach((id) => { const g = $(`#scr-${id}`); screens[id] = { g, l1: g.querySelector('.l1'), l2: g.querySelector('.l2'), code: g.querySelector('.code'), cls: [...g.querySelectorAll('.cl')], cur: g.querySelector('.cur'), typing: false }; });
function screen(id, l1, l2, typing = false) {
  const s = screens[id]; s.l1.textContent = l1; s.l2.textContent = l2; s.typing = typing;
  s.code.setAttribute('opacity', typing ? 1 : 0);
}
function drawScreens(t) {
  for (const id in screens) {
    const s = screens[id];
    s.cur.setAttribute('opacity', (t * 2) % 1 < 0.5 && (s.typing || id === 'ceo') ? 0.9 : 0);
    if (!s.typing) continue;
    const ws = [0.55, 0.3, 0.75].map((f, i) => 8 + ((t * (30 + i * 11) + i * 40) % 100) * f);
    let x = +s.l1.getAttribute('x');
    s.cls.forEach((r, i) => { r.setAttribute('x', x); r.setAttribute('y', +s.cur.getAttribute('y') + 3); r.setAttribute('width', ws[i].toFixed(0)); x += ws[i] + 5; });
    s.cur.setAttribute('x', x);
  }
}
function setStatus(id, st, task) {
  const p = people[id]; p.status = st; if (task !== undefined) p.task = task;
  $(`#light-${id}`).setAttribute('fill', STATUS[st][0]);
  hud();
}

/* ---------- plan wall notes ---------- */
const notes = {}; let noteSeq = 0;
function addNote(id, title, color) {
  const g = grp(notesLayer, `<g filter="url(#fSm)"><rect x="0" y="0" width="70" height="38" rx="5" fill="${color}"/></g>
    ${T(7, 15, id, `font-family="${SANS}" font-size="10.5" font-weight="700" fill="#2b2f3a"`)}${T(7, 29, title, `font-family="${SANS}" font-size="8.5" fill="#4a4f5c"`)}`);
  notes[id] = { g, col: 0, x: 858, y: 160, s: 0, seq: ++noteSeq };
  logLine(`Plan: ${id} “${title}” added to To do`);
}
function moveNote(id, col) {
  notes[id].col = col; notes[id].seq = ++noteSeq;
  logLine(`Plan: ${id} → ${['To do', 'Working', 'Review', 'Done'][col]}`);
}
function drawNotes(dt) {
  const k = Math.min(1, dt * 5);
  for (const id in notes) {
    const n = notes[id], order = Object.values(notes).filter((o) => o.col === n.col && o.seq < n.seq).length;
    const tx = 858 + n.col * 88, ty = 116 + order * 46;
    n.x = lerp(n.x, tx, k); n.y = lerp(n.y, ty, k); n.s = lerp(n.s, n.gone ? 0 : 1, k);
    n.g.setAttribute('transform', `translate(${n.x.toFixed(1)},${(n.y - Math.abs(tx - n.x) * 0.12).toFixed(1)}) rotate(${((tx - n.x) * 0.06).toFixed(1)},35,19) translate(35,19) scale(${n.s.toFixed(3)}) translate(-35,-19)`);
  }
}

/* ---------- parcels at the gate ---------- */
const tray = {};
function dropParcel(label) {
  const i = Object.keys(tray).length;
  const g = grp(trayG, `<g filter="url(#fSm)"><rect x="-17" y="-20" width="34" height="22" rx="3" fill="#f3c36b"/><rect x="-17" y="-20" width="34" height="6" rx="3" fill="#e8ad45"/></g>
    ${T(0, -3, label, `text-anchor="middle" font-family="${SANS}" font-size="8" font-weight="700" fill="#6b4a10"`)}`, { transform: `translate(${1372 + i * 40},344)` });
  tray[label] = g;
}
async function merge(label) {
  const g = tray[label], id = runId; if (!g) return;
  $('#gateLight').setAttribute('fill', '#2fae7a');
  celebrate(1410, 300);
  g.style.transition = 'opacity .6s'; g.style.opacity = 0;
  await wait(700); guard(id);
  g.remove(); delete tray[label];
  await wait(900);
  $('#gateLight').setAttribute('fill', '#c9cede');
}

/* ---------- HUD: activity, side panel, needs-you ---------- */
const feed = $('#feed');
const clock = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function logLine(text) {
  const li = document.createElement('li');
  li.innerHTML = `<time>${clock()}</time><span>${text}</span>`;
  feed.prepend(li);
  while (feed.children.length > 40) feed.lastChild.remove();
}
function logAct(p, text, toFeed = true) {
  p.history.unshift(text); p.history.length = Math.min(p.history.length, 3);
  if (toFeed) logLine(`<b>${p.name}</b> ${esc(text)}`);
  if (selected === p.id) renderWho();
}
function term(id, line) { const p = people[id]; p.term.push(line); if (p.term.length > 6) p.term.shift(); if (selected === id) renderWho(); }
let selected = null;
const side = $('#side');
function renderWho() {
  const box = $('#who');
  if (!selected) { box.classList.remove('on'); return; }
  const p = people[selected];
  const info = p ? { name: `${p.name} ${p.sign}`, role: p.role, color: p.shirt, st: STATUS[p.status], task: p.task, hist: p.history, term: p.term }
    : { name: 'You (CEO)', role: 'Owner', color: '#4f6bed', st: needsOpen ? STATUS.waiting : ['#4f6bed', 'In the office'], task: 'Reviewing and merging PRs', hist: ceoHist, term: ['$ workforce status', `${Object.values(people).filter((x) => x.status === 'working').length} working · ${needsOpen ? 1 : 0} needs you`] };
  box.innerHTML = `<div class="top"><div class="av" style="background:${info.color}">${info.name[0]}</div><div><h3>${esc(info.name)}</h3><div class="role">${info.role}</div></div><button class="x" aria-label="Close">×</button></div>
    <dl class="kv"><dt>Status</dt><dd><span class="pill"><b style="background:${info.st[0]}"></b>${info.st[1]}</span></dd><dt>Task</dt><dd>${esc(info.task)}</dd></dl>
    <div class="lbl">Last actions</div><ul>${(info.hist.length ? info.hist : ['nothing yet']).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
    <div class="lbl">Terminal</div><div class="term">${info.term.map((l) => (l.startsWith('✓') ? `<span class="ok">${esc(l)}</span>` : esc(l))).join('\n') || '$ _'}</div>`;
  box.classList.add('on');
  box.querySelector('.x').onclick = () => select(null);
}
const ceoHist = [];
function select(id) {
  selected = id;
  document.querySelectorAll('.person').forEach((g) => g.querySelector('.ring').setAttribute('opacity', g.dataset.pick === id ? 0.9 : 0));
  renderWho();
  if (id) { setTab('details'); side.classList.remove('min'); } else setTab('activity');
}
function setTab(t) { side.dataset.tab = t; document.querySelectorAll('.tabs [data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); }
document.querySelectorAll('.tabs [data-t]').forEach((b) => (b.onclick = () => setTab(b.dataset.t)));
$('#grip').onclick = () => { side.classList.toggle('min'); $('#grip').textContent = side.classList.contains('min') ? '▴' : '▾'; };

let needsOpen = null;
function hud() {
  const n = Object.values(people).filter((p) => p.status === 'working').length;
  $('#chipWork').innerHTML = `<b></b>${n} working`;
  $('#chipNeed').innerHTML = `<b></b>${needsOpen ? 1 : 0} needs you`;
  $('#chipNeed').classList.toggle('on', !!needsOpen);
  if (selected) renderWho();
}
function ask(html, sub, ms, labels = ['Deny', 'Allow']) {
  const id = runId;
  $('#needsTxt').innerHTML = `${html}<small>${sub}</small>`;
  $('#deny').textContent = labels[0]; $('#allow').textContent = labels[1];
  $('#needs').classList.add('show');
  return new Promise((res) => { needsOpen = { res, t0: now, ms }; hud(); }).then((v) => { guard(id); return v; });
}
function answer(v) {
  if (!needsOpen) return;
  const r = needsOpen.res; needsOpen = null; $('#needs').classList.remove('show'); hud(); r(v);
}
$('#allow').onclick = () => answer(true);
$('#deny').onclick = () => answer(false);

/* ---------- the story ---------- */
function reset() {
  runId++; timers.length = 0;
  bubbles.forEach((b) => b.g.remove()); bubbles.length = 0;
  flyers.forEach((f) => f.g.remove()); flyers.length = 0;
  for (const k in notes) { notes[k].g.remove(); delete notes[k]; }
  for (const k in tray) { tray[k].remove(); delete tray[k]; }
  if (needsOpen) { needsOpen = null; $('#needs').classList.remove('show'); }
  for (const id in people) {
    const p = people[id], s = LOC[id].seat;
    Object.assign(p, { x: s[0], y: s[1], pose: 'sit', loc: id, moving: null, carry: null, typing: false, back: true });
    setStatus(id, 'idle', '—'); screen(id, '', 'idle');
  }
  screen('ceo', 'inbox', 'your chair');
  $('#steam').setAttribute('opacity', 0);
}
async function story(msg) {
  const S = people.simha, M = people.mesha, K = people.kanya;
  // 1. owner -> lead
  ceoHist.unshift(`messaged the lead: “${msg}”`); ceoHist.length = Math.min(3, ceoHist.length);
  logLine(`<b>You</b> → Simha: “${esc(msg)}”`);
  screen('ceo', 'sent to Simha', msg.length > 22 ? msg.slice(0, 21) + '…' : msg);
  await wait(300);
  await envelope([250, 140], [660, 150], 1300);
  setStatus('simha', 'working', 'Plan the owner’s request'); screen('simha', 'reading message', 'planning tasks…', true); S.typing = true;
  say(S, 'Got it — planning now', 1600); await wait(900);
  term('simha', '$ workforce plan "' + msg.slice(0, 30) + '"');
  // 2. plan wall
  await walk(S, 'plan'); S.back = true;
  await say(S, 'Two tasks', 900);
  addNote('WF-1', '/health page', '#ffd9d2'); await wait(500);
  addNote('WF-2', 'footer', '#cdeee6'); await wait(700);
  term('simha', '✓ created WF-1, WF-2');
  logAct(S, 'wrote WF-1 and WF-2 on the plan wall');
  // 3. hand out tasks
  await walk(S, 'mesha'); S.face = -1;
  await say(S, 'WF-1 is yours: /health page', 1900);
  await say(M, 'On it!', 1100);
  setStatus('mesha', 'working', 'WF-1 · /health page'); screen('mesha', 'WF-1 · editing', 'app/health/page.tsx', true); M.typing = true;
  term('mesha', '$ git checkout -b wf-1-health'); logAct(M, 'started WF-1 /health page'); moveNote('WF-1', 1);
  await walk(S, 'kanya'); S.face = -1;
  await say(S, 'WF-2 is yours: the footer', 1800);
  await say(K, 'On it!', 1100);
  setStatus('kanya', 'working', 'WF-2 · footer'); screen('kanya', 'WF-2 · editing', 'Footer.tsx', true); K.typing = true;
  term('kanya', '$ git checkout -b wf-2-footer'); logAct(K, 'started WF-2 footer'); moveNote('WF-2', 1);
  // 4. everyone works
  await sit(S); S.typing = true; screen('simha', 'lead', 'watching the board', false); setStatus('simha', 'working', 'Coordinating WF-1, WF-2');
  await wait(1800);
  // 5. Mesha needs permission
  await walk(M, 'ceo'); setStatus('mesha', 'waiting', 'WF-1 · needs permission');
  term('mesha', '? npm install zod  (needs approval)');
  const b = await say(M, 'May I run npm install zod?', 0);
  const ok = await ask('<b>Mesha</b> wants to run <code>npm install zod</code>', 'for WF-1 /health page · auto-allows in 6 s', 6000);
  kill(b);
  ceoHist.unshift(ok ? 'allowed npm install zod' : 'denied npm install zod');
  logLine(ok ? '<b>You</b> allowed <code>npm install zod</code>' : '<b>You</b> denied <code>npm install zod</code>');
  await say(M, ok ? 'Thanks!' : 'Okay, no zod then', 1000);
  const meshaBack = (async () => {
    await sit(M); M.typing = true; setStatus('mesha', 'working', 'WF-1 · /health page');
    if (ok) { screen('mesha', 'WF-1', 'npm install zod', true); term('mesha', '$ npm install zod'); term('mesha', '✓ added 1 package'); await wait(1200); }
    screen('mesha', 'WF-1 · editing', 'app/health/page.tsx', true);
  })();
  // 6. Kanya ships PR #4
  screen('kanya', 'WF-2', 'running tests', true); term('kanya', '$ npm test'); await wait(1200);
  term('kanya', '✓ 14 tests passed'); screen('kanya', 'WF-2', 'tests passed ✓'); K.typing = false; await wait(500);
  term('kanya', '$ gh pr create  → PR #4');
  K.carry = 'PR #4'; K.parts.ptxt.textContent = 'PR #4';
  await walk(K, 'gate'); K.back = true; await wait(250);
  K.carry = null; dropParcel('PR #4'); setStatus('kanya', 'review', 'WF-2 · PR #4 in review'); screen('kanya', 'WF-2', 'PR #4 in review');
  logAct(K, 'opened PR #4 (footer)'); moveNote('WF-2', 2);
  await meshaBack;
  let pr4done; const pr4 = new Promise((r) => (pr4done = r));
  // 9 (starts early). Mesha finishes while Kanya's PR is reviewed
  const meshaPR = (async () => {
    await wait(1500);
    screen('mesha', 'WF-1', 'running tests', true); term('mesha', '$ npm test'); await wait(1200);
    term('mesha', '✓ 9 tests passed'); term('mesha', '$ gh pr create  → PR #5'); M.typing = false; screen('mesha', 'WF-1', 'tests passed ✓'); await wait(400);
    M.carry = 'PR #5'; M.parts.ptxt.textContent = 'PR #5';
    await walk(M, 'gate'); M.back = true; await wait(250);
    M.carry = null; dropParcel('PR #5'); setStatus('mesha', 'review', 'WF-1 · PR #5 in review'); screen('mesha', 'WF-1', 'PR #5 in review');
    logAct(M, 'opened PR #5 (/health page)'); moveNote('WF-1', 2);
    await pr4;
    await walk(M, 'simha'); M.face = -1;
    await say(M, 'PR #5 is ready', 1400);
    await say(S, 'Great. Owner will merge.', 1500);
    await ask('<b>PR #5</b> “Add /health page” is ready', 'Simha reviewed it · auto-merges in 4 s', 4000, ['Later', 'Merge']);
    ceoHist.unshift('merged PR #5'); logLine('<b>You</b> merged PR #5 🎉');
    await merge('PR #5'); moveNote('WF-1', 3);
    setStatus('mesha', 'idle', '—'); screen('mesha', '', 'idle');
    setStatus('simha', 'idle', '—'); S.typing = false; screen('simha', 'lead', 'all done ✓'); term('simha', '✓ WF-1, WF-2 done');
    logAct(S, 'closed WF-1 and WF-2');
  })();
  // 7. tell the lead
  await walk(K, 'simha'); K.face = -1;
  await say(K, 'PR #4 is ready', 1400);
  await say(S, 'Nice. Owner will merge.', 1500);
  // 8. merge
  const m4 = await ask('<b>PR #4</b> “Add site footer” is ready', 'Simha reviewed it · auto-merges in 4 s', 4000, ['Later', 'Merge']);
  ceoHist.unshift('merged PR #4'); logLine('<b>You</b> merged PR #4 🎉');
  await merge('PR #4'); moveNote('WF-2', 3);
  setStatus('kanya', 'idle', '—'); screen('kanya', '', 'idle'); logAct(K, `PR #4 merged${m4 ? '' : ' (auto)'}; going for coffee`);
  pr4done();
  await walk(K, 'lounge', 'coffee'); K.back = true; $('#steam').setAttribute('opacity', 1);
  await wait(1800); $('#steam').setAttribute('opacity', 0); K.back = false; await say(K, 'Coffee ☕', 1200);
  await walk(K, 'lounge', 'w1');
  await meshaPR;
  await walk(M, 'lounge', 'w2');
  await say(K, 'Nice work!', 1200);
  await say(M, 'Thanks! Coffee next?', 1400);
  await Promise.all([sit(M), sit(K)]);
  logLine('All tasks done · story restarts');
  await wait(1800);
  for (const k in notes) notes[k].gone = true;
  await wait(800);
}
async function loop(msg) {
  reset();
  try { for (;;) { await story(msg); reset(); msg = 'Add a /health page and a footer'; } } catch (e) { if (!(e instanceof Cancel)) throw e; }
}
$('#replay').onclick = () => { logLine('Story restarted'); loop('Add a /health page and a footer'); };
$('#msgForm').onsubmit = (e) => { e.preventDefault(); const v = $('#msgIn').value.trim(); $('#msgIn').value = ''; loop(v || 'Add a /health page and a footer'); };

/* ---------- pan & zoom (viewBox) ---------- */
const stage = $('#stage');
let vb = { x: 0, y: 0, w: W, h: H }, fitW = W;
function applyVB() {
  const r = stage.getBoundingClientRect(), asp = r.height / Math.max(1, r.width);
  vb.w = clamp(vb.w, 360, fitW * 1.08); vb.h = vb.w * asp;
  const mx = 40;
  vb.x = vb.w > W + mx * 2 ? (W - vb.w) / 2 : clamp(vb.x, -mx, W + mx - vb.w);
  vb.y = vb.h > H + mx * 2 ? (H - vb.h) / 2 : clamp(vb.y, -mx, H + mx - vb.h);
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}
function fit() {
  const r = stage.getBoundingClientRect(), asp = r.height / Math.max(1, r.width);
  fitW = Math.max(W + 40, (H + 40) / asp);
  const narrow = r.width < 600;
  vb.w = narrow ? Math.min(fitW, 900) : fitW; vb.h = vb.w * asp;
  vb.x = narrow ? 10 : (W - vb.w) / 2; vb.y = (H - vb.h) / 2; autoCam = true;
  applyVB();
}
function zoomAt(f, cx, cy) {
  const r = stage.getBoundingClientRect();
  const wx = vb.x + ((cx - r.left) / r.width) * vb.w, wy = vb.y + ((cy - r.top) / r.height) * vb.h;
  const nw = clamp(vb.w * f, 360, fitW * 1.08), k = nw / vb.w;
  vb.x = wx - (wx - vb.x) * k; vb.y = wy - (wy - vb.y) * k; vb.w = nw;
  applyVB();
}
const ptrs = new Map(); let dragDist = 0, pinch0 = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.needs,.zoom')) return;
  stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragDist = 0;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
  stage.classList.add('drag');
});
stage.addEventListener('pointermove', (e) => {
  const last = ptrs.get(e.pointerId); if (!last) return;
  const r = stage.getBoundingClientRect();
  if (ptrs.size === 1) {
    const dx = e.clientX - last.x, dy = e.clientY - last.y; dragDist += Math.abs(dx) + Math.abs(dy);
    if (dragDist < 6) { ptrs.set(e.pointerId, last); return; }
    autoCam = false;
    vb.x -= (dx / r.width) * vb.w; vb.y -= (dy / r.height) * vb.h; applyVB();
  }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0) zoomAt(pinch0 / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch0 = d; dragDist = 99; autoCam = false;
  }
});
const up = (e) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null;
  if (!ptrs.size) stage.classList.remove('drag');
  if (e.type === 'pointerup' && dragDist < 6 && !ptrs.size) {
    const hit = document.elementsFromPoint(e.clientX, e.clientY).map((n) => n.closest && n.closest('[data-pick]')).find(Boolean);
    select(hit ? hit.dataset.pick : null);
  }
};
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
stage.addEventListener('wheel', (e) => { e.preventDefault(); autoCam = false; zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
svg.addEventListener('pointerover', (e) => { const g = e.target.closest('.person'); if (g && g.dataset.pick !== selected) g.querySelector('.ring').setAttribute('opacity', 0.5); });
svg.addEventListener('pointerout', (e) => { const g = e.target.closest('.person'); if (g && g.dataset.pick !== selected) g.querySelector('.ring').setAttribute('opacity', 0); });
$('#zin').onclick = () => { autoCam = false; const r = stage.getBoundingClientRect(); zoomAt(0.8, r.left + r.width / 2, r.top + r.height / 2); };
$('#zout').onclick = () => { autoCam = false; const r = stage.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); };
$('#zfit').onclick = fit;
new ResizeObserver(fit).observe(stage);

/* ---------- main loop ---------- */
let prev = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, (ts - prev) / 1000); prev = ts; now += dt * 1000;
  const t = now / 1000;
  tickTimers();
  for (const id in people) { stepMove(people[id]); drawPerson(people[id], t); }
  if (autoCam && focus && vb.w < W) { // phones: camera drifts after whoever is acting
    const tx = focus.x - vb.w / 2, ty = focus.y - 60 - vb.h / 2, k = Math.min(1, dt * 1.6);
    vb.x = lerp(vb.x, tx, k); vb.y = lerp(vb.y, ty, k); applyVB();
  }
  sortActors(); drawBubbles(); drawFlyers(); drawConfetti(dt); drawNotes(dt); drawScreens(t);
  if (needsOpen) {
    const u = (now - needsOpen.t0) / needsOpen.ms;
    $('#needsBar').style.width = `${Math.max(0, 1 - u) * 100}%`;
    if (u >= 1) answer(true);
  }
  requestAnimationFrame(frame);
}
fit();
logLine('Office opened · demo data');
loop('Add a /health page and a footer');
requestAnimationFrame(frame);
})();
