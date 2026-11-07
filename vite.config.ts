import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const stitchKey = env.STITCH_API_KEY || env.VITE_STITCH_API_KEY || '';

  const stitchProxyConfig: ProxyOptions = {
    target: 'https://stitch.googleapis.com',
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/api\/stitch\/mcp/, '/mcp'),
    headers: stitchKey ? { 'X-Goog-Api-Key': stitchKey } : undefined,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        if (!proxyReq.getHeader('x-goog-api-key') && stitchKey) {
          proxyReq.setHeader('X-Goog-Api-Key', stitchKey);
        }
      });
    },
  };

  return {
    plugins: [tailwindcss()],
    server: {
      port: 5173,
      open: false,
      proxy: {
        '/api/stitch/mcp': stitchProxyConfig,
      },
    },
    preview: {
      port: 4173,
      proxy: {
        '/api/stitch/mcp': stitchProxyConfig,
      },
    },
  };
});
