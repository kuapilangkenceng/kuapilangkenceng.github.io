const KUA = {

  /* ── URL UTAMA ─────────────────────────────────────────────── */
  URL: {
    publik : 'https://kuapilangkenceng.github.io',
    ptsp   : 'https://kuapilangkenceng.github.io/ptsp',

    // ⚠️ CATATAN KEAMANAN: URL API ini memang publik (sifat GAS webapp).
    // Proteksi utama ada di backend: reCAPTCHA, token auth, rate limiting.
    // Jangan tambahkan logika sensitif yang tidak terlindungi token di GAS.
    api    : 'https://script.google.com/macros/s/AKfycbwi1lkhvBIsB8zNo4A7OexF9ujN4K5BK_cIhEUcKhIyDiIV-lSYrmGJE7V09s0I9qwr/exec',

    // ⛔ sheetsId DIHAPUS dari config.js publik.
    // Jika ada kode frontend yang perlu sheetsId, ambil via API:
    // KUA.fetchAPI({ action: 'getconfig' }).then(d => d.sheetsId)
    // atau sediakan endpoint GAS khusus yang return ID setelah validasi.
  },

  /* ── PROFIL KUA ─────────────────────────────────────────────── */
  PROFIL: {
    nama          : 'KUA Kecamatan Pilangkenceng',
    namaKecamatan : 'Pilangkenceng',
    namaKabupaten : 'Kabupaten Madiun',
    namaProvinsi  : 'Jawa Timur',
    namaKepala    : 'MOHHAMAD SADIKUL ANAM SH.MSI',
    // ⛔ NIP dihapus dari file publik (data ASN sebaiknya tidak di-expose)
  },

  /* ── KONTAK ──────────────────────────────────────────────────── */
  KONTAK: {
    wa       : '6285119505451',
    waLabel  : '085119505451',
    email    : 'kuapilangkenceng@gmail.com',
    alamat   : 'Jl. Tirtotejo, Ds. Kenongorejo, Pilangkenceng, Kabupaten Madiun, Jawa Timur',
    maps     : 'https://maps.app.goo.gl/D3Aygiwns79AT67J8',
    jamKerja : 'Senin–Kamis, 07.30–16.00 WIB | Jumat, 07.30–16.30 WIB',
  },

  /* ── DAFTAR LAYANAN ──────────────────────────────────────────── */
  LAYANAN: [
    { id: 'nikah',    nama: 'Pencatatan Nikah',    icon: 'ti-heart',             aktif: true  },
    { id: 'wakaf',    nama: 'Perwakafan',           icon: 'ti-building-mosque',   aktif: false },
    { id: 'skt',      nama: 'SKT Masjid/Musholla',  icon: 'ti-home',              aktif: false },
    { id: 'halal',    nama: 'Sertifikasi Halal',    icon: 'ti-certificate',       aktif: false },
    { id: 'kiblat',   nama: 'Pengukuran Kiblat',    icon: 'ti-compass',           aktif: false },
    { id: 'konseling',nama: 'Konseling Keluarga',   icon: 'ti-users',             aktif: false },
  ],

  /* ── HELPER: Buka form PTSP ──────────────────────────────────── */
  daftar: function(idLayanan) {
    var l = this.LAYANAN.find(function(x) { return x.id === idLayanan; });
    if (!l) return;
    window.location.href = this.URL.ptsp + '/index.html?layanan=' + idLayanan;
  },

  /* ── HELPER: WA otomatis ─────────────────────────────────────── */
  hubungiWA: function(pesan) {
    pesan = pesan || 'Assalamualaikum, saya ingin bertanya mengenai layanan KUA Pilangkenceng.';
    var url = 'https://wa.me/' + this.KONTAK.wa + '?text=' + encodeURIComponent(pesan);
    window.open(url, '_blank');
  },

  /* ── HELPER: Fetch API dengan timeout & error handling ──────── */
  fetchAPI: async function(params) {
    params = params || {};
    try {
      var controller = new AbortController();
      var timeout    = setTimeout(function() { controller.abort(); }, 15000); // 15 detik timeout
      var query      = new URLSearchParams(Object.assign({}, params, { t: Date.now() })).toString();
      var res        = await fetch(this.URL.api + '?' + query, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        return { status: 'error', message: 'Koneksi timeout. Periksa jaringan internet Anda.' };
      }
      console.error('[KUA.fetchAPI]', err);
      return { status: 'error', message: err.message };
    }
  },

  get isPublik() { return !window.location.pathname.startsWith('/ptsp'); },
  get isPTSP()   { return window.location.pathname.startsWith('/ptsp'); },
};

window.KUA = KUA;
Object.freeze(KUA.URL);
