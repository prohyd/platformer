import { defineConfig } from 'vite';

// Relative paths make the build work both on GitHub Pages (/repo-name/) and on a custom domain.
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    rollupOptions: {
      // plain hashed names: no spaces or Cyrillic in the URLs of the music files
      output: { assetFileNames: 'assets/[hash][extname]' },
    },
  },
});
