import medkit from '@medkitjs/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  vite: { plugins: [medkit()] },
});
