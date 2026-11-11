/** The widths generated for a local image, and requested from a CDN. */
export const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920, 2560];

/**
 * Widths no larger than the original. The original's own width is added when
 * it falls between two configured widths and is at least 15% wider than the
 * largest one kept, so a 1600px source is not capped at 1280. A source wider
 * than every configured width is capped at the largest.
 */
export function pickWidths(widths: number[], original: number): number[] {
  const kept = [...new Set(widths)].filter((w) => w <= original).sort((a, b) => a - b);
  const largest = kept.at(-1);
  if (largest === undefined) return [original];
  if (original < Math.max(...widths) && original >= largest * 1.15) kept.push(original);
  return kept;
}
