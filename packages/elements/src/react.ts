import { createElement } from 'react';
import { renderPicture, type ImageProps } from './render.js';

export type { ImageProps };

/** `<medkit-image>` for React and Next.js; renders exactly what renderImage() writes. */
export function Image({ manifest, ...options }: ImageProps) {
  return createElement('medkit-image', {
    priority: options.priority ? '' : undefined,
    dangerouslySetInnerHTML: { __html: renderPicture(manifest, options) },
  });
}
