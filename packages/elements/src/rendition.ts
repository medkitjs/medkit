/**
 * The rendition to play from `list`, sorted smallest first: the smallest that
 * covers a `w` × `h` box, else the largest, then stepped down for bandwidth.
 *
 * - `downlink` (kbps) steps down to the largest rung it sustains, and is the
 *   only estimate that rules video out (undefined) when not even the smallest
 *   fits.
 * - `poster` (kbps, from the poster's download) steps down at most one rung and
 *   never rules video out: a file that small never reaches full speed, and
 *   read 414 kbps on a 1.5 Mbps link. The start rule covers the rest.
 */
export function pickRendition<T extends { width: number; height: number; kbps: number }>(
  list: T[],
  w: number,
  h: number,
  poster?: number,
  downlink?: number,
): T | undefined {
  if (!list.length || (downlink && downlink < list[0].kbps)) return;
  const fit = (kbps: number) => {
    let i = 0;
    list.forEach((s, j) => s.kbps <= kbps && (i = j));
    return i;
  };
  const size = list.findIndex((s) => s.width >= w && s.height >= h);
  const base = size < 0 ? list.length - 1 : size;
  let i = base;
  if (downlink) i = Math.min(i, fit(downlink));
  if (poster) i = Math.min(i, Math.max(base - 1, fit(poster)));
  return list[i];
}
