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
from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max upload (buat PDF gede)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['COMPRESSED_FOLDER'] = 'compressed'

ALLOWED_IMAGE_EXT = {'jpg', 'jpeg', 'png', 'webp', 'bmp'}
ALLOWED_PDF_EXT = {'pdf'}

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['COMPRESSED_FOLDER'], exist_ok=True)


def allowed_image(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_IMAGE_EXT


def allowed_pdf(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_PDF_EXT


# ============================================================
# CORE FUNCTION: Compress image to target size
# ============================================================
def compress_to_target_size(image_path, target_kb, output_path, output_format='JPEG'):
    """Binary search quality + auto resize untuk hit target size."""
    target_bytes = target_kb * 1024
    img = Image.open(image_path)

    if output_format == 'JPEG' and img.mode in ('RGBA', 'P', 'LA'):
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
        img = background
    elif output_format == 'JPEG' and img.mode != 'RGB':
        img = img.convert('RGB')

    original_width, original_height = img.size

    for resize_factor in [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]:
        if resize_factor < 1.0:
            new_width = int(original_width * resize_factor)
            new_height = int(original_height * resize_factor)
            test_img = img.resize((new_width, new_height), Image.LANCZOS)
        else:
            test_img = img

        low, high = 10, 95
        best_buffer = None
        best_quality = None

        while low <= high:
            mid = (low + high) // 2
            buffer = io.BytesIO()
            test_img.save(buffer, format=output_format, quality=mid, optimize=True)
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
            final_size = os.path.getsize(output_path) / 1024
            return True, round(final_size, 2), best_quality

    test_img = img.resize((int(original_width * 0.25), int(original_height * 0.25)), Image.LANCZOS)
    test_img.save(output_path, format=output_format, quality=10, optimize=True)
    final_size = os.path.getsize(output_path) / 1024
    return final_size <= target_kb * 1.1, round(final_size, 2), 10


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
    return render_template('blog/index.html', articles=articles)


@app.route('/blog/<slug>')
def blog_post(slug):
    """Halaman individual artikel."""
    if slug not in BLOG_ARTICLES:
        return "Artikel tidak ditemukan", 404
    
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
    """API kompres foto dengan target size KB."""
    if 'file' not in request.files:
        return jsonify({'error': 'Gak ada file yang diupload'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Pilih file dulu bro'}), 400

    if not allowed_image(file.filename):
        return jsonify({'error': 'Format gak didukung. Pake JPG/PNG/WebP ya'}), 400

    try:
        target_kb = int(request.form.get('target_kb', 200))
        if target_kb < 10 or target_kb > 5000:
            return jsonify({'error': 'Target size harus antara 10KB - 5000KB'}), 400
    except ValueError:
        return jsonify({'error': 'Target size invalid'}), 400

    file_id = str(uuid.uuid4())
    ext = file.filename.rsplit('.', 1)[1].lower()
    upload_filename = f"{file_id}.{ext}"
    upload_path = os.path.join(app.config['UPLOAD_FOLDER'], upload_filename)
    file.save(upload_path)

    original_size_kb = round(os.path.getsize(upload_path) / 1024, 2)

    output_filename = f"{file_id}_compressed.jpg"
    output_path = os.path.join(app.config['COMPRESSED_FOLDER'], output_filename)

    success, final_size_kb, quality = compress_to_target_size(
        upload_path, target_kb, output_path, 'JPEG'
    )

    try:
        os.remove(upload_path)
    except OSError:
        pass

    return jsonify({
        'success': True,
        'original_size_kb': original_size_kb,
        'final_size_kb': final_size_kb,
        'target_kb': target_kb,
        'quality_used': quality,
        'reduction_percent': round((1 - final_size_kb / original_size_kb) * 100, 1) if original_size_kb > 0 else 0,
        'download_url': f'/download/{output_filename}',
        'on_target': final_size_kb <= target_kb
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


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port, use_reloader=False)
