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
env.useBrowserCache = true; // cache model di IndexedDB browser

// =====================
// DOM Elements
// =====================
const uploadZone = document.getElementById('uploadZone');
const selectFileBtn = document.getElementById('selectFileBtn');
const fileInput = document.getElementById('fileInput');
const aiLoadingState = document.getElementById('aiLoadingState');
const aiProgressBar = document.getElementById('aiProgressBar');
const aiLoadingDetail = document.getElementById('aiLoadingDetail');
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

function updateProgress(percent, detail) {
    aiProgressBar.style.width = percent + '%';
    aiProgressBar.textContent = Math.round(percent) + '%';
    if (detail) aiLoadingDetail.textContent = detail;
}

// =====================
// Load AI Model (Lazy)
// =====================
async function loadModel() {
    if (isModelLoaded) return true;
    
    showState('aiLoading');
    updateProgress(0, 'Mempersiapkan AI model...');
    
    try {
        const modelId = 'briaai/RMBG-1.4';
        
        // Load model with progress callback
        aiModel = await AutoModel.from_pretrained(modelId, {
            quantized: true, // 8-bit quantized (~45MB)
            progress_callback: (progress) => {
                if (progress.status === 'progress') {
                    const percent = (progress.loaded / progress.total) * 100;
                    updateProgress(percent, `Loading: ${progress.file} (${Math.round(percent)}%)`);
                } else if (progress.status === 'done') {
                    updateProgress(95, `Loaded: ${progress.file}`);
                }
            }
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
        
        updateProgress(100, 'AI model siap!');
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
        
        // Combine original RGB + mask alpha
        const result = mergeImageAndMask(image, mask);
        currentImage = result;
        
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