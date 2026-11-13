// Covers the CDN loaders' URL shapes, checked against each provider's docs in
// November 2026, and the CDN path of renderImage() and preloadTags().
//
// Not covered: whether each CDN actually serves these URLs, which needs real
// accounts; a loader is only as right as the documented shape it encodes.

import { describe, expect, test } from 'vitest';
import { cloudflare, cloudinary, defineLoader, imagekit, imgix } from '../src/loaders.js';
import { preloadTags, renderImage } from '../src/render.js';

describe('loader URLs', () => {
  const cases = [
    [
      'Cloudinary',
      cloudinary({ cloudName: 'demo' }),
      'https://res.cloudinary.com/demo/image/upload/c_limit,w_640/f_auto/q_auto/photos/hero.jpg',
      'https://res.cloudinary.com/demo/image/upload/c_limit,w_640/f_auto/q_60/photos/hero.jpg',
    ],
    [
      'imgix',
      imgix({ domain: 'demo.imgix.net' }),
      'https://demo.imgix.net/photos/hero.jpg?w=640&auto=format,compress',
      'https://demo.imgix.net/photos/hero.jpg?w=640&auto=format,compress&q=60',
    ],
    [
      'Cloudflare Images',
      cloudflare({ zone: 'example.com' }),
      'https://example.com/cdn-cgi/image/width=640,format=auto/photos/hero.jpg',
      'https://example.com/cdn-cgi/image/width=640,format=auto,quality=60/photos/hero.jpg',
    ],
    [
      'ImageKit',
      imagekit({ urlEndpoint: 'https://ik.imagekit.io/demo' }),
      'https://ik.imagekit.io/demo/photos/hero.jpg?tr=w-640,f-auto',
      'https://ik.imagekit.io/demo/photos/hero.jpg?tr=w-640,f-auto,q-60',
    ],
  ] as const;

  test.each(cases)('%s builds its documented URL, with the CDN choosing quality unless one is given', (_, loader, auto, fixed) => {
    expect(loader('photos/hero.jpg', { width: 640 })).toBe(auto);
    expect(loader('photos/hero.jpg', { width: 640, quality: 60 })).toBe(fixed);
  });

  test.each(cases)('%s never doubles a slash, whether the path starts with one or the host ends with one', (_, loader, auto) => {
    expect(loader('/photos/hero.jpg', { width: 640 })).toBe(auto);
  });

  test('a trailing slash on the configured host or endpoint is ignored', () => {
    expect(imagekit({ urlEndpoint: 'https://ik.imagekit.io/demo/' })('a.jpg', { width: 1 })).toBe('https://ik.imagekit.io/demo/a.jpg?tr=w-1,f-auto');
    expect(cloudflare({ zone: 'example.com/' })('a.jpg', { width: 1 })).toBe('https://example.com/cdn-cgi/image/width=1,format=auto/a.jpg');
  });

  test('Cloudflare keeps an absolute source URL whole', () => {
    expect(cloudflare({ zone: 'example.com' })('https://origin.example.com/a.jpg', { width: 640 })).toBe(
      'https://example.com/cdn-cgi/image/width=640,format=auto/https://origin.example.com/a.jpg',
    );
  });
});

describe('CDN images', () => {
  const loader = defineLoader((src, { width }) => `https://cdn.example.com/${src}?w=${width}`);
  const options = { loader, alt: 'Hero', width: 1600, height: 900 };

  test('one srcset on the <img> and no <source> list, because the CDN picks the format', () => {
    const html = renderImage('hero.jpg', options);
    expect(html).not.toContain('<source');
    expect(html).toContain(
      'srcset="https://cdn.example.com/hero.jpg?w=320 320w, https://cdn.example.com/hero.jpg?w=640 640w, https://cdn.example.com/hero.jpg?w=960 960w, https://cdn.example.com/hero.jpg?w=1280 1280w, https://cdn.example.com/hero.jpg?w=1600 1600w"',
    );
    expect(html).toContain('src="https://cdn.example.com/hero.jpg?w=1280"');
    expect(html).toContain('width="1600" height="900"');
  });

  test('the declared ratio is fixed in CSS, so a CDN rounding a file height cannot resize the box', () => {
    expect(renderImage('hero.jpg', options)).toMatch(/<img [^>]*style="[^"]*;aspect-ratio:1600\/900"/);
  });

  test('width and height are required, because there is no manifest to read them from', () => {
    expect(() => renderImage('hero.jpg', { loader, alt: 'Hero' } as typeof options)).toThrow(/needs its width and height/);
  });

  test('the placeholder is a tiny CDN image over the colour, but a priority image gets the colour alone', () => {
    expect(renderImage('hero.jpg', { ...options, color: '#123456' })).toContain(
      'style="display:block;background:url(&quot;https://cdn.example.com/hero.jpg?w=24&quot;) center/cover no-repeat #123456"',
    );
    const hero = renderImage('hero.jpg', { ...options, color: '#123456', priority: true });
    expect(hero).toContain('style="display:block;background:#123456"');
    expect(hero).not.toContain('w=24');
  });

  test('a source path with a space in it cannot split a srcset candidate', () => {
    expect(renderImage('my hero.jpg', options)).toContain('https://cdn.example.com/my%20hero.jpg?w=320 320w');
  });

  test('the preload carries the same srcset the <img> gets', () => {
    const link = preloadTags('hero.jpg', { loader, width: 1600 });
    const srcset = /imagesrcset="([^"]*)"/.exec(link)![1];
    expect(renderImage('hero.jpg', options)).toContain(`srcset="${srcset}"`);
    expect(link).not.toContain('type=');
  });
});

test('a quote or newline in a loader URL cannot end the CSS string of the blur placeholder', () => {
  const loader = defineLoader((src) => `https://cdn.example.com/${src}`);
  const html = renderImage('a");}\nbody{x:url("y', { loader, alt: '', width: 100, height: 100 });
  const style = /<picture style="([^"]*)"/.exec(html)![1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  expect(style).toBe('display:block;background:url("https://cdn.example.com/a\\22 );}\\a body{x:url(\\22 y") center/cover no-repeat');
});
