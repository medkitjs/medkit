// Renders medkit's markup into HTML partials at build time, for PHP to output
// as they are; also copies the element modules and the captions into public/.
import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderImage, renderPlayer, renderVideoBg } from '@medkitjs/elements';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = (id) => JSON.parse(readFileSync(join(here, 'public/media', `${id}.json`), 'utf8'));

const partials = {
  hero: renderVideoBg([{ video: manifest('river'), title: 'Colour drifting over the river', overlay: '<h1>medkit with PHP</h1>' }], { controls: 'pause', priority: true }),
  lake: renderImage(manifest('lake'), { alt: 'A pale sun over a teal lake with dark hills in front', sizes: '(min-width: 800px) 720px, 100vw' }),
  talk: renderPlayer(
    { video: manifest('talk'), title: 'A tone over shifting colour' },
    { captions: [{ src: '/media/talk.en.vtt', srclang: 'en', label: 'English', default: true }] },
  ),
};
mkdirSync(join(here, 'partials'), { recursive: true });
for (const [name, html] of Object.entries(partials)) writeFileSync(join(here, 'partials', `${name}.html`), html);

copyFileSync(join(here, '../media/talk.en.vtt'), join(here, 'public/media/talk.en.vtt'));
// No bundler: the browser loads the element modules as they are published.
const dist = dirname(fileURLToPath(import.meta.resolve('@medkitjs/elements')));
cpSync(dist, join(here, 'public/medkit'), { recursive: true, filter: (path) => !/\.(d\.ts|map|json)$/.test(path) });
