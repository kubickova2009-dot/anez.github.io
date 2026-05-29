// 3D Page-Flip Book Viewer with PDF.js and Web Audio Synthesis

// Global State
let pageFlip = null;
let pdfDoc = null;
let audioCtx = null;
let autoplayInterval = null;
let currentPdfSource = null;
let flippingSpeed = 1000; // default speed in ms
let zoomLevel = 1.0;
let isPanning = false;
let startPanX = 0, startPanY = 0;
let panOffsetX = 0, panOffsetY = 0;

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// DOM Elements
const bookElement = document.getElementById('book');
const bookWrapper = document.getElementById('bookWrapper');
const appContainer = document.getElementById('appContainer');
const sidebarPanel = document.getElementById('sidebarPanel');
const sidebarToggle = document.getElementById('sidebarToggle');
const themeOpts = document.querySelectorAll('.theme-opt');
const soundToggle = document.getElementById('soundToggle');
const autoplayToggle = document.getElementById('autoplayToggle');
const speedSlider = document.getElementById('speedSlider');
const speedVal = document.getElementById('speedVal');
const pageIndicator = document.getElementById('pageIndicator');
const pageScrubber = document.getElementById('pageScrubber');
// Upload and metadata elements omitted

// Navigation Buttons
const firstPageBtn = document.getElementById('firstPageBtn');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const lastPageBtn = document.getElementById('lastPageBtn');

// Cache of default HTML pages for fallback / reset
const defaultHtmlPages = bookElement.innerHTML;

// 1. Initial Launch Setup
document.addEventListener('DOMContentLoaded', () => {
    // Try to load the default PDF in the workspace
    loadDefaultPDF();
    
    // Bind UI Events
    initUIEvents();
});

// 2. Load the User's Default PDF
async function loadDefaultPDF() {
    try {
        console.log("Attempting to load default workspace PDF...");
        const response = await fetch('Dokument bez názvu.pdf');
        if (!response.ok) {
            throw new Error("Default PDF not found or failed to fetch");
        }
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        
        // Loaded successfully
        await loadBookFromPDF(arrayBuffer);
    } catch (err) {
        console.warn("Could not load default PDF, falling back to styled HTML demo pages:", err.message);
        // Load default HTML preview
        initPageFlipFromHTML();
    }
}

// 3. Render PDF pages to canvases and load into flipbook
async function loadBookFromPDF(pdfDataBuffer) {
    showLoadingState(true);
    
    try {
        // Load document via PDF.js
        pdfDoc = await pdfjsLib.getDocument({ data: pdfDataBuffer }).promise;
        const totalPages = pdfDoc.numPages;
        console.log(`PDF successfully parsed. Pages: ${totalPages}`);
        
        // Clear book mount point
        bookElement.innerHTML = '';
        
        // Render PDF pages sequentially to avoid browser UI blocking
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'page';
            
            // Hard cover style for first and last page
            if (pageNum === 1 || pageNum === totalPages) {
                pageDiv.setAttribute('data-density', 'hard');
            }
            
            const pageContainer = document.createElement('div');
            pageContainer.className = 'page-container';
            
            const canvas = document.createElement('canvas');
            canvas.className = 'page-canvas';
            
            const overlay = document.createElement('div');
            overlay.className = 'page-overlay';
            
            pageContainer.appendChild(canvas);
            pageContainer.appendChild(overlay);
            pageDiv.appendChild(pageContainer);
            bookElement.appendChild(pageDiv);
            
            // Render PDF page to canvas
            const page = await pdfDoc.getPage(pageNum);
            
            // We use a high viewport scale for crisp text on high DPI monitors
            const viewport = page.getViewport({ scale: 2.0 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            const renderContext = {
                canvasContext: canvas.getContext('2d'),
                viewport: viewport
            };
            
            await page.render(renderContext).promise;
            console.log(`Rendered page ${pageNum}/${totalPages}`);
        }
        
        // Initialize/Re-initialize StPageFlip
        initPageFlipInstance();
        
    } catch (err) {
        console.error("Error loading PDF pages: ", err);
        alert("Chyba při zpracování PDF souboru.");
        showLoadingState(false);
    }
}

// 4. Initialize StPageFlip on the HTML pages (Fallback)
function initPageFlipFromHTML() {
    bookElement.innerHTML = defaultHtmlPages;
    initPageFlipInstance();
}

// 5. Build/Rebuild the StPageFlip Instance
function initPageFlipInstance() {
    // If instance already exists, destroy it first to avoid conflicts
    if (pageFlip) {
        pageFlip.destroy();
    }
    
    const pages = bookElement.querySelectorAll('.page');
    if (pages.length === 0) return;
    
    // Define page dimensions (A5 standard aspect ratio 1:1.414)
    // base page width 600px, height 848px
    pageFlip = new St.PageFlip(bookElement, {
        width: 600,
        height: 848,
        size: "stretch",
        minWidth: 320,
        maxWidth: 1000,
        minHeight: 452,
        maxHeight: 1414,
        drawShadow: true,
        maxShadowOpacity: 0.7, // deeper shadows for realistic depth
        showCover: true,
        usePortrait: true,
        flippingTime: flippingSpeed,
        mobileScrollSupport: true
    });
    
    // Load pages into StPageFlip
    pageFlip.loadFromHTML(pages);
    
    // Setup Scrubber maximum range
    pageScrubber.max = pages.length - 1;
    pageScrubber.value = 0;
    
    // Register events
    pageFlip.on('flip', (e) => {
        const pageIndex = e.data;
        updatePageControls(pageIndex, pages.length);
        
        // Play synthesized paper turn sound
        if (soundToggle.checked) {
            playPageTurnSound();
        }
    });
    
    pageFlip.on('changeOrientation', (e) => {
        const orientation = e.data;
        if (orientation === 'portrait') {
            document.body.classList.add('portrait-view');
        } else {
            document.body.classList.remove('portrait-view');
        }
    });
    
    // Initial controls update
    updatePageControls(0, pages.length);
    showLoadingState(false);
}

// 6. Synthesis of a natural page rustling sound using Web Audio API
function playPageTurnSound() {
    try {
        // Lazy initialize AudioContext on user gesture
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const duration = 0.55; // sound length in seconds
        
        // 1. Create a buffer of white noise
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        // 2. Create the audio source node
        const noiseNode = audioCtx.createBufferSource();
        noiseNode.buffer = buffer;
        
        // 3. Create bandpass filter for rustling paper texture
        const bandpassFilter = audioCtx.createBiquadFilter();
        bandpassFilter.type = 'bandpass';
        bandpassFilter.Q.value = 2.0;
        
        // Frequency sweep downwards to mimic sliding/rubbing paper sheets
        bandpassFilter.frequency.setValueAtTime(1600, audioCtx.currentTime);
        bandpassFilter.frequency.exponentialRampToValueAtTime(350, audioCtx.currentTime + duration);
        
        // 4. Create lowpass filter to add weight/softness to the flap
        const lowpassFilter = audioCtx.createBiquadFilter();
        lowpassFilter.type = 'lowpass';
        lowpassFilter.frequency.setValueAtTime(800, audioCtx.currentTime);
        lowpassFilter.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + duration);
        
        // 5. Gain envelope for volume shaping
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.08); // fast attack
        
        // Rustling micro-modulations (gain waves)
        for (let t = 0.08; t < duration - 0.15; t += 0.04) {
            const modVal = 0.04 + Math.random() * 0.05;
            gainNode.gain.setValueAtTime(modVal, audioCtx.currentTime + t);
        }
        
        // Fade out decay
        gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime + duration - 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        
        // 6. Connections
        noiseNode.connect(bandpassFilter);
        bandpassFilter.connect(lowpassFilter);
        lowpassFilter.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        // Start playback
        noiseNode.start();
        noiseNode.stop(audioCtx.currentTime + duration);
        
    } catch (e) {
        console.warn("Web Audio API not fully initialized or blocked:", e);
    }
}

// 7. Update UI controls (scrubber and labels)
function updatePageControls(index, total) {
    pageScrubber.value = index;
    
    if (pageFlip) {
        const orientation = pageFlip.getOrientation();
        if (orientation === 'landscape' && index > 0 && index < total - 1) {
            // In double page spread mode, we show two pages (e.g. Pages 2-3 of 8)
            const leftPage = index;
            const rightPage = index + 1;
            pageIndicator.textContent = `Strana ${leftPage}-${rightPage} z ${total}`;
        } else {
            // Single page cover/back or portrait mode
            pageIndicator.textContent = `Strana ${index + 1} z ${total}`;
        }
    }
}

// 8. Bind all UI & File Upload Events
function initUIEvents() {
    // Collapsible Sidebar Drawer
    sidebarToggle.addEventListener('click', () => {
        sidebarPanel.classList.toggle('collapsed');
        appContainer.classList.toggle('sidebar-collapsed');
        
        // Let the book container update layout after size change transition
        setTimeout(() => {
            if (pageFlip) pageFlip.update();
        }, 310);
    });
    
    // Theme Selectors
    themeOpts.forEach(opt => {
        opt.addEventListener('click', () => {
            themeOpts.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            
            const theme = opt.getAttribute('data-theme');
            document.body.className = `theme-${theme}`;
        });
    });
    
    // Speed Slider
    speedSlider.addEventListener('input', (e) => {
        flippingSpeed = parseInt(e.target.value);
        speedVal.textContent = `${flippingSpeed}ms`;
        
        // Reinitialize to apply new turning speed
        if (pageFlip) {
            const curPage = pageFlip.getCurrentPageIndex();
            initPageFlipInstance();
            pageFlip.turnToPage(curPage);
        }
    });
    
    // Autoplay logic
    autoplayToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            startAutoplay();
        } else {
            stopAutoplay();
        }
    });
    
    // No upload listeners needed
    
    // Book Navigation Buttons
    firstPageBtn.addEventListener('click', () => {
        if (pageFlip) pageFlip.turnToPage(0);
    });
    
    prevPageBtn.addEventListener('click', () => {
        if (pageFlip) pageFlip.flipPrev();
    });
    
    nextPageBtn.addEventListener('click', () => {
        if (pageFlip) pageFlip.flipNext();
    });
    
    lastPageBtn.addEventListener('click', () => {
        if (pageFlip) {
            const pages = bookElement.querySelectorAll('.page');
            pageFlip.turnToPage(pages.length - 1);
        }
    });
    
    // Page Scrubber range changes
    pageScrubber.addEventListener('input', (e) => {
        if (pageFlip) {
            const targetPage = parseInt(e.target.value);
            pageFlip.turnToPage(targetPage);
        }
    });
    
    // Zoom Buttons Events
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    
    zoomInBtn.addEventListener('click', () => {
        if (zoomLevel < 2.5) {
            zoomLevel += 0.25;
            updateZoom();
        }
    });
    
    zoomOutBtn.addEventListener('click', () => {
        if (zoomLevel > 1.0) {
            zoomLevel -= 0.25;
            updateZoom();
        }
    });
}

// Uploaded file processor removed

// 10. Start Autoplay Timer
function startAutoplay() {
    stopAutoplay();
    autoplayInterval = setInterval(() => {
        if (pageFlip) {
            const cur = pageFlip.getCurrentPageIndex();
            const total = pageScrubber.max;
            if (cur >= total) {
                // Wrap around back to front page
                pageFlip.turnToPage(0);
            } else {
                pageFlip.flipNext();
            }
        }
    }, 4000);
}

function stopAutoplay() {
    if (autoplayInterval) {
        clearInterval(autoplayInterval);
        autoplayInterval = null;
    }
}

// Removed metadata helpers

function showLoadingState(isLoading) {
    if (isLoading) {
        bookWrapper.style.opacity = '0.5';
        bookWrapper.style.pointerEvents = 'none';
    } else {
        bookWrapper.style.opacity = '1';
        bookWrapper.style.pointerEvents = 'auto';
    }
}

// 11. Zoom and Drag Panning logic
function updateZoom() {
    const zoomLevelVal = document.getElementById('zoomLevelVal');
    zoomLevelVal.textContent = `${Math.round(zoomLevel * 100)}%`;
    
    if (zoomLevel === 1.0) {
        panOffsetX = 0;
        panOffsetY = 0;
        bookWrapper.style.cursor = 'default';
        bookWrapper.style.transition = 'transform 0.3s ease-out'; // smooth transition back to center
    } else {
        bookWrapper.style.cursor = 'grab';
        bookWrapper.style.transition = 'none'; // snappy response when dragging
    }
    
    applyTransform();
}

function applyTransform() {
    bookWrapper.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px) scale(${zoomLevel})`;
}

// Set up Pan events on the background container (.book-container-outer)
const bookContainerOuter = document.querySelector('.book-container-outer');

bookContainerOuter.addEventListener('mousedown', (e) => {
    // Only allow panning if zoomed in
    if (zoomLevel > 1.0) {
        // Ignore clicks on controls/sidebar
        if (e.target.closest('.bottom-controls-container') || e.target.closest('.sidebar') || e.target.closest('.sidebar-toggle') || e.target.closest('.zoom-controls')) {
            return;
        }
        isPanning = true;
        bookContainerOuter.style.cursor = 'grabbing';
        bookWrapper.style.cursor = 'grabbing';
        startPanX = e.clientX - panOffsetX;
        startPanY = e.clientY - panOffsetY;
        
        // Prevent event propagation so StPageFlip doesn't flip pages when dragging
        e.stopPropagation();
        e.preventDefault();
    }
}, true); // Use capture phase to intercept mouse events before StPageFlip receives them

window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panOffsetX = e.clientX - startPanX;
    panOffsetY = e.clientY - startPanY;
    
    // Limit pan offset to prevent dragging the book fully off-screen
    const maxPan = 600 * zoomLevel;
    panOffsetX = Math.max(-maxPan, Math.min(maxPan, panOffsetX));
    panOffsetY = Math.max(-maxPan, Math.min(maxPan, panOffsetY));
    
    applyTransform();
});

window.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        bookContainerOuter.style.cursor = 'default';
        bookWrapper.style.cursor = 'grab';
    }
});

// Touch panning support for mobile/tablet screens
bookContainerOuter.addEventListener('touchstart', (e) => {
    if (zoomLevel > 1.0 && e.touches.length === 1) {
        // Ignore touches on controls/sidebar
        if (e.target.closest('.bottom-controls-container') || e.target.closest('.sidebar') || e.target.closest('.sidebar-toggle') || e.target.closest('.zoom-controls')) {
            return;
        }
        isPanning = true;
        startPanX = e.touches[0].clientX - panOffsetX;
        startPanY = e.touches[0].clientY - panOffsetY;
        
        // Prevent event propagation so StPageFlip doesn't flip pages when dragging
        e.stopPropagation();
    }
}, true); // Use capture phase

window.addEventListener('touchmove', (e) => {
    if (!isPanning || e.touches.length !== 1) return;
    panOffsetX = e.touches[0].clientX - startPanX;
    panOffsetY = e.touches[0].clientY - startPanY;
    applyTransform();
});

window.addEventListener('touchend', () => {
    isPanning = false;
});
