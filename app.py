"""
Kompresin.my.id v2 - Multi-tools Image & PDF Utility
Gampangin file kamu, gratis selamanya.

Struktur:
- /              → Smart homepage (hybrid all-in-one)
- /kompres-foto  → Halaman SEO kompres foto
- /pas-foto      → (coming next)
- /ganti-background → (coming next)
- /kompres-pdf   → (coming next)
"""

import os
import io
import time
import uuid
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_file, after_this_request
from PIL import Image, ImageOps
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Request hard limit.
# UI kamu sekarang:
# - Foto max 10MB
# - Kompres PDF max 20MB
# - Merge PDF max 20MB total
#
# Kita kasih 30MB agar multipart/form-data masih punya sedikit overhead.
app.config['MAX_CONTENT_LENGTH'] = 30 * 1024 * 1024

app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['COMPRESSED_FOLDER'] = 'compressed'

# Batas upload per fitur.
# Dibuat cukup lega, tapi tetap aman untuk VPS kecil.
MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_MERGE_UPLOAD_BYTES = 20 * 1024 * 1024

# File hasil yang tidak didownload akan dibersihkan otomatis.
FILE_TTL_SECONDS = int(os.environ.get('FILE_TTL_SECONDS', 60 * 60))  # default 1 jam
CLEANUP_INTERVAL_SECONDS = int(os.environ.get('CLEANUP_INTERVAL_SECONDS', 5 * 60))  # cek tiap 5 menit

# ============================================================
# FEATURE FLAGS — Monetization Toggle
# ============================================================
ADS_ENABLED = False  # ← MASTER SWITCH: True/False to enable/disable all ads


@app.context_processor
def inject_ads_config():
    """Auto-inject ads_enabled to all templates."""
    return {'ads_enabled': ADS_ENABLED}

# ###########################
ALLOWED_IMAGE_EXT = {'jpg', 'jpeg', 'png', 'webp', 'bmp'}
ALLOWED_PDF_EXT = {'pdf'}

# Format output yang didukung untuk kompresi foto
SUPPORTED_OUTPUT_FORMATS = {'auto', 'jpg', 'png', 'webp'}

# Mapping ke PIL format string
PIL_FORMAT_MAP = {
    'jpg': 'JPEG',
    'jpeg': 'JPEG',
    'png': 'PNG',
    'webp': 'WEBP',
    'bmp': 'BMP',
}

# Mapping ke ekstensi file output
EXT_MAP = {
    'JPEG': 'jpg',
    'PNG': 'png',
    'WEBP': 'webp',
}

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['COMPRESSED_FOLDER'], exist_ok=True)

# ============================================================
# PRODUCTION SAFETY HELPERS
# Tidak menyentuh kualitas kompresi.
# Ini cuma jaga server tetap sehat.
# ============================================================

_last_cleanup_at = 0
_rate_limit_buckets = {}


def remove_quietly(path):
    """Hapus file tanpa bikin request gagal kalau file sudah tidak ada."""
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def cleanup_paths(paths):
    for path in paths:
        remove_quietly(path)


def cleanup_old_files(force=False):
    """
    Bersihkan file upload/hasil lama.

    Penting karena user bisa saja:
    - upload file,
    - proses selesai,
    - tapi tidak klik download.

    Kalau tidak dibersihkan, folder compressed bisa numpuk.
    """
    global _last_cleanup_at

    now = time.time()

    if not force and (now - _last_cleanup_at) < CLEANUP_INTERVAL_SECONDS:
        return

    _last_cleanup_at = now

    folders = [
        app.config['UPLOAD_FOLDER'],
        app.config['COMPRESSED_FOLDER'],
    ]

    for folder in folders:
        try:
            for filename in os.listdir(folder):
                path = os.path.join(folder, filename)

                if not os.path.isfile(path):
                    continue

                file_age = now - os.path.getmtime(path)

                if file_age > FILE_TTL_SECONDS:
                    remove_quietly(path)

        except OSError as e:
            app.logger.warning(f"Cleanup folder gagal: {folder} - {e}")


@app.before_request
def run_light_cleanup():
    """
    Cleanup ringan.
    Tidak benar-benar scan tiap request karena ada interval 5 menit.
    Jadi aman untuk production kecil.
    """
    cleanup_old_files()

@app.after_request
def add_security_headers(response):
    """
    Header keamanan ringan untuk production.
    Tidak mengubah fitur dan tidak mengubah kualitas hasil file.
    """
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'

    return response


def client_ip():
    """
    Ambil IP user.
    Cukup aman untuk setup umum di belakang proxy/Nginx/Cloudflare.
    """
    forwarded = request.headers.get('X-Forwarded-For', '')

    if forwarded:
        return forwarded.split(',')[0].strip()

    return request.remote_addr or 'unknown'


def rate_limit(max_requests, window_seconds):
    """
    Rate limit ringan in-memory.

    Ini cukup untuk VPS kecil 1 proses.
    Kalau nanti sudah multi-server/traffic besar, baru pindah ke Redis.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            now = time.time()
            key = (request.endpoint or func.__name__, client_ip())
            window_start = now - window_seconds

            hits = [
                ts for ts in _rate_limit_buckets.get(key, [])
                if ts > window_start
            ]

            if len(hits) >= max_requests:
                return jsonify({
                    'error': 'Terlalu banyak request dari perangkat ini. Coba lagi sebentar ya.'
                }), 429

            hits.append(now)
            _rate_limit_buckets[key] = hits

            # Bersihkan bucket lama biar dict tidak tumbuh terus.
            if len(_rate_limit_buckets) > 5000:
                for old_key in list(_rate_limit_buckets.keys()):
                    recent_hits = [
                        ts for ts in _rate_limit_buckets[old_key]
                        if ts > window_start
                    ]

                    if recent_hits:
                        _rate_limit_buckets[old_key] = recent_hits
                    else:
                        del _rate_limit_buckets[old_key]

            return func(*args, **kwargs)

        return wrapper

    return decorator


def mb_text(byte_size):
    return f"{byte_size / (1024 * 1024):.0f}MB"


def reject_if_request_too_large(max_bytes, label='File'):
    """
    Cek ukuran request sebelum disimpan.

    Ada toleransi 1MB karena multipart/form-data punya overhead.
    """
    multipart_overhead = 1024 * 1024

    if request.content_length and request.content_length > (max_bytes + multipart_overhead):
        return jsonify({
            'error': f'{label} terlalu besar. Maksimal {mb_text(max_bytes)}.'
        }), 413

    return None


def is_probably_pdf(path):
    """
    Validasi ringan bahwa file benar-benar terlihat seperti PDF,
    bukan cuma nama file .pdf.
    """
    try:
        with open(path, 'rb') as f:
            return f.read(5) == b'%PDF-'
    except OSError:
        return False


def is_real_image(path):
    """
    Validasi ringan bahwa file benar-benar image valid.
    """
    try:
        with Image.open(path) as img:
            img.verify()
        return True
    except Exception:
        return False
    


def allowed_image(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_IMAGE_EXT


def allowed_pdf(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_PDF_EXT


# ============================================================
# CORE FUNCTIONS: Compress image to target size (multi-format)
# ============================================================

def _prepare_image_for_format(img, output_format):
    """
    Convert image mode sesuai target format.
    - JPEG: butuh RGB (gak support alpha), transparansi → white background
    - PNG/WebP: support RGBA, kita preserve alpha channel
    """
    if output_format == 'JPEG':
        if img.mode in ('RGBA', 'LA'):
            # Paste ke white background, hilangkan alpha
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            return background
        elif img.mode == 'P':
            # Palette image (kayak GIF): convert via RGBA dulu
            img = img.convert('RGBA')
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            return background
        elif img.mode != 'RGB':
            return img.convert('RGB')
        return img
    else:
        # PNG dan WebP support RGBA, biar transparency tetep ada
        if img.mode not in ('RGB', 'RGBA'):
            return img.convert('RGBA')
        return img


def _normalize_compression_mode(mode):
    """
    Mode kompresi aman.
    - fast      : lebih cepat, masih dijaga agar tidak terlalu pecah
    - balanced  : default, aman untuk mayoritas user
    - quality   : lebih menjaga detail, bisa lebih besar/lambat
    """
    mode = (mode or 'balanced').lower().strip()

    aliases = {
        'cepat': 'fast',
        'seimbang': 'balanced',
        'kualitas': 'quality',
        'quality_max': 'quality',
        'max': 'quality',
    }

    normalized = aliases.get(mode, mode)
    return normalized if normalized in ('fast', 'balanced', 'quality') else 'balanced'


IMAGE_QUALITY_PROFILES = {
    'fast': {
        'jpeg_min_quality': 55,
        'webp_min_quality': 50,
        'min_long_edge': 850,
        'resize_boost': 0.90,
    },
    'balanced': {
        'jpeg_min_quality': 65,
        'webp_min_quality': 60,
        'min_long_edge': 1000,
        'resize_boost': 1.00,
    },
    'quality': {
        'jpeg_min_quality': 75,
        'webp_min_quality': 70,
        'min_long_edge': 1200,
        'resize_boost': 1.15,
    },
}


def _smart_start_edge(target_kb, output_format='JPEG'):
    """
    Tentukan sisi terpanjang awal berdasarkan target KB.
    Tujuannya: jangan encode foto 4000px berkali-kali kalau targetnya cuma 200KB.
    """
    if output_format == 'PNG':
        # PNG biasanya lebih besar, jadi start edge dibuat lebih konservatif.
        if target_kb <= 150:
            return 1000
        if target_kb <= 300:
            return 1300
        if target_kb <= 600:
            return 1700
        if target_kb <= 1200:
            return 2300
        if target_kb <= 2500:
            return 3200
        return 5000

    # JPEG / WEBP
    if target_kb <= 80:
        return 950
    if target_kb <= 150:
        return 1200
    if target_kb <= 250:
        return 1600
    if target_kb <= 500:
        return 2100
    if target_kb <= 1000:
        return 2800
    if target_kb <= 2000:
        return 3600
    return 5000


def _candidate_long_edges(img, target_kb, output_format, mode):
    """
    Buat daftar ukuran percobaan dari besar ke kecil,
    tapi tidak turun melewati batas aman agar hasil tidak jadi kotak-kotak.
    """
    mode = _normalize_compression_mode(mode)
    profile = IMAGE_QUALITY_PROFILES[mode]

    original_w, original_h = img.size
    original_long_edge = max(original_w, original_h)

    start_edge = int(_smart_start_edge(target_kb, output_format) * profile['resize_boost'])
    start_edge = min(start_edge, original_long_edge)

    floor_edge = min(profile['min_long_edge'], original_long_edge)

    raw_edges = [
        start_edge,
        int(start_edge * 0.90),
        int(start_edge * 0.80),
        int(start_edge * 0.70),
        floor_edge,
    ]

    edges = []
    for edge in raw_edges:
        edge = max(floor_edge, min(edge, original_long_edge))
        if edge not in edges:
            edges.append(edge)

    # Dari besar ke kecil. Begitu target tercapai, kualitas visual biasanya masih bagus.
    edges.sort(reverse=True)
    return edges


def _resize_to_long_edge(img, max_long_edge):
    """Resize proporsional berdasarkan sisi terpanjang. Tidak pernah upscale."""
    w, h = img.size
    long_edge = max(w, h)

    if long_edge <= max_long_edge:
        return img.copy()

    ratio = max_long_edge / long_edge
    new_w = max(1, int(w * ratio))
    new_h = max(1, int(h * ratio))
    return img.resize((new_w, new_h), Image.LANCZOS)


def _save_jpeg_buffer(img, quality, optimize=False):
    buffer = io.BytesIO()
    img.save(
        buffer,
        format='JPEG',
        quality=quality,
        optimize=optimize,
        progressive=False,
    )
    return buffer


def _save_webp_buffer(img, quality, method=4):
    buffer = io.BytesIO()
    img.save(
        buffer,
        format='WEBP',
        quality=quality,
        method=method,
    )
    return buffer


def _save_png_buffer(img, compress_level=6):
    buffer = io.BytesIO()
    img.save(
        buffer,
        format='PNG',
        optimize=True,
        compress_level=compress_level,
    )
    return buffer


def _compress_jpeg(img, target_bytes, output_path, mode='balanced'):
    """
    JPEG anti-Minecraft:
    - Tidak lagi paksa quality 10.
    - Resize cerdas dulu berdasarkan target KB.
    - Quality punya batas bawah agar foto tetap layak dilihat.
    - Kalau target terlalu kecil, hasil terbaik tetap dibuat + warning.
    """
    mode = _normalize_compression_mode(mode)
    profile = IMAGE_QUALITY_PROFILES[mode]
    min_quality = profile['jpeg_min_quality']
    max_quality = 95
    target_kb = target_bytes / 1024

    fallback = None

    for edge in _candidate_long_edges(img, target_kb, 'JPEG', mode):
        test_img = _resize_to_long_edge(img, edge)

        low, high = min_quality, max_quality
        best_quality = None
        best_buffer = None

        while low <= high:
            mid = (low + high) // 2

            # Saat pencarian, jangan pakai optimize/progressive karena lebih berat CPU.
            buffer = _save_jpeg_buffer(test_img, mid, optimize=False)
            size = buffer.tell()

            if size <= target_bytes:
                best_quality = mid
                best_buffer = buffer
                low = mid + 1
            else:
                high = mid - 1

        if best_buffer is not None:
            # Final encode sekali saja dengan optimize=True.
            # Kualitas sama, ukuran bisa sedikit lebih kecil.
            final_buffer = _save_jpeg_buffer(test_img, best_quality, optimize=True)
            with open(output_path, 'wb') as f:
                f.write(final_buffer.getvalue())
            return True, best_quality, None

        # Simpan kandidat fallback: ukuran terkecil di quality minimal yang masih layak.
        min_buffer = _save_jpeg_buffer(test_img, min_quality, optimize=False)
        if fallback is None or min_buffer.tell() < fallback['size']:
            fallback = {
                'img': test_img,
                'quality': min_quality,
                'size': min_buffer.tell(),
            }

    # Target terlalu ekstrem. Jangan hancurkan foto dengan quality 10.
    final_buffer = _save_jpeg_buffer(fallback['img'], fallback['quality'], optimize=True)
    with open(output_path, 'wb') as f:
        f.write(final_buffer.getvalue())

    warning = (
        'Target KB terlalu kecil untuk foto ini tanpa membuat kualitas turun parah. '
        'Kompresin menjaga foto tetap jelas, jadi ukuran hasil bisa sedikit di atas target.'
    )
    return False, fallback['quality'], warning


def _compress_webp(img, target_bytes, output_path, mode='balanced'):
    """
    WebP anti-Minecraft:
    - Tidak lagi fallback quality 10.
    - method=4 dipakai agar lebih cepat di VPS kecil.
    - Quality tetap dijaga dengan batas bawah.
    """
    mode = _normalize_compression_mode(mode)
    profile = IMAGE_QUALITY_PROFILES[mode]
    min_quality = profile['webp_min_quality']
    max_quality = 95
    target_kb = target_bytes / 1024

    fallback = None

    for edge in _candidate_long_edges(img, target_kb, 'WEBP', mode):
        test_img = _resize_to_long_edge(img, edge)

        low, high = min_quality, max_quality
        best_quality = None
        best_buffer = None

        while low <= high:
            mid = (low + high) // 2
            buffer = _save_webp_buffer(test_img, mid, method=4)
            size = buffer.tell()

            if size <= target_bytes:
                best_quality = mid
                best_buffer = buffer
                low = mid + 1
            else:
                high = mid - 1

        if best_buffer is not None:
            with open(output_path, 'wb') as f:
                f.write(best_buffer.getvalue())
            return True, best_quality, None

        min_buffer = _save_webp_buffer(test_img, min_quality, method=4)
        if fallback is None or min_buffer.tell() < fallback['size']:
            fallback = {
                'buffer': min_buffer,
                'quality': min_quality,
                'size': min_buffer.tell(),
            }

    with open(output_path, 'wb') as f:
        f.write(fallback['buffer'].getvalue())

    warning = (
        'Target KB terlalu kecil untuk foto ini tanpa membuat kualitas turun parah. '
        'Kompresin menjaga foto tetap jelas, jadi ukuran hasil bisa sedikit di atas target.'
    )
    return False, fallback['quality'], warning


def _compress_png(img, target_bytes, output_path, mode='balanced'):
    """
    PNG anti-rusak:
    - PNG tidak punya quality seperti JPG/WebP.
    - Tidak lagi otomatis quantize 256 warna karena bisa bikin warna/bagian halus jelek.
    - Kalau target terlalu kecil, hasil dibuat lossless/aman walau bisa di atas target.
    """
    mode = _normalize_compression_mode(mode)
    target_kb = target_bytes / 1024

    fallback = None

    for edge in _candidate_long_edges(img, target_kb, 'PNG', mode):
        test_img = _resize_to_long_edge(img, edge)
        buffer = _save_png_buffer(test_img, compress_level=6)
        size = buffer.tell()

        if size <= target_bytes:
            # Final satu kali dengan compress level 9 agar sedikit lebih kecil.
            final_buffer = _save_png_buffer(test_img, compress_level=9)
            with open(output_path, 'wb') as f:
                f.write(final_buffer.getvalue())
            return True, None, None

        if fallback is None or size < fallback['size']:
            fallback = {
                'img': test_img,
                'size': size,
            }

    final_buffer = _save_png_buffer(fallback['img'], compress_level=9)
    with open(output_path, 'wb') as f:
        f.write(final_buffer.getvalue())

    warning = (
        'PNG sulit dipaksa kecil tanpa mengubah kualitas/warna. '
        'Kompresin menjaga kualitas PNG, jadi ukuran hasil bisa di atas target. '
        'Untuk ukuran lebih kecil, pilih output JPG atau WebP.'
    )
    return False, None, warning


def compress_to_target_size(image_path, target_kb, output_path, output_format='JPEG', compression_mode='balanced'):
    """
    Dispatcher kompres foto anti-Minecraft.

    Returns:
        (on_target: bool, final_size_kb: float, quality: int|None, warning: str|None)
    """
    target_bytes = target_kb * 1024

    with Image.open(image_path) as opened:
        # Biar foto dari HP yang punya EXIF orientation tidak miring.
        img = ImageOps.exif_transpose(opened)
        img = _prepare_image_for_format(img, output_format)

    if output_format == 'JPEG':
        success, quality, warning = _compress_jpeg(img, target_bytes, output_path, compression_mode)
    elif output_format == 'PNG':
        success, quality, warning = _compress_png(img, target_bytes, output_path, compression_mode)
    elif output_format == 'WEBP':
        success, quality, warning = _compress_webp(img, target_bytes, output_path, compression_mode)
    else:
        raise ValueError(f"Unsupported output format: {output_format}")

    final_size_kb = round(os.path.getsize(output_path) / 1024, 2)

    # Dianggap on target kalau masuk toleransi 10%.
    on_target = success and final_size_kb <= target_kb * 1.1
    return on_target, final_size_kb, quality, warning



# ============================================================
# ROUTES: API (JSON)
# Gunanya: nanti server/monitoring bisa cek web hidup atau tidak lewat
# ============================================================
@app.route('/healthz')
def healthz():
    return jsonify({
        'status': 'ok',
        'service': 'kompresin',
    }), 200



# ============================================================
# ROUTES: Pages (HTML)
# ============================================================
@app.route('/')
def index():
    """Smart homepage - hybrid pattern A+B"""
    return render_template('index.html')




@app.route('/pas-foto')
def pas_foto_page():
    """Halaman pas foto - LIVE"""
    return render_template('pas-foto.html')


@app.route('/ganti-background')
def ganti_bg_page():
    """Halaman ganti background - LIVE"""
    return render_template('ganti-background.html')


@app.route('/kompres-pdf')
def kompres_pdf_page():
    """Halaman kompres PDF - LIVE"""
    return render_template('kompres-pdf.html')

@app.route('/merge-pdf')
def merge_pdf_page():
    """Halaman merge PDF - LIVE"""
    return render_template('merge-pdf.html')


# Existing landing pages
@app.route('/cpns')
def cpns_landing():
    return render_template('cpns.html')


@app.route('/lamaran-kerja')
def lamaran_landing():
    return render_template('lamaran.html')

# ============================================================
# BLOG: Pillar content untuk SEO
# ============================================================
import os as _os_blog  # alias biar gak conflict

# Mapping slug ke metadata artikel (gampang nambah artikel baru)
BLOG_ARTICLES = {
    'kompres-foto-cpns': {
        'title': 'Cara Kompres Foto SSCASN CPNS 2026 - Maksimal 200KB Tanpa Aplikasi',
        'description': 'Panduan lengkap kompres foto pasfoto, swafoto, dan dokumen untuk SSCASN CPNS 2026. Sesuai requirement 200KB tanpa aplikasi, gratis & tanpa watermark.',
        'date': '2026-05-01',
        'category': 'CPNS',
        'reading_time': '8 menit',
        'thumbnail': 'cpns-kompres-foto-thumbnail.png',
    },
    'lolos-face-recognition-sscasn': {
        'title': 'Cara Lolos Verifikasi Face Recognition SSCASN CPNS 2026 (Anti TMS)',
        'description': 'Panduan teknis lolos verifikasi face recognition AI di SSCASN. Hindari status TMS dengan tips dari pengalaman pelamar 2025-2026. Apa yg bikin AI nolak foto lo?',
        'date': '2026-05-02',
        'category': 'CPNS',
        'reading_time': '10 menit',
         'thumbnail': 'face-recognition-thumbnail.png',
    },
    'ukuran-foto-ktp-sim-paspor-bpjs': {
        'title': 'Ukuran Foto KTP, SIM, Paspor, BPJS - Panduan Lengkap 2026',
        'description': 'Lengkap! Ukuran foto KTP (3.5x4.5 cm), SIM, paspor, BPJS, dan dokumen Indonesia. Spesifikasi pixel, cm, KB sesuai aturan resmi 2026.',
        'date': '2026-05-03',
        'category': 'Dokumen',
        'reading_time': '7 menit',
        'thumbnail': 'ukuran-foto-dokumen-thumbnail.png',
    },
    'bahaya-data-pribadi-bocor-uu-pdp': {
        'title': 'Bahaya Upload KTP Sembarangan: Mengenal UU PDP dan Keamanan Data',
        'description': 'Panduan mengenai risiko keamanan saat mengunggah dokumen pribadi ke internet, penjelasan UU Perlindungan Data Pribadi, dan cara aman kompres berkas digital.',
        'date': '2026-05-04',
        'category': 'Keamanan',
        'reading_time': '6 menit',
        'thumbnail': 'bahaya-data-KTP-pribadi.jpg',
    },
    # Nanti tambah artikel lain di sini
}


@app.route('/blog')
def blog_index():
    """Halaman list semua artikel."""
    articles = [
        {'slug': slug, **meta}
        for slug, meta in BLOG_ARTICLES.items()
    ]
    articles.sort(key=lambda x: x['date'], reverse=True)
    return render_template('blog/index.html', articles=articles)



@app.route('/blog/<slug>')
def blog_post(slug):
    """Halaman individual artikel."""
    if slug not in BLOG_ARTICLES:
        from flask import abort
        abort(404)  # ← INI: trigger custom 404 page
    
    article = BLOG_ARTICLES[slug]
    template_path = f'blog/{slug}.html'
    return render_template(template_path, article=article, slug=slug)




# ============================================================
# CORE FUNCTION: Pas Foto Maker
# ============================================================
def make_passport_photo(image_path, output_path, size_cm, bg_color_rgb):
    """
    Bikin pas foto:
    - Resize ke ukuran cm yang dipilih (DPI 300)
    - Replace background dengan warna pilihan (manual tolerance-based)
    """
    DPI = 300
    width_cm, height_cm = size_cm
    target_w = int((width_cm / 2.54) * DPI)
    target_h = int((height_cm / 2.54) * DPI)
    
    img = Image.open(image_path).convert('RGBA')
    pixels = img.load()
    corner_color = pixels[5, 5]
    
    new_bg = Image.new('RGB', img.size, bg_color_rgb)
    
    tolerance = 60
    img_rgb = img.convert('RGB')
    pixels_rgb = img_rgb.load()
    new_pixels = new_bg.load()
    
    for y in range(img.height):
        for x in range(img.width):
            pr, pg, pb = pixels_rgb[x, y]
            cr, cg, cb = corner_color[:3]
            if abs(pr - cr) > tolerance or abs(pg - cg) > tolerance or abs(pb - cb) > tolerance:
                new_pixels[x, y] = (pr, pg, pb)
    
    final = new_bg.resize((target_w, target_h), Image.LANCZOS)
    final.save(output_path, format='JPEG', quality=95, dpi=(DPI, DPI))
    
    return target_w, target_h


# Mapping ukuran cm
PASFOTO_SIZES = {
    '2x3': (2, 3),
    '3x4': (3, 4),
    '4x6': (4, 6),
}

# Mapping warna background
PASFOTO_COLORS = {
    'merah': (220, 30, 30),
    'biru': (30, 80, 200),
    'putih': (255, 255, 255),
}


# ============================================================
# CORE FUNCTION: Compress PDF
# ============================================================
def compress_pdf(input_path, output_path, quality='medium'):
    """
    Kompres PDF pake Ghostscript (industry standard, dipake ILovePDF/SmallPDF).
    Quality: 'high' (printer), 'medium' (ebook), 'low' (screen)
    """
    import subprocess
    
    # Ghostscript quality presets (nama di Ghostscript)
    gs_quality_map = {
        'high': '/printer',     # 300 DPI, kualitas printer
        'medium': '/ebook',     # 150 DPI, balanced (recommended)
        'low': '/screen',       # 72 DPI, kompresi maksimal
    }
    pdf_setting = gs_quality_map.get(quality, '/ebook')
    
    original_size = os.path.getsize(input_path)
    
    # Build Ghostscript command
    gs_cmd = [
        'gs',
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        f'-dPDFSETTINGS={pdf_setting}',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        '-dDetectDuplicateImages=true',
        '-dCompressFonts=true',
        '-dSubsetFonts=true',
        f'-sOutputFile={output_path}',
        input_path
    ]
    
    try:
        result = subprocess.run(
            gs_cmd,
            capture_output=True,
            timeout=120,  # max 2 menit per file
            check=True
        )
    except subprocess.TimeoutExpired:
        raise Exception('Proses kompresi terlalu lama, file mungkin terlalu kompleks')
    except subprocess.CalledProcessError as e:
        raise Exception(f'Ghostscript error: {e.stderr.decode()[:200]}')
    except FileNotFoundError:
        raise Exception('Ghostscript belum ke-install di server. Hubungi admin.')
    
    if not os.path.exists(output_path):
        raise Exception('File hasil kompresi tidak terbentuk')
    
    final_size = os.path.getsize(output_path)
    return round(original_size / 1024, 2), round(final_size / 1024, 2)


@app.route('/api/compress-pdf', methods=['POST'])
@rate_limit(max_requests=6, window_seconds=60)
def api_compress_pdf():
    """API kompres PDF."""
    if 'file' not in request.files:
        return jsonify({'error': 'Gak ada file yang diupload'}), 400

    file = request.files['file']
    if file.filename == '' or not allowed_pdf(file.filename):
        return jsonify({'error': 'Pilih file PDF yang valid'}), 400

    quality = request.form.get('quality', 'medium')
    if quality not in ('high', 'medium', 'low'):
        return jsonify({'error': 'Quality gak valid'}), 400

    too_large = reject_if_request_too_large(MAX_PDF_UPLOAD_BYTES, 'PDF')
    if too_large:
        return too_large

    file_id = str(uuid.uuid4())
    upload_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{file_id}.pdf")
    file.save(upload_path)

    if os.path.getsize(upload_path) > MAX_PDF_UPLOAD_BYTES:
        remove_quietly(upload_path)
        return jsonify({
            'error': f'PDF terlalu besar. Maksimal {mb_text(MAX_PDF_UPLOAD_BYTES)}.'
        }), 413

    if not is_probably_pdf(upload_path):
        remove_quietly(upload_path)
        return jsonify({
            'error': 'File ini tidak terbaca sebagai PDF valid.'
        }), 400

    output_filename = f"{file_id}_compressed.pdf"
    output_path = os.path.join(app.config['COMPRESSED_FOLDER'], output_filename)

    try:
        original_kb, final_kb = compress_pdf(upload_path, output_path, quality)
    except Exception as e:
        try:
            os.remove(upload_path)
        except OSError:
            pass
        error_msg = str(e)
        if 'timeout' in error_msg.lower() or 'terlalu lama' in error_msg.lower():
            error_msg = 'PDF lo terlalu kompleks/besar. Coba pilih kualitas "Low" atau split PDF jadi bagian lebih kecil dulu.'
        return jsonify({'error': error_msg}), 500

    try:
        os.remove(upload_path)
    except OSError:
        pass
    
    reduction = round((1 - final_kb / original_kb) * 100, 1) if original_kb > 0 else 0

    return jsonify({
        'success': True,
        'original_size_kb': original_kb,
        'final_size_kb': final_kb,
        'reduction_percent': reduction,
        'quality': quality,
        'download_url': f'/download/{output_filename}'
    })



@app.route('/api/merge-pdf', methods=['POST'])
@rate_limit(max_requests=4, window_seconds=60)
def api_merge_pdf():
    """API gabungin beberapa PDF jadi 1."""
    import pikepdf
    
    files = request.files.getlist('files')
    
    if not files or len(files) < 2:
        return jsonify({'error': 'Minimal 2 file PDF buat di-merge'}), 400
    
    if len(files) > 10:
        return jsonify({'error': 'Max 10 file sekaligus'}), 400

    too_large = reject_if_request_too_large(MAX_MERGE_UPLOAD_BYTES, 'Total PDF')
    if too_large:
        return too_large
    
    # Validate semua file PDF
    for f in files:
        if not allowed_pdf(f.filename):
            return jsonify({'error': f'File "{f.filename}" bukan PDF'}), 400
    
    # Save semua upload
    file_id = str(uuid.uuid4())
    upload_paths = []
    
    total_upload_bytes = 0

    for idx, f in enumerate(files):
        path = os.path.join(app.config['UPLOAD_FOLDER'], f"{file_id}_{idx}.pdf")
        f.save(path)
        upload_paths.append(path)

        total_upload_bytes += os.path.getsize(path)

        if total_upload_bytes > MAX_MERGE_UPLOAD_BYTES:
            cleanup_paths(upload_paths)
            return jsonify({
                'error': f'Total PDF terlalu besar. Maksimal {mb_text(MAX_MERGE_UPLOAD_BYTES)}.'
            }), 413

        if not is_probably_pdf(path):
            cleanup_paths(upload_paths)
            return jsonify({
                'error': f'File "{f.filename}" tidak terbaca sebagai PDF valid.'
            }), 400
    
    output_filename = f"{file_id}_merged.pdf"
    output_path = os.path.join(app.config['COMPRESSED_FOLDER'], output_filename)
    
    try:
        # Open PDF pertama, append yang lain
        merged = pikepdf.Pdf.new()
        for path in upload_paths:
            with pikepdf.open(path) as src:
                merged.pages.extend(src.pages)
        
        merged.save(output_path, compress_streams=True)
        merged.close()
        
        total_pages = sum(len(pikepdf.open(p).pages) for p in upload_paths)
        final_size_kb = round(os.path.getsize(output_path) / 1024, 2)
        
    except Exception as e:
        # Cleanup uploads
        for path in upload_paths:
            try:
                os.remove(path)
            except OSError:
                pass
        return jsonify({'error': f'Gagal merge: {str(e)}'}), 500
    
    # Cleanup uploads (success case)
    for path in upload_paths:
        try:
            os.remove(path)
        except OSError:
            pass
    
    return jsonify({
        'success': True,
        'file_count': len(files),
        'total_pages': total_pages,
        'final_size_kb': final_size_kb,
        'download_url': f'/download/{output_filename}'
    })

# ============================================================
# ROUTES: API Endpoints
# ============================================================
@app.route('/api/compress', methods=['POST'])
@rate_limit(max_requests=20, window_seconds=60)
def api_compress():
    """
    API kompres foto dengan target size KB.
    Mendukung output format: auto (default), jpg, png, webp.
    """
    # === Validasi file upload ===
    if 'file' not in request.files:
        return jsonify({'error': 'Gak ada file yang diupload'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Pilih file dulu bro'}), 400

    if not allowed_image(file.filename):
        return jsonify({'error': 'Format gak didukung. Pake JPG/PNG/WebP ya'}), 400

    # === Validasi target_kb ===
    try:
        target_kb = int(request.form.get('target_kb', 200))
        if target_kb < 10 or target_kb > 5000:
            return jsonify({'error': 'Target size harus antara 10KB - 5000KB'}), 400
    except ValueError:
        return jsonify({'error': 'Target size invalid'}), 400

    # === Validasi output_format ===
    output_format_param = request.form.get('output_format', 'auto').lower()
    if output_format_param not in SUPPORTED_OUTPUT_FORMATS:
        return jsonify({'error': 'Format output gak didukung'}), 400

    too_large = reject_if_request_too_large(MAX_IMAGE_UPLOAD_BYTES, 'Foto')
    if too_large:
        return too_large

    # === Save uploaded file ===
    file_id = str(uuid.uuid4())
    input_ext = file.filename.rsplit('.', 1)[1].lower()
    upload_filename = f"{file_id}.{input_ext}"
    upload_path = os.path.join(app.config['UPLOAD_FOLDER'], upload_filename)
    file.save(upload_path)

    if os.path.getsize(upload_path) > MAX_IMAGE_UPLOAD_BYTES:
        remove_quietly(upload_path)
        return jsonify({
            'error': f'Foto terlalu besar. Maksimal {mb_text(MAX_IMAGE_UPLOAD_BYTES)}.'
        }), 413

    if not is_real_image(upload_path):
        remove_quietly(upload_path)
        return jsonify({
            'error': 'File ini tidak terbaca sebagai gambar valid.'
        }), 400

    original_size_kb = round(os.path.getsize(upload_path) / 1024, 2)

    # === Tentuin format output final ===
    if output_format_param == 'auto':
        # Auto: match format input (default behavior)
        # BMP gak ideal sebagai output, fallback ke JPEG
        if input_ext == 'bmp':
            pil_format = 'JPEG'
        else:
            pil_format = PIL_FORMAT_MAP.get(input_ext, 'JPEG')
    else:
        pil_format = PIL_FORMAT_MAP[output_format_param]

    output_ext = EXT_MAP[pil_format]
    output_filename = f"{file_id}_compressed.{output_ext}"
    output_path = os.path.join(app.config['COMPRESSED_FOLDER'], output_filename)

    # === Mode kompresi ===
    # Untuk sekarang default balanced.
    # Nanti kalau mau, ini bisa dibuat dropdown: fast / balanced / quality.
    compression_mode = request.form.get('compression_mode', 'balanced')

    # === Eksekusi kompresi ===
    try:
        success, final_size_kb, quality, warning = compress_to_target_size(
            upload_path,
            target_kb,
            output_path,
            pil_format,
            compression_mode
        )
    except Exception as e:
        # Cleanup uploaded file kalo gagal
        try:
            os.remove(upload_path)
        except OSError:
            pass
        app.logger.error(f"Compression failed for {file.filename}: {e}")
        return jsonify({'error': 'Gagal kompres file. Coba file lain atau format berbeda.'}), 500

    # === Cleanup uploaded file ===
    try:
        os.remove(upload_path)
    except OSError:
        pass

    # === Build response ===
    reduction_percent = (
        round((1 - final_size_kb / original_size_kb) * 100, 1)
        if original_size_kb > 0 else 0
    )

    return jsonify({
        'success': True,
        'original_size_kb': original_size_kb,
        'final_size_kb': final_size_kb,
        'target_kb': target_kb,
        'quality_used': quality,  # Bisa None untuk PNG
        'output_format': output_ext,
        'reduction_percent': reduction_percent,
        'download_url': f'/download/{output_filename}',
        'on_target': success,
        'compression_mode': compression_mode,
        'warning': warning
    })


@app.route('/api/detect-file', methods=['POST'])
def api_detect_file():
    """Smart detect: file upload tipe apa, kasih opsi yg relevan."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    
    file = request.files['file']
    filename = file.filename.lower()
    
    if allowed_image(filename):
        return jsonify({
            'type': 'image',
            'options': [
                {'id': 'compress', 'label': 'Kecilin Ukuran', 'desc': 'Sesuai target KB', 'route': '/kompres-foto'},
                {'id': 'background', 'label': 'Ganti Background', 'desc': 'Pilih warna baru', 'route': '/ganti-background'},
                {'id': 'pasfoto', 'label': 'Bikin Pas Foto', 'desc': 'Ukuran 2x3, 3x4, 4x6', 'route': '/pas-foto'},
            ]
        })
    elif allowed_pdf(filename):
        return jsonify({
            'type': 'pdf',
            'options': [
                {'id': 'compress', 'label': 'Kecilin Ukuran PDF', 'desc': 'Tetap bisa dibaca', 'route': '/kompres-pdf'},
            ]
        })
    else:
        return jsonify({'error': 'Format file gak didukung'}), 400



@app.route('/download/<filename>')
def download(filename):
    safe_name = secure_filename(filename)
    file_path = os.path.join(app.config['COMPRESSED_FOLDER'], safe_name)
    
    if not os.path.exists(file_path):
        return "File gak ditemukan atau udah expired", 404

    # JURUS PENGHANCUR DATA OTOMATIS (UU PDP COMPLIANT)
    @after_this_request
    def remove_file(response):
        try:
            os.remove(file_path)
        except Exception as e:
            app.logger.error(f"Gagal menghapus file {file_path}: {e}")
        return response

    return send_file(file_path, as_attachment=True, download_name=f"kompresin_{safe_name}")


# ============================================================
# SEO: Sitemap & Robots
# ============================================================
@app.route('/sitemap.xml')
def sitemap():
    pages = [
        {'loc': 'https://kompresin.my.id/', 'priority': '1.0', 'changefreq': 'weekly'},
        {'loc': 'https://kompresin.my.id/pas-foto', 'priority': '0.9', 'changefreq': 'weekly'},
        {'loc': 'https://kompresin.my.id/ganti-background', 'priority': '0.9', 'changefreq': 'weekly'},
        {'loc': 'https://kompresin.my.id/kompres-pdf', 'priority': '0.9', 'changefreq': 'weekly'},
        {'loc': 'https://kompresin.my.id/merge-pdf', 'priority': '0.9', 'changefreq': 'weekly'},
        {'loc': 'https://kompresin.my.id/blog', 'priority': '0.8', 'changefreq': 'weekly'},
        {'loc': 'https://kompresin.my.id/blog/kompres-foto-cpns', 'priority': '0.9', 'changefreq': 'monthly'},
        {'loc': 'https://kompresin.my.id/blog/lolos-face-recognition-sscasn', 'priority': '0.9', 'changefreq': 'monthly'},
        {'loc': 'https://kompresin.my.id/blog/ukuran-foto-ktp-sim-paspor-bpjs', 'priority': '0.9', 'changefreq': 'monthly'},
        {'loc': 'https://kompresin.my.id/blog/bahaya-data-pribadi-bocor-uu-pdp', 'priority': '0.9', 'changefreq': 'monthly'},
        {'loc': 'https://kompresin.my.id/cpns', 'priority': '0.8', 'changefreq': 'monthly'},
        {'loc': 'https://kompresin.my.id/lamaran-kerja', 'priority': '0.8', 'changefreq': 'monthly'},
    ]
    
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for page in pages:
        xml += f'  <url>\n    <loc>{page["loc"]}</loc>\n'
        xml += f'    <changefreq>{page["changefreq"]}</changefreq>\n'
        xml += f'    <priority>{page["priority"]}</priority>\n  </url>\n'
    xml += '</urlset>'
    return xml, 200, {'Content-Type': 'application/xml'}


@app.route('/robots.txt')
def robots():
    content = "User-agent: *\nAllow: /\n\nSitemap: https://kompresin.my.id/sitemap.xml\n"
    return content, 200, {'Content-Type': 'text/plain'}


@app.errorhandler(413)
def too_large(e):
    return jsonify({
        'error': 'File terlalu besar. Batas server saat ini 30MB per request.'
    }), 413


# ============================================================
# Error Handler
# ============================================================
@app.errorhandler(404)
def page_not_found(e):
    """Custom 404 page."""
    return render_template('404.html'), 404


if __name__ == '__main__':
    debug_mode = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=debug_mode)
