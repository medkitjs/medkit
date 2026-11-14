// Covers renderPlayer(): the native <video> it writes for no JavaScript, which
// set it plays (the manifest's player set over the background's), source
// order, captions and when they need CORS, the attributes the element reads,
// refusals, escaping, and that the React component renders the same bytes.
//
// Not covered here: what the element does with this markup (Playwright player
// specs), and the Astro component (astro.test.ts).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { ImageManifest, VideoManifest } from '../src/manifest.js';
import { Player } from '../src/react.js';
import { renderPlayer, type PlayerVideo } from '../src/render-player.js';

function source(extra: Partial<VideoManifest> = {}): PlayerVideo {
  const video: VideoManifest = {
    v: 1,
    id: 'talk',
    kind: 'video',
    width: 1920,
    height: 1080,
    duration: 14.2,
    audio: false,
    poster: { id: 'talk-poster', color: '#1d2433' },
    mp4: [
      { src: 'talk-480p.mp4', width: 854, height: 480, codec: 'avc1.64001e', bytes: 1 },
      { src: 'talk-1080p.mp4', width: 1920, height: 1080, codec: 'avc1.640028', bytes: 1 },
    ],
    hash: 'abc',
    ...extra,
  };
  const rendition = (ext: string) => [640, 1280, 1920].map((w) => ({ src: `talk-poster-${w}.${ext}`, width: w, height: (w * 9) / 16, bytes: 1 }));
  const poster: ImageManifest = {
    v: 1, id: 'talk-poster', kind: 'image', width: 1920, height: 1080, color: '#1d2433',
    avif: rendition('avif'), webp: rendition('webp'), jpeg: rendition('jpg'), hash: 'def',
  };
  return { video, poster, title: 'A talk' };
}

const player = {
  audio: 'mp4a.40.2' as const,
  mp4: [
    { src: 'talk-player-720p.mp4', width: 1280, height: 720, codec: 'avc1.64001f', bytes: 1 },
    { src: 'talk-player-1080p.mp4', width: 1920, height: 1080, codec: 'avc1.640028', bytes: 1 },
  ],
  hls: 'talk-player/master.m3u8',
};

const attrs = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`<${name}((?:\\s+[a-z-]+(?:="[^"]*")?)*)>`, 'g'))].map(([, a]) =>
    Object.fromEntries([...a.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map(([, k, v = '']) => [k, v.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')])),
  );

test('with no JavaScript it is a native video with controls, its poster and its size, and loads nothing until played', () => {
  const [video] = attrs(renderPlayer(source(), { baseUrl: '/m/' }), 'video');
  expect(video).toMatchObject({ controls: '', playsinline: '', preload: 'none', poster: '/m/talk-poster-1280.webp', width: '1920', height: '1080' });
});

test("the manifest's player set, with sound and HLS, is played instead of the silent background set", () => {
  const html = renderPlayer(source({ player }), { baseUrl: '/m/' });
  const [host] = attrs(html, 'medkit-player');
  expect(host.hls).toBe('/m/talk-player/master.m3u8');
  expect(JSON.parse(host.sources).map((s: { src: string }) => s.src)).toEqual(['/m/talk-player-720p.mp4', '/m/talk-player-1080p.mp4']);
  expect(attrs(html, 'source')).toEqual([
    { src: '/m/talk-player/master.m3u8', type: 'application/vnd.apple.mpegurl' },
    { src: '/m/talk-player-720p.mp4', type: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"' },
    { src: '/m/talk-player-1080p.mp4', type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
  ]);
});

test('without HLS, the first source is the largest MP4 no wider than 1280 px, for browsers with no JavaScript', () => {
  const html = renderPlayer(source());
  expect(attrs(html, 'medkit-player')[0]).not.toHaveProperty('hls');
  expect(attrs(html, 'source').map((s) => s.src)).toEqual(['/media/talk-480p.mp4', '/media/talk-1080p.mp4']);
});

test('captions become tracks, and only a track from another origin adds crossorigin', () => {
  const en = { src: '/media/talk.en.vtt', srclang: 'en', label: 'English', default: true };
  const sr = { src: 'https://cdn.example.com/talk.sr.vtt', srclang: 'sr-Latn', label: 'Srpski' };
  const local = renderPlayer(source(), { captions: [en] });
  expect(attrs(local, 'track')).toEqual([{ kind: 'captions', src: '/media/talk.en.vtt', srclang: 'en', label: 'English', default: '' }]);
  expect(attrs(local, 'video')[0], 'same-origin track').not.toHaveProperty('crossorigin');
  expect(attrs(renderPlayer(source(), { captions: [en, sr] }), 'video')[0].crossorigin).toBe('anonymous');
});

test('popup and labels are attributes the element reads, and a quote in either cannot close its attribute', () => {
  const html = renderPlayer({ ...source(), title: '"><script>x</script>' }, { popup: true, labels: { play: 'Pusti "ovo"' } });
  expect(html).not.toContain('"><script>');
  const [host] = attrs(html, 'medkit-player');
  expect(host).toMatchObject({ popup: '', title: '"><script>x</script>', duration: '14.2' });
  expect(JSON.parse(host.labels)).toEqual({ play: 'Pusti "ovo"' });
});

test('bad input is refused rather than rendered half-right', () => {
  expect(() => renderPlayer({ ...source(), title: '' }), 'no title').toThrow(/needs a title/);
  expect(() => renderPlayer({ ...source(), poster: { ...source().poster, id: 'other' } }), 'wrong poster').toThrow(/was given poster "other"/);
  expect(() => renderPlayer({ ...source(), video: { ...source().video, v: 2 } as unknown as VideoManifest }), 'v2').toThrow(/format version 2/);
});

test('the React component renders exactly what renderPlayer() writes', () => {
  const s = { ...source({ player }), title: `Summer's "night"` };
  const options = { popup: true, captions: [{ src: '/c.vtt', srclang: 'en', label: 'English', default: true }], labels: { play: 'Pusti' } };
  expect(renderToStaticMarkup(createElement(Player, { ...s, ...options }))).toBe(renderPlayer(s, options));
});
