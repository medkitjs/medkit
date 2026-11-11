/** Escapes a value for a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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
