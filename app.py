"""
KompresFoto.id - Kompres foto dengan target size spesifik (KB)
Cocok buat CPNS, lamaran kerja, daftar sekolah, dll.
"""
import os
import io
import uuid
from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max upload
# app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20MB max upload
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['COMPRESSED_FOLDER'] = 'compressed'

ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp', 'bmp'}


def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def compress_to_target_size(image_path, target_kb, output_path, output_format='JPEG'):
    """
    Kompres gambar dengan binary search quality untuk hit target size.
    Return: (success: bool, final_size_kb: float, quality_used: int)
    """
    target_bytes = target_kb * 1024
    img = Image.open(image_path)

    # Convert RGBA/P ke RGB kalau output JPEG
    if output_format == 'JPEG' and img.mode in ('RGBA', 'P', 'LA'):
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
        img = background
    elif output_format == 'JPEG' and img.mode != 'RGB':
        img = img.convert('RGB')

    original_width, original_height = img.size

    # Strategy: try quality dari 95 turun, kalau masih kegedean baru resize
    # Step 1: binary search quality
    for resize_factor in [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]:
        if resize_factor < 1.0:
            new_width = int(original_width * resize_factor)
            new_height = int(original_height * resize_factor)
            test_img = img.resize((new_width, new_height), Image.LANCZOS)
        else:
            test_img = img

        # Binary search quality
        low, high = 10, 95
        best_quality = None
        best_buffer = None

        while low <= high:
            mid = (low + high) // 2
            buffer = io.BytesIO()
            test_img.save(buffer, format=output_format, quality=mid, optimize=True)
            size = buffer.tell()

            if size <= target_bytes:
                best_quality = mid
                best_buffer = buffer
                low = mid + 1  # coba quality lebih tinggi
            else:
                high = mid - 1

        if best_buffer is not None:
            # Save hasil terbaik
            with open(output_path, 'wb') as f:
                f.write(best_buffer.getvalue())
            final_size = os.path.getsize(output_path) / 1024
            return True, round(final_size, 2), best_quality

    # Last resort: quality minimum + resize ekstrem
    test_img = img.resize((int(original_width * 0.25), int(original_height * 0.25)), Image.LANCZOS)
    test_img.save(output_path, format=output_format, quality=10, optimize=True)
    final_size = os.path.getsize(output_path) / 1024
    return final_size <= target_kb * 1.1, round(final_size, 2), 10


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/compress', methods=['POST'])
def compress():
    if 'file' not in request.files:
        return jsonify({'error': 'Gak ada file yang diupload'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Pilih file dulu bro'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Format gak didukung. Pake JPG/PNG/WebP ya'}), 400

    try:
        target_kb = int(request.form.get('target_kb', 200))
        if target_kb < 10 or target_kb > 5000:
            return jsonify({'error': 'Target size harus antara 10KB - 5000KB'}), 400
    except ValueError:
        return jsonify({'error': 'Target size invalid'}), 400

    # Save uploaded file dengan nama unik
    file_id = str(uuid.uuid4())
    ext = file.filename.rsplit('.', 1)[1].lower()
    upload_filename = f"{file_id}.{ext}"
    upload_path = os.path.join(app.config['UPLOAD_FOLDER'], upload_filename)
    file.save(upload_path)

    original_size_kb = round(os.path.getsize(upload_path) / 1024, 2)

    # Output selalu JPEG (ukuran paling efisien buat foto)
    output_filename = f"{file_id}_compressed.jpg"
    output_path = os.path.join(app.config['COMPRESSED_FOLDER'], output_filename)

    success, final_size_kb, quality = compress_to_target_size(
        upload_path, target_kb, output_path, 'JPEG'
    )

    # Hapus file upload original (hemat disk)
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


@app.route('/download/<filename>')
def download(filename):
    # Security: cuma allow nama file yang aman
    safe_name = secure_filename(filename)
    file_path = os.path.join(app.config['COMPRESSED_FOLDER'], safe_name)
    if not os.path.exists(file_path):
        return "File gak ditemukan atau udah expired", 404
    return send_file(file_path, as_attachment=True, download_name=f"kompres_{safe_name}")


@app.route('/cpns')
def cpns_landing():
    """Landing page khusus CPNS - buat SEO long-tail"""
    return render_template('cpns.html')


@app.route('/lamaran-kerja')
def lamaran_landing():
    """Landing page khusus lamaran kerja"""
    return render_template('lamaran.html')

@app.route('/sitemap.xml')
def sitemap():
    """Sitemap XML buat Google Search Console"""
    pages = [
        {'loc': 'https://kompresin.my.id/', 'priority': '1.0', 'changefreq': 'weekly'},
        {'loc': 'https://kompresin.my.id/cpns', 'priority': '0.9', 'changefreq': 'monthly'},
        {'loc': 'https://kompresin.my.id/lamaran-kerja', 'priority': '0.9', 'changefreq': 'monthly'},
    ]
    
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for page in pages:
        xml += f'  <url>\n'
        xml += f'    <loc>{page["loc"]}</loc>\n'
        xml += f'    <changefreq>{page["changefreq"]}</changefreq>\n'
        xml += f'    <priority>{page["priority"]}</priority>\n'
        xml += f'  </url>\n'
    xml += '</urlset>'
    
    return xml, 200, {'Content-Type': 'application/xml'}


@app.route('/robots.txt')
def robots():
    """Robots.txt buat ngasih tau Google sitemap-nya dimana"""
    content = "User-agent: *\nAllow: /\n\nSitemap: https://kompresin.my.id/sitemap.xml\n"
    return content, 200, {'Content-Type': 'text/plain'}


# @app.errorhandler(413)
# def too_large(e):
    # return jsonify({'error': 'File kegedean (max 20MB)'}), 413
@app.errorhandler(413)
def too_large(e):
    # Ubah teks 20MB jadi 5MB biar user gak bingung
    return jsonify({'error': 'File kegedean (max 5MB)'}), 413


# Pastiin folder ada (jalan baik di local maupun production)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['COMPRESSED_FOLDER'], exist_ok=True)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port, use_reloader=False)