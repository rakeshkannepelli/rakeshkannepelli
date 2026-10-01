// scripts/generate-map.mjs
// Builds assets/contrib-map.svg: a blue night city where every building is one day of
// your GitHub contributions (taller = more). Buildings on your current streak glow amber.
// Cinematic intro: the letters of your name appear one by one, in order, each above a
// randomly chosen building, then fly up together and form the title above the city.
// Local preview:  node scripts/generate-map.mjs --mock

import { writeFileSync, mkdirSync } from "node:fs";

const USER = process.env.USERNAME || "rakeshkannepelli";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = "assets/contrib-map.svg";
const MOCK = process.argv.includes("--mock");

// ---------- name title (safe to change) ----------
const NAME = "RAKESH KANNEPELLI";
const ASSEMBLE = true;       // true = letters fly up and form the title, false = letters stay on their buildings
const TITLE_Y = 78;          // baseline of the final title
const TITLE_SIZE = 34;       // font size of the final title
const PITCH = 36;            // distance between title letters

// ---------- timing in seconds ----------
const D = 26;                // one full loop
const T_START = 0.9;         // first letter appears
const T_STEP = 0.55;         // gap between letters appearing
const T_MOVE = 10.4;         // letters start flying to the title
const T_FADE = 22.5;         // title fades before the loop restarts

// ---------- city layout ----------
const W = 1000, H = 316;     // canvas size
const P = 15;                // width of one week column
const K = 7;                 // sideways lean per row (3D look)
const T = 13;                // vertical size of one row (bigger = less overlap)
const HMAX = 56;             // tallest building in pixels
const GAP = 0.16;            // space between buildings (0 to 0.3)
const Y0 = 178;              // vertical position of the city
const RAIN_BACK = 40;        // faint drops behind the city (0 = none)
const RAIN_FRONT = 10;       // bright drops in front (0 = none)

// ---------- blue theme ----------
const BLUE = "#4da3ff";
const AMBER = "#ffb84d";     // current streak buildings
const DIM = "#4a7fb5";       // small text
// wall colours per level (1 = few contributions ... 4 = most), "s" = current streak
const WALLS = { 1: "#173a63", 2: "#1d4f8c", 3: "#2569b5", 4: "#2f86e0", s: "#8a5a14" };
const LIT_BLUE = ["#d6ecff", "#9bd0ff", "#eaf6ff"];
const LIT_AMBER = ["#fff1c2", "#ffd67a", "#ffffff"];

let X0 = 0; // set once we know how many weeks there are

// ---------- data ----------
async function fetchCalendar() {
  if (MOCK) return mockCalendar();
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "contrib-map" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  if (!json.data || !json.data.user) throw new Error(JSON.stringify(json));
  return json.data.user.contributionsCollection.contributionCalendar;
}

function mockCalendar() {
  const rnd = mulberry32(11);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (52 * 7 + today.getUTCDay()) * 86400000);
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86400000);
      if (date > today) continue;
      const c = rnd() < 0.27 ? 1 + Math.floor(rnd() * rnd() * 14) : 0;
      days.push({ date: date.toISOString().slice(0, 10), contributionCount: c, weekday: d });
    }
    if (days.length) weeks.push({ contributionDays: days });
  }
  const flat = weeks.flatMap((w) => w.contributionDays);
  flat.slice(-4).forEach((d) => (d.contributionCount = 2 + Math.floor(rnd() * 6))); // demo streak
  return { totalContributions: flat.reduce((a, d) => a + d.contributionCount, 0), weeks };
}

// ---------- helpers ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shade(hex, k) { // k > 0 lightens, k < 0 darkens
  const n = parseInt(hex.slice(1), 16);
  const t = k > 0 ? 255 : 0, a = Math.abs(k);
  const mix = (c) => Math.round(c + (t - c) * a);
  const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
const f = (n) => n.toFixed(1);
const pts = (arr) => arr.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");

// ground position (u = week, v = weekday) + height -> screen x, y
const sx = (u, v) => X0 + u * P - v * K;
const sy = (v, h) => Y0 + v * T - h;

const frontQuad = (u0, u1, v1, a0, a1, b0, b1) => {
  const xa = sx(u0 + (u1 - u0) * a0, v1), xb = sx(u0 + (u1 - u0) * a1, v1);
  return `M${f(xa)},${f(sy(v1, b1))}L${f(xb)},${f(sy(v1, b1))}L${f(xb)},${f(sy(v1, b0))}L${f(xa)},${f(sy(v1, b0))}Z`;
};
const rightQuad = (u1, v0, v1, a0, a1, b0, b1) => {
  const va = v0 + (v1 - v0) * a0, vb = v0 + (v1 - v0) * a1;
  return `M${f(sx(u1, va))},${f(sy(va, b1))}L${f(sx(u1, vb))},${f(sy(vb, b1))}L${f(sx(u1, vb))},${f(sy(vb, b0))}L${f(sx(u1, va))},${f(sy(va, b0))}Z`;
};
const topPoly = (b) => {
  const u0 = b.w + GAP, u1 = b.w + 1 - GAP, v0 = b.d + GAP, v1 = b.d + 1 - GAP;
  return [[sx(u0, v0), sy(v0, b.h)], [sx(u1, v0), sy(v0, b.h)], [sx(u1, v1), sy(v1, b.h)], [sx(u0, v1), sy(v1, b.h)]];
};

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) {
    if (d.contributionCount > 0) { run++; longest = Math.max(longest, run); } else run = 0;
  }
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--; // today may not be counted yet
  const set = new Set();
  while (i >= 0 && days[i].contributionCount > 0) { set.add(days[i].date); i--; }
  return { current: set.size, longest, currentSet: set };
}

// ---------- animation helper ----------
// Easing is calculated here and written out as plain keyframes, so the SVG only uses
// simple linear animation (works in every browser).
function bezier(x1, y1, x2, y2, t) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const x = ((ax * s + bx) * s + cx) * s - t;
    const d = (3 * ax * s + 2 * bx) * s + cx;
    if (Math.abs(x) < 1e-5 || Math.abs(d) < 1e-6) break;
    s -= x / d;
  }
  s = Math.min(1, Math.max(0, s));
  return ((ay * s + by) * s + cy) * s;
}
function lerp(a, b, k) {
  if (typeof a === "number") return +(a + (b - a) * k).toFixed(3);
  const [ax, ay] = a.split(" ").map(Number), [bx, by] = b.split(" ").map(Number);
  return `${(ax + (bx - ax) * k).toFixed(1)} ${(ay + (by - ay) * k).toFixed(1)}`;
}
// pts: [[seconds, value, easingToNextPoint?], ...]  -> one looping animation
function anim(tag, attrs, pts) {
  const list = pts.map((p) => p.slice());
  if (list[0][0] > 0) list.unshift([0, list[0][1]]);
  if (list[list.length - 1][0] < D) list.push([D, list[list.length - 1][1]]);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    out.push([list[i][0], list[i][1]]);
    if (list[i][2] && i < list.length - 1) {
      const [x1, y1, x2, y2] = list[i][2].split(" ").map(Number);
      const [t0, v0] = list[i], [t1, v1] = list[i + 1];
      for (let k = 1; k <= 8; k++) {
        const u = k / 9;
        out.push([t0 + (t1 - t0) * u, lerp(v0, v1, bezier(x1, y1, x2, y2, u))]);
      }
    }
  }
  let last = -1;
  const times = out.map(([t]) => {
    let k = Math.min(1, t / D);
    if (k <= last) k = last + 0.00004;
    last = k;
    return Math.min(1, k).toFixed(5);
  });
  return `<${tag} ${attrs} dur="${D}s" repeatCount="indefinite" keyTimes="${times.join(";")}" values="${out.map((p) => p[1]).join(";")}"/>`;
}
const EASE_MOVE = "0.55 0 0.2 1";
const EASE_POP = "0.34 1.56 0.64 1";
const opacityAnim = (p) => anim("animate", 'attributeName="opacity"', p);

// ---------- neon rain ----------
function rainLayer(rand, count, o) {
  const slope = Math.tan((12 * Math.PI) / 180);
  const dy = H + 80;
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = rand() * (W + slope * dy);
    const len = o.minLen + rand() * (o.maxLen - o.minLen);
    const dur = o.minDur + rand() * (o.maxDur - o.minDur);
    const delay = -rand() * dur;
    out += `<g><animateTransform attributeName="transform" type="translate" from="${f(x)} -40" to="${f(x - slope * dy)} ${f(H + 40)}" dur="${f(dur)}s" begin="${f(delay)}s" repeatCount="indefinite"/><rect width="${o.width}" height="${f(len)}" fill="url(#rainGrad)" transform="skewX(-12)"/></g>`;
  }
  return count > 0 ? `<g opacity="${o.opacity}" clip-path="url(#card)">${out}</g>` : "";
}

// ---------- one building ----------
function building(b, flashAt) {
  const key = b.streak ? "s" : String(b.lvl);
  const wall = WALLS[key];
  const accent = b.streak ? AMBER : BLUE;
  const u0 = b.w + GAP, u1 = b.w + 1 - GAP;
  const v0 = b.d + GAP, v1 = b.d + 1 - GAP;
  const h = b.h;
  const rnd = mulberry32(hash(b.date));

  // windows (2 columns on the front, 1 on the side)
  const WH = 2.4, WP = 4.4;
  const prob = b.streak ? 0.85 : 0.45 + b.lvl * 0.06;
  const litF = [], darkF = [], litR = [], darkR = [];
  for (let y = 3.5; y + WH <= h - 2.5; y += WP) {
    for (const [a0, a1] of [[0.14, 0.44], [0.56, 0.86]]) {
      (rnd() < prob ? litF : darkF).push(frontQuad(u0, u1, v1, a0, a1, y, y + WH));
    }
    (rnd() < prob ? litR : darkR).push(rightQuad(u1, v0, v1, 0.25, 0.75, y, y + WH));
  }
  const litCol = (b.streak ? LIT_AMBER : LIT_BLUE)[Math.floor(rnd() * 3)];
  const darkF_c = shade(wall, -0.55), darkR_c = shade(wall, -0.62);

  const front = [[sx(u0, v1), sy(v1, h)], [sx(u1, v1), sy(v1, h)], [sx(u1, v1), sy(v1, 0)], [sx(u0, v1), sy(v1, 0)]];
  const right = [[sx(u1, v0), sy(v0, h)], [sx(u1, v1), sy(v1, h)], [sx(u1, v1), sy(v1, 0)], [sx(u1, v0), sy(v0, 0)]];
  const top = topPoly(b);

  let s = `<polygon points="${pts(front)}" fill="url(#gf${key})"/>`;
  s += `<polygon points="${pts(right)}" fill="url(#gr${key})"/>`;
  if (darkF.length) s += `<path d="${darkF.join("")}" fill="${darkF_c}"/>`;
  if (darkR.length) s += `<path d="${darkR.join("")}" fill="${darkR_c}"/>`;
  if (litF.length) s += `<path d="${litF.join("")}" fill="${litCol}"/>`;
  if (litR.length) s += `<path d="${litR.join("")}" fill="${litCol}" opacity="0.7"/>`;
  s += `<line x1="${f(sx(u1, v1))}" y1="${f(sy(v1, h))}" x2="${f(sx(u1, v1))}" y2="${f(sy(v1, 0))}" stroke="${shade(wall, 0.5)}" stroke-opacity="0.45" stroke-width="0.6"/>`;
  const edge = b.lvl >= 4 || b.streak ? accent : shade(wall, 0.5);
  s += `<polygon points="${pts(top)}" fill="${shade(wall, 0.28)}" stroke="${edge}" stroke-opacity="${b.lvl >= 4 || b.streak ? 0.85 : 0.6}" stroke-width="0.6"/>`;

  // rooftop box + antenna
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  let roofTop = h;
  if (b.lvl >= 2) {
    const ru0 = cu - 0.14, ru1 = cu + 0.14, rv0 = cv - 0.14, rv1 = cv + 0.14, rh = 3.5;
    roofTop = h + rh;
    const rf = [[sx(ru0, rv1), sy(rv1, h + rh)], [sx(ru1, rv1), sy(rv1, h + rh)], [sx(ru1, rv1), sy(rv1, h)], [sx(ru0, rv1), sy(rv1, h)]];
    const rr = [[sx(ru1, rv0), sy(rv0, h + rh)], [sx(ru1, rv1), sy(rv1, h + rh)], [sx(ru1, rv1), sy(rv1, h)], [sx(ru1, rv0), sy(rv0, h)]];
    const rt = [[sx(ru0, rv0), sy(rv0, h + rh)], [sx(ru1, rv0), sy(rv0, h + rh)], [sx(ru1, rv1), sy(rv1, h + rh)], [sx(ru0, rv1), sy(rv1, h + rh)]];
    s += `<polygon points="${pts(rf)}" fill="${shade(wall, -0.2)}"/><polygon points="${pts(rr)}" fill="${shade(wall, -0.4)}"/><polygon points="${pts(rt)}" fill="${shade(wall, 0.35)}"/>`;
  }
  if (b.lvl >= 3 || b.streak) {
    const ax = sx(cu, cv), ay = sy(cv, roofTop);
    const delay = (hash(b.date) % 24) / 10;
    s += `<line x1="${f(ax)}" y1="${f(ay)}" x2="${f(ax)}" y2="${f(ay - 9)}" stroke="${shade(wall, 0.5)}" stroke-width="0.8"/>`;
    s += `<circle cx="${f(ax)}" cy="${f(ay - 9.5)}" r="1.7" fill="${accent}"><animate attributeName="opacity" values="1;0.15;1" dur="2.4s" begin="-${delay}s" repeatCount="indefinite"/></circle>`;
  }
  // light-up when a letter of the name lands on this building
  if (flashAt !== undefined) s += flashOverlay(top, flashAt);
  return s;
}

function flashOverlay(poly, a) {
  const fade = ASSEMBLE ? T_MOVE : T_FADE - 1;
  return `<polygon points="${pts(poly)}" fill="#bfe1ff" opacity="0">${opacityAnim([[a, 0], [a + 0.15, 0.95], [a + 1.0, 0.4], [fade, 0.4], [fade + 1.5, 0]])}</polygon>`;
}

// where a letter floats above a building (or an empty lot)
function anchor(b) {
  const cu = b.w + 0.5, cv = b.d + 0.5;
  const roof = b.h + (b.lvl >= 2 ? 3.5 : 0);
  const tall = b.lvl >= 3 || b.streak;
  const tipY = sy(cv, roof + (tall ? 11.2 : 0));
  return { x: sx(cu, cv), y: tipY - 8, roofY: sy(cv, roof) };
}

// pick one building per letter at random, keeping the letters from touching each other
function pickBuildings(cells, count, rnd) {
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  };
  const pool = shuffle(cells.filter((c) => c.c > 0));
  if (pool.length < count * 2) pool.push(...shuffle(cells.filter((c) => c.c === 0))); // few buildings: use empty lots too
  for (const [dx, dy] of [[18, 20], [13, 15], [0, 0]]) {
    const chosen = [];
    for (const c of pool) {
      const a = anchor(c);
      if (chosen.every((o) => Math.abs(o.a.x - a.x) >= dx || Math.abs(o.a.y - a.y) >= dy)) chosen.push({ cell: c, a });
      if (chosen.length === count) return chosen;
    }
  }
  return pool.slice(0, count).map((cell) => ({ cell, a: anchor(cell) }));
}

// ---------- build ----------
function build(cal) {
  const weeks = cal.weeks;
  X0 = Math.round((W - weeks.length * P) / 2 + 3.5 * K);
  const days = weeks.flatMap((w) => w.contributionDays);
  const max = Math.max(1, ...days.map((d) => d.contributionCount));
  const st = streaks(days);

  const cells = [];
  weeks.forEach((wk, w) =>
    wk.contributionDays.forEach((day) => {
      const c = day.contributionCount, ratio = c / max;
      const lvl = c === 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
      const h = c === 0 ? 0 : 12 + Math.pow(ratio, 0.65) * (HMAX - 12);
      cells.push({ w, d: day.weekday, c, lvl, h, date: day.date, streak: st.currentSet.has(day.date) });
    })
  );

  // one letter per random building, in name order; a new random layout every day
  const rnd = mulberry32(Math.floor(Date.now() / 86400000));
  const letters = [...NAME].map((ch, slot) => ({ ch, slot })).filter((l) => l.ch !== " ");
  const picks = pickBuildings(cells, letters.length, rnd);
  const flash = new Map();
  picks.forEach((p, i) => flash.set(`${p.cell.w},${p.cell.d}`, T_START + i * T_STEP));

  // ground plots for every day (empty lots included)
  let ground = "";
  for (const c of cells) {
    const g0 = 0.04, g1 = 0.96;
    const poly = [
      [sx(c.w + g0, c.d + g0), sy(c.d + g0, 0)], [sx(c.w + g1, c.d + g0), sy(c.d + g0, 0)],
      [sx(c.w + g1, c.d + g1), sy(c.d + g1, 0)], [sx(c.w + g0, c.d + g1), sy(c.d + g1, 0)],
    ];
    ground += `<polygon points="${pts(poly)}" fill="${c.c > 0 ? "#0c1a2e" : "#070f1c"}" stroke="#12304f" stroke-width="0.5"/>`;
    if (c.c === 0 && flash.has(`${c.w},${c.d}`)) ground += flashOverlay(poly, flash.get(`${c.w},${c.d}`));
  }

  // far row first, left to right, so nearer buildings always cover farther ones
  const city = cells
    .filter((c) => c.c > 0)
    .sort((a, b) => a.d - b.d || a.w - b.w)
    .map((c) => building(c, flash.get(`${c.w},${c.d}`)))
    .join("");

  // ---------- cinematic name reveal ----------
  let title = "";
  const lastMoveEnd = T_MOVE + (letters.length - 1) * 0.06 + 2.0;
  letters.forEach((L, i) => {
    const a = T_START + i * T_STEP;
    const p1 = T_MOVE + i * 0.06, p2 = p1 + 2.0;
    const { a: anc } = picks[i];
    const fx = ASSEMBLE ? W / 2 + (L.slot - (NAME.length - 1) / 2) * PITCH : anc.x;
    const fy = ASSEMBLE ? TITLE_Y : anc.y;
    const s0 = 0.5, s1 = ASSEMBLE ? 1 : 0.5;
    const from = `${f(anc.x)} ${f(anc.y)}`, to = `${f(fx)} ${f(fy)}`;

    // light beam from the roof up to the letter
    title += `<rect x="${f(anc.x - 1.2)}" y="${f(anc.y)}" width="2.4" height="${f(Math.max(4, anc.roofY - anc.y))}" fill="url(#beam)" opacity="0">${opacityAnim([[a, 0], [a + 0.1, 0.95], [a + 0.9, 0]])}</rect>`;
    // the letter: fades in, pops, waits on its building, then flies to its place in the title
    title += `<g opacity="0" filter="url(#glow)">${opacityAnim([[a, 0], [a + 0.12, 1], [T_FADE, 1], [T_FADE + 1.5, 0]])}`
      + `<g transform="translate(${from})">${anim("animateTransform", 'attributeName="transform" type="translate"', [[a, from], [ASSEMBLE ? p1 : D, from, EASE_MOVE], [ASSEMBLE ? p2 : D, to]])}`
      + `<g transform="scale(1)">${anim("animateTransform", 'attributeName="transform" type="scale"', [[a, 0, EASE_POP], [a + 0.4, s0], [ASSEMBLE ? p1 : D, s0, EASE_MOVE], [ASSEMBLE ? p2 : D, s1]])}`
      + `<text text-anchor="middle" fill="#eaf6ff" font-family="'Trajan Pro','Cinzel',Georgia,'Times New Roman',serif" font-size="${TITLE_SIZE}" font-weight="700">${L.ch}</text></g></g></g>`;
  });
  if (ASSEMBLE) {
    const half = ((NAME.length - 1) / 2) * PITCH + 24;
    const len = Math.round(half * 2);
    title += `<ellipse cx="${W / 2}" cy="${TITLE_Y - 10}" rx="${half + 30}" ry="42" fill="url(#titleHaze)" opacity="0">${opacityAnim([[lastMoveEnd - 1.5, 0], [lastMoveEnd + 1.5, 0.9], [T_FADE, 0.9], [T_FADE + 1.5, 0]])}</ellipse>`;
    title += `<line x1="${W / 2 - half}" y1="${TITLE_Y + 14}" x2="${W / 2 + half}" y2="${TITLE_Y + 14}" stroke="url(#lineGrad)" stroke-width="1.6" stroke-dasharray="${len}" stroke-dashoffset="${len}" opacity="1">`
      + `${anim("animate", 'attributeName="stroke-dashoffset"', [[lastMoveEnd, len], [lastMoveEnd + 2.2, 0, "0.4 0 0.2 1"], [T_FADE, 0], [T_FADE + 1.5, len]])}</line>`;
  }

  // month labels under the front edge
  let labels = "", lastMonth = -1, lastWeek = -10;
  weeks.forEach((wk, w) => {
    const m = new Date(wk.contributionDays[0].date + "T00:00:00Z").getUTCMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      if (w - lastWeek < 3) labels = labels.replace(/<text[^>]*>[A-Z]{3}<\/text>$/, "");
      lastWeek = w;
      const name = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][m];
      labels += `<text x="${f(sx(w, 7.4))}" y="${f(sy(7.4, 0) + 12)}" fill="${DIM}" font-size="9" letter-spacing="1">${name}</text>`;
    }
  });

  // gradients for walls
  let grads = "";
  for (const [k, base] of Object.entries(WALLS)) {
    const r = shade(base, -0.3);
    grads += `<linearGradient id="gf${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(base, 0.12)}"/><stop offset="1" stop-color="${shade(base, -0.45)}"/></linearGradient>`;
    grads += `<linearGradient id="gr${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${r}"/><stop offset="1" stop-color="${shade(r, -0.45)}"/></linearGradient>`;
  }

  const rainRnd = mulberry32(1234);
  const rainBack = rainLayer(rainRnd, RAIN_BACK, { minLen: 10, maxLen: 22, minDur: 1.8, maxDur: 3.2, width: 1, opacity: 0.3 });
  const rainFront = rainLayer(rainRnd, RAIN_FRONT, { minLen: 18, maxLen: 34, minDur: 0.9, maxDur: 1.6, width: 1.4, opacity: 0.5 });

  const legend = `<text x="24" y="${H - 12}" fill="${DIM}" font-size="10" letter-spacing="1">1 BUILDING = 1 DAY  ·  TALLER = MORE CONTRIBUTIONS</text>`
    + (st.current > 0 ? `<text x="${W - 24}" y="${H - 12}" fill="${AMBER}" font-size="10" letter-spacing="1" text-anchor="end">AMBER GLOW = CURRENT STREAK</text>` : "");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Courier New', monospace">
  <defs>
    ${grads}
    <linearGradient id="rainGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BLUE}" stop-opacity="0"/>
      <stop offset="1" stop-color="#cfe8ff" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eaf6ff" stop-opacity="0"/>
      <stop offset="1" stop-color="#9bd0ff" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="lineGrad" gradientUnits="userSpaceOnUse" x1="${W / 2 - 320}" y1="0" x2="${W / 2 + 320}" y2="0">
      <stop offset="0" stop-color="${BLUE}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#9bd0ff" stop-opacity="1"/>
      <stop offset="1" stop-color="${BLUE}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="titleHaze">
      <stop offset="0" stop-color="${BLUE}" stop-opacity="0.32"/>
      <stop offset="1" stop-color="${BLUE}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="haze" cx="50%" cy="72%" r="60%">
      <stop offset="0" stop-color="${BLUE}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${BLUE}" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="12"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="#050914" stroke="#12284a"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="url(#haze)"/>
  <text x="24" y="28" fill="${BLUE}" font-size="12" letter-spacing="2">&gt; CONTRIBUTION_MAP</text>
  <text x="${W - 24}" y="28" fill="${DIM}" font-size="11" text-anchor="end" letter-spacing="1">CURRENT STREAK ${st.current}  |  LONGEST ${st.longest}  |  ${cal.totalContributions} CONTRIBUTIONS</text>
  ${rainBack}
  ${ground}
  ${city}
  ${rainFront}
  ${labels}
  ${title}
  ${legend}
</svg>
`;
}

const cal = await fetchCalendar();
mkdirSync("assets", { recursive: true });
writeFileSync(OUT, build(cal));
console.log(`Wrote ${OUT} (${cal.totalContributions} contributions)`);
