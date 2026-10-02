import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only helpers: POST a data URL to /__shot?name=x and it is saved under tools/shots/x.jpg
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
      // ... GET /__file?name=x: a file of tools/models/dbg2 (what the rig build wrote down for the model check)
      server.middlewares.use('/__file', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const name = (url.searchParams.get('name') ?? '').replace(/[^\w.-]/g, '');
        const file = path.resolve(import.meta.dirname, 'tools/models/dbg2', name);
        if (!name || !fs.existsSync(file)) { res.statusCode = 404; res.end('no such file'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(file));
      });
      // ... and POST text to /__save?name=x.json: saved as tools/shots/x.json (reports of the model check)
      server.middlewares.use('/__save', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const url = new URL(req.url ?? '', 'http://x');
          const name = (url.searchParams.get('name') ?? 'report.json').replace(/[^\w.-]/g, '');
          const dir = path.resolve(import.meta.dirname, 'tools/shots');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name), body);
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  // relative asset URLs: the same build works at /, under /Streamer-s-Kombat-26/ and under …/dist/ (GitHub Pages)
  base: './',
  root: 'client',
  publicDir: 'public',
  plugins: [shots()],
  server: { port: 5173, host: true },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
} as any);
