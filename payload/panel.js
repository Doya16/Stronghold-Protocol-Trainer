import { store } from '/js/store.js';

const endpoint = '/__local-tools/';
let snapshot, token, opened = false, busy = false, refreshing = false, revision = 0;
let catalog = null, catalogLoading = null, activeTab = 'values';
let moneyDirty = false, layersDirty = false, messageTimer;
const host = document.createElement('div');
host.id = 'sp-local-tools';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
  <style>
    :host{position:fixed;right:16px;bottom:16px;z-index:100000;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#e8f3ef;color-scheme:dark}
    *{box-sizing:border-box} [hidden]{display:none!important}
    button,input,select{font:inherit;border-radius:7px;border:1px solid #3c5550;color:#e8f3ef;background:#1b2a27;min-height:36px}
    button{cursor:pointer;padding:6px 12px} button:hover:enabled{border-color:#5ce0b5;background:#243b33}
    button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #6de3bd;outline-offset:2px}
    button:disabled,input:disabled,select:disabled{opacity:.45;cursor:default}
    #toggle{background:#152c24;border-color:#4cbe96;box-shadow:0 5px 24px #0009}
    #panel{width:min(460px,calc(100vw - 32px));max-height:calc(100dvh - 86px);display:flex;flex-direction:column;overflow:hidden;margin-bottom:10px;padding:16px;background:#101c19f7;border:1px solid #3f6859;border-radius:12px;box-shadow:0 15px 65px #000b}
    #panel>header,#panel>.hint,#panel>label,#panel>select,#status,nav,#message{flex-shrink:0}#values,#catalog{min-height:0;overflow:auto;overscroll-behavior:contain}
    header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}h2{font-size:18px;margin:0}#close{min-height:28px;padding:0 9px}
    .tag{color:#7adbbb;font-size:11px;letter-spacing:1px}.hint{font-size:12px;color:#a3b8af;margin:6px 0 12px}
    label{display:block;margin:10px 0 5px;font-weight:600}select{width:100%;padding:6px}input{width:100%;min-width:0;padding:6px 10px}
    .row{display:flex;gap:8px}.row input{flex:1}.row button{white-space:nowrap}.quick{margin-top:7px;display:flex;gap:7px}.quick button{font-size:12px;flex:1}
    section{border-top:1px solid #2a4037;margin-top:13px;padding-top:3px}.current{font-size:12px;color:#70d7b0;margin:7px 0}
    #status{padding:8px 10px;border-radius:6px;background:#21352d;font-size:12px;margin-top:10px}
    #message{min-height:21px;font-size:12px;margin:10px 0 0;color:#79e0b7}#message.error{color:#ffb9ab}
    nav{display:flex;gap:6px;margin-top:12px}nav button{flex:1;padding:6px}nav button[aria-selected=true]{background:#245340;border-color:#79e0b7}
    .filters{display:flex;gap:7px;margin:12px 0}.filters input{flex:1}.filters select{width:100px}
    #catalog-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:3px}
    .entry{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;padding:7px 3px;font-size:12px;line-height:1.3;min-height:102px}
    .entry img{width:48px;height:48px;object-fit:contain}.entry .fallback{width:48px;height:48px;display:grid;place-items:center;font-size:23px;color:#7adbbb}
    .entry small{color:#9cb1a8;font-size:10px}.entry.golden{border-color:#ac8b4a}.entry span{text-align:center;overflow-wrap:anywhere}
    #catalog-note{margin:8px 0;font-size:12px;color:#a3b8af}#message{background:#101c19;padding:4px 0;margin-bottom:0}
    @media(max-height:550px){:host{right:8px;bottom:8px}#panel{max-height:calc(100dvh - 64px);padding:12px}#panel>.hint{display:none}header{margin-bottom:0}label{margin-top:5px}nav{margin-top:6px}#status{margin-top:5px;padding:5px 8px}}
  </style>
  <aside id="panel" role="dialog" aria-label="本地修改面板" hidden>
    <header><div><div class="tag">STRONGHOLD PROTOCOL TRAINER</div><h2>卫戍协议修改器</h2></div><button id="refresh" aria-label="刷新修改面板">刷新</button><button id="close" aria-label="关闭修改面板">×</button></header>
    <p class="hint">休整期可修改自己或 AI 队友。Ctrl + Shift + M 开关面板。</p>
    <label for="player">修改对象</label><select id="player" aria-label="修改对象"></select>
    <div id="status" role="status">请先开始一局模拟。</div>
    <nav role="tablist" aria-label="修改功能"><button id="tab-values" role="tab" aria-selected="true" aria-controls="values">数值</button><button id="tab-item" role="tab" aria-selected="false" aria-controls="catalog">物品</button><button id="tab-chess" role="tab" aria-selected="false" aria-controls="catalog">干员</button></nav>
    <div id="values" role="tabpanel" aria-labelledby="tab-values">
    <section>
      <label for="funds">当前金币</label><div id="funds-now" class="current"></div>
      <div class="row"><input id="funds" aria-label="金币数量" type="number" min="0" max="99999" step="1"><button id="set-funds">设置金币</button></div>
      <div class="quick"><button id="add100">+100 金币</button><button id="add1000">+1000 金币</button></div>
    </section>
    <section>
      <label for="bond">盟约叠层</label><select id="bond" aria-label="选择盟约"></select>
      <div id="layers-now" class="current"></div>
      <div class="row"><input id="layers" aria-label="盟约层数" type="number" min="0" max="999" step="1"><button id="set-layers">设置层数</button></div>
      <div class="quick"><button id="zero-layers">设为 0 层</button><button id="max-layers">设为 999 层</button></div>
      <p class="hint">设置层数不会自动激活盟约，也不补发叠层奖励；阵容仍需满足激活条件。</p>
    </section>
    <p class="hint">金币仍按原回合规则结算；修改仅属于当前对局，关闭游戏后清除。</p>
    </div>
    <div id="catalog" role="tabpanel" hidden>
      <div class="filters"><input id="search" type="search" placeholder="搜索名称或 ID" aria-label="搜索物品或干员"><select id="tier" aria-label="筛选阶位"><option value="">全部阶位</option>${[1,2,3,4,5,6].map(n => `<option value="${n}">${n} 阶</option>`).join('')}</select></div>
      <select id="variant" aria-label="筛选物品类型"><option value="">全部物品</option><option value="normal">普通装备</option><option value="golden">强化装备</option><option value="magic">道具</option></select>
      <p id="catalog-note"></p>
      <div id="catalog-grid" aria-label="点击图标获得一件"></div>
      <p class="hint">每次点击免费获得一件，正常触发获得效果与自动合成。优先进入整备区，满时进入暂存区；暂存区仍按游戏规则清理。干员为初始形态，列表已排除本局禁用干员。</p>
    </div>
    <p id="message" role="status" aria-live="polite"></p>
  </aside>
  <button id="toggle" aria-controls="panel" aria-expanded="false">修改面板</button>`;
const $ = id => root.getElementById(id);
const keyOf = (m, p) => `${m.code}:${m.matchId}:${p.id}`;
function targets() { return (snapshot?.matches || []).flatMap(m => m.players.map(p => ({ m, p, key: keyOf(m, p) }))); }
function selected() { return targets().find(t => t.key === $('player').value); }
function options(select, rows, preferred) {
  const signature = JSON.stringify(rows);
  if (select.dataset.signature === signature) return;
  const old = select.value;
  select.replaceChildren(...rows.map(row => {
    const o = document.createElement('option');
    o.value = row.value; o.textContent = row.label; o.disabled = !!row.disabled; return o;
  }));
  select.dataset.signature = signature;
  const enabled = rows.filter(r => !r.disabled);
  select.value = enabled.some(r => r.value === old) ? old : enabled.some(r => r.value === preferred) ? preferred : enabled[0]?.value || '';
}
function paint() {
  const list = targets();
  const me = store.get().me.playerId;
  const oldTarget = $('player').value;
  options($('player'), list.map(({m,p,key}) => ({value:key,label:`${p.name}${p.id === me ? '（我）' : p.isBot ? '（AI）' : ''} · ${m.code}`})), list.find(t => t.p.id === me)?.key);
  if ($('player').value !== oldTarget) moneyDirty = layersDirty = false;
  const target = selected(), {m,p} = target || {};
  const canEdit = snapshot?.apiVersion === 3 && !!p?.editable && !busy;
  $('refresh').disabled = busy;
  $('player').disabled = !list.length || busy;
  $('status').textContent = !target ? '请先开始一局模拟，进入休整期后即可修改。' : `第 ${m.round} 回合 · ${m.phaseName}${!p.alive ? ' · 该玩家已淘汰' : p.ready ? ' · 已准备，请先取消准备' : !p.editable ? ' · 休整期可修改' : ''}`;
  $('funds-now').textContent = p ? `现有 ${p.funds} 金币` : '尚无对局';
  if (!moneyDirty) $('funds').value = p?.funds ?? '';
  const oldBond = $('bond').value;
  const bonds = p?.bonds || [];
  options($('bond'), bonds.map(b => ({value:b.id,label:`${b.name} · ${b.layers} 层${b.disabled ? ' · 本局禁用' : b.active ? ' · 已激活' : ' · 未激活'}`,disabled:b.disabled})), bonds.find(b => b.active && !b.disabled)?.id);
  if ($('bond').value !== oldBond) layersDirty = false;
  const bond = bonds.find(b => b.id === $('bond').value);
  $('layers-now').textContent = bond ? `现有 ${bond.layers} 层 · ${bond.active ? '已激活' : '未激活'}` : '请选择盟约';
  if (!layersDirty) $('layers').value = bond?.layers ?? '';
  for (const id of ['funds','set-funds','add100','add1000']) $(id).disabled = !canEdit;
  $('bond').disabled = !bonds.length || busy;
  for (const id of ['layers','set-layers','zero-layers','max-layers']) $(id).disabled = !canEdit || !bond || bond.disabled;
  paintCatalog(canEdit);
}
async function loadCatalog() {
  const target = selected();
  if (!target || activeTab === 'values' || snapshot?.apiVersion !== 3) return;
  const id = target.m.matchId;
  if (catalog?.matchId === id || catalogLoading === id) return;
  catalogLoading = id;
  try {
    const result = await api('catalog?' + new URLSearchParams({ roomCode:target.m.code, matchId:id }));
    if (selected()?.m.matchId === id) { catalog = result; paint(); }
  } catch (e) { if (selected()?.m.matchId === id) notify(e.message, true); }
  finally { if (catalogLoading === id) catalogLoading = null; }
}
function paintCatalog(canEdit) {
  if (activeTab === 'values') return;
  const target = selected(), current = catalog?.matchId === target?.m.matchId ? catalog : null;
  const text = $('search').value.trim().toLocaleLowerCase();
  const variant = $('variant').value;
  const rows = (current?.[activeTab === 'item' ? 'items' : 'chess'] || []).filter(x =>
    (!text || `${x.name} ${x.id} ${x.description}`.toLocaleLowerCase().includes(text)) &&
    (!$('tier').value || x.tier === Number($('tier').value)) &&
    (activeTab === 'chess' || !variant || (variant === 'magic' ? x.type === '道具' : x.type === '装备' && x.golden === (variant === 'golden'))));
  $('catalog-note').textContent = !target ? '请先开始一局模拟。' : !current ? '正在读取本局列表…' :
    `${rows.length} 项${activeTab === 'chess' ? ` · 已排除 ${current.bannedCount} 名禁用干员` : ''} · 整备区空位 ${target.p.handFree} · 暂存区空位 ${target.p.tempFree}`;
  const signature = JSON.stringify([target?.key, activeTab, text, $('tier').value, variant, rows]);
  const grid = $('catalog-grid');
  if (grid.dataset.signature !== signature) {
    grid.dataset.signature = signature;
    grid.replaceChildren(...rows.map(entry => {
      const button = document.createElement('button');
      button.className = 'entry' + (entry.golden ? ' golden' : '');
      const label = entry.name + (entry.golden ? '（强化）' : '');
      button.setAttribute('aria-label', `获得${label}`);
      button.title = `${label} · ${entry.tier} 阶\n${entry.description}\n点击获得一件`;
      const fallback = document.createElement('span'); fallback.className = 'fallback'; fallback.textContent = entry.name.slice(0,1);
      if (entry.icon) {
        const img = document.createElement('img'); img.src = entry.icon; img.alt = ''; img.loading = 'lazy'; img.draggable = false;
        img.onerror = () => img.replaceWith(fallback); button.append(img);
      } else button.append(fallback);
      const name = document.createElement('span'); name.textContent = label;
      const meta = document.createElement('small'); meta.textContent = `${entry.tier} 阶 · ${entry.type}`;
      button.append(name, meta); button.onclick = () => edit(activeTab, entry.id, 'grant'); return button;
    }));
  }
  for (const button of grid.children) button.disabled = !canEdit;
  if (!current && target) loadCatalog();
}
function showTab(tab) {
  activeTab = tab;
  for (const id of ['values','item','chess']) $('tab-' + id).setAttribute('aria-selected', String(id === tab));
  $('values').hidden = tab !== 'values'; $('catalog').hidden = tab === 'values';
  $('catalog').setAttribute('aria-labelledby', 'tab-' + tab);
  $('variant').hidden = tab !== 'item'; $('search').value = ''; $('tier').value = ''; paint();
}
function notify(text, error = false) {
  clearTimeout(messageTimer); $('message').textContent = text; $('message').classList.toggle('error', error);
  if (!error) messageTimer = setTimeout(() => { $('message').textContent = ''; }, 6000);
}
async function api(route, options = {}) {
  const res = await fetch(endpoint + route, { cache: 'no-store', signal: AbortSignal.timeout(5000), ...options });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error || '请求失败。'), { status: res.status });
  return json;
}
async function refresh() {
  if (busy || refreshing) return;
  refreshing = true; const rev = revision;
  try {
    const next = await api('state');
    if (rev !== revision) return;
    token = next.token; snapshot = next; paint();
    if (next.apiVersion !== 3) notify('服务尚未更新，请结束当前对局后关闭并重新启动游戏。', true);
  } catch (e) { if (opened) notify('读取失败，请确认本地服务仍在运行。', true); }
  finally { refreshing = false; }
}
async function edit(field, value, operation = 'set') {
  const target = selected();
  if (snapshot?.apiVersion !== 3 || !target?.p.editable || busy) return;
  const grant = field === 'item' || field === 'chess';
  if (!grant && (value === '' || !Number.isSafeInteger(Number(value)))) { notify('请输入整数。', true); return; }
  const bondId = $('bond').value;
  let needsRefresh = false;
  busy = true; revision++; paint();
  try {
    const result = await api('edit', { method:'POST', headers:{'Content-Type':'application/json','X-Local-Tools-Token':token},
      body:JSON.stringify({roomCode:target.m.code,matchId:target.m.matchId,round:target.m.round,playerId:target.p.id,field,...(grant ? {id:value} : {value:Number(value)}),operation,bondId}) });
    snapshot = {...snapshot,matches:result.matches}; moneyDirty = layersDirty = false;
    const label = field === 'funds' ? '金币' : target.p.bonds.find(b => b.id === bondId)?.name + '层数';
    notify(grant ? `${target.p.name}：已获得 ${result.change.name}${result.change.merged ? '，已自动合成' : ' ×1'}` : `${target.p.name}：${label} ${result.change.before} → ${result.change.after}`);
  } catch (e) { notify(e.message, true); needsRefresh = e.status === 409; }
  finally { busy = false; paint(); if (needsRefresh) refresh(); }
}
function toggle(next = !opened) {
  opened = next; $('panel').hidden = !opened; $('toggle').setAttribute('aria-expanded', String(opened));
  if (opened) { refresh(); $('close').focus(); } else $('toggle').focus();
}
$('toggle').onclick = () => toggle(); $('close').onclick = () => toggle(false);
$('refresh').onclick = () => { moneyDirty = layersDirty = false; refresh(); };
$('player').onchange = () => { moneyDirty = layersDirty = false; paint(); };
for (const tab of ['values','item','chess']) $('tab-' + tab).onclick = () => showTab(tab);
for (const id of ['search','tier','variant']) $(id).addEventListener(id === 'search' ? 'input' : 'change', paint);
$('bond').onchange = () => { layersDirty = false; paint(); };
$('funds').oninput = () => { moneyDirty = true; }; $('layers').oninput = () => { layersDirty = true; };
$('set-funds').onclick = () => edit('funds', $('funds').value);
$('add100').onclick = () => edit('funds', 100, 'add'); $('add1000').onclick = () => edit('funds', 1000, 'add');
$('set-layers').onclick = () => edit('layers', $('layers').value);
$('zero-layers').onclick = () => edit('layers', 0); $('max-layers').onclick = () => edit('layers', 999);
// Stop game keyboard shortcuts while typing or operating the panel.
for (const type of ['keydown','keyup','keypress','pointerdown','pointerup','click','wheel']) root.addEventListener(type, event => event.stopPropagation());
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyM') { event.preventDefault(); event.stopImmediatePropagation(); toggle(); }
  else if (opened && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); toggle(false); }
  else if (opened && event.composedPath().includes(host)) event.stopPropagation();
}, true);
await refresh();
if (snapshot) { document.body.append(host); setInterval(() => { if (opened) refresh(); }, 1200); }
