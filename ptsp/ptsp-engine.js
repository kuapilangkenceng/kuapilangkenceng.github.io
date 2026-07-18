/* ptsp-engine.js — Shared Form Engine PTSP KUA Pilangkenceng */
const API_URL = (typeof KUA_CONFIG !== 'undefined' && KUA_CONFIG.API_URL)
  ? KUA_CONFIG.API_URL
  : 'https://script.google.com/macros/s/AKfycbwi1lkhvBIsB8zNo4A7OexF9ujN4K5BK_cIhEUcKhIyDiIV-lSYrmGJE7V09s0I9qwr/exec';

let CONFIG = null;
let currentKat = window.PTSP_KATEGORI_ID || null;
let currentKatLabel = window.PTSP_KATEGORI_LABEL || null;
let currentJenis = null;
let currentTahap2Field = null;
let currentLayananId = null;
let currentRekapInfo = null;
let currentPhotoSteps = [];   // array step foto tambahan (photoSteps dari config)
let currentPhotoStepIdx = 0;  // index step foto yang sedang aktif
let stepPetugasValues = {};   // { [step.id]: namaPetugasTerpilih } — persist selama sesi form, dipulihkan saat back/forward antar step foto
let session = null;
let photoFiles = [];
let galleryPhotos = {}; // { fieldId: srcUrlAtauDataURL } — riwayat foto kumulatif utk galeri verifikasi Mode Petugas
let autocompleteTimers = {};

/* PATCH: retry otomatis untuk kegagalan transient Apps Script (kadang balikin
   halaman HTML "<!DOCTYPE..." alih-alih JSON, terutama request pertama setelah
   idle — terkonfirmasi manual: klik ulang tanpa reload langsung berhasil).
   Aman diulang karena kegagalan jenis ini terjadi SEBELUM backend sempat proses
   request (ditolak di level platform Google, bukan setelah data tersimpan),
   jadi tidak akan menduplikasi data. Dipakai untuk request GET (selalu aman)
   dan POST submit foto (submitPhotoStep/submitComplete). TIDAK dipakai untuk
   aksi yang levih sensitif kalau retry-nya justru berisiko (biarkan manual). */
async function _fetchJsonRetry(url, options, maxRetries) {
  maxRetries = (maxRetries == null) ? 1 : maxRetries;
  var lastErr = null;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        lastErr = new Error('Respons server bukan JSON (percobaan ke-' + (attempt + 1) + '): ' + text.slice(0, 150));
      }
    } catch (netErr) {
      lastErr = netErr;
    }
    if (attempt < maxRetries) { await new Promise(function(r){ setTimeout(r, 900); }); }
  }
  throw lastErr;
}

/* ── AUTO-KAPITAL: semua input teks/textarea otomatis huruf besar ── */
(function() {
  const EXCLUDE_TYPES = ['email', 'date', 'number', 'tel', 'file', 'password', 'hidden', 'checkbox', 'radio'];
  const EXCLUDE_IDS   = ['inp-username', 'inp-password']; // field login — jangan dipaksa uppercase
  const css = 'input.form-control:not([type="email"]):not([type="date"]):not([type="number"]):not([type="tel"]):not([type="file"]):not([type="password"]):not(#inp-username):not(#inp-password),'
    + 'textarea.form-control{text-transform:uppercase}';
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  document.addEventListener('input', function(e) {
    const el = e.target;
    if (!el.classList || !el.classList.contains('form-control')) return;
    if (EXCLUDE_IDS.indexOf(el.id) !== -1) return;
    const tag = el.tagName;
    const type = (el.type || '').toLowerCase();
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && EXCLUDE_TYPES.indexOf(type) === -1)) {
      const start = el.selectionStart, end = el.selectionEnd;
      const upper = el.value.toUpperCase();
      if (upper !== el.value) {
        el.value = upper;
        if (start !== null && typeof el.setSelectionRange === 'function') {
          try { el.setSelectionRange(start, end); } catch (x) {}
        }
      }
    }
  }, true);
})();
/* ── END AUTO-KAPITAL ──────────────────────────────────────────────── */

/* ── PATCH KEAMANAN: auto-sisip token sesi ke semua request API_URL ── */
const _fetchAsliEngine = window.fetch.bind(window);
window.fetch = function(url, opts) {
  const isApiCall = typeof url === 'string' && url.indexOf(API_URL) === 0;
  if (isApiCall && session && session.token) {
    if (opts && opts.method === 'POST' && typeof opts.body === 'string') {
      try {
        const body = JSON.parse(opts.body);
        if (!body.token) {
          body.token = session.token;
          opts = Object.assign({}, opts, { body: JSON.stringify(body) });
        }
      } catch (e) { /* body bukan JSON, biarkan */ }
    } else if (url.indexOf('token=') === -1) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(session.token);
    }
  }
  return _fetchAsliEngine(url, opts);
};

/* ── PATCH ANTI-SPAM: reCAPTCHA v3 (dimuat dinamis, dilewati otomatis kalau SITE KEY belum diisi) ── */
// ⚠️ WAJIB DIISI: ganti dengan Site Key dari https://www.google.com/recaptcha/admin/create (pilih reCAPTCHA v3)
const RECAPTCHA_SITE_KEY = '6LfzESwtAAAAAFrIA4vXokZz15-1CW5_CGIWwr6E';
let _recaptchaReady = false;
(function loadRecaptcha() {
  if (!RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY.indexOf('GANTI_') === 0) return;
  const s = document.createElement('script');
  s.src = 'https://www.google.com/recaptcha/api.js?render=' + RECAPTCHA_SITE_KEY;
  s.onload = function () { _recaptchaReady = true; };
  document.head.appendChild(s);
})();

async function getRecaptchaToken(action) {
  if (!_recaptchaReady || typeof grecaptcha === 'undefined') return '';
  try {
    return await new Promise(function (resolve) {
      grecaptcha.ready(function () {
        grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: action || 'submit' }).then(resolve).catch(function () { resolve(''); });
      });
    });
  } catch (e) { return ''; }
}

async function engineInit() {
  try { const s = sessionStorage.getItem('ptsp_session'); if (s) { session = JSON.parse(s); applySessionUI(); } } catch(e) {}
  await loadConfig();
  const params = new URLSearchParams(window.location.search);
  const jenis = params.get('jenis');
  if (jenis && CONFIG.forms && CONFIG.forms[jenis]) { showForm(jenis); } else { renderLayananList(); }
  // PATCH: auto-popup resume dimatikan sementara — terlalu mudah mengganggu sesi
  // yang sedang aktif (lihat insiden Rekomendasi Nikah). Data tetap tersimpan
  // di localStorage (_savePendingTahap2/_clearPendingTahap2), tinggal disambungkan
  // ke pemicu yang lebih aman (mis. tombol manual) kalau sudah siap.
  // _checkPendingTahap2();
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
  if (bar) {
    bar.classList.add('show');
    const si = document.getElementById('session-info');
    if (si) si.textContent = 'Petugas: ' + session.nama + ' (' + session.role + ')';
    // Tombol statis di HTML (ptsp/index.html)
    var ba = document.getElementById('btn-post-artikel');
    if (ba) ba.style.display = 'inline-flex';
    var bg = document.getElementById('btn-upload-galeri');
    if (bg) bg.style.display = 'inline-flex';
    // Tombol injeksi JS (nikah.html, wakaf.html, dst pakai ptsp-engine)
    if (!document.getElementById('petugas-quick-btns')) {
      const qbtns = document.createElement('div');
      qbtns.id = 'petugas-quick-btns';
      qbtns.style.cssText = 'display:flex;gap:6px;margin-left:auto;flex-wrap:wrap';
      qbtns.innerHTML =
        '<a href="post-artikel.html" style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:var(--green,#2d8c5e);color:#fff;border-radius:8px;font-size:11.5px;font-weight:700;text-decoration:none">\u270f\ufe0f Post Artikel</a>'
        + '<a href="galeri-upload.html" style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:#c9a030;color:#1b5e35;border-radius:8px;font-size:11.5px;font-weight:700;text-decoration:none">\uD83D\uDDBC\uFE0F Upload Galeri</a>';
      bar.appendChild(qbtns);
    }
  }
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
      session = Object.assign({}, d.user, { token: d.token });
      sessionStorage.setItem('ptsp_session', JSON.stringify(session));
      err.style.display = 'none'; document.getElementById('login-box').style.display = 'none';
      applySessionUI(); showToast('Login berhasil. Selamat datang, ' + session.nama + '!');
      if (document.getElementById('page-layanan') && document.getElementById('page-layanan').classList.contains('active')) renderLayananList();
    } else { err.style.display='block'; err.textContent = d.error || 'Login gagal.'; }
  } catch(e) {
    err.style.display='block'; err.textContent='Tidak dapat terhubung ke server. Coba lagi beberapa saat.';
  }
  btn.disabled = false; btn.textContent = 'Masuk';
}

function logout() {
  if (session && session.token) {
    try { fetch(API_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({action:'logout',token:session.token}) }); } catch(e) {}
  }
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
  if (currentKatLabel === 'Layanan Nikah') renderCallbackPanel(list);
  goPage('page-layanan');
}

function showForm(jenis) {
  currentJenis = jenis; photoFiles = []; galleryPhotos = {}; currentTahap2Field = null; currentLayananId = null; currentRekapInfo = null; currentPhotoSteps = []; currentPhotoStepIdx = 0;
  var _pw = document.getElementById('pasfoto-inline-wrap'); if (_pw) _pw.remove();
  const f = CONFIG.forms[jenis]; if (!f) return;
  document.getElementById('form-title').textContent = f.label;
  document.getElementById('form-desc').textContent = f.deskripsi || f.kategori;
  document.getElementById('autofill-banner').style.display = 'none';
  document.getElementById('form-breadcrumb').innerHTML = '<span onclick="goPage(\'page-layanan\')">\u2190 '+(currentKatLabel||'Layanan')+'</span><span class="sep">\u203A</span><span class="current">'+f.label+'</span>';
  const body = document.getElementById('form-body'); body.innerHTML = '';
  const ov = f.universalOverrides || {};
  const uFields = (CONFIG.universal || []).filter(function(u){ return !(ov[u.name] && ov[u.name].hidden); });

  // // Deteksi photoSteps DULU - kalau ada photoSteps, skip deteksi Tahap 2 otomatis
  if (f.photoSteps && f.photoSteps.length > 0) {
    currentPhotoSteps = f.photoSteps;
  }

  // Deteksi pola 2-tahap: SKIP jika form pakai photoSteps.
  let mainFields = (f.fields || []).slice();
  if (!currentPhotoSteps.length && mainFields.length >= 2) {
    const last = mainFields[mainFields.length-1];
    const prev = mainFields[mainFields.length-2];
    if (last.type === 'photo' && prev.type === 'photo') {
      currentTahap2Field = last;
      mainFields = mainFields.slice(0, -1);
    }
  }

  // Mode petugas + nikah_alur_lengkap: skip field tertentu & photoSteps
  if (session && jenis === 'nikah_alur_lengkap') {
    var skipIds = ['petugas_penerima','_sec_surat_keluar','surat_keluar',
                   '_sec_pasfoto','pasfoto_pa','pasfoto_pi','foto_petugas_ptsp'];
    mainFields = mainFields.filter(function(fd){ return skipIds.indexOf(fd.id) === -1; });
    currentPhotoSteps = [];
  }
  if (uFields.length) { addST(body,'Data Umum'); uFields.forEach(function(u){ renderField(body, Object.assign({},u,{required:(ov[u.name]&&ov[u.name].required===false)?false:u.required})); }); }
  if (mainFields.length) { addST(body,'Data Layanan'); mainFields.forEach(function(fd){ renderField(body,fd); }); }
  if (f.autofill && session) setupAutofill(f.autofill);
  if (jenis === 'nikah_bimwin' && session) setTimeout(triggerAutofillBimwin, 100);
  if (jenis === 'nikah_alur_lengkap' && session) setTimeout(triggerRecallCatin, 100);
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
  if (f.showIf)    group.dataset.showIf    = JSON.stringify(f.showIf);
  if (f.showIfNot) group.dataset.showIfNot = JSON.stringify(f.showIfNot);
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
    inp = '<div class="photo-upload-area" id="photo_area_'+fname+'"'      +' ondragover="event.preventDefault();this.classList.add(\'dragover\')"'      +' ondragleave="this.classList.remove(\'dragover\')"'      +' ondrop="handleDrop(event,\''+fname+'\')"><div style="display:flex;gap:10px;justify-content:center;margin-bottom:8px"><label style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--green,#2d8c5e);color:#fff;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">\uD83D\uDDBC\uFE0F Pilih dari Galeri<input type="file" style="display:none" id="field_'+fname+'" accept="image/*" '+(f.multiple?'multiple':'')+' onchange="handlePhotoInput(event,\''+fname+'\')"></label><label style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#f59e0b;color:#fff;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">\uD83D\uDCF7 Foto Langsung<input type="file" style="display:none" accept="image/*" capture="environment" '+(f.multiple?'multiple':'')+' onchange="handlePhotoInput(event,\''+fname+'\')"></label></div><div class="photo-upload-label" style="font-size:11px;color:#888">atau seret foto ke sini</div><div class="photo-upload-sub">JPG, PNG \u00B7 Maks 5MB per foto</div></div><div class="photo-previews" id="previews_'+fname+'"></div>';
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
function addPhoto(file, name) {
  if (file.size > 8 * 1024 * 1024) { showToast('File terlalu besar (maks 8MB): ' + file.name, true); return; }
  const r = new FileReader();
  r.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const MAX_DIM = 1280;
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w >= h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
        else        { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      const b64 = dataUrl.split(',')[1];
      const obj = { file: file, base64: b64, mimeType: 'image/jpeg', name: name };
      photoFiles.push(obj);
      galleryPhotos[name] = dataUrl;
      renderPhotoPreview(obj);
    };
    img.src = ev.target.result;
  };
  r.readAsDataURL(file);
}
function renderPhotoPreview(obj) {
  const idx=photoFiles.indexOf(obj);
  const src='data:'+obj.mimeType+';base64,'+obj.base64;
  const wrap=document.createElement('div'); wrap.className='photo-thumb-wrap'; wrap.id='pw_'+idx;
  wrap.innerHTML='<img class="photo-thumb" src="'+src+'" style="cursor:zoom-in" onclick="openPhotoLightbox(this.src)"/><div class="photo-thumb-del" onclick="event.stopPropagation();removePhoto('+idx+')">\u00D7</div>';
  document.getElementById('previews_'+obj.name).appendChild(wrap);
}
function removePhoto(idx) { const p=photoFiles[idx]; if(p&&galleryPhotos[p.name]) delete galleryPhotos[p.name]; photoFiles.splice(idx,1); const el=document.getElementById('pw_'+idx); if(el) el.remove(); }

/* ── PHOTO LIGHTBOX (klik foto untuk buka ukuran penuh — Mode Petugas) ── */
function openPhotoLightbox(src) {
  let ov = document.getElementById('photo-lightbox-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'photo-lightbox-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;cursor:zoom-out';
    ov.innerHTML = '<img id="photo-lightbox-img" class="photo-lightbox-img" style="max-width:92vw;max-height:92vh;object-fit:contain;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.5)"/>'
      + '<div id="photo-lightbox-close" style="position:absolute;top:16px;right:20px;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.15);color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:600">&times;</div>';
    ov.addEventListener('click', function(e){ if (e.target.id === 'photo-lightbox-overlay' || e.target.id === 'photo-lightbox-close') closePhotoLightbox(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closePhotoLightbox(); });
    document.body.appendChild(ov);
  }
  document.getElementById('photo-lightbox-img').src = src;
  ov.style.display = 'flex';
}
function closePhotoLightbox() {
  const ov = document.getElementById('photo-lightbox-overlay');
  if (ov) ov.style.display = 'none';
}
/* ── END PHOTO LIGHTBOX ─────────────────────────────────────────────── */

function evalAllConditions() {
  document.querySelectorAll('[data-show-if],[data-show-if-not]').forEach(function(group){
    try {
      let tampil = true;
      if (group.dataset.showIf) {
        const cond = JSON.parse(group.dataset.showIf);
        const trigger = document.querySelector('[name="'+cond.field+'"') || document.getElementById('field_'+cond.field);
        let val = ''; if (trigger) { if(trigger.type==='radio'){ const c=document.querySelector('[name="'+cond.field+'"]:checked'); val=c?c.value:''; } else val=trigger.value; }
        tampil = cond.valueIn ? cond.valueIn.includes(val) : (val===cond.value);
      } else if (group.dataset.showIfNot) {
        const condN = JSON.parse(group.dataset.showIfNot);
        const trigN = document.querySelector('[name="'+condN.field+'"') || document.getElementById('field_'+condN.field);
        let valN = ''; if (trigN) { if(trigN.type==='radio'){ const c=document.querySelector('[name="'+condN.field+'"]:checked'); valN=c?c.value:''; } else valN=trigN.value; }
        tampil = condN.valueIn ? !condN.valueIn.includes(valN) : (valN!==condN.value);
      }
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
    try{ const res=await fetch(API_URL+'?action=lookup&jenis='+fd.autofill.sourceJenis+'&field='+fd.autofill.lookupField+'&q='+encodeURIComponent(q)+'&_='+Date.now(), { cache: 'no-store' }); const d=await res.json(); renderACDropdown(dd,d.results||[],fd.autofill,fieldName); }catch(e){dd.style.display='none';}
  },380);
}
function renderACDropdown(dd,results,autofill,triggerField) { dd.innerHTML=''; if(!results.length){dd.style.display='none';return;} results.forEach(function(r){ const item=document.createElement('div'); item.className='autocomplete-item'; item.textContent=r.label; item.onclick=function(){ applyAutofill(r.data,autofill.map,triggerField); dd.style.display='none'; }; dd.appendChild(item); }); dd.style.display='block'; }
function applyAutofill(srcData,map,triggerField) { let filled=0; Object.entries(map).forEach(function(e){ const el=document.getElementById('field_'+e[1]); if(el&&srcData[e[0]]!==undefined){el.value=srcData[e[0]];filled++;} }); if(filled>0){document.getElementById('autofill-banner').style.display='block';evalAllConditions();} }
function setupAutofill(cfg) { document.addEventListener('click',function(e){ if(!e.target.closest('.autocomplete-wrap')) document.querySelectorAll('.autocomplete-dropdown').forEach(function(d){d.style.display='none';}); }); }

// Daftar semua foto dalam satu alur nikah_alur_lengkap (pas foto + 4 photoStep).
// Dipakai BARENG oleh triggerRecallCatin() (panel Petugas Pendaftaran) dan
// triggerAutofillBimwin() (panel Petugas Bimwin) — sengaja 1 sumber supaya
// kalau step foto berubah di config_nikah.js, cukup update di 1 tempat ini.
var NIKAH_ALUR_FOTO_STEPS = [
  { id: 'pasfoto_pa',                label: 'Pas Foto Catin Pria' },
  { id: 'pasfoto_pi',                label: 'Pas Foto Catin Wanita' },
  { id: 'foto_penghulu',             label: 'Rafak (Penghulu)' },
  { id: 'foto_petugas_pendaftaran',  label: 'Petugas Pendaftaran' },
  { id: 'foto_penghulu_penyuluh',    label: 'Bimwin' },
  { id: 'foto_validasi',             label: 'Validasi' }
];

// Render kartu status semua foto (ada / belum) ke dalam containerEl.
// fotoUrlsRaw boleh string JSON atau object — sama seperti field foto_urls di sheet.
function _renderFotoProgressPanel(containerEl, fotoUrlsRaw) {
 try {
  if (!containerEl) return;
  var urls = {};
  try { urls = typeof fotoUrlsRaw === 'string' ? JSON.parse(fotoUrlsRaw || '{}') : (fotoUrlsRaw || {}); } catch(xParse) {}
  containerEl.innerHTML = '';
  NIKAH_ALUR_FOTO_STEPS.forEach(function(fs) {
    var url = urls[fs.id];
    var card = document.createElement('div');
    card.style.cssText = 'text-align:center;font-size:10.5px;color:#555;width:76px';
    if (url) {
      var imgUrl = url;
      var m = url.match(/[?&]id=([^&]+)/); if (!m) m = url.match(/\/d\/([^/?]+)/);
      if (m) imgUrl = 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w200';
      card.innerHTML = '<img src="' + imgUrl + '" style="width:76px;height:76px;object-fit:cover;border-radius:6px;border:1.5px solid var(--green,#2d8c5e);cursor:zoom-in;margin-bottom:3px" onclick="openPhotoLightbox(this.src)" onerror="this.style.display=\'none\'">' + fs.label;
    } else {
      card.innerHTML = '<div style="width:76px;height:76px;border-radius:6px;border:1.5px dashed #d99;background:#fdf2f2;display:flex;align-items:center;justify-content:center;font-size:9px;color:#c0392b;font-weight:600;margin-bottom:3px">Belum upload</div>' + fs.label;
    }
    containerEl.appendChild(card);
  });
 } catch (errFPP) {
  _showDebugError('_renderFotoProgressPanel', errFPP);
 }
}

/* PATCH: jaring pengaman untuk alur foto multi-step (nikah_alur_lengkap dll).
   Beda dari _savePendingTahap2, TIDAK ada popup konfirmasi sama sekali (murni
   diam-diam) — sesuai keputusan sebelumnya untuk tidak mengganggu sesi aktif.
   Fungsinya cuma jaga-jaga: kalau currentLayananId sampai hilang di tengah
   jalan (tab di-reload paksa Android, dsb), submitPhotoStep() bisa pulihkan
   sendiri dari sini tanpa pemohon sadar ada masalah. */
function _savePendingMultiStep() {
  try {
    if (!currentLayananId || !currentPhotoSteps.length) return;
    localStorage.setItem('ptsp_pending_multistep', JSON.stringify({
      jenis: currentJenis, id: currentLayananId, rekapInfo: currentRekapInfo,
      stepIdx: currentPhotoStepIdx, ts: Date.now()
    }));
  } catch (e) {}
}
function _clearPendingMultiStep() {
  try { localStorage.removeItem('ptsp_pending_multistep'); } catch (e) {}
}
// Dipanggil diam-diam saat currentLayananId ternyata kosong tapi seharusnya ada
// (mis. saat submitPhotoStep dipanggil). Return true kalau berhasil dipulihkan.
function _tryRestoreMultiStep() {
  try {
    const raw = localStorage.getItem('ptsp_pending_multistep');
    if (!raw) return false;
    const pending = JSON.parse(raw);
    if (!pending || !pending.id || !pending.jenis) return false;
    if (Date.now() - (pending.ts || 0) > 7 * 24 * 60 * 60 * 1000) { _clearPendingMultiStep(); return false; }
    if (pending.jenis !== currentJenis) return false; // beda jenis form, jangan dipaksa
    currentLayananId = pending.id;
    if (!currentRekapInfo) currentRekapInfo = pending.rekapInfo || { id: pending.id, nama_pemohon: '-', jenis_label: currentJenis };
    return true;
  } catch (e) { return false; }
}

function triggerAutofillBimwin() {
 try {
  var body = document.getElementById('form-body'); if (!body) return;
  var wrap = document.createElement('div');
  wrap.id = 'bimwin-recall-wrap';
  wrap.style.cssText = 'background:var(--green-light,#e8f5ee);border:1.5px solid var(--green,#2d8c5e);border-radius:10px;padding:14px 16px;margin-bottom:16px';
  wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    + '<div style="font-size:13px;font-weight:600;color:var(--green,#2d8c5e)">📋 Pilih Pendaftaran Nikah</div>'
    + '<button type="button" onclick="triggerAutofillBimwin()" title="Muat ulang daftar pendaftaran" style="background:#fff;border:1px solid var(--green,#2d8c5e);color:var(--green,#2d8c5e);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:600;cursor:pointer">&#128260; Refresh</button>'
    + '</div>'
    + '<select id="bimwin-recall-select" style="width:100%;padding:9px 12px;border:1px solid var(--green,#2d8c5e);border-radius:8px;font-size:13px;background:#fff">'
    + '<option value="">— Memuat data pendaftaran... —</option></select>'
    + '<div id="bimwin-recall-info" style="font-size:11px;color:#666;margin-top:6px"></div>'
    + '<div id="bimwin-foto-progress" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"></div>';
  var oldWrap = document.getElementById('bimwin-recall-wrap');
  if (oldWrap) oldWrap.remove();
  body.insertBefore(wrap, body.firstChild);

  _fetchJsonRetry(API_URL + '?action=listpendaftaran&_=' + Date.now(), { cache: 'no-store' }, 1)
    .then(function(json) {
     try {
      var sel = document.getElementById('bimwin-recall-select'); if (!sel) return;
      var list = json.results || [];
      if (!list.length) {
        sel.innerHTML = '<option value="">— Belum ada pendaftaran —</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Pilih pasangan catin —</option>';
      list.forEach(function(r) {
        var opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.label;
        opt.dataset.payload = JSON.stringify(r.data);
        sel.appendChild(opt);
      });
      var infoEl = document.getElementById('bimwin-recall-info');
      if (infoEl) infoEl.textContent = list.length + ' pendaftaran belum terlaksana';
      sel.addEventListener('change', function() {
        var opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.dataset.payload) return;
        var d = JSON.parse(opt.dataset.payload);
        var map = { nama_pa:'nama_pa', nama_pi:'nama_pi', kontak:'kontak', surat_keluar:'surat_keluar' };
        applyAutofill(d, map, 'nama_pa');
        showToast('Data catin terisi otomatis dari pendaftaran');

        // PATCH: sebelumnya currentLayananId TIDAK PERNAH diset di sini, akibatnya
        // saat submitBimwinPetugas() dipanggil, id yang dikirim selalu null —
        // dan blok auto-generate SK Bimwin di backend (butuh recordId) tidak
        // pernah jalan. Sekarang diset + sekalian tarik foto_urls lengkap untuk
        // ditampilkan (pas foto + status foto tiap step, agar Petugas tahu step
        // mana yang belum upload sebelum lanjut submit Bimwin).
        currentLayananId = opt.value;
        var progressEl = document.getElementById('bimwin-foto-progress');
        if (progressEl) progressEl.innerHTML = '<div style="font-size:11px;color:#888">Memuat status foto...</div>';
        _fetchJsonRetry(API_URL + '?action=getrecord&id=' + encodeURIComponent(opt.value) + '&token=' + encodeURIComponent(session ? session.token : '') + '&_=' + Date.now(), { cache: 'no-store' }, 1)
          .then(function(json2) {
            if (progressEl && json2.ok && json2.record) {
              _renderFotoProgressPanel(progressEl, json2.record.foto_urls);
            } else if (progressEl) {
              progressEl.innerHTML = '<div style="font-size:11px;color:#c0392b">Gagal memuat status foto' + (json2.error ? ': ' + json2.error : '') + '.</div>';
              _showDebugError('triggerAutofillBimwin -> getrecord (ok:false)', new Error(JSON.stringify(json2)));
            }
          })
          .catch(function(eGr2) {
            if (progressEl) progressEl.innerHTML = '<div style="font-size:11px;color:#c0392b">Gagal memuat status foto.</div>';
            _showDebugError('triggerAutofillBimwin -> getrecord', eGr2);
          });
      });
     } catch (errList2) {
      _showDebugError('triggerAutofillBimwin -> listpendaftaran handler', errList2);
     }
    })
    .catch(function(eLp2) {
      var sel = document.getElementById('bimwin-recall-select'); if (sel) sel.innerHTML = '<option value="">— Gagal memuat data —</option>';
      _showDebugError('triggerAutofillBimwin -> listpendaftaran fetch', eLp2);
    });
 } catch (errTAB) {
  _showDebugError('triggerAutofillBimwin', errTAB);
 }
}

function triggerRecallCatin() {
 try {
  var body = document.getElementById('form-body'); if (!body) return;
  var wrap = document.createElement('div');
  wrap.id = 'catin-recall-wrap';
  wrap.style.cssText = 'background:var(--green-light,#e8f5ee);border:1.5px solid var(--green,#2d8c5e);border-radius:10px;padding:14px 16px;margin-bottom:16px';
  wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    + '<div style="font-size:13px;font-weight:600;color:var(--green,#2d8c5e)">&#128203; Pilih Pendaftaran Nikah</div>'
    + '<button type="button" onclick="_loadCatinRecall()" title="Muat ulang daftar pendaftaran" style="background:#fff;border:1px solid var(--green,#2d8c5e);color:var(--green,#2d8c5e);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:600;cursor:pointer">&#128260; Refresh</button>'
    + '</div>'
    + '<select id="catin-recall-select" style="width:100%;padding:9px 12px;border:1px solid var(--green,#2d8c5e);border-radius:8px;font-size:13px;background:#fff">'
    + '<option value="">\u2014 Memuat data pendaftaran... \u2014</option></select>'
    + '<div id="catin-recall-info" style="font-size:11px;color:#666;margin-top:6px"></div>';
  body.insertBefore(wrap, body.firstChild);
  _loadCatinRecall();
 } catch (errTRC) {
  _showDebugError('triggerRecallCatin', errTRC);
 }
}

// Dipisah dari triggerRecallCatin() supaya bisa dipanggil ulang manual lewat
// tombol Refresh, tanpa perlu render ulang seluruh wrapper-nya.
// cache:'no-store' + cache-buster (_=Date.now()) supaya TIDAK pernah kena
// cache browser — ini penyebab paling mungkin data pendaftaran baru tidak
// muncul walau sudah di-refresh (lihat laporan bug tombol kosong 8 Jul 2026).
function _loadCatinRecall() {
 try {
  var sel0 = document.getElementById('catin-recall-select');
  if (sel0) sel0.innerHTML = '<option value="">\u2014 Memuat data pendaftaran... \u2014</option>';
  _fetchJsonRetry(API_URL + '?action=listpendaftaran&_=' + Date.now(), { cache: 'no-store' }, 1)
    .then(function(json) {
     try {
      var sel = document.getElementById('catin-recall-select'); if (!sel) return;
      var list = json.results || [];
      if (!list.length) { sel.innerHTML = '<option value="">\u2014 Belum ada pendaftaran \u2014</option>'; return; }
      sel.innerHTML = '<option value="">\u2014 Pilih pasangan catin \u2014</option>';
      list.forEach(function(r) {
        var opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.label;
        sel.appendChild(opt);
      });
      var infoEl = document.getElementById('catin-recall-info');
      if (infoEl) infoEl.textContent = list.length + ' pendaftaran belum terlaksana';
      sel.addEventListener('change', function() {
        var id = sel.value; if (!id) return;
        _fetchJsonRetry(API_URL + '?action=getrecord&id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(session ? session.token : '') + '&_=' + Date.now(), { cache: 'no-store' }, 1)
          .then(function(json2) {
           try {
            if (!json2.ok || !json2.record) {
              showToast('Gagal memuat data pendaftaran' + (json2.error ? ': ' + json2.error : '') + '.', true);
              _showDebugError('triggerRecallCatin -> getrecord (ok:false)', new Error(JSON.stringify(json2)));
              return;
            }
            var d = json2.record.data || {};
            // Autofill semua field yang ada di form
            document.querySelectorAll('[id^="field_"]').forEach(function(el) {
              var key = el.id.replace('field_', '');
              if (d[key] !== undefined && d[key] !== null && d[key] !== '') {
                el.value = d[key];
                el.setAttribute('readonly', 'readonly');
                el.style.background = '#f5f5f5';
                el.style.color = '#555';
              }
            });
            // Simpan ID pendaftaran untuk rekap
            currentLayananId = id;
            evalAllConditions();
            showToast('Data catin terisi dari pendaftaran');
            // Render status semua foto (pas foto + 4 tahap) sebelum tombol Kirim,
            // supaya Petugas tahu tahap mana yang belum upload foto.
            var existing = document.getElementById('pasfoto-inline-wrap');
            if (existing) existing.remove();
            var _formBody = document.getElementById('form-body');
            if (_formBody) {
              var pw = document.createElement('div');
              pw.id = 'pasfoto-inline-wrap';
              pw.style.cssText = 'padding:14px 16px;background:var(--green-light,#e8f5ee);border:1.5px solid var(--green,#2d8c5e);border-radius:10px;margin-bottom:16px';
              pw.innerHTML = '<div style="font-size:13px;font-weight:600;color:var(--green,#1a6b45);margin-bottom:10px">&#128247; Status Foto Pendaftaran</div>'
                + '<div id="pasfoto-inline-imgs" style="display:flex;gap:10px;flex-wrap:wrap"></div>';
              _formBody.appendChild(pw);
              _renderFotoProgressPanel(document.getElementById('pasfoto-inline-imgs'), json2.record.foto_urls);
            }
           } catch (errInner) {
            _showDebugError('triggerRecallCatin -> getrecord handler', errInner);
           }
          })
          .catch(function(eGr){ showToast('Tidak dapat memuat data.', true); _showDebugError('triggerRecallCatin -> getrecord fetch', eGr); });
      });
     } catch (errList) {
      _showDebugError('_loadCatinRecall -> listpendaftaran handler', errList);
     }
    })
    .catch(function(eLp) {
      var sel = document.getElementById('catin-recall-select');
      if (sel) sel.innerHTML = '<option value="">\u2014 Gagal memuat data \u2014</option>';
      _showDebugError('_loadCatinRecall -> listpendaftaran fetch', eLp);
    });
 } catch (errOuter) {
  _showDebugError('_loadCatinRecall', errOuter);
 }
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

  // ── Tombol Sistem Eksternal: LIONTIN & SIMKAH ──
  const oldExt = document.getElementById('banner-ext-nikah'); if (oldExt) oldExt.remove();
  const extWrap = document.createElement('div');
  extWrap.id = 'banner-ext-nikah';
  extWrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px';
  extWrap.innerHTML =
    '<a href="https://liontin.kankemenagkabmadiun.com/register" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:13px 16px;background:#fff;border:1.5px solid #c3dfc9;border-radius:10px;text-decoration:none;transition:all .2s;box-shadow:0 2px 8px rgba(0,0,0,.06)" onmouseenter="this.style.background=\'#eaf5ee\';this.style.borderColor=\'#237a3e\'" onmouseleave="this.style.background=\'#fff\';this.style.borderColor=\'#c3dfc9\'">'
    + '<span style="font-size:24px;flex-shrink:0">\uD83D\uDD17</span>'
    + '<div><div style="font-size:13px;font-weight:700;color:#1b5e35">LIONTIN</div><div style="font-size:10.5px;color:#536356;line-height:1.4">Kemenag Kab. Madiun</div></div>'
    + '<span style="margin-left:auto;color:#8fa392;font-size:16px">\u2197</span></a>'
    + '<a href="https://simkah4.kemenag.go.id/admin/authentication" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:13px 16px;background:#fff;border:1.5px solid #c3dfc9;border-radius:10px;text-decoration:none;transition:all .2s;box-shadow:0 2px 8px rgba(0,0,0,.06)" onmouseenter="this.style.background=\'#eaf5ee\';this.style.borderColor=\'#237a3e\'" onmouseleave="this.style.background=\'#fff\';this.style.borderColor=\'#c3dfc9\'">'
    + '<span style="font-size:24px;flex-shrink:0">\uD83D\uDDC2\uFE0F</span>'
    + '<div><div style="font-size:13px;font-weight:700;color:#1b5e35">SIMKAH</div><div style="font-size:10.5px;color:#536356;line-height:1.4">Kemenag RI</div></div>'
    + '<span style="margin-left:auto;color:#8fa392;font-size:16px">\u2197</span></a>';
  containerEl.appendChild(extWrap);
}

/* PATCH: resume otomatis kalau Tahap 2 belum selesai (halaman tertutup di tengah proses) */
function _savePendingTahap2() {
  try {
    localStorage.setItem('ptsp_pending_tahap2', JSON.stringify({ jenis: currentJenis, id: currentLayananId, rekapInfo: currentRekapInfo, ts: Date.now() }));
  } catch(e) {}
}
function _clearPendingTahap2() {
  try { localStorage.removeItem('ptsp_pending_tahap2'); } catch(e) {}
}
function _checkPendingTahap2() {
  if (session) return; // Mode petugas: skip resume Tahap 2
  try {
    const raw = localStorage.getItem('ptsp_pending_tahap2');
    if (!raw) return;
    const pending = JSON.parse(raw);
    if (!pending || !pending.jenis || !pending.id) { _clearPendingTahap2(); return; }
    if (Date.now() - (pending.ts||0) > 7*24*60*60*1000) { _clearPendingTahap2(); return; }
    const f = CONFIG.forms && CONFIG.forms[pending.jenis];
    if (!f) { _clearPendingTahap2(); return; }
    const flds = f.fields || []; let tahap2Field = null;
    if (flds.length >= 2) {
      const last = flds[flds.length-1], prev = flds[flds.length-2];
      if (last.type === 'photo' && prev.type === 'photo') tahap2Field = last;
    }
    if (!tahap2Field) { _clearPendingTahap2(); return; }
    const lbl = (pending.rekapInfo && pending.rekapInfo.jenis_label) || f.label;
    const lanjut = confirm('Ada pengiriman "'+lbl+'" (ID: '+pending.id+') yang belum selesai \u2014 foto terakhir belum diunggah.\n\nLanjutkan sekarang?');
    if (!lanjut) return;
    currentJenis = pending.jenis; currentLayananId = pending.id; currentTahap2Field = tahap2Field;
    currentRekapInfo = pending.rekapInfo || { id: pending.id, nama_pemohon: '-', jenis_label: f.label };
    renderRekap();
    goPage('page-rekap');
  } catch(e) {}
}

// PATCH: beberapa field (mis. nama_nadzir1, nik_nadzir1, dst di Wakaf)
// dipakai 2x dengan id SAMA untuk skenario showIf berbeda (Perorangan vs
// Organisasi/BH). document.getElementById() hanya mengambil elemen
// PERTAMA di DOM, walau yang sedang ditampilkan adalah elemen kedua.
// Helper ini mencari semua elemen dengan id tsb, lalu pilih yang ada di
// dalam group yang sedang TAMPIL (group_<fname> tidak display:none).
function getVisibleFieldEl(fname) {
  const els = document.querySelectorAll('#field_' + fname + ', [id="field_' + fname + '"]');
  if (els.length <= 1) return els[0] || null;
  for (let i = 0; i < els.length; i++) {
    const grp = els[i].closest('.form-group');
    if (grp && grp.style.display !== 'none') return els[i];
  }
  return els[0];
}

async function submitForm() {
  const f=CONFIG.forms[currentJenis]; if(!f) return;
  let valid=true; const ov=f.universalOverrides||{};
  const allFields=[].concat(CONFIG.universal||[]).concat(f.fields||[]);
  allFields.forEach(function(field){
    const fname=field.name||field.id; if(!fname||field.type==='section'||( ov[fname]&&ov[fname].hidden)) return;
    const groupEl=document.getElementById('group_'+fname); if(groupEl&&groupEl.style.display==='none') return;
    if(!field.required) return;
    const el=getVisibleFieldEl(fname); const errEl=document.getElementById('err_'+fname); if(!el) return;
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
    const el=getVisibleFieldEl(fname); if(!el) return;
    if(field.type==='radio'){const c=document.querySelector('[name="'+fname+'"]:checked');data[fname]=c?c.value:'';}
    else if(field.type==='checkbox'){data[fname]=Array.from(document.querySelectorAll('[name="'+fname+'"]:checked')).map(function(c){return c.value;});}
    else if(field.type!=='photo'){data[fname]=el.value.trim();}
  });
  const petugas=(document.getElementById('field_petugas_penerima')||document.getElementById('field_petugas_ptsp')||{value:''}).value.trim()||(session?session.nama:'');
  const isTwoStage = !!currentTahap2Field;
  const isMultiStep = currentPhotoSteps.length > 0;
  const recaptchaToken = await getRecaptchaToken('submit_layanan');
  // Mode petugas review nikah_alur_lengkap: kirim updateData ke record existing
  if (session && currentJenis === 'nikah_alur_lengkap' && currentLayananId) {
    const btn2=document.getElementById('btn-submit');
    btn2.disabled=true; btn2.classList.add('loading'); btn2.textContent='Menyimpan...';
    try {
      const res2=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'updateData',id:currentLayananId,data:data,pelaku:session.nama})});
      const result2=await res2.json();
      if(result2.ok){
        showToast('Data pendaftaran berhasil diperbarui.');
        setTimeout(function(){ resetAll(); }, 1500);
      } else { showToast('Gagal: '+(result2.error||'Unknown error'),true); }
    } catch(e){ showToast('Tidak dapat terhubung ke server.',true); }
    btn2.disabled=false; btn2.classList.remove('loading'); btn2.textContent='\uD83D\uDCE4 Kirim Layanan';
    return;
  }

  // ── Mode Petugas: Submit Bimbingan Pernikahan ──────────────────────────
  if (session && currentJenis === 'nikah_bimwin') {
    const btnB = document.getElementById('btn-submit');
    btnB.disabled = true; btnB.classList.add('loading'); btnB.textContent = 'Memproses...';
    const roleP = (session.role || '').toLowerCase();
    const namaP = session.nama || '';
    const labelJenis = /penyuluh/i.test(namaP) || roleP === 'penyuluh'
      ? 'Bimbingan Konseling' : 'Bimbingan Perkawinan Mandiri';
    try {
      const resBimwin = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'submitBimwinPetugas', token: session.token,
          id: currentLayananId || null, data: data })
      });
      const hasilBimwin = await resBimwin.json();
      if (hasilBimwin.ok) {
        const jenisFinal = hasilBimwin.jenis_surat || labelJenis;
        const noSurat = hasilBimwin.no_surat || '';
        const dokUrl  = hasilBimwin.dok_url  || null;
        showToast('\u2705 Bimwin: ' + jenisFinal + ' \u2014 Status: Selesai');
        setTimeout(function() {
          const sid = document.getElementById('success-id');
          if (sid && currentRekapInfo) sid.textContent = currentRekapInfo.id || '';
          let infoEl = document.getElementById('bimwin-result-info');
          if (!infoEl && sid) {
            infoEl = document.createElement('div');
            infoEl.id = 'bimwin-result-info';
            infoEl.style.cssText = 'margin-top:14px;padding:12px 16px;background:var(--green-light,#e8f5ee);border:1.5px solid var(--green,#1a6b45);border-radius:10px;font-size:13px;line-height:1.7';
            sid.insertAdjacentElement('afterend', infoEl);
          }
          if (infoEl) {
            infoEl.innerHTML = '<strong>Jenis Surat:</strong> ' + jenisFinal + '<br>'
              + '<strong>Petugas:</strong> ' + (hasilBimwin.petugas || session.nama)
              + (noSurat ? '<br><strong>No. Surat:</strong> ' + noSurat : '')
              + (dokUrl ? '<br><a href="' + dokUrl + '" target="_blank" style="color:var(--green,#1a6b45);font-weight:700">Buka Dokumen SK</a>' : '');
          }
          goPage('page-success');
        }, 600);
      } else { showToast('Gagal: ' + (hasilBimwin.error || 'Tidak diketahui'), true); }
    } catch (eBimwin) { showToast('Tidak dapat terhubung ke server.', true); }
    btnB.disabled = false; btnB.classList.remove('loading'); btnB.textContent = 'Kirim Layanan';
    return;
  }
  // ── END Mode Petugas Bimwin ──────────────────────────────────────────────

  const payload={action:(isTwoStage||isMultiStep?'submitPartial':'submit'),jenis_layanan:currentJenis,jenis_label:f.label,kategori:f.kategori,nama_pemohon:data.nama_pemohon||data.nama_pa||'',kontak:data.kontak||data.no_hp||'',petugas_ptsp:petugas,data:data,recaptchaToken:recaptchaToken,foto:photoFiles.map(function(p){return {field:p.name,mimeType:p.mimeType,base64:p.base64};})};
  if (isTwoStage || isMultiStep) payload.tahap = 1;
  const btn=document.getElementById('btn-submit'); btn.disabled=true; btn.classList.add('loading'); btn.textContent='Mengirim...';
  try{
    const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const result=await res.json();
    if(result.ok){
      if (currentPhotoSteps.length > 0) {
        // Alur multi-step foto (nikah_alur_lengkap dll)
        currentLayananId = result.id;
        currentRekapInfo = { id: result.id, nama_pemohon: payload.nama_pemohon || '-', jenis_label: f.label };
        currentPhotoStepIdx = 0;
        _savePendingMultiStep();
        renderPhotoStep();
        goPage('page-rekap');
        // CATATAN: popup LIONTIN TIDAK lagi dibuka di sini (submit awal).
        // Dipindah ke step foto Bimwin (foto_penghulu_penyuluh) — lihat submitPhotoStep().
      } else if (isTwoStage) {
        currentLayananId = result.id;
        currentRekapInfo = { id: result.id, nama_pemohon: payload.nama_pemohon || '-', jenis_label: f.label };
        _savePendingTahap2();
        renderRekap();
        goPage('page-rekap');
      } else {
        tampilkanSuksesSelesai(result.id, result.foto_urls);
      }
    }
    else showToast('Gagal: '+(result.error||'Unknown error'),true);
  }catch(e){showToast('Tidak dapat terhubung ke server.',true);}
  btn.disabled=false; btn.classList.remove('loading'); btn.textContent='\uD83D\uDCE4 Kirim Layanan';
}

function renderRekap() {
  document.getElementById('rekap-id').textContent = currentRekapInfo.id;
  document.getElementById('rekap-nama').textContent = currentRekapInfo.nama_pemohon;
  document.getElementById('rekap-jenis').textContent = currentRekapInfo.jenis_label;
  const body = document.getElementById('rekap-foto-body'); body.innerHTML='';
  photoFiles = []; // reset, foto tahap 1 sudah terkirim
  // Banner peringatan jika masih ada photoSteps
  if (currentPhotoSteps.length > 0) {
    const alertBanner = document.createElement('div');
    alertBanner.style.cssText = 'margin-bottom:14px;padding:14px 16px;background:#fff3cd;border:2px solid #f59e0b;border-radius:10px;text-align:center';
    alertBanner.innerHTML = '<div style="font-size:22px;margin-bottom:4px">&#9888;&#65039;</div>'
      + '<div style="font-size:14px;font-weight:700;color:#92400e;margin-bottom:2px">Pendaftaran Belum Selesai!</div>'
      + '<div style="font-size:12px;color:#78350f">Data berhasil tersimpan. Silakan <strong>serahkan perangkat ke petugas KUA</strong> untuk menyelesaikan ' + currentPhotoSteps.length + ' langkah foto berikutnya.</div>';
    body.appendChild(alertBanner);
  }
  if (currentTahap2Field) renderField(body, currentTahap2Field);
}

function renderPasfotoCatin(container) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:16px;padding:14px 16px;background:var(--green-light,#e8f5ee);border:1.5px solid var(--green,#2d8c5e);border-radius:10px';
  wrap.innerHTML = '<div style="font-size:13px;font-weight:600;color:var(--green,#1a6b45);margin-bottom:10px">&#128247; Pas Foto Calon Pengantin</div>'
    + '<div id="pasfoto-wrap" style="display:flex;gap:16px;flex-wrap:wrap"><div style="font-size:12px;color:#888">Memuat foto...</div></div>';
  container.appendChild(wrap);
  _fetchJsonRetry(API_URL + '?action=getrecord&id=' + encodeURIComponent(currentLayananId) + '&token=' + encodeURIComponent(session ? session.token : '') + '&_=' + Date.now(), { cache: 'no-store' }, 1)
    .then(function(json) {
      var pw = document.getElementById('pasfoto-wrap'); if (!pw) return;
      var urls = (json.record && json.record.foto_urls) ? json.record.foto_urls : {};
      var fields = [{id:'pasfoto_pa',label:'Catin Pria'},{id:'pasfoto_pi',label:'Catin Wanita'}];
      var found = 0;
      fields.forEach(function(f) {
        var url = urls[f.id]; if (!url) return;
        found++;
        var card = document.createElement('div');
        card.style.cssText = 'text-align:center;font-size:11px;color:#555';
        card.innerHTML = '<img src="' + url + '" style="width:100px;height:130px;object-fit:cover;border-radius:6px;border:1.5px solid var(--green,#2d8c5e);display:block;margin-bottom:4px" onerror="this.style.display=\'none\'">' + f.label;
        pw.appendChild(card);
      });
      if (!found) pw.innerHTML = '<div style="font-size:12px;color:#888">Pas foto tidak diunggah oleh pemohon.</div>';
    })
    .catch(function() {
      var pw = document.getElementById('pasfoto-wrap'); if (pw) pw.innerHTML = '<div style="font-size:12px;color:#aaa">Gagal memuat foto.</div>';
    });
}

// ── Multi-step foto (photoSteps) ─────────────────────────────
function _normalizeDriveThumb(url) {
  if (!url) return url;
  var m = url.match(/[?&]id=([^&]+)/);
  if (!m) m = url.match(/\/d\/([^/?]+)/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w300' : url;
}

/* Galeri kumulatif verifikasi foto (Mode Petugas) — memastikan pemohon
   sudah upload semua foto yang wajib, ditampilkan bertambah di setiap
   tahap: [foto-foto form awal] + [tahap-tahap sebelumnya yang sudah selesai] */
function renderPhotoGallery(container) {
  const f = CONFIG.forms && CONFIG.forms[currentJenis];
  if (!f) return;
  const cards = []; // { label, ids: [fieldId,...] }
  const seenGroup = {};
  (f.fields || []).forEach(function(fd) {
    if (fd.type !== 'photo') return;
    if (fd.galleryGroup) {
      if (seenGroup[fd.galleryGroup]) { seenGroup[fd.galleryGroup].ids.push(fd.id); return; }
      const c = { label: fd.galleryGroup, ids: [fd.id] };
      seenGroup[fd.galleryGroup] = c; cards.push(c);
    } else {
      cards.push({ label: fd.galleryLabel || fd.label, ids: [fd.id] });
    }
  });
  currentPhotoSteps.slice(0, currentPhotoStepIdx).forEach(function(st) {
    cards.push({ label: st.shortLabel || st.label, ids: [st.id], stepId: st.id });
  });
  if (!cards.length) return;

  const old = document.getElementById('photo-gallery-check'); if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'photo-gallery-check';
  wrap.style.cssText = 'margin-bottom:16px;padding:12px 14px;background:#f8faf9;border:1.5px solid var(--green-light,#c3dfc9);border-radius:10px';
  wrap.innerHTML = '<div style="font-size:12px;font-weight:700;color:var(--green,#1a6b45);margin-bottom:10px">&#128247; Verifikasi Foto Sudah Diunggah (' + cards.length + ')</div>'
    + '<div id="photo-gallery-grid" style="display:flex;gap:10px;flex-wrap:wrap"></div>';
  container.appendChild(wrap);
  const grid = document.getElementById('photo-gallery-grid');

  cards.forEach(function(c) {
    const srcs = c.ids.map(function(id){ return galleryPhotos[id]; }).filter(Boolean);
    const card = document.createElement('div');
    card.style.cssText = 'text-align:center;font-size:10.5px;color:#555;width:76px';
    if (srcs.length) {
      card.style.position = 'relative';
      const delBtn = c.stepId
        ? '<div class="photo-thumb-del" style="position:absolute;top:-6px;right:-6px;z-index:2" onclick="event.stopPropagation();redoPhotoStep(\''+c.stepId+'\')" title="Hapus &amp; upload ulang">\u00D7</div>'
        : '';
      card.innerHTML = delBtn + '<div style="display:flex;gap:2px;justify-content:center;margin-bottom:3px">'
        + srcs.map(function(s){ return '<img src="'+s+'" style="width:'+(srcs.length>1?'36px':'76px')+';height:76px;object-fit:cover;border-radius:6px;border:1.5px solid var(--green,#2d8c5e);cursor:zoom-in" onclick="openPhotoLightbox(\''+s+'\')">'; }).join('')
        + '</div>' + c.label;
    } else {
      card.innerHTML = '<div style="width:76px;height:76px;border-radius:6px;border:1.5px dashed #d99;background:#fdf2f2;display:flex;align-items:center;justify-content:center;font-size:9px;color:#c0392b;font-weight:600;margin-bottom:3px">Belum ada</div>' + c.label;
    }
    grid.appendChild(card);
  });
}

// Cari index step foto pertama yang belum ada fotonya (dilewati saat rewind).
// excludeIdx: index yang sedang diproses, tidak ikut dicek (fotonya baru saja diunggah)
function nextIncompletePhotoStepIdx(excludeIdx) {
 try {
  for (let i = 0; i < currentPhotoSteps.length; i++) {
    if (i !== excludeIdx && !galleryPhotos[currentPhotoSteps[i].id]) return i;
  }
  return currentPhotoSteps.length; // semua step sudah lengkap
 } catch (errNIP) {
  _showDebugError('nextIncompletePhotoStepIdx(' + excludeIdx + ')', errNIP);
  return currentPhotoSteps.length;
 }
}

// Petugas/pemohon hapus foto step yang sudah terkirim ke server, lalu upload ulang.
// Step lain yang sudah lengkap tetap tersimpan dan otomatis dilewati.
function redoPhotoStep(stepId) {
 try {
  const idx = currentPhotoSteps.findIndex(function(s){ return s.id === stepId; });
  if (idx === -1) throw new Error('stepId "' + stepId + '" tidak ditemukan di currentPhotoSteps');
  const step = currentPhotoSteps[idx];
  const ok = confirm('Hapus foto "' + (step.shortLabel || step.label) + '" dan upload ulang?');
  if (!ok) return;
  delete galleryPhotos[stepId];
  currentPhotoStepIdx = idx;
  photoFiles = [];
  renderPhotoStep();
  goPage('page-rekap');
 } catch (errRDS) {
  _showDebugError('redoPhotoStep(' + stepId + ')', errRDS);
 }
}

function renderPhotoStep() {
 try {
  const step = currentPhotoSteps[currentPhotoStepIdx];
  const total = currentPhotoSteps.length;
  const stepNum = currentPhotoStepIdx + 1;
  if (!step) throw new Error('currentPhotoSteps[' + currentPhotoStepIdx + '] kosong/undefined (total step: ' + total + ')');

  // Header rekap
  document.getElementById('rekap-id').textContent = currentRekapInfo.id;
  document.getElementById('rekap-nama').textContent = currentRekapInfo.nama_pemohon;
  document.getElementById('rekap-jenis').textContent = currentRekapInfo.jenis_label;

  // Indikator progress step
  const body = document.getElementById('rekap-foto-body');
  body.innerHTML = '';
  photoFiles = [];

  // Banner PERHATIAN - mencolok di atas
  const alertBanner = document.createElement('div');
  alertBanner.style.cssText = 'margin-bottom:14px;padding:14px 16px;background:#fff3cd;border:2px solid #f59e0b;border-radius:10px;text-align:center';
  alertBanner.innerHTML = '<div style="font-size:22px;margin-bottom:4px">&#9888;&#65039;</div>'
    + '<div style="font-size:14px;font-weight:700;color:#92400e;margin-bottom:2px">Pendaftaran Belum Selesai!</div>'
    + '<div style="font-size:12px;color:#78350f">Masih ada <strong>' + (total - stepNum + 1) + ' langkah foto</strong> yang harus diselesaikan bersama petugas KUA.</div>';
  body.appendChild(alertBanner);

  // Progress step
  const progress = document.createElement('div');
  progress.style.cssText = 'margin-bottom:16px;padding:10px 14px;background:var(--green-light,#e8f5ee);border:1.5px solid var(--green,#1a6b45);border-radius:10px;font-size:13px;color:var(--green,#1a6b45);font-weight:600;text-align:center';
  progress.innerHTML = 'Langkah ' + stepNum + ' dari ' + total + ' &mdash; ' + step.label;
  body.appendChild(progress);

  renderPhotoGallery(body);

  if (step.petugasField) {
    renderField(body, Object.assign({ type: 'select', required: true }, step.petugasField));
    const pfEl = document.getElementById('field_' + step.petugasField.id);
    if (pfEl && stepPetugasValues[step.id]) pfEl.value = stepPetugasValues[step.id];
  }

  renderField(body, { id: step.id, label: step.label, type: 'photo', required: step.required !== false });

  if (galleryPhotos[step.id]) {
    const existingWrap = document.createElement('div');
    existingWrap.style.cssText = 'margin-top:8px;padding:8px 10px;background:#eef6f0;border:1px solid var(--green-light,#c3dfc9);border-radius:8px;font-size:11px;color:#2d6a4f;display:flex;align-items:center;gap:8px';
    existingWrap.innerHTML = '<img src="'+galleryPhotos[step.id]+'" style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0;cursor:zoom-in" onclick="openPhotoLightbox(\''+galleryPhotos[step.id]+'\')">'
      + '<span>Foto tersimpan saat ini. Upload foto baru untuk mengganti, atau langsung lanjut untuk mempertahankan.</span>';
    body.appendChild(existingWrap);
  }

  // Ganti tombol submit
  const btnWrap = document.getElementById('rekap-btn-wrap');
  if (btnWrap) {
    const isLast = currentPhotoStepIdx >= total - 1;
    const hasPrev = currentPhotoStepIdx > 0;
    btnWrap.innerHTML =
      '<div style="display:flex;gap:8px">'
      + (hasPrev ? '<button onclick="goBackPhotoStep()" style="padding:9px 14px;background:#f3f4f6;color:#555;border:1px solid #ddd;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">&lsaquo; Kembali</button>' : '')
      + '<button class="btn-submit" id="btn-submit-complete" onclick="submitPhotoStep()" style="flex:1">' +
        (isLast ? '✅ Selesai &amp; Kirim' : '📤 Kirim &amp; Lanjut') + '</button>'
      + (!isLast ? '<button onclick="skipPhotoStep()" style="padding:9px 16px;background:#f3f4f6;color:#555;border:1px solid #ddd;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Lewati ›</button>' : '')
      + '</div>';
  } else {
    throw new Error('#rekap-btn-wrap tidak ditemukan di DOM — tombol submit/kembali/lewati TIDAK terpasang.');
  }
 } catch (errRPS) {
  _showDebugError('renderPhotoStep (idx=' + currentPhotoStepIdx + ', jenis=' + currentJenis + ')', errRPS);
 }
}

// Kembali ke step foto sebelumnya untuk melihat/mengganti foto yang sudah diunggah.
// Tidak menghapus foto lama — hanya dihapus jika pemohon pilih foto baru lalu kirim.
function goBackPhotoStep() {
 try {
  if (currentPhotoStepIdx <= 0) return;
  currentPhotoStepIdx--;
  photoFiles = [];
  renderPhotoStep();
  goPage('page-rekap');
 } catch (errGBP) {
  _showDebugError('goBackPhotoStep (idx=' + currentPhotoStepIdx + ')', errGBP);
 }
}

async function submitPhotoStep() {
  let btn = null;
 try {
  const step = currentPhotoSteps[currentPhotoStepIdx];
  if (!step) throw new Error('currentPhotoSteps[' + currentPhotoStepIdx + '] kosong/undefined saat submit');
  const fname = step.id;
  const hasNewPhoto = photoFiles.some(function(p){ return p.name === fname; });
  const hasExisting = !!galleryPhotos[fname];
  if (step.required !== false && !hasNewPhoto && !hasExisting) {
    showToast('Foto wajib diunggah sebelum melanjutkan.', true);
    return;
  }
  let namaPetugasTahap = '';
  if (step.petugasField) {
    const pfEl = document.getElementById('field_' + step.petugasField.id);
    namaPetugasTahap = pfEl ? pfEl.value : '';
    if (!namaPetugasTahap) {
      showToast((step.petugasField.label || 'Nama petugas') + ' wajib dipilih sebelum melanjutkan.', true);
      return;
    }
    stepPetugasValues[step.id] = namaPetugasTahap;
  }
  // isLast dihitung dinamis: true jika SEMUA step lain (selain yang sedang disubmit)
  // sudah punya foto — ini menangani kasus redo step tengah setelah step-step
  // berikutnya sudah lebih dulu selesai (lihat redoPhotoStep).
  const isLast = currentPhotoSteps.every(function(s, i){ return i === currentPhotoStepIdx || !!galleryPhotos[s.id]; });

  // Kembali tanpa ganti foto (foto lama tetap dipakai) & bukan step terakhir:
  // tidak perlu kirim ulang ke server, cukup lanjut ke step yang masih kosong.
  if (!hasNewPhoto && hasExisting && !isLast) {
    currentPhotoStepIdx = nextIncompletePhotoStepIdx(currentPhotoStepIdx);
    renderPhotoStep();
    goPage('page-rekap');
    return;
  }

  // PATCH: jaring pengaman diam-diam. Kalau currentLayananId ternyata kosong
  // (state JS hilang, mis. tab di-reload paksa di HP di tengah alur foto),
  // coba pulihkan dari localStorage dulu SEBELUM kirim ke server — supaya
  // tidak muncul "ID layanan tidak ditemukan" begitu saja tanpa penjelasan.
  if (!currentLayananId) {
    const restored = _tryRestoreMultiStep();
    if (!restored) {
      showToast('Sesi terputus. Gunakan menu "Lanjutkan Pendaftaran" dengan Nomor Layanan Anda untuk melanjutkan.', true);
      return;
    }
  }

  const payload = {
    action: isLast ? 'submitComplete' : 'submitPhotoStep',
    id: currentLayananId,
    stepIdx: currentPhotoStepIdx,
    foto: photoFiles.filter(function(p){ return p.name === fname; }).map(function(p){ return { field: p.name, mimeType: p.mimeType, base64: p.base64 }; }),
    stepFieldId: step.petugasField ? step.id : undefined,
    namaPetugas: step.petugasField ? namaPetugasTahap : undefined
  };
  btn = document.getElementById('btn-submit-complete');
  if (!btn) throw new Error('#btn-submit-complete tidak ditemukan di DOM — kemungkinan besar ini penyebab tombol "tidak responsif" (klik tidak melakukan apa-apa karena fungsi berhenti di sini, sebelum sempat fetch ke server).');
  btn.disabled = true; btn.classList.add('loading'); btn.textContent = 'Mengirim...';
  try {
    const result = await _fetchJsonRetry(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }, 1);
    if (result.ok) {
      // Auto-open LIONTIN setelah step foto Bimwin (foto_penghulu_penyuluh) disubmit.
      // Dicek di luar isLast supaya tetap kebuka walau kebetulan Bimwin adalah step terakhir.
      if (fname === 'foto_penghulu_penyuluh') {
        window.open('https://liontin.kankemenagkabmadiun.com/register', '_blank');
      }
      if (isLast) {
        _clearPendingMultiStep();
        tampilkanSuksesSelesai(result.id, result.foto_urls);
      } else {
        // Auto-open SIMKAH setelah step foto Rafak (Penghulu) disubmit
        if (fname === 'foto_penghulu') {
          window.open('https://simkah4.kemenag.go.id/admin/authentication', '_blank');
        }
        currentPhotoStepIdx = nextIncompletePhotoStepIdx(currentPhotoStepIdx);
        _savePendingMultiStep();
        renderPhotoStep();
        goPage('page-rekap');
      }
    } else {
      showToast('Gagal: ' + (result.error || 'Unknown error'), true);
    }
  } catch(e) {
    // PATCH DEBUG: tampilkan pesan error ASLI juga (bukan cuma "tidak dapat terhubung"),

    // supaya kalau penyebabnya BUKAN masalah jaringan (mis. JSON tidak valid), ketahuan.
    showToast('Tidak dapat terhubung ke server.', true);
    _showDebugError('submitPhotoStep -> fetch/json', e);
  }
  btn.disabled = false; btn.classList.remove('loading');
 } catch (errSPS) {
  _showDebugError('submitPhotoStep (idx=' + currentPhotoStepIdx + ')', errSPS);
  if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
 }
}

function skipPhotoStep() {
  if (currentPhotoStepIdx >= currentPhotoSteps.length - 1) {
    showToast('Step dilewati. Pendaftaran selesai.');
    setTimeout(function() { tampilkanSuksesSelesai(currentLayananId); }, 800);
    return;
  }
  showToast('Step dilewati.');
  currentPhotoStepIdx++;
  photoFiles = [];
  renderPhotoStep();
}

async function submitComplete() {
  if (!currentTahap2Field || !currentLayananId) return;
  const fname = currentTahap2Field.name || currentTahap2Field.id;
  if (currentTahap2Field.required !== false && !photoFiles.some(function(p){return p.name===fname;})) {
    showToast('Foto wajib diunggah sebelum mengirim.', true);
    return;
  }
  const payload = {
    action: 'submitComplete',
    id: currentLayananId,
    foto: photoFiles.filter(function(p){return p.name===fname;}).map(function(p){return {field:p.name,mimeType:p.mimeType,base64:p.base64};})
  };
  const btn=document.getElementById('btn-submit-complete'); btn.disabled=true; btn.classList.add('loading'); btn.textContent='Mengirim...';
  try{
    const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const result=await res.json();
    if(result.ok){_clearPendingTahap2();tampilkanSuksesSelesai(result.id, result.foto_urls);}
    else showToast('Gagal: '+(result.error||'Unknown error'),true);
  }catch(e){showToast('Tidak dapat terhubung ke server.',true);}
  btn.disabled=false; btn.classList.remove('loading'); btn.textContent='\u2705 Selesai & Kirim';
}

/* PATCH: pesan khusus setelah Tahap 2 (foto Penghulu) selesai, untuk 4 layanan
 * surat yang foto Penghulu-nya berfungsi sebagai Verifikasi Data. Jenis lain
 * tetap tampilan sukses biasa (cuma ID). */
var JENIS_VERIFIKASI_SELESAI = ['nikah_sk_belum','nikah_sk_pernah','nikah_itsbat','nikah_rekomendasi'];
function tampilkanSuksesSelesai(id, fotoUrls) {
  document.getElementById('success-id').textContent = id;
  var msgEl = document.getElementById('success-verifikasi-msg');
  var f = CONFIG.forms[currentJenis];
  if (JENIS_VERIFIKASI_SELESAI.includes(currentJenis) && f) {
    if (!msgEl) {
      msgEl = document.createElement('div');
      msgEl.id = 'success-verifikasi-msg';
      msgEl.style.cssText = 'margin-top:14px;padding:12px 16px;background:var(--green-light,#e8f5ee);border:1.5px solid var(--green,#1a6b45);border-radius:10px;color:var(--green,#1a6b45);font-size:13px;line-height:1.5;text-align:left';
      document.getElementById('success-id').insertAdjacentElement('afterend', msgEl);
    }
    msgEl.innerHTML = '\u2705 <strong>Verifikasi Data Selesai.</strong> Mohon tunggu, petugas akan menyerahkan surat <strong>' + f.label + '</strong> setelah selesai diproses.';
    msgEl.style.display = 'block';
  } else if (msgEl) {
    msgEl.style.display = 'none';
  }
  // Link dokumen Bimwin jika auto-generated
  var dokEl = document.getElementById('success-dok-bimwin');
  var dokUrl = fotoUrls && fotoUrls._dok_bimwin ? fotoUrls._dok_bimwin : null;
  if (dokUrl) {
    if (!dokEl) {
      dokEl = document.createElement('div');
      dokEl.id = 'success-dok-bimwin';
      dokEl.style.cssText = 'margin-top:12px;padding:12px 16px;background:#fff3cd;border:1.5px solid #f59e0b;border-radius:10px;font-size:13px;color:#92400e;text-align:center';
      document.getElementById('success-id').insertAdjacentElement('afterend', dokEl);
    }
    dokEl.innerHTML = '\uD83D\uDCC4 <strong>SK Bimwin telah digenerate</strong><br>'
      + '<a href="' + dokUrl + '" target="_blank" style="color:#92400e;font-weight:700">Buka / Download Dokumen</a>';
    dokEl.style.display = 'block';
  } else if (dokEl) {
    dokEl.style.display = 'none';
  }
  goPage('page-success');
}

function resetAll() { currentJenis=null; photoFiles=[]; galleryPhotos={}; currentTahap2Field=null; currentLayananId=null; currentRekapInfo=null; stepPetugasValues={}; _clearPendingMultiStep(); renderLayananList(); }
var _tt;
function showToast(msg,isError) { isError=isError||false; const t=document.getElementById('toast'); t.textContent=msg; t.className='toast show'+(isError?' error':''); clearTimeout(_tt); _tt=setTimeout(function(){t.classList.remove('show');},3500); }

/* ── PATCH DEBUG: jaring penangkap error untuk alur PhotoStep ──────────────
   Box error persisten di layar (tidak auto-hilang seperti toast), supaya
   error yang muncul di HP lapangan bisa langsung difoto/disalin tanpa
   perlu sambung DevTools. Tap kotak teks untuk select-all lalu copy.
   AMAN: hanya menangkap & menampilkan error, tidak mengubah alur normal
   sama sekali kalau tidak ada error. Boleh dihapus kapan saja setelah
   bug ketemu, tidak berpengaruh ke logic manapun. ── */
function _showDebugError(context, err) {
  try { console.error('[PTSP-DEBUG] ' + context + ':', err); } catch(e0) {}
  try {
    let box = document.getElementById('ptsp-debug-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ptsp-debug-error';
      box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#fff3f3;border:2px solid #c0392b;border-radius:10px;padding:10px 12px;font-size:11px;color:#7a1a1a;box-shadow:0 4px 16px rgba(0,0,0,.25)';
      document.body.appendChild(box);
    }
    const msg = context + ': ' + (err && err.message ? err.message : String(err)) + (err && err.stack ? '\n' + err.stack : '');
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
      + '<strong>\u26A0\uFE0F Debug Error (PTSP)</strong>'
      + '<button onclick="document.getElementById(\'ptsp-debug-error\').remove()" style="background:#c0392b;color:#fff;border:none;border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer">Tutup</button></div>'
      + '<textarea readonly style="width:100%;min-height:70px;font-size:10.5px;font-family:monospace;border:1px solid #e2b0b0;border-radius:6px;padding:6px;box-sizing:border-box" onclick="this.select()">' + msg.replace(/</g,'&lt;') + '</textarea>'
      + '<div style="margin-top:4px;font-size:10px;color:#999">Tap kotak teks di atas untuk pilih semua, lalu salin & kirim ke Claude.</div>';
  } catch (e2) { /* jangan sampai error handler sendiri ikut crash */ }
}


/* ── CALLBACK PHOTO STEP ────────────────────────────────────────────── */
function renderCallbackPanel(containerEl) {
  const old = document.getElementById('callback-panel'); if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'callback-panel';
  panel.style.cssText = 'margin-top:14px;border:1.5px solid var(--green,#2d8c5e);border-radius:12px;overflow:hidden';
  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 16px;background:var(--green-light,#e8f5ee);cursor:pointer;display:flex;align-items:center;gap:10px;user-select:none';
  header.innerHTML = '<span style="font-size:18px">\uD83D\uDCF7</span>'
    + '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--green,#1a6b45)">Lanjutkan Foto yang Tertunda</div>'
    + '<div style="font-size:11px;color:#555;margin-top:1px">Sudah dapat kode layanan? Lanjutkan langkah foto di sini.</div></div>'
    + '<span id="callback-toggle-icon" style="font-size:16px;color:var(--green,#1a6b45)">\uFF0B</span>';
  const body = document.createElement('div');
  body.id = 'callback-body';
  body.style.cssText = 'display:none;padding:16px';
  if (session) {
    body.innerHTML = '<div style="font-size:12px;font-weight:600;color:#555;margin-bottom:8px">Pilih pendaftaran yang menunggu foto:</div>'
      + '<select id="callback-dropdown" style="width:100%;padding:9px 12px;border:1px solid var(--green,#2d8c5e);border-radius:8px;font-size:13px;background:#fff;margin-bottom:10px">'
      + '<option value="">\u2014 Memuat data... \u2014</option></select>'
      + '<div id="callback-dropdown-info" style="font-size:11px;color:#666;margin-bottom:10px"></div>'
      + '<button onclick="resumeFromDropdown()" style="padding:9px 20px;background:var(--green,#2d8c5e);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;width:100%">&#9654; Lanjutkan Foto</button>'
      + '<div style="display:flex;align-items:center;gap:10px;margin:14px 0"><div style="flex:1;height:1px;background:#ddd"></div><span style="font-size:11px;color:#999">atau</span><div style="flex:1;height:1px;background:#ddd"></div></div>'
      + '<div style="font-size:12px;font-weight:600;color:#555;margin-bottom:6px">Masukkan Kode Layanan Manual:</div>'
      + '<input id="callback-kode-input" type="text" placeholder="Contoh: LYN-20240624-001"'
      + ' style="width:100%;padding:9px 12px;border:1px solid var(--green,#2d8c5e);border-radius:8px;font-size:13px;margin-bottom:8px;box-sizing:border-box"'
      + ' onkeydown="if(event.key===\'Enter\')resumeFromKode()">'
      + '<div id="callback-kode-error" style="display:none;color:#c0392b;font-size:12px;margin-bottom:8px"></div>'
      + '<button onclick="resumeFromKode()" style="padding:9px 20px;background:#fff;color:var(--green,#1a6b45);border:1.5px solid var(--green,#2d8c5e);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;width:100%">&#128269; Cari &amp; Lanjutkan</button>';
    setTimeout(loadPendingPhotoDropdown, 100);
  } else {
    body.innerHTML = '<div style="font-size:12px;font-weight:600;color:#555;margin-bottom:6px">Masukkan Kode Layanan Anda:</div>'
      + '<input id="callback-kode-input" type="text" placeholder="Contoh: LYN-20240624-001"'
      + ' style="width:100%;padding:9px 12px;border:1px solid var(--green,#2d8c5e);border-radius:8px;font-size:13px;margin-bottom:8px;box-sizing:border-box"'
      + ' onkeydown="if(event.key===\'Enter\')resumeFromKode()">'
      + '<div id="callback-kode-error" style="display:none;color:#c0392b;font-size:12px;margin-bottom:8px"></div>'
      + '<button onclick="resumeFromKode()" style="padding:9px 20px;background:var(--green,#2d8c5e);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;width:100%">&#128269; Cari &amp; Lanjutkan</button>';
  }
  header.onclick = function() {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    document.getElementById('callback-toggle-icon').textContent = open ? '\uFF0B' : '\uFF0D';
  };
  panel.appendChild(header);
  panel.appendChild(body);
  containerEl.appendChild(panel);
}

function loadPendingPhotoDropdown() {
  const sel = document.getElementById('callback-dropdown'); if (!sel) return;
  fetch(API_URL + '?action=getpendingphoto&token=' + encodeURIComponent(session ? session.token : '') + '&_=' + Date.now(), { cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(json) {
      if (!json.ok) {
        sel.innerHTML = '<option value="">\u2014 ' + (json.error || 'Gagal memuat data') + ' \u2014</option>';
        return;
      }
      const list = json.data || [];
      if (!list.length) {
        sel.innerHTML = '<option value="">\u2014 Tidak ada pendaftaran tertunda \u2014</option>';
        return;
      }
      sel.innerHTML = '<option value="">\u2014 Pilih pendaftaran \u2014</option>';
      list.forEach(function(r) {
        const opt = document.createElement('option');
        opt.value = r.id;
        const d = r.data || {};
        const label = (d.nama_pa || r.nama_pemohon || r.id)
          + (d.nama_pi ? ' & ' + d.nama_pi : '')
          + (d.tgl_akad ? ' \u2014 ' + d.tgl_akad : '');
        opt.textContent = r.id + ' | ' + label;
        opt.dataset.rec = JSON.stringify(r);
        sel.appendChild(opt);
      });
      const info = document.getElementById('callback-dropdown-info');
      if (info) info.textContent = list.length + ' pendaftaran menunggu foto';
    })
    .catch(function() {
      const sel2 = document.getElementById('callback-dropdown');
      if (sel2) sel2.innerHTML = '<option value="">\u2014 Gagal memuat data \u2014</option>';
    });
}

async function resumeFromDropdown() {
 try {
  const sel = document.getElementById('callback-dropdown');
  if (!sel || !sel.value) { showToast('Pilih pendaftaran dulu.', true); return; }
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.dataset.rec) { showToast('Data tidak ditemukan.', true); return; }
  _doResumePhotoStep(JSON.parse(opt.dataset.rec));
 } catch (errRFD) {
  _showDebugError('resumeFromDropdown', errRFD);
 }
}

async function resumeFromKode() {
  const input = document.getElementById('callback-kode-input'); if (!input) return;
  const kode = input.value.trim().toUpperCase();
  const errEl = document.getElementById('callback-kode-error');
  if (!kode) { errEl.textContent = 'Masukkan kode layanan.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  input.disabled = true;
  try {
    const res = await fetch(API_URL + '?action=cekstatuspublik&kode=' + encodeURIComponent(kode) + '&_=' + Date.now(), { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) {
      errEl.textContent = data.error || 'Kode tidak ditemukan.';
      errEl.style.display = 'block';
      input.disabled = false;
      return;
    }
    if (data.status_submit !== 'Menunggu Foto Tahap 2') {
      errEl.textContent = 'Kode ini sudah selesai atau tidak membutuhkan foto tambahan.';
      errEl.style.display = 'block';
      input.disabled = false;
      return;
    }
    _doResumePhotoStep(data);
  } catch(e) {
    errEl.textContent = 'Tidak dapat terhubung ke server.';
    errEl.style.display = 'block';
  }
  input.disabled = false;
}

function _doResumePhotoStep(rec) {
 try {
  currentJenis = rec.jenis_layanan || 'nikah_alur_lengkap';
  currentLayananId = rec.id;
  currentRekapInfo = {
    id:           rec.id,
    nama_pemohon: rec.nama_pemohon || '-',
    jenis_label:  rec.jenis_label  || 'Pendaftaran Nikah'
  };
  photoFiles = [];
  const f = CONFIG.forms && CONFIG.forms[currentJenis];
  if (!f || !f.photoSteps || !f.photoSteps.length) {
    showToast('Tidak ada langkah foto untuk layanan ini.', true);
    return;
  }
  var existingFoto = {};
  try {
    existingFoto = typeof rec.foto_urls === 'string'
      ? JSON.parse(rec.foto_urls)
      : (rec.foto_urls || {});
  } catch(x) {}
  galleryPhotos = {};
  Object.keys(existingFoto).forEach(function(k) {
    if (existingFoto[k]) galleryPhotos[k] = _normalizeDriveThumb(existingFoto[k]);
  });
  currentPhotoSteps = f.photoSteps;
  // Selalu mulai dari step 0 agar petugas bisa ulang/skip foto manapun
  currentPhotoStepIdx = 0;
  _savePendingMultiStep();
  renderPhotoStep();
  goPage('page-rekap');
 } catch (errDRPS) {
  _showDebugError('_doResumePhotoStep', errDRPS);
 }
}
/* ── END CALLBACK PHOTO STEP ────────────────────────────────────────────── */

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
