// Covers the SSR helpers: the markup renderImage() writes for every option,
// escaping at the attribute boundary, art direction, preloadTags() media
// conditions, and that the React component renders exactly the same string.
//
// Not covered here: how browsers lay that markup out, which the Playwright
// layout test measures, and the Astro component, which astro.test.ts covers
// because it needs Astro's compiler.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { ImageManifest } from '../src/manifest.js';
import { Image } from '../src/react.js';
import { preloadTags, renderImage } from '../src/render.js';

const renditions = (id: string, ext: string, widths: number[], ratio: number) =>
  widths.map((width) => ({ src: `${id}-${width}.${ext}`, width, height: Math.round(width * ratio), bytes: 1000 }));

function manifest(id: string, width: number, height: number, widths: number[]): ImageManifest {
  const ratio = height / width;
  return {
    v: 1,
    id,
    kind: 'image',
    width,
    height,
    placeholder: 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4IAYAAAAwAQCdASo=',
    color: '#1d2433',
    avif: renditions(id, 'avif', widths, ratio),
    webp: renditions(id, 'webp', widths, ratio),
    jpeg: renditions(id, 'jpg', widths, ratio),
    hash: 'abc123',
  };
}

const hero = manifest('hero', 1600, 900, [640, 1280, 1600]);
const portrait = manifest('hero-portrait', 800, 1000, [480, 800]);

/** Every `<tag …>` in the HTML, as attribute maps, with entities decoded. */
function tags(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}((?:\\s+[a-z-]+="[^"]*")*)\\s*>`, 'g'))].map(([, attrs]) =>
    Object.fromEntries([...attrs.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v.replace(/&quot;/g, '"').replace(/&amp;/g, '&')])),
  );
}

describe('renderImage', () => {
  test('lists AVIF, then WebP, then the JPEG <img>, each with every width, under baseUrl', () => {
    const html = renderImage(hero, { alt: 'Crowd', baseUrl: 'https://cdn.example.com/m/' });
    const [avif, webp] = tags(html, 'source');
    const [img] = tags(html, 'img');

    expect(avif.type).toBe('image/avif');
    expect(avif.srcset).toBe('https://cdn.example.com/m/hero-640.avif 640w, https://cdn.example.com/m/hero-1280.avif 1280w, https://cdn.example.com/m/hero-1600.avif 1600w');
    expect(webp.type).toBe('image/webp');
    expect(img.srcset).toContain('https://cdn.example.com/m/hero-1600.jpg 1600w');
    expect(img.src, 'the fallback src should be the largest JPEG up to 1280').toBe('https://cdn.example.com/m/hero-1280.jpg');
  });

  test('the <img> carries the intrinsic size, so the browser reserves its box before it loads', () => {
    const [img] = tags(renderImage(hero, { alt: 'Crowd' }), 'img');
    expect([img.width, img.height]).toEqual(['1600', '900']);
    expect(img.style).toContain('height:auto');
  });

  test('an ordinary image is lazy and async; a priority image is eager, high priority and marked for the element', () => {
    const lazy = renderImage(hero, { alt: 'Crowd' });
    expect(tags(lazy, 'img')[0]).toMatchObject({ loading: 'lazy', decoding: 'async', sizes: '100vw' });
    expect(tags(lazy, 'img')[0].fetchpriority).toBeUndefined();
    expect(lazy.startsWith('<medkit-image>')).toBe(true);

    const eager = renderImage(hero, { alt: 'Crowd', priority: true });
    expect(tags(eager, 'img')[0]).toMatchObject({ loading: 'eager', fetchpriority: 'high' });
    expect(eager.startsWith('<medkit-image priority="">')).toBe(true);
  });

  test('alt is required, and a decorative image writes alt="" explicitly', () => {
    expect(() => renderImage(hero, {} as { alt: string })).toThrow(/needs alt/);
    expect(renderImage(hero, { alt: '' })).toContain(' alt=""');
  });

  test('an alt with a quote in it cannot close the attribute it sits in', () => {
    const attack = '"><script>alert(1)</script>';
    const html = renderImage(hero, { alt: attack, sizes: attack, baseUrl: `/m/${attack}/` });
    expect(html).not.toContain('"><script>');
    expect(tags(html, 'img')[0].alt, 'the alt text did not survive escaping intact').toBe(attack);
  });

  test('the blur placeholder sits behind the image as the picture background, over the dominant colour', () => {
    const [picture] = tags(renderImage(hero, { alt: 'Crowd' }), 'picture');
    expect(picture.style).toBe(`display:block;background:#1d2433 url(${hero.placeholder}) center/cover no-repeat`);
  });

  test('without a blur in the manifest, or with placeholder "color", only the colour is used; "none" uses neither', () => {
    const { placeholder: _, ...noBlur } = hero;
    expect(tags(renderImage(noBlur, { alt: 'x' }), 'picture')[0].style).toBe('display:block;background:#1d2433');
    expect(tags(renderImage(hero, { alt: 'x', placeholder: 'color' }), 'picture')[0].style).toBe('display:block;background:#1d2433');
    expect(tags(renderImage(hero, { alt: 'x', placeholder: 'none' }), 'picture')[0].style).toBe('display:block');
  });

  test('fit and position reach both the image and its placeholder', () => {
    const html = renderImage(hero, { alt: 'x', fit: 'contain', position: 'top' });
    expect(tags(html, 'img')[0].style).toContain('object-fit:contain;object-position:top');
    expect(tags(html, 'picture')[0].style).toContain('top/contain');
  });

  test('each art-directed crop comes first, with its own media and intrinsic size, so switching crops reserves the right box', () => {
    const html = renderImage(hero, { alt: 'x', art: [{ media: '(max-width: 640px)', manifest: portrait }] });
    const sources = tags(html, 'source');
    expect(sources.map((s) => [s.media, s.type])).toEqual([
      ['(max-width: 640px)', 'image/avif'],
      ['(max-width: 640px)', 'image/webp'],
      ['(max-width: 640px)', 'image/jpeg'],
      [undefined, 'image/avif'],
      [undefined, 'image/webp'],
    ]);
    expect([sources[0].width, sources[0].height]).toEqual(['800', '1000']);
  });

  test('a fit that is not an object-fit keyword, or a colour that is not hex, cannot add CSS to the style attribute', () => {
    const fit = 'cover;position:fixed' as 'cover';
    expect(() => renderImage(hero, { alt: 'x', fit }), 'fit').toThrow(/fit "cover;position:fixed" is not one of/);
    expect(() => renderImage({ ...hero, color: 'red;position:fixed' }, { alt: 'x' }), 'manifest colour').toThrow(/not a hex colour/);
    const loader = (src: string) => src;
    expect(() => renderImage('a.jpg', { loader, alt: 'x', width: 1, height: 1, color: 'red' }), 'CDN colour').toThrow(/not a hex colour/);
    expect(() => renderImage('a.jpg', { loader, alt: 'x', width: 1, height: 1, fit }), 'CDN fit').toThrow(/is not one of/);
    expect(renderImage('a.jpg', { loader, alt: 'x', width: 1, height: 1, color: '#AbC' }), 'short hex in any case').toContain('#AbC');
  });

  test('a manifest in a format version it does not know is refused rather than guessed at', () => {
    expect(() => renderImage({ ...hero, v: 2 } as unknown as ImageManifest, { alt: 'x' })).toThrow(/format version 2/);
  });
});

describe('preloadTags', () => {
  test('one high-priority AVIF preload matching the picture srcset and sizes', () => {
    const links = tags(preloadTags(hero, { sizes: '50vw' }), 'link');
    expect(links).toEqual([
      {
        rel: 'preload',
        as: 'image',
        type: 'image/avif',
        imagesrcset: '/media/hero-640.avif 640w, /media/hero-1280.avif 1280w, /media/hero-1600.avif 1600w',
        imagesizes: '50vw',
        fetchpriority: 'high',
      },
    ]);
  });

  test('with art direction, each crop preloads only where its source would win', () => {
    const square = manifest('hero-square', 1000, 1000, [500, 1000]);
    const art = [
      { media: '(max-width: 640px)', manifest: portrait },
      { media: '(max-width: 1024px)', manifest: square },
    ];
    expect(tags(preloadTags(hero, { art }), 'link').map((l) => l.media)).toEqual([
      '((max-width: 640px))',
      '((max-width: 1024px)) and (not ((max-width: 640px)))',
      '(not ((max-width: 640px))) and (not ((max-width: 1024px)))',
    ]);
  });
});

test('the React component renders exactly what renderImage() writes', () => {
  for (const options of [{ alt: 'Crowd' }, { alt: '', priority: true, art: [{ media: '(max-width: 640px)', manifest: portrait }] }]) {
    expect(renderToStaticMarkup(createElement(Image, { manifest: hero, ...options }))).toBe(renderImage(hero, options));
  }
});
