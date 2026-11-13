import { MedkitVideoBg } from './video-bg-element.js';

export { MedkitVideoBg };

if (!customElements.get('medkit-video-bg')) customElements.define('medkit-video-bg', MedkitVideoBg);
