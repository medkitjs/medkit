// Loaded by <medkit-video-bg> only when a visitor presses expand, so the
// player's code never counts against the background's.

import './player.js';
import type { MedkitPlayer } from './player-element.js';

const players = new WeakMap<HTMLElement, MedkitPlayer>();

/**
 * Opens the clip's popup player at `at` seconds, from the markup
 * renderVideoBg() wrote into the clip's `player` attribute with
 * renderPlayer(), and returns focus to `opener` when it closes.
 */
export function expand(clip: HTMLElement, at: number, opener: HTMLElement): MedkitPlayer {
  let player = players.get(clip);
  if (!player) {
    const box = document.createElement('div');
    box.innerHTML = clip.getAttribute('player') ?? '';
    player = box.firstElementChild as MedkitPlayer;
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
