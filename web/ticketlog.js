// Ticket Log frontend module
(function(){
  const el = id => document.getElementById(id);
  const ticketSearchEl = el('ticketSearch');
  const ticketListEl = el('ticketList');
  const ticketDetailEl = el('ticketDetail');

  async function fetchJSON(url, opts){
    const r = await fetch(url, opts); return r.json();
  }
  // 读取后端配置中的 API 基地址，默认同源 /api
  let apiBaseCache = '';
  async function getApiBase(){
    if(apiBaseCache) return apiBaseCache;
    try{
      const cfg = await fetchJSON('/api/config').catch(()=>({}));
      const base = String(cfg.api_base||'').trim();
      apiBaseCache = base ? base.replace(/\/+$/,'') : (location.origin.replace(/\/+$/,'')+'/api');
    }catch(_){ apiBaseCache = location.origin.replace(/\/+$/,'')+'/api'; }
    return apiBaseCache;
  }
  function apiUrl(path){ return getApiBase().then(base=> base + path); }
  const api = {
    async listTickets(q){ const qs = q? ('?q='+encodeURIComponent(q)) : ''; const url = await apiUrl('/tickets'+qs); return fetchJSON(url); },
    async getTicket(id){ const url = await apiUrl('/tickets/'+encodeURIComponent(id)); return fetchJSON(url); },
  };

  function renderTicketList(items){
    if(!ticketListEl) return;
    const zhStatus = s=>({ sold:'已卖出', entered:'已入站', exited:'已出站'}[String(s||'').toLowerCase()]||String(s||''));
    const rows = (items||[]).map(t=>{
      const id = t.ticket_id || t.id || '';
      const statusZh = zhStatus(t.status||'');
      const start = t.start || '';
      const terminal = t.terminal || '';
      const trips = t.trips_total!=null ? String(t.trips_total) : (t.trips_remaining!=null ? String(t.trips_remaining) : '');
      const station = t.station_code || '';
      const ts = new Date(Number(t.last_update_ts||0)||Date.now()).toLocaleString();
      return `<div class="list-item" data-id="${id}">${id} [${statusZh}] ${start} → ${terminal} [车程:${trips}] 出票站:${station} ${ts}</div>`;
    }).join('');
    ticketListEl.innerHTML = rows || '<div class="muted">暂无数据</div>';
    ticketListEl.querySelectorAll('.list-item').forEach(node=>{
      node.addEventListener('click', async ()=>{
        const id = node.getAttribute('data-id');
        const out = await api.getTicket(id).catch(()=>({}));
        renderTicketDetail(out);
      });
    });
  }
  function renderTicketDetail(out){
    if(!ticketDetailEl) return;
    const zhStatus = s=>({ sold:'已卖出', entered:'已入站', exited:'已出站'}[String(s||'').toLowerCase()]||String(s||''));
    const idx = out.index || {};
    const events = out.events || [];
    const trips = (idx.trips_total!=null? idx.trips_total : idx.trips_remaining)!=null ? (idx.trips_total??idx.trips_remaining) : '';
    const lastSaleTs = (events.slice().reverse().find(e=>e.type==='sale')?.ts) || idx.last_update_ts || Date.now();
    const tsStr = new Date(Number(lastSaleTs||Date.now())).toLocaleString();
    const rows = [
      `票号: ${out.ticket_id||''}`,
      `状态: ${zhStatus(idx.status||'')}`,
      `售票站: ${idx.station_code||''}`,
      `车程: ${trips!==''?trips:''}`,
      `${idx.start||''} → ${idx.terminal||''}`,
      `Cogs:${idx.cost!=null?idx.cost:''}`,
      `${tsStr}`
    ];
    // 事件时间线：每次入站/出站及剩余次数
    const evLines = events.map(e=>{
      const t = new Date(Number(e.ts||Date.now())).toLocaleString();
      if(e.type === 'sale'){
        const tot = (e.trips_total!=null)?String(e.trips_total):'';
        return `${t} 售票 [车程:${tot}] 出票站:${e.station_code||''}`;
      }
      if(e.type === 'status'){
        const actZh = ({enter:'入站', exit:'出站', update:'更新'}[String(e.action||'').toLowerCase()]) || String(e.action||'');
        const remainStr = (e.trips_remaining!=null)?String(e.trips_remaining):'';
        return `${t} ${actZh} ${e.station_code||''} 剩余:${remainStr}`;
      }
      return `${t} ${e.type||''}`;
    });
    const html = [
      ...rows.map(s=>`<div>${s}</div>`),
      '<hr/>',
      '<div class="muted">事件记录</div>',
      ...(evLines.length? evLines.map(s=>`<div>${s}</div>`) : ['<div class="muted">暂无事件</div>'])
    ].join('');
    ticketDetailEl.innerHTML = html;
  }
  async function loadTicketList(){
    const q = (ticketSearchEl?.value||'').trim();
    const out = await api.listTickets(q).catch(()=>({tickets:[]}));
    renderTicketList(out.tickets||[]);
  }

  function init(){
    if(ticketListEl) loadTicketList().catch(()=>{});
    ticketSearchEl?.addEventListener('input', ()=>{ loadTicketList().catch(()=>{}); });
    document.getElementById('refreshTickets')?.addEventListener('click', ()=>{ loadTicketList().catch(()=>{}); });
    // 当切换到该页签时刷新
    document.querySelectorAll('.tab').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const tab = btn.getAttribute('data-tab');
        if(tab==='ticketlog') loadTicketList().catch(()=>{});
      });
    });
  }

  // 延迟到 DOM 就绪
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();