// Minimal login script with SHA-256 fallback and config-driven hash
(function(){
  const userEl = document.getElementById('loginUser');
  const passEl = document.getElementById('loginPass');
  const btn = document.getElementById('loginBtn');
  const hintEl = document.getElementById('loginHint');

  // Pure JS SHA-256 (UTF-8) implementation (fallback when WebCrypto not available)
  function sha256HexJS(str){
    function utf8ToBytes(s){
      return new TextEncoder().encode(s);
    }
    const K = new Uint32Array([
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ]);
    const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const bytes = utf8ToBytes(str);
    const l = bytes.length;
    const withPad = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    withPad.set(bytes);
    withPad[l] = 0x80;
    const bitLen = l * 8;
    withPad[withPad.length-4] = (bitLen >>> 24) & 0xff;
    withPad[withPad.length-3] = (bitLen >>> 16) & 0xff;
    withPad[withPad.length-2] = (bitLen >>> 8) & 0xff;
    withPad[withPad.length-1] = (bitLen) & 0xff;
    const W = new Uint32Array(64);
    function rotr(x,n){ return (x>>>n) | (x<<(32-n)); }
    for(let i=0;i<withPad.length;i+=64){
      for(let t=0;t<16;t++){
        const j = i + t*4;
        W[t] = (withPad[j]<<24)|(withPad[j+1]<<16)|(withPad[j+2]<<8)|(withPad[j+3]);
      }
      for(let t=16;t<64;t++){
        const s0 = rotr(W[t-15],7) ^ rotr(W[t-15],18) ^ (W[t-15]>>>3);
        const s1 = rotr(W[t-2],17) ^ rotr(W[t-2],19) ^ (W[t-2]>>>10);
        W[t] = (W[t-16] + s0 + W[t-7] + s1) >>> 0;
      }
      let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for(let t=0;t<64;t++){
        const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    const out = new Uint8Array(32);
    for(let i=0;i<8;i++){
      out[i*4] = (H[i]>>>24)&0xff; out[i*4+1]=(H[i]>>>16)&0xff; out[i*4+2]=(H[i]>>>8)&0xff; out[i*4+3]=H[i]&0xff;
    }
    return Array.from(out).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  async function sha256Hex(str){
    try{
      if(window.crypto && window.crypto.subtle){
        const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
      }
    }catch(e){}
    return sha256HexJS(str);
  }

  async function getConfig(){
    try{
      const r = await fetch('/api/config');
      return await r.json();
    }catch(e){ return {}; }
  }

  async function init(){
    if(localStorage.getItem('tm_session')==='ok'){ location.href = 'index.html'; return; }
    const cfg = await getConfig();
    const defaultHash = await sha256Hex('admin:fsefmgftc');
    const allowHash = cfg.admin_hash_sha256 || cfg.admin_hash || defaultHash;
    btn.addEventListener('click', async ()=>{
      const u = (userEl.value||'').trim();
      const p = passEl.value||'';
      const h = await sha256Hex(u+':'+p);
      if(h === allowHash){
        localStorage.setItem('tm_session','ok');
        // 记录登录日志（后端若无该端点则忽略错误）
        try{
          fetch('/api/log', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:'login', user: u }) }).catch(()=>{});
        }catch(_){ }
        location.href = 'index.html';
      } else {
        hintEl.textContent = '账号或密码错误';
      }
    });
  }

  init();
})();