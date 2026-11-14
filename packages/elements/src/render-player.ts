// Server-side rendering for <medkit-player>: a pure function from a video's
// manifests to HTML, with no DOM. The output is a native <video controls> that
// plays with no JavaScript; the element replaces its controls. For YouTube or
// Vimeo it is a link to the video around its build-time thumbnail, which the
// element turns into a facade.
//
// The markup is byte-identical to what the React component renders, so the
// two are interchangeable.

import { fallback, tag } from './html.js';
import type { ImageManifest, VideoManifest } from './manifest.js';
import { read, renderPicture, urls } from './render.js';
import type { Labels } from './strings.js';

export interface Caption {
  /** URL of a WebVTT file, used as written (not under `baseUrl`). */
  src: string;
  /** BCP 47 language tag, such as `en` or `sr-Latn`. */
  srclang: string;
  /** Shown in the captions menu, such as `English`. */
  label: string;
  /** Shown without the visitor choosing it. At most one track should have it. */
  default?: boolean;
}

export interface PlayerVideo {
  video: VideoManifest;
  /** The poster's own image manifest, whose id the video manifest names. */
  poster: ImageManifest;
  /** Names the popup and its button ("Play Summer on the river"); required. */
  title: string;
}

/** A YouTube or Vimeo video, shown as its thumbnail until the visitor presses play. */
export interface PlayerEmbed {
  provider: 'youtube' | 'vimeo';
  /** The provider's video id: 11 characters for YouTube, digits for Vimeo. */
  id: string;
  /** The thumbnail's image manifest, from `medkit thumbnail youtube:<id>`. */
  poster: ImageManifest;
  /** Names the play button, the iframe and the popup; required. */
  title: string;
}

const EMBED_IDS = { youtube: /^[A-Za-z0-9_-]{11}$/, vimeo: /^\d+$/ };
const WATCH = { youtube: 'https://www.youtube.com/watch?v=', vimeo: 'https://vimeo.com/' };

export interface RenderPlayerOptions {
  /** Where the files are served from, ending in `/`; default `/media/`. */
  baseUrl?: string;
  captions?: Caption[];
  /** Show a thumbnail button that opens the player in a dialog. */
  popup?: boolean;
  /** Overrides for this element's labels, by key, such as `{ play: 'Pusti' }`. */
  labels?: Labels;
  /** How wide a YouTube or Vimeo thumbnail displays; default `100vw`. */
  sizes?: string;
}

export type PlayerSource = PlayerVideo | PlayerEmbed;
export type PlayerProps = RenderPlayerOptions & PlayerSource;

const isEmbed = (source: PlayerSource): source is PlayerEmbed => 'provider' in source;

// A track from another origin can only be read with CORS, which the browser
// asks for only when the media element itself has `crossorigin`.
const crossOrigin = (src: string) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src);

/** The `<medkit-player>` element's own attributes, in the order React writes them. */
export function playerAttrs(source: PlayerSource, { baseUrl = '/media/', popup, labels }: RenderPlayerOptions) {
  const { title } = source;
  if (isEmbed(source)) {
    const { provider, id } = source;
    if (!EMBED_IDS[provider]) throw new Error(`medkit: provider "${provider}" is not youtube or vimeo`);
    if (!EMBED_IDS[provider].test(id)) throw new Error(`medkit: "${id}" is not a ${provider} video id`);
    if (typeof title !== 'string' || !title) throw new Error(`medkit: ${provider} video "${id}" needs a title, which names its iframe`);
    return { provider, 'video-id': id, title, popup: popup ? '' : undefined, labels: labels && JSON.stringify(labels), style: 'display:block;position:relative' };
  }
  const v = read(source.video);
  if (typeof title !== 'string' || !title) throw new Error(`medkit: player "${v.id}" needs a title, which names its popup`);
  const set = v.player ?? v;
  return {
    title,
    duration: v.duration,
    // Read by the development build, which warns when a video with sound has no captions.
    sound: set.audio ? '' : undefined,
    popup: popup ? '' : undefined,
    hls: set.hls && baseUrl + set.hls,
    // Sizes and codecs, so the element can pick a rendition by size without
    // requesting any of them first.
    sources: JSON.stringify(set.mp4.map((r) => ({ src: baseUrl + r.src, width: r.width, height: r.height, codec: r.codec }))),
    labels: labels && JSON.stringify(labels),
    style: 'display:block;position:relative',
  };
}

/**
 * What goes inside `<medkit-player>`: a `<video controls>` that works with no
 * JavaScript, or for YouTube and Vimeo a link to the video around its thumbnail.
 */
export function playerInner(source: PlayerSource, { baseUrl = '/media/', captions = [], sizes }: RenderPlayerOptions) {
  if (isEmbed(source)) {
    const picture = renderPicture(source.poster, { alt: source.title, baseUrl, sizes });
    return tag('a', { href: WATCH[source.provider] + source.id, style: 'display:block' }) + picture + '</a>';
  }
  const { video, poster } = source;
  const v = read(video);
  if (read(poster).id !== v.poster.id) throw new Error(`medkit: player "${v.id}" was given poster "${poster.id}", not "${v.poster.id}"`);
  const set = v.player ?? v;
  const audio = set.audio ? `, ${set.audio}` : '';
  // With no JavaScript the browser plays the first source it can: HLS where
  // it plays HLS itself, else an MP4 no wider than 1280 px.
  const mp4 = [...set.mp4].sort((a, b) => a.width - b.width);
  const first = fallback(mp4);
  let html = tag('video', {
    controls: '',
    playsinline: '',
    preload: 'none',
    poster: fallback(urls(poster.webp, baseUrl)).url,
    width: v.width,
    height: v.height,
    crossorigin: captions.some((c) => crossOrigin(c.src)) ? 'anonymous' : undefined,
    style: 'display:block;width:100%;height:auto',
  });
  if (set.hls) html += tag('source', { src: baseUrl + set.hls, type: 'application/vnd.apple.mpegurl' });
  for (const r of [first, ...mp4.filter((r) => r !== first)]) {
    html += tag('source', { src: baseUrl + r.src, type: `video/mp4; codecs="${r.codec}${audio}"` });
  }
  for (const c of captions) {
    html += tag('track', { kind: 'captions', src: c.src, srclang: c.srclang, label: c.label, default: c.default ? '' : undefined });
  }
  return html + '</video>';
}

/** The finished `<medkit-player>`: a native video player until the element takes over. */
export function renderPlayer(source: PlayerSource, options: RenderPlayerOptions = {}): string {
  return tag('medkit-player', playerAttrs(source, options)) + playerInner(source, options) + '</medkit-player>';
}
