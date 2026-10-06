// Local launcher adapter: upstream game code is unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './game-api.mjs';
import { attachLocalTools } from './local-tools.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(root, 'runtime-data');
let server;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 4000);
  deadline.unref();
  try { await server?.close(); } finally { process.exit(0); }
}
try {
  // Use the documented port if available; never stop another application.
  for (let port = 3000; port <= 3010; port++) {
    try {
      server = await startServer({ host: '127.0.0.1', port, quiet: true });
      break;
    } catch (e) {
      if (!['EADDRINUSE', 'EACCES'].includes(e.code) || port === 3010) throw e;
    }
  }
  attachLocalTools(server);
  fs.writeFileSync(path.join(run, 'ready.tmp'), String(server.port));
  fs.renameSync(path.join(run, 'ready.tmp'), path.join(run, 'ready'));
  setInterval(() => {
    if (fs.existsSync(path.join(run, 'stop'))) shutdown();
  }, 200);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (e) {
  fs.writeFileSync(path.join(run, 'error.txt'), e.stack || String(e));
  process.exit(1);
}
