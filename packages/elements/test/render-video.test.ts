// Covers renderVideoBg(): the markup for one clip and for a playlist, the
// attributes the element reads, the poster with its blur, refusals for bad
// input, escaping, and that the React component renders the same bytes.
//
// Not covered here: what the element does with this markup, which the
// Playwright video-bg specs cover, and the Astro component (astro.test.ts).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { ImageManifest, VideoManifest } from '../src/manifest.js';
import { VideoBg } from '../src/react.js';
import { renderVideoBg, type VideoClip } from '../src/render-video.js';

const placeholder = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4IAYAAAAwAQCdASo=';

function clip(id: string, extra: Partial<VideoManifest> = {}): VideoClip {
  const video: VideoManifest = {
    v: 1,
    id,
    kind: 'video',
    width: 1920,
    height: 1080,
    duration: 14.2,
    audio: false,
    poster: { id: `${id}-poster`, placeholder, color: '#1d2433' },
    mp4: [
      { src: `${id}-480p.mp4`, width: 854, height: 480, codec: 'avc1.64001e', bytes: 1 },
      { src: `${id}-1080p.mp4`, width: 1920, height: 1080, codec: 'avc1.640028', bytes: 1 },
    ],
    hash: 'abc',
    ...extra,
  };
  const rendition = (ext: string) => [640, 1280].map((w) => ({ src: `${id}-poster-${w}.${ext}`, width: w, height: (w * 9) / 16, bytes: 1 }));
  const poster: ImageManifest = {
    v: 1, id: `${id}-poster`, kind: 'image', width: 1920, height: 1080, placeholder, color: '#1d2433',
    avif: rendition('avif'), webp: rendition('webp'), jpeg: rendition('jpg'), hash: 'def',
  };
  return { video, poster, title: `Clip ${id}` };
}

const attrs = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`<${name}((?:\\s+[a-z-]+="[^"]*")*)>`, 'g'))].map(([, a]) =>
    Object.fromEntries([...a.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')])),
  );

describe('renderVideoBg', () => {
  test('the element gets its controls and a fallback size from the first video', () => {
    const [host] = attrs(renderVideoBg([clip('festival')], { controls: 'pause sound' }), 'medkit-video-bg');
    expect(host).toEqual({ controls: 'pause sound', style: 'display:block;position:relative;overflow:hidden;aspect-ratio:1920 / 1080' });
  });

  test('each clip carries what the element needs: id, title, duration, renditions under baseUrl', () => {
    const [c] = attrs(renderVideoBg([clip('festival')], { baseUrl: 'https://cdn.example.com/m/' }), 'medkit-clip');
    expect(c).toMatchObject({ src: 'festival', title: 'Clip festival', duration: '14.2' });
    expect(JSON.parse(c.sources)).toEqual([
      { src: 'https://cdn.example.com/m/festival-480p.mp4', width: 854, height: 480, codec: 'avc1.64001e', kbps: 1 },
      { src: 'https://cdn.example.com/m/festival-1080p.mp4', width: 1920, height: 1080, codec: 'avc1.640028', kbps: 1 },
    ]);
    expect(c.audio, 'a silent clip claims audio').toBeUndefined();
  });

  test('each rendition carries its average bitrate, rounded up so a connection is never judged fast enough when it is not', () => {
    const video = { ...clip('a').video, duration: 10 };
    video.mp4 = [{ ...video.mp4[0], bytes: 1_000_001 }];
    const [c] = attrs(renderVideoBg([{ ...clip('a'), video }]), 'medkit-clip');
    expect(JSON.parse(c.sources)[0].kbps, '1,000,001 bytes over 10 s').toBe(801);
  });

  test('intro shows a colour and holds the first poster back in a noscript; later clips keep theirs', () => {
    const html = renderVideoBg([clip('a'), clip('b')], { intro: '#102030' });
    const [host] = attrs(html, 'medkit-video-bg');
    expect(host.intro).toBe('#102030');
    expect(host.style, 'the colour behind everything').toMatch(/;background:#102030$/);
    const [, held] = html.match(/<noscript>(<picture.*?<\/picture>)<\/noscript>/) ?? [];
    expect(held, 'the first poster, held in a noscript').toContain('a-poster-640.jpg');
    expect(html.replace(/<noscript>.*?<\/noscript>/, ''), 'a first poster outside the noscript').not.toContain('a-poster');
    expect(html, 'the second clip lost its poster').toContain('b-poster-640.jpg');
  });

  test('an intro colour cannot add a declaration or close its attribute', () => {
    for (const ok of ['black', '#000', 'rgb(0 0 0 / 50%)', 'oklch(0.2 0.1 250)']) expect(() => renderVideoBg([clip('a')], { intro: ok }), ok).not.toThrow();
    for (const bad of ['red;color:blue', 'url(x)', 'rgb(0,0,0);x:y', '"><script>', 'var(--x)', 'rgb(calc(1))'])
      expect(() => renderVideoBg([clip('a')], { intro: bad }), bad).toThrow(/not a CSS colour/);
  });

  test('a clip that kept audio is marked for the sound button, and a poster time becomes the start', () => {
    const [c] = attrs(renderVideoBg([clip('talk', { audio: 'mp4a.40.2', poster: { id: 'talk-poster', color: '#1d2433', at: 3.5 } })]), 'medkit-clip');
    expect(c).toMatchObject({ audio: '', start: '3.5' });
  });

  test('with no JavaScript only the first clip shows; the others are hidden until the element takes over', () => {
    const clips = attrs(renderVideoBg([clip('a'), clip('b'), clip('c')], { autoadvance: true }), 'medkit-clip');
    expect(clips.map((c) => c.hidden)).toEqual([undefined, '', '']);
    expect(attrs(renderVideoBg([clip('a'), clip('b')], { autoadvance: true }), 'medkit-video-bg')[0].autoadvance).toBe('');
  });

  test('the poster fills the clip over its blur, decorative, with AVIF and WebP sources', () => {
    const html = renderVideoBg([clip('festival')]);
    expect(attrs(html, 'picture')[0].style).toBe(`display:block;position:absolute;inset:0;background:#1d2433 url(${placeholder}) center/cover no-repeat`);
    expect(attrs(html, 'source').map((s) => s.type)).toEqual(['image/avif', 'image/webp']);
    expect(attrs(html, 'img')[0]).toMatchObject({ alt: '', loading: 'lazy', src: '/media/festival-poster-1280.jpg' });
  });

  test('priority makes only the first poster eager and high priority', () => {
    const imgs = attrs(renderVideoBg([clip('a'), clip('b')], { priority: true }), 'img');
    expect(imgs.map((i) => [i.loading, i.fetchpriority])).toEqual([['eager', 'high'], ['lazy', undefined]]);
  });

  test('an overlay is placed above the poster inside its clip', () => {
    const html = renderVideoBg([{ ...clip('a'), overlay: '<h2>Summer on the river</h2>' }]);
    expect(html).toContain('<div style="position:relative"><h2>Summer on the river</h2></div></medkit-clip>');
  });

  test('a title with quotes in it cannot close the attribute it sits in', () => {
    const html = renderVideoBg([{ ...clip('a'), title: `"><script>alert(1)</script>` }]);
    expect(html).not.toContain('"><script>');
    expect(attrs(html, 'medkit-clip')[0].title).toBe('"><script>alert(1)</script>');
  });

  test('labels are written as one JSON attribute that a quote in a label cannot close', () => {
    const labels = { next: 'Sledeći video', announce: '"><b>x</b> {title}' };
    const html = renderVideoBg([clip('a')], { labels });
    expect(html).not.toContain('"><b>');
    expect(JSON.parse(attrs(html, 'medkit-video-bg')[0].labels)).toEqual(labels);
    expect(attrs(renderVideoBg([clip('a')]), 'medkit-video-bg')[0], 'no labels, no attribute').not.toHaveProperty('labels');
  });

  test('bad input is refused rather than rendered half-right', () => {
    expect(() => renderVideoBg([]), 'no clips').toThrow(/at least one clip/);
    expect(() => renderVideoBg([{ ...clip('a'), title: '' }]), 'no title').toThrow(/needs a title/);
    expect(() => renderVideoBg([{ ...clip('a'), poster: clip('b').poster }]), 'wrong poster').toThrow(/was given poster "b-poster", not "a-poster"/);
    expect(() => renderVideoBg([{ ...clip('a'), video: { ...clip('a').video, v: 2 } as unknown as VideoManifest }]), 'v2').toThrow(/format version 2/);
    expect(() => renderVideoBg([{ ...clip('a'), poster: { ...clip('a').poster, color: 'red;x:y' } }]), 'colour').toThrow(/not a hex colour/);
  });
});

test('the React component renders exactly what renderVideoBg() writes', () => {
  const clips = [{ ...clip('a'), title: "Summer's \"night\"" }, clip('b', { audio: 'mp4a.40.2' })];
  const options = { controls: 'pause nav', autoadvance: true, priority: true, intro: 'black', labels: { next: 'Sledeći "video"' } };
  const react = renderToStaticMarkup(
    createElement(VideoBg, { ...options, clips: [{ ...clips[0], overlay: createElement('h2', null, 'Hi & bye') }, clips[1]] }),
  );
  expect(react).toBe(renderVideoBg([{ ...clips[0], overlay: '<h2>Hi &amp; bye</h2>' }, clips[1]], options));
});
