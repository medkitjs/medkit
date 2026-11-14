// Server-side rendering for <medkit-video-bg>: pure functions from video and
// poster manifests to HTML, with no DOM and no ffmpeg. The output shows each
// clip's poster, blur and overlay with no JavaScript; the element adds video.
//
// The markup is byte-identical to what the React component renders, so the
// two are interchangeable; that is why styles and boolean attributes are
// written exactly as React writes them.

import { checkColour, checkCss, fallback, srcset, tag } from './html.js';
import type { ImageManifest, VideoManifest } from './manifest.js';
import type { Labels } from './strings.js';
import { read, urls } from './render.js';
import { renderPlayer, type Caption } from './render-player.js';

export interface VideoClip {
  video: VideoManifest;
  /** The poster's own image manifest, whose id the video manifest names. */
  poster: ImageManifest;
  /** Announced on manual changes ("Crowd at night, 2 of 4"); required. */
  title: string;
  /** HTML shown over the clip, such as a heading and a link; trusted, not escaped. */
  overlay?: string;
  /** Caption tracks for the popup that `expand` opens. */
  captions?: Caption[];
}

export interface RenderVideoBgOptions {
  /** Space-separated: `pause`, `sound`, `expand`, `nav`. Default `pause`. */
  controls?: string;
  /** Start the next clip when one ends, instead of looping. */
  autoadvance?: boolean;
  /** The first poster loads eagerly with `fetchpriority="high"`, for a hero. */
  priority?: boolean;
  /** Where the files are served from, ending in `/`; default `/media/`. */
  baseUrl?: string;
  /** How wide the poster displays; default `100vw`. */
  sizes?: string;
  /**
   * A CSS colour shown instead of the first clip's poster. The poster is then
   * fetched only when no video will play: reduced motion, Save-Data, 2G, too
   * little bandwidth, refused autoplay, or no JavaScript.
   */
  intro?: string;
  /** Overrides for this element's labels, by key, such as `{ next: 'Sledeći video' }`. */
  labels?: Labels;
}

export type VideoBgProps = RenderVideoBgOptions & { clips: VideoClip[] };

/** The `<medkit-video-bg>` element's own attributes, in the order React writes them. */
export function hostAttrs(clips: Pick<VideoClip, 'video'>[], { controls = 'pause', autoadvance, intro, labels }: RenderVideoBgOptions) {
  if (!clips.length) throw new Error('medkit: renderVideoBg needs at least one clip');
  const { width, height } = read(clips[0].video);
  if (intro !== undefined) checkColour('intro', intro);
  return {
    controls,
    autoadvance: autoadvance ? '' : undefined,
    intro,
    labels: labels && JSON.stringify(labels),
    // A fallback size, so the background has a box with no CSS; any author
    // height wins over it.
    style: `display:block;position:relative;overflow:hidden;aspect-ratio:${width} / ${height}${intro ? `;background:${intro}` : ''}`,
  };
}

/** One `<medkit-clip>`'s attributes, in the order React writes them. */
export function clipAttrs({ video, poster, title, captions }: Omit<VideoClip, 'overlay'>, i: number, { baseUrl = '/media/', controls = 'pause', labels }: RenderVideoBgOptions) {
  const v = read(video);
  if (typeof title !== 'string' || !title) throw new Error(`medkit: clip "${v.id}" needs a title, which is announced`);
  if (read(poster).id !== v.poster.id) throw new Error(`medkit: clip "${v.id}" was given poster "${poster.id}", not "${v.poster.id}"`);
  return {
    src: v.id,
    title,
    duration: v.duration,
    audio: v.audio ? '' : undefined,
    start: v.poster.at,
    // Average kbps, from the two fields that already define it, so the element
    // can skip a rendition the connection cannot sustain.
    sources: JSON.stringify(
      v.mp4.map((r) => ({ src: baseUrl + r.src, width: r.width, height: r.height, codec: r.codec, kbps: Math.ceil((r.bytes * 8) / v.duration / 1000) })),
    ),
    // The popup expand opens, as renderPlayer() writes it: the manifest's
    // player set with sound when it has one. Read only on expand.
    player: controls.split(/\s+/).includes('expand') ? renderPlayer({ video, poster, title }, { baseUrl, captions, popup: true, labels }) : undefined,
    // Only the first clip shows with no JavaScript; the element shows the rest.
    hidden: i ? '' : undefined,
    style: 'display:block;position:absolute;inset:0',
  };
}

/**
 * A clip's poster: a `<picture>` that fills the clip, with the blur behind it.
 * An intro clip's sits in a `<noscript>`: shown with no JavaScript, and plain
 * text otherwise, which the element parses when no video will play. Not a
 * `<template>`: Firefox's speculative parser fetches images inside one.
 */
export function posterPicture(clip: Pick<VideoClip, 'video' | 'poster'>, i: number, options: RenderVideoBgOptions) {
  const html = picture(clip, i, options);
  return options.intro && !i ? `<noscript>${html}</noscript>` : html;
}

function picture({ video, poster }: Pick<VideoClip, 'video' | 'poster'>, i: number, { priority, baseUrl = '/media/', sizes = '100vw' }: RenderVideoBgOptions) {
  checkCss('cover', poster.color);
  const blur = video.poster.placeholder ? ` url(${video.poster.placeholder}) center/cover no-repeat` : '';
  const eager = priority && i === 0;
  const jpeg = urls(poster.jpeg, baseUrl);
  return (
    tag('picture', { style: `display:block;position:absolute;inset:0;background:${poster.color}${blur}` }) +
    tag('source', { type: 'image/avif', srcset: srcset(urls(poster.avif, baseUrl)), sizes }) +
    tag('source', { type: 'image/webp', srcset: srcset(urls(poster.webp, baseUrl)), sizes }) +
    tag('img', {
      src: fallback(jpeg).url,
      srcset: srcset(jpeg),
      sizes,
      width: poster.width,
      height: poster.height,
      // The background is decorative; the clip's title and overlay carry its meaning.
      alt: '',
      loading: eager ? 'eager' : 'lazy',
      fetchpriority: eager ? 'high' : undefined,
      decoding: 'async',
      style: 'display:block;width:100%;height:100%;object-fit:cover',
    }) +
    '</picture>'
  );
}

/** The finished `<medkit-video-bg>`: posters, blur and overlays that work with no JavaScript. */
export function renderVideoBg(clips: VideoClip[], options: RenderVideoBgOptions = {}): string {
  let html = tag('medkit-video-bg', hostAttrs(clips, options));
  clips.forEach((clip, i) => {
    html += tag('medkit-clip', clipAttrs(clip, i, options));
    html += `<div style="display:contents">${posterPicture(clip, i, options)}</div>`;
    if (clip.overlay) html += `<div style="position:relative">${clip.overlay}</div>`;
    html += '</medkit-clip>';
  });
  return html + '</medkit-video-bg>';
}
