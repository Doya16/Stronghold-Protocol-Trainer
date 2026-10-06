import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, gameImport } from '../payload/game-api.mjs';
const { TestClient } = await gameImport('test/helpers/wsClient.js');
import { attachLocalTools } from '../payload/local-tools.mjs';

test('a real loopback player can edit gold and layers after normal room creation and start', { timeout: 45000 }, async () => {
  const srv = await startServer({host:'127.0.0.1',port:0,quiet:true,seedFn:() => 4});
  attachLocalTools(srv);
  const client = await TestClient.connect(srv.url.replace('http:', 'ws:') + '/ws');
  try {
    const welcome = await client.hello('真实会话验收');
    const ok = async msg => assert.equal((await client.request(msg)).t, 'ok', msg.t);
    await ok({t:'room.create',mode:'solo',difficulty:'FUNNY'});
    const roomState = await client.waitFor('room.state');
    await ok({t:'room.start'});
    await client.waitFor('m.public',m => m.phase === 'INFO_CHECK',10000);
    await ok({t:'g.infoReady'});
    await client.waitFor('m.public',m => m.phase === 'BAND_DRAFT',10000);
    await ok({t:'g.band',bandId:'band_bldsk'});
    await client.waitFor('m.public',m => m.phase === 'PREP',20000);
    const state = await (await fetch(srv.url + '/__local-tools/state')).json();
    const match = state.matches.find(m => m.code === roomState.code);
    const player = match.players.find(p => p.id === welcome.playerId);
    assert.ok(player?.editable);
    assert.equal(srv.lobby.getRoom(roomState.code).matchKey, null, 'real local matches have no network rate-limit key');
    const edit = async fields => {
      const res = await fetch(srv.url + '/__local-tools/edit', {
        method:'POST',headers:{Origin:srv.url,'Content-Type':'application/json','X-Local-Tools-Token':state.token},
        body:JSON.stringify({roomCode:match.code,matchId:match.matchId,playerId:player.id,round:match.round,...fields}),
      });
      const body = await res.json();
      assert.equal(res.status,200,body.error);
      return body;
    };
    await edit({field:'funds',value:100});
    const updated = await client.waitFor('m.private',m => m.funds === 100);
    assert.equal(updated.funds,100);
    // A real purchase spends the edited balance and updates the ordinary game client.
    const serverPlayer = srv.lobby.getRoom(match.code).match.players.get(player.id);
    const slot = updated.shop.slots.findIndex(s => s && !s.sold && s.price > 0);
    assert.ok(slot >= 0);
    const price = updated.shop.slots[slot].price;
    await ok({t:'g.buy',slot});
    await client.waitFor('m.private',m => m.funds === 100 - price);
    const bond = player.bonds.find(b => !b.disabled);
    await edit({field:'layers',bondId:bond.id,value:99});
    const layerFrame = await client.waitFor('m.private',m => m.bonds.some(b => b.bondId === bond.id && b.layers === 99));
    assert.ok(layerFrame.bonds.some(b => b.bondId === bond.id && b.layers === 99));
    assert.equal(serverPlayer.battleInput().bonds[bond.id].layers,99);
    const catalog=await (await fetch(srv.url+'/__local-tools/catalog?'+new URLSearchParams({roomCode:match.code,matchId:match.matchId}))).json();
    const unit=catalog.chess.find(x=>x.name==='艾丝黛尔');
    const item=catalog.items.find(x=>x.name==='维式重锤' && !x.golden);
    const operatorGrant=await edit({field:'chess',operation:'grant',id:unit.id});
    await client.waitFor('m.private',m=>m.hand.some(x=>x?.uid===operatorGrant.change.uid));
    const itemGrant=await edit({field:'item',operation:'grant',id:item.id});
    await client.waitFor('m.private',m=>m.hand.some(x=>x?.uid===itemGrant.change.uid));
    await ok({t:'g.equip',itemUid:itemGrant.change.uid,targetUid:operatorGrant.change.uid});
    await client.waitFor('m.private',m=>m.hand.some(x=>x?.uid===operatorGrant.change.uid && x.items.some(it=>it.id===item.id)));
    assert.equal(serverPlayer.find(operatorGrant.change.uid).piece.items[0].id,item.id);
    assert.equal(serverPlayer.funds,100-price,'free grants do not spend gold');
    console.log(`real match verified: gold 100 -> ${100-price} after purchase; ${bond.name} 99 layers`);
    console.log(`real match verified: granted ${unit.name}, granted ${item.name}, equipped via ordinary game action`);
  } finally { await client.close(); await srv.close(); }
});
