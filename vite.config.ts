import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    // Supabase URL and anon/publishable key are intentionally browser-safe.
    // Embedding them lets Auth work on static hosts where /api/auth/config is
    // rewritten to index.html. Never add a service-role/secret key here.
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.SUPABASE_URL || env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // API mutations write runtime data in the project root. Ignore those files
      // so a clock-in or task update does not trigger a full-page Vite reload.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/data.json', '**/output/**', '**/dist/**'],
      },
    },
  };
});
