/**
 * FTC Ticketing System – Web Console UI Script
 * Purpose: Bind UI events, render lists, wire to app.js helpers
 */
(function(){
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  // API base 可从本地设置覆盖
  let API_BASE = localStorage.getItem('ftc_api_base') || '/api';
  const apiUrl = (p) => `${API_BASE}${p}`;
  const api = {
    async getConfig(){ return fetch(apiUrl('/config')).then(r=>r.json()); },
    async listStations(){ return fetch(apiUrl('/stations')).then(r=>r.json()); },
    async addStation(s){ return fetch(apiUrl('/stations'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}).then(r=>r.json()); },
    async delStation(code){ return fetch(apiUrl('/stations/'+encodeURIComponent(code)),{method:'DELETE'}).then(r=>r.json()); },
    async listLines(){ return fetch(apiUrl('/lines')).then(r=>r.json()); },
    async addLine(l){ return fetch(apiUrl('/lines'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(l)}).then(r=>r.json()); },
    async updateLine(id,l){ return fetch(apiUrl('/lines/'+encodeURIComponent(id)),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(l)}).then(r=>r.json()); },
    async listFares(){ return fetch(apiUrl('/fares')).then(r=>r.json()); },
    async addFare(f){ return fetch(apiUrl('/fares'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)}).then(r=>r.json()); },
    async delFare(f){ return fetch(apiUrl('/fares'),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)}).then(r=>r.json()); },
    async export(){
      // 优先使用后端导出端点，若不存在则拼装
      try{ return await fetch(apiUrl('/export')).then(r=>r.json()); }
      catch(e){
        const [config, stations, lines, fares] = await Promise.all([
          api.getConfig().catch(()=>({})),
          api.listStations().catch(()=>[]),
          api.listLines().catch(()=>[]),
          api.listFares().catch(()=>[]),
        ]);
        return {config, stations, lines, fares};
      }
    },
    async import(payload){
      try{ return await fetch(apiUrl('/import'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json()); }
      catch(e){
        // 无导入端点时，逐项写入
        if(payload.stations){ for(const s of payload.stations){ await api.addStation(s).catch(()=>{}); } }
        if(payload.lines){ for(const l of payload.lines){ await api.addLine(l).catch(()=>{}); } }
        if(payload.fares){ for(const f of payload.fares){ await api.addFare(f).catch(()=>{}); } }
        return { ok:true };
      }
    },
    async reset(){
      try{ return await fetch(apiUrl('/reset'),{method:'POST'}).then(r=>r.json()); }
      catch(e){
        const stations = await api.listStations().catch(()=>[]);
        for(const s of stations){ await api.delStation(s.code).catch(()=>{}); }
        const lines = await api.listLines().catch(()=>[]);
        for(const l of lines){ await fetch(apiUrl('/lines/'+encodeURIComponent(l.id)),{method:'DELETE'}).catch(()=>{}); }
        const fares = await api.listFares().catch(()=>[]);
        for(const f of fares){ await api.delFare({from:f.from,to:f.to}).catch(()=>{}); }
        return { ok:true };
      }
    }
  };

  // Toast（操作结果提示）
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  document.body.appendChild(toastEl);
  function showToast(msg, ms=1800){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(()=>toastEl.classList.remove('show'), ms);
  }

  // 标签切换
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      $$('.view').forEach(v=>v.classList.remove('active'));
      $('#view-'+target).classList.add('active');
    });
  });

  // 仪表盘
  async function renderDashboard(){
    try{
      const [stations, lines] = await Promise.all([
        api.listStations(), api.listLines()
      ]);
      $('#stationCount').textContent = stations.length;
      $('#lineCount').textContent = lines.length;
    }catch(e){
      // 离线回退
      $('#stationCount').textContent = '0';
      $('#lineCount').textContent = '0';
    }
  }

  // 线路编辑器
  function drawLineRow(container, line, fares, stationsList){
    const row = document.createElement('div');
    row.className = 'line-row';
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.classList.add('line-svg');
    row.appendChild(svg);
    const label = document.createElement('div');
    label.className = 'line-label';
    label.textContent = `${line.en_name||line.id}`;
    row.appendChild(label);
    container.appendChild(row);

    const W = svg.clientWidth || 800;
    const H = svg.clientHeight || 80;
    const padding = 30;
    const color = line.color || 'orange';
    const stations = (line.stations||[]).slice();

    // 绘制主线
    const y = H/2;
    const main = document.createElementNS('http://www.w3.org/2000/svg','line');
    main.setAttribute('x1', String(padding));
    main.setAttribute('x2', String(W-padding));
    main.setAttribute('y1', String(y));
    main.setAttribute('y2', String(y));
    main.setAttribute('stroke', color);
    main.setAttribute('stroke-width', '4');
    svg.appendChild(main);

    const count = Math.max(stations.length, 5);
    const xs = [];
    for(let i=0;i<stations.length;i++){
      xs.push(padding + ((W-2*padding) * (i/(stations.length-1||1))));
    }
    // 站点渲染
    stations.forEach((code, i)=>{
      const cx = xs[i];
      const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.classList.add('station');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(y));
      c.setAttribute('r', '6');
      c.setAttribute('fill', color);
      svg.appendChild(c);
      const stObj = Array.isArray(stationsList) ? stationsList.find(ss=>ss.code===code) : null;
      const enText = document.createElementNS('http://www.w3.org/2000/svg','text');
      enText.classList.add('label');
      enText.setAttribute('x', String(cx-16));
      enText.setAttribute('y', String(y-28));
      if(stObj?.en_name){ enText.textContent = stObj.en_name; svg.appendChild(enText); }
      const nameText = document.createElementNS('http://www.w3.org/2000/svg','text');
      nameText.classList.add('label');
      nameText.setAttribute('x', String(cx-16));
      nameText.setAttribute('y', String(y-14));
      nameText.textContent = stObj?.name || code;
      svg.appendChild(nameText);
      const codeText = document.createElementNS('http://www.w3.org/2000/svg','text');
      codeText.classList.add('label');
      codeText.setAttribute('x', String(cx-16));
      codeText.setAttribute('y', String(y));
      codeText.textContent = code;
      svg.appendChild(codeText);
    });

    // 区间票价标签显示（取双向任一已设票价）
    for(let i=0;i<stations.length-1;i++){
      const x1 = xs[i], x2 = xs[i+1];
      const mid = (x1 + x2) / 2;
      const fwd = Array.isArray(fares) ? fares.find(f=>f.from===stations[i] && f.to===stations[i+1]) : null;
      const rev = Array.isArray(fares) ? fares.find(f=>f.from===stations[i+1] && f.to===stations[i]) : null;
      const fare = fwd || rev;
      if(fare && fare.cost != null){
        const t = document.createElementNS('http://www.w3.org/2000/svg','text');
        t.classList.add('fare-label');
        t.setAttribute('x', String(mid - 12));
        t.setAttribute('y', String(y - 18));
        t.textContent = `¤${fare.cost}`;
        svg.appendChild(t);
      }
    }

    // 区间点击设置票价（并刷新显示）
    for(let i=0;i<stations.length-1;i++){
      const x1 = xs[i], x2 = xs[i+1];
      const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
      r.classList.add('segment');
      r.setAttribute('x', String(Math.min(x1,x2)));
      r.setAttribute('y', String(y-10));
      r.setAttribute('width', String(Math.abs(x2-x1)));
      r.setAttribute('height', '20');
      r.setAttribute('fill', 'transparent');
      r.addEventListener('click', async ()=>{
        const current = Array.isArray(fares) ? (fares.find(f=>f.from===stations[i] && f.to===stations[i+1])?.cost || '') : '';
        const cost = Number(prompt(`设置区间票价 (${stations[i]} → ${stations[i+1]})`, String(current))) || 0;
        if(cost>=0){
          await api.addFare({from:stations[i], to:stations[i+1], cost}).catch(()=>{});
          // 刷新票价并重绘当前行
          const freshFares = await api.listFares().catch(()=>fares);
          container.innerHTML = '';
          drawLineRow(container, line, freshFares, stationsList);
          showToast('票价已更新');
        }
      });
      svg.appendChild(r);
    }

    // 在主线上点击新增站（输入编号与名称）
    svg.addEventListener('click', async (ev)=>{
      // 若点击的是区间命中层，则不触发新增站逻辑
      if(ev.target && ev.target.classList && ev.target.classList.contains('segment')) return;
      const idx = stations.length>0 ? stations.length : 0;
      const prefix = (stations[0]||'01-01').split('-')[0] || '01';
      const suggested = `${prefix}-${String(idx+1).padStart(2,'0')}`;
      const code = prompt('新站编号（如 01-02）', suggested);
      if(!code) return;
      const name = prompt('新站中文名', `站点${idx+1}`);
      if(!name) return;
      const enName = prompt('Station English Name', `Station${idx+1}`);
      if(!enName) return;
      stations.push(code.trim());
      // 持久化：新增站、更新线路
      await api.addStation({code: code.trim(), name: name.trim(), en_name: enName.trim()}).catch(()=>{});
      await api.updateLine(line.id, {...line, stations}).catch(()=>{});
      // 重新渲染
      container.innerHTML = '';
      drawLineRow(container, {...line, stations}, fares, stationsList);
    });

    // 为该线路添加按编号移除站点的按钮
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '移除此线路的站点…';
    removeBtn.className = 'danger';
    removeBtn.addEventListener('click', async ()=>{
      const code = prompt('输入要移除的站点编号');
      if(!code) return;
      const stations2 = (line.stations||[]).filter(s=>s!==code.trim());
      await api.updateLine(line.id, {...line, stations: stations2}).catch(()=>{});
      container.innerHTML = '';
      drawLineRow(container, {...line, stations: stations2}, fares, stationsList);
      showToast('已从该线路移除此站点');
    });
    row.appendChild(removeBtn);
  }

  async function renderLineEditor(){
    const container = $('#lineEditor');
    container.innerHTML = '';
    try{
      const [lines, stations, fares] = await Promise.all([api.listLines(), api.listStations(), api.listFares()]);
      for(const line of lines){ drawLineRow(container, line, fares, stations); }
    }catch(e){
      container.textContent = '无法加载线路数据（API不可用）';
    }
  }

  // 新建线路
  $('#createLineBtn').addEventListener('click', async ()=>{
    const id = ($('#newLineId').value||'').trim();
    const color = $('#newLineColor').value||'orange';
    if(!id) return alert('请输入线路ID');
    const line = { id, en_name: `Line${id}`, cn_name: `线路${id}`, color, stations: [] };
    await api.addLine(line).catch(()=>{});
    $('#newLineId').value = '';
    await renderLineEditor();
  });

  // 系统设置
  $('#saveApiBaseBtn').addEventListener('click', ()=>{
    const v = ($('#apiBaseInput').value||'').trim();
    if(!v) return;
    API_BASE = v.endsWith('/api') ? v : (v+'/api');
    localStorage.setItem('ftc_api_base', API_BASE);
    alert('API地址已保存到浏览器');
  });

  $('#exportBtn').addEventListener('click', async ()=>{
    const data = await api.export().catch(()=>({}));
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ftc_export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#importFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const text = await file.text();
    const json = JSON.parse(text);
    await api.reset().catch(()=>{});
    await api.import(json).catch(()=>{});
    alert('导入完成');
    await renderDashboard();
    await renderLineEditor();
  });

  $('#resetDataBtn').addEventListener('click', async ()=>{
    if(!confirm('确认清空全部数据？')) return;
    await api.reset().catch(()=>{});
    await renderDashboard();
    await renderLineEditor();
  });

  // 初始渲染
  renderDashboard();
  renderLineEditor();
})();