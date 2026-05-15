import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // The Electron build writes ~400MB into `release/` and the TS
      // compile writes `dist-electron/`. Without this, Vite's file
      // watcher detects those thousands of files and enters an infinite
      // full-reload loop — which made the overlay window reload
      // constantly and look like "nothing happens on the button".
      ignored: [
        '**/release/**',
        '**/dist-electron/**',
        '**/dist/**',
        '**/.claude/**',
      ],
    },
  },
});
