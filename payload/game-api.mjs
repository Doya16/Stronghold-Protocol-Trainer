// Resolve the installed game at runtime. The extension never ships game data/assets.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const extensionRoot = path.dirname(fileURLToPath(import.meta.url));
export const gameRoot = path.resolve(process.env.SP_GAME_ROOT || path.join(extensionRoot, '..'));
export const gameImport = relative => import(pathToFileURL(path.join(gameRoot, relative)).href);
export const { PHASE, PHASE_NAMES, BOND_LAYER_CAP } = await gameImport('shared/constants.js');
export const { startServer } = await gameImport('server/index.js');
export const { chessAvatarUrl, itemIconUrl } = await gameImport('public/js/ui/assetUrls.js');
