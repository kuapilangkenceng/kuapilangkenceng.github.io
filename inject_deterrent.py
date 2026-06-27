#!/usr/bin/env python3
"""
inject_deterrent.py
=====================================================
Script otomatis: menyisipkan security deterrent script
ke semua halaman publik KUA Pilangkenceng.

CARA PAKAI:
  1. Letakkan file ini di dalam folder repo:
     kuapilangkenceng.github.io/  ← taruh di sini
     inject_deterrent.py          ← file ini

  2. Jalankan:
     python inject_deterrent.py

  3. Script akan:
     ✅ Backup file asli (.bak) sebelum mengubah
     ✅ Sisipkan deterrent script sebelum </body>
     ✅ Skip file yang sudah mengandung script
     ✅ Skip admin.html (petugas butuh DevTools)
     ✅ Tampilkan laporan hasil

  4. Push ke GitHub:
     git add -A
     git commit -m "security: tambah deterrent script ke semua halaman publik"
     git push
=====================================================
"""

import os
import shutil
import re
from pathlib import Path
from datetime import datetime

# ── KONFIGURASI ───────────────────────────────────────────
# Folder repo (relatif dari lokasi script ini)
REPO_DIR = Path(__file__).parent

# File target (relatif dari REPO_DIR)
# admin.html dan post-artikel.html DIKECUALIKAN (petugas butuh DevTools)
TARGET_FILES = [
    # Halaman publik utama
    "index.html",
    "profil.html",
    "artikel.html",
    "galeri.html",
    "layanan-nikah.html",
    "layanan-wakaf.html",
    "layanan-kiblat.html",
    "layanan-konseling.html",
    # Halaman PTSP publik
    "ptsp/index.html",
    "ptsp/nikah.html",
    "ptsp/wakaf.html",
    "ptsp/kiblat.html",
    "ptsp/konseling.html",
    "ptsp/konsultasi-umum.html",
    "ptsp/skt.html",
    "ptsp/ecoteology.html",
    # Galeri upload boleh dikecualikan, tapi tetap tambahkan deterrent
    # "ptsp/galeri-upload.html",  # ← uncomment jika ingin disertakan
]

# Marker: digunakan untuk deteksi apakah sudah di-inject
MARKER = "<!-- KUA-SECURITY-DETERRENT -->"

# Script yang akan disisipkan sebelum </body>
DETERRENT_SCRIPT = f"""
{MARKER}
<script>
(function() {{
  'use strict';

  // 1. Blokir klik kanan
  document.addEventListener('contextmenu', function(e) {{
    e.preventDefault();
    return false;
  }});

  // 2. Blokir shortcut keyboard (Ctrl+U, Ctrl+S, Ctrl+A, F12, Ctrl+Shift+I/J/C)
  document.addEventListener('keydown', function(e) {{
    var key = e.key ? e.key.toLowerCase() : '';
    if (e.ctrlKey && ['u', 's', 'a'].indexOf(key) !== -1) {{
      e.preventDefault();
      return false;
    }}
    if (e.key === 'F12') {{
      e.preventDefault();
      return false;
    }}
    if (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].indexOf(key) !== -1) {{
      e.preventDefault();
      return false;
    }}
  }});

  // 3. Blokir drag & drop konten
  document.addEventListener('dragstart', function(e) {{
    e.preventDefault();
    return false;
  }});

  // 4. Watermark di console
  if (window.console && window.console.log) {{
    console.log(
      '%c\\u26d4 Konten website ini milik KUA Kecamatan Pilangkenceng.\\n%cPenyalinan tanpa izin melanggar hak cipta.\\nKepentingan resmi: kuapilangkenceng@gmail.com',
      'color:#c0392b;font-size:18px;font-weight:bold;',
      'color:#555;font-size:13px;'
    );
  }}

  // 5. DevTools detection (deterrent, bukan blokir penuh)
  var devOpen = false;
  var checkDevTools = function() {{
    var wDiff = window.outerWidth  - window.innerWidth;
    var hDiff = window.outerHeight - window.innerHeight;
    if ((wDiff > 200 || hDiff > 200) && !devOpen) {{
      devOpen = true;
      console.warn('\\u26a0\\ufe0f KUA Pilangkenceng: Konten ini dilindungi. Penggunaan tanpa izin dilarang.');
    }} else if (wDiff <= 200 && hDiff <= 200) {{
      devOpen = false;
    }}
  }};
  setInterval(checkDevTools, 2000);

}})();
</script>
<!-- END KUA-SECURITY-DETERRENT -->"""

# ── FUNGSI UTAMA ──────────────────────────────────────────

def inject_file(filepath: Path) -> str:
    """
    Sisipkan deterrent script ke file HTML.
    Return: 'injected' | 'skipped_already' | 'skipped_no_body' | 'error'
    """
    try:
        content = filepath.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        # Coba dengan encoding lain
        try:
            content = filepath.read_text(encoding='latin-1')
        except Exception as ex:
            return f'error: {ex}'

    # Skip jika sudah di-inject
    if MARKER in content:
        return 'skipped_already'

    # Cari posisi </body> (case-insensitive)
    match = re.search(r'</body>', content, re.IGNORECASE)
    if not match:
        return 'skipped_no_body'

    # Backup file asli
    backup_path = filepath.with_suffix(filepath.suffix + '.bak')
    shutil.copy2(filepath, backup_path)

    # Sisipkan script sebelum </body>
    insert_pos = match.start()
    new_content = content[:insert_pos] + DETERRENT_SCRIPT + '\n' + content[insert_pos:]

    filepath.write_text(new_content, encoding='utf-8')
    return 'injected'


def run():
    print("=" * 55)
    print("  INJECT DETERRENT SCRIPT — KUA Pilangkenceng")
    print(f"  {datetime.now().strftime('%d %b %Y, %H:%M:%S')}")
    print("=" * 55)
    print(f"  Repo: {REPO_DIR.resolve()}\n")

    results = {'injected': [], 'skipped_already': [], 'skipped_no_body': [], 'error': []}

    for rel_path in TARGET_FILES:
        filepath = REPO_DIR / rel_path
        if not filepath.exists():
            results['error'].append((rel_path, 'file tidak ditemukan'))
            continue

        status = inject_file(filepath)
        if status == 'injected':
            results['injected'].append(rel_path)
        elif status == 'skipped_already':
            results['skipped_already'].append(rel_path)
        elif status == 'skipped_no_body':
            results['skipped_no_body'].append(rel_path)
        else:
            results['error'].append((rel_path, status))

    # ── Laporan ──────────────────────────────────────────
    print(f"✅ BERHASIL di-inject ({len(results['injected'])} file):")
    for f in results['injected']:
        print(f"     {f}  (backup: {f}.bak)")

    if results['skipped_already']:
        print(f"\n⏭️  Sudah di-inject sebelumnya ({len(results['skipped_already'])} file):")
        for f in results['skipped_already']:
            print(f"     {f}")

    if results['skipped_no_body']:
        print(f"\n⚠️  Tag </body> tidak ditemukan ({len(results['skipped_no_body'])} file):")
        for f in results['skipped_no_body']:
            print(f"     {f}")

    if results['error']:
        print(f"\n❌ ERROR ({len(results['error'])} file):")
        for f, msg in results['error']:
            print(f"     {f} — {msg}")

    print("\n" + "=" * 55)
    total_ok = len(results['injected'])
    if total_ok > 0:
        print(f"  Selesai! {total_ok} file diperbarui.")
        print()
        print("  Langkah selanjutnya:")
        print("    git add -A")
        print('    git commit -m "security: tambah deterrent script"')
        print("    git push")
    else:
        print("  Tidak ada file yang diubah.")
    print("=" * 55)


if __name__ == '__main__':
    run()
