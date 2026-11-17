import { MedkitPlayer } from './player-element.js';

export { MedkitPlayer };

if (!customElements.get('medkit-player')) customElements.define('medkit-player', MedkitPlayer);
