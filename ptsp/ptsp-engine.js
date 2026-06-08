/* ptsp-engine.js — Shared Form Engine PTSP KUA Pilangkenceng */
const API_URL = (typeof KUA_CONFIG !== 'undefined' && KUA_CONFIG.API_URL)
  ? KUA_CONFIG.API_URL
  : 'https://script.google.com/macros/s/AKfycbwi1lkhvBIsB8zNo4A7OexF9ujN4K5BK_cIhEUcKhIyDiIV-lSYrmGJE7V09s0I9qwr/exec';

let CONFIG = null;
let currentKat = window.PTSP_KATEGORI_ID || null;
let currentKatLabel = window.PTSP_KATEGORI_LABEL || null;
let currentJenis = null;
let session = null;
let photoFiles = [];
let autocompleteTimers = {};

async function engineInit() {
  try { const s = sessionStorage.getItem('ptsp_session'); if (s) { session = JSON.parse(s); applySessionUI(); } } catch(e) {}
  await loadConfig();
  const params = new URLSearchParams(window.location.search);
  const jenis = params.get('jenis');
  if (jenis && CONFIG.forms && CONFIG.forms[jenis]) { showForm(jenis); } else { renderLayananList(); }
}

async function loadConfig() {
  try {
    const res = await fetch(API_URL + '?action=getConfig&_=' + Date.now());
    CONFIG = await res.json();
  } catch(e) {
    CONFIG = window.FALLBACK_CONFIG || { forms:{}, kategori:{}, universal:[], consentField:null, publishMode:{} };
    showToast('Gagal memuat config. Mode offline.', true);
  }
}

function applySessionUI() {
  if (!session) return;
  const btn = document.getElementById('btn-login-header');
  if (btn) { btn.textContent = '\u2705 ' + session.nama; btn.classList.add('active'); }
  const bar = document.getElementById('session-bar');
  if (bar) { bar.classList.add('show'); const si = document.getElementById('session-info'); if (si) si.textContent = 'Petugas: ' + session.nama + ' (' + session.role + ')'; }
}

function toggleLoginPanel() {
  const box = document.getElementById('login-box'); if (!box) return;
  const open = box.style.display === 'block';
  box.style.display = open ? 'none' : 'block';
  document.getElementById('btn-login-header').classList.toggle('active', !open);
  if (!open) document.getElementById('inp-username').focus();
}

async function doLogin() {
  const u = document.getElementById('inp-username').value.trim();
  const p = document.getElementById('inp-password').value;
  const err = document.getElementById('login-error');
  const btn = document.getElementById('btn-do-login');
  if (!u || !p) { err.style.display='block'; err.textContent='Isi username dan password.'; return; }
  btn.disabled = true; btn.textContent = 'Memverifikasi...';
  try {
    const res = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({action:'login',username:u,password:p}) });
    const d = await res.json();
    if (d.ok) {
      session = d.user; sessionStorage.setItem('ptsp_session', JSON.stringify(session));
      err.style.display = 'none'; document.getElementById('login-box').style.display = 'none';
      applySessionUI(); showToast('Login berhasil. Selamat datang, ' + session.nama + '!');
      if (document.getElementById('page-layanan') && document.getElementById('page-layanan').classList.contains('active')) renderLayananList();
    } else { err.style.display='block'; err.textContent = d.error || 'Login gagal.'; }
  } catch(e) {
    if (u==='demo' && p==='demo123') {
      session = {username:'demo',nama:'Petugas Demo',role:'petugas'};
      sessionStorage.setItem('ptsp_session', JSON.stringify(session));
      err.style.display='none'; document.getElementById('login-box').style.display='none';
      applySessionUI(); showToast('Login demo berhasil!');
      if (document.getElementById('page-layanan') && document.getElementById('page-layanan').classList.contains('active')) renderLayananList();
    } else { err.style.display='block'; err.textContent='Tidak dapat terhubung ke server.'; }
  }
  btn.disabled = false; btn.textContent = 'Masuk';
}

function logout() {
  session = null; sessionStorage.removeItem('ptsp_session');
  const btn = document.getElementById('btn-login-header');
  if (btn) { btn.textContent = '\uD83D\uDD10 Petugas'; btn.classList.remove('active'); }
  const bar = document.getElementById('session-bar'); if (bar) bar.classList.remove('show');
  showToast('Anda telah keluar.');
}

function goPage(id) {
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  const el = document.getElementById(id); if (!el) return;
  el.classList.add('active'); el.classList.remove('fade-in'); void el.offsetWidth; el.classList.add('fade-in');
  window.scrollTo(0,0);
}

function renderLayananList() {
  if (!CONFIG || !currentKatLabel) return;
  const list = document.getElementById('layanan-list'); if (!list) return;
  list.innerHTML = '';
  const items = Object.entries(CONFIG.forms || {})
    .filter(function(e){ return e[1].kategori === currentKatLabel; })
    .filter(function(e){
      const f = e[1];
      if (f.role && Array.isArray(f.role) && !f.role.includes('tamu') && !session) return false;
      const ov = f.universalOverrides || {};
      return !(['nama_pemohon','kontak'].every(function(k){ return ov[k] && ov[k].hidden; }));
    });
  items.forEach(function(entry, i){
    const key = entry[0]; const f = entry[1];
    const item = document.createElement('div'); item.className = 'layanan-item';
    item.innerHTML = '<div class="layanan-num">'+(i+1)+'</div><div class="layanan-info"><div class="layanan-name">'+f.label+'</div><div class="layanan-desc">'+(f.deskripsi||'')+'</div></div><div class="layanan-arrow">\u203A</div>';
    item.onclick = function(){ showForm(key); };
    list.appendChild(item);
  });
  if (currentKatLabel === 'Layanan Nikah') renderBannerEcoteologyLuar(list);
  goPage('page-layanan');
}

function showForm(jenis) {
  currentJenis = jenis; photoFiles = [];
  const f = CONFIG.forms[jenis]; if (!f) return;
  document.getElementById('form-title').textContent = f.label;
  document.getElementById('form-desc').textContent = f.deskripsi || f.kategori;
  document.getElementById('autofill-banner').style.display = 'none';
  document.getElementById('form-breadcrumb').innerHTML = '<span onclick="goPage(\'page-layanan\')">\u2190 '+(currentKatLabel||'Layanan')+'</span><span class="sep">\u203A</span><span class="current">'+f.label+'</span>';
  const body = document.getElementById('form-body'); body.innerHTML = '';
  const ov = f.universalOverrides || {};
  const uFields = (CONFIG.universal || []).filter(function(u){ return !(ov[u.name] && ov[u.name].hidden); });
  if (uFields.length) { addST(body,'Data Umum'); uFields.forEach(function(u){ renderField(body, Object.assign({},u,{required:(ov[u.name]&&ov[u.name].required===false)?false:u.required})); }); }
  if (f.fields && f.fields.length) { addST(body,'Data Layanan'); f.fields.forEach(function(fd){ renderField(body,fd); }); }
  if (f.autofill && session) setupAutofill(f.autofill);
  if (jenis === 'nikah_bimwin' && session) setTimeout(triggerAutofillBimwin, 100);
  if ((CONFIG.publishMode||{})[jenis]==='kegiatan' && session && CONFIG.consentField) {
    addST(body,'Izin Publikasi'); const d=document.createElement('div'); d.className='consent-box'; renderField(d,CONFIG.consentField); body.appendChild(d);
  }
  const sw = document.createElement('div'); sw.style.marginTop='20px';
  sw.innerHTML = '<button class="btn-submit" id="btn-submit" onclick="submitForm()">\uD83D\uDCE4 Kirim Layanan</button>';
  body.appendChild(sw);
  goPage('page-form'); setTimeout(evalAllConditions, 50);
}

function addST(parent, text) { const el=document.createElement('div'); el.className='form-section-title'; el.textContent=text; parent.appendChild(el); }

function renderField(parent, field) {
  const f = field; const fname = f.name || f.id;
  if (!fname || f.type==='section') { if (f.type==='section') addST(parent,f.label); return; }
  const group = document.createElement('div'); group.className='form-group'; group.id='group_'+fname;
  if (f.showIf) group.dataset.showIf = JSON.stringify(f.showIf);
  const lbl = '<label class="form-label" for="field_'+fname+'">'+f.label+(f.required?'<span class="req">*</span>':' <span style="color:#aaa;font-size:11px">(opsional)</span>')+'</label>';
  let inp = '';
  if (['text','tel','email','number','date','time'].includes(f.type)) {
    inp = '<input class="form-control" id="field_'+fname+'" name="'+fname+'" type="'+f.type+'" placeholder="'+(f.placeholder||'')+'" '+(f.required?'required':'')+' oninput="evalAllConditions()"/>';
  } else if (f.type==='textarea') {
    inp = '<textarea class="form-control" id="field_'+fname+'" name="'+fname+'" placeholder="'+(f.placeholder||'')+'" '+(f.required?'required':'')+' oninput="evalAllConditions()"></textarea>';
  } else if (f.type==='select') {
    const opts = (f.options||[]).map(function(o){ return '<option value="'+o+'">'+o+'</option>'; }).join('');
    inp = '<select class="form-control" id="field_'+fname+'" name="'+fname+'" '+(f.required?'required':'')+' onchange="evalAllConditions()"><option value="">\u2014 Pilih \u2014</option>'+opts+'</select>';
  } else if (f.type==='radio') {
    const opts = (f.options||[]).map(function(o){ return '<label class="radio-opt" onclick="selectRadio(\''+fname+'\',\''+o+'\',this)"><input type="radio" name="'+fname+'" value="'+o+'" onchange="evalAllConditions()"/> '+o+'</label>'; }).join('');
    inp = '<div class="radio-group" id="field_'+fname+'">'+opts+'</div>';
  } else if (f.type==='checkbox') {
    const opts = (f.options||[]).map(function(o){ return '<label class="check-opt" onclick="toggleCheck(this)"><input type="checkbox" name="'+fname+'" value="'+o+'"/> '+o+'</label>'; }).join('');
    inp = '<div class="check-group" id="field_'+fname+'">'+opts+'</div>';
  } else if (f.type==='photo') {
    inp = '<div class="photo-upload-area" id="photo_area_'+fname+'" ondragover="event.preventDefault();this.classList.add(\'dragover\')" ondragleave="this.classList.remove(\'dragover\')" ondrop="handleDrop(event,\''+fname+'\')"><input type="file" class="photo-input" id="field_'+fname+'" accept="image/*" '+(f.multiple?'multiple':'')+' onchange="handlePhotoInput(event,\''+fname+'\')"/><span class="photo-upload-icon">\uD83D\uDCF7</span><div class="photo-upload-label">Klik atau seret foto ke sini</div><div class="photo-upload-sub">JPG, PNG \u00B7 Maks 5MB per foto</div></div><div class="photo-previews" id="previews_'+fname+'"></div>';
  } else if (f.type==='surat_kua') {
    const now = new Date();
    const bulan = String(now.getMonth()+1).padStart(2,'0');
    const tahun = now.getFullYear();
    const _kodeSurat = [
      'PW.01 — Perkawinan, Rujuk, Talak & Cerai',
      'PW.02 — Kepenghuluan & Keluarga Sakinah',
      'PW.03 — Pembinaan Syariah',
      'PW.04 — Hisab Rukyat & Bina Syariah',
      'BA — Bimbingan & Penyuluhan Agama',
      'HM — Kehumasan & Keprotokolan',
      'A.01/SK — Surat Keterangan',
      'A.02/U — Undangan',
      'A.03/P — Permohonan / Proposal',
      'A.04/SP — Surat Pengantar',
      'A.05/PL — Pemberitahuan / Laporan',
      'A.06/SR — Surat Rekomendasi',
      'KP.01 — Tata Usaha Kepegawaian',
      'KP.02 — Pendidikan & Latihan',
      'KP.03 — KORPRI / Dharma Wanita',
      'KP.04 — Penilaian & Hukuman',
      'KU — Keuangan',
      'OT — Organisasi & Tata Laksana',
      'RT — Kerumahtanggaan'
    ];
    const _kodeOpts = _kodeSurat.map(function(k){
      const kode = k.split(' — ')[0];
      return '<option value="'+kode+'">'+k+'</option>';
    }).join('');
    inp = '<div style="display:grid;grid-template-columns:60px 1fr auto auto;align-items:center;gap:6px">' +
      '<span style="font-size:14px;color:#4a4a4a;font-weight:700">B-</span>' +
      '<input type="text" id="field_'+fname+'_nomor" class="form-control" placeholder="256" oninput="updateNoSurat(\''+fname+'\',null)" inputmode="numeric" style="min-width:0"/>' +
      '<select id="field_'+fname+'_kode" class="form-control" onchange="updateNoSurat(\''+fname+'\',null)" style="min-width:0">'+_kodeOpts+'</select>' +
      '<span style="font-size:13px;color:#888;white-space:nowrap">/'+bulan+'/'+tahun+'</span>' +
      '</div>' +
      '<input type="hidden" id="field_'+fname+'" name="'+fname+'"/>' +
      '<div style="margin-top:5px;font-size:11.5px;color:#2d8c5e;font-weight:600" id="preview_'+fname+'">Ketik nomor urut dan pilih kode surat</div>';
  } else if (f.type==='autocomplete') {
    inp = '<div class="autocomplete-wrap"><input class="form-control" id="field_'+fname+'" name="'+fname+'" type="text" placeholder="'+(f.placeholder||'Ketik untuk mencari...')+'" '+(f.required?'required':'')+' oninput="handleAutocomplete(event,\''+fname+'\',\''+currentJenis+'\')"/><div class="autocomplete-dropdown" id="ac_'+fname+'"></div></div>';
  }
  const help = f.help ? '<span class="form-help">'+f.help+'</span>' : '';
  const err = '<div class="field-error" id="err_'+fname+'">Field ini wajib diisi.</div>';
  group.innerHTML = lbl+inp+help+err; parent.appendChild(group);
}

function selectRadio(name,value,el) { document.querySelectorAll('[name="'+name+'"]').forEach(function(i){ i.closest('.radio-opt').classList.remove('selected'); }); el.classList.add('selected'); const i=el.querySelector('input'); if(i) i.checked=true; evalAllConditions(); }
function toggleCheck(el) { el.classList.toggle('selected'); }
function handlePhotoInput(e,name) { Array.from(e.target.files).forEach(function(f){ addPhoto(f,name); }); }
function handleDrop(e,name) { e.preventDefault(); document.getElementById('photo_area_'+name).classList.remove('dragover'); Array.from(e.dataTransfer.files).filter(function(f){ return f.type.startsWith('image/'); }).forEach(function(f){ addPhoto(f,name); }); }
function addPhoto(file,name) { if(file.size>5*1024*1024){showToast('File terlalu besar: '+file.name,true);return;} const r=new FileReader(); r.onload=function(ev){ const b64=ev.target.result.split(',')[1]; const obj={file:file,base64:b64,mimeType:file.type,name:name}; photoFiles.push(obj); renderPhotoPreview(obj); }; r.readAsDataURL(file); }
function renderPhotoPreview(obj) { const idx=photoFiles.indexOf(obj); const wrap=document.createElement('div'); wrap.className='photo-thumb-wrap'; wrap.id='pw_'+idx; wrap.innerHTML='<img class="photo-thumb" src="data:'+obj.mimeType+';base64,'+obj.base64+'"/><div class="photo-thumb-del" onclick="removePhoto('+idx+')">\u00D7</div>'; document.getElementById('previews_'+obj.name).appendChild(wrap); }
function removePhoto(idx) { photoFiles.splice(idx,1); const el=document.getElementById('pw_'+idx); if(el) el.remove(); }

function evalAllConditions() {
  document.querySelectorAll('[data-show-if]').forEach(function(group){
    try {
      const cond = JSON.parse(group.dataset.showIf);
      const trigger = document.querySelector('[name="'+cond.field+'"]') || document.getElementById('field_'+cond.field);
      let val = '';
      if (trigger) { if(trigger.type==='radio'){ const c=document.querySelector('[name="'+cond.field+'"]:checked'); val=c?c.value:''; } else val=trigger.value; }
      const tampil = cond.valueIn ? cond.valueIn.includes(val) : (val===cond.value);
      group.style.display = tampil ? '' : 'none';
      if (!tampil) { const inp=group.querySelector('input,select,textarea'); if(inp&&inp.type!=='radio'&&inp.type!=='checkbox') inp.value=''; }
    } catch(e) {}
  });
}

async function handleAutocomplete(e,fieldName,jenis) {
  const q=e.target.value.trim(); const dd=document.getElementById('ac_'+fieldName);
  if(q.length<2){dd.style.display='none';return;}
  clearTimeout(autocompleteTimers[fieldName]);
  autocompleteTimers[fieldName]=setTimeout(async function(){
    const fd=CONFIG.forms[jenis]; if(!fd||!fd.autofill) return;
    try{ const res=await fetch(API_URL+'?action=lookup&jenis='+fd.autofill.sourceJenis+'&field='+fd.autofill.lookupField+'&q='+encodeURIComponent(q)); const d=await res.json(); renderACDropdown(dd,d.results||[],fd.autofill,fieldName); }catch(e){dd.style.display='none';}
  },380);
}
function renderACDropdown(dd,results,autofill,triggerField) { dd.innerHTML=''; if(!results.length){dd.style.display='none';return;} results.forEach(function(r){ const item=document.createElement('div'); item.className='autocomplete-item'; item.textContent=r.label; item.onclick=function(){ applyAutofill(r.data,autofill.map,triggerField); dd.style.display='none'; }; dd.appendChild(item); }); dd.style.display='block'; }
function applyAutofill(srcData,map,triggerField) { let filled=0; Object.entries(map).forEach(function(e){ const el=document.getElementById('field_'+e[1]); if(el&&srcData[e[0]]!==undefined){el.value=srcData[e[0]];filled++;} }); if(filled>0){document.getElementById('autofill-banner').style.display='block';evalAllConditions();} }
function setupAutofill(cfg) { document.addEventListener('click',function(e){ if(!e.target.closest('.autocomplete-wrap')) document.querySelectorAll('.autocomplete-dropdown').forEach(function(d){d.style.display='none';}); }); }

function triggerAutofillBimwin() {
  const namaField=document.getElementById('field_nama_pa'); if(!namaField) return;
  namaField.placeholder='Ketik nama catin pria untuk autofill...';
  namaField.addEventListener('input',function(){
    clearTimeout(this._afTimer); this._afTimer=setTimeout(async function(){
      const q=namaField.value.trim(); if(q.length<3) return;
      try{ const res=await fetch(API_URL+'?action=lookup&jenis=nikah_pendaftaran&field=nama_pa&q='+encodeURIComponent(q)); const json=await res.json(); if(json.results&&json.results.length) showAutofillBimwinDropdown(json.results,namaField); }catch(e){}
    },500);
  });
}
function showAutofillBimwinDropdown(results,anchor) {
  let dd=document.getElementById('bimwin-af-dd');
  if(!dd){ dd=document.createElement('div'); dd.id='bimwin-af-dd'; dd.style.cssText='position:absolute;top:100%;left:0;right:0;background:#fff;border:1.5px solid var(--green);border-top:none;border-radius:0 0 8px 8px;z-index:50;max-height:180px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)'; anchor.parentElement.style.position='relative'; anchor.parentElement.appendChild(dd); }
  dd.innerHTML=''; results.forEach(function(r){ const item=document.createElement('div'); item.style.cssText='padding:10px 14px;font-size:13px;cursor:pointer;border-bottom:1px solid #eee'; item.textContent=r.label; item.onmouseenter=function(){item.style.background='var(--green-light)';}; item.onmouseleave=function(){item.style.background='';}; item.onclick=function(){ applyAutofill(r.data,{nama_pa:'nama_pa',nama_pi:'nama_pi',ttl_pa:'ttl_pa',ttl_pi:'ttl_pi',desa_pa:'desa_pa',desa_pi:'desa_pi',kontak:'kontak',nama_pemohon:'nama_pemohon'},'nama_pa'); dd.remove(); showToast('Data catin terisi otomatis dari pendaftaran'); }; dd.appendChild(item); });
  dd.style.display=results.length?'block':'none';
}

function renderBannerEcoteologyLuar(containerEl) {
  const lama=document.getElementById('banner-eco-luar'); if(lama) lama.remove();
  const banner=document.createElement('div'); banner.id='banner-eco-luar';
  banner.style.cssText='background:linear-gradient(135deg,#1a6b45 0%,#2d8c5e 55%,#c49a28 100%);border-radius:12px;padding:16px 20px;margin-top:12px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:transform .2s,box-shadow .2s;box-shadow:0 4px 18px rgba(26,107,69,.25)';
  banner.onmouseenter=function(){banner.style.transform='translateY(-2px)';banner.style.boxShadow='0 8px 28px rgba(26,107,69,.38)';};
  banner.onmouseleave=function(){banner.style.transform='';banner.style.boxShadow='0 4px 18px rgba(26,107,69,.25)';};
  banner.innerHTML='<div style="font-size:36px;flex-shrink:0">\uD83C\uDF33</div><div style="flex:1"><div style="color:#fff;font-weight:700;font-size:14px;margin-bottom:3px">Ecotheology Nikah \u2014 Di Luar Kantor</div><div style="color:rgba(255,255,255,.82);font-size:12px;line-height:1.5">Khusus calon pengantin yang menikah <strong style="color:#fde68a">di luar KUA</strong>. Isi form penanaman pohon di halaman terpisah.</div></div><div style="color:#fde68a;font-size:22px;flex-shrink:0">\u2192</div>';
  banner.addEventListener('click',function(){window.open('ecoteology.html','_blank');});
  containerEl.appendChild(banner);
}

async function submitForm() {
  const f=CONFIG.forms[currentJenis]; if(!f) return;
  let valid=true; const ov=f.universalOverrides||{};
  const allFields=[].concat(CONFIG.universal||[]).concat(f.fields||[]);
  allFields.forEach(function(field){
    const fname=field.name||field.id; if(!fname||field.type==='section'||( ov[fname]&&ov[fname].hidden)) return;
    const groupEl=document.getElementById('group_'+fname); if(groupEl&&groupEl.style.display==='none') return;
    if(!field.required) return;
    const el=document.getElementById('field_'+fname); const errEl=document.getElementById('err_'+fname); if(!el) return;
    let val='';
    if(field.type==='radio'){const c=document.querySelector('[name="'+fname+'"]:checked');val=c?c.value:'';}
    else if(field.type==='photo'){val=photoFiles.filter(function(p){return p.name===fname;}).length>0?'ok':'';}
    else{val=el.value.trim();}
    if(!val){valid=false;el.classList.add('invalid');if(errEl)errEl.style.display='block';}
    else{el.classList.remove('invalid');if(errEl)errEl.style.display='none';}
  });
  if(!valid){showToast('Lengkapi field yang wajib diisi.',true);return;}
  const data={};
  allFields.forEach(function(field){
    const fname=field.name||field.id; if(!fname||field.type==='section'||(ov[fname]&&ov[fname].hidden)) return;
    const el=document.getElementById('field_'+fname); if(!el) return;
    if(field.type==='radio'){const c=document.querySelector('[name="'+fname+'"]:checked');data[fname]=c?c.value:'';}
    else if(field.type==='checkbox'){data[fname]=Array.from(document.querySelectorAll('[name="'+fname+'"]:checked')).map(function(c){return c.value;});}
    else if(field.type!=='photo'){data[fname]=el.value.trim();}
  });
  const petugas=(document.getElementById('field_petugas_penerima')||document.getElementById('field_petugas_ptsp')||{value:''}).value.trim()||(session?session.nama:'');
  const payload={action:'submit',jenis_layanan:currentJenis,jenis_label:f.label,kategori:f.kategori,nama_pemohon:data.nama_pemohon||data.nama_pa||'',kontak:data.kontak||data.no_hp||'',petugas_ptsp:petugas,data:data,foto:photoFiles.map(function(p){return {mimeType:p.mimeType,base64:p.base64};})};
  const btn=document.getElementById('btn-submit'); btn.disabled=true; btn.classList.add('loading'); btn.textContent='Mengirim...';
  try{
    const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const result=await res.json();
    if(result.ok){document.getElementById('success-id').textContent=result.id;goPage('page-success');}
    else showToast('Gagal: '+(result.error||'Unknown error'),true);
  }catch(e){showToast('Tidak dapat terhubung ke server.',true);}
  btn.disabled=false; btn.classList.remove('loading'); btn.textContent='\uD83D\uDCE4 Kirim Layanan';
}

function resetAll() { currentJenis=null; photoFiles=[]; renderLayananList(); }
var _tt;
function showToast(msg,isError) { isError=isError||false; const t=document.getElementById('toast'); t.textContent=msg; t.className='toast show'+(isError?' error':''); clearTimeout(_tt); _tt=setTimeout(function(){t.classList.remove('show');},3500); }


function updateNoSurat(fname) {
  const now    = new Date();
  const bulan  = String(now.getMonth()+1).padStart(2,'0');
  const tahun  = now.getFullYear();
  const nomor  = (document.getElementById('field_' + fname + '_nomor') || {}).value || '';
  const kodeEl = document.getElementById('field_' + fname + '_kode');
  const kode   = kodeEl ? kodeEl.value : 'PW.01';
  const full   = nomor ? 'B-' + nomor + '/Kua.13.34.06/' + kode + '/' + bulan + '/' + tahun : '';
  const hidden  = document.getElementById('field_' + fname);
  const preview = document.getElementById('preview_' + fname);
  if (hidden)  hidden.value = full;
  if (preview) preview.textContent = full || 'Ketik nomor urut dan pilih kode surat';
}
