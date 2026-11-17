// The development build of <medkit-player>: the same element plus console
// warnings. Bundlers pick it through the "development" export condition; plain
// HTML pages load player-dev.js directly. Load one build or the other, never
// both: whichever registers <medkit-player> first wins.

import { MedkitPlayer } from './player-element.js';

const warn = (message: string, element: Element) => console.warn(`<medkit-player> ${message}`, element);

class MedkitPlayerDev extends MedkitPlayer {
  override connectedCallback() {
    super.connectedCallback();
    if (!this.getAttribute('title')) warn('has no title, which names it for screen readers and names its popup', this);
    // `sound` comes from renderPlayer(), which knows from the manifest.
    const video = this.querySelector('video');
    if (video && this.hasAttribute('sound') && !video.querySelector('track[kind=captions], track[kind=subtitles]')) {
      warn('plays a video with sound and no captions track; pass captions to renderPlayer()', this);
    }
  }
}

if (!customElements.get('medkit-player')) customElements.define('medkit-player', MedkitPlayerDev);
