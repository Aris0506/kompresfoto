# KompresFoto.id 🖼️

Web app gratis buat kompres foto sesuai target ukuran KB. MVP siap pakai.

## Fitur

- ✅ Kompres foto JPG/PNG/WebP/BMP ke target size spesifik (KB)
- ✅ Binary search algorithm — cari quality terbaik yang masih di bawah target
- ✅ Auto-resize kalau quality minimum masih kegedean
- ✅ Drag & drop upload
- ✅ Preset cepat (100/200/500/1000 KB)
- ✅ Landing page khusus CPNS & Lamaran Kerja (buat SEO long-tail)
- ✅ Slot iklan strategis (setelah hasil keluar — gak ganggu UX)

## Cara Jalanin Lokal

```bash
cd kompresfoto
python -m venv venv
source venv/bin/activate  # Mac/Linux
# atau: venv\Scripts\activate  # Windows

pip install -r requirements.txt
python app.py
```

Buka `http://localhost:5000` di browser.

## Deploy ke Production

### Option 1: Railway (paling gampang)
```bash
# Install Railway CLI, login, deploy
railway init
railway up
```

### Option 2: VPS (Hetzner/Contabo, ~€5/bulan)
```bash
# Di server
gunicorn -w 4 -b 0.0.0.0:8000 app:app
# Pasang nginx reverse proxy + Cloudflare di depannya
```

### ⚠️ Yang harus diingat di production:
1. **Cleanup file otomatis** — tambah cron job hapus file di `/compressed` yang lebih lama dari 1 jam
2. **Set `debug=False`** di app.py
3. **Pake gunicorn** dengan `-w 4` (4 worker) minimal
4. **HTTPS wajib** — pake Cloudflare gratis
5. **Rate limiting** — tambah Flask-Limiter biar gak diabuse

## Strategi Monetize

### Tahap 1 (0-1000 visitor/hari): Adsterra/PropellerAds
Daftar di [adsterra.com](https://adsterra.com), approve cepat (1-2 hari).
Pasang script di `index.html` di slot `#adSlotResult` (yang udah disiapin).

### Tahap 2 (1000+ visitor/hari): Daftar Google AdSense
Uncomment line `<!-- AdSense placeholder -->` di `index.html` setelah approve.

### Tahap 3 (10k+ visitor/hari): Migrasi ke Ezoic/Mediavine
CPM 3-5x lebih tinggi dari AdSense.

### Bonus revenue:
- Tombol "Saweria saya" di footer (Saweria/Trakteer)
- Affiliate link ke template CV / kelas online di landing CPNS

## Roadmap Tools Berikutnya (1 domain, multi tools)

```
kompresfoto.id/          → Kompres foto (DONE)
kompresfoto.id/pasfoto   → Pas foto maker 3x4, 4x6
kompresfoto.id/pdf       → Kompres PDF
kompresfoto.id/converter → HEIC to JPG converter
```

Nambah tools = nambah keyword ranking = nambah traffic = nambah revenue.

## SEO Quick Wins

1. Domain pake exact match keyword (`kompresfoto.id` atau `kompresgambar.com`)
2. Bikin artikel blog: "Cara Kompres Foto untuk SSCASN 2026", "Ukuran Foto LinkedIn Terbaik 2026"
3. Schema markup FAQ (udah disiapin di template, tinggal di-extend ke JSON-LD)
4. Submit ke Google Search Console hari pertama deploy
5. Backlink dari forum (Kaskus thread CPNS, grup Facebook lamaran kerja)
