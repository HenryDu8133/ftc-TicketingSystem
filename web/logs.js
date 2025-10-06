// 操作日志独立页渲染（分组/时间线视图、筛选、彩色徽章）
(function(){
  const el = id => document.getElementById(id);
  const summaryEl = el('logsSummary');
  const timelineEl = el('logsTimeline');
  const ipFilterEl = el('ipFilter');
  const typeFilterEl = el('typeFilter');
  const keywordEl = el('logFilter');
  const refreshBtn = el('refreshLogsPage');
  const viewToggle = el('viewToggle');

  const typeBadgeClass = (t)=>({
    login: 'badge badge-login',
    promotion: 'badge badge-promotion',
    export_data: 'badge badge-export',
    test: 'badge badge-test',
  })[t] || 'badge badge-default';

  const typeLabelZh = (t)=>({
    login:'登录',
    promotion:'优惠',
    export_data:'导出',
    test:'测试'
  })[t] || '事件';

  async function fetchJSON(url, opts){
    const r = await fetch(url, opts); return r.json();
  }

  function formatTime(iso){
    try{ return new Date(iso).toLocaleString(); }catch(_){ return String(iso||''); }
  }

  function escapeHTML(s){
    return String(s||'').replace(/[&<>]/g, ch=>({
      '&':'&amp;', '<':'&lt;', '>':'&gt;'
    })[ch]);
  }

  function applyFilters(items){
    const kw = (keywordEl?.value||'').trim().toLowerCase();
    const ip = (ipFilterEl?.value||'').trim();
    const tp = (typeFilterEl?.value||'').trim();
    return (items||[]).filter(l=>{
      if(ip && (l.ip||'') !== ip) return false;
      if(tp && (l.type||'') !== tp) return false;
      if(kw){
        const s = (l.type||'')+' '+JSON.stringify(l.detail||{});
        if(!s.toLowerCase().includes(kw)) return false;
      }
      return true;
    }).sort((a,b)=> String(b.ts||'').localeCompare(String(a.ts||'')));
  }

  function populateIpFilter(items){
    const set = new Set(items.map(i=>i.ip||'unknown'));
    const current = ipFilterEl.value;
    ipFilterEl.innerHTML = '<option value="">全部 IP</option>' + Array.from(set).map(ip=>`<option value="${escapeHTML(ip)}">${escapeHTML(ip)}</option>`).join('');
    if(Array.from(set).includes(current)) ipFilterEl.value = current;
  }

  function renderGrouped(items){
    const groups = new Map();
    for(const it of items){
      const k = it.ip || 'unknown';
      const arr = groups.get(k) || [];
      arr.push(it); groups.set(k, arr);
    }
    const html = Array.from(groups.entries()).map(([ip, arr])=>{
      // 保证组内时间顺序：默认按时间降序展示，同时组头统计首次/最近更准确
      const sorted = arr.slice().sort((a,b)=> String(b.ts||'').localeCompare(String(a.ts||'')));
      const first = sorted[sorted.length-1]?.ts || '';
      const last = sorted[0]?.ts || '';
      const head = `<div class="group-head"><strong>${escapeHTML(ip)}</strong><span class="muted">共 ${arr.length} 条 · 首次 ${escapeHTML(formatTime(first))} · 最近 ${escapeHTML(formatTime(last))}</span></div>`;
      const body = sorted.map(l=>{
        const t = formatTime(l.ts);
        const badge = `<span class="${typeBadgeClass(l.type)}">${escapeHTML(typeLabelZh(l.type)||'事件')}</span>`;
        const d = escapeHTML(JSON.stringify(l.detail||{}, null, 2));
        return `<div class="log-item"><span class="log-time">${escapeHTML(t)}</span>${badge}<pre class="log-detail">${d}</pre></div>`;
      }).join('');
      return `<div class="group-card">${head}${body}</div>`;
    }).join('') || '<div class="muted">暂无日志</div>';
    summaryEl.innerHTML = html;
  }

  function renderTimeline(items){
    const html = items.map(l=>{
      const t = formatTime(l.ts);
      const badge = `<span class="${typeBadgeClass(l.type)}">${escapeHTML(typeLabelZh(l.type)||'事件')}</span>`;
      const ip = `<span class="log-ip">${escapeHTML(l.ip||'unknown')}</span>`;
      const d = escapeHTML(JSON.stringify(l.detail||{}, null, 2));
      return `<div class="log-item"><span class="log-time">${escapeHTML(t)}</span>${ip}${badge}<pre class="log-detail">${d}</pre></div>`;
    }).join('') || '<div class="muted">暂无日志</div>';
    timelineEl.innerHTML = html;
  }

  async function load(){
    const out = await fetchJSON('/api/logs?max=1000').catch(()=>({logs:[]}));
    const items = out.logs||[];
    populateIpFilter(items);
    const filtered = applyFilters(items);
    const currentView = viewToggle?.querySelector('.btn.active')?.dataset.view || 'group';
    if(currentView==='group'){
      summaryEl.style.display='block';
      timelineEl.style.display='none';
      renderGrouped(filtered);
    }else{
      summaryEl.style.display='none';
      timelineEl.style.display='block';
      renderTimeline(filtered);
    }
  }

  keywordEl?.addEventListener('input', ()=>{ load().catch(()=>{}); });
  ipFilterEl?.addEventListener('change', ()=>{ load().catch(()=>{}); });
  typeFilterEl?.addEventListener('change', ()=>{ load().catch(()=>{}); });
  refreshBtn?.addEventListener('click', ()=>{ load().catch(()=>{}); });
  viewToggle?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-view]');
    if(!btn) return;
    for(const b of viewToggle.querySelectorAll('button')) b.classList.remove('active');
    btn.classList.add('active');
    load().catch(()=>{});
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>{ load().catch(()=>{}); });
  else load().catch(()=>{});
})();