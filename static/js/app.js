// KompresFoto.id - Frontend Logic
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

    let selectedFile = null;

    function formatSize(kb) {
        if (kb < 1024) return kb.toFixed(1) + ' KB';
        return (kb / 1024).toFixed(2) + ' MB';
    }

    function showFile(file) {
        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = formatSize(file.size / 1024);
        filePreview.classList.remove('d-none');
        uploadZone.classList.add('d-none');
        compressBtn.disabled = false;
        errorState.classList.add('d-none');
    }

    function resetAll() {
        selectedFile = null;
        fileInput.value = '';
        filePreview.classList.add('d-none');
        uploadZone.classList.remove('d-none');
        resultState.classList.add('d-none');
        errorState.classList.add('d-none');
        adSlotResult.classList.add('d-none');
        compressBtn.disabled = true;
        compressBtn.classList.remove('d-none');
    }

    function showError(msg) {
        errorState.textContent = msg;
        errorState.classList.remove('d-none');
        loadingState.classList.add('d-none');
        compressBtn.classList.remove('d-none');
        compressBtn.disabled = false;
    }

    // Click upload
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) showFile(e.target.files[0]);
    });

    // Drag & drop
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

    // Remove file
    removeFile.addEventListener('click', resetAll);
    resetBtn.addEventListener('click', resetAll);

    // Presets
    presets.forEach(btn => {
        btn.addEventListener('click', () => {
            targetKb.value = btn.dataset.kb;
            presets.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Compress action
    compressBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        const target = parseInt(targetKb.value);
        if (!target || target < 10 || target > 5000) {
            showError('Target size harus 10KB - 5000KB');
            return;
        }

        compressBtn.classList.add('d-none');
        loadingState.classList.remove('d-none');
        errorState.classList.add('d-none');

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('target_kb', target);

        try {
            const res = await fetch('/api/compress', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            loadingState.classList.add('d-none');

            if (!res.ok || !data.success) {
                showError(data.error || 'Gagal kompres, coba lagi');
                return;
            }

            // Tampilkan hasil
            document.getElementById('resultOriginal').textContent = formatSize(data.original_size_kb);
            document.getElementById('resultFinal').textContent = formatSize(data.final_size_kb);
            document.getElementById('resultReduction').textContent = data.reduction_percent + '%';
            downloadBtn.href = data.download_url;
            resultState.classList.remove('d-none');
            adSlotResult.classList.remove('d-none'); // Show ad after success
        } catch (err) {
            showError('Network error, coba refresh ya');
        }
    });
})();
