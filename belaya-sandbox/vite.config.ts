import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const sandboxRoot = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: sandboxRoot,
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 5189,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
