const ENTITIES: Record<string, string> = { '&': '&amp;', '"': '&quot;', "'": '&#x27;', '<': '&lt;', '>': '&gt;' };

/**
 * Escapes a value for a double-quoted HTML attribute. Only `&` and `"` are
 * required there; `'`, `<` and `>` are escaped too because React escapes
 * them, and the React components must render byte-identical markup.
 */
export function escapeAttr(value: string): string {
  return value.replace(/[&"'<>]/g, (c) => ENTITIES[c]);
}

/** An opening tag; `undefined` attributes are left out, every other value is escaped. */
export function tag(name: string, attrs: Record<string, string | number | undefined>): string {
  let html = `<${name}`;
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) html += ` ${key}="${escapeAttr(String(value))}"`;
  }
  return html + '>';
}

/** A srcset candidate list. Whitespace would end a URL inside srcset, so it is percent-encoded. */
export function srcset(candidates: { url: string; width: number }[]): string {
  return candidates.map(({ url, width }) => `${url.replace(/\s/g, encodeURIComponent)} ${width}w`).join(', ');
}

export function imgStyle(fit: string, position: string): string {
  return `display:block;width:100%;height:auto;object-fit:${fit};object-position:${position}`;
}

/** The `<img src>` for browsers that ignore srcset: the largest candidate up to 1280px wide. */
export function fallback<T extends { width: number }>(candidates: T[]): T {
  return candidates.filter((c) => c.width <= 1280).at(-1) ?? candidates[0];
}

const FITS = ['cover', 'contain', 'fill', 'none', 'scale-down'];
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Checks the two values that land in CSS unquoted, so neither can carry a `;`
 * and a second declaration into the style attribute.
 */
export function checkCss(fit: string, color: string | undefined): void {
  if (!FITS.includes(fit)) throw new Error(`medkit: fit "${fit}" is not one of ${FITS.join(', ')}`);
  if (color !== undefined && !HEX.test(color)) throw new Error(`medkit: color "${color}" is not a hex colour such as #1d2433`);
}
