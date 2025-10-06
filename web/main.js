/**
 * FTC Ticketing System – Web Console Frontend
 * Purpose: Render editors for stations/lines/fares and ticket management UI
 * Interaction: Uses /api via app.js helpers; shift-click to insert stations
 */
async function fetchJSON(input, init){
  const res = await fetch(input, init);
  if(!res.ok){
    const txt = await res.text().catch(()=>'');
    throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? ' - '+txt.slice(0,120) : ''}`);
  }
  const ct = res.headers.get('content-type') || '';
  if(!ct.includes('application/json')){
    const txt = await res.text().catch(()=>'');
    throw new Error(`Non-JSON response: ${txt.slice(0,120)}`);
  }
  return res.json();
}

const api = {
  async getConfig(){ return fetchJSON('/api/config'); },
  async setApiBase(base){ return fetchJSON('/api/config/api_base',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ api_base: base })}); },
  async setTransfers(list){ return fetchJSON('/api/config/transfers',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ transfers: list })}); },
  async setPromotion(p){
    try{
      return await fetchJSON('/api/config/promotion',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    }catch(err){
      // 兼容某些环境对 PUT 的屏蔽或路径改写，回退到 POST
      return fetchJSON('/api/config/promotion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    }
  },
  async listStations(){ return fetchJSON('/api/stations'); },
  async addStation(s){ return fetchJSON('/api/stations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}); },
  async updateStation(code, s){ return fetchJSON('/api/stations/'+encodeURIComponent(code),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}); },
  async delStation(code){ return fetchJSON('/api/stations/'+encodeURIComponent(code),{method:'DELETE'}); },
  async listLines(){ return fetchJSON('/api/lines'); },
  async addLine(l){ return fetchJSON('/api/lines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(l)}); },
  async updateLine(id,l){ return fetchJSON('/api/lines/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(l)}); },
  async delLine(id){ return fetchJSON('/api/lines/'+encodeURIComponent(id),{method:'DELETE'}); },
  async listFares(){ return fetchJSON('/api/fares'); },
  async addFare(f){ return fetchJSON('/api/fares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)}); },
  async bulkFares(payload){ return fetchJSON('/api/fares/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); },
  async delFare(f){ return fetchJSON('/api/fares',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)}); },
  // Stats APIs
  async getTicketTotal(){ return fetchJSON('/api/stats/ticket/total'); },
  async getGateTotal(){ return fetchJSON('/api/stats/gate/total'); },
  async listTicketByHour(){ return fetchJSON('/api/stats/ticket/byHour'); },
  async listGateByHour(){ return fetchJSON('/api/stats/gate/byHour'); },
  async listTicketByDay(){ return fetchJSON('/api/stats/ticket/byDay'); },
  async listGateByDay(){ return fetchJSON('/api/stats/gate/byDay'); },
};

const el = id => document.getElementById(id);
const stationCountEl = el('station-count');
const lineCountEl = el('line-count');
const linesEditorEl = document.getElementById('lines-editor');
// Unified station name key (Chinese+English must both match to be the same station); used for transfer detection and fare chart coloring
const nameKey = s => String(`${(s?.name||'')}|${(s?.en_name||'')}`).trim().toLowerCase();
// Stats DOM refs
// Dashboard stats cards: align with IDs in index.html
const totalTicketsEl = el('ticket-total');
const totalTripsEl = el('trip-total');
const totalRevenueEl = el('revenue-total');
const totalEntriesEl = el('entry-total');
const totalExitsEl = el('exit-total');
const hourlyTicketListEl = el('hourly-ticket-list');
const hourlyGateListEl = el('hourly-gate-list');
const dailyTicketListEl = el('daily-ticket-list');
const dailyGateListEl = el('daily-gate-list');
let bulkMode = false;
let selectedSegments = [];
// Initialize UI color mode (light/dark)
try{
  const savedMode = localStorage.getItem('tm_color_mode') || 'dark';
  document.body.classList.toggle('light', savedMode === 'light');
  const modeSel = document.getElementById('colorMode');
  if(modeSel){
    modeSel.value = savedMode;
    modeSel.addEventListener('change', (e)=>{
      const v = e.target.value;
      document.body.classList.toggle('light', v === 'light');
      try{ localStorage.setItem('tm_color_mode', v); }catch(_){ }
    });
  }
}catch(_){ /* ignore storage errors */ }
function setBulkMode(on){
  bulkMode = !!on;
  document.getElementById('bulkMode').classList.toggle('active', !!on);
}
async function applyBulk(){
  if(selectedSegments.length===0){ showToast('请先选择若干区间'); return; }
  const cr = Number(document.getElementById('bulkRegular').value||0);
  const ce = Number(document.getElementById('bulkExpress').value||0);
  await api.bulkFares({ segments: selectedSegments, cost_regular: cr, cost_express: ce }).catch(()=>{});
  logEvent('fares_bulk', { segments: selectedSegments.length, cost_regular: cr, cost_express: ce });
  const [stations, lines, fares] = await Promise.all([ api.listStations(), api.listLines(), api.listFares() ]);
  renderLinesEditor(lines, stations, fares);
  renderFareCharts(stations, fares, lines);
  selectedSegments = [];
  showToast('批量票价已应用');
}

// 标签切换
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.getAttribute('data-tab');
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('show'));
    document.getElementById('tab-'+tab).classList.add('show');
    // 切换到操作日志页时自动刷新
    if(tab==='logs'){
      document.getElementById('refreshLogs')?.click();
    }
  });
});

// 简易模态与Toast
function showToast(text){
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2000);
}

// 统一操作日志上报
function logEvent(type, detail={}){
  try{
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...detail })
    }).catch(()=>{});
  }catch(_){ /* noop */ }
}

function promptModal({title, label, type='text', initial=''}){
  return new Promise(resolve=>{
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    const body = document.getElementById('modal-body');
    body.innerHTML = `<label style="font-weight:700;color:#dbe6ff">${label}</label><input id="modal-input" type="${type}" value="${initial}" />`;
    modal.classList.add('show');
    const ok = document.getElementById('modal-ok');
    const cancel = document.getElementById('modal-cancel');
    const cleanup = ()=>{
      modal.classList.remove('show');
      ok.onclick = cancel.onclick = null;
    };
    ok.onclick = ()=>{ const v = document.getElementById('modal-input').value; cleanup(); resolve(v); };
    cancel.onclick = ()=>{ cleanup(); resolve(null); };
  });
}

// -------------------------------
// Stats rendering helpers
// -------------------------------
function formatWindow(w){
  const s = String(w||'');
  if(s.length===10){ return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)} ${s.slice(8,10)}:00`; }
  if(s.length===8){ return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; }
  return s;
}
function renderStatsTotals(ticketTotal, gateTotal){
  try {
    const t = ticketTotal?.total || ticketTotal || {};
    const g = gateTotal?.total || gateTotal || {};
    const fmt = n => Number(n||0).toLocaleString('zh-CN');
    if(totalTicketsEl) totalTicketsEl.textContent = fmt(t.sold_tickets);
    if(totalTripsEl) totalTripsEl.textContent = fmt(t.sold_trips);
    if(totalRevenueEl) totalRevenueEl.textContent = fmt(t.revenue);
    if(totalEntriesEl) totalEntriesEl.textContent = fmt(g.entries);
    if(totalExitsEl) totalExitsEl.textContent = fmt(g.exits);
  } catch(e){ /* noop */ }
}
function renderGroupedList(containerEl, list, type){
  if(!containerEl) return;
  if(!Array.isArray(list)){
    // list may be an object map { window: agg }
    const arr = [];
    for(const k in (list||{})) arr.push({ window: k, ...(list[k]||{}) });
    list = arr;
  }
  containerEl.innerHTML = '';
  if(!list || list.length===0){ containerEl.textContent = '暂无数据'; return; }
  const wrap = document.createElement('div'); wrap.className='list';
  for(const it of list){
    const w = it.window_hour ?? it.window_day ?? it.window ?? it.hour ?? it.day;
    const tickets = it.tickets ?? it.sold_tickets ?? 0;
    const trips = it.trips ?? it.sold_trips ?? 0;
    const revenue = it.revenue ?? it.total_revenue ?? 0;
    const entries = it.entries ?? 0;
    const exits = it.exits ?? 0;
    const row = document.createElement('div'); row.className='list-item';
    const k = document.createElement('div'); k.className='k'; k.textContent = formatWindow(w);
    const v = document.createElement('div'); v.className='v';
    if(type.startsWith('ticket')) v.textContent = `票:${tickets} 次:${trips} 收:${revenue}`;
    else v.textContent = `进:${entries} 出:${exits}`;
    row.appendChild(k); row.appendChild(v); wrap.appendChild(row);
  }
  containerEl.appendChild(wrap);
}

async function loadAll(){
  try {
    const [cfg, stations, lines, fares] = await Promise.all([
      api.getConfig().catch(()=>({})),
      api.listStations(), api.listLines(), api.listFares()
    ]);
    stationCountEl.textContent = stations.length;
    lineCountEl.textContent = lines.length;
    renderLinesEditor(lines, stations, fares);
    try { localStorage.setItem('tm_cfg_cache', JSON.stringify(cfg||{})); } catch(e){}
    renderFareCharts(stations, fares, lines);
    showChart('regular');
    ensureLogin();
    // 预填优惠与等价站
    if(cfg && cfg.promotion){
      document.getElementById('promoName')?.setAttribute('value', cfg.promotion.name||'');
      const disc = (typeof cfg.promotion.discount === 'number') ? cfg.promotion.discount : 1;
      document.getElementById('promoDiscount')?.setAttribute('value', String(disc));
    }
    // 等价站映射已改为自动识别，无需填充

    // 拉取并渲染统计
    const [ticketTotal, gateTotal, byHourTicket, byHourGate, byDayTicket, byDayGate] = await Promise.all([
      api.getTicketTotal().catch(()=>null),
      api.getGateTotal().catch(()=>null),
      api.listTicketByHour().catch(()=>({})),
      api.listGateByHour().catch(()=>({})),
      api.listTicketByDay().catch(()=>({})),
      api.listGateByDay().catch(()=>({})),
    ]);
    renderStatsTotals(ticketTotal||{}, gateTotal||{});
    renderGroupedList(hourlyTicketListEl, (byHourTicket?.byHour ?? byHourTicket), 'ticket_hour');
    renderGroupedList(hourlyGateListEl, (byHourGate?.byHour ?? byHourGate), 'gate_hour');
    renderGroupedList(dailyTicketListEl, (byDayTicket?.byDay ?? byDayTicket), 'ticket_day');
    renderGroupedList(dailyGateListEl, (byDayGate?.byDay ?? byDayGate), 'gate_day');
  } catch (e) {
    console.warn('API unavailable', e);
    showToast('API错误：'+(e.message||e));
  }
}

// Line editor (SVG)
function renderLinesEditor(lines, stations, fares){
  linesEditorEl.innerHTML = '';
  // Prebuild same-name station groups for transfer marking (auto-detected, no manual mapping)
  const groupMap = {};
  stations.forEach(s=>{ const k = nameKey(s); if(!k) return; (groupMap[k] ||= []).push(String(s.code||'')); });
  const isTransferStation = (code)=>{
    const s = stations.find(x=>x.code===code);
    const k = nameKey(s);
    const arr = groupMap[k] || [];
    return arr.length > 1;
  };
  for(const line of lines){
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.classList.add('line-svg');
    svg.setAttribute('viewBox','0 0 1000 90');

    const y = 45;
    // 基线
    const base = document.createElementNS('http://www.w3.org/2000/svg','line');
    base.setAttribute('x1','20');base.setAttribute('y1',y);
    base.setAttribute('x2','980');base.setAttribute('y2',y);
    base.setAttribute('stroke', line.color || 'orange');
    base.setAttribute('stroke-width','4');
    svg.appendChild(base);

    const nodes = line.stations || [];
    const step = nodes.length > 1 ? (960/(nodes.length-1)) : 960;
    const positions = [];
    for(let i=0;i<nodes.length;i++){
      const x = 20 + i*step; positions.push(x);
      // Station dot
      const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y);
      c.setAttribute('r','8'); c.setAttribute('fill', line.color || 'orange');
      // Clicking dot: remove this station from the line
      c.addEventListener('click', async (ev)=>{
        ev.stopPropagation();
        const code = nodes[i];
        if(!confirm(`确认将站点 ${code} 移出线路 ${line.id}？`)) return;
        const updatedLine = { ...line, stations: (line.stations||[]).filter(s=>s!==code) };
        await api.updateLine(line.id, updatedLine).catch(()=>{});
        const [stations2, lines2, fares2] = await Promise.all([
          api.listStations(), api.listLines(), api.listFares()
        ]).catch(()=>[stations, lines, fares]);
        stationCountEl.textContent = stations2.length;
        lineCountEl.textContent = lines2.length;
        renderLinesEditor(lines2, stations2, fares2);
        showToast('已从该线路移除站点');
      });
      svg.appendChild(c);
      // If this station is a same-name transfer, mark a transfer symbol at top-right of the dot
      if(isTransferStation(nodes[i])){
        const mark = document.createElementNS('http://www.w3.org/2000/svg','text');
        mark.textContent = '↔';
        mark.setAttribute('x', x + 10); mark.setAttribute('y', y - 10);
        mark.setAttribute('fill', '#fff');
        mark.setAttribute('font-size','12');
        mark.setAttribute('font-weight','bold');
        svg.appendChild(mark);
        // Draw color bars for other transferable lines next to the transfer station (excluding current line)
        const st2 = stations.find(s=>s.code===nodes[i]);
        const k2 = nameKey(st2);
        const group2 = groupMap[k2] || [];
        const transferLines = (lines||[]).filter(li=> li.id !== line.id && (li.stations||[]).some(code=> group2.includes(code)));
        const colors = Array.from(new Set(transferLines.map(li=> li.color || '#999')));
        const barH = 4, barW = 12, gap = 2;
        colors.forEach((col, idx)=>{
          const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
          rect.setAttribute('x', x + 12 + idx*(barW+gap));
          rect.setAttribute('y', y - 18);
          rect.setAttribute('width', barW);
          rect.setAttribute('height', barH);
          rect.setAttribute('fill', col);
          rect.setAttribute('rx', '1');
          svg.appendChild(rect);
        });
      }
      // Labels: show name and code in two lines
      const st = stations.find(s=>s.code===nodes[i]);
      const nameText = document.createElementNS('http://www.w3.org/2000/svg','text');
      nameText.textContent = st?.name || nodes[i];
      nameText.setAttribute('x', x-18); nameText.setAttribute('y', y+28);
      nameText.setAttribute('class','station-label');
      svg.appendChild(nameText);
      if(st && st.en_name){
        const enText = document.createElementNS('http://www.w3.org/2000/svg','text');
        enText.textContent = st.en_name;
        enText.setAttribute('x', x-18); enText.setAttribute('y', y+14);
        enText.setAttribute('class','station-label');
        svg.appendChild(enText);
      }
      const codeText = document.createElementNS('http://www.w3.org/2000/svg','text');
      codeText.textContent = nodes[i];
      codeText.setAttribute('x', x-18); codeText.setAttribute('y', y+42);
      codeText.setAttribute('class','station-label');
      svg.appendChild(codeText);
    }
    // Segment click layer and fare labels
    for(let i=0;i<nodes.length-1;i++){
      const rx = positions[i];
      const rw = positions[i+1]-positions[i];
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', rx); rect.setAttribute('y', y-12);
      rect.setAttribute('width', rw); rect.setAttribute('height', 24);
      rect.setAttribute('fill', 'transparent'); rect.setAttribute('class','segment-hit');
      rect.addEventListener('click', async (ev)=>{
        const from = nodes[i], to = nodes[i+1];
        // Shift+click: insert a new station into this segment (instead of appending to end)
        if(ev && ev.shiftKey){
          const prefix = String(from||'01-01').split('-')[0];
          const exist = stations.filter(s=>String(s.code||'').startsWith(prefix+'-'));
          const nextNum = Math.max(0,...exist.map(s=>Number(String(s.code||'').split('-')[1])||0)) + 1;
          const suggested = `${prefix}-${String(nextNum).padStart(2,'0')}`;
          const code = await promptModal({title:`在区间插入新站 (${from} → ${to})`, label:'车站编号（如 01-02）', type:'text', initial:suggested});
          if(code===null || !code.trim()) return;
          const name = await promptModal({title:'新车站', label:'车站中文名', type:'text', initial:`站点${nextNum}`});
          if(name===null) return;
          const enName = await promptModal({title:'新车站', label:'Station English Name', type:'text', initial:`Station${nextNum}`});
          if(enName===null) return;
          const trimmed = code.trim();
          // If the current line already contains the code, prevent duplicate insertions
          if((line.stations||[]).includes(trimmed)) { showToast('该线路已包含此站点'); return; }
          // If the station code exists globally, do not create; just add it to the current line
          const existsGlobally = stations.some(s=>s.code===trimmed);
          if(!existsGlobally){ await api.addStation({code:trimmed,name:name.trim(),en_name:enName.trim()}).catch(()=>{}); }
          const updatedStations = await api.listStations().catch(()=>stations);
          const idxFrom = (line.stations||[]).indexOf(from);
          const insertPos = idxFrom>=0 ? (idxFrom+1) : (line.stations||[]).length;
          const before = (line.stations||[]).slice(0, insertPos);
          const after = (line.stations||[]).slice(insertPos);
          const updatedLine = { ...line, stations: [...before, trimmed, ...after] };
          await api.updateLine(line.id, updatedLine).catch(()=>{});
          const updatedLines = await api.listLines().catch(()=>lines);
          renderLinesEditor(updatedLines, updatedStations, fares);
          renderFareCharts(updatedStations, fares, updatedLines);
          stationCountEl.textContent = updatedStations.length;
          lineCountEl.textContent = updatedLines.length;
          showToast('已在该区间插入新站点');
          return;
        }
        if(bulkMode){
          const idx = selectedSegments.findIndex(s=>s.from===from && s.to===to);
          if(idx>=0){ selectedSegments.splice(idx,1); rect.classList.remove('segment-selected'); }
          else { selectedSegments.push({from,to}); rect.classList.add('segment-selected'); }
          return;
        }
        const f0 = fares.find(f=>f.from===from && f.to===to) || {};
        const curR = (f0.cost_regular ?? f0.cost ?? '');
        const curE = (f0.cost_express ?? f0.cost ?? '');
        const valR = await promptModal({title:`设置普通票价 (${from} → ${to})`, label:'普通票价', type:'number', initial:curR});
        if(valR===null) return;
        const valE = await promptModal({title:`设置特急票价 (${from} → ${to})`, label:'特急票价', type:'number', initial:curE});
        if(valE===null) return;
        await api.addFare({from,to,cost_regular:Number(valR||0),cost_express:Number(valE||0)}).catch(()=>{});
        const fresh = await api.listFares().catch(()=>[]);
        renderLinesEditor(lines, stations, fresh);
        renderFareCharts(stations, fresh, lines);
        showToast('票价已更新');
      });
      svg.appendChild(rect);
      // 票价标签
      const f0 = fares.find(f=>f.from===nodes[i] && f.to===nodes[i+1]) || {};
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      const valR = f0.cost_regular ?? f0.cost;
      const valE = f0.cost_express ?? f0.cost;
      txt.textContent = (valR!==undefined && valE!==undefined) ? `R:${valR} E:${valE}` : (valR!==undefined ? `${valR}` : '');
      txt.setAttribute('x', rx + rw/2 - 22);
      txt.setAttribute('y', y-18);
      txt.setAttribute('class','fare-label');
      svg.appendChild(txt);
    }
    // 在线路上左键创建新站（追加到末尾）
    svg.addEventListener('click', async (ev)=>{
      if(ev.target.classList.contains('segment-hit')) return; // 已处理区间点击
      const prefix = (line.stations?.[0]||'01-01').split('-')[0];
      const exist = stations.filter(s=>s.code.startsWith(prefix+'-'));
      const nextNum = Math.max(0,...exist.map(s=>Number(s.code.split('-')[1])||0)) + 1;
      const suggested = `${prefix}-${String(nextNum).padStart(2,'0')}`;
      const code = await promptModal({title:'新车站', label:'车站编号（如 01-02）', type:'text', initial:suggested});
      if(code===null || !code.trim()) return;
      const name = await promptModal({title:'新车站', label:'车站中文名', type:'text', initial:`站点${nextNum}`});
      if(name===null) return;
      const enName = await promptModal({title:'新车站', label:'Station English Name', type:'text', initial:`Station${nextNum}`});
      if(enName===null) return;
      const trimmed = code.trim();
      // 若当前线路已包含该编号，则阻止重复加入到同一线路
      if((line.stations||[]).includes(trimmed)) { showToast('该线路已包含此站点'); return; }
      // 若系统中已存在该编号，则不再创建，只把它加入当前线路
      const existsGlobally = stations.some(s=>s.code===trimmed);
      if(!existsGlobally){ await api.addStation({code:trimmed,name:name.trim(),en_name:enName.trim()}).catch(()=>{}); }
      const updatedStations = await api.listStations().catch(()=>stations);
      const updatedLine = { ...line, stations: [...(line.stations||[]), trimmed] };
      await api.updateLine(line.id, updatedLine).catch(()=>{});
      const updatedLines = await api.listLines().catch(()=>lines);
      renderLinesEditor(updatedLines, updatedStations, fares);
      renderFareCharts(updatedStations, fares, updatedLines);
      stationCountEl.textContent = updatedStations.length;
      lineCountEl.textContent = updatedLines.length;
    });

    const title = document.createElement('div');
    title.textContent = `${line.en_name||line.id}`;
    title.style.color = line.color || 'orange';
    title.style.fontWeight = '800';
    // 操作区域：删除线路、彻底删除站点
    const actions = document.createElement('div');
    actions.className = 'line-actions';
    actions.style.margin = '6px 0 12px 0';
    const delLineBtn = document.createElement('button');
    delLineBtn.textContent = '删除线路';
    delLineBtn.className = 'btn danger';
    delLineBtn.style.marginRight = '8px';
    delLineBtn.addEventListener('click', async ()=>{
      if(!confirm(`确认删除线路 ${line.id}？`)) return;
      await api.delLine(line.id).catch(()=>{});
      const [stations2, lines2, fares2] = await Promise.all([
        api.listStations(), api.listLines(), api.listFares()
      ]).catch(()=>[[],[],[]]);
      stationCountEl.textContent = stations2.length;
      lineCountEl.textContent = lines2.length;
      renderLinesEditor(lines2, stations2, fares2);
      renderFareCharts(stations2, fares2, lines2);
      showToast('线路已删除');
    });
    const delStationBtn = document.createElement('button');
    delStationBtn.textContent = '彻底删除站点…';
    delStationBtn.className = 'btn warning';
    delStationBtn.addEventListener('click', async ()=>{
      const code = await promptModal({title:'删除站点', label:'输入站点代码（如 01-02）', type:'text', initial:''});
      if(!code) return;
      if(!confirm(`确认从系统删除站点 ${code} 并从所有线路移除？`)) return;
      await api.delStation(code).catch(()=>{});
      // 从所有线路移除此站点
      const allLines = await api.listLines().catch(()=>[]);
      for(const li of allLines){
        if((li.stations||[]).includes(code)){
          li.stations = (li.stations||[]).filter(s=>s!==code);
          await api.updateLine(li.id, li).catch(()=>{});
        }
      }
      const [stations2, lines2, fares2] = await Promise.all([
        api.listStations(), api.listLines(), api.listFares()
      ]).catch(()=>[[],[],[]]);
      stationCountEl.textContent = stations2.length;
      lineCountEl.textContent = lines2.length;
      renderLinesEditor(lines2, stations2, fares2);
      renderFareCharts(stations2, fares2, lines2);
      showToast('站点已彻底删除');
    });
    actions.appendChild(delLineBtn);
    actions.appendChild(delStationBtn);
    // 编辑站点（修改名称/英文名）
    const editStationBtn = document.createElement('button');
    editStationBtn.textContent = '编辑站点…';
    editStationBtn.className = 'btn';
    editStationBtn.style.marginLeft = '8px';
    editStationBtn.addEventListener('click', async ()=>{
      const code = await promptModal({title:'编辑站点', label:'输入要编辑的站点编号', type:'text', initial:''});
      if(!code) return;
      const curStation = (stations||[]).find(s=>s.code===code);
      if(!curStation){ showToast('未找到该站点'); return; }
      const newName = await promptModal({title:`编辑 ${code}`, label:'车站中文名', type:'text', initial:String(curStation.name||'')});
      if(newName===null) return;
      const newEn = await promptModal({title:`编辑 ${code}`, label:'Station English Name', type:'text', initial:String(curStation.en_name||'')});
      if(newEn===null) return;
      await api.updateStation(code, { name: String(newName||'').trim(), en_name: String(newEn||'').trim() }).catch(()=>{});
      const [stations2, lines2, fares2] = await Promise.all([
        api.listStations(), api.listLines(), api.listFares()
      ]).catch(()=>[stations, lines, fares]);
      stationCountEl.textContent = stations2.length;
      lineCountEl.textContent = lines2.length;
      renderLinesEditor(lines2, stations2, fares2);
      renderFareCharts(stations2, fares2, lines2);
      showToast('站点已更新');
    });
    actions.appendChild(editStationBtn);
    const removeOneBtn = document.createElement('button');
    removeOneBtn.textContent = '移除此线路的站点…';
    removeOneBtn.className = 'btn';
    removeOneBtn.addEventListener('click', async ()=>{
      const code = await promptModal({title:'移除站点', label:'输入要从此线路移除的站点编号', type:'text', initial:''});
      if(!code) return;
      if(!(line.stations||[]).includes(code)) { showToast('该线路中不存在此站点'); return; }
      const updatedLine = { ...line, stations: (line.stations||[]).filter(s=>s!==code) };
      await api.updateLine(line.id, updatedLine).catch(()=>{});
      const [stations2, lines2, fares2] = await Promise.all([
        api.listStations(), api.listLines(), api.listFares()
      ]).catch(()=>[[],[],[]]);
      stationCountEl.textContent = stations2.length;
      lineCountEl.textContent = lines2.length;
      renderLinesEditor(lines2, stations2, fares2);
      renderFareCharts(stations2, fares2, lines2);
      showToast('已从该线路移除此站点');
    });
    actions.appendChild(removeOneBtn);
    linesEditorEl.appendChild(title);
    linesEditorEl.appendChild(actions);
    linesEditorEl.appendChild(svg);
  }
}

// 票价图渲染（矩阵：R/E 两套票价；简约配色按价额深浅）
function renderFareChart(stations, fares){
  const wrap = document.getElementById('fare-chart');
  if(!wrap) return;
  wrap.innerHTML = '';
  const grid = document.createElement('table'); grid.className = 'fare-grid';
  const thead = document.createElement('thead'); const trh = document.createElement('tr');
  trh.appendChild(document.createElement('th'));
  const sorted = [...stations].sort((a,b)=> (a.code||'').localeCompare(b.code||''));
  for(const s of sorted){ const th = document.createElement('th'); th.textContent = s.code; trh.appendChild(th); }
  thead.appendChild(trh); grid.appendChild(thead);
  const tbody = document.createElement('tbody');
  const maxFare = Math.max(1, ...fares.map(f=>Math.max(f.cost_regular??0, f.cost_express??0, f.cost??0)));
  for(const r of sorted){
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.textContent = r.code; tr.appendChild(th);
    for(const c of sorted){
      const td = document.createElement('td');
      if(r.code === c.code){ td.textContent = '-'; td.style.color = '#666'; tr.appendChild(td); continue; }
      const f = fares.find(x=>x.from===r.code && x.to===c.code) || fares.find(x=>x.from===c.code && x.to===r.code) || {};
      const vr = f.cost_regular ?? f.cost; const ve = f.cost_express ?? f.cost;
      const best = Math.max(Number(vr||0), Number(ve||0));
      const alpha = 0.15 + 0.45 * (best / maxFare);
      td.style.background = `rgba(59,130,246,${alpha.toFixed(2)})`;
      td.innerHTML = `<div class="fare-cell">R:${vr??''} <span class="muted">|</span> E:${ve??''}</div>`;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  grid.appendChild(tbody);
  const legend = document.createElement('div'); legend.className='fare-legend';
  legend.innerHTML = `<span class="badge">浅蓝=低价</span><span class="badge">深蓝=高价</span><span class="badge">R=普通</span><span class="badge">E=特急</span>`;
  wrap.appendChild(legend);
  wrap.appendChild(grid);
}

// 创建线路
document.getElementById('line-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const l = {
    id: document.getElementById('lineId').value.trim(),
    en_name: document.getElementById('lineEn').value.trim(),
    cn_name: document.getElementById('lineCn').value.trim(),
    color: document.getElementById('lineColor').value,
    stations: []
  };
  await api.addLine(l).catch(()=>{});
  const [stations, lines, fares] = await Promise.all([
    api.listStations(), api.listLines(), api.listFares()
  ]);
  stationCountEl.textContent = stations.length;
  lineCountEl.textContent = lines.length;
  renderLinesEditor(lines, stations, fares);
  e.target.reset();
});

// 批量票价工具栏
document.getElementById('bulkMode').addEventListener('click', ()=>{
  setBulkMode(!bulkMode);
  showToast(bulkMode ? '批量选择已开启：点击区间加入/取消' : '批量选择已关闭');
});
document.getElementById('applyBulk').addEventListener('click', applyBulk);

// 系统设置
document.getElementById('saveApiBase').addEventListener('click', async ()=>{
  const base = document.getElementById('apiBase').value.trim();
  await api.setApiBase(base).catch(()=>{});
  logEvent('config_api_base', { api_base: base });
  showToast('API地址已保存');
});

// 保存优惠设置（活动 + 折扣）
document.getElementById('savePromotion')?.addEventListener('click', async ()=>{
  const name = document.getElementById('promoName')?.value?.trim() || '';
  const dRaw = document.getElementById('promoDiscount')?.value || '1';
  let discount = Number(dRaw);
  if(!isFinite(discount) || discount < 0) discount = 1;
  try{
    await api.setPromotion({ name, discount });
    // 写入操作日志（后端无该端点时忽略错误）
    try{ fetch('/api/log', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:'promotion', name, discount }) }).catch(()=>{}); }catch(_){ }
    const cfg = await api.getConfig().catch(()=>({}));
    localStorage.setItem('tm_cfg_cache', JSON.stringify(cfg||{}));
    showToast('优惠已保存');
  }catch(err){ showToast('保存失败：'+(err.message||err)); }
});

// 已移除“保存等价站映射”逻辑：自动识别同名站，无需手动保存

document.getElementById('exportData').addEventListener('click', async ()=>{
  const [cfg, stations, lines, fares] = await Promise.all([
    api.getConfig(), api.listStations(), api.listLines(), api.listFares()
  ]);
  const blob = new Blob([JSON.stringify({cfg,stations,lines,fares},null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ftc-ticket-admin-backup.json';
  a.click();
  logEvent('export_data');
});

document.getElementById('importData').addEventListener('change', async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if(Array.isArray(data.stations)){
      for(const s of data.stations){ await api.addStation(s).catch(()=>{}); }
    }
    if(Array.isArray(data.lines)){
      for(const l of data.lines){
        await api.updateLine(l.id,l).catch(async()=>{ await api.addLine(l).catch(()=>{}); });
      }
    }
    if(Array.isArray(data.fares)){
      for(const f of data.fares){ await api.addFare(f).catch(()=>{}); }
    }
    showToast('导入完成');
    logEvent('import_data');
    loadAll();
  } catch(err){
    showToast('导入失败：'+err.message);
  }
});

// 查看操作日志
document.getElementById('refreshLogs')?.addEventListener('click', async ()=>{
  const box = document.getElementById('logsBox'); if(!box) return;
  try{
    const out = await fetchJSON('/api/logs');
    const logs = out.logs || out;
    // 按IP分组显示，组头显示计数
    const groups = {};
    logs.forEach(l=>{ const ip=(l.ip||'unknown'); (groups[ip] ||= []).push(l); });
    const parts = Object.entries(groups).sort((a,b)=> a[0].localeCompare(b[0])).map(([ip, arr])=>{
      const head = `【${ip}】 共 ${arr.length} 条`;
      const body = arr.map(l=>{
        const ts = l.ts || ''; const type = l.type || ''; const detail = l.detail ? JSON.stringify(l.detail) : '';
        return `  - ${ts} ${type} ${detail}`;
      }).join('\n');
      return head + '\n' + body;
    });
    box.textContent = parts.join('\n\n');
  }catch(err){ showToast('读取日志失败：'+(err.message||err)); }
});

// 票价图渲染：分普通/特急两张表；中文主标签，下方英文与编号小字
function renderFareCharts(stations, fares, lines){
  const wrapR = document.getElementById('fare-chart-regular');
  const wrapE = document.getElementById('fare-chart-express');
  if(!wrapR || !wrapE) return;
  wrapR.innerHTML = ''; wrapE.innerHTML = '';
  const sorted = [...stations].sort((a,b)=> (a.code||'').localeCompare(b.code||''));
  // Merge by Chinese+English name into one display station
  const groupMap = {};
  for(const s of sorted){
    const k = nameKey(s);
    if(!k) continue;
    if(!groupMap[k]) groupMap[k] = { name: s.name||'', en_name: s.en_name||'', codes: [] };
    groupMap[k].codes.push(s.code);
  }
  const displayGroups = Object.values(groupMap).sort((a,b)=> (a.codes[0]||'').localeCompare(b.codes[0]||''));
  // 辅助：解析站编码、获取区间票价、计算同线两站之间的累计票价
  const parseCode = (code)=>{ const [p,n] = String(code||'').split('-'); return { prefix:p, num: Number(n)||0 }; };
  const segFare = (from, to, isRegular)=>{
    const f = fares.find(x=>x.from===from && x.to===to) || fares.find(x=>x.from===to && x.to===from) || {};
    return Number(isRegular ? (f.cost_regular ?? f.cost) : (f.cost_express ?? f.cost)) || 0;
  };
  const sumLineFare = (a, b, isRegular)=>{
    const pa = parseCode(a), pb = parseCode(b);
    if(!pa.prefix || !pb.prefix || pa.prefix !== pb.prefix) return null; // 不同线不累计
    const lo = Math.min(pa.num, pb.num), hi = Math.max(pa.num, pb.num);
    let total = 0;
    for(let i=lo; i<hi; i++){
      const from = `${pa.prefix}-${String(i).padStart(2,'0')}`;
      const to   = `${pa.prefix}-${String(i+1).padStart(2,'0')}`;
      total += segFare(from, to, isRegular);
    }
    return total;
  };
  // Auto-detect equivalent stations: same (Chinese or English) name treated as one physical station, create zero-cost transfers
  // Note: nameKey is declared earlier, avoid redeclaration causing TDZ errors
  const groupsMap = {};
  stations.forEach(s=>{
    const k = nameKey(s);
    if(!k) return;
    if(!groupsMap[k]) groupsMap[k] = [];
    groupsMap[k].push(String(s.code||''));
  });
  const groups = Object.values(groupsMap).filter(arr=>arr.length>1);
  const sumWithTransfer = (from, to, isRegular)=>{
    const direct = sumLineFare(from, to, isRegular);
    if(direct !== null) return direct;
    let best = null;
    for(const g of groups){
      for(let i=0;i<g.length;i++){
        const vi = sumLineFare(from, g[i], isRegular);
        if(vi===null) continue;
        for(let j=0;j<g.length;j++){
          const vj = sumLineFare(g[j], to, isRegular);
          if(vj===null) continue;
          const cand = vi + vj; // 站间换乘视为0成本
          if(best===null || cand < best) best = cand;
        }
      }
    }
    return best;
  };
  // Max color depth calculated by cumulative fare (per grouped stations)
  const bestFareBetweenCodes = (a,b,isRegular)=>{
    const vLine = sumLineFare(a, b, isRegular);
    const vTrans = sumWithTransfer(a, b, isRegular);
    const f = fares.find(x=> (x.from===a && x.to===b) || (x.from===b && x.to===a)) || {};
    const vSeg = Number(isRegular ? (f.cost_regular ?? f.cost) : (f.cost_express ?? f.cost)) || 0;
    const vPref = (vTrans!=null && vTrans>0) ? vTrans : vLine;
    return (vPref!=null && vPref>0) ? vPref : (vSeg>0 ? vSeg : null);
  };
  const computeMax = (isRegular)=>{
    let maxV = 1;
    for(const ga of displayGroups){
      for(const gb of displayGroups){
        if(ga===gb) continue;
        let best = null;
        for(const a of ga.codes){ for(const b of gb.codes){
          const v = bestFareBetweenCodes(a,b,isRegular);
          if(v!=null) best = (best==null? v : Math.max(best, v));
        }}
        if(best!=null) maxV = Math.max(maxV, best);
      }
    }
    return maxV;
  };
  const maxR = computeMax(true);
  const maxE = computeMax(false);

  // 预构建：每个站在哪些线路上，以及按线路颜色生成条纹背景
  const linesForStation = {};
  (lines||[]).forEach(li=>{
    (li.stations||[]).forEach(code=>{
      (linesForStation[code] ||= []).push(li);
    });
  });
  const stripeBG = (colors)=>{
    if(!colors || colors.length===0) return '';
    const n = colors.length; const parts = [];
    for(let i=0;i<n;i++){
      const s = (i*100/n).toFixed(2);
      const e = ((i+1)*100/n).toFixed(2);
      const col = colors[i];
      parts.push(`${col} ${s}%`, `${col} ${e}%`);
    }
    return `linear-gradient(90deg, ${parts.join(', ')})`;
  };
  // Reuse nameKey from above
  const groupsMapForColors = {};
  stations.forEach(s=>{ const k = nameKey(s); if(!k) return; (groupsMapForColors[k] ||= []).push(String(s.code||'')); });
  const groupsForColors = Object.values(groupsMapForColors).filter(arr=>arr.length>1);
  const colorsForRoute = (a, b)=>{
    const la = linesForStation[a] || [];
    const lb = linesForStation[b] || [];
    // Same line: take the first color from the intersection of lines
    const same = la.find(x=> lb.some(y=> y.id === x.id));
    if(same) return [same.color || '#93a2b7'];
    // Single transfer: find start/end lines that include same-name equivalent stations
    for(const g of groupsForColors){
      const startLine = la.find(li => (li.stations||[]).some(code => g.includes(code)));
      const endLine   = lb.find(li => (li.stations||[]).some(code => g.includes(code)));
      if(startLine && endLine){
        const c1 = startLine.color || '#93a2b7';
        const c2 = endLine.color   || '#93a2b7';
        // Avoid duplicate colors
        return (startLine.id === endLine.id) ? [c1] : [c1, c2];
      }
    }
    return [];
  };
  // 分组合并后的线路颜色集合（去重，最多3个）
  const colorsForGroups = (ga, gb)=>{
    const set = new Set();
    for(const a of ga.codes){ for(const b of gb.codes){
      for(const c of colorsForRoute(a,b)) set.add(c);
    }}
    return Array.from(set).slice(0,3);
  };

  // 根据背景颜色自动选择文字颜色，提高数字可读性
  const hexToRgb = (hex)=>{
    if(!hex) return null;
    const h = hex.replace('#','');
    const b = h.length===3 ? h.split('').map(x=>x+x).join('') : h;
    const n = parseInt(b,16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  };
  const luminance = ({r,g,b})=>{
    const srgb = [r,g,b].map(v=>{
      v/=255;
      return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
  };
  const pickTextColor = (colors)=>{
    if(!colors || colors.length===0) return getComputedStyle(document.body).getPropertyValue('--text')||'#1f2937';
    // 多色条纹时取平均亮度
    let sum = 0, cnt = 0;
    for(const c of colors){ const rgb = hexToRgb(c); if(rgb){ sum += luminance(rgb); cnt++; } }
    const avg = cnt ? (sum/cnt) : 0.5;
    return avg < 0.55 ? '#ffffff' : '#0b2545';
  };

  function buildGrid(type){
    const isRegular = type==='regular';
    const grid = document.createElement('table'); grid.className = 'fare-grid';
    const thead = document.createElement('thead'); const trh = document.createElement('tr');
    trh.appendChild(document.createElement('th'));
    for(const g of displayGroups){
      const th = document.createElement('th');
      th.innerHTML = `<div class="label-cn">${g.name||g.codes[0]}</div><div class="label-en">${g.en_name||''}</div><div class="label-code">${(g.codes||[]).join(' | ')}</div>`;
      trh.appendChild(th);
    }
    thead.appendChild(trh); grid.appendChild(thead);
    const tbody = document.createElement('tbody');
    for(const ga of displayGroups){
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.innerHTML = `<div class="label-cn">${ga.name||ga.codes[0]}</div><div class="label-en">${ga.en_name||''}</div><div class="label-code">${(ga.codes||[]).join(' | ')}</div>`;
      tr.appendChild(th);
      for(const gb of displayGroups){
        const td = document.createElement('td');
        if(ga === gb){ td.textContent = '-'; td.style.color = '#666'; tr.appendChild(td); continue; }
        // 分组后：取两组内任意站对的最优票价作为值，并汇总线路颜色
        let best = null;
        for(const a of ga.codes){ for(const b of gb.codes){
          const v = bestFareBetweenCodes(a,b,isRegular);
          if(v!=null) best = (best==null ? v : Math.min(best, v));
        }}
        const v = best;
        const cols = colorsForGroups(ga, gb);
        // 改为彩色小点指示线路，去除背景条纹
        td.style.backgroundImage = 'none'; td.style.backgroundColor = 'var(--card)';
        const cell = document.createElement('div');
        cell.className = 'fare-cell';
        cell.textContent = (v!=null ? v : '');
        cell.style.fontSize = '12px';
        td.appendChild(cell);
        if(cols && cols.length){
          const dots = document.createElement('div'); dots.className = 'line-dots';
          cols.forEach(col=>{ const d=document.createElement('span'); d.className='dot'; d.style.backgroundColor=col; dots.appendChild(d); });
          td.appendChild(dots);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    grid.appendChild(tbody);
    const legend = document.createElement('div'); legend.className='fare-legend';
    legend.innerHTML = `<span class="badge">左上角彩色点表示线路</span><span class="badge">多线显示多个点</span>`;
    return { grid, legend };
  }

  const r = buildGrid('regular'); wrapR.appendChild(r.legend); wrapR.appendChild(r.grid);
  const e = buildGrid('express'); wrapE.appendChild(e.legend); wrapE.appendChild(e.grid);
}

// 切换显示普通/特急票价图
function showChart(type){
  const regWrap = document.getElementById('chart-regular-wrap');
  const expWrap = document.getElementById('chart-express-wrap');
  const btnReg = document.getElementById('showRegular');
  const btnExp = document.getElementById('showExpress');
  const showReg = type === 'regular';
  regWrap.style.display = showReg ? 'block' : 'none';
  expWrap.style.display = showReg ? 'none' : 'block';
  if(btnReg && btnExp){
    btnReg.classList.toggle('primary', showReg);
    btnExp.classList.toggle('primary', !showReg);
  }
}

document.getElementById('showRegular')?.addEventListener('click', ()=> showChart('regular'));
document.getElementById('showExpress')?.addEventListener('click', ()=> showChart('express'));

// 导出当前显示的票价图为PNG
document.getElementById('exportPng')?.addEventListener('click', async ()=>{
  try{
    const isReg = document.getElementById('chart-regular-wrap').style.display !== 'none';
    const el = isReg ? document.getElementById('chart-regular-wrap') : document.getElementById('chart-express-wrap');
    if(!el){ showToast('未找到图表'); return; }
    let canvas;
    if(typeof html2canvas === 'function'){
      const bg = getComputedStyle(document.body).getPropertyValue('--bg')||'#000';
      // 选择内层表格元素（避免外层 overflow 导致截断）
      const target = el.querySelector('table.fare-grid') || el;
      const fullW = Math.max(target.scrollWidth, target.offsetWidth, el.scrollWidth, el.offsetWidth);
      const fullH = Math.max(target.scrollHeight, target.offsetHeight, el.scrollHeight, el.offsetHeight);
      canvas = await html2canvas(target, {
        backgroundColor: bg,
        useCORS: true,
        allowTaint: true,
        scale: 2,
        width: fullW,
        height: fullH,
        windowWidth: fullW,
        windowHeight: fullH,
        scrollX: 0,
        scrollY: 0,
        onclone: (doc) => {
          // 解除克隆节点的滚动限制，确保完整渲染
          const wrap = doc.getElementById(el.id);
          if(wrap){
            wrap.style.overflow = 'visible';
            wrap.style.maxHeight = 'none';
            wrap.style.maxWidth = 'none';
          }
          const tbl = doc.querySelector('table.fare-grid');
          if(tbl){
            tbl.style.overflow = 'visible';
            tbl.style.maxHeight = 'none';
            tbl.style.maxWidth = 'none';
          }
        }
      });
    } else {
      // 本地回退：用 Canvas 绘制当前表格
      const table = el.querySelector('table.fare-grid');
      if(!table){ showToast('未找到表格'); return; }
      const rows = Array.from(table.querySelectorAll('tr'));
      const cols = Array.from(rows[0].children);
      const cw = cols.map(c=> (c.scrollWidth || c.offsetWidth || 80));
      const ch = rows.map(r=> (r.scrollHeight || r.offsetHeight || 28));
      const pad = 12, bw = 1;
      const W = cw.reduce((a,b)=>a+b, 0) + pad*2;
      const H = ch.reduce((a,b)=>a+b, 0) + pad*2;
      canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const bg = getComputedStyle(document.body).getPropertyValue('--bg')||'#000';
      ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
      ctx.font = '12px Segoe UI'; ctx.textBaseline = 'middle';
      let y = pad;
      rows.forEach((r, ri)=>{
        let x = pad;
        const cells = Array.from(r.children);
        cells.forEach((cell, ci)=>{
          const w = cw[ci] || 80; const h = ch[ri] || 28;
          const bg = window.getComputedStyle(cell).backgroundColor;
          ctx.fillStyle = (bg && bg !== 'rgba(0, 0, 0, 0)') ? bg : (ri===0 || cell.tagName==='TH' ? '#0b0b0b' : '#111');
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = bw; ctx.strokeRect(x, y, w, h);
          ctx.fillStyle = '#e5e5e5';
          const txt = (cell.innerText||'').trim();
          ctx.save();
          ctx.beginPath(); ctx.rect(x+4, y+2, w-8, h-4); ctx.clip();
          ctx.fillText(txt, x+6, y + h/2);
          // 画彩色小点（若存在）
          const dots = cell.querySelectorAll('.line-dots .dot');
          if(dots && dots.length){
            let dx = x + 8; const dy = y + 8;
            dots.forEach(d=>{ ctx.beginPath(); ctx.fillStyle = getComputedStyle(d).backgroundColor; ctx.arc(dx, dy, 3, 0, Math.PI*2); ctx.fill(); dx += 10; });
          }
          ctx.restore();
          x += w;
        });
        y += ch[ri] || 28;
      });
    }
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = `fare-chart-${isReg?'regular':'express'}.png`; a.click();
  }catch(err){ showToast('导出PNG失败：'+(err.message||err)); }
});

// 导出当前显示的票价图为Excel（xlsx）；若库缺失则回退为CSV
document.getElementById('exportExcel')?.addEventListener('click', ()=>{
  const isReg = document.getElementById('chart-regular-wrap').style.display !== 'none';
  const wrap = isReg ? document.getElementById('chart-regular-wrap') : document.getElementById('chart-express-wrap');
  const table = wrap?.querySelector('table.fare-grid');
  if(!table){ showToast('未找到表格'); return; }
  const name = `fare-chart-${isReg?'regular':'express'}`;
  try{
    if(typeof XLSX !== 'undefined' && XLSX && XLSX.utils && XLSX.writeFile){
      const wb = XLSX.utils.table_to_book(table, {sheet: isReg?'Regular':'Express'});
      XLSX.writeFile(wb, name+'.xlsx');
    } else {
      // Fallback: CSV
      const rows = [];
      table.querySelectorAll('tr').forEach(tr=>{
        const cells = Array.from(tr.querySelectorAll('th,td')).map(td=> JSON.stringify(td.innerText.replace(/\s+/g,' ').trim()) );
        rows.push(cells.join(','));
      });
      const blob = new Blob([rows.join('\n')],{type:'text/csv'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name+'.csv'; a.click();
    }
  }catch(err){ showToast('导出失败：'+(err.message||err)); }
});

async function ensureLogin(){
  if(localStorage.getItem('tm_session')==='ok') return;
  // 未登录则跳转至独立登录页
  window.location.href = 'login.html';
}

loadAll();