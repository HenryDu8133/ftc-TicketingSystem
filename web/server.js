/**
 * FTC Ticketing System – Web Console Backend
 * Runtime: Node.js (Express)
 * Purpose: Provide APIs for stations, lines, fares, stats, ticket events
 * Notes: Keep comments concise, English-only for open source.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const DATA_DIR = path.join(__dirname, 'data');
const ensure = (file, def) => {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(def, null, 2));
  return p;
};

const cfgPath = ensure('config.json', {
  api_base: 'http://192.140.163.241:23333/api',
  current_station: { name: 'Station1', code: '01-01' },
  // 等价站/换乘映射（双向），示例：[['01-03','02-04']]
  transfers: [],
  // 优惠设置：当前活动名称与折扣（0.5 表示 5 折）
  promotion: { name: '', discount: 1 }
});
const stationsPath = ensure('stations.json', []);
const linesPath = ensure('lines.json', []);
const faresPath = ensure('fares.json', []);
const statsTicketPath = ensure('stats_ticket.json', []);
const statsGatePath = ensure('stats_gate.json', []);
// 日志文件（JSONL，每行一个JSON）
const logsPath = path.join(DATA_DIR, 'logs.jsonl');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if(!fs.existsSync(logsPath)) fs.writeFileSync(logsPath, '');
// Ticket logs storage
const ticketEventsPath = path.join(DATA_DIR, 'ticket_events.jsonl');
const ticketIndexPath = ensure('ticket_index.json', {});
if(!fs.existsSync(ticketEventsPath)) fs.writeFileSync(ticketEventsPath, '');

function appendLog(entry){
  try{ fs.appendFileSync(logsPath, JSON.stringify(entry)+"\n"); }
  catch(_){ /* noop */ }
}
function readLastLogs(max){
  try{
    const txt = fs.readFileSync(logsPath,'utf8');
    const lines = txt.split(/\r?\n/).filter(Boolean);
    const sel = lines.slice(Math.max(0, lines.length - (max||200)));
    return sel.map(l=>{ try{ return JSON.parse(l); } catch(_){ return { raw:l }; } });
  }catch(_){ return []; }
}

// Ticket log helpers
function appendTicketEvent(ev){
  try{ fs.appendFileSync(ticketEventsPath, JSON.stringify(ev)+"\n"); }catch(_){ /* noop */ }
}
function readAllTicketEvents(){
  try{
    const txt = fs.readFileSync(ticketEventsPath, 'utf8');
    return txt.split(/\r?\n/).filter(Boolean).map(l=>{ try{ return JSON.parse(l); }catch(_){ return null; } }).filter(Boolean);
  }catch(_){ return []; }
}
function readTicketIndex(){
  try{ return readJSON(ticketIndexPath); }catch(_){ return {}; }
}
function writeTicketIndex(idx){
  try{ writeJSON(ticketIndexPath, idx); }catch(_){ /* noop */ }
}
function upsertTicketIndex(update){
  const idx = readTicketIndex();
  const id = String(update.ticket_id||'').trim();
  if(!id) return;
  const cur = idx[id] || {};
  const merged = { ...cur, ...update, last_update_ts: Date.now() };
  idx[id] = merged;
  writeTicketIndex(idx);
}

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

// Build a consolidated export payload for ComputerCraft/clients
function buildExportPayload(){
  return {
    config: readJSON(cfgPath),
    stations: readJSON(stationsPath),
    lines: readJSON(linesPath),
    fares: readJSON(faresPath),
    stats_ticket: readJSON(statsTicketPath),
    stats_gate: readJSON(statsGatePath),
  };
}

// Periodically write export file to web/data/export.json for wget-friendly access
const exportPath = path.join(DATA_DIR, 'export.json');
function writeExportFile(){
  try { writeJSON(exportPath, buildExportPayload()); }
  catch(e){ /* noop: keep server running even if write fails */ }
}
// Immediate write and then every 10 seconds
writeExportFile();
setInterval(writeExportFile, 10_000);

// API
// Root /api returns consolidated config for wget-friendly clients
// Note: intentionally excludes current_station per request
app.get('/api', (req, res) => {
  res.json({
    api_base: readJSON(cfgPath).api_base,
    stations: readJSON(stationsPath),
    lines: readJSON(linesPath),
    fares: readJSON(faresPath),
    transfers: readJSON(cfgPath).transfers || [],
    promotion: readJSON(cfgPath).promotion || { name:'', discount:1 },
    stats_ticket: readJSON(statsTicketPath),
    stats_gate: readJSON(statsGatePath)
  });
});
app.get('/api/', (req, res) => {
  res.json({
    api_base: readJSON(cfgPath).api_base,
    stations: readJSON(stationsPath),
    lines: readJSON(linesPath),
    fares: readJSON(faresPath),
    transfers: readJSON(cfgPath).transfers || [],
    promotion: readJSON(cfgPath).promotion || { name:'', discount:1 }
  });
});
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// 操作日志：写入与读取
app.post('/api/log', (req, res) => {
  const ip = (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '';
  const { type, ...detail } = req.body || {};
  appendLog({ ts: new Date().toISOString(), ip, type: type||'event', detail });
  res.json({ ok:true });
});
app.get('/api/logs', (req, res) => {
  const max = Number(req.query.max)||200;
  res.json({ ok:true, logs: readLastLogs(max) });
});

// =====================
// Ticket logs: sale + status + queries
// =====================
app.post('/api/tickets/sale', (req, res) => {
  const ip = (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '';
  const b = req.body || {};
  const id = String(b.ticket_id||'').trim();
  if(!id) return res.status(400).json({ ok:false, error:'ticket_id required' });
  const ev = {
    type: 'sale',
    ts: Number(b.ts||Date.now()),
    ip,
    ticket_id: id,
    start: b.start||'',
    terminal: b.terminal||'',
    train_type: b.type||b.train_type||'',
    trips_total: Number(b.trips_total||1),
    station_code: b.station_code||'',
    station_name: b.station_name||'',
    cost: Number(b.cost||0)
  };
  appendTicketEvent(ev);
  upsertTicketIndex({ ticket_id:id, start:ev.start, terminal:ev.terminal, train_type:ev.train_type, trips_total:ev.trips_total, station_code:ev.station_code, station_name:ev.station_name, cost:ev.cost, status:'sold', last_event:'sale' });
  res.json({ ok:true });
});
app.post('/api/tickets/status', (req, res) => {
  const ip = (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '';
  const b = req.body || {};
  const id = String(b.ticket_id||'').trim();
  const action = String(b.action||'').trim();
  if(!id) return res.status(400).json({ ok:false, error:'ticket_id required' });
  if(!['enter','exit','update'].includes(action)) return res.status(400).json({ ok:false, error:'invalid action' });
  const ev = {
    type: 'status',
    action,
    ts: Number(b.ts||Date.now()),
    ip,
    ticket_id: id,
    station_code: b.station_code||'',
    trips_remaining: (b.trips_remaining!=null)?Number(b.trips_remaining):undefined
  };
  appendTicketEvent(ev);
  const idxUpdate = { ticket_id:id, last_event:'status', last_action:action, last_station_code:ev.station_code };
  if(action==='enter') idxUpdate.status = 'entered';
  if(action==='exit') idxUpdate.status = 'exited';
  if(ev.trips_remaining!=null) idxUpdate.trips_remaining = ev.trips_remaining;
  upsertTicketIndex(idxUpdate);
  res.json({ ok:true });
});
app.get('/api/tickets/:id', (req, res) => {
  const id = String(req.params.id||'').trim();
  if(!id) return res.status(400).json({ ok:false, error:'ticket_id required' });
  const idx = readTicketIndex();
  const events = readAllTicketEvents().filter(e=>e && e.ticket_id===id);
  res.json({ ok:true, ticket_id:id, index: idx[id]||{}, events });
});
app.get('/api/tickets', (req, res) => {
  const q = String(req.query.q||'').trim().toLowerCase();
  const idx = readTicketIndex();
  let list = Object.entries(idx).map(([ticket_id, data])=>({ ticket_id, ...data }));
  if(q){
    list = list.filter(t => t.ticket_id.toLowerCase().includes(q) || String(t.station_code||'').toLowerCase().includes(q) || String(t.start||'').toLowerCase().includes(q) || String(t.terminal||'').toLowerCase().includes(q));
  }
  // Sort by last_update_ts desc
  list.sort((a,b)=>Number(b.last_update_ts||0)-Number(a.last_update_ts||0));
  res.json({ ok:true, tickets:list });
});
// Support trailing-slash access to avoid 404
app.get('/api/tickets/', (req, res) => {
  const q = String(req.query.q||'').trim().toLowerCase();
  const idx = readTicketIndex();
  let list = Object.entries(idx).map(([ticket_id, data])=>({ ticket_id, ...data }));
  if(q){
    list = list.filter(t => t.ticket_id.toLowerCase().includes(q) || String(t.station_code||'').toLowerCase().includes(q) || String(t.start||'').toLowerCase().includes(q) || String(t.terminal||'').toLowerCase().includes(q));
  }
  list.sort((a,b)=>Number(b.last_update_ts||0)-Number(a.last_update_ts||0));
  res.json({ ok:true, tickets:list });
});

// Consolidated export for clients wanting one-shot snapshot
app.get('/api/export', (req, res) => {
  res.json(buildExportPayload());
});
app.get('/api/config', (req, res) => {
  res.json({
    api_base: readJSON(cfgPath).api_base,
    current_station: readJSON(cfgPath).current_station,
    stations: readJSON(stationsPath),
    lines: readJSON(linesPath),
    fares: readJSON(faresPath),
    transfers: readJSON(cfgPath).transfers || [],
    promotion: readJSON(cfgPath).promotion || { name:'', discount:1 }
  });
});

// Webview click noop (for IDE webview integrations)
app.post('/api/webviewClick', (req, res) => {
  res.json({ ok: true });
});

// Update API base
app.put('/api/config/api_base', (req, res) => {
  const { api_base } = req.body || {};
  if(!api_base) return res.status(400).json({ ok:false, error:'api_base required' });
  const cfg = readJSON(cfgPath);
  cfg.api_base = api_base;
  writeJSON(cfgPath, cfg);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_config_api_base', detail:{ api_base } });
  res.json({ ok: true });
});

// Update transfers (replace all)
app.put('/api/config/transfers', (req, res) => {
  const { transfers } = req.body || {};
  if(!Array.isArray(transfers)) return res.status(400).json({ ok:false, error:'transfers must be array' });
  const cfg = readJSON(cfgPath);
  cfg.transfers = transfers;
  writeJSON(cfgPath, cfg);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_config_transfers', detail:{ transfers } });
  res.json({ ok:true });
});

// Update promotion (name + discount)
app.put('/api/config/promotion', (req, res) => {
  const { name, discount } = req.body || {};
  const d = Number(discount);
  if(!(d >= 0 && d <= 1)) return res.status(400).json({ ok:false, error:'discount must be between 0 and 1' });
  const cfg = readJSON(cfgPath);
  cfg.promotion = { name: String(name||''), discount: d };
  writeJSON(cfgPath, cfg);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_config_promotion', detail:{ name: String(name||''), discount: d } });
  res.json({ ok:true });
});
// Some environments/proxies may block PUT; accept POST as fallback
app.post('/api/config/promotion', (req, res) => {
  const { name, discount } = req.body || {};
  const d = Number(discount);
  if(!(d >= 0 && d <= 1)) return res.status(400).json({ ok:false, error:'discount must be between 0 and 1' });
  const cfg = readJSON(cfgPath);
  cfg.promotion = { name: String(name||''), discount: d };
  writeJSON(cfgPath, cfg);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_config_promotion', detail:{ name: String(name||''), discount: d } });
  res.json({ ok:true, method:'POST' });
});

// Generic config update: allow merging arbitrary fields (e.g., promotion) in one call
app.put('/api/config', (req, res) => {
  const incoming = req.body || {};
  const cfg = readJSON(cfgPath);
  // Validate and normalize known fields
  if(incoming.api_base && typeof incoming.api_base === 'string') cfg.api_base = incoming.api_base;
  if(Array.isArray(incoming.transfers)) cfg.transfers = incoming.transfers;
  if(incoming.current_station && typeof incoming.current_station === 'object') cfg.current_station = incoming.current_station;
  if(incoming.promotion){
    const p = incoming.promotion || {};
    const d = Number(p.discount);
    if(!(d >= 0 && d <= 1)) return res.status(400).json({ ok:false, error:'promotion.discount must be between 0 and 1' });
    cfg.promotion = { name: String(p.name||''), discount: d };
  }
  writeJSON(cfgPath, cfg);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_config_generic', detail: incoming });
  res.json({ ok:true, config: cfg });
});

// =====================
// Stats endpoints
// =====================
const statsPath = path.join(__dirname, 'data', 'stats.jsonl');
function appendStat(rec){
  try{ fs.appendFileSync(statsPath, JSON.stringify(rec)+'\n'); }catch(_){ /* noop */ }
}
function readStats(){
  if(!fs.existsSync(statsPath)) return [];
  try{
    const txt = fs.readFileSync(statsPath,'utf8');
    return txt.split('\n').filter(Boolean).map(s=>JSON.parse(s)).filter(r=>typeof r==='object');
  }catch(_){ return []; }
}

// Device upload endpoint (optional but useful)
app.post('/api/stats/upload', (req, res) => {
  const r = req.body || {};
  // minimal validation
  if(!r.window_day && !r.window_hour) return res.status(400).json({ ok:false, error:'missing window_day/hour' });
  appendStat({
    device: r.device || 'unknown',
    station_code: r.station_code || '',
    station_name: r.station_name || '',
    sold_tickets: Number(r.sold_tickets||0),
    sold_trips: Number(r.sold_trips||0),
    revenue: Number(r.revenue||0),
    ts: Number(r.ts||Date.now()),
    window_hour: String(r.window_hour||''),
    window_day: String(r.window_day||''),
    type: 'ticket'
  });
  res.json({ ok:true });
});

function aggregateBy(key){
  const list = readStats().filter(r=>r.type==='ticket');
  const map = new Map();
  for(const r of list){
    const k = String(r[key]||'');
    if(!k) continue;
    const cur = map.get(k) || { window: k, sold_tickets:0, sold_trips:0, revenue:0 };
    cur.sold_tickets += Number(r.sold_tickets||0);
    cur.sold_trips += Number(r.sold_trips||0);
    cur.revenue += Number(r.revenue||0);
    map.set(k, cur);
  }
  return Array.from(map.values()).sort((a,b)=>a.window.localeCompare(b.window));
}

function aggregateTotal(){
  const list = readStats().filter(r=>r.type==='ticket');
  const total = { sold_tickets:0, sold_trips:0, revenue:0 };
  for(const r of list){
    total.sold_tickets += Number(r.sold_tickets||0);
    total.sold_trips += Number(r.sold_trips||0);
    total.revenue += Number(r.revenue||0);
  }
  return total;
}

app.get('/api/stats/ticket/byDay', (req,res)=>{
  res.json(aggregateBy('window_day'));
});
app.get('/api/stats/ticket/byHour', (req,res)=>{
  res.json(aggregateBy('window_hour'));
});
app.get('/api/stats/ticket/total', (req,res)=>{
  res.json(aggregateTotal());
});

// Gate stats placeholders to avoid 404; return empty series/zeros until implemented
app.get('/api/stats/gate/byDay', (req,res)=>{ res.json([]); });
app.get('/api/stats/gate/byHour', (req,res)=>{ res.json([]); });
app.get('/api/stats/gate/total', (req,res)=>{ res.json({ entries:0, exits:0 }); });

// Stations
app.get('/api/stations', (req, res) => res.json(readJSON(stationsPath)));
app.post('/api/stations', (req, res) => {
  const all = readJSON(stationsPath);
  all.push(req.body);
  writeJSON(stationsPath, all);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_station', detail:req.body });
  res.json({ ok: true });
});
app.put('/api/stations/:code', (req, res) => {
  const all = readJSON(stationsPath);
  const idx = all.findIndex(s => s.code === req.params.code);
  if (idx < 0) return res.status(404).json({ ok:false, error:'station not found' });
  const incoming = req.body || {};
  const current = all[idx] || {};
  // 保持编号不变，其他字段按传入值更新（未提供的保留原值）
  const updated = { ...current, ...incoming, code: current.code };
  all[idx] = updated;
  writeJSON(stationsPath, all);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_station', detail:{ code:req.params.code, payload: incoming } });
  res.json({ ok:true });
});
app.delete('/api/stations/:code', (req, res) => {
  let all = readJSON(stationsPath);
  all = all.filter(s => s.code !== req.params.code);
  writeJSON(stationsPath, all);
  res.json({ ok: true });
});

// Lines
app.get('/api/lines', (req, res) => res.json(readJSON(linesPath)));
app.post('/api/lines', (req, res) => {
  const all = readJSON(linesPath);
  all.push(req.body);
  writeJSON(linesPath, all);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'add_line', detail:req.body });
  res.json({ ok: true });
});
app.put('/api/lines/:id', (req, res) => {
  const all = readJSON(linesPath);
  const idx = all.findIndex(l => l.id === req.params.id);
  if (idx >= 0) all[idx] = req.body;
  writeJSON(linesPath, all);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_line', detail:{ id:req.params.id, payload:req.body } });
  res.json({ ok: true });
});
app.delete('/api/lines/:id', (req, res) => {
  let all = readJSON(linesPath);
  all = all.filter(l => l.id !== req.params.id);
  writeJSON(linesPath, all);
  res.json({ ok: true });
});

// Fares
app.get('/api/fares', (req, res) => res.json(readJSON(faresPath)));
// add/update single fare (supports cost_regular/cost_express, falls back to cost)
app.post('/api/fares', (req, res) => {
  const all = readJSON(faresPath);
  const { from, to } = req.body || {};
  if(!from || !to) return res.status(400).json({ ok:false, error:'from/to required' });
  // remove any existing fare for the segment
  const rest = all.filter(f => !(f.from === from && f.to === to));
  const payload = {
    from, to,
    cost_regular: req.body.cost_regular ?? req.body.cost ?? 0,
    cost_express: req.body.cost_express ?? req.body.cost ?? 0
  };
  rest.push(payload);
  writeJSON(faresPath, rest);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'update_fare', detail: payload });
  res.json({ ok: true });
});
// bulk update fares: { segments:[{from,to},...], cost_regular, cost_express }
app.post('/api/fares/bulk', (req, res) => {
  const { segments, cost_regular, cost_express } = req.body || {};
  if(!Array.isArray(segments) || segments.length===0) return res.status(400).json({ ok:false, error:'segments required' });
  let all = readJSON(faresPath);
  for(const seg of segments){
    const { from, to } = seg;
    if(!from || !to) continue;
    all = all.filter(f => !(f.from === from && f.to === to));
    all.push({ from, to, cost_regular: cost_regular ?? 0, cost_express: cost_express ?? 0 });
  }
  writeJSON(faresPath, all);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'bulk_update_fares', detail:{ segments, cost_regular, cost_express } });
  res.json({ ok: true, updated: segments.length });
});
app.delete('/api/fares', (req, res) => {
  const { from, to } = req.body;
  let all = readJSON(faresPath);
  all = all.filter(f => !(f.from === from && f.to === to));
  writeJSON(faresPath, all);
  appendLog({ ts: new Date().toISOString(), ip: (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '', type:'delete_fare', detail:{ from:req.body?.from, to:req.body?.to } });
  res.json({ ok: true });
});

// -------------------------------
// Stats ingest & aggregation
// -------------------------------
function pushArray(path, item){
  const arr = readJSON(path);
  arr.push(item);
  writeJSON(path, arr);
}
function aggregateStats(items, key){
  const out = {};
  for(const it of items){
    const k = it[key] || it.window_hour || it.window_day || 'unknown';
    if(!out[k]) out[k] = { sold_tickets:0, sold_trips:0, revenue:0, entries:0, exits:0 };
    out[k].sold_tickets += it.sold_tickets||0;
    out[k].sold_trips += it.sold_trips||0;
    out[k].revenue += it.revenue||0;
    out[k].entries += it.entries||0;
    out[k].exits += it.exits||0;
  }
  return out;
}

// Ticket machine stats
app.post('/api/stats/ticket', (req, res) => {
  const { device, station_code, station_name, sold_tickets, sold_trips, revenue, ts, window_hour, window_day } = req.body || {};
  if(device !== 'ticket_machine') return res.status(400).json({ ok:false, error:'device must be ticket_machine' });
  const item = { device, station_code, station_name, sold_tickets: sold_tickets||0, sold_trips: sold_trips||0, revenue: revenue||0, ts: ts||Date.now(), window_hour, window_day };
  pushArray(statsTicketPath, item);
  res.json({ ok:true });
});
app.get('/api/stats/ticket/total', (req, res) => {
  const all = readJSON(statsTicketPath);
  const sum = all.reduce((acc, it) => ({ sold_tickets: acc.sold_tickets + (it.sold_tickets||0), sold_trips: acc.sold_trips + (it.sold_trips||0), revenue: acc.revenue + (it.revenue||0) }), { sold_tickets:0, sold_trips:0, revenue:0 });
  res.json({ ok:true, total: sum });
});
app.get('/api/stats/ticket/byHour', (req, res) => {
  const all = readJSON(statsTicketPath);
  res.json({ ok:true, byHour: aggregateStats(all, 'window_hour') });
});
app.get('/api/stats/ticket/byDay', (req, res) => {
  const all = readJSON(statsTicketPath);
  res.json({ ok:true, byDay: aggregateStats(all, 'window_day') });
});

// Gate stats
app.post('/api/stats/gate', (req, res) => {
  const { device, station_code, entries, exits, ts, window_hour, window_day } = req.body || {};
  if(device !== 'gate') return res.status(400).json({ ok:false, error:'device must be gate' });
  const item = { device, station_code, entries: entries||0, exits: exits||0, ts: ts||Date.now(), window_hour, window_day };
  pushArray(statsGatePath, item);
  res.json({ ok:true });
});
app.get('/api/stats/gate/total', (req, res) => {
  const all = readJSON(statsGatePath);
  const sum = all.reduce((acc, it) => ({ entries: acc.entries + (it.entries||0), exits: acc.exits + (it.exits||0) }), { entries:0, exits:0 });
  res.json({ ok:true, total: sum });
});
app.get('/api/stats/gate/byHour', (req, res) => {
  const all = readJSON(statsGatePath);
  res.json({ ok:true, byHour: aggregateStats(all, 'window_hour') });
});
app.get('/api/stats/gate/byDay', (req, res) => {
  const all = readJSON(statsGatePath);
  res.json({ ok:true, byDay: aggregateStats(all, 'window_day') });
});

const PORT = process.env.PORT || 23333;
const HOST = process.env.HOST || '0.0.0.0';

// Serve admin UI (mounted AFTER API to avoid any accidental static interception)
app.use('/', express.static(path.join(__dirname)));

app.listen(PORT, HOST, () => {
  console.log(`ftc admin server running at http://${HOST}:${PORT}/`);
});
