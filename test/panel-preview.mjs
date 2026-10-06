// Isolated real server for UI acceptance. Create a real game through the browser.
import { startServer, gameImport } from '../payload/game-api.mjs';
import { attachLocalTools } from '../payload/local-tools.mjs';
const srv = await startServer({host:'127.0.0.1',port:0,quiet:true,seedFn:() => 4});
attachLocalTools(srv);
console.log(srv.url);
async function close() { await srv.close(); process.exit(0); }
process.on('SIGINT',close); process.on('SIGTERM',close);
setTimeout(close,15*60*1000);
