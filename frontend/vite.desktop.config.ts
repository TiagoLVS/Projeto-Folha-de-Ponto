import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const frontend = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, frontend, 'NEXT_PUBLIC_VALIDATED_OCR_STATUS');
  return {
    root: path.resolve(frontend, '../windows-app/frontend'),
    publicDir: path.join(frontend, 'public'),
    plugins: [react()],
    resolve: { alias: { '@': frontend, 'react': path.join(frontend, 'node_modules/react'), 'react-dom': path.join(frontend, 'node_modules/react-dom') }, dedupe: ['react', 'react-dom'] },
    css: { postcss: { plugins: [tailwind({ base: frontend })] } },
    define: { 'process.env.NEXT_PUBLIC_VALIDATED_OCR_STATUS': JSON.stringify(env.NEXT_PUBLIC_VALIDATED_OCR_STATUS || 'OK') },
    build: { outDir: path.resolve(frontend, '../windows-app/frontend-dist'), emptyOutDir: true, sourcemap: false, target: 'es2022' },
  };
});
