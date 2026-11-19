import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Drum kits are static files in public/kits, served at /kits in dev and copied into dist/ by the build.
export default defineConfig({
  plugins: [react()],
});
