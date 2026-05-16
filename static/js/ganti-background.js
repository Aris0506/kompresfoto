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
env.useBrowserCache = true;

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
const downloadBtn = document.getElementById('downloadBtn');
const downloadFormat = document.getElementById('downloadFormat');

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
let currentMode = 'color'; // 'color' or 'transparent'
let currentBgColor = '#FFFFFF';

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

function updateProgress(percent, detail) {
    aiProgressBar.style.width = percent + '%';
    aiProgressBar.textContent = Math.round(percent) + '%';
    if (detail) aiLoadingDetail.textContent = detail;
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
    updateProgress(0, 'Mempersiapkan AI model...');
    
    try {
        const modelId = 'briaai/RMBG-1.4';
        
        aiModel = await AutoModel.from_pretrained(modelId, {
            quantized: true,
            progress_callback: (progress) => {
                if (progress.status === 'progress') {
                    const percent = (progress.loaded / progress.total) * 100;
                    updateProgress(percent, `Loading: ${progress.file} (${Math.round(percent)}%)`);
                } else if (progress.status === 'done') {
                    updateProgress(95, `Loaded: ${progress.file}`);
                }
            }
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
        
        updateProgress(100, 'AI model siap!');
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

// =====================
// Process Image
// =====================
async function processImage(file) {
    showState('processing');
    
    try {
        const imageUrl = URL.createObjectURL(file);
        const image = await RawImage.fromURL(imageUrl);
        URL.revokeObjectURL(imageUrl);
        
        console.log('[GantiBg] Image:', image.width, 'x', image.height);
        
        const { pixel_values } = await aiProcessor(image);
        const { output } = await aiModel({ input: pixel_values });
        
        const mask = await RawImage.fromTensor(
            output[0].mul(255).to('uint8')
        ).resize(image.width, image.height);
        
        const result = mergeImageAndMask(image, mask);
        currentImage = result;
        
        renderPreview();
        showState('preview');
        
        console.log('[GantiBg] Done');
        
    } catch (err) {
        console.error('[GantiBg] Process error:', err);
        showError('Gagal proses foto. Coba foto lain.');
        showState('upload');
    }
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
    console.log('[GantiBg] Rendered mode:', currentMode, 'color:', currentBgColor);
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

// Download button
downloadBtn.addEventListener('click', () => {
    if (!currentImage) return;
    
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