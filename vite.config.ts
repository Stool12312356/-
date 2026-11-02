import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                 // статическая сборка открывается и с диска, и с любого CDN
  server: {
    host: '0.0.0.0',          // нужно для live-preview в песочнице
    port: 5173,
    strictPort: true,
    // воркспейс Arena отдаёт превью с чужого origin — разрешаем все хосты
    allowedHosts: true,
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
});
