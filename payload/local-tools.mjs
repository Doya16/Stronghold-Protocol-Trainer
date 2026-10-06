// Optional local-only extension. Loaded by our launcher, never by the upstream LAN launcher.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { PHASE, PHASE_NAMES, BOND_LAYER_CAP, gameRoot, chessAvatarUrl, itemIconUrl } from './game-api.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = '/__local-tools/';
export const FUNDS_CAP = 99999;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const bondDisabled = (m, id) => m.gd.modeInactiveBonds.has(id) || m.disabledBonds.includes(id);
const matchIds = new WeakMap();
// room.matchKey is a NETWORK rate-limit bucket, null on localhost. It is not match identity.
// Associate an opaque ID with the actual Match instance so a new game in the same room
// cannot accept edits submitted from the previous game, even at the same round number.
export function localMatchId(match) {
  if (!matchIds.has(match)) matchIds.set(match, randomBytes(16).toString('hex'));
  return matchIds.get(match);
}

const safeIcon = url => typeof url === 'string' && /^\/assets\/[\w./-]+$/.test(url) && !url.includes('..') ? url : null;
export function catalogOf(m) {
  const banned = new Set(m.bannedChess);
  const sort = (a, b) => a.tier - b.tier || Number(a.golden) - Number(b.golden) || a.name.localeCompare(b.name, 'zh-CN');
  return {
    items: Object.entries(m.gd.raw.items).filter(([, it]) => ['EQUIP', 'MAGIC'].includes(it.itemType) && it.name).map(([id, it]) => ({
      id, name: it.name, tier: it.tier, golden: !!it.isGolden,
      type: it.itemType === 'MAGIC' ? '道具' : '装备', description: it.desc || '',
      icon: safeIcon(itemIconUrl(m.gd.raw.assets, it)),
    })).sort(sort),
    chess: m.gd.visibleChess.filter(id => !banned.has(id) && m.pool.has(id)).map(id => {
      const c = m.gd.chess(id);
      return { id, name: c.name, tier: c.tier, golden: false, type: '干员',
        description: (c.bonds || []).map(id => m.gd.bond(id)?.name || id).join(' · '),
        icon: safeIcon(chessAvatarUrl(m.gd.raw.assets, c)) };
    }).sort(sort),
    bannedCount: banned.size,
  };
}
function stateOf(lobby) {
  return [...lobby.rooms.values()].filter(r => r.match && !r.match.ended && !r.match.disposed).map(room => {
    const m = room.match;
    return {
      code: room.code, matchId: localMatchId(m), round: m.round,
      phase: m.phase, phaseName: PHASE_NAMES[m.phase] || m.phase,
      players: [...m.players.values()].filter(p => !p.left).map(p => ({
        id: p.playerId, name: p.name, isBot: p.isBot, alive: p.alive, ready: p.ready, funds: p.funds,
        editable: m.phase === PHASE.PREP && p.alive && !p.ready,
        handFree: p.hand.filter(x => !x).length, tempFree: p.temp.filter(x => !x).length,
        bonds: m.gd.bondIds.filter(id => !m.gd.bond(id).noStack).map(id => ({
          id, name: m.gd.bond(id).name, layers: p.layers[id] || 0,
          active: !!p.bonds[id]?.active, disabled: bondDisabled(m, id),
        })),
      })),
    };
  });
}

export function applyEdit(lobby, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('修改参数无效。');
  const { roomCode, matchId, playerId, round, field, operation = 'set', value, bondId, id } = body;
  const room = typeof roomCode === 'string' && lobby.rooms.get(roomCode);
  const m = room?.match;
  if (!m || m.ended || m.disposed || typeof matchId !== 'string' || localMatchId(m) !== matchId) throw fail('对局已变化，本次未修改。请刷新面板后重试。', 409);
  if (m.phase !== PHASE.PREP || round !== m.round) throw fail('仅可在当前回合的休整期修改，请刷新面板。', 409);
  const p = m.players.get(playerId);
  if (!p || p.left || !p.alive || p.ready) throw fail('该玩家当前不可修改，请先取消准备。', 409);
  if (field === 'item' || field === 'chess') {
    if (operation !== 'grant') throw fail('获得操作无效。');
    const allowed = catalogOf(m)[field === 'item' ? 'items' : 'chess'];
    const entry = typeof id === 'string' && allowed.find(x => x.id === id);
    if (!entry) throw fail(field === 'chess' ? '该干员在本局被禁用或不可获得。' : '请选择列表中的物品。');
    const merges = field === 'item' ? p.completesItemMerge(id) : p.completesChessMerge(id);
    if (!p.hand.some(x => !x) && !p.temp.some(x => !x) && !merges) throw fail('整备区和暂存区已满，请先腾出位置。', 409);
    // Native acquisition runs onGain, automatic merges, equipment hooks and pool accounting.
    const piece = field === 'item' ? p.acquireItem(id, { source: 'local-tools' }) : p.acquireChess(id, { source: 'local-tools' });
    if (!piece) throw fail('未能获得，请检查整备区容量。', 409);
    p.recompute(); m.flush(true);
    return { field, id, name: entry.name, resultId: piece.id, uid: piece.uid, merged: piece.id !== id };
  }
  if (!Number.isSafeInteger(value)) throw fail('请输入整数。');
  let before, after;
  if (field === 'funds') {
    if (!['set', 'add'].includes(operation)) throw fail('金币操作无效。');
    before = p.funds;
    after = operation === 'add' ? before + value : value;
    if (!Number.isSafeInteger(after) || after < 0 || after > FUNDS_CAP) throw fail(`金币范围为 0–${FUNDS_CAP}。`);
    p.funds = after;
    p.dirty();
  } else if (field === 'layers') {
    if (operation !== 'set') throw fail('盟约操作无效。');
    const bond = typeof bondId === 'string' && Object.hasOwn(m.gd.raw.bonds, bondId) && m.gd.bond(bondId);
    if (!bond || bond.noStack) throw fail('请选择可叠层的盟约。');
    if (bondDisabled(m, bondId)) throw fail('这个盟约在本局被禁用。');
    if (value < 0 || value > BOND_LAYER_CAP) throw fail(`盟约层数范围为 0–${BOND_LAYER_CAP}。`);
    before = p.layers[bondId] || 0;
    after = value;
    // Exact assignment intentionally does not trigger per-layer item/reward hooks.
    p.layers[bondId] = after;
    p.recompute();
  } else throw fail('修改项目无效。');
  m.flush(true); // Same authoritative public/private updates used by normal game actions.
  return { field, bondId, before, after };
}

export function attachLocalTools(srv) {
  const address = srv.server.address();
  if (!address || address.address !== '127.0.0.1') throw new Error('Local tools require a loopback-only server');
  const host = `127.0.0.1:${address.port}`;
  const origin = `http://${host}`;
  const token = randomBytes(24).toString('hex');
  const original = srv.server.listeners('request');
  if (original.length !== 1) throw new Error('Unexpected HTTP handler count');
  srv.server.removeListener('request', original[0]);
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  };
  async function local(req, res, pathname) {
    // Fixed Host + origin + same-origin token protect the localhost control endpoint.
    if (req.headers.host !== host || req.socket.remoteAddress !== '127.0.0.1'
      || (req.headers.origin && req.headers.origin !== origin)
      || req.headers['sec-fetch-site'] === 'cross-site') throw fail('仅允许当前本地游戏页面访问。', 403);
    if (pathname === PREFIX + 'panel.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(path.join(here, 'panel.js'))); return;
    }
    if (pathname === PREFIX + 'state' && req.method === 'GET') {
      json(res, 200, { apiVersion: 3, token, fundsCap: FUNDS_CAP, layerCap: BOND_LAYER_CAP, matches: stateOf(srv.lobby) }); return;
    }
    if (pathname === PREFIX + 'catalog' && req.method === 'GET') {
      const params = new URL(req.url, origin).searchParams;
      const m = srv.lobby.rooms.get(params.get('roomCode'))?.match;
      if (!m || m.ended || m.disposed || localMatchId(m) !== params.get('matchId')) throw fail('对局已变化，请刷新列表。', 409);
      json(res, 200, { matchId: localMatchId(m), ...catalogOf(m) }); return;
    }
    if (pathname !== PREFIX + 'edit') throw fail('接口不存在。', 404);
    if (req.method !== 'POST') throw fail('仅接受 POST。', 405);
    if (req.headers.origin !== origin || req.headers['x-local-tools-token'] !== token) throw fail('请重新打开修改面板。', 403);
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw fail('需要 JSON 参数。', 415);
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 4096) throw fail('请求过大。', 413);
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('JSON 格式错误。'); }
    const change = applyEdit(srv.lobby, body);
    json(res, 200, { change, matches: stateOf(srv.lobby) });
  }
  srv.server.on('request', (req, res) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname.startsWith(PREFIX)) {
      local(req, res, pathname).catch(e => { if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : '修改失败，请刷新面板。' }); else res.end(); });
      return;
    }
    if (req.headers.host === host && ['/', '/index.html'].includes(pathname) && ['GET', 'HEAD'].includes(req.method)) {
      const html = fs.readFileSync(path.join(gameRoot, 'public/index.html'), 'utf8')
        .replace('</body>', '<script type="module" src="/__local-tools/panel.js"></script>\n</body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : html); return;
    }
    original[0].call(srv.server, req, res);
  });
}
