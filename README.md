# Kompresin.my.id

Kompresin.my.id adalah aplikasi web berbasis Flask untuk kompresi file dan pengolahan gambar/PDF secara praktis. Aplikasi ini menyediakan fitur kompres foto, kompres PDF, merge PDF, Pas Foto AI, dan Ganti Background AI.

## Fitur Utama

- Kompres Foto JPG, PNG, dan WebP.
- Mode kompresi foto: Cepat, Seimbang, dan Kualitas Max.
- Kompres PDF menggunakan Ghostscript.
- Gabung/Merge beberapa file PDF.
- Pas Foto AI berbasis browser.
- Ganti Background AI berbasis browser.
- Export hasil background ke JPG atau PNG transparan.
- Manual refine untuk Ganti Background:
  - Auto Blok Objek
  - Brush Hapus
  - Brush Pulihkan
  - Lasso Hapus
  - Lasso Pertahankan
  - Undo
  - Reset ke hasil AI

## Teknologi

- Python
- Flask
- Pillow
- Ghostscript
- pikepdf
- Gunicorn
- Bootstrap
- JavaScript
- Transformers.js
- Model AI browser-side: `briaai/RMBG-1.4`

## Catatan Privasi

Fitur AI seperti Pas Foto AI dan Ganti Background AI berjalan di browser pengguna. Foto tidak dikirim ke server untuk proses AI.

Fitur kompres foto, kompres PDF, dan merge PDF menggunakan server untuk memproses file. File hasil proses dibersihkan otomatis secara berkala.

## Struktur Folder

```txt
kompresin/
├── app.py
├── requirements.txt
├── apt.txt
├── Procfile
├── static/
│   ├── js/
│   ├── css/
│   └── images/
├── templates/
├── uploads/
├── compressed/
└── README.md
```

Folder berikut tidak boleh ikut masuk Git:

```txt
venv/
__pycache__/
uploads/
compressed/
.env
```

## Instalasi Lokal

Clone repository:

```bash
git clone <repo-url>
cd kompresin
```

Buat virtual environment:

```bash
python -m venv venv
```

Aktifkan virtual environment:

Windows:

```bash
venv\Scripts\activate
```

Linux/macOS:

```bash
source venv/bin/activate
```

Install dependency:

```bash
pip install -r requirements.txt
```

Jalankan aplikasi:

```bash
python app.py
```

Akses di browser:

```txt
http://localhost:5000
```

## Dependency Sistem

Aplikasi membutuhkan Ghostscript untuk fitur kompres PDF.

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install ghostscript
```

Di platform deployment yang mendukung `apt.txt`, dependency sistem didefinisikan di:

```txt
apt.txt
```

## Environment Variable

Contoh `.env` atau environment server:

```env
FLASK_DEBUG=0
FILE_TTL_SECONDS=3600
CLEANUP_INTERVAL_SECONDS=300
```

Jangan commit file `.env` ke repository.

## Batas Upload

Batas upload yang digunakan aplikasi:

```txt
Foto: 10MB
PDF Compress: 20MB
Merge PDF: 20MB total
Request server: 30MB
```

Jika memakai Nginx, pastikan `client_max_body_size` disesuaikan, misalnya:

```nginx
client_max_body_size 30M;
```

## Menjalankan di Production

Contoh menggunakan Gunicorn:

```bash
gunicorn --worker-class gthread --workers 1 --threads 4 --timeout 180 --bind 127.0.0.1:8000 app:app
```

Contoh restart service di server:

```bash
sudo systemctl restart kompresin
sudo systemctl status kompresin --no-pager
```

Melihat log:

```bash
sudo journalctl -u kompresin -n 100 --no-pager
```

Live log:

```bash
sudo journalctl -u kompresin -f
```

## Health Check

Endpoint health check:

```txt
/healthz
```

Contoh:

```bash
curl https://kompresin.my.id/healthz
```

Response normal:

```json
{
  "status": "ok",
  "service": "kompresin"
}
```

## Catatan Ganti Background AI

Fitur Ganti Background AI menggunakan model AI di browser. Pada penggunaan pertama, browser akan mengunduh model AI terlebih dahulu. Setelah itu, model biasanya tersimpan di cache browser.

Untuk menjaga performa, gambar besar akan dioptimalkan sebelum diproses agar browser tidak terlalu berat.

Manual refine tersedia untuk membantu memperbaiki hasil AI pada kasus sulit, seperti background ramai, rambut detail, atau pose full body.

## Deployment Singkat

Di lokal:

```bash
git status
git add .
git commit -m "Update project"
git push origin main
```

Di server:

```bash
cd /var/www/kompresin
git pull origin main
sudo systemctl restart kompresin
sudo systemctl status kompresin --no-pager
```

README tidak membutuhkan restart service, kecuali ada perubahan kode aplikasi lain yang ikut dideploy.

## Status Project

Kompresin.my.id sudah berjalan di production dan dapat digunakan untuk kebutuhan kompresi gambar, PDF, serta fitur AI berbasis browser.
