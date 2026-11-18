import { cpSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import starlight from '@astrojs/starlight';
import medkit from '@medkitjs/vite';
import { defineConfig } from 'astro/config';

// The preview frames load the published element modules and their
// custom-elements.json, as a page with no bundler would.
const elements = {
  name: 'medkit-elements',
  hooks: {
    'astro:config:setup'({ config }) {
      const dist = dirname(fileURLToPath(import.meta.resolve('@medkitjs/elements')));
      cpSync(dist, fileURLToPath(new URL('public/medkit/', config.root)), { recursive: true, filter: (path) => !/\.(d\.ts|map)$|manifest\.schema\.json$/.test(path) });
    },
  },
};

export default defineConfig({
  site: 'https://medkitjs.github.io',
  base: '/medkit',
  vite: { plugins: [medkit()] },
  integrations: [
    elements,
    starlight({
      title: 'medkit',
      customCss: ['./src/styles/code-preview.css'],
      description: 'Accessible, dependency-free custom elements for images, background video and playback, with build-time processing by sharp and ffmpeg.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/medkitjs/medkit' }],
      editLink: { baseUrl: 'https://github.com/medkitjs/medkit/edit/main/docs/' },
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'Elements', items: [{ autogenerate: { directory: 'elements' } }] },
        { label: 'Processing', items: [{ autogenerate: { directory: 'processing' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
      ],
    }),
  ],
});
