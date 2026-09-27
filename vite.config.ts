import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<repo-name>/, so assets need that prefix.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/pathogenic-dps/' : '/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
