import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'https';

/**
 * Vite plugin: dev proxy for external HTTPS services with self-signed certs.
 *
 * Any request to /__proxy/<host>/<path> is forwarded to https://<host>/<path>
 * with rejectUnauthorized: false, solving ERR_CERT_AUTHORITY_INVALID in dev.
 */
function devProxyPlugin() {
  return {
    name: 'epik8s-dev-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/__proxy/')) return next();

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'access-control-allow-headers': 'content-type,authorization',
            'access-control-max-age': '86400',
          });
          res.end();
          return;
        }

        // Parse /__proxy/<host>/<path>
        const stripped = req.url.slice('/__proxy/'.length);
        const slashIdx = stripped.indexOf('/');
        const targetHost = slashIdx > -1 ? stripped.slice(0, slashIdx) : stripped;
        const targetPath = slashIdx > -1 ? stripped.slice(slashIdx) : '/';

        if (!targetHost) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('Missing proxy target host');
          return;
        }

        const [hostname, port] = targetHost.split(':');
        const options = {
          hostname,
          port: port ? Number(port) : 443,
          path: targetPath,
          method: req.method,
          headers: { ...req.headers, host: targetHost },
          rejectUnauthorized: false,
        };
        // Remove headers that confuse the upstream
        delete options.headers['origin'];
        delete options.headers['referer'];
        delete options.headers['host'];
        options.headers['host'] = targetHost;

        const proxyReq = https.request(options, (proxyRes) => {
          const headers = { ...proxyRes.headers };
          headers['access-control-allow-origin'] = '*';
          headers['access-control-allow-headers'] = '*';
          res.writeHead(proxyRes.statusCode, headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.error(`[dev-proxy] ${targetHost}${targetPath} →`, err.message);
          res.writeHead(502, { 'content-type': 'text/plain' });
          res.end(`Dev proxy error: ${err.message}`);
        });

        req.pipe(proxyReq);
      });
    },

    // Same proxy middleware for `vite preview` (serves the built dist)
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/__proxy/')) return next();

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'access-control-allow-headers': 'content-type,authorization',
            'access-control-max-age': '86400',
          });
          res.end();
          return;
        }

        const stripped = req.url.slice('/__proxy/'.length);
        const slashIdx = stripped.indexOf('/');
        const targetHost = slashIdx > -1 ? stripped.slice(0, slashIdx) : stripped;
        const targetPath = slashIdx > -1 ? stripped.slice(slashIdx) : '/';

        if (!targetHost) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('Missing proxy target host');
          return;
        }

        const [hostname, port] = targetHost.split(':');
        const options = {
          hostname,
          port: port ? Number(port) : 443,
          path: targetPath,
          method: req.method,
          headers: { ...req.headers },
          rejectUnauthorized: false,
        };
        delete options.headers['origin'];
        delete options.headers['referer'];
        options.headers['host'] = targetHost;

        const proxyReq = https.request(options, (proxyRes) => {
          const headers = { ...proxyRes.headers };
          headers['access-control-allow-origin'] = '*';
          headers['access-control-allow-headers'] = '*';
          res.writeHead(proxyRes.statusCode, headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.error(`[preview-proxy] ${targetHost}${targetPath} →`, err.message);
          res.writeHead(502, { 'content-type': 'text/plain' });
          res.end(`Proxy error: ${err.message}`);
        });

        req.pipe(proxyReq);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devProxyPlugin()],
  server: {
    port: 3000,
    open: true,
    historyApiFallback: true,
  },
  preview: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'xyflow': ['@xyflow/react'],
        },
      },
    },
  },
});
