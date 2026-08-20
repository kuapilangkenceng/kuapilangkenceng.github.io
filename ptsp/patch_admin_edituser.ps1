# patch_admin_edituser.ps1
# Terapkan patch "Edit User (Nama/Role/Username) + Izin Hapus Layanan" ke admin.html
# Aman untuk CRLF - baca/tulis sebagai UTF-8 tanpa BOM, replace exact-string, verifikasi tiap step.

$ErrorActionPreference = "Stop"

# ==== SESUAIKAN PATH INI kalau perlu =======================================
$targetFile = "admin.html"
$pairsFile  = "admin_patch_pairs_v2.json"
# ============================================================================

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: File '$targetFile' tidak ditemukan di folder ini." -ForegroundColor Red
    Write-Host "Jalankan script ini dari folder yang berisi admin.html, atau edit variabel targetFile di atas." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $pairsFile)) {
    Write-Host "ERROR: File '$pairsFile' tidak ditemukan di folder ini." -ForegroundColor Red
    exit 1
}

# Backup dulu
$backupFile = "admin.html.bak_" + (Get-Date -Format "yyyyMMdd_HHmmss")
Copy-Item $targetFile $backupFile
Write-Host "Backup dibuat: $backupFile" -ForegroundColor Cyan

# Baca file target sebagai teks UTF-8 (byte-safe, CRLF tetap apa adanya)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText((Resolve-Path $targetFile), $utf8NoBom)

# Baca pasangan patch
$pairsJson = [System.IO.File]::ReadAllText((Resolve-Path $pairsFile), $utf8NoBom)
$pairs = $pairsJson | ConvertFrom-Json

$stepNum = 0
$totalPairs = $pairs.Count

foreach ($pair in $pairs) {
    $stepNum++
    $old = $pair.old
    $new = $pair.new
    $desc = $pair.description

    $count = ([regex]::Matches($content, [regex]::Escape($old))).Count

    if ($count -eq 0) {
        Write-Host "[$stepNum/$totalPairs] GAGAL: $desc" -ForegroundColor Red
        Write-Host "  -> old_str TIDAK ditemukan. Kemungkinan file sudah berubah dari versi yang saya proses." -ForegroundColor Red
        Write-Host "  -> Restore backup dan minta saya cek ulang file live sebelum lanjut." -ForegroundColor Yellow
        exit 1
    }
    if ($count -gt 1) {
        Write-Host "[$stepNum/$totalPairs] GAGAL: $desc" -ForegroundColor Red
        Write-Host "  -> old_str muncul $count kali (harus tepat 1). Patch dibatalkan demi keamanan." -ForegroundColor Red
        exit 1
    }

    $content = $content.Replace($old, $new)
    Write-Host "[$stepNum/$totalPairs] OK: $desc" -ForegroundColor Green
}

[System.IO.File]::WriteAllText((Resolve-Path $targetFile), $content, $utf8NoBom)
Write-Host ""
Write-Host "SELESAI - $totalPairs patch berhasil diterapkan ke $targetFile" -ForegroundColor Green
Write-Host "Backup ada di: $backupFile (hapus manual kalau sudah yakin hasilnya benar)" -ForegroundColor Cyan
