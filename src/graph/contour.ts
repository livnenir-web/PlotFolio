// Marching squares: isolines of a gridded function z[row][col] at x[col], y[row].

export type Polyline = [number, number][];

function interp(a: number, b: number, za: number, zb: number, level: number): number {
  if (!Number.isFinite(za) || !Number.isFinite(zb) || zb === za) return (a + b) / 2;
  return a + ((level - za) / (zb - za)) * (b - a);
}

/** Line segments for one level, joined into polylines (in data coordinates). */
const isoCache = new WeakMap<number[][], Map<number, Polyline[]>>();

/** Marching-squares isolines for one level. Cached per (z matrix identity, level). */
export function isolines(x: number[], y: number[], z: number[][], level: number): Polyline[] {
  let byLevel = isoCache.get(z);
  const hit = byLevel?.get(level);
  if (hit) return hit;
  const r = computeIsolines(x, y, z, level);
  if (!byLevel) isoCache.set(z, (byLevel = new Map()));
  if (byLevel.size > 200) byLevel.clear();
  byLevel.set(level, r);
  return r;
}

function computeIsolines(x: number[], y: number[], z: number[][], level: number): Polyline[] {
  const ny = y.length;
  const nx = x.length;
  const segs: [number, number, number, number][] = [];
  for (let r = 0; r < ny - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      const z00 = z[r][c];
      const z10 = z[r][c + 1];
      const z11 = z[r + 1][c + 1];
      const z01 = z[r + 1][c];
      if (![z00, z10, z11, z01].every(Number.isFinite)) continue;
      const idx = (z00 >= level ? 1 : 0) | (z10 >= level ? 2 : 0) | (z11 >= level ? 4 : 0) | (z01 >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = x[c];
      const x1 = x[c + 1];
      const y0 = y[r];
      const y1 = y[r + 1];
      // edge midpoints: bottom (00-10), right (10-11), top (01-11), left (00-01)
      const B: [number, number] = [interp(x0, x1, z00, z10, level), y0];
      const R: [number, number] = [x1, interp(y0, y1, z10, z11, level)];
      const T: [number, number] = [interp(x0, x1, z01, z11, level), y1];
      const L: [number, number] = [x0, interp(y0, y1, z00, z01, level)];
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (idx) {
        case 1:
        case 14:
          add(L, B);
          break;
        case 2:
        case 13:
          add(B, R);
          break;
        case 3:
        case 12:
          add(L, R);
          break;
        case 4:
        case 11:
          add(R, T);
          break;
        case 5: {
          const center = (z00 + z10 + z11 + z01) / 4;
          if (center >= level) {
            add(L, T);
            add(B, R);
          } else {
            add(L, B);
            add(R, T);
          }
          break;
        }
        case 6:
        case 9:
          add(B, T);
          break;
        case 7:
        case 8:
          add(L, T);
          break;
        case 10: {
          const center = (z00 + z10 + z11 + z01) / 4;
          if (center >= level) {
            add(L, B);
            add(R, T);
          } else {
            add(L, T);
            add(B, R);
          }
          break;
        }
      }
    }
  }
  return joinSegments(segs);
}

function key(px: number, py: number): string {
  return `${px.toPrecision(10)},${py.toPrecision(10)}`;
}

/** Chain segments sharing endpoints into polylines. */
function joinSegments(segs: [number, number, number, number][]): Polyline[] {
  const byPoint = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const arr = byPoint.get(k);
      if (arr) arr.push(i);
      else byPoint.set(k, [i]);
    }
  });
  const used = new Array(segs.length).fill(false);
  const out: Polyline[] = [];
  const next = (px: number, py: number): number => {
    const arr = byPoint.get(key(px, py));
    if (!arr) return -1;
    for (const i of arr) if (!used[i]) return i;
    return -1;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const s = segs[i];
    const line: Polyline = [
      [s[0], s[1]],
      [s[2], s[3]],
    ];
    // extend forward
    for (;;) {
      const [ex, ey] = line[line.length - 1];
      const j = next(ex, ey);
      if (j < 0) break;
      used[j] = true;
      const t = segs[j];
      line.push(key(t[0], t[1]) === key(ex, ey) ? [t[2], t[3]] : [t[0], t[1]]);
    }
    // extend backward
    for (;;) {
      const [sx, sy] = line[0];
      const j = next(sx, sy);
      if (j < 0) break;
      used[j] = true;
      const t = segs[j];
      line.unshift(key(t[0], t[1]) === key(sx, sy) ? [t[2], t[3]] : [t[0], t[1]]);
    }
    out.push(line);
  }
  return out;
}

/** Evenly spaced contour levels strictly inside [min, max]. */
export function autoLevels(min: number, max: number, count: number): number[] {
  const n = Math.max(1, Math.round(count));
  if (!(max > min)) return [min];
  return Array.from({ length: n }, (_, i) => min + ((max - min) * (i + 1)) / (n + 1));
}
