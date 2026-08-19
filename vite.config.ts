import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The one place the policy is written down is electron/offline.js, where it sits
// beside the request blocker it works with. Importing it here rather than
// repeating it means the tag in the page and the header on the response cannot
// drift apart — and a test can check that they have not.
const { CONTENT_SECURITY_POLICY } = createRequire(import.meta.url)('./electron/offline.js');

/**
 * The packaged app is locked down to its own bundled assets — no remote scripts,
 * no outbound connections. The rule is only injected for production builds
 * because the dev server needs inline scripts and a websocket for hot reload.
 */
function contentSecurityPolicy(): Plugin {
  const policy = CONTENT_SECURITY_POLICY as string;

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
