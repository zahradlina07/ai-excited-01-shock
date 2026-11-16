// A shockwave tearing a ring of machinery apart from the inside.
// Node 22+, standard library only. Run: MAKEFUN_OUTPUT_DIR=out node main.ts
import fs from 'node:fs';
import zlib from 'node:zlib';

const W = 1024, H = 1024, SS = 2, SPP = SS * SS, N = W * H;
const OUT = process.env.MAKEFUN_OUTPUT_DIR || 'out';
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- prng / math
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (a: number, b: number, x: number) => {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const wrapPi = (d: number) => {
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};

// ---------------------------------------------------------------- noise
const PERM = new Uint8Array(512);
{
  const r = mulberry(1337);
  const p: number[] = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
const GY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const p0 = PERM[X], p1 = PERM[X + 1];
  const g0 = PERM[p0 + Y] & 7, g1 = PERM[p1 + Y] & 7;
  const g2 = PERM[p0 + Y + 1] & 7, g3 = PERM[p1 + Y + 1] & 7;
  const n00 = GX[g0] * xf + GY[g0] * yf;
  const n10 = GX[g1] * (xf - 1) + GY[g1] * yf;
  const n01 = GX[g2] * xf + GY[g2] * (yf - 1);
  const n11 = GX[g3] * (xf - 1) + GY[g3] * (yf - 1);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.4;
}
function fbm(x: number, y: number, oct: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.07; a *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- frame
const DL = Math.hypot(0.87, 0.49);
const DXL = 0.87 / DL, DYL = -0.49 / DL;         // travel: lower-left -> upper-right
const BASE = Math.atan2(DYL, DXL);
const CX = 214, CY = 806;
const R0 = 330;

// machinery ring: tilted ellipse, long axis on the travel diagonal
const RCX = 578, RCY = 512;
const RA = 306, RB = 143;
const RCOS = Math.cos(BASE), RSIN = Math.sin(BASE);
const NR = 13;
const DTH = TAU / NR;
const RIBQ0 = 0.600;

// ---------------------------------------------------------------- front profile
const LOBES = [
  { a: 0.02, amp: 1.95, w: 0.215 },
  { a: 0.40, amp: 0.40, w: 0.070 },
  { a: -0.34, amp: 0.26, w: 0.085 },
  { a: 0.95, amp: 0.16, w: 0.120 },
  { a: -1.05, amp: 0.14, w: 0.130 },
  { a: -1.85, amp: 0.10, w: 0.180 },
];
const TONGUES = [
  { a: 0.16, amp: 0.30, w: 0.026 },
  { a: -0.06, amp: 0.22, w: 0.020 },
  { a: 0.31, amp: 0.18, w: 0.022 },
  { a: -0.52, amp: 0.13, w: 0.028 },
  { a: 0.62, amp: 0.11, w: 0.024 },
  { a: -1.22, amp: 0.09, w: 0.032 },
];
const NLUT = 8192;
const FRONT = new Float32Array(NLUT + 1);
const LOBEB = new Float32Array(NLUT + 1);
for (let i = 0; i <= NLUT; i++) {
  const rel = -Math.PI + (i / NLUT) * TAU;
  let r = 1.0;
  for (const L of LOBES) r += L.amp * Math.exp(-(wrapPi(rel - L.a) ** 2) / (2 * L.w * L.w));
  for (const L of TONGUES) r += L.amp * Math.exp(-(wrapPi(rel - L.a) ** 2) / (2 * L.w * L.w));
  r += 0.066 * noise2(Math.cos(rel) * 3.4 + 10.5, Math.sin(rel) * 3.4 + 2.2);
  r += 0.038 * noise2(Math.cos(rel) * 9.5 + 31.5, Math.sin(rel) * 9.5 + 17.5);
  r += 0.016 * noise2(Math.cos(rel) * 24 + 5.5, Math.sin(rel) * 24 + 51.5);
  FRONT[i] = Math.max(0.40, r);

  let lb = 0.012;
  for (const L of LOBES) lb += L.amp * 1.20 * Math.exp(-(wrapPi(rel - L.a) ** 2) / (2 * (L.w * 0.92) ** 2));
  // one forward lobe carries nearly all the light; the flanks and the back die away
  lb *= 0.10 + 0.90 * Math.exp(-(rel * rel) / (2 * 0.62 * 0.62));
  const gapN = noise2(Math.cos(rel) * 5.5 + 77, Math.sin(rel) * 5.5 + 13);
  if (gapN > 0.30) lb *= 0.30;
  LOBEB[i] = clamp(lb, 0.006, 3.0);
}
function lut(arr: Float32Array, rel: number) {
  const f = ((rel + Math.PI) / TAU) * NLUT;
  const i = f | 0;
  const t = f - i;
  return arr[i] * (1 - t) + arr[i + 1] * t;
}
const frontR = (rel: number) => R0 * lut(FRONT, rel);

// ---------------------------------------------------------------- struts
type Strut = {
  th: number; wPx: number; qLo: number; qHi: number;
  alive: boolean; bent: number; heat: number; stub: number;
};
const STRUTS: Strut[] = [];
{
  const r = mulberry(4711);
  for (let i = 0; i < NR; i++) {
    const th = i * DTH + (r() - 0.5) * DTH * 0.12;
    const wx = RCX + Math.cos(th) * 0.86 * RA * RCOS - Math.sin(th) * 0.86 * RB * RSIN;
    const wy = RCY + Math.cos(th) * 0.86 * RA * RSIN + Math.sin(th) * 0.86 * RB * RCOS;
    const dCore = Math.hypot(wx - CX, wy - CY);
    const rel = wrapPi(Math.atan2(wy - CY, wx - CX) - BASE);
    const reach = frontR(rel) / Math.max(1, dCore);
    const jn = r();
    // the blast cone shears a few ribs off; most of the ring still stands
    const deadProb = clamp(0.52 - Math.abs(rel) * 0.62, 0, 0.55);
    let alive = true, bent = 0, qLo = RIBQ0, qHi = 1.02, stub = 0;
    if (jn < deadProb) { alive = false; stub = 0.35 + 0.45 * r(); }
    else if (reach > 0.72) {
      bent = (0.4 + 1.2 * r()) * (jn < 0.5 ? -1 : 1);
      qLo = RIBQ0 + 0.10 * clamp((reach - 0.72) / 0.8);
      qHi = 1.02 - 0.22 * clamp((reach - 0.72) / 0.8);
    }
    STRUTS.push({
      th, wPx: 7.5 + r() * 4.5, qLo, qHi, alive, bent,
      heat: 0.28 + 0.72 * clamp(reach * 1.30), stub,
    });
  }
}
const NALIVE = STRUTS.filter((s) => s.alive).length;
let lastMask = 0;

// ---------------------------------------------------------------- debris
type Deb = { x: number; y: number; vx: number; vy: number; len: number; w: number; heat: number; bright: number; chunk: number };
const shards: Deb[] = [];
const embers: Deb[] = [];
{
  const r = mulberry(20261116);
  const live = STRUTS.filter((s) => s.alive);
  const dead = STRUTS.filter((s) => !s.alive);
  let placed = 0;
  while (placed < 760) {
    let sx: number, sy: number, ax: number, ay: number;
    const pick = r();
    if (pick < 0.34 && dead.length) {
      // chunks flung from the shattered sector
      const s = dead[(r() * dead.length) | 0];
      const qq = 0.58 + 0.44 * r();
      const lx = Math.cos(s.th) * qq * RA, ly = Math.sin(s.th) * qq * RB;
      sx = RCX + lx * RCOS - ly * RSIN;
      sy = RCY + lx * RSIN + ly * RCOS;
      const da = Math.atan2(sy - CY, sx - CX) + (r() - 0.5) * 0.9;
      ax = Math.cos(da); ay = Math.sin(da);
    } else if (pick < 0.52 && live.length) {
      const s = live[(r() * live.length) | 0];
      const qq = s.qLo + (s.qHi - s.qLo) * r();
      const lx = Math.cos(s.th) * qq * RA, ly = Math.sin(s.th) * qq * RB;
      sx = RCX + lx * RCOS - ly * RSIN;
      sy = RCY + lx * RSIN + ly * RCOS;
      const da = Math.atan2(sy - CY, sx - CX) + (r() - 0.5) * 0.8;
      ax = Math.cos(da); ay = Math.sin(da);
    } else {
      const t = Math.pow(r(), 2.2);
      const ang = BASE + (r() - 0.5) * (0.28 + 2.5 * (1 - t));
      const dist = frontR(wrapPi(ang - BASE)) * (0.85 + 0.85 * r());
      sx = CX + Math.cos(ang) * dist;
      sy = CY + Math.sin(ang) * dist;
      ax = Math.cos(ang); ay = Math.sin(ang);
    }
    const sp = 0.35 + r() * 0.65;
    const big = r() < 0.22;
    shards.push({
      x: sx, y: sy,
      vx: (ax + (r() - 0.5) * 0.20) * sp,
      vy: (ay + (r() - 0.5) * 0.20) * sp,
      len: (10 + r() * 48) * (0.35 + sp),
      w: big ? 1.9 + r() * 3.0 : 0.7 + r() * 1.2,
      heat: r(), bright: 0.55 + r() * 0.9, chunk: big ? 1 : 0,
    });
    placed++;
  }
  const knots = [0.0, 0.11, -0.08, 0.25, -0.21, 0.38, -0.42];
  for (let i = 0; i < 2200; i++) {
    const t = Math.pow(r(), 1.35);
    const ang = BASE + knots[i % knots.length] * (1 - t) + (r() - 0.5) * (0.38 + 1.9 * (1 - t));
    const dist = frontR(wrapPi(ang - BASE)) * (0.26 + 1.95 * r());
    const sp = 0.3 + r() * 0.7;
    embers.push({
      x: CX + Math.cos(ang) * dist, y: CY + Math.sin(ang) * dist,
      vx: Math.cos(ang + (r() - 0.5) * 0.16) * sp,
      vy: Math.sin(ang + (r() - 0.5) * 0.16) * sp,
      len: (8 + r() * 50) * (0.3 + sp) * (0.45 + t),
      w: 0.45 + r() * 0.9,
      heat: 0.4 + r() * 0.6, bright: 0.55 + r() * 1.1, chunk: 0,
    });
  }
}
const GS = 48;
const GDEN = new Float32Array(GS * GS);
for (const d of embers) {
  const gx = Math.min(GS - 1, Math.max(0, Math.floor((d.x / W) * GS)));
  const gy = Math.min(GS - 1, Math.max(0, Math.floor((d.y / H) * GS)));
  GDEN[gy * GS + gx] += d.bright;
}
for (let i = 0; i < GDEN.length; i++) GDEN[i] = Math.min(1.3, GDEN[i] / 34);
function gden(px: number, py: number) {
  const fx = clamp((px / W) * GS - 0.5, 0, GS - 1.001), fy = clamp((py / H) * GS - 0.5, 0, GS - 1.001);
  const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
  const a = GDEN[y0 * GS + x0], b = GDEN[y0 * GS + x0 + 1];
  const c = GDEN[(y0 + 1) * GS + x0], d = GDEN[(y0 + 1) * GS + x0 + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
const STARS: number[] = [];
{
  const r = mulberry(8081);
  const cl = [[90, 150], [200, 66], [54, 270], [286, 150], [66, 392], [396, 76], [146, 46], [444, 210], [36, 64], [520, 44], [996, 74], [1010, 210], [80, 990], [230, 940], [30, 860]];
  for (let i = 0; i < 78; i++) {
    const c = cl[i % cl.length];
    const a = r() * TAU, d = Math.pow(r(), 1.5) * 100;
    STARS.push(c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, 0.05 + Math.pow(r(), 3.8) * 0.6, r());
  }
}

// ---------------------------------------------------------------- radiance
const bufR = new Float32Array(N), bufG = new Float32Array(N), bufB = new Float32Array(N);
const t0 = Date.now();
const jit = [0.25, 0.75];
const out = new Float32Array(3);

function radiance(px: number, py: number, o: Float32Array) {
  let r = 0, g = 0, b = 0;
  const dxc = px - CX, dyc = py - CY;
  const dist = Math.sqrt(dxc * dxc + dyc * dyc);
  const rel = wrapPi(Math.atan2(dyc, dxc) - BASE);

  const gr = 0.0012 + 0.0028 * clamp(py / H * 0.80 + px / W * 0.20);
  r += gr * 0.36; g += gr * 0.54; b += gr * 1.20;

  // ---- shock front
  const Rf = frontR(rel);
  const s = dist - Rf;
  const LB = lut(LOBEB, rel);
  const arc = rel * Math.max(80, Rf);
  const stri = 0.46 + 0.54 * noise2(arc * 0.036, 13.7) + 0.26 * noise2(arc * 0.14, 3.1);

  if (s > -220 && s < 150) {
    const edge = 1 - sstep(-1.1, 0.45, s);
    const thk = 3.0 + 5.6 * Math.max(0, fbm(arc * 0.0085 + 3.3, 5.1, 2) + 0.42);
    const comp = Math.exp(-(((s + thk * 0.40) / thk) ** 2)) * 21.0;
    const tail = Math.exp(-Math.max(0, s + thk * 1.5) / 26) * 0.85;
    const amp = (comp + tail) * edge * LB * stri;
    const cool = clamp((-s - 6) / 70);
    r += amp * 1.00;
    g += amp * (0.62 - 0.34 * cool);
    b += amp * (0.22 - 0.18 * cool);

    if (s > -5) {
      const cy = Math.exp(-(((s - 12 - 7 * noise2(arc * 0.015, 9.2)) / 5.0) ** 2)) * 2.0 * LB * stri;
      r += cy * 0.08; g += cy * 0.66; b += cy * 1.85;
    }
    if (s > 0) {
      const sp2 = Math.max(0, fbm(arc * 0.044 + 9, 2.4, 2) + 0.24);
      const dust = Math.exp(-s / 42) * sp2 * 1.05 * LB;
      r += dust * 1.00; g += dust * 0.28; b += dust * 0.08;
    }
  }
  // ---- luminous gas: a broad band of compressed plasma just behind the shell.
  // This is what the ring's ribs silhouette against, so it must fill the aperture.
  if (s < 2 && s > -340) {
    const d = -s;
    const gas = Math.exp(-((d / 105) ** 2)) * 1.05 + Math.exp(-d / 300) * 0.34;
    const turb = 0.55 + 0.62 * fbm(arc * 0.013 + 41, d * 0.010 + 6, 3) + 0.22 * noise2(arc * 0.075, d * 0.05);
    const amp = gas * turb * LB;
    const hot2 = clamp(1 - d / 80);
    r += amp * (0.95 + 0.42 * hot2);
    g += amp * (0.40 + 0.52 * hot2);
    b += amp * (0.16 + 0.30 * hot2);
  }
  // ---- deep interior: near-black with sparse crimson filaments
  if (s < -40 && s > -430) {
    const k = Math.exp((-s - 40) / 150);
    const f = fbm(arc * 0.020 + 21, dist * 0.0026 + 7, 3);
    const fil = Math.pow(Math.max(0, 0.16 + 1.9 * f), 4.0);
    const amp = k * fil * 2.2 * Math.max(LB, 0.10);
    r += amp * 1.00; g += amp * 0.11; b += amp * 0.045;
  }

  // ---- the machinery ring: an open rib cage, not a filled band
  {
    const rx = px - RCX, ry = py - RCY;
    const lx = rx * RCOS + ry * RSIN;
    const ly = -rx * RSIN + ry * RCOS;
    const u = lx / RA, v = ly / RB;
    const q = Math.sqrt(u * u + v * v);
    lastMask = 0;
    if (q > 0.44 && q < 1.14) {
      const th = Math.atan2(v, u);
      const k = Math.round(th / DTH);
      const st = STRUTS[((k % NR) + NR) % NR];
      // v>0 is the near limb of the tilted disc
      const depth = 0.42 + 0.58 * clamp(0.5 + v * 2.4);
      const Rl = Math.max(70, Math.hypot(RA * Math.cos(th), RB * Math.sin(th)));
      const arcPx = wrapPi(th - st.th) * Rl;
      const w = st.wPx * depth;
      // radial extent of the rib: inner radius to outer radius
      const qA = st.qLo, qB = st.qHi;
      const inQ = sstep(qA - 0.012, qA + 0.010, q) * sstep(qB + 0.014, qB - 0.012, q);
      // two rims: thin plates that carry the ellipse read
      const rimOut = sstep(0.019, 0.005, Math.abs(q - 1.010)) * (0.55 + 0.45 * depth);
      const rimIn = sstep(0.015, 0.004, Math.abs(q - 0.590)) * (0.55 + 0.45 * depth);

      let m = 0;
      if (st.alive) {
        const shear = st.bent * sstep(qA, qB, q) * 7.0;
        // ribs are narrow: the gaps between them are wider than the ribs
        const body = sstep(w * 0.62, w * 0.46, Math.abs(arcPx - shear)) * inQ;
        m = Math.max(body, rimOut * 0.80, rimIn * 0.62);
      } else {
        // a raw stump left at one rim where the rib was torn away
        const qs = qA + st.stub * (qB - qA);
        const stump = sstep(w * 0.85, w * 0.30, Math.abs(arcPx)) *
          sstep(qA - 0.02, qA + 0.01, q) * sstep(qs + 0.01, qs - 0.02, q);
        m = Math.max(rimOut * 0.28, rimIn * 0.18, stump * 0.9);
      }

      if (m > 0.004) {
        lastMask = m;
        const occ = m * 0.94;
        r *= 1 - occ; g *= 1 - occ; b *= 1 - occ;
        const fire = gden(px, py);
        const brushed = 0.5 + 0.5 * noise2(px * 0.08, py * 0.11) + 0.34 * fbm(px * 0.019, py * 0.019, 2);
        // cold steel plate: high enough value to hold its silhouette against the gas
        const steel = (0.30 + 0.42 * brushed) * (0.62 + 0.38 * depth);
        r += m * steel * 0.80;
        g += m * steel * 1.00;
        b += m * steel * 1.42;
        // blast-facing face warms where the shock has washed over it
        const warm = m * steel * clamp(fire * 1.4 + 0.25 * clamp(1.5 - dist / (R0 * 3.0)));
        r += warm * 0.62; g += warm * 0.34; b += warm * 0.10;
        // knurled seam across each rib so it reads as a built member
        const seam = sstep(0.030, 0.0, Math.abs(q - (qA + 0.62 * (qB - qA)))) * inQ * m;
        r += seam * 0.10; g += seam * 0.16; b += seam * 0.26;
        // specular sheen along the rib's long edge
        const spec = sstep(w * 0.34, 0.0, Math.abs(Math.abs(arcPx) - w * 0.46)) * inQ;
        r += spec * (0.34 + 0.90 * fire);
        g += spec * (0.42 + 0.86 * fire);
        b += spec * (0.66 + 0.80 * fire);
      }
      if (st.alive) {
        const heatPick = clamp(1.5 - dist / (R0 * 3.0));
        const hotK = (0.16 + 1.8 * heatPick) * Math.max(LB, 0.10) * st.heat;
        // hot rim on the blast-facing end and edges of each rib
        const inner = sstep(0.020 * depth, 0.002, Math.abs(q - qA)) *
          sstep(w * 1.10, w * 0.28, Math.abs(arcPx));
        const outer = sstep(0.016 * depth, 0.002, Math.abs(q - qB)) *
          sstep(w * 0.95, w * 0.22, Math.abs(arcPx));
        const side = sstep(w * 0.12, 0.0, Math.abs(Math.abs(arcPx) - w * 0.94)) * inQ;
        const hot = (inner * 3.6 + outer * 2.4 + side * 0.6) * hotK * 2.7;
        r += hot * 1.00; g += hot * (0.33 + 0.30 * heatPick); b += hot * (0.05 + 0.33 * heatPick);
        const gl = Math.exp(-Math.abs(q - qA) / 0.026) *
          sstep(w * 3.2, w * 0.24, Math.abs(arcPx)) * hotK * 0.42;
        r += gl; g += gl * 0.21; b += gl * 0.055;
      }
    }
  }

  // ---- core
  {
    const tight = Math.exp(-((dist / 5.2) ** 2)) * 15.0;
    const bloom = Math.exp(-dist / 14) * 3.0;
    const wide = Math.exp(-dist / 80) * 0.30;
    const c = tight + bloom + wide;
    r += c * 1.00; g += c * 0.95; b += c * 0.84;
  }

  // ---- anamorphic streak
  {
    const along = dxc * DXL + dyc * DYL;
    const perp = -dxc * DYL + dyc * DXL;
    if (along > -600 && along < 2800) {
      const taper = along < 0 ? Math.exp(along / 80) : Math.exp(-along / 560);
      const flick = 0.64 + 0.52 * noise2(along * 0.0045, 4.2);
      const wv = 1.3 + Math.max(0, along) * 0.0054;
      const core = Math.exp(-((perp / wv) ** 2)) * taper * 4.2 * flick;
      const halo = Math.exp(-((perp / (wv * 6)) ** 2)) * taper * 0.16 * flick;
      r += core + halo * 0.88; g += core * 0.95 + halo * 0.86; b += core * 0.88 + halo * 0.82;
      const fr2 = Math.exp(-(((Math.abs(perp) - wv * 2.8) / (wv * 1.6)) ** 2)) * taper * 0.74 * flick;
      if (perp > 0) { g += fr2 * 0.44; b += fr2 * 0.86; } else { r += fr2 * 0.86; g += fr2 * 0.16; b += fr2 * 0.48; }
    }
    const al2 = along - 214;
    if (al2 > -360 && al2 < 2400) {
      const tp = al2 < 0 ? Math.exp(al2 / 116) : Math.exp(-al2 / 820);
      const gh = Math.exp(-((perp / 1.8) ** 2)) * tp * 0.07;
      r += gh * 0.38; g += gh * 0.54; b += gh * 1.0;
    }
  }

  o[0] = r; o[1] = g; o[2] = b;
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let ar = 0, ag = 0, ab = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        radiance(x + jit[sx], y + jit[sy], out);
        ar += out[0]; ag += out[1]; ab += out[2];
      }
    }
    const i = y * W + x;
    bufR[i] = ar / SPP; bufG[i] = ag / SPP; bufB[i] = ab / SPP;
  }
}

// ---- debris splat
function splat(list: Deb[], gain: number) {
  for (const d of list) {
    const ex = d.x - d.vx * d.len, ey = d.y - d.vy * d.len;
    const pad = d.w * 2.3 + 2;
    const x0 = Math.max(0, Math.floor(Math.min(ex, d.x) - pad));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ex, d.x) + pad));
    const y0 = Math.max(0, Math.floor(Math.min(ey, d.y) - pad));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ey, d.y) + pad));
    if (x1 < x0 || y1 < y0) continue;
    const vx = d.x - ex, vy = d.y - ey;
    const L2 = vx * vx + vy * vy + 1e-6;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5, sy = y + 0.5;
        let t = ((sx - ex) * vx + (sy - ey) * vy) / L2;
        t = clamp(t);
        const ddx = sx - (ex + vx * t), ddy = sy - (ey + vy * t);
        const dd = ddx * ddx + ddy * ddy;
        const tw = Math.max(0.32, d.w * (1 - t * 0.85));
        const lim = tw * 2.1;
        if (dd > lim * lim) continue;
        const trail = Math.exp(-dd / (tw * tw + 0.065)) * (1 - t * 0.60);
        const head = Math.exp(-dd / (d.w * d.w * 1.6 + 0.10));
        const k = (trail * 0.74 + head * 2.1) * gain * d.bright;
        const h = d.heat;
        const i = y * W + x;
        bufR[i] += k * (0.66 + h * 0.56);
        bufG[i] += k * (0.10 + h * h * 0.74);
        bufB[i] += k * (0.02 + h * h * h * 0.44);
      }
    }
  }
  for (const d of list) {
    if (!d.chunk) continue;
    const x0 = Math.max(0, Math.floor(d.x - d.w - 3)), x1 = Math.min(W - 1, Math.ceil(d.x + d.w + 3));
    const y0 = Math.max(0, Math.floor(d.y - d.w - 3)), y1 = Math.min(H - 1, Math.ceil(d.y + d.w + 3));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5, sy = y + 0.5;
        const ddx = sx - d.x, ddy = sy - d.y;
        const dd = ddx * ddx + ddy * ddy;
        const w = d.w * 0.8;
        if (dd > w * w * 4) continue;
        const core = Math.exp(-dd / (w * w));
        const i2 = y * W + x;
        const cover = clamp(core * 1.1) * 0.70;
        bufR[i2] *= 1 - cover * 0.86; bufG[i2] *= 1 - cover * 0.84; bufB[i2] *= 1 - cover * 0.80;
        const rimK = Math.exp(-Math.abs(Math.sqrt(dd) - w) / (w * 0.36 + 0.5)) * 0.78;
        bufR[i2] += rimK * 1.10; bufG[i2] += rimK * 0.38; bufB[i2] += rimK * 0.09;
      }
    }
  }
}
splat(shards, 0.75);
splat(embers, 0.42);

// ---- stars
for (let i = 0; i < STARS.length; i += 4) {
  const sx = STARS[i], sy = STARS[i + 1], sb = STARS[i + 2], sc = STARS[i + 3];
  const rad = sb > 0.34 ? 1.5 : 0.95;
  for (let y = Math.max(0, Math.floor(sy - 3)); y <= Math.min(H - 1, Math.ceil(sy + 3)); y++) {
    for (let x = Math.max(0, Math.floor(sx - 3)); x <= Math.min(W - 1, Math.ceil(sx + 3)); x++) {
      const ddx = x + 0.5 - sx, ddy = y + 0.5 - sy;
      const v = Math.exp(-(ddx * ddx + ddy * ddy) / (rad * rad)) * sb * 0.72;
      if (v < 0.0004) continue;
      const i2 = y * W + x;
      bufR[i2] += v * (0.64 + sc * 0.46);
      bufG[i2] += v * (0.80 + sc * 0.12);
      bufB[i2] += v * (1.16 - sc * 0.34);
    }
  }
}

function filmic(x: number) {
  const a = x * (2.51 * x + 0.03);
  const b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / b);
}
for (let i = 0; i < N; i++) {
  bufR[i] = filmic(bufR[i]); bufG[i] = filmic(bufG[i]); bufB[i] = filmic(bufB[i]);
}
for (let i = 0; i < N; i++) {
  const r = bufR[i], g = bufG[i], b = bufB[i];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sh = sstep(0.0, 0.036, L);
  const sat = 1.26;
  bufR[i] = clamp((r + (r - L) * (sat - 1)) * sh);
  bufG[i] = clamp((g + (g - L) * (sat - 1)) * sh);
  bufB[i] = clamp((b + (b - L) * (sat - 1)) * sh);
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.46875);
function quantise(): Uint8Array {
  const q = new Uint8Array(N * 3);
  for (let y = 0; y < H; y++) {
    const row = (y & 3) << 2;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const d = BAYER[row | (x & 3)] * (1.5 / 255);
      q[i * 3] = Math.round(clamp(bufR[i] + d) * 255);
      q[i * 3 + 1] = Math.round(clamp(bufG[i] + d) * 255);
      q[i * 3 + 2] = Math.round(clamp(bufB[i] + d) * 255);
    }
  }
  return q;
}

const CRCT = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const typeBuf = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);      // CRC = type + data only
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, c]);
}
function filterRows(px: Uint8Array, w: number, h: number) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  const cand: Buffer[] = [];
  for (let f = 0; f < 5; f++) cand.push(Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    cur.set(px.subarray(y * stride, y * stride + stride));
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const dst = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? cur[i - 3] : 0;
        const bb = prev[i];
        const c = i >= 3 ? prev[i - 3] : 0;
        let p = 0;
        if (f === 1) p = a;
        else if (f === 2) p = bb;
        else if (f === 3) p = (a + bb) >> 1;
        else if (f === 4) {
          const pp = a + bb - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
        }
        const v = (cur[i] - p) & 0xff;
        dst[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    prev.set(cur);
  }
  return raw;
}
function encodePNG(w: number, h: number, px: Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const idat = zlib.deflateSync(filterRows(px, w, h), { level: 9, memLevel: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function downscale(src: Uint8Array, sw: number, sh: number, dw: number) {
  const dst = new Uint8Array(dw * dw * 3);
  const f = sw / dw;
  for (let y = 0; y < dw; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = Math.floor(x * f), x1 = Math.max(x0 + 1, Math.floor((x + 1) * f));
      const y0 = Math.floor(y * f), y1 = Math.max(y0 + 1, Math.floor((y + 1) * f));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * sw + xx) * 3;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
      }
      const p = (y * dw + x) * 3;
      dst[p] = Math.round(r / n); dst[p + 1] = Math.round(g / n); dst[p + 2] = Math.round(b / n);
    }
  }
  return dst;
}

fs.mkdirSync(OUT, { recursive: true });
const rgb = quantise();
const png = encodePNG(W, H, rgb);
fs.writeFileSync(`${OUT}/entry.png`, png);
fs.writeFileSync(`${OUT}/thumb300.png`, encodePNG(300, 300, downscale(rgb, W, H, 300)));
fs.writeFileSync(`${OUT}/preview512.png`, encodePNG(512, 512, downscale(rgb, W, H, 512)));
const png2 = encodePNG(W, H, quantise());

{
  let sum = 0, hi9 = 0, hi5 = 0, sat = 0;
  for (let i = 0; i < N; i++) {
    const r = bufR[i], g = bufG[i], b = bufB[i];
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += L;
    if (L > 0.9) hi9++;
    if (L > 0.5) hi5++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx > 0 ? (mx - mn) / mx : 0;
  }
  console.log('struts alive', NALIVE, 'of', NR);
  console.log('bytes', png.length, 'under 1,020,000:', png.length <= 1020000);
  console.log('render ms', Date.now() - t0);
  console.log('mean luminance', (sum / N).toFixed(4));
  console.log('frac >0.9', (hi9 / N).toFixed(4), 'frac >0.5', (hi5 / N).toFixed(4));
  console.log('mean saturation', (sat / N).toFixed(4));
  console.log('byte-identical repeat:', Buffer.compare(png, png2) === 0);
}
