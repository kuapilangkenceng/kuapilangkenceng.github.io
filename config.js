/**
 * config.js — Konfigurasi Terpusat KUA Pilangkenceng
 * ====================================================
 * File ini dipakai di KEDUA repo:
 *   - kuapilangkenceng.github.io  (website publik)
 *   - kuapilangkenceng.github.io/ptsp  (sistem PTSP)
 *
 * CARA PAKAI:
 *   <script src="https://kuapilangkenceng.github.io/config.js"></script>
 *   Lalu akses via: KUA.URL.ptsp, KUA.KONTAK.wa, dst.
 *
 * CATATAN: Isi bagian [WAJIB DIISI] sebelum deploy.
 */

const KUA = {

  /* ── URL UTAMA ─────────────────────────────────────── */
  URL: {
    publik : "https://kuapilangkenceng.github.io",
    ptsp   : "https://kuapilangkenceng.github.io/ptsp",

    // Ganti dengan URL deploy Apps Script Anda
    // Format: https://script.google.com/macros/s/XXXX/exec
    api    : "https://script.google.com/macros/s/AKfycbxBz3tHZWX6vWvVmeYoagtSImqrytE_hTyVbCeWh3TlnKB5p1TsntGLD5UlO3Nm5spd/exec",  // [WAJIB DIISI]

    // ID Google Sheets utama (ada di URL spreadsheet)
    sheetsId: "17TPFJ32oaWfqe4zW9uY8bPG1vfs56vOxr9g4DDJV_aY",            // [WAJIB DIISI]
  },

  /* ── PROFIL KUA ─────────────────────────────────────── */
  PROFIL: {
    nama        : "KUA Kecamatan Pilangkenceng",
    namaKecamatan: "Pilangkenceng",
    namaKabupaten: "Kabupaten Madiun",
    namaProvinsi : "Jawa Timur",

    // [WAJIB DIISI] — minta dari Kepala KUA
    namaKepala  : "MOHHAMAD SADIKUL ANAM SH.MSI",
    nipKepala   : "197203112005011001 ",
  },

  /* ── KONTAK ─────────────────────────────────────────── */
  KONTAK: {
    // [WAJIB DIISI] — nomor WA format 628xxx (tanpa +)
    wa       : "6285119505451",
    waLabel  : "085119505451",   // untuk tampilan di UI

    email    : "kuapilangkenceng@gmail.com",                  // opsional
    telepon  : "",                  // opsional

    alamat   : "Jl. Tirtotejo, Ds. Kenongorejo, Pilangkenceng, Kabupaten Madiun, Jawa Timur",
    maps     : "https://maps.app.goo.gl/D3Aygiwns79AT67J8",                  // URL Google Maps (opsional)

    jamKerja : "Senin–Kamis, 07.30–16.00 WIB - Jumat, 07.30-16.30 WIB",
  },

  /* ── DAFTAR LAYANAN (untuk navigasi & CTA) ──────────── */
  LAYANAN: [
    {
      id      : "nikah",
      nama    : "Pencatatan Nikah",
      icon    : "ti-heart",
      deskripsi: "Pendaftaran dan pencatatan pernikahan",
      urlPublik: "/nikah.html",
      urlForm  : "/ptsp/index.html?layanan=nikah",
      aktif    : true,
    },
    {
      id      : "wakaf",
      nama    : "Perwakafan",
      icon    : "ti-building-mosque",
      deskripsi: "Ikrar wakaf dan penggantian nadzir",
      urlPublik: "/layanan/wakaf.html",
      urlForm  : "/ptsp/index.html?layanan=wakaf",
      aktif    : false,   // aktif setelah Fase 7
    },
    {
      id      : "skt",
      nama    : "SKT Masjid/Musholla",
      icon    : "ti-home",
      deskripsi: "Surat keterangan tempat ibadah",
      urlPublik: "/layanan/skt.html",
      urlForm  : "/ptsp/index.html?layanan=skt",
      aktif    : false,
    },
    {
      id      : "halal",
      nama    : "Sertifikasi Halal",
      icon    : "ti-certificate",
      deskripsi: "Sertifikasi produk halal UMKM",
      urlPublik: "/layanan/halal.html",
      urlForm  : "/ptsp/index.html?layanan=halal",
      aktif    : false,
    },
    {
      id      : "kiblat",
      nama    : "Pengukuran Kiblat",
      icon    : "ti-compass",
      deskripsi: "Pengukuran arah kiblat",
      urlPublik: "/layanan/kiblat.html",
      urlForm  : "/ptsp/index.html?layanan=kiblat",
      aktif    : false,
    },
    {
      id      : "konseling",
      nama    : "Konseling Keluarga",
      icon    : "ti-users",
      deskripsi: "Bimbingan dan konseling keluarga sakinah",
      urlPublik: "/layanan/konseling.html",
      urlForm  : "/ptsp/index.html?layanan=konseling",
      aktif    : false,
    },
  ],

  /* ── HELPER FUNCTIONS ───────────────────────────────── */

  /**
   * Buka form PTSP untuk layanan tertentu.
   * Contoh: KUA.daftar('nikah')
   */
  daftar(idLayanan) {
    const l = this.LAYANAN.find(x => x.id === idLayanan);
    if (!l) return;
    window.location.href = this.URL.ptsp + "/index.html?layanan=" + idLayanan;
  },

  /**
   * Buka WhatsApp dengan pesan otomatis.
   * Contoh: KUA.hubungiWA('Saya ingin menanyakan layanan nikah')
   */
  hubungiWA(pesan = "Assalamualaikum, saya ingin bertanya mengenai layanan KUA Pilangkenceng.") {
    const url = "https://wa.me/" + this.KONTAK.wa + "?text=" + encodeURIComponent(pesan);
    window.open(url, "_blank");
  },

  /**
   * Fetch data dari Apps Script dengan penanganan error.
   * Contoh: KUA.fetchAPI({action:'getArtikel'}).then(data => ...)
   */
  async fetchAPI(params = {}) {
    try {
      const query = new URLSearchParams({ ...params, t: Date.now() }).toString();
      const res   = await fetch(this.URL.api + "?" + query);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.error("[KUA.fetchAPI]", err);
      return { status: "error", message: err.message };
    }
  },

  /**
   * Deteksi apakah halaman ini ada di repo publik atau PTSP.
   */
  get isPublik() {
    return !window.location.pathname.startsWith("/ptsp");
  },

  get isPTSP() {
    return window.location.pathname.startsWith("/ptsp");
  },
};

// Buat tersedia secara global
window.KUA = KUA;
Object.freeze(KUA.URL);
