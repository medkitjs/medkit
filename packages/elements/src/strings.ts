import { registry } from './registry.js';

/**
 * Every visible and screen-reader label of <medkit-video-bg>, in English.
 * Placeholders such as {current} keep word order translatable. Keys share one
 * namespace with the player's table, because configure({ labels }) and
 * registerLocale() take both.
 */
export const strings = {
  playBackground: 'Play background video',
  pauseBackground: 'Pause background video',
  soundOn: 'Turn sound on',
  soundOff: 'Turn sound off',
  expand: 'Expand video',
  prev: 'Previous video',
  next: 'Next video',
  position: '{current} / {total}',
  /** The position as screen readers hear it; "1 / 3" is read "1 slash 3". */
  spokenPosition: '{current} of {total}',
  announce: '{title}, {current} of {total}',
};

export type Labels = Record<string, string>;

const own = new WeakMap<Element, Labels>();

/**
 * `defaults[key]` with its {placeholders} filled in, overridden in this order:
 * the element's `labels` attribute (JSON), the locale registered for its
 * nearest `lang` (then that tag's language alone, `sr` for `sr-Latn`), and
 * configure({ labels }).
 */
export function label(defaults: Labels, key: string, values: Record<string, string | number>, el: Element) {
  let mine = own.get(el);
  if (!mine) {
    try {
      mine = JSON.parse(el.getAttribute('labels') || '{}') as Labels;
    } catch {
      console.warn(`medkit: <${el.localName}> labels is not JSON; using the defaults`);
      mine = {};
    }
    own.set(el, mine);
  }
  const lang = el.closest('[lang]')?.getAttribute('lang')?.toLowerCase() ?? '';
  const { locales, labels } = registry;
  const text = mine[key] ?? locales[lang]?.[key] ?? locales[lang.split('-')[0]]?.[key] ?? labels[key] ?? defaults[key];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
