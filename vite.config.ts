import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The packaged app is locked down to its own bundled assets — no remote scripts,
 * no outbound connections. The rule is only injected for production builds
 * because the dev server needs inline scripts and a websocket for hot reload.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');

  return {
    name: 'myvault-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const tag = ctx.server
          ? ''
          : `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
        return html.replace('<!--CSP-->', tag);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  // Relative paths so the built app loads correctly from file:// inside Electron.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
