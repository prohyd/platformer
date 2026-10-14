import { defineConfig } from 'vite';

// Relative paths make the build work both on GitHub Pages (/repo-name/) and on a custom domain.
export default defineConfig({
  base: './',
  server: { host: true },
});
