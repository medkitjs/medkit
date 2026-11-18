// Covers the built custom-elements.json against the source it is generated
// from: every attribute an element reads from itself is declared, each element
// declares the events, parts and CSS properties the spec lists, no private
// member leaks, and package.json points editors at the file. Needs `pnpm build`.
//
// Not covered: whether the descriptions are right, which a reader checks in
// the docs; and attributes read from child elements such as `<medkit-clip>`'s,
// which are not attributes of a custom element and are described in the slot.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const PKG = resolve(import.meta.dirname, '..');

interface Declaration {
  tagName?: string;
  attributes?: { name: string }[];
  events?: { name: string }[];
  cssParts?: { name: string }[];
  cssProperties?: { name: string }[];
  members?: { name: string; privacy?: string }[];
}

const manifest = async () => JSON.parse(await readFile(resolve(PKG, 'dist/custom-elements.json'), 'utf8')) as { modules: { declarations?: Declaration[] }[] };
const element = async (tag: string) => (await manifest()).modules.flatMap((m) => m.declarations ?? []).find((d) => d.tagName === tag)!;
const names = (list?: { name: string }[]) => (list ?? []).map((x) => x.name).sort();

/** Attribute names a source file reads from its own element. */
async function attributesRead(...files: string[]) {
  const found = new Set<string>();
  for (const file of files) {
    const source = await readFile(resolve(PKG, 'src', file), 'utf8');
    // image-element.ts reads its CDN attributes through a local `attr(name)` helper.
    for (const [, own, viaHelper] of source.matchAll(/this\.(?:get|has)Attribute\('([a-z-]+)'\)|\battr\('([a-z-]+)'\)/g)) found.add(own ?? viaHelper);
  }
  return [...found];
}

test.each([
  ['medkit-image', ['image-element.ts', 'image-dev.ts']],
  ['medkit-video-bg', ['video-bg-element.ts']],
  ['medkit-player', ['player-element.ts', 'player-dev.ts']],
])('every attribute <%s> reads from itself is declared in custom-elements.json', async (tag, files) => {
  const declared = names((await element(tag)).attributes);
  for (const name of await attributesRead(...files)) expect(declared, `${tag} reads "${name}" but does not declare it`).toContain(name);
});

test('the events, parts and CSS properties the spec lists are declared, and nothing private', async () => {
  const bg = await element('medkit-video-bg');
  expect(names(bg.events)).toEqual(['medkit-clipchange', 'medkit-expand', 'medkit-pause', 'medkit-play']);
  expect(names(bg.cssParts)).toEqual(['button', 'controls']);
  expect(names(bg.cssProperties)).toEqual(['--medkit-accent', '--medkit-control-size', '--medkit-controls-inset']);

  const player = await element('medkit-player');
  expect(names(player.events)).toEqual(['medkit-popupclose', 'medkit-popupopen']);
  expect(names(player.cssParts)).toEqual(['button', 'controls', 'menu', 'seek', 'volume']);
  expect(names(player.cssProperties)).toEqual(['--medkit-accent', '--medkit-control-size', '--medkit-radius']);

  for (const tag of ['medkit-image', 'medkit-video-bg', 'medkit-player']) {
    expect((await element(tag)).members?.filter((m) => m.privacy === 'private') ?? [], `${tag} private members`).toEqual([]);
  }
});

test('package.json points editors at custom-elements.json, and the package exports it', async () => {
  const pkg = JSON.parse(await readFile(resolve(PKG, 'package.json'), 'utf8'));
  expect(pkg.customElements).toBe('dist/custom-elements.json');
  expect(pkg.exports['./custom-elements.json']).toBe('./dist/custom-elements.json');
});
