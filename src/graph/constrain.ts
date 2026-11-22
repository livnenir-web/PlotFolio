// Shift held during a drag: movement stays on a line, as in other drawing programs.

/** Moving an object: only the larger of the two displacements counts, so it travels level or upright. */
export function axisLock(dx: number, dy: number): [number, number] {
  return Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
}

/**
 * Turning a line about its fixed end (ax, ay): the pointer (px, py) is put on the nearest allowed direction — the
 * multiples of 45°, and `keep` (radians), the direction the line had before the drag, so it can also just be made
 * longer or shorter along itself. `keep` is left out when it is within 5° of a 45° direction, which would win anyway.
 */
export function snapDirection(ax: number, ay: number, px: number, py: number, keep?: number): [number, number] {
  const dx = px - ax;
  const dy = py - ay;
  if (!dx && !dy) return [px, py];
  const step = Math.PI / 4;
  const dirs = Array.from({ length: 8 }, (_, i) => i * step);
  if (keep !== undefined && Number.isFinite(keep)) {
    const off = Math.abs(keep / step - Math.round(keep / step)) * 45;
    if (off > 5) dirs.push(keep, keep + Math.PI);
  }
  const at = Math.atan2(dy, dx);
  const gap = (a: number) => Math.abs(Math.atan2(Math.sin(a - at), Math.cos(a - at)));
  const best = dirs.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  // the foot of the pointer on that direction: the end follows the pointer along the line
  const len = Math.max(0, dx * Math.cos(best) + dy * Math.sin(best));
  return [ax + Math.cos(best) * len, ay + Math.sin(best) * len];
}
