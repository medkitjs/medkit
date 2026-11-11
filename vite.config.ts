import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: {
      // The browser tests' setup writes these while the server runs; watching
      // them would reload the page under test partway through.
      ignored: ['**/examples/html/media/**', '**/examples/html/layout.html'],
    },
  },
});
