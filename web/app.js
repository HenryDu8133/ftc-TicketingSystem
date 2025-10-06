/**
 * FTC Ticketing System – Web Console API Helpers
 * Purpose: Thin fetch wrappers around /api endpoints
 * Notes: Prefer concise comments; avoid duplicating server-side docs.
 */
const api = {
  async getConfig(){ return fetch('/api/config').then(r=>r.json()); },
  async setCurrentStation(body){ return fetch('/api/config/current_station',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()); },
  async listStations(){ return fetch('/api/stations').then(r=>r.json()); },
  async addStation(s){ return fetch('/api/stations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}).then(r=>r.json()); },
  async delStation(code){ return fetch('/api/stations/'+encodeURIComponent(code),{method:'DELETE'}).then(r=>r.json()); },
  async listLines(){ return fetch('/api/lines').then(r=>r.json()); },
  async addLine(l){ return fetch('/api/lines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(l)}).then(r=>r.json()); },
  async updateLine(id,l){ return fetch('/api/lines/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(l)}).then(r=>r.json()); },
  async listFares(){ return fetch('/api/fares').then(r=>r.json()); },
  async addFare(f){ return fetch('/api/fares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)}).then(r=>r.json()); },
  async delFare(f){ return fetch('/api/fares',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)}).then(r=>r.json()); },
};

const el = id => document.getElementById(id);
const stationListEl = el('station-list');
const lineListEl = el('line-list');
const fareListEl = el('fare-list');

async function loadAll(){
  try {
    const cfg = await api.getConfig();
    el('curName').value = cfg.current_station?.name || '';
    el('curCode').value = cfg.current_station?.code || '';
    renderStations(await api.listStations());
    renderLines(await api.listLines());
    renderFares(await api.listFares());
  } catch (e) {
    // Offline preview fallback
    el('curMsg').textContent = 'API unavailable. You can still view UI.';
  }
}

function renderStations(list){
  stationListEl.innerHTML = '';
  for(const s of list){
    const li = document.createElement('li');
    li.innerHTML = `<div class="row"><div><strong>${s.name}</strong> <span class="pill">${s.code}</span></div><div><button class="danger" data-code="${s.code}">Delete</button></div></div>`;
    stationListEl.appendChild(li);
  }
}

function renderLines(list){
  lineListEl.innerHTML = '';
  for(const l of list){
    const li = document.createElement('li');
    li.innerHTML = `<div class="row"><div><strong>${l.en_name}</strong> <span class="pill">${l.id}</span> <span class="pill" style="border-color:${l.color};color:${l.color}">${l.color}</span><div class="pill">${(l.stations||[]).join(', ')}</div></div><div><button class="danger" data-id="${l.id}">Delete</button></div></div>`;
    lineListEl.appendChild(li);
  }
}

function renderFares(list){
  fareListEl.innerHTML = '';
  for(const f of list){
    const li = document.createElement('li');
    li.innerHTML = `<div class="row"><div><strong>${f.from}</strong> → <strong>${f.to}</strong> <span class="pill">¤${f.cost}</span></div><div><button class="danger" data-from="${f.from}" data-to="${f.to}">Delete</button></div></div>`;
    fareListEl.appendChild(li);
  }
}

// Form handlers
el('current-station-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = { name: el('curName').value.trim(), code: el('curCode').value.trim() };
  await api.setCurrentStation(body).catch(()=>{});
  el('curMsg').textContent = 'Saved';
});

el('station-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const s = { code: el('stCode').value.trim(), name: el('stName').value.trim() };
  await api.addStation(s).catch(()=>{});
  const list = await api.listStations().catch(()=>[]);
  renderStations(list);
  e.target.reset();
});

stationListEl.addEventListener('click', async (e)=>{
  const code = e.target.getAttribute('data-code');
  if(!code) return;
  await api.delStation(code).catch(()=>{});
  const list = await api.listStations().catch(()=>[]);
  renderStations(list);
});

el('line-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const l = {
    id: el('lineId').value.trim(),
    en_name: el('lineEn').value.trim(),
    cn_name: el('lineCn').value.trim(),
    color: el('lineColor').value,
    stations: el('lineStations').value.split(',').map(s=>s.trim()).filter(Boolean)
  };
  await api.addLine(l).catch(()=>{});
  const list = await api.listLines().catch(()=>[]);
  renderLines(list);
  e.target.reset();
});

lineListEl.addEventListener('click', async (e)=>{
  const id = e.target.getAttribute('data-id');
  if(!id) return;
  await fetch('/api/lines/'+encodeURIComponent(id),{method:'DELETE'}).catch(()=>{});
  const list = await api.listLines().catch(()=>[]);
  renderLines(list);
});

el('fare-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const f = { from: el('fareFrom').value.trim(), to: el('fareTo').value.trim(), cost: Number(el('fareCost').value) };
  await api.addFare(f).catch(()=>{});
  const list = await api.listFares().catch(()=>[]);
  renderFares(list);
  e.target.reset();
});

fareListEl.addEventListener('click', async (e)=>{
  const from = e.target.getAttribute('data-from');
  const to = e.target.getAttribute('data-to');
  if(!from || !to) return;
  await api.delFare({from,to}).catch(()=>{});
  const list = await api.listFares().catch(()=>[]);
  renderFares(list);
});

loadAll();