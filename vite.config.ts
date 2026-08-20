import { writeFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * Dev-only frame capture. Lets the game POST a data-URL screenshot to disk so
 * renders can be inspected without a visible browser window.
 * POST /__shot  body: "<name>\n<dataURL>"
 */
function shotPlugin() {
  return {
    name: 'clanker-shot',
    configureServer(server: {
      middlewares: {
        use: (path: string, fn: (req: any, res: any, next: () => void) => void) => void;
      };
    }) {
      server.middlewares.use('/__shot', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c: Buffer) => (body += c));
        req.on('end', () => {
          const nl = body.indexOf('\n');
          const name = body.slice(0, nl).replace(/[^a-z0-9_-]/gi, '') || 'frame';
          const data = body.slice(nl + 1);
          const b64 = data.slice(data.indexOf(',') + 1);
          mkdirSync('shots', { recursive: true });
          writeFileSync(`shots/${name}.png`, Buffer.from(b64, 'base64'));
          res.statusCode = 200;
          res.end(`shots/${name}.png`);
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the project from https://<user>.github.io/dumb-clanker/,
  // so built asset URLs need that prefix. Dev keeps serving from the root.
  base: command === 'build' ? '/dumb-clanker/' : '/',
  plugins: [shotPlugin()],
}));
