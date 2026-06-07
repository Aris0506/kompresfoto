// Kompres Foto Tool Logic
(function() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const filePreview = document.getElementById('filePreview');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const removeFile = document.getElementById('removeFile');
    const targetKb = document.getElementById('targetKb');
    const compressBtn = document.getElementById('compressBtn');
    const loadingState = document.getElementById('loadingState');
    const resultState = document.getElementById('resultState');
    const errorState = document.getElementById('errorState');
    const downloadBtn = document.getElementById('downloadBtn');
    const resetBtn = document.getElementById('resetBtn');
    const adSlotResult = document.getElementById('adSlotResult');
    const presets = document.querySelectorAll('.preset');
    const outputFormat = document.getElementById('outputFormat');
    const compressionMode = document.getElementById('compressionMode');
    const compressionModeHint = document.getElementById('compressionModeHint');
    const formatWarning = document.getElementById('formatWarning');
    const formatWarningText = document.getElementById('formatWarningText');
    const resultFormat = document.getElementById('resultFormat');
    const qualityWarning = document.getElementById('qualityWarning');
    const qualityWarningText = document.getElementById('qualityWarningText');
    const precheckWarning = document.getElementById('precheckWarning');
    const precheckWarningText = document.getElementById('precheckWarningText');

    let selectedFile = null;
    let selectedImageMeta = null;
    let filePickToken = 0;

    function formatSize(kb) {
        if (kb < 1024) return kb.toFixed(1) + ' KB';
        return (kb / 1024).toFixed(2) + ' MB';
    }

    function getFileExt(filename) {
    return (filename || '').split('.').pop().toLowerCase();
    }

    function getEffectiveOutputFormat() {
        if (!outputFormat) return 'jpg';

        const selectedFormat = outputFormat.value;

        if (selectedFormat !== 'auto') {
            return selectedFormat;
        }

        if (!selectedFile) {
            return 'jpg';
        }

        const ext = getFileExt(selectedFile.name);

        if (ext === 'jpeg') return 'jpg';
        if (['jpg', 'png', 'webp'].includes(ext)) return ext;

        return 'jpg';
    }

    function readImageMeta(file) {
        return new Promise((resolve) => {
            if (!file || !file.type || !file.type.startsWith('image/')) {
                resolve(null);
                return;
            }

            const objectUrl = URL.createObjectURL(file);
            const img = new Image();

            img.onload = () => {
                const meta = {
                    width: img.naturalWidth || img.width,
                    height: img.naturalHeight || img.height
                };

                URL.revokeObjectURL(objectUrl);
                resolve(meta);
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(null);
            };

            img.src = objectUrl;
        });
    }
    

    function getCompressionPrecheckMessage() {
        if (!selectedFile || !targetKb || !selectedImageMeta) {
            return '';
        }

        const target = parseInt(targetKb.value);
        if (!target || target < 10) {
            return '';
        }

        const originalKb = selectedFile.size / 1024;
        const format = getEffectiveOutputFormat();
        const mode = compressionMode ? compressionMode.value : 'balanced';

        const width = selectedImageMeta.width || 0;
        const height = selectedImageMeta.height || 0;
        const megapixels = Math.max((width * height) / 1000000, 0.1);

        const ratio = target / originalKb;
        const targetPerMegapixel = target / megapixels;

        const resolutionText = width && height ? `${width}×${height}px` : 'resolusi foto ini';

        if (target >= originalKb * 0.95) {
            return '';
        }

        if (format === 'png') {
            if (ratio < 0.5 || targetPerMegapixel < 350) {
                return `Target ${target}KB cukup berat untuk PNG ${resolutionText}. PNG biasanya sulit dibuat kecil tanpa ukuran file tetap besar. Kalau tidak butuh transparansi, JPG atau WebP lebih cocok.`;
            }

            return '';
        }

        let severeRatio = 0.08;
        let tightRatio = 0.20;
        let severePerMp = 90;
        let tightPerMp = 170;

        if (mode === 'fast') {
            severeRatio = 0.06;
            tightRatio = 0.15;
            severePerMp = 70;
            tightPerMp = 130;
        } else if (mode === 'quality') {
            severeRatio = 0.12;
            tightRatio = 0.28;
            severePerMp = 120;
            tightPerMp = 220;
        }

        if (format === 'webp') {
            severeRatio *= 0.75;
            tightRatio *= 0.75;
            severePerMp *= 0.75;
            tightPerMp *= 0.75;
        }

        if (ratio < severeRatio || targetPerMegapixel < severePerMp) {
            if (mode === 'quality') {
                return `Target ${target}KB sangat kecil untuk foto ${resolutionText}. Mode Kualitas Max akan menjaga detail, jadi hasil mungkin tidak persis masuk target agar foto tidak pecah.`;
            }

            if (format !== 'webp') {
                return `Target ${target}KB sangat kecil untuk foto ${resolutionText}. Hasil mungkin tidak bisa pas target tanpa menurunkan kualitas. Kalau wajib kecil, coba mode Cepat atau format WebP.`;
            }

            return `Target ${target}KB sangat kecil untuk foto ${resolutionText}. WebP sudah cukup efisien, tapi hasil tetap mungkin lewat target kalau kualitas perlu dijaga.`;
        }

        if (ratio < tightRatio || targetPerMegapixel < tightPerMp) {
            if (mode === 'quality') {
                return `Target ${target}KB cukup ketat untuk foto ${resolutionText}. Mode Kualitas Max bisa menghasilkan file sedikit di atas target demi menjaga detail.`;
            }

            return `Target ${target}KB cukup ketat untuk foto ${resolutionText}. Kompresin akan coba mengejar target, tapi tetap menjaga agar hasil tidak terlalu pecah.`;
        }

        return '';
    }

    function updatePrecheckWarning() {
        if (!precheckWarning || !precheckWarningText) {
            return;
        }

        const message = getCompressionPrecheckMessage();

        if (message) {
            precheckWarningText.textContent = message;
            precheckWarning.classList.remove('d-none');
        } else {
            precheckWarningText.textContent = '';
            precheckWarning.classList.add('d-none');
        }
    }

    async function showFile(file) {
        const currentToken = ++filePickToken;

        selectedFile = file;
        selectedImageMeta = null;

        fileName.textContent = file.name;
        fileSize.textContent = formatSize(file.size / 1024);
        filePreview.classList.remove('d-none');
        uploadZone.classList.add('d-none');
        compressBtn.disabled = false;
        errorState.classList.add('d-none');
        resultState.classList.add('d-none');

        updateFormatWarning();
        updatePrecheckWarning();

        const meta = await readImageMeta(file);

        // Kalau user cepat ganti file, jangan pakai hasil baca file lama.
        if (currentToken !== filePickToken) {
            return;
        }

        selectedImageMeta = meta;
        updatePrecheckWarning();
    }

    function resetAll() {
        selectedFile = null;
        selectedImageMeta = null;
        filePickToken++;

        fileInput.value = '';
        filePreview.classList.add('d-none');
        uploadZone.classList.remove('d-none');
        resultState.classList.add('d-none');
        errorState.classList.add('d-none');

        if (qualityWarning) {
            qualityWarning.classList.add('d-none');
        }

        if (qualityWarningText) {
            qualityWarningText.textContent = '';
        }

        if (precheckWarning) {
            precheckWarning.classList.add('d-none');
        }

        if (precheckWarningText) {
            precheckWarningText.textContent = '';
        }

        if (adSlotResult) adSlotResult.classList.add('d-none');

        compressBtn.disabled = true;
        compressBtn.classList.remove('d-none');

        if (resultFormat) resultFormat.textContent = '';
    }

    function showError(msg) {
        errorState.textContent = msg;
        errorState.classList.remove('d-none');
        loadingState.classList.add('d-none');
        compressBtn.classList.remove('d-none');
        compressBtn.disabled = false;
    }

    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) showFile(e.target.files[0]);
    });

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) showFile(e.dataTransfer.files[0]);
    });

    removeFile.addEventListener('click', resetAll);
    resetBtn.addEventListener('click', resetAll);

    presets.forEach(btn => {
        btn.addEventListener('click', () => {
            targetKb.value = btn.dataset.kb;
            presets.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateFormatWarning();
            updatePrecheckWarning();
        });
    });

    // Update warning saat dropdown atau target KB berubah
    function updateFormatWarning() {
        const format = outputFormat.value;
        const target = parseInt(targetKb.value) || 0;
        const fileExt = selectedFile ? selectedFile.name.split('.').pop().toLowerCase() : null;

        let warning = '';

        if (format === 'png' && target <= 300) {
            warning = 'PNG kompresinya rendah. Untuk hit target di bawah 300KB, JPG lebih cocok.';
        } else if (format === 'webp') {
            warning = 'Pastikan platform tujuan support WebP. SSCASN gak terima WebP.';
        } else if (format === 'jpg' && fileExt === 'png') {
            warning = 'JPG gak support transparansi. Background transparan akan jadi putih.';
        }

        if (warning) {
            formatWarningText.textContent = warning;
            formatWarning.classList.remove('d-none');
        } else {
            formatWarning.classList.add('d-none');
        }
    }

    function updateCompressionModeHint() {
        if (!compressionMode || !compressionModeHint) return;

        const mode = compressionMode.value;

        if (mode === 'fast') {
            compressionModeHint.innerHTML = '<i class="bi bi-lightning-charge"></i> Mode Cepat lebih ngebut, cocok untuk kebutuhan biasa.';
        } else if (mode === 'quality') {
            compressionModeHint.innerHTML = '<i class="bi bi-gem"></i> Mode Kualitas Max lebih menjaga detail foto, tapi proses bisa sedikit lebih lama.';
        } else {
            compressionModeHint.innerHTML = '<i class="bi bi-shield-check"></i> Mode Seimbang menjaga hasil tetap jelas dan tidak dipaksa jadi pecah.';
        }
   }

    outputFormat.addEventListener('change', () => {
        updateFormatWarning();
        updatePrecheckWarning();
    });

    targetKb.addEventListener('input', () => {
        updateFormatWarning();
        updatePrecheckWarning();
    });

    if (compressionMode) {
        compressionMode.addEventListener('change', () => {
            updateCompressionModeHint();
            updatePrecheckWarning();
        });

        updateCompressionModeHint();
    }

    compressBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        const target = parseInt(targetKb.value);
        if (!target || target < 10 || target > 5000) {
            showError('Target size harus 10KB - 5000KB');
            return;
        }

        updatePrecheckWarning();

        compressBtn.classList.add('d-none');
        loadingState.classList.remove('d-none');
        errorState.classList.add('d-none');

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('target_kb', target);
        formData.append('output_format', outputFormat.value);
        formData.append('compression_mode', compressionMode ? compressionMode.value : 'balanced');

        try {
            const res = await fetch('/api/compress', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            // console.log('DEBUG response:', data);   // ← TAMBAH INI
            // console.log('DEBUG res.ok:', res.ok);   // ← TAMBAH INI

            loadingState.classList.add('d-none');

            if (!res.ok || !data.success) {
                showError(data.error || 'Gagal kompres, coba lagi');
                return;
            }

        document.getElementById('resultOriginal').textContent = formatSize(data.original_size_kb);
        document.getElementById('resultFinal').textContent = formatSize(data.final_size_kb);
        document.getElementById('resultReduction').textContent = data.reduction_percent + '%';

        downloadBtn.href = data.download_url;

        if (resultFormat) {
            resultFormat.textContent = data.output_format ? data.output_format.toUpperCase() : '';
        }

        if (data.warning && qualityWarning && qualityWarningText) {
            qualityWarningText.textContent = data.warning;
            qualityWarning.classList.remove('d-none');
        } else if (qualityWarning) {
            qualityWarning.classList.add('d-none');
        }

        resultState.classList.remove('d-none');

        if (adSlotResult) adSlotResult.classList.remove('d-none');
        } catch (err) {
            showError('Network error, coba refresh ya');
        }
    });
})();
