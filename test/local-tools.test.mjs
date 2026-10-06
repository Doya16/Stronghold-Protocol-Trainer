import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
const { makeMatch } = await gameImport('test/match/harness.js');
import { startServer, gameImport } from '../payload/game-api.mjs';
import { attachLocalTools, applyEdit, localMatchId, catalogOf } from '../payload/local-tools.mjs';

function fixture(options = {}) {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, fake: true, seed: 4, ...options }).start();
  h.toPrep(1);
  const lobby = { rooms: new Map([['TEST', { code:'TEST', matchKey:null, match:h.m }]]) };
  const body = { roomCode:'TEST',matchId:localMatchId(h.m),playerId:'p_0',round:1,field:'funds',value:1000 };
  const bondId = h.m.gd.bondIds.find(id => !h.m.gd.bond(id).noStack && !h.m.gd.modeInactiveBonds.has(id) && !h.m.disabledBonds.includes(id));
  return { h, lobby, body, bondId };
}

test('gold changes authoritative state, broadcasts it, and can be spent; AI is separate', () => {
  const {h,lobby,body} = fixture();
  try {
    const p = h.ps('p_0');
    applyEdit(lobby, body);
    assert.equal(p.funds, 1000);
    assert.equal(h.lastTo('p_0', 'm.private').funds, 1000);
    assert.equal(p.spend(7), true);
    applyEdit(lobby, {...body,operation:'add',value:100});
    assert.equal(p.funds, 1093);
    applyEdit(lobby, {...body,playerId:'ai_0',value:500});
    assert.equal(h.ps('ai_0').funds, 500);
    assert.equal(p.funds, 1093);
    applyEdit(lobby, {...body,value:0});
    assert.equal(p.funds, 0);
    h.invariants();
  } finally { h.m.dispose(); }
});

test('layers persist, enter the next battle snapshot, broadcast, and can be reset to zero', () => {
  const {h,lobby,body,bondId} = fixture();
  try {
    const p = h.ps('p_0');
    applyEdit(lobby, {...body,field:'layers',bondId,value:999});
    assert.equal(p.layers[bondId],999);
    assert.equal(p.bonds[bondId].layers,999);
    assert.equal(p.battleInput().bonds[bondId].layers,999);
    assert.equal(h.lastTo('p_0','m.private').bonds.find(b => b.bondId === bondId).layers,999);
    const active = p.bonds[bondId].active;
    applyEdit(lobby, {...body,field:'layers',bondId,value:0});
    assert.equal(p.battleInput().bonds[bondId].layers,0);
    assert.equal(p.bonds[bondId].active,active,'editing layers does not force activation');
    h.invariants();
  } finally { h.m.dispose(); }
});

test('invalid/stale/battle-time requests cannot partially change game state', () => {
  const {h,lobby,body,bondId} = fixture({difficulty:'FUNNY'});
  try {
    const p = h.ps('p_0'), funds = p.funds;
    for (const change of [
      {value:-1},{value:1.5},{value:'100'},{value:100000},{value:null},
      {matchId:'old-match'},{matchId:null},{round:2},{playerId:'missing'},
      {field:'layers',bondId,value:1000},{field:'layers',bondId:'__proto__',value:10},
      {field:'layers',bondId:'soloShip',value:10},
      {field:'layers',bondId:'egirShip',value:10},
    ]) assert.throws(() => applyEdit(lobby,{...body,...change}));
    h.m.phase = 'COMBAT';
    assert.throws(() => applyEdit(lobby,body),/休整期/);
    assert.equal(p.funds,funds);
    assert.equal(p.layers[bondId] || 0,0);
  } finally { h.m.dispose(); }
});

test('HTTP extension is opt-in, validates local access, and applies edits to a real match', async () => {
  const srv = await startServer({host:'127.0.0.1',port:0,quiet:true});
  const {h,body,bondId} = fixture();
  try {
    let response = await fetch(srv.url + '/__local-tools/state');
    assert.equal(response.status,404,'unmodified server has no edit endpoint');
    attachLocalTools(srv);
    srv.lobby.rooms.set('TEST',{code:'TEST',matchKey:null,match:h.m});
    const state = await (await fetch(srv.url + '/__local-tools/state')).json();
    assert.equal(state.matches[0].players.length,2);
    assert.ok((await (await fetch(srv.url)).text()).includes('/__local-tools/panel.js'));
    assert.equal((await fetch(srv.url + '/__local-tools/panel.js')).status,200);
    assert.equal(state.apiVersion,3);
    const catalog = await (await fetch(srv.url + '/__local-tools/catalog?' + new URLSearchParams({roomCode:'TEST',matchId:body.matchId}))).json();
    assert.ok(catalog.items.length > 0 && catalog.chess.length > 0);
    assert.ok(catalog.chess.every(x => !h.m.bannedChess.includes(x.id)));
    assert.equal((await fetch(srv.url + '/__local-tools/catalog?roomCode=TEST&matchId=old')).status,409);
    const post = (payload, headers = {}) => fetch(srv.url + '/__local-tools/edit',{
      method:'POST',headers:{'Content-Type':'application/json','Origin':srv.url,'X-Local-Tools-Token':state.token,...headers},body:JSON.stringify(payload),
    });
    response = await post(body);
    assert.equal(response.status,200);
    assert.equal((await response.json()).change.after,1000);
    response = await post({...body,field:'layers',bondId,value:777});
    assert.equal(response.status,200);
    assert.equal(h.ps('p_0').battleInput().bonds[bondId].layers,777);
    assert.equal((await post(body,{'Origin':'https://example.invalid'})).status,403);
    assert.equal((await post(body,{'X-Local-Tools-Token':'invalid'})).status,403);
    const wrongHostStatus = await new Promise((resolve,reject) => {
      http.get(srv.url + '/__local-tools/state',{headers:{Host:'example.invalid'}},res => {res.resume();resolve(res.statusCode);}).on('error',reject);
    });
    assert.equal(wrongHostStatus,403);
    assert.equal((await post({...body,round:0})).status,409);
    assert.equal(h.ps('p_0').funds,1000);
  } finally { srv.lobby.rooms.delete('TEST'); h.m.dispose(); await srv.close(); }
});

test('item grants use real acquisition: equip, merge, effects and no charge; AI remains separate', () => {
  const {h,lobby,body} = fixture();
  try {
    const p = h.ps('p_0'), ai = h.ps('ai_0'), funds = p.funds;
    const item = catalogOf(h.m).items.find(x => x.name === '维式重锤' && !x.golden);
    const grant = extra => applyEdit(lobby,{...body,field:'item',operation:'grant',id:item.id,...extra});
    const first = grant();
    assert.equal(p.find(first.uid).piece.id,item.id);
    const second = grant();
    assert.equal(second.merged,true);
    assert.equal(p.find(second.uid).piece.id,h.m.gd.item(item.id).goldenId);
    assert.equal(h.lastTo('p_0','m.private').hand.filter(x => x?.id === second.resultId).length,1);
    const aiGrant = grant({playerId:'ai_0'});
    assert.equal(ai.find(aiGrant.uid).piece.id,item.id);
    assert.equal(p.funds,funds);
    h.invariants();
  } finally { h.m.dispose(); }
});

test('unbanned operator grants auto-promote and preserve shared pool accounting', () => {
  const {h,lobby,body} = fixture();
  try {
    const p = h.ps('p_0');
    const entry = catalogOf(h.m).chess.find(x => x.name === '艾丝黛尔');
    assert.ok(entry);
    const before = h.m.pool.left(entry.id), funds = p.funds;
    let result;
    for (let n=0;n<h.m.gd.mergeCount(entry.id);n++) result = applyEdit(lobby,{...body,field:'chess',operation:'grant',id:entry.id});
    assert.equal(result.merged,true);
    assert.equal(p.find(result.uid).piece.id,h.m.gd.goldenIdOf(entry.id));
    assert.ok(p.layers.sargonShip > 0,'native onGain trait ran');
    assert.equal(h.m.pool.left(entry.id),before-h.m.gd.mergeCount(entry.id));
    assert.equal(p.funds,funds);
    h.invariants();
  } finally { h.m.dispose(); }
});

test('catalog is match-specific; direct requests for banned/hidden/unknown IDs are rejected', () => {
  const {h,lobby,body} = fixture();
  try {
    const c = catalogOf(h.m), p = h.ps('p_0');
    assert.ok(h.m.bannedChess.length > 0);
    assert.ok(c.chess.every(x => h.m.pool.has(x.id) && !h.m.bannedChess.includes(x.id)));
    const original = JSON.stringify(p.privateView());
    for (const id of [h.m.bannedChess[0],'__proto__','missing',null]) assert.throws(() => applyEdit(lobby,{...body,field:'chess',operation:'grant',id}));
    assert.throws(() => applyEdit(lobby,{...body,field:'item',operation:'grant',id:'constructor'}));
    assert.throws(() => applyEdit(lobby,{...body,field:'item',operation:'set',id:c.items[0].id}));
    assert.equal(JSON.stringify(p.privateView()),original);
    p.ready=true;
    assert.throws(() => applyEdit(lobby,{...body,field:'item',operation:'grant',id:c.items[0].id}),/取消准备/);
  } finally { h.m.dispose(); }
});

test('overflow uses temporary slots, full inventory rejects without losing objects, full merge works', () => {
  const {h,lobby,body} = fixture();
  try {
    const p=h.ps('p_0'), c=catalogOf(h.m);
    const normal=c.items.find(x=>x.name==='维式重锤' && !x.golden);
    const filler=c.items.find(x=>x.golden);
    const grant=id=>applyEdit(lobby,{...body,field:'item',operation:'grant',id});
    grant(normal.id);
    while(p.hand.some(x=>!x)) grant(filler.id);
    const overflow=grant(filler.id);
    assert.equal(p.find(overflow.uid).area,'temp');
    while(p.temp.some(x=>!x)) grant(filler.id);
    const before=JSON.stringify(p.privateView());
    assert.throws(()=>grant(filler.id),/已满/);
    const unit=c.chess[0];
    assert.throws(()=>applyEdit(lobby,{...body,field:'chess',operation:'grant',id:unit.id}),/已满/);
    assert.equal(JSON.stringify(p.privateView()),before);
    assert.equal(grant(normal.id).merged,true);
    h.invariants();
  } finally { h.m.dispose(); }
});

test('every catalog item can be granted from current game data and synchronized', () => {
  const initial=fixture(); const entries=catalogOf(initial.h.m).items; initial.h.m.dispose();
  for(const entry of entries) {
    const {h,lobby,body}=fixture();
    try {
      const result=applyEdit(lobby,{...body,field:'item',operation:'grant',id:entry.id});
      assert.equal(h.ps('p_0').find(result.uid).piece.id,entry.id,entry.name);
      assert.ok(h.lastTo('p_0','m.private').hand.some(x=>x?.uid===result.uid),entry.name);
      h.invariants();
    } finally {h.m.dispose();}
  }
});

test('extension refuses a server listening outside loopback', () => {
  assert.throws(() => attachLocalTools({server:{address:() => ({address:'0.0.0.0',port:3000})}}), /loopback/);
});

test('match identity stays stable across rounds, but old edits cannot target a new match in the same room', () => {
  const first = fixture(), second = fixture();
  try {
    const firstId = localMatchId(first.h.m);
    first.h.m.round++;
    assert.equal(localMatchId(first.h.m),firstId);
    assert.notEqual(localMatchId(second.h.m),firstId);
    first.lobby.rooms.get('TEST').match = second.h.m;
    const funds = second.h.ps('p_0').funds;
    assert.throws(() => applyEdit(first.lobby,first.body),/对局已变化/);
    assert.equal(second.h.ps('p_0').funds,funds);
  } finally { first.h.m.dispose(); second.h.m.dispose(); }
});
