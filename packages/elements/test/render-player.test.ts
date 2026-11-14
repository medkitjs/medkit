// Covers renderPlayer(): the native <video> it writes for no JavaScript, which
// set it plays (the manifest's player set over the background's), source
// order, captions and when they need CORS, the attributes the element reads,
// refusals, escaping, the YouTube and Vimeo facade's markup, and that the
// React component renders the same bytes.
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

const thumbnail = (id: string): ImageManifest => ({ ...source().poster, id });

test('a YouTube or Vimeo video renders as a link to it around its local thumbnail, so it works with no JavaScript', () => {
  const html = renderPlayer({ provider: 'youtube', id: 'dQw4w9WgXcQ', title: 'A talk', poster: thumbnail('youtube-dQw4w9WgXcQ') }, { popup: true });
  expect(attrs(html, 'medkit-player')[0]).toMatchObject({ provider: 'youtube', 'video-id': 'dQw4w9WgXcQ', title: 'A talk', popup: '' });
  expect(attrs(html, 'a')[0].href).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  expect(attrs(html, 'img')[0]).toMatchObject({ alt: 'A talk', src: '/media/talk-poster-1280.jpg' });
  expect(html, 'nothing from the provider before a click').not.toMatch(/ytimg|youtube-nocookie|<iframe/);
  const vimeo = renderPlayer({ provider: 'vimeo', id: '76979871', title: 'A film', poster: thumbnail('vimeo-76979871') });
  expect(attrs(vimeo, 'a')[0].href).toBe('https://vimeo.com/76979871');
});

test('a provider video id that could change the URL, or a missing title, is refused', () => {
  const poster = thumbnail('x');
  expect(() => renderPlayer({ provider: 'youtube', id: 'x"><script>', title: 'T', poster })).toThrow(/not a youtube video id/);
  expect(() => renderPlayer({ provider: 'vimeo', id: '123/../456', title: 'T', poster })).toThrow(/not a vimeo video id/);
  expect(() => renderPlayer({ provider: 'youtube', id: 'dQw4w9WgXcQ', title: '', poster })).toThrow(/needs a title/);
});

test('the React component renders a facade exactly as renderPlayer() does', () => {
  const s = { provider: 'vimeo' as const, id: '76979871', title: `A "film"`, poster: thumbnail('vimeo-76979871') };
  expect(renderToStaticMarkup(createElement(Player, { ...s, popup: true, sizes: '50vw' }))).toBe(renderPlayer(s, { popup: true, sizes: '50vw' }));
});

test('as audio, the sound plays from the smallest rendition in a box exactly the bar\'s height, so the page does not move', () => {
  const html = renderPlayer(source({ player }), { audio: true, baseUrl: '/m/' });
  expect(attrs(html, 'medkit-player')[0]).toEqual({ title: 'A talk', duration: '14.2', sound: '', style: 'display:block;position:relative;height:52px' });
  expect(attrs(html, 'audio')[0]).toEqual({ controls: '', preload: 'none', style: 'display:block;width:100%;height:52px' });
  expect(attrs(html, 'source').map((s) => s.src)).toEqual(['/m/talk-player-720p.mp4', '/m/talk-player-1080p.mp4']);
  expect(html).not.toContain('<video');
});

test('audio is refused for a set with no sound, and together with popup', () => {
  expect(() => renderPlayer(source(), { audio: true }), 'silent set').toThrow(/has no audio track/);
  expect(() => renderPlayer(source({ player }), { audio: true, popup: true }), 'audio popup').toThrow(/both audio and a popup/);
});

test('the React component renders an audio player exactly as renderPlayer() does', () => {
  const s = source({ player });
  expect(renderToStaticMarkup(createElement(Player, { ...s, audio: true }))).toBe(renderPlayer(s, { audio: true }));
});
