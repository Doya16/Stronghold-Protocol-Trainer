// Resolve the installed game at runtime. The extension never ships game data/assets.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const extensionRoot = path.dirname(fileURLToPath(import.meta.url));
export const gameRoot = path.resolve(process.env.SP_GAME_ROOT || path.join(extensionRoot, '..'));
export const gameImport = relative => import(pathToFileURL(path.join(gameRoot, relative)).href);
export const gameVersion = JSON.parse(fs.readFileSync(path.join(gameRoot, 'package.json'), 'utf8')).version;
export const expandableTemp = gameVersion === '0.3.0';
export const { PHASE, PHASE_NAMES, BOND_LAYER_CAP } = await gameImport('shared/constants.js');
const { startServer: startNativeServer } = await gameImport('server/index.js');
// Tests/embedders keep the new asset index in memory; the launcher supplies its owned cache path.
export const startServer = (options = {}) => startNativeServer({ assetIndex: { cacheFile: null }, ...options });
export const { chessAvatarUrl, itemIconUrl } = await gameImport('public/js/ui/assetUrls.js');
