/**
 * Pas Foto Maker AI - Kompresin.my.id
 * Background removal pakai Transformers.js + RMBG-1.4 (quantized)
 * 100% client-side, no upload to server
 */

import { 
    AutoModel, 
    AutoProcessor, 
    RawImage, 
    env 
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';

// Config Transformers.js
env.allowLocalModels = false;
env.useBrowserCache =
    window.isSecureContext ||
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

// =====================
// DOM Elements
// =====================
const uploadZone = document.getElementById('uploadZone');
const selectFileBtn = document.getElementById('selectFileBtn');
const fileInput = document.getElementById('fileInput');
const aiLoadingState = document.getElementById('aiLoadingState');
const aiProgressBar = document.getElementById('aiProgressBar');
const aiLoadingTitle = document.getElementById('aiLoadingTitle');
const aiLoadingDetail = document.getElementById('aiLoadingDetail');
const aiLoadingSubDetail = document.getElementById('aiLoadingSubDetail');
const processingState = document.getElementById('processingState');
const previewState = document.getElementById('previewState');
const previewCanvas = document.getElementById('previewCanvas');
const resetBtn = document.getElementById('resetBtn');
const errorState = document.getElementById('errorState');
// Background color buttons (preview state)
const bgColorBtns = document.querySelectorAll('.bg-color-btn');
// Size buttons (preview state)
const sizeBtns = document.querySelectorAll('.size-btn');
// Background color buttons (PRE-upload state - default selector)
const bgColorBtnsPre = document.querySelectorAll('.bg-color-btn-pre');
// Size buttons (PRE-upload state - default selector)
const sizeBtnsPre = document.querySelectorAll('.size-btn-pre');
// Download button
const downloadBtn = document.getElementById('downloadBtn');

// =====================
// State
// =====================
let aiModel = null;
let aiProcessor = null;
let isModelLoaded = false;
let currentImage = null; // hasil bg-removed (RawImage)
let currentBgColor = '#0066CC'; // default biru
let currentSize = { w: 3, h: 4 }; // default 3x4 cm

// =====================
// Helpers
// =====================
function showState(stateName) {
    // Hide all states
    [uploadZone, aiLoadingState, processingState, previewState].forEach(el => {
        el.classList.add('d-none');
    });
    errorState.classList.add('d-none');
    
    // Show requested state
    const states = {
        'upload': uploadZone,
        'aiLoading': aiLoadingState,
        'processing': processingState,
        'preview': previewState
    };
    if (states[stateName]) {
        states[stateName].classList.remove('d-none');
    }
}

function showError(msg) {
    errorState.textContent = msg;
    errorState.classList.remove('d-none');
    console.error('[PasFoto Error]', msg);
}

function formatModelBytes(bytes) {
    if (!bytes || Number.isNaN(bytes)) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)}MB`;
}

function friendlyModelFileName(filename) {
    if (!filename) return 'file model AI';

    const lower = filename.toLowerCase();

    if (lower.includes('model') && lower.includes('onnx')) {
        return 'mesin utama AI';
    }

    if (lower.includes('config')) {
        return 'konfigurasi AI';
    }

    if (lower.includes('preprocessor') || lower.includes('processor')) {
        return 'pemroses gambar';
    }

    if (lower.includes('tokenizer')) {
        return 'data pendukung AI';
    }

    return 'data model AI';
}

function updateProgress(percent, detail, subDetail) {
    const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));

    aiProgressBar.style.width = safePercent + '%';
    aiProgressBar.textContent = Math.round(safePercent) + '%';
    aiProgressBar.setAttribute('aria-valuenow', Math.round(safePercent));

    if (detail && aiLoadingDetail) {
        aiLoadingDetail.textContent = detail;
    }

    if (subDetail && aiLoadingSubDetail) {
        aiLoadingSubDetail.textContent = subDetail;
    }
}

function handleModelProgress(progress) {
    if (!progress) return;

    const fileLabel = friendlyModelFileName(progress.file);

    if (progress.status === 'initiate') {
        updateProgress(
            3,
            `Menyiapkan ${fileLabel}...`,
            'Sebentar lagi proses download dimulai.'
        );
        return;
    }

    if (progress.status === 'download') {
        updateProgress(
            8,
            `Mulai download ${fileLabel}...`,
            'Ini hanya diperlukan saat pertama kali atau setelah cache browser dibersihkan.'
        );
        return;
    }

    if (progress.status === 'progress') {
        let percent = 20;

        if (progress.total && progress.loaded) {
            percent = (progress.loaded / progress.total) * 90;
        }

        const loadedText = formatModelBytes(progress.loaded);
        const totalText = formatModelBytes(progress.total);

        const subDetail = loadedText && totalText
            ? `Terunduh ${loadedText} dari ${totalText}. Jangan tutup tab ini.`
            : 'Sedang mengunduh model AI. Jangan tutup tab ini.';

        updateProgress(
            percent,
            `Download ${fileLabel}...`,
            subDetail
        );
        return;
    }

    if (progress.status === 'done') {
        updateProgress(
            95,
            `${fileLabel} selesai dimuat.`,
            'Sedikit lagi, AI sedang disiapkan untuk memproses foto.'
        );
    }
}

// =====================
// Load AI Model (Lazy)
// =====================
async function loadModel() {
    if (isModelLoaded) return true;
    
    showState('aiLoading');

    if (aiLoadingTitle) {
        aiLoadingTitle.textContent = 'Menyiapkan AI di browser...';
    }

    updateProgress(
        0,
        'Pertama kali butuh download model AI. Setelah itu biasanya tersimpan di browser.',
        'Ukuran model sekitar 45MB. Kecepatan tergantung koneksi dan perangkat kamu.'
    );
    
    try {
        const modelId = 'briaai/RMBG-1.4';
        
        // Load model with progress callback
        aiModel = await AutoModel.from_pretrained(modelId, {
            quantized: true, // 8-bit quantized (~45MB)
            progress_callback: handleModelProgress
        });
        
        // Load processor (config preset for RMBG-1.4)
        aiProcessor = await AutoProcessor.from_pretrained(modelId, {
            config: {
                do_normalize: true,
                do_pad: false,
                do_rescale: true,
                do_resize: true,
                image_mean: [0.5, 0.5, 0.5],
                feature_extractor_type: 'ImageFeatureExtractor',
                image_std: [1, 1, 1],
                resample: 2,
                rescale_factor: 0.00392156862745098,
                size: { width: 1024, height: 1024 }
            }
        });
        
        if (aiLoadingTitle) {
            aiLoadingTitle.textContent = 'AI siap dipakai!';
        }

        updateProgress(
            100,
            'AI model siap. Foto akan segera diproses.',
            'Untuk pemakaian berikutnya, loading biasanya lebih cepat karena model tersimpan di browser.'
        );

        isModelLoaded = true;
        console.log('[PasFoto] Model loaded successfully');
        return true;
        
    } catch (err) {
        console.error('[PasFoto] Model load error:', err);
        showError('Gagal load AI model. Cek koneksi internet & refresh halaman.');
        showState('upload');
        return false;
    }
}

// =====================
// Process Image (Background Removal)
// =====================
async function processImage(file) {
    showState('processing');
    
    try {
        // Convert file to RawImage
        const imageUrl = URL.createObjectURL(file);
        const image = await RawImage.fromURL(imageUrl);
        URL.revokeObjectURL(imageUrl);
        
        console.log('[PasFoto] Image loaded:', image.width, 'x', image.height);
        
        // Preprocess
        const { pixel_values } = await aiProcessor(image);
        
        // Run model inference
        console.log('[PasFoto] Running inference...');
        const { output } = await aiModel({ input: pixel_values });
        
        // Get mask (alpha channel) - resize to original dimensions
        const mask = await RawImage.fromTensor(
            output[0].mul(255).to('uint8')
        ).resize(image.width, image.height);
        
        // Bersihkan mask AI agar bercak background berkurang dan tepi lebih halus.
        const refinedMask = refineMask(mask, {
            foregroundThreshold: 26,
            backgroundThreshold: 18,
            minIslandRatio: 0.00022,
            maxHoleRatio: 0.00045,
            blurPasses: 1,

            keepMainSubject: true,
            subjectBandTop: 0.12,
            subjectBandBottom: 0.98,
        });

        // Combine original RGB + refined mask alpha
        const result = mergeImageAndMask(image, refinedMask);

        // Pas foto dibuat lebih lembut supaya rambut/wajah tetap natural.
        const cleanedResult = despillEdgeColors(result, {
            transparentThreshold: 16,
            solidAlpha: 238,
            neighborRadius: 1,
            baseBlend: 0.22,
            greenStrength: 0.42,
            protectSkin: true,
        });

        currentImage = cleanedResult;
        
        // Render to canvas
        renderToCanvas(result);
        showState('preview');
        
        console.log('[PasFoto] Done! Output:', result.width, 'x', result.height);
        
    } catch (err) {
        console.error('[PasFoto] Process error:', err);
        showError('Gagal proses foto. Coba foto lain atau refresh halaman.');
        showState('upload');
    }
}

// =====================
// AI Mask Cleanup + Edge Smoothing
// =====================

function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function softenMaskAlpha(alpha, w, h, passes = 1) {
    let src = alpha;

    for (let pass = 0; pass < passes; pass++) {
        const dst = new Uint8ClampedArray(src.length);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0;
                let weight = 0;

                for (let dy = -1; dy <= 1; dy++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= h) continue;

                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx;
                        if (xx < 0 || xx >= w) continue;

                        const idx = yy * w + xx;
                        const centerWeight = dx === 0 && dy === 0 ? 4 : 1;

                        sum += src[idx] * centerWeight;
                        weight += centerWeight;
                    }
                }

                dst[y * w + x] = clampByte(sum / weight);
            }
        }

        src = dst;
    }

    return src;
}

function removeTinyForegroundIslands(alpha, w, h, options = {}) {
    const foregroundThreshold = options.foregroundThreshold ?? 28;
    const minIslandRatio = options.minIslandRatio ?? 0.00035;
    const minIslandPixels = Math.max(24, Math.floor(w * h * minIslandRatio));

    const visited = new Uint8Array(w * h);
    const cleaned = new Uint8ClampedArray(alpha);
    const queue = [];

    const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];

    for (let start = 0; start < alpha.length; start++) {
        if (visited[start] || alpha[start] <= foregroundThreshold) {
            continue;
        }

        let head = 0;
        queue.length = 0;
        queue.push(start);
        visited[start] = 1;

        const component = [start];

        while (head < queue.length) {
            const current = queue[head++];
            const x = current % w;
            const y = Math.floor(current / w);

            for (const [dx, dy] of neighbors) {
                const nx = x + dx;
                const ny = y + dy;

                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

                const next = ny * w + nx;

                if (visited[next] || alpha[next] <= foregroundThreshold) {
                    continue;
                }

                visited[next] = 1;
                queue.push(next);
                component.push(next);
            }
        }

        if (component.length < minIslandPixels) {
            for (const idx of component) {
                cleaned[idx] = 0;
            }
        }
    }

    return cleaned;
}

function stabilizeMask(alpha, w, h) {
    const stable = new Uint8ClampedArray(alpha.length);

    for (let i = 0; i < alpha.length; i++) {
        const value = alpha[i];

        // Area hampir transparan dibuang agar bercak background hilang.
        if (value < 18) {
            stable[i] = 0;
        }
        // Area yang sudah jelas objek dibuat solid.
        else if (value > 238) {
            stable[i] = 255;
        }
        // Area pinggir tetap dipertahankan agar smoothing masih natural.
        else {
            stable[i] = value;
        }
    }

    return stable;
}

function refineMask(mask, options = {}) {
    const w = mask.width;
    const h = mask.height;

    let alpha = new Uint8ClampedArray(mask.data);

    // 1. Buang alpha super tipis.
    alpha = stabilizeMask(alpha, w, h);

    // 2. Hapus bercak foreground kecil yang biasanya berasal dari background rame.
    alpha = removeTinyForegroundIslands(alpha, w, h, {
        foregroundThreshold: options.foregroundThreshold ?? 28,
        minIslandRatio: options.minIslandRatio ?? 0.00028,
    });

    // 3. Haluskan tepi supaya tidak kotak-kotak.
    alpha = softenMaskAlpha(alpha, w, h, options.blurPasses ?? 1);

    // 4. Rapikan lagi setelah blur agar background tidak berkabut.
    for (let i = 0; i < alpha.length; i++) {
        if (alpha[i] < 10) alpha[i] = 0;
        if (alpha[i] > 245) alpha[i] = 255;
    }

    return {
        width: w,
        height: h,
        data: alpha,
    };
}



// =====================
// Edge Despill / Color Decontamination
// =====================

function isSkinLike(r, g, b) {
    return (
        r > 95 &&
        g > 40 &&
        b > 20 &&
        r > g &&
        r > b &&
        (Math.max(r, g, b) - Math.min(r, g, b)) > 12
    );
}

function hasTransparentNeighborRGBA(rgba, x, y, w, h, threshold = 18) {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;

            const nx = x + dx;
            const ny = y + dy;

            if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                return true;
            }

            const idx = (ny * w + nx) * 4;
            const a = rgba[idx + 3];

            if (a <= threshold) {
                return true;
            }
        }
    }

    return false;
}

function sampleSolidNeighborColor(rgba, x, y, w, h, options = {}) {
    const radius = options.radius ?? 2;
    const solidAlpha = options.solidAlpha ?? 235;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let weightTotal = 0;

    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            if (dx === 0 && dy === 0) continue;

            const idx = (ny * w + nx) * 4;
            const a = rgba[idx + 3];

            if (a < solidAlpha) continue;

            const distance = Math.abs(dx) + Math.abs(dy);
            const weight = 1 / (distance + 0.35);

            sumR += rgba[idx] * weight;
            sumG += rgba[idx + 1] * weight;
            sumB += rgba[idx + 2] * weight;
            weightTotal += weight;
        }
    }

    if (!weightTotal) return null;

    return {
        r: sumR / weightTotal,
        g: sumG / weightTotal,
        b: sumB / weightTotal,
    };
}

function softenGreenSpill(r, g, b, strength = 0.65) {
    const maxRB = Math.max(r, b);

    if (g > maxRB + 8 && g > r * 1.04 && g > b * 1.04) {
        const cappedG = maxRB + 6;
        g = cappedG + (g - cappedG) * (1 - strength);
    }

    return [r, g, b];
}

function despillEdgeColors(imageData, options = {}) {
    const w = imageData.width;
    const h = imageData.height;

    const src = new Uint8ClampedArray(imageData.data);
    const dst = imageData.data;

    const transparentThreshold = options.transparentThreshold ?? 18;
    const solidAlpha = options.solidAlpha ?? 235;
    const neighborRadius = options.neighborRadius ?? 2;
    const baseBlend = options.baseBlend ?? 0.34;
    const greenStrength = options.greenStrength ?? 0.68;
    const protectSkin = options.protectSkin ?? true;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;

            const a = src[idx + 3];
            if (a === 0) continue;

            const nearTransparency = hasTransparentNeighborRGBA(
                src,
                x,
                y,
                w,
                h,
                transparentThreshold
            );

            const isEdgePixel = a < solidAlpha || nearTransparency;

            if (!isEdgePixel) continue;

            let r = src[idx];
            let g = src[idx + 1];
            let b = src[idx + 2];

            const neighbor = sampleSolidNeighborColor(src, x, y, w, h, {
                radius: neighborRadius,
                solidAlpha,
            });

            if (neighbor) {
                const alphaFactor = 1 - Math.min(1, a / solidAlpha);

                let blend = baseBlend + alphaFactor * 0.42;
                if (nearTransparency) blend += 0.08;

                blend = Math.max(0.18, Math.min(0.82, blend));

                r = r * (1 - blend) + neighbor.r * blend;
                g = g * (1 - blend) + neighbor.g * blend;
                b = b * (1 - blend) + neighbor.b * blend;
            }

            if (!(protectSkin && isSkinLike(r, g, b))) {
                [r, g, b] = softenGreenSpill(r, g, b, greenStrength);
            }

            dst[idx] = Math.max(0, Math.min(255, Math.round(r)));
            dst[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
            dst[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
        }
    }

    return imageData;
}


// =====================
// Helper: Merge RGB + Mask jadi RGBA
// =====================
function mergeImageAndMask(image, mask) {
    const w = image.width;
    const h = image.height;
    const rgba = new Uint8ClampedArray(w * h * 4);
    
    for (let i = 0; i < w * h; i++) {
        rgba[i * 4 + 0] = image.data[i * 3 + 0]; // R
        rgba[i * 4 + 1] = image.data[i * 3 + 1]; // G
        rgba[i * 4 + 2] = image.data[i * 3 + 2]; // B
        rgba[i * 4 + 3] = mask.data[i];          // A (alpha dari mask)
    }
    
    return new RawImage(rgba, w, h, 4);
}

// =====================
// Render to Canvas
// =====================
function renderToCanvas(rawImage) {
    // This is the RAW bg-removed image (RGBA, transparent bg)
    // Untuk preview final, kita pake renderFinalPreview()
    renderFinalPreview();
}

/**
 * Render final pas foto dengan:
 * - Background color (currentBgColor)
 * - Aspect ratio sesuai ukuran (currentSize)
 * - DPI 300 ready (output canvas size = cm * 118.11 pixels per cm)
 */
function renderFinalPreview() {
    if (!currentImage) return;
    
    // Hitung output dimensions di DPI 300
    // 1 cm = 118.11 pixels (DPI 300)
    const dpi = 300;
    const cmToPixel = dpi / 2.54; // ~118.11
    const outputW = Math.round(currentSize.w * cmToPixel);
    const outputH = Math.round(currentSize.h * cmToPixel);
    
    // Set canvas size
    previewCanvas.width = outputW;
    previewCanvas.height = outputH;
    
    const ctx = previewCanvas.getContext('2d');
    
    // Step 1: Fill background color
    ctx.fillStyle = currentBgColor;
    ctx.fillRect(0, 0, outputW, outputH);
    
    // Step 2: Hitung scale & position foto bg-removed
    // Pas foto: wajah harus center, ukuran wajah ~70% tinggi canvas
    const srcW = currentImage.width;
    const srcH = currentImage.height;
    
    // Scale foto ke fit canvas (object-fit: cover style)
    const scaleX = outputW / srcW;
    const scaleY = outputH / srcH;
    const scale = Math.max(scaleX, scaleY); // cover (fill canvas)
    
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const drawX = (outputW - drawW) / 2; // center horizontal
    const drawY = (outputH - drawH) / 2; // center vertical
    
    // Step 3: Draw foto bg-removed di atas background color
    // Bikin temp canvas untuk source image (RawImage → ImageData → drawImage)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = srcW;
    tempCanvas.height = srcH;
    const tempCtx = tempCanvas.getContext('2d');
    
    const imageData = new ImageData(
        new Uint8ClampedArray(currentImage.data),
        srcW,
        srcH
    );
    tempCtx.putImageData(imageData, 0, 0);
    
    // Draw scaled foto ke main canvas
    ctx.drawImage(tempCanvas, drawX, drawY, drawW, drawH);
    
    console.log('[PasFoto] Rendered:', outputW + 'x' + outputH, 'px @ DPI 300, bg:', currentBgColor);
}

// =====================
// Event Listeners
// =====================
selectFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    
    const file = e.target.files[0];
    
    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
        showError('File terlalu besar. Max 10MB.');
        return;
    }
    
    // Validate type
    if (!file.type.startsWith('image/')) {
        showError('File harus berupa gambar (JPG/PNG).');
        return;
    }
    
    // Load model if not loaded
    if (!isModelLoaded) {
        const ok = await loadModel();
        if (!ok) return;
    }
    
    // Process
    await processImage(file);
    
    // Reset input biar bisa upload file sama
    fileInput.value = '';
});

resetBtn.addEventListener('click', () => {
    currentImage = null;
    previewCanvas.width = 0;
    previewCanvas.height = 0;
    showState('upload');
});

// Background color buttons
bgColorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update active state (visual feedback)
        bgColorBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update state & re-render
        currentBgColor = btn.dataset.color;
        renderFinalPreview();
    });
});

// Size buttons
sizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update active state
        sizeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update state & re-render
        currentSize = {
            w: parseInt(btn.dataset.w),
            h: parseInt(btn.dataset.h)
        };
        renderFinalPreview();
    });
});

// PRE-UPLOAD: Background color buttons (set default before upload)
bgColorBtnsPre.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update active state di pre-selectors
        bgColorBtnsPre.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update state
        currentBgColor = btn.dataset.color;
        
        // SYNC: update active state di preview-state buttons juga
        bgColorBtns.forEach(b => {
            if (b.dataset.color === currentBgColor) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        
        console.log('[PasFoto] Pre-selected bg:', currentBgColor);
    });
});

// PRE-UPLOAD: Size buttons (set default before upload)
sizeBtnsPre.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update active state di pre-selectors
        sizeBtnsPre.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update state
        currentSize = {
            w: parseInt(btn.dataset.w),
            h: parseInt(btn.dataset.h)
        };
        
        // SYNC: update active state di preview-state buttons juga
        sizeBtns.forEach(b => {
            const w = parseInt(b.dataset.w);
            const h = parseInt(b.dataset.h);
            if (w === currentSize.w && h === currentSize.h) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        
        console.log('[PasFoto] Pre-selected size:', currentSize.w + 'x' + currentSize.h);
    });
});


// Download button
downloadBtn.addEventListener('click', () => {
    if (!currentImage) return;
    
    // Convert canvas to JPG blob
    previewCanvas.toBlob((blob) => {
        if (!blob) {
            showError('Gagal generate file. Coba lagi.');
            return;
        }
        
        // Trigger download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pas-foto-${currentSize.w}x${currentSize.h}-kompresin.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('[PasFoto] Downloaded:', a.download);
    }, 'image/jpeg', 0.95);
});

// =====================
// Init
// =====================
console.log('[PasFoto] Initialized. Model NOT loaded yet (lazy load on upload).');
showState('upload');