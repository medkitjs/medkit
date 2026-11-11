import { createElement, type ReactNode } from 'react';
import { renderPicture, type ImageProps } from './render.js';
import { clipAttrs, hostAttrs, posterPicture, type VideoBgProps, type VideoClip } from './render-video.js';

export type { ImageProps };

/** `<medkit-image>` for React and Next.js; renders exactly what renderImage() writes. */
export function Image({ manifest, ...options }: ImageProps) {
  return createElement('medkit-image', {
    priority: options.priority ? '' : undefined,
    dangerouslySetInnerHTML: { __html: renderPicture(manifest, options) },
  });
}

export type VideoBgClip = Omit<VideoClip, 'overlay'> & { overlay?: ReactNode };

/** A style attribute as the object React wants: `aspect-ratio:1` becomes `{ aspectRatio: '1' }`. */
const styleObject = ({ style, ...rest }: { style: string } & Record<string, unknown>) => ({
  ...rest,
  style: Object.fromEntries(style.split(';').map((d) => d.split(':')).map(([k, v]) => [k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()), v])),
});

/**
 * `<medkit-video-bg>` for React and Next.js. Renders exactly what
 * renderVideoBg() writes; each clip's overlay is React children here, and an
 * HTML string there.
 */
export function VideoBg({ clips, ...options }: Omit<VideoBgProps, 'clips'> & { clips: VideoBgClip[] }) {
  return createElement(
    'medkit-video-bg',
    styleObject(hostAttrs(clips, options)),
    ...clips.map((clip, i) =>
      createElement(
        'medkit-clip',
        { key: clip.video.id, ...styleObject(clipAttrs(clip, i, options)) },
        createElement('div', { style: { display: 'contents' }, dangerouslySetInnerHTML: { __html: posterPicture(clip, i, options) } }),
        clip.overlay == null ? null : createElement('div', { style: { position: 'relative' } }, clip.overlay),
      ),
    ),
  );
}
