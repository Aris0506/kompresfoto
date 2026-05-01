// Smart Homepage Logic - Auto detect file & suggest tools
(function() {
    const uploadZone = document.getElementById('smartUploadZone');
    const fileInput = document.getElementById('smartFileInput');
    const optionsArea = document.getElementById('smartOptions');
    const optionsList = document.getElementById('smartOptionsList');
    const fileName = document.getElementById('detectedFileName');
    const fileSize = document.getElementById('detectedFileSize');
    const resetBtn = document.getElementById('resetSmart');

    let selectedFile = null;

    function formatSize(bytes) {
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function handleFile(file) {
        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = formatSize(file.size);

        // Detect file type lokal (gak perlu hit API, lebih cepet)
        const ext = file.name.split('.').pop().toLowerCase();
        const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext);
        const isPdf = ext === 'pdf';

        let options = [];
        if (isImage) {
            options = [
                { icon: 'bi-aspect-ratio', label: 'Kecilin Ukuran', desc: 'Sesuai target KB', route: '/kompres-foto', ready: true },
                { icon: 'bi-person-vcard', label: 'Bikin Pas Foto', desc: 'Ukuran 2x3, 3x4, 4x6', route: '/pas-foto', ready: false },
                { icon: 'bi-palette', label: 'Ganti Background', desc: 'Pilih warna baru', route: '/ganti-background', ready: false },
            ];
        } else if (isPdf) {
            options = [
                { icon: 'bi-file-earmark-pdf', label: 'Kecilin Ukuran PDF', desc: 'Tetap bisa dibaca', route: '/kompres-pdf', ready: false },
            ];
        } else {
            alert('Format file gak didukung. Pake foto (JPG/PNG/WebP) atau PDF ya.');
            return;
        }

        renderOptions(options);
        uploadZone.classList.add('d-none');
        optionsArea.classList.remove('d-none');
    }

    function renderOptions(options) {
        optionsList.innerHTML = options.map(opt => `
            <div class="col-md-${options.length === 1 ? '12' : '4'}">
                <button class="smart-option-btn" data-route="${opt.route}">
                    <div class="smart-option-icon">
                        <i class="bi ${opt.icon}"></i>
                    </div>
                    <div class="fw-semibold">${opt.label}</div>
                    <small class="text-muted">${opt.desc}</small>
                    ${!opt.ready ? '<div class="mt-2"><span class="badge bg-warning text-dark">Coming Soon</span></div>' : '<div class="mt-2"><span class="badge bg-success">Ready</span></div>'}
                </button>
            </div>
        `).join('');

        // Attach click handlers
        optionsList.querySelectorAll('.smart-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const route = btn.dataset.route;
                // Note: file gak otomatis ke-pass karena security browser. User reupload di tool page.
                // Untuk simpan di sessionStorage gak reliable buat file gede.
                window.location.href = route;
            });
        });
    }

    function resetAll() {
        selectedFile = null;
        fileInput.value = '';
        optionsArea.classList.add('d-none');
        uploadZone.classList.remove('d-none');
    }

    // Click upload
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
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
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    resetBtn.addEventListener('click', resetAll);
})();
