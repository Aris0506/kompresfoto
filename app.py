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
import uuid
from flask import Flask, render_template, request, jsonify, send_file, after_this_request
from PIL import Image
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max upload (buat PDF gede)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['COMPRESSED_FOLDER'] = 'compressed'


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


def _compress_jpeg(img, target_bytes, output_path):
    """
    JPEG compression: binary search quality + adaptive resize.
    Quality range: 10-95 (di bawah 10 noise terlalu parah).
    """
    original_width, original_height = img.size

    for resize_factor in [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]:
        if resize_factor < 1.0:
            new_size = (int(original_width * resize_factor), int(original_height * resize_factor))
            test_img = img.resize(new_size, Image.LANCZOS)
        else:
            test_img = img

        low, high = 10, 95
        best_buffer = None
        best_quality = None

        while low <= high:
            mid = (low + high) // 2
            buffer = io.BytesIO()
            test_img.save(buffer, format='JPEG', quality=mid, optimize=True, progressive=True)
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
            return True, best_quality

    # Fallback: aggressive resize + minimum quality
    fallback_img = img.resize((int(original_width * 0.25), int(original_height * 0.25)), Image.LANCZOS)
    fallback_img.save(output_path, format='JPEG', quality=10, optimize=True)
    return False, 10


def _compress_png(img, target_bytes, output_path):
    """
    PNG compression: PNG itu lossless, jadi strategi utama = RESIZE.
    Kita gak punya 'quality' parameter, cuma compress_level (0-9, ngaruh sedikit).
    
    Strategy:
    1. Coba dengan max compression dulu (compress_level=9)
    2. Kalo masih kegedean, resize bertahap
    3. Last resort: aggressive resize + quantize ke palette mode (256 colors)
    """
    original_width, original_height = img.size

    for resize_factor in [1.0, 0.85, 0.7, 0.55, 0.4, 0.3]:
        if resize_factor < 1.0:
            new_size = (int(original_width * resize_factor), int(original_height * resize_factor))
            test_img = img.resize(new_size, Image.LANCZOS)
        else:
            test_img = img

        # Try max compression
        buffer = io.BytesIO()
        test_img.save(buffer, format='PNG', optimize=True, compress_level=9)
        size = buffer.tell()

        if size <= target_bytes:
            with open(output_path, 'wb') as f:
                f.write(buffer.getvalue())
            return True, None  # PNG gak punya 'quality', return None

    # Last resort: quantize ke 256 colors (palette mode) + small resize
    fallback_img = img.resize((int(original_width * 0.4), int(original_height * 0.4)), Image.LANCZOS)
    if fallback_img.mode == 'RGBA':
        fallback_img = fallback_img.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
    else:
        fallback_img = fallback_img.convert('P', palette=Image.ADAPTIVE, colors=256)
    fallback_img.save(output_path, format='PNG', optimize=True, compress_level=9)
    return False, None


def _compress_webp(img, target_bytes, output_path):
    """
    WebP compression: mirip JPEG, ada quality parameter (1-100).
    WebP biasanya lebih efisien 25-35% dibanding JPEG di kualitas yang sama.
    """
    original_width, original_height = img.size

    for resize_factor in [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]:
        if resize_factor < 1.0:
            new_size = (int(original_width * resize_factor), int(original_height * resize_factor))
            test_img = img.resize(new_size, Image.LANCZOS)
        else:
            test_img = img

        low, high = 10, 95
        best_buffer = None
        best_quality = None

        while low <= high:
            mid = (low + high) // 2
            buffer = io.BytesIO()
            test_img.save(buffer, format='WEBP', quality=mid, method=6)
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
            return True, best_quality

    # Fallback: aggressive resize + min quality
    fallback_img = img.resize((int(original_width * 0.25), int(original_height * 0.25)), Image.LANCZOS)
    fallback_img.save(output_path, format='WEBP', quality=10, method=6)
    return False, 10


def compress_to_target_size(image_path, target_kb, output_path, output_format='JPEG'):
    """
    Dispatcher: route ke compressor sesuai format output.
    
    Args:
        image_path: path ke file input
        target_kb: target size dalam KB
        output_path: path output
        output_format: 'JPEG', 'PNG', atau 'WEBP'
    
    Returns:
        (success: bool, final_size_kb: float, quality: int|None)
    """
    target_bytes = target_kb * 1024
    img = Image.open(image_path)
    img = _prepare_image_for_format(img, output_format)

    # Route ke compressor yang sesuai
    if output_format == 'JPEG':
        success, quality = _compress_jpeg(img, target_bytes, output_path)
    elif output_format == 'PNG':
        success, quality = _compress_png(img, target_bytes, output_path)
    elif output_format == 'WEBP':
        success, quality = _compress_webp(img, target_bytes, output_path)
    else:
        raise ValueError(f"Unsupported output format: {output_format}")

    final_size_kb = round(os.path.getsize(output_path) / 1024, 2)

    # Considered "on target" kalo dalam 10% toleransi (PNG khususnya susah hit exact)
    on_target = final_size_kb <= target_kb * 1.1
    return on_target, final_size_kb, quality


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
    """Halaman ganti background (Phase 3 - coming soon placeholder)"""
    return render_template('tool_coming_soon.html', tool_name='Ganti Background Foto', tool_slug='ganti-background')



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

    file_id = str(uuid.uuid4())
    upload_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{file_id}.pdf")
    file.save(upload_path)

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
def api_merge_pdf():
    """API gabungin beberapa PDF jadi 1."""
    import pikepdf
    
    files = request.files.getlist('files')
    
    if not files or len(files) < 2:
        return jsonify({'error': 'Minimal 2 file PDF buat di-merge'}), 400
    
    if len(files) > 10:
        return jsonify({'error': 'Max 10 file sekaligus'}), 400
    
    # Validate semua file PDF
    for f in files:
        if not allowed_pdf(f.filename):
            return jsonify({'error': f'File "{f.filename}" bukan PDF'}), 400
    
    # Save semua upload
    file_id = str(uuid.uuid4())
    upload_paths = []
    
    for idx, f in enumerate(files):
        path = os.path.join(app.config['UPLOAD_FOLDER'], f"{file_id}_{idx}.pdf")
        f.save(path)
        upload_paths.append(path)
    
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

    # === Save uploaded file ===
    file_id = str(uuid.uuid4())
    input_ext = file.filename.rsplit('.', 1)[1].lower()
    upload_filename = f"{file_id}.{input_ext}"
    upload_path = os.path.join(app.config['UPLOAD_FOLDER'], upload_filename)
    file.save(upload_path)

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

    # === Eksekusi kompresi ===
    try:
        success, final_size_kb, quality = compress_to_target_size(
            upload_path, target_kb, output_path, pil_format
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
        'quality_used': quality,  # Bisa None untuk PNG (lossless)
        'output_format': output_ext,  # NEW: format hasil ('jpg', 'png', 'webp')
        'reduction_percent': reduction_percent,
        'download_url': f'/download/{output_filename}',
        'on_target': success  # Pakai flag dari compressor (lebih akurat)
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
    return jsonify({'error': 'File kegedean (max 5MB)'}), 413


# ============================================================
# Error Handler
# ============================================================
@app.errorhandler(404)
def page_not_found(e):
    """Custom 404 page."""
    return render_template('404.html'), 404


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port, use_reloader=False)
