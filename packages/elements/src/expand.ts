// Loaded by <medkit-video-bg> only when a visitor presses expand, so the
// player's code never counts against the background's.

import './player.js';
import type { MedkitPlayer } from './player-element.js';

const players = new WeakMap<HTMLElement, MedkitPlayer>();

// Exactly what renderPlayer() writes for a popup. The markup arrives in an
// attribute, which an HTML sanitizer treats as text; parsing it unchecked
// would let anyone who can set that attribute add elements and handlers.
const ALLOWED: Record<string, string[]> = {
  'medkit-player': ['title', 'duration', 'sound', 'popup', 'hls', 'sources', 'labels', 'style'],
  video: ['controls', 'playsinline', 'preload', 'poster', 'width', 'height', 'crossorigin', 'style'],
  source: ['src', 'type'],
  track: ['kind', 'src', 'srclang', 'label', 'default'],
};
const URLS = ['src', 'poster', 'hls'];

/** The clip's popup from its `player` attribute, or nothing if it holds anything renderPlayer() would not write. */
function parse(markup: string): MedkitPlayer | undefined {
  // Template content is inert: nothing in it loads or runs while it is checked.
  const template = document.createElement('template');
  template.innerHTML = markup;
  const root = template.content.firstElementChild;
  const ok =
    template.content.childNodes.length === 1 &&
    root?.localName === 'medkit-player' &&
    [root, ...root.querySelectorAll('*')].every(
      (el) =>
        ALLOWED[el.localName] &&
        [...el.attributes].every(
          (a) => ALLOWED[el.localName].includes(a.name) && (!URLS.includes(a.name) || /^https?:$/.test(new URL(a.value, location.href).protocol)),
        ),
    );
  if (ok) return document.importNode(root, true) as MedkitPlayer;
  console.warn('<medkit-video-bg> expand: the clip\'s player attribute is not what renderVideoBg() writes; no popup opened');
}

/**
 * Opens the clip's popup player at `at` seconds, from the markup
 * renderVideoBg() wrote into the clip's `player` attribute with
 * renderPlayer(), and returns focus to `opener` when it closes.
 */
export function expand(clip: HTMLElement, at: number, opener: HTMLElement): MedkitPlayer | undefined {
  let player = players.get(clip);
  if (!player) {
    player = parse(clip.getAttribute('player') ?? '');
    if (!player) return;
    // Its thumbnail is never shown, but a modal dialog cannot open under
    // display:none; so it is hidden except while open, when the page is inert.
    player.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
    player.hidden = true;
    player.addEventListener('medkit-popupclose', () => (player!.hidden = true));
    document.body.append(player);
    players.set(clip, player);
  }
  player.hidden = false;
  player.open(at, opener);
  return player;
}
