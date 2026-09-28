import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Make .env available to server code that reads process.env (DATA_DIR, APP_SECRET, PUBLIC_ORIGIN...).
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [tailwindcss(), sveltekit()],
    server: { fs: { strict: true } },
    test: { include: ['src/**/*.test.ts'], environment: 'node' }
  };
});
