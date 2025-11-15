// THE GOOD STUFF BELOW

// -----------------------
// DOM element holders
// These are assigned inside attachEventHandlersAndStart() after the DOM is ready.
// -----------------------
let video, detectButton, emergencyButton, statusIndicator, detectionLog, progressFill, progressPercentage;

// -----------------------
// Configuration (easy-to-change values)
// -----------------------
// How often the client polls and updates the UI (milliseconds)
const DEFAULT_PRINT_UPDATE_INTERVAL_MS = 10000; // 10 seconds
let printUpdateIntervalMs = DEFAULT_PRINT_UPDATE_INTERVAL_MS;

// Total print duration used to estimate progress increments (seconds)
// You can change this at runtime with PrinterUI.setPrintDuration(seconds)
let printTotalDurationSec = 10 * 60 * 60; // default change this for demo

// Easy-to-access default vitals (change these near the top)
// - Layer: current / total
const DEFAULT_LAYER_CURRENT = 1; // change this for demo
const DEFAULT_LAYER_TOTAL = 30; // change this for demo
// - Temperatures (numbers only, UI appends °C)
const DEFAULT_FILAMENT_TEMP = 215; // change this for demo
const DEFAULT_BED_TEMP = 60; // change this for demo
// - If no DOM time is provided, time remaining defaults to the full print duration
const DEFAULT_TIME_REMAINING_SEC = printTotalDurationSec;

// -----------------------
// Internal state for periodic updates
// -----------------------
let isDetecting = false;
let analysisInterval = null; // declared here to avoid accidental globals
let currentProgress = 0; // percentage 0-100
let currentTimeRemainingSec = null; // seconds
let currentFilamentTemp = null; // numeric degrees
let currentBedTemp = null; // numeric degrees

// We'll initialize webcam and event listeners after DOM is ready

function attachEventHandlersAndStart() {
    // assign DOM elements (safe after DOMContentLoaded)
    video = document.getElementById('camera-feed');
    detectButton = document.getElementById('detect-button');
    emergencyButton = document.getElementById('emergency-button');
    statusIndicator = document.getElementById('status-indicator');
    detectionLog = document.getElementById('detection-log');
    progressFill = document.getElementById('progress-fill');
    progressPercentage = document.getElementById('progress-percentage');

    // Initialize webcam
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(function(stream) {
                if (video) video.srcObject = stream;
            })
            .catch(function(err) {
                console.error('Error accessing webcam:', err);
                try { addLog(getCurrentTime(), 'Error: Could not access webcam', 'warning'); } catch (e) {}
            });
    }

// Add sample logs on page load
addLog('14:32:01', 'Print analysis complete - No issues detected', 'success');
addLog('14:22:15', 'Layer adhesion check passed', 'success');
addLog('14:12:08', 'Caution: Minor stringing detected on layer 45', 'warning');
addLog('14:02:33', 'Temperature fluctuation detected - monitoring', 'warning');
addLog('13:52:19', 'Print started - Beginning monitoring', 'info');

// Initialize internal values from DOM if possible
(function initVitalsStateFromDOM() {
    try {
        // progress
        if (progressPercentage) {
            const parsed = parseInt(progressPercentage.textContent.replace('%',''), 10);
            if (!Number.isNaN(parsed)) currentProgress = parsed;
        }

        // time remaining (e.g. "2h 34m")
        const timeEl = document.getElementById('time-remaining');
        if (timeEl && timeEl.textContent) {
            const secs = parseTimeRemainingToSeconds(timeEl.textContent.trim());
            if (secs !== null) currentTimeRemainingSec = secs;
        }
        // If there was no explicit remaining time parsed, compute it from total duration and progress
        if (currentTimeRemainingSec === null) {
            currentTimeRemainingSec = Math.max(0, Math.round(printTotalDurationSec * (1 - (currentProgress / 100))));
            if (timeEl) timeEl.textContent = formatSecondsToHuman(currentTimeRemainingSec);
        }

        // temps
        const fEl = document.getElementById('filament-temp');
        if (fEl) currentFilamentTemp = parseInt((fEl.textContent || '').replace(/[^0-9-]/g, ''), 10) || null;
        const bEl = document.getElementById('bed-temp');
        if (bEl) currentBedTemp = parseInt((bEl.textContent || '').replace(/[^0-9-]/g, ''), 10) || null;

        // If any vitals weren't found in the DOM, fall back to easy-to-change defaults
        if (currentFilamentTemp === null) currentFilamentTemp = DEFAULT_FILAMENT_TEMP;
        if (currentBedTemp === null) currentBedTemp = DEFAULT_BED_TEMP;

        // Ensure current layer text exists and is in the 'cur / tot' format
        const layerEl = document.getElementById('current-layer');
        if (layerEl && (!layerEl.textContent || !layerEl.textContent.includes('/'))) {
            layerEl.textContent = `${DEFAULT_LAYER_CURRENT} / ${DEFAULT_LAYER_TOTAL}`;
        }
        // If no layer element present, we won't modify anything (non-critical)
    } catch (e) {
        console.warn('initVitalsStateFromDOM failed', e);
    }
})();

// Detect button click handler
detectButton.addEventListener('click', function() {
    isDetecting = !isDetecting;
    
    if (isDetecting) {
        detectButton.classList.add('active');
        detectButton.textContent = 'Detecting...';
        statusIndicator.classList.add('active');
        addLog(getCurrentTime(), 'Detection started', 'info');
    analysisInterval = setInterval(() => {
                // Capture + send image to server (best-effort). Protect from errors so periodic UI updates still run.
                try {
                    if (video && video.videoWidth && video.videoHeight) {
                        const canvas = document.createElement("canvas");
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        const context = canvas.getContext("2d");
                        if (context) context.drawImage(video, 0, 0, canvas.width, canvas.height);

                        // Convert canvas to base64 image
                        const imageData = canvas.toDataURL("image/jpeg");

                        // Send image data to the server for analysis
                        fetch("/process_image", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json"
                                },
                                body: JSON.stringify({
                                    image_data: imageData
                                })
                            })
                            .then((response) => response.json())
                            .then((data) => {
                                if (data.error) {
                                    console.error("Error: ", data.error);
                                } else {
                                    // Received context from server — add to detection log using addLog
                                    try {
                                        const ctx = data.context || String(data);
                                        const type = /warning|emergenc|emergency|fire/i.test(ctx) ? 'warning' : 'info';
                                        addLog(getCurrentTime(), ctx, type);
                                        console.debug('Process image response added to log:', ctx);
                                    } catch (e) {
                                        console.warn('Failed to append process_image response to log', e);
                                    }
                                }
                            })
                            .catch((error) => {
                                console.error("Error processing image: ", error);
                            });
                    }
                } catch (captureErr) {
                    console.warn('Image capture/send failed:', captureErr);
                }

                // --- additional periodic UI updates for progress & vitals ---
                try {
                    performPeriodicPrintUpdates();
                } catch (e) {
                    console.warn('performPeriodicPrintUpdates failed', e);
                }
            }, printUpdateIntervalMs);
    } else {
        detectButton.classList.remove('active');
        detectButton.textContent = 'Detect Errors';
        statusIndicator.classList.remove('active');
        addLog(getCurrentTime(), 'Detection stopped', 'info');
        if (analysisInterval) {
                clearInterval(analysisInterval);
                analysisInterval = null;
        }
    }
});

// Emergency stop button click handler
emergencyButton.addEventListener('click', function() {
    if (confirm('Are you sure you want to emergency stop the print?')) {
        isDetecting = false;
        detectButton.classList.remove('active');
        detectButton.textContent = 'Detect Errors';
        statusIndicator.classList.remove('active');
        addLog(getCurrentTime(), 'EMERGENCY STOP INITIATED', 'warning');
        alert('Emergency stop activated!');
    }
});

// Helper: parse time formats like "2h 34m" or "34m" or "01:23:45" into seconds
function parseTimeRemainingToSeconds(text) {
    if (!text) return null;
    text = text.trim();
    // HH:MM:SS or H:MM:SS
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(text) || /^\d{1,2}:\d{2}$/.test(text)) {
        const parts = text.split(':').map(Number);
        if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
        if (parts.length === 2) return parts[0]*60 + parts[1];
    }
    // e.g. "2h 34m", "34m", "3h"
    const hMatch = text.match(/(\d+)\s*h/);
    const mMatch = text.match(/(\d+)\s*m/);
    let secs = 0;
    if (hMatch) secs += parseInt(hMatch[1], 10) * 3600;
    if (mMatch) secs += parseInt(mMatch[1], 10) * 60;
    if (secs > 0) return secs;
    // fallback: try parsing a number as minutes
    const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(num)) return num * 60;
    return null;
}

function formatSecondsToHuman(sec) {
    if (sec == null || isNaN(sec)) return '';
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// Perform a single periodic update of progress and vitals
// - Advances progress based on configured total duration
// - Recomputes and updates the displayed time remaining, temps, and estimated layer
function performPeriodicPrintUpdates() {
    // compute progress delta based on configured total print duration
    const intervalSec = printUpdateIntervalMs / 1000;
    const delta = (intervalSec / Math.max(1, printTotalDurationSec)) * 100;
    currentProgress = Math.min(100, currentProgress + delta);
    // update DOM
    setProgress(Math.round(currentProgress));

    // compute remaining time directly from total duration and progress so they always match
    const remainingSec = Math.max(0, Math.round(printTotalDurationSec * (1 - (currentProgress / 100))));
    currentTimeRemainingSec = remainingSec;
    const human = formatSecondsToHuman(currentTimeRemainingSec);
    const el = document.getElementById('time-remaining');
    if (el) el.textContent = human;

    // small simulated temp fluctuation
    if (currentFilamentTemp !== null) {
        // fluctuate +/- 1 degree occasionally
        currentFilamentTemp += (Math.random() - 0.5) * 0.6;
        const el = document.getElementById('filament-temp');
        if (el) el.textContent = Math.round(currentFilamentTemp) + '°C';
    }
    if (currentBedTemp !== null) {
        currentBedTemp += (Math.random() - 0.5) * 0.2;
        const el = document.getElementById('bed-temp');
        if (el) el.textContent = Math.round(currentBedTemp) + '°C';
    }

    // update current layer if it's in the form 'X / Y'
    const layerEl = document.getElementById('current-layer');
    if (layerEl && layerEl.textContent.includes('/')) {
        const parts = layerEl.textContent.split('/').map(s => s.trim());
        const cur = parseInt(parts[0].replace(/[^0-9]/g,''), 10);
        const tot = parseInt(parts[1].replace(/[^0-9]/g,''), 10);
        if (!Number.isNaN(cur) && !Number.isNaN(tot) && cur < tot) {
            // estimate layers progressed based on percent
            const estimated = Math.round((currentProgress / 100) * tot);
            layerEl.textContent = Math.min(tot, Math.max(0, estimated)) + ' / ' + tot;
        }
    }
}

// Function to add log entry
function addLog(time, message, type) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry' + (type === 'warning' ? ' warning' : '');
    
    const dotDiv = document.createElement('div');
    dotDiv.className = 'log-dot ' + type;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'log-text';
    
    const timeP = document.createElement('p');
    timeP.className = 'log-time';
    timeP.textContent = time;
    
    const messageP = document.createElement('p');
    messageP.className = 'log-message';
    messageP.textContent = message;
    
    textDiv.appendChild(timeP);
    textDiv.appendChild(messageP);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'log-entry-content';
    contentDiv.appendChild(dotDiv);
    contentDiv.appendChild(textDiv);
    
    logEntry.appendChild(contentDiv);
    detectionLog.insertBefore(logEntry, detectionLog.firstChild);
}

// Get current time in HH:MM:SS format
function getCurrentTime() {
    const now = new Date();
    return now.toTimeString().slice(0, 8);
}

// Public API: update progress bar and print vitals from other scripts or the dev console
// Update the visual progress bar and percentage text. Also sync the time-remaining display
function setProgress(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    currentProgress = value;
    if (progressFill) progressFill.style.width = value + '%';
    if (progressPercentage) progressPercentage.textContent = value + '%';
    // update remaining time to keep it in sync with progress
    currentTimeRemainingSec = Math.max(0, Math.round(printTotalDurationSec * (1 - (currentProgress / 100))));
    const el = document.getElementById('time-remaining');
    if (el) el.textContent = formatSecondsToHuman(currentTimeRemainingSec);
}

function updateVitals({ timeRemaining, filamentTemp, bedTemp, currentLayer } = {}) {
    if (timeRemaining !== undefined) {
        const el = document.getElementById('time-remaining');
        if (el) el.textContent = timeRemaining;
    }
    if (filamentTemp !== undefined) {
        const el = document.getElementById('filament-temp');
        if (el) el.textContent = filamentTemp;
    }
    if (bedTemp !== undefined) {
        const el = document.getElementById('bed-temp');
        if (el) el.textContent = bedTemp;
    }
    if (currentLayer !== undefined) {
        const el = document.getElementById('current-layer');
        if (el) el.textContent = currentLayer;
    }
}

// Expose a simple global object so you can call these from other scripts or the console
window.PrinterUI = window.PrinterUI || {};
window.PrinterUI.setProgress = setProgress;
window.PrinterUI.updateVitals = updateVitals;
// Controls for the periodic print updates
window.PrinterUI.setPrintUpdateInterval = function(ms) {
    const n = Number(ms) || 0;
    if (n <= 0) return;
    printUpdateIntervalMs = n;
    // if currently running, restart the interval so new interval takes effect
    if (analysisInterval) {
        clearInterval(analysisInterval);
        analysisInterval = setInterval(() => {
            // keep behavior in sync with detection interval: send image + periodic updates
            // capture and send an image (best-effort)
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = canvas.toDataURL('image/jpeg');
                fetch('/process_image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_data: imageData }) })
                    .then(r => r.json()).then(() => {}).catch(()=>{});
            } catch (e) {}
            try { performPeriodicPrintUpdates(); } catch(e) {}
        }, printUpdateIntervalMs);
    }
};
window.PrinterUI.setPrintDuration = function(seconds) {
    const n = Number(seconds) || 0;
    if (n > 0) {
        printTotalDurationSec = n;
        // recompute remaining time based on current progress
        currentTimeRemainingSec = Math.max(0, Math.round(printTotalDurationSec * (1 - (currentProgress / 100))));
        const el = document.getElementById('time-remaining');
        if (el) el.textContent = formatSecondsToHuman(currentTimeRemainingSec);
    }
};

// Initialize progress and vitals with values already in the DOM (keeps existing behavior)
try {
    const initialPercent = parseInt(progressPercentage ? progressPercentage.textContent.replace('%','') : '0', 10) || 0;
    setProgress(initialPercent);
    updateVitals({
        timeRemaining: document.getElementById('time-remaining')?.textContent,
        filamentTemp: document.getElementById('filament-temp')?.textContent,
        bedTemp: document.getElementById('bed-temp')?.textContent,
        currentLayer: document.getElementById('current-layer')?.textContent,
    });
} catch (e) {
    console.warn('PrinterUI initialization skipped:', e);
}

}

// ensure we run after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachEventHandlersAndStart);
} else {
    attachEventHandlersAndStart();
}