import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/app.db*',
        '**/dist/**',
        '**/dist-electron/**',
        '**/release/**',
        '**/user-data/**',
      ],
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](?:react|react-dom)[\\/]/,
            },
            {
              name: 'terminal-vendor',
              test: /node_modules[\\/]@xterm[\\/]/,
            },
          ],
        },
      },
    },
  },
});
