/* Heimdal safe-routing engine, JavaScript port of heimdal_routing/engine.py.
   Works in the browser (window.HeimdalEngine) and in Node (module.exports). */
(function (root) {
  "use strict";
  const WEIGHTS = {
    walk:  { light: 0.28, foot: 0.22, cctv: 0.08, police: 0.12, incident: 0.20, sidewalk: 0.10 },
    drive: { light: 0.30, foot: 0.12, cctv: 0.10, police: 0.18, incident: 0.30, sidewalk: 0.00 },
  };
  const WALK_DEFAULT = 1.33, WALK_PARK = 1.25;
  const DRIVE_KMH = { V2: 45, V3: 35, V4: 20, V5: 18, hwy: 55, bridge: 40 };
  const LAMBDAS = [0, 0.5, 1, 2, 3.5, 5, 8, 12, 20];
  const PERIOD_SHARE = { day: 10 / 24, evening: 4 / 24, night: 10 / 24 };

  function darkness(hour) {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 7 && h <= 17) return 0;
    if (h > 17 && h < 18.5) return (h - 17) / 1.5;
    if (h > 5.5 && h < 7) return (7 - h) / 1.5;
    return 1;
  }
  function periodOf(hour) {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 7 && h < 17) return "day";
    if (h >= 17 && h < 21) return "evening";
    return "night";
  }
  function congestion(hour) {
    const h = Math.floor(hour) % 24;
    if ([9, 10, 17, 18, 19].includes(h)) return 0.62;
    if ([8, 11, 12, 13, 16, 20].includes(h)) return 0.8;
    if (h >= 23 || h <= 5) return 1.1;
    return 0.95;
  }
  function interp(p, hour) {
    const h0 = Math.floor(hour) % 24, h1 = (h0 + 1) % 24, t = hour - Math.floor(hour);
    return p[h0] * (1 - t) + p[h1] * t;
  }
  function haversine(la1, lo1, la2, lo2) {
    const r = 6371008.8, rad = Math.PI / 180;
    const p1 = la1 * rad, p2 = la2 * rad, dp = p2 - p1, dl = (lo2 - lo1) * rad;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  class MinHeap {
    constructor() { this.a = []; }
    push(k, v) {
      const a = this.a; a.push([k, v]); let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    }
    get size() { return this.a.length; }
  }

  function createEngine(D) {
    const N = D.nodes.lat.length, E = D.edges.u.length, ed = D.edges;
    const C = D.codes;
    const adj = Array.from({ length: N }, () => []);
    const drivable = new Uint8Array(N);
    for (let k = 0; k < E; k++) {
      adj[ed.u[k]].push(ed.v[k], k); adj[ed.v[k]].push(ed.u[k], k);
      if (C.cls[ed.cls[k]] !== "park_path") drivable[ed.u[k]] = drivable[ed.v[k]] = 1;
    }
    const lat = D.nodes.lat, lon = D.nodes.lon;

    function lighting(k) {
      const lamps = ed.lamps[k];
      if (lamps >= 0) return Math.min(1, lamps / 2.5);
      const prior = (D.classLamps[C.cls[ed.cls[k]]] ?? 1.2) * (D.zoneLampMult[C.zone[ed.zone[k]]] ?? 0.8);
      return Math.min(1, 0.8 * prior / 2.5);
    }

    function model(mode, hour) {
      const w = WEIGHTS[mode], d = darkness(hour), per = periodOf(hour);
      const incArr = ed["inc_" + per], share = PERIOD_SHARE[per];
      const risk = new Float32Array(E), eff = new Float32Array(E), iso = new Uint8Array(E), time = new Float64Array(E);
      const parts = { L: new Float32Array(E), F: new Float32Array(E) };
      const cong = congestion(hour);
      for (let k = 0; k < E; k++) {
        const L = lighting(k);
        const F = Math.min(1, interp(D.profiles[C.landuse[ed.lu[k]]], hour) * ed.ffm[k]);
        const Cc = 1 - Math.exp(-ed.cams[k] / 4);
        const P = Math.exp(-ed.pol[k] / 700);
        const kmy = ed.len[k] / 1000 * 3 * share;
        const rate = (incArr[k] + 0.5) / (kmy + 1);
        const I = 1 - Math.exp(-rate / 1.2);
        const S = ed.sw[k] ? 1 : 0;
        let r = w.light * d * (1 - L) + w.foot * (1 - F) + w.cctv * (1 - Cc) + w.police * (1 - P)
              + w.incident * I + w.sidewalk * (1 - S);
        r = Math.min(1, Math.max(0, r));
        const isolated = d > 0.5 && F < 0.15 && L < 0.4;
        risk[k] = r; iso[k] = isolated ? 1 : 0;
        eff[k] = r + 0.15 * (1 - ed.conf[k]) + (isolated ? 0.25 : 0);
        parts.L[k] = L; parts.F[k] = F;
        const cls = C.cls[ed.cls[k]];
        if (mode === "walk") time[k] = ed.len[k] / (cls === "park_path" ? WALK_PARK : WALK_DEFAULT);
        else time[k] = cls === "park_path" ? Infinity : ed.len[k] / (DRIVE_KMH[cls] / 3.6 * cong);
      }
      return { mode, hour, risk, eff, iso, time, parts, period: per, dark: d };
    }

    function nearestNode(la, lo, mode) {
      const c = Math.cos(la * Math.PI / 180); let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (mode === "drive" && !drivable[i]) continue;
        const d = (lat[i] - la) ** 2 + ((lon[i] - lo) * c) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    function astar(src, dst, M, lam) {
      const vmax = (M.mode === "walk" ? WALK_DEFAULT : Math.max(...Object.values(DRIVE_KMH)) / 3.6 * 1.1) * 1.02;
      const tl = lat[dst], to = lon[dst];
      const h = (n) => 0.97 * haversine(lat[n], lon[n], tl, to) / vmax;
      const best = new Float64Array(N).fill(Infinity), prevN = new Int32Array(N).fill(-1),
            prevE = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
      best[src] = 0; const pq = new MinHeap(); pq.push(h(src), src);
      while (pq.size) {
        const [, n] = pq.pop();
        if (closed[n]) continue;
        if (n === dst) {
          const path = []; let x = n;
          while (x !== src) { path.push([prevN[x], prevE[x]]); x = prevN[x]; }
          return path.reverse();
        }
        closed[n] = 1; const a = adj[n], cost = best[n];
        for (let i = 0; i < a.length; i += 2) {
          const m = a[i], k = a[i + 1], t = M.time[k];
          if (!isFinite(t)) continue;
          const nc = cost + (lam === 0 ? t : t * (1 + lam * M.eff[k]));
          if (nc < best[m]) { best[m] = nc; prevN[m] = n; prevE[m] = k; pq.push(nc + h(m), m); }
        }
      }
      return null;
    }

    function build(path, M, lam) {
      const nodes = [path[0][0]], segs = [];
      let L = 0, T = 0, R = 0, RE = 0, lit = 0, unk = 0, isoM = 0, park = 0, conf = 0, inc = 0, maxR = 0;
      const names = {};
      for (const [a, k] of path) {
        const b = ed.u[k] === a ? ed.v[k] : ed.u[k]; nodes.push(b);
        const len = ed.len[k], r = M.risk[k], cls = C.cls[ed.cls[k]], litv = C.lit[ed.lit[k]];
        L += len; T += M.time[k]; R += r * len; RE += M.eff[k] * len; maxR = Math.max(maxR, r);
        if (litv === "yes") lit += len; if (litv === "unknown") unk += len;
        if (M.iso[k]) isoM += len; if (cls === "park_path") park += len;
        conf += ed.conf[k] * len; inc += ed["inc_" + M.period][k];
        const nm = C.name[ed.name[k]]; if (nm) names[nm] = (names[nm] || 0) + len;
        segs.push({ a, b, k, len, risk: r, cls, lit: litv, iso: !!M.iso[k], name: nm });
      }
      L = L || 1;
      const police = new Set();
      for (const n of nodes) D.police.forEach((p, i) => {
        if (Math.hypot((p.lat - lat[n]) * 110950, (p.lon - lon[n]) * 95660) < 300) police.add(i);
      });
      const meanRisk = R / L;
      return {
        lam, nodes, segs, coords: nodes.map((n) => [lat[n], lon[n]]),
        distance: Math.round(L), duration: Math.round(T), meanRisk, effRisk: RE / L, maxRisk: maxR,
        safety: Math.round(100 * (1 - meanRisk)), litPct: 100 * lit / L, unknownPct: 100 * unk / L,
        isolated: Math.round(isoM), park: Math.round(park), confidence: conf / L, incidents: inc,
        police: police.size,
        roads: Object.entries(names).sort((x, y) => y[1] - x[1]).slice(0, 3).map((x) => x[0]),
      };
    }

    function explain(f, o) {
      const out = [], dt = (o.duration - f.duration) / 60;
      if (Math.abs(dt) >= 0.5) out.push(`${dt > 0 ? "+" : ""}${Math.round(dt)} min vs fastest (${o.distance - f.distance >= 0 ? "+" : ""}${(o.distance - f.distance).toLocaleString("en-IN")} m)`);
      if (f.isolated - o.isolated >= 100) out.push(`Avoids ${(f.isolated - o.isolated).toLocaleString("en-IN")} m of dark, isolated stretches`);
      if (f.park - o.park >= 150) out.push(`Uses ${(f.park - o.park).toLocaleString("en-IN")} m less park or footpath`);
      if (o.litPct - f.litPct >= 5) out.push(`${Math.round(o.litPct)}% on recorded lit roads (fastest: ${Math.round(f.litPct)}%)`);
      if (o.police > f.police) out.push(`Passes ${o.police} police posts within 300 m (fastest: ${f.police})`);
      if (f.incidents > o.incidents) out.push(`${f.incidents - o.incidents} fewer recorded incidents for this time of day`);
      return out;
    }

    function plan(origin, destination, hour, mode = "walk", maxDetour = 1.5) {
      const M = model(mode, hour);
      const src = nearestNode(origin[0], origin[1], mode), dst = nearestNode(destination[0], destination[1], mode);
      if (src === dst) throw new Error("Start and destination are the same point. Pick two different places.");
      const cands = [], seen = new Set();
      for (const lam of LAMBDAS) {
        const p = astar(src, dst, M, lam);
        if (!p) throw new Error("No route found for this travel mode.");
        const sig = p.map((x) => x[1]).join(",");
        if (seen.has(sig)) continue; seen.add(sig);
        cands.push(build(p, M, lam));
      }
      const fastest = cands[0];
      let within = cands.filter((c) => c.duration <= maxDetour * fastest.duration);
      if (!within.length) within = [fastest];
      const safest = within.reduce((b, c) => (c.effRisk < b.effRisk || (c.effRisk === b.effRisk && c.duration < b.duration)) ? c : b);
      const pts = [...within].sort((a, b) => a.duration - b.duration);
      const front = []; let br = Infinity;
      for (const c of pts) if (c.effRisk < br - 1e-9) { front.push(c); br = c.effRisk; }
      const t0 = fastest.duration, t1 = safest.duration, r0 = fastest.effRisk, r1 = safest.effRisk;
      let balanced = safest;
      if (front.length > 2 && t1 > t0 && r0 > r1)
        balanced = front.reduce((b, c) => {
          const s = (x) => Math.hypot((x.duration - t0) / (t1 - t0), (x.effRisk - r1) / (r0 - r1));
          return s(c) < s(b) ? c : b;
        });
      const routes = { fastest };
      const distinct = [fastest, safest].every((o) => Math.abs(balanced.effRisk - o.effRisk) > 0.005 || Math.abs(balanced.duration - o.duration) > 30);
      if (balanced !== fastest && balanced !== safest && distinct) routes.balanced = balanced;
      routes.safest = safest;
      for (const [k, r] of Object.entries(routes)) { r.label = k; r.highlights = r === fastest ? [] : explain(fastest, r); }
      return { src, dst, hour, mode, routes, sameRoute: safest === fastest, candidates: cands.length, model: M };
    }

    return { plan, model, nearestNode, darkness, periodOf, N, E };
  }

  const api = { createEngine, darkness, periodOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HeimdalEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
