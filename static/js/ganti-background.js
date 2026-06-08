/**
 * Ganti Background AI - Kompresin.my.id
 * Background removal + color picker / transparent PNG
 * 100% client-side, no upload to server
 */

import { 
    AutoModel, 
    AutoProcessor, 
    RawImage, 
    env 
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';

env.allowLocalModels = false;

// Browser cache hanya aman dipakai di HTTPS / localhost.
// Kalau akses dari http://192.168.x.x, cache browser bisa error.
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
const downloadBtn = document.getElementById('downloadBtn');
const downloadFormat = document.getElementById('downloadFormat');
// Manual refine brush
const toggleBrushBtn = document.getElementById('toggleBrushBtn');
const brushControls = document.getElementById('brushControls');
const brushEraseBtn = document.getElementById('brushEraseBtn');
const brushRestoreBtn = document.getElementById('brushRestoreBtn');
const brushSize = document.getElementById('brushSize');
const brushSizeLabel = document.getElementById('brushSizeLabel');
const brushUndoBtn = document.getElementById('brushUndoBtn');
const brushResetBtn = document.getElementById('brushResetBtn');
const autoBlockBtn = document.getElementById('autoBlockBtn');
const lassoEraseBtn = document.getElementById('lassoEraseBtn');
const lassoKeepBtn = document.getElementById('lassoKeepBtn');
const lassoHint = document.getElementById('lassoHint');
const lassoActions = document.getElementById('lassoActions');
const applyLassoBtn = document.getElementById('applyLassoBtn');
const cancelLassoBtn = document.getElementById('cancelLassoBtn');

// Pre-upload selectors
const modeBtnsPre = document.querySelectorAll('.mode-btn-pre');
const colorPresetsPre = document.querySelectorAll('.color-preset-pre');
const colorCustomPre = document.getElementById('colorCustomPre');
const colorPickerPre = document.getElementById('colorPickerPre');

// Preview-state selectors
const modeBtns = document.querySelectorAll('.mode-btn');
const colorPresets = document.querySelectorAll('.color-preset');
const colorCustom = document.getElementById('colorCustom');
const colorPicker = document.getElementById('colorPicker');

// =====================
// State
// =====================
let aiModel = null;
let aiProcessor = null;
let isModelLoaded = false;
let currentImage = null;
let aiBaseImage = null;
let originalFullImage = null;

let currentMode = 'color';
let currentBgColor = '#FFFFFF';

let isBrushActive = false;
let brushMode = 'erase'; // erase | restore | lassoErase | lassoKeep
let isPainting = false;
let lastBrushPoint = null;
let brushHistory = [];
let renderQueued = false;

let isDrawingLasso = false;
let lassoPoints = [];

// =====================
// Helpers
// =====================
function showState(stateName) {
    [uploadZone, aiLoadingState, processingState, previewState].forEach(el => {
        el.classList.add('d-none');
    });
    errorState.classList.add('d-none');
    
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
    console.error('[GantiBg]', msg);
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

function toggleColorPicker(mode, preState) {
    const picker = preState ? colorPickerPre : colorPicker;
    if (mode === 'color') {
        picker.classList.remove('d-none');
    } else {
        picker.classList.add('d-none');
    }
}

function updateDownloadButtonText() {
    downloadFormat.textContent = currentMode === 'transparent' ? 'PNG (Transparent)' : 'JPG';
}

// =====================
// Load AI Model
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
        
        aiModel = await AutoModel.from_pretrained(modelId, {
            quantized: true,
            progress_callback: handleModelProgress
        });
        
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
        console.log('[GantiBg] Model loaded');
        return true;
        
    } catch (err) {
        console.error('[GantiBg] Model load error:', err);
        showError('Gagal load AI. Cek koneksi internet & refresh.');
        showState('upload');
        return false;
    }
}


async function loadImageElementFromFile(file) {
    const url = URL.createObjectURL(file);

    try {
        const img = new Image();
        img.decoding = 'async';

        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
        });

        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function loadOptimizedRawImage(file, maxLongEdge = 2200) {
    const img = await loadImageElementFromFile(file);

    const originalW = img.naturalWidth || img.width;
    const originalH = img.naturalHeight || img.height;
    const longEdge = Math.max(originalW, originalH);

    if (longEdge <= maxLongEdge) {
        const imageUrl = URL.createObjectURL(file);
        try {
            return await RawImage.fromURL(imageUrl);
        } finally {
            URL.revokeObjectURL(imageUrl);
        }
    }

    const scale = maxLongEdge / longEdge;
    const targetW = Math.round(originalW * scale);
    const targetH = Math.round(originalH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d', {
        alpha: false,
        willReadFrequently: true,
    });

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });

    const resizedUrl = URL.createObjectURL(blob);

    try {
        console.log('[GantiBg] Resized image:', originalW, 'x', originalH, '→', targetW, 'x', targetH);
        return await RawImage.fromURL(resizedUrl);
    } finally {
        URL.revokeObjectURL(resizedUrl);
    }
}

// =====================
// Process Image
// =====================
async function processImage(file) {
    showState('processing');
    
    try {
        const image = await loadOptimizedRawImage(file, 2200);
        
        console.log('[GantiBg] Image:', image.width, 'x', image.height);
        
        const { pixel_values } = await aiProcessor(image);
        const { output } = await aiModel({ input: pixel_values });
        
        const mask = await RawImage.fromTensor(
            output[0].mul(255).to('uint8')
        ).resize(image.width, image.height);
        
        // Bersihkan mask AI agar bercak background berkurang dan tepi lebih halus.
        // Untuk fitur ganti background, cleanup dibuat sedikit lebih agresif
        // karena foto non-formal biasanya background-nya lebih rame.
        const refinedMask = refineMask(mask, {
            foregroundThreshold: 32,
            backgroundThreshold: 28,
            minIslandRatio: 0.00045,
            maxHoleRatio: 0.00125,
            blurPasses: 1,
            keepMainSubject: true,
            subjectBandTop: 0.25,
            subjectBandBottom: 0.98,
        });

        const result = mergeImageAndMask(image, refinedMask);


        // Bersihkan halo / fringe warna di tepi objek.
        let cleanedResult = despillEdgeColors(result, {
            transparentThreshold: 18,
            solidAlpha: 235,
            neighborRadius: 2,
            baseBlend: 0.34,
            greenStrength: 0.55,
            protectSkin: true,
        });

        // General cleanup:
        // bukan khusus hijau, tapi mengurangi sisa warna background lama di sekitar tepi objek.
        cleanedResult = reduceBackgroundColorResidue(cleanedResult, {
            edgeAlphaMax: 245,
            transparentAlpha: 24,
            sampleRadius: 4,
            distanceThreshold: 46,
            minTransparentSamples: 3,
            alphaCut: 0.70,
        });

        originalFullImage = makeFullRgbaImage(image);

        aiBaseImage = cloneRawImage(cleanedResult);
        currentImage = cloneRawImage(cleanedResult);

        brushHistory = [];
        if (brushUndoBtn) {
            brushUndoBtn.disabled = true;
        }

        setBrushActive(false);

        renderPreview();
        showState('preview');
        
        console.log('[GantiBg] Done');
        
    } catch (err) {
        console.error('[GantiBg] Process error:', err);
        showError('Gagal proses foto. Coba foto lain.');
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


function boxesOverlap(a, b, padding = 0) {
    return !(
        a.maxX + padding < b.minX ||
        a.minX - padding > b.maxX ||
        a.maxY + padding < b.minY ||
        a.minY - padding > b.maxY
    );
}

function keepLikelyMainSubject(alpha, w, h, options = {}) {
    const foregroundThreshold = options.foregroundThreshold ?? 32;
    const minComponentPixels = Math.max(32, Math.floor(w * h * 0.00008));
    const subjectBandTop = options.subjectBandTop ?? 0.25;
    const subjectBandBottom = options.subjectBandBottom ?? 0.98;

    const visited = new Uint8Array(w * h);
    const components = [];
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

        const pixels = [];
        let minX = w;
        let maxX = 0;
        let minY = h;
        let maxY = 0;
        let sumX = 0;
        let sumY = 0;

        while (head < queue.length) {
            const current = queue[head++];
            const x = current % w;
            const y = Math.floor(current / w);

            pixels.push(current);
            sumX += x;
            sumY += y;

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

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
            }
        }

        if (pixels.length < minComponentPixels) {
            continue;
        }

        const area = pixels.length;
        const cx = sumX / area;
        const cy = sumY / area;

        const componentHeight = Math.max(1, maxY - minY + 1);
        const bandTopPx = h * subjectBandTop;
        const bandBottomPx = h * subjectBandBottom;
        const overlapTop = Math.max(minY, bandTopPx);
        const overlapBottom = Math.min(maxY, bandBottomPx);
        const bandOverlap = overlapBottom >= overlapTop
            ? (overlapBottom - overlapTop + 1) / componentHeight
            : 0;

        const centerScore = 1 - Math.min(1, Math.abs((cx / w) - 0.5) / 0.5);
        const verticalScore = cy / h;
        const areaScore = Math.sqrt(area);

        // Prioritas: komponen yang besar, dekat tengah, dan berada di area subjek manusia.
        const score =
            areaScore *
            (0.65 + centerScore) *
            (0.55 + verticalScore) *
            (0.40 + bandOverlap * 1.60);

        components.push({
            pixels,
            area,
            minX,
            maxX,
            minY,
            maxY,
            score,
        });
    }

    if (!components.length) {
        return alpha;
    }

    components.sort((a, b) => b.score - a.score);
    const main = components[0];

    const cleaned = new Uint8ClampedArray(alpha.length);
    const padding = Math.floor(Math.max(w, h) * 0.04);
    const minNearbyPixels = Math.max(16, Math.floor(main.area * 0.015));

    for (const component of components) {
        const isMain = component === main;
        const isNearby =
            component.area >= minNearbyPixels &&
            boxesOverlap(component, main, padding);

        if (isMain || isNearby) {
            for (const idx of component.pixels) {
                cleaned[idx] = alpha[idx];
            }
        }
    }

    return cleaned;
}

function fillSmallTransparentHoles(alpha, w, h, options = {}) {
    const backgroundThreshold = options.backgroundThreshold ?? 22;
    const maxHoleRatio = options.maxHoleRatio ?? 0.00075;
    const maxHolePixels = Math.max(18, Math.floor(w * h * maxHoleRatio));

    const visited = new Uint8Array(w * h);
    const filled = new Uint8ClampedArray(alpha);
    const queue = [];

    const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];

    for (let start = 0; start < alpha.length; start++) {
        if (visited[start] || alpha[start] > backgroundThreshold) {
            continue;
        }

        let head = 0;
        queue.length = 0;
        queue.push(start);
        visited[start] = 1;

        const component = [];
        let touchesBorder = false;

        while (head < queue.length) {
            const current = queue[head++];
            const x = current % w;
            const y = Math.floor(current / w);

            component.push(current);

            if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
                touchesBorder = true;
            }

            for (const [dx, dy] of neighbors) {
                const nx = x + dx;
                const ny = y + dy;

                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

                const next = ny * w + nx;

                if (visited[next] || alpha[next] > backgroundThreshold) {
                    continue;
                }

                visited[next] = 1;
                queue.push(next);
            }
        }

        // Lubang kecil di dalam objek diisi, tapi background asli yang menyentuh pinggir tidak disentuh.
        if (!touchesBorder && component.length <= maxHolePixels) {
            for (const idx of component) {
                filled[idx] = 255;
            }
        }
    }

    return filled;
}

function stabilizeMask(alpha, w, h) {
    const stable = new Uint8ClampedArray(alpha.length);

    for (let i = 0; i < alpha.length; i++) {
        const value = alpha[i];

        if (value < 18) {
            stable[i] = 0;
        } else if (value > 238) {
            stable[i] = 255;
        } else {
            stable[i] = value;
        }
    }

    return stable;
}

function refineMask(mask, options = {}) {
    const w = mask.width;
    const h = mask.height;

    let alpha = new Uint8ClampedArray(mask.data);

    // 1. Rapikan alpha mentah dari AI.
    alpha = stabilizeMask(alpha, w, h);

    // 2. Buang objek palsu besar yang bukan subjek utama.
    // Ini yang akan menghapus kasus banner/background atas ikut kebawa.
    if (options.keepMainSubject) {
        alpha = keepLikelyMainSubject(alpha, w, h, {
            foregroundThreshold: options.foregroundThreshold ?? 32,
            subjectBandTop: options.subjectBandTop ?? 0.25,
            subjectBandBottom: options.subjectBandBottom ?? 0.98,
        });
    }

    // 3. Hapus bercak foreground kecil.
    alpha = removeTinyForegroundIslands(alpha, w, h, {
        foregroundThreshold: options.foregroundThreshold ?? 28,
        minIslandRatio: options.minIslandRatio ?? 0.00035,
    });

    // 4. Isi lubang kecil di dalam objek.
    // Ini mengurangi titik-titik merah di baju/kulit.
    alpha = fillSmallTransparentHoles(alpha, w, h, {
        backgroundThreshold: options.backgroundThreshold ?? 22,
        maxHoleRatio: options.maxHoleRatio ?? 0.00075,
    });

    // 5. Haluskan tepi.
    alpha = softenMaskAlpha(alpha, w, h, options.blurPasses ?? 1);

    // 6. Final cleanup agar background tidak berkabut.
    for (let i = 0; i < alpha.length; i++) {
        if (alpha[i] < 16) alpha[i] = 0;
        if (alpha[i] > 235) alpha[i] = 255;
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

    // Kalau hijau terlalu dominan, turunkan mendekati channel lain.
    if (g > maxRB + 8 && g > r * 1.04 && g > b * 1.04) {
        const cappedG = maxRB + 6;
        g = cappedG + (g - cappedG) * (1 - strength);
    }

    return [r, g, b];
}

function despillEdgeColors(imageData, options = {}) {
    const w = imageData.width;
    const h = imageData.height;

    // src = data asli sebelum didespill
    const src = new Uint8ClampedArray(imageData.data);
    // dst = data final yang akan ditimpa
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
                // Semakin tipis alpha-nya, semakin kuat dibersihin.
                const alphaFactor = 1 - Math.min(1, a / solidAlpha);

                let blend = baseBlend + alphaFactor * 0.42;
                if (nearTransparency) blend += 0.08;

                blend = Math.max(0.18, Math.min(0.82, blend));

                r = r * (1 - blend) + neighbor.r * blend;
                g = g * (1 - blend) + neighbor.g * blend;
                b = b * (1 - blend) + neighbor.b * blend;
            }

            // Kurangi green spill kalau memang kelihatan hijau dominan.
            if (!(protectSkin && isSkinLike(r, g, b))) {
                [r, g, b] = softenGreenSpill(r, g, b, greenStrength);
            }

            dst[idx] = Math.max(0, Math.min(255, Math.round(r)));
            dst[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
            dst[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
            // alpha dibiarkan
        }
    }

    return imageData;
}


function colorDistance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

function isHighlySaturated(r, g, b, minGap = 22) {
    return (Math.max(r, g, b) - Math.min(r, g, b)) >= minGap;
}

function sampleNearbyTransparentColor(rgba, x, y, w, h, options = {}) {
    const radius = options.radius ?? 3;
    const transparentAlpha = options.transparentAlpha ?? 24;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;

    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue;

            const nx = x + dx;
            const ny = y + dy;

            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

            const idx = (ny * w + nx) * 4;
            const a = rgba[idx + 3];

            if (a <= transparentAlpha) {
                sumR += rgba[idx];
                sumG += rgba[idx + 1];
                sumB += rgba[idx + 2];
                count++;
            }
        }
    }

    if (!count) return null;

    return {
        r: sumR / count,
        g: sumG / count,
        b: sumB / count,
        count,
    };
}

function reduceBackgroundColorResidue(imageData, options = {}) {
    const w = imageData.width;
    const h = imageData.height;

    const src = new Uint8ClampedArray(imageData.data);
    const dst = imageData.data;

    const edgeAlphaMax = options.edgeAlphaMax ?? 245;
    const transparentAlpha = options.transparentAlpha ?? 24;
    const sampleRadius = options.sampleRadius ?? 4;
    const distanceThreshold = options.distanceThreshold ?? 42;
    const minTransparentSamples = options.minTransparentSamples ?? 3;
    const alphaCut = options.alphaCut ?? 0.65;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;

            const r = src[idx];
            const g = src[idx + 1];
            const b = src[idx + 2];
            const a = src[idx + 3];

            if (a <= 0) continue;

            // Fokus hanya di area tepi / semi-tepi.
            // Area solid tengah objek jangan disentuh.
            if (a > edgeAlphaMax) continue;

            if (isSkinLike(r, g, b)) continue;

            const bg = sampleNearbyTransparentColor(src, x, y, w, h, {
                radius: sampleRadius,
                transparentAlpha,
            });

            if (!bg || bg.count < minTransparentSamples) continue;

            const dist = colorDistance(r, g, b, bg.r, bg.g, bg.b);

            // Kalau warna pixel mirip dengan warna background lama di sekitar area transparan,
            // berarti kemungkinan besar ini sisa background.
            if (dist <= distanceThreshold) {
                dst[idx + 3] = Math.round(a * (1 - alphaCut));
            }
        }
    }

    return imageData;
}


function mergeImageAndMask(image, mask) {
    const w = image.width;
    const h = image.height;
    const rgba = new Uint8ClampedArray(w * h * 4);
    
    for (let i = 0; i < w * h; i++) {
        rgba[i * 4 + 0] = image.data[i * 3 + 0];
        rgba[i * 4 + 1] = image.data[i * 3 + 1];
        rgba[i * 4 + 2] = image.data[i * 3 + 2];
        rgba[i * 4 + 3] = mask.data[i];
    }
    
    return new RawImage(rgba, w, h, 4);
}


// =====================
// Manual Refine Brush
// =====================

function cloneRawImage(rawImage) {
    if (!rawImage) return null;
    return new RawImage(
        new Uint8ClampedArray(rawImage.data),
        rawImage.width,
        rawImage.height,
        4
    );
}

function makeFullRgbaImage(image) {
    const w = image.width;
    const h = image.height;
    const rgba = new Uint8ClampedArray(w * h * 4);

    for (let i = 0; i < w * h; i++) {
        rgba[i * 4 + 0] = image.data[i * 3 + 0];
        rgba[i * 4 + 1] = image.data[i * 3 + 1];
        rgba[i * 4 + 2] = image.data[i * 3 + 2];
        rgba[i * 4 + 3] = 255;
    }

    return new RawImage(rgba, w, h, 4);
}

function pushBrushHistory() {
    if (!currentImage) return;

    brushHistory.push(new Uint8ClampedArray(currentImage.data));

    if (brushHistory.length > 12) {
        brushHistory.shift();
    }

    if (brushUndoBtn) {
        brushUndoBtn.disabled = brushHistory.length === 0;
    }
}

function undoBrush() {
    if (!brushHistory.length || !currentImage) return;

    const previous = brushHistory.pop();
    currentImage = new RawImage(previous, currentImage.width, currentImage.height, 4);

    if (brushUndoBtn) {
        brushUndoBtn.disabled = brushHistory.length === 0;
    }

    renderPreview();
}

function resetBrushToAiResult() {
    if (!aiBaseImage) return;

    currentImage = cloneRawImage(aiBaseImage);
    brushHistory = [];

    if (brushUndoBtn) {
        brushUndoBtn.disabled = true;
    }

    renderPreview();
}

function queueRenderPreview() {
    if (renderQueued) return;

    renderQueued = true;

    requestAnimationFrame(() => {
        renderQueued = false;
        renderPreview();
    });
}

function getCanvasPoint(event) {
    const rect = previewCanvas.getBoundingClientRect();

    return {
        x: (event.clientX - rect.left) * (previewCanvas.width / rect.width),
        y: (event.clientY - rect.top) * (previewCanvas.height / rect.height),
    };
}

function applyBrushAt(x, y) {
    if (!currentImage) return;

    const w = currentImage.width;
    const h = currentImage.height;
    const data = currentImage.data;
    const originalData = originalFullImage ? originalFullImage.data : null;

    const radius = parseInt(brushSize?.value || '28', 10);
    const radiusSq = radius * radius;

    const startX = Math.max(0, Math.floor(x - radius));
    const endX = Math.min(w - 1, Math.ceil(x + radius));
    const startY = Math.max(0, Math.floor(y - radius));
    const endY = Math.min(h - 1, Math.ceil(y + radius));

    for (let yy = startY; yy <= endY; yy++) {
        for (let xx = startX; xx <= endX; xx++) {
            const dx = xx - x;
            const dy = yy - y;
            const distSq = dx * dx + dy * dy;

            if (distSq > radiusSq) continue;

            const dist = Math.sqrt(distSq);
            const t = dist / radius;

            // Inner brush solid, outer brush soft.
            let strength;
            if (t <= 0.65) {
                strength = 1;
            } else {
                strength = Math.max(0, (1 - t) / 0.35);
            }

            const idx = (yy * w + xx) * 4;

            if (brushMode === 'erase') {
                // Hapus alpha, tapi dengan pinggir halus.
                data[idx + 3] = Math.round(data[idx + 3] * (1 - strength));
            } else {
                // Pulihkan dari foto asli.
                // Ini bisa mengembalikan rambut/baju yang kepotong AI.
                if (originalData) {
                    data[idx + 0] = Math.round(data[idx + 0] * (1 - strength) + originalData[idx + 0] * strength);
                    data[idx + 1] = Math.round(data[idx + 1] * (1 - strength) + originalData[idx + 1] * strength);
                    data[idx + 2] = Math.round(data[idx + 2] * (1 - strength) + originalData[idx + 2] * strength);
                }

                data[idx + 3] = Math.round(data[idx + 3] * (1 - strength) + 255 * strength);
            }
        }
    }
}

function paintBrushLine(from, to) {
    const radius = parseInt(brushSize?.value || '28', 10);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(distance / Math.max(2, radius * 0.35)));

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        applyBrushAt(
            from.x + dx * t,
            from.y + dy * t
        );
    }

    queueRenderPreview();
}

function setBrushMode(mode) {
    brushMode = mode;
    clearLasso();

    if (brushEraseBtn && brushRestoreBtn && lassoEraseBtn && lassoKeepBtn) {
        brushEraseBtn.classList.toggle('active', mode === 'erase');
        brushRestoreBtn.classList.toggle('active', mode === 'restore');
        lassoEraseBtn.classList.toggle('active', mode === 'lassoErase');
        lassoKeepBtn.classList.toggle('active', mode === 'lassoKeep');
    }

    if (lassoHint) {
        lassoHint.classList.toggle(
            'd-none',
            mode !== 'lassoErase' && mode !== 'lassoKeep'
        );

        if (mode === 'lassoKeep') {
            lassoHint.innerHTML = '<i class="bi bi-info-circle"></i> Lingkari objek utama. Area di luar lasso akan dibuang.';
        } else if (mode === 'lassoErase') {
            lassoHint.innerHTML = '<i class="bi bi-info-circle"></i> Lingkari area sisa background, lalu klik Terapkan.';
        }
    }

    previewCanvas.style.cursor = isBrushActive ? 'crosshair' : 'default';
}

function setBrushActive(active) {
    isBrushActive = active;

    if (brushControls) {
        brushControls.classList.toggle('d-none', !active);
    }

    if (toggleBrushBtn) {
        toggleBrushBtn.textContent = active ? 'Matikan Brush' : 'Aktifkan Brush';
        toggleBrushBtn.classList.toggle('btn-primary', active);
        toggleBrushBtn.classList.toggle('btn-outline-primary', !active);
    }

    previewCanvas.style.cursor = active ? 'crosshair' : 'default';
    previewCanvas.style.touchAction = active ? 'none' : 'auto';
}


function clearLasso() {
    isDrawingLasso = false;
    lassoPoints = [];

    if (lassoActions) {
        lassoActions.classList.add('d-none');
    }

    renderPreview();
}

function drawLassoOverlay() {
    if (!lassoPoints.length) return;

    const ctx = previewCanvas.getContext('2d');

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffc107';
    ctx.fillStyle = 'rgba(255, 193, 7, 0.18)';
    ctx.setLineDash([8, 5]);

    ctx.beginPath();
    ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);

    for (let i = 1; i < lassoPoints.length; i++) {
        ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
    }

    if (!isDrawingLasso && lassoPoints.length >= 3) {
        ctx.closePath();
        ctx.fill();
    }

    ctx.stroke();
    ctx.restore();
}

function pointInPolygon(x, y, polygon) {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;

        const intersect =
            ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.00001) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}

function eraseLassoSelection() {
    if (!currentImage || lassoPoints.length < 3) return;

    pushBrushHistory();

    const w = currentImage.width;
    const h = currentImage.height;
    const data = currentImage.data;

    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;

    for (const p of lassoPoints) {
        minX = Math.min(minX, Math.floor(p.x));
        maxX = Math.max(maxX, Math.ceil(p.x));
        minY = Math.min(minY, Math.floor(p.y));
        maxY = Math.max(maxY, Math.ceil(p.y));
    }

    minX = Math.max(0, minX);
    maxX = Math.min(w - 1, maxX);
    minY = Math.max(0, minY);
    maxY = Math.min(h - 1, maxY);

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (!pointInPolygon(x, y, lassoPoints)) continue;

            const idx = (y * w + x) * 4;
            data[idx + 3] = 0;
        }
    }

    clearLasso();
}


function keepLassoSelection() {
    if (!currentImage || lassoPoints.length < 3) return;

    pushBrushHistory();

    const w = currentImage.width;
    const h = currentImage.height;
    const data = currentImage.data;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (pointInPolygon(x, y, lassoPoints)) continue;

            const idx = (y * w + x) * 4;
            data[idx + 3] = 0;
        }
    }

    clearLasso();
}


// =====================
// Auto Block Main Object
// =====================

function isNearKeptPixel(keepMap, x, y, w, h, radius = 2) {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

            if (keepMap[ny * w + nx]) {
                return true;
            }
        }
    }

    return false;
}

function autoBlockMainObject() {
    if (!currentImage) return;

    pushBrushHistory();

    // Bersihkan lasso kalau masih ada.
    isDrawingLasso = false;
    lassoPoints = [];

    if (lassoActions) {
        lassoActions.classList.add('d-none');
    }

    const w = currentImage.width;
    const h = currentImage.height;
    const data = currentImage.data;

    const alphaThreshold = 28;
    const minComponentPixels = Math.max(40, Math.floor(w * h * 0.00008));

    const visited = new Uint8Array(w * h);
    const components = [];
    const queue = [];

    const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];

    for (let start = 0; start < w * h; start++) {
        if (visited[start]) continue;

        const startAlpha = data[start * 4 + 3];

        if (startAlpha <= alphaThreshold) continue;

        let head = 0;
        queue.length = 0;
        queue.push(start);
        visited[start] = 1;

        const pixels = [];
        let minX = w;
        let maxX = 0;
        let minY = h;
        let maxY = 0;
        let sumX = 0;
        let sumY = 0;

        while (head < queue.length) {
            const current = queue[head++];
            const x = current % w;
            const y = Math.floor(current / w);

            pixels.push(current);
            sumX += x;
            sumY += y;

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

            for (const [dx, dy] of neighbors) {
                const nx = x + dx;
                const ny = y + dy;

                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

                const next = ny * w + nx;
                const nextAlpha = data[next * 4 + 3];

                if (visited[next] || nextAlpha <= alphaThreshold) {
                    continue;
                }

                visited[next] = 1;
                queue.push(next);
            }
        }

        if (pixels.length < minComponentPixels) {
            continue;
        }

        const area = pixels.length;
        const cx = sumX / area;
        const cy = sumY / area;

        const centerScore = 1 - Math.min(1, Math.abs((cx / w) - 0.5) / 0.5);
        const verticalScore = 1 - Math.min(1, Math.abs((cy / h) - 0.55) / 0.55);
        const areaScore = Math.sqrt(area);

        const score = areaScore * (0.70 + centerScore) * (0.70 + verticalScore);

        components.push({
            pixels,
            area,
            minX,
            maxX,
            minY,
            maxY,
            score,
        });
    }

    if (!components.length) {
        renderPreview();
        return;
    }

    components.sort((a, b) => b.score - a.score);

    const main = components[0];
    const keepMap = new Uint8Array(w * h);

    const padding = Math.floor(Math.max(w, h) * 0.055);
    const minNearbyPixels = Math.max(24, Math.floor(main.area * 0.012));

    for (const component of components) {
        const isMain = component === main;
        const isNearby =
            component.area >= minNearbyPixels &&
            boxesOverlap(component, main, padding);

        if (isMain || isNearby) {
            for (const idx of component.pixels) {
                keepMap[idx] = 1;
            }
        }
    }

    // Pertahankan soft edge yang dekat dengan objek utama,
    // tapi buang sisa background kecil yang jauh.
    const finalKeep = new Uint8Array(keepMap);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const alpha = data[idx * 4 + 3];

            if (alpha <= 0) continue;
            if (keepMap[idx]) continue;

            if (alpha <= alphaThreshold && isNearKeptPixel(keepMap, x, y, w, h, 3)) {
                finalKeep[idx] = 1;
            }
        }
    }

    for (let i = 0; i < w * h; i++) {
        if (!finalKeep[i]) {
            data[i * 4 + 3] = 0;
        }
    }

    renderPreview();
}

// =====================
// Render Preview
// =====================
function renderPreview() {
    if (!currentImage) return;
    
    const w = currentImage.width;
    const h = currentImage.height;
    
    previewCanvas.width = w;
    previewCanvas.height = h;
    const ctx = previewCanvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, w, h);
    
    if (currentMode === 'color') {
        // Fill background color
        ctx.fillStyle = currentBgColor;
        ctx.fillRect(0, 0, w, h);
    }
    // If transparent, leave canvas clear (canvas default is transparent)
    
    // Draw foto bg-removed on top
    const imageData = new ImageData(
        new Uint8ClampedArray(currentImage.data),
        w, h
    );
    
    // Use temp canvas for compositing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);
    
    updateDownloadButtonText();
    // console.log('[GantiBg] Rendered mode:', currentMode, 'color:', currentBgColor);

    drawLassoOverlay();
}

// =====================
// Event Listeners
// =====================
selectFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    
    const file = e.target.files[0];
    
    if (file.size > 10 * 1024 * 1024) {
        showError('File terlalu besar. Max 10MB.');
        return;
    }
    
    if (!file.type.startsWith('image/')) {
        showError('File harus berupa gambar (JPG/PNG).');
        return;
    }
    
    if (!isModelLoaded) {
        const ok = await loadModel();
        if (!ok) return;
    }
    
    await processImage(file);
    fileInput.value = '';
});

resetBtn.addEventListener('click', () => {
    currentImage = null;
    aiBaseImage = null;
    originalFullImage = null;

    brushHistory = [];
    isPainting = false;
    lastBrushPoint = null;

    // Reset lasso state
    isDrawingLasso = false;
    lassoPoints = [];

    if (lassoActions) {
        lassoActions.classList.add('d-none');
    }

    if (lassoHint) {
        lassoHint.classList.add('d-none');
    }

    // Reset brush mode ke default
    brushMode = 'erase';

    if (brushEraseBtn && brushRestoreBtn && lassoEraseBtn && lassoKeepBtn) {
        brushEraseBtn.classList.add('active');
        brushRestoreBtn.classList.remove('active');
        lassoEraseBtn.classList.remove('active');
        lassoKeepBtn.classList.remove('active');
    }

    if (brushUndoBtn) {
        brushUndoBtn.disabled = true;
    }

    setBrushActive(false);

    previewCanvas.width = 0;
    previewCanvas.height = 0;
    showState('upload');
});

// PRE-UPLOAD: Mode buttons
modeBtnsPre.forEach(btn => {
    btn.addEventListener('click', () => {
        modeBtnsPre.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        toggleColorPicker(currentMode, true);
        
        // Sync preview state buttons
        modeBtns.forEach(b => {
            if (b.dataset.mode === currentMode) b.classList.add('active');
            else b.classList.remove('active');
        });
        toggleColorPicker(currentMode, false);
    });
});

// PRE-UPLOAD: Color preset buttons
colorPresetsPre.forEach(btn => {
    btn.addEventListener('click', () => {
        colorPresetsPre.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentBgColor = btn.dataset.color;
        colorCustomPre.value = currentBgColor;
        
        // Sync preview state
        colorPresets.forEach(b => {
            if (b.dataset.color === currentBgColor) b.classList.add('active');
            else b.classList.remove('active');
        });
        colorCustom.value = currentBgColor;
    });
});

// PRE-UPLOAD: Custom color picker
colorCustomPre.addEventListener('input', (e) => {
    currentBgColor = e.target.value;
    colorPresetsPre.forEach(b => b.classList.remove('active'));
    
    // Sync
    colorCustom.value = currentBgColor;
    colorPresets.forEach(b => b.classList.remove('active'));
});

// PREVIEW: Mode buttons
modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        toggleColorPicker(currentMode, false);
        renderPreview();
    });
});

// PREVIEW: Color preset buttons
colorPresets.forEach(btn => {
    btn.addEventListener('click', () => {
        colorPresets.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentBgColor = btn.dataset.color;
        colorCustom.value = currentBgColor;
        renderPreview();
    });
});

// PREVIEW: Custom color picker
colorCustom.addEventListener('input', (e) => {
    currentBgColor = e.target.value;
    colorPresets.forEach(b => b.classList.remove('active'));
    renderPreview();
});

// Manual refine brush events
if (toggleBrushBtn) {
    toggleBrushBtn.addEventListener('click', () => {
        setBrushActive(!isBrushActive);
    });
}

if (brushEraseBtn) {
    brushEraseBtn.addEventListener('click', () => {
        setBrushMode('erase');
    });
}

if (brushRestoreBtn) {
    brushRestoreBtn.addEventListener('click', () => {
        setBrushMode('restore');
    });
}

if (lassoEraseBtn) {
    lassoEraseBtn.addEventListener('click', () => {
        setBrushMode('lassoErase');
    });
}

if (lassoKeepBtn) {
    lassoKeepBtn.addEventListener('click', () => {
        setBrushMode('lassoKeep');
    });
}

if (applyLassoBtn) {
    applyLassoBtn.addEventListener('click', () => {
        if (brushMode === 'lassoKeep') {
            keepLassoSelection();
        } else {
            eraseLassoSelection();
        }
    });
}



if (cancelLassoBtn) {
    cancelLassoBtn.addEventListener('click', clearLasso);
}

if (brushSize) {
    brushSize.addEventListener('input', () => {
        if (brushSizeLabel) {
            brushSizeLabel.textContent = `${brushSize.value}px`;
        }
    });
}

if (brushUndoBtn) {
    brushUndoBtn.addEventListener('click', undoBrush);
}

if (brushResetBtn) {
    brushResetBtn.addEventListener('click', resetBrushToAiResult);
}

if (autoBlockBtn) {
    autoBlockBtn.addEventListener('click', autoBlockMainObject);
}

previewCanvas.addEventListener('pointerdown', (event) => {
    if (!isBrushActive || !currentImage) return;

    event.preventDefault();

    const point = getCanvasPoint(event);
    previewCanvas.setPointerCapture(event.pointerId);

    if (brushMode === 'lassoErase' || brushMode === 'lassoKeep') {
        isDrawingLasso = true;
        lassoPoints = [point];

        if (lassoActions) {
            lassoActions.classList.add('d-none');
        }

        renderPreview();
        return;
    }

    pushBrushHistory();

    isPainting = true;
    lastBrushPoint = point;

    applyBrushAt(lastBrushPoint.x, lastBrushPoint.y);
    queueRenderPreview();
});

previewCanvas.addEventListener('pointermove', (event) => {
    if (!isBrushActive || !currentImage) return;

    event.preventDefault();

    const point = getCanvasPoint(event);

    if ((brushMode === 'lassoErase' || brushMode === 'lassoKeep') && isDrawingLasso) {
        const last = lassoPoints[lassoPoints.length - 1];
        const dx = point.x - last.x;
        const dy = point.y - last.y;

        // Jangan terlalu banyak titik agar ringan.
        if (Math.sqrt(dx * dx + dy * dy) > 4) {
            lassoPoints.push(point);
            renderPreview();
        }

        return;
    }

    if (!isPainting) return;

    if (lastBrushPoint) {
        paintBrushLine(lastBrushPoint, point);
    } else {
        applyBrushAt(point.x, point.y);
        queueRenderPreview();
    }

    lastBrushPoint = point;
});

function stopBrushPainting(event) {
    if (!isBrushActive) return;

    event.preventDefault();

    if ((brushMode === 'lassoErase' || brushMode === 'lassoKeep') && isDrawingLasso) {
        isDrawingLasso = false;

        if (lassoPoints.length >= 3 && lassoActions) {
            lassoActions.classList.remove('d-none');
        }

        try {
            previewCanvas.releasePointerCapture(event.pointerId);
        } catch (err) {}

        renderPreview();
        return;
    }

    if (!isPainting) return;

    isPainting = false;
    lastBrushPoint = null;

    try {
        previewCanvas.releasePointerCapture(event.pointerId);
    } catch (err) {}

    renderPreview();
}

previewCanvas.addEventListener('pointerup', stopBrushPainting);
previewCanvas.addEventListener('pointercancel', stopBrushPainting);
previewCanvas.addEventListener('pointerleave', (event) => {
    if (isPainting || isDrawingLasso) {
        stopBrushPainting(event);
    }
});

// Download button
downloadBtn.addEventListener('click', () => {
    if (!currentImage) return;

    if (lassoPoints.length > 0) {
        showError('Terapkan atau batalkan lasso dulu sebelum download.');
        return;
    }
    
    const format = currentMode === 'transparent' ? 'image/png' : 'image/jpeg';
    const ext = currentMode === 'transparent' ? 'png' : 'jpg';
    const filename = `ganti-bg-${Date.now()}-kompresin.${ext}`;
    
    previewCanvas.toBlob((blob) => {
        if (!blob) {
            showError('Gagal generate file. Coba lagi.');
            return;
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('[GantiBg] Downloaded:', filename);
    }, format, 0.95);
});

// =====================
// Init
// =====================
console.log('[GantiBg] Initialized.');
showState('upload');