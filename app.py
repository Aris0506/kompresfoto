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
import requests  # ← TAMBAHIN INI
from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 20MB max upload
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
    """Halaman kompres PDF (Phase 4 - coming soon placeholder)"""
    return render_template('tool_coming_soon.html', tool_name='Kompres PDF', tool_slug='kompres-pdf')


# Existing landing pages
@app.route('/cpns')
def cpns_landing():
    return render_template('cpns.html')


@app.route('/lamaran-kerja')
def lamaran_landing():
    return render_template('lamaran.html')




# ============================================================
# CORE FUNCTION: Pas Foto Maker
# ============================================================
def make_passport_photo(image_path, output_path, size_cm, bg_color_rgb):
    """
    Bikin pas foto pake remove.bg API:
    - Auto AI remove background
    - Replace dengan warna pilihan
    - Resize ke ukuran cm (DPI 300)
    """
    DPI = 300
    width_cm, height_cm = size_cm
    target_w = int((width_cm / 2.54) * DPI)
    target_h = int((height_cm / 2.54) * DPI)
    
    # Call remove.bg API
    api_key = os.environ.get('REMOVEBG_API_KEY', '')
    if not api_key:
        raise Exception('API key Smart AI belum di-set. Hubungi admin.')
    
    with open(image_path, 'rb') as img_file:
        response = requests.post(
            'https://api.remove.bg/v1.0/removebg',
            files={'image_file': img_file},
            data={'size': 'auto'},
            headers={'X-Api-Key': api_key},
            timeout=30
        )
    
    if response.status_code == 402:
        raise Exception('Quota Smart AI bulan ini habis. Coba bulan depan ya, atau tunggu Premium AI segera hadir!')
    elif response.status_code == 403:
        raise Exception('API key invalid. Hubungi admin.')
    elif response.status_code != 200:
        raise Exception(f'Gagal proses AI (error {response.status_code}). Coba lagi nanti.')
    
    # Buka hasil dari remove.bg (PNG transparent)
    foreground = Image.open(io.BytesIO(response.content)).convert('RGBA')
    
    # Bikin background dengan warna pilihan
    background = Image.new('RGB', foreground.size, bg_color_rgb)
    
    # Composite foreground (subject) di atas background warna
    background.paste(foreground, mask=foreground.split()[3])  # use alpha channel as mask
    
    # Resize ke ukuran final pas foto
    final = background.resize((target_w, target_h), Image.LANCZOS)
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


@app.route('/api/passport-photo', methods=['POST'])
def api_passport_photo():
    """API bikin pas foto."""
    if 'file' not in request.files:
        return jsonify({'error': 'Gak ada file yang diupload'}), 400

    file = request.files['file']
    if file.filename == '' or not allowed_image(file.filename):
        return jsonify({'error': 'Pilih foto yang valid (JPG/PNG/WebP)'}), 400

    size_key = request.form.get('size', '3x4')
    color_key = request.form.get('color', 'merah')

    if size_key not in PASFOTO_SIZES:
        return jsonify({'error': 'Ukuran gak valid'}), 400
    if color_key not in PASFOTO_COLORS:
        return jsonify({'error': 'Warna gak valid'}), 400

    file_id = str(uuid.uuid4())
    ext = file.filename.rsplit('.', 1)[1].lower()
    upload_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{file_id}.{ext}")
    file.save(upload_path)

    output_filename = f"{file_id}_pasfoto.jpg"
    output_path = os.path.join(app.config['COMPRESSED_FOLDER'], output_filename)

    try:
        w, h = make_passport_photo(
            upload_path, output_path,
            PASFOTO_SIZES[size_key],
            PASFOTO_COLORS[color_key]
        )
    except Exception as e:
        try:
            os.remove(upload_path)
        except OSError:
            pass
        return jsonify({'error': f'Gagal proses: {str(e)}'}), 500

    try:
        os.remove(upload_path)
    except OSError:
        pass

    return jsonify({
        'success': True,
        'size': f'{size_key} cm',
        'color': color_key,
        'pixels': f'{w}x{h}',
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
