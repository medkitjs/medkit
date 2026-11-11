import { MedkitImage } from './image-element.js';

export { MedkitImage };

if (!customElements.get('medkit-image')) customElements.define('medkit-image', MedkitImage);
