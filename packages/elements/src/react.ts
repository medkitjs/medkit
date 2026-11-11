import { createElement } from 'react';
import type { ImageManifest } from './manifest.js';
import { renderPicture, type RenderImageOptions } from './render.js';

export type ImageProps = RenderImageOptions & { manifest: ImageManifest };

/** `<medkit-image>` for React and Next.js; renders exactly what renderImage() writes. */
export function Image({ manifest, ...options }: ImageProps) {
  return createElement('medkit-image', {
    priority: options.priority ? '' : undefined,
    dangerouslySetInnerHTML: { __html: renderPicture(manifest, options) },
  });
}
