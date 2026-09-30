import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only helper: POST a data URL to /__shot?name=x and it is saved under tools/shots/x.jpg
function shots(): Plugin {
  return {
    name: 'dev-shots',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const url = new URL(req.url ?? '', 'http://x');
          const name = (url.searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '');
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          const dir = path.resolve(import.meta.dirname, 'tools/shots');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name + '.jpg'), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [shots()],
  server: { port: 5173, host: true },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
} as any);
