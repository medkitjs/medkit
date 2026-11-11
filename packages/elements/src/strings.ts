/**
 * Every visible and screen-reader label, in English. Placeholders such as
 * {current} keep word order translatable; M3 adds configure({ labels }) and
 * registerLocale() on top of this table.
 */
export const strings = {
  play: 'Play background video',
  pause: 'Pause background video',
  soundOn: 'Turn sound on',
  soundOff: 'Turn sound off',
  prev: 'Previous video',
  next: 'Next video',
  position: '{current} / {total}',
  announce: '{title}, {current} of {total}',
};

/** A label with its {placeholders} filled in. */
export const label = (key: keyof typeof strings, values: Record<string, string | number> = {}) =>
  strings[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
