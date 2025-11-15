// THE GOOD STUFF BELOW

// -----------------------
// 3DPrintIQ Frontend – Real Data Only
// -----------------------

// DOM refs
let video;
let detectButton;
let emergencyButton;
let statusIndicator;
let detectionLog;

// State
let isDetecting = false;
let detectionInterval = null;        // for periodic AI scans when Detect button is ON
const DETECTION_INTERVAL_MS = 10000; // every 10s when detection is active

// -----------------------
// Utility: Logs
// -----------------------
function addLog(time, message, type = "info") {
    if (!detectionLog) return;

    const logEntry = document.createElement("div");
    logEntry.className = "log-entry" + (type === "warning" ? " warning" : "");

    const dotDiv = document.createElement("div");
    dotDiv.className = "log-dot " + type;

    const textDiv = document.createElement("div");
    textDiv.className = "log-text";

    const timeP = document.createElement("p");
    timeP.className = "log-time";
    timeP.textContent = time;

    const messageP = document.createElement("p");
    messageP.className = "log-message";
    messageP.textContent = message;

    textDiv.appendChild(timeP);
    textDiv.appendChild(messageP);

    const contentDiv = document.createElement("div");
    contentDiv.className = "log-entry-content";
    contentDiv.appendChild(dotDiv);
    contentDiv.appendChild(textDiv);

    logEntry.appendChild(contentDiv);

    // newest at top
    detectionLog.insertBefore(logEntry, detectionLog.firstChild);
}

function getCurrentTime() {
    const now = new Date();
    return now.toTimeString().slice(0, 8); // HH:MM:SS
}

// -----------------------
// Camera + AI analysis
// -----------------------
function captureAndAnalyzeOnce() {
    try {
        if (!video || !video.videoWidth || !video.videoHeight) {
            console.warn("Video not ready yet for capture.");
            return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            console.warn("Could not get 2D context from canvas.");
            return;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL("image/jpeg");

        // Send to backend for analysis
        fetch("/process_image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_data: imageData })
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.error) {
                    console.error("Error from /process_image:", data.error);
                    addLog(getCurrentTime(), "Analysis error: " + data.error, "warning");
                } else {
                    const contextText = data.context || "[No context returned]";
                    const risk = (data.risk_level || "").toLowerCase();
                    let logType = "info";
                    if (risk.includes("high")) logType = "warning";
                    if (risk.includes("imminent") || risk.includes("emergency")) logType = "warning";

                    addLog(getCurrentTime(), contextText, logType);
                    console.debug("Analysis result:", contextText, "risk:", data.risk_level);
                }
            })
            .catch((err) => {
                console.error("Error calling /process_image:", err);
                addLog(getCurrentTime(), "Failed to contact analysis server.", "warning");
            });
    } catch (err) {
        console.error("captureAndAnalyzeOnce error:", err);
    }
}

// -----------------------
// Socket.IO – Real Printer Data
// -----------------------
let socket = null;

function setupSocketIO() {
    try {
        // If page served from same host:port as Flask-SocketIO, this is enough:
        socket = io();

        socket.on("connect", () => {
            console.log("🔥 Connected to Socket.IO server.");
        });

        socket.on("disconnect", () => {
            console.log("⚠️ Disconnected from Socket.IO server.");
        });

        // Printer info from backend – single source of truth!
        socket.on("printer_update", (data) => {
            // Uncomment to inspect raw data:
            // console.log("📡 printer_update:", data);

            if (!data || typeof data !== "object") return;

            // Nozzle / filament temperature
            if (data.nozzleTemp !== undefined && data.nozzleTemp !== null) {
                const val = Number(data.nozzleTemp);
                const el = document.getElementById("filament-temp");
                if (el && !Number.isNaN(val)) {
                    el.textContent = Math.round(val) + "°C";
                }
            }

            // Bed temperature
            if (data.bedTemp0 !== undefined && data.bedTemp0 !== null) {
                const val = Number(data.bedTemp0);
                const el = document.getElementById("bed-temp");
                if (el && !Number.isNaN(val)) {
                    el.textContent = Math.round(val) + "°C";
                }
            }

            // Current layer (with optional total layer)
            const layerEl = document.getElementById("current-layer");
            if (layerEl && data.layer !== undefined && data.layer !== null) {
                const curLayer = data.layer;
                const totalLayer = data.TotalLayer;

                if (totalLayer !== undefined && totalLayer !== null && totalLayer !== 0) {
                    layerEl.textContent = `${curLayer} / ${totalLayer}`;
                } else {
                    // If total not reported or zero, only show current
                    layerEl.textContent = String(curLayer);
                }
            }

            // Progress (0–100) if sent by printer
            if (data.printProgress !== undefined && data.printProgress !== null) {
                const progressVal = Math.max(
                    0,
                    Math.min(100, Number(data.printProgress) || 0)
                );
                const bar = document.getElementById("progress-fill");
                const pct = document.getElementById("progress-percentage");
                if (bar) bar.style.width = progressVal + "%";
                if (pct) pct.textContent = progressVal + "%";
            }

            // Time remaining (assuming printer sends seconds)
            if (data.printLeftTime !== undefined && data.printLeftTime !== null) {
                const sec = Number(data.printLeftTime) || 0;
                const el = document.getElementById("time-remaining");
                if (el) {
                    const minutes = Math.floor(sec / 60);
                    const hours = Math.floor(minutes / 60);
                    const remMin = minutes % 60;
                    if (hours > 0) {
                        el.textContent = `${hours}h ${remMin}m`;
                    } else {
                        el.textContent = `${remMin}m`;
                    }
                }
            }
        });

        // When backend says "analyze_image" (e.g., new layer), run one-shot capture+analyze
        socket.on("analyze_image", (data) => {
            console.log("🧪 analyze_image event from backend:", data);
            captureAndAnalyzeOnce();
        });
    } catch (err) {
        console.error("Socket.IO setup failed:", err);
    }
}

// -----------------------
// Button Handlers
// -----------------------
function setupButtons() {
    if (!detectButton || !emergencyButton) return;

    // Toggle continuous detection (every DETECTION_INTERVAL_MS)
    detectButton.addEventListener("click", () => {
        isDetecting = !isDetecting;

        if (isDetecting) {
            detectButton.classList.add("active");
            detectButton.textContent = "Detecting...";
            if (statusIndicator) statusIndicator.classList.add("active");
            addLog(getCurrentTime(), "Continuous detection started.", "info");

            // Start periodic capture+analyze
            detectionInterval = setInterval(
                captureAndAnalyzeOnce,
                DETECTION_INTERVAL_MS
            );
        } else {
            detectButton.classList.remove("active");
            detectButton.textContent = "Detect Errors";
            if (statusIndicator) statusIndicator.classList.remove("active");
            addLog(getCurrentTime(), "Continuous detection stopped.", "info");

            if (detectionInterval) {
                clearInterval(detectionInterval);
                detectionInterval = null;
            }
        }
    });

    emergencyButton.addEventListener("click", () => {
        if (!confirm("Are you sure you want to EMERGENCY STOP the print?")) return;

        isDetecting = false;
        if (detectionInterval) {
            clearInterval(detectionInterval);
            detectionInterval = null;
        }
        detectButton.classList.remove("active");
        detectButton.textContent = "Detect Errors";
        if (statusIndicator) statusIndicator.classList.remove("active");

        addLog(getCurrentTime(), "EMERGENCY STOP ACTIVATED", "warning");
        alert("Emergency stop activated! (Hook backend here if you wire G-code/Pause)");
    });
}

// -----------------------
// Webcam
// -----------------------
function setupWebcam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("getUserMedia not supported in this browser.");
        addLog(getCurrentTime(), "Webcam not supported in this browser.", "warning");
        return;
    }

    navigator.mediaDevices
        .getUserMedia({ video: true })
        .then((stream) => {
            if (video) {
                video.srcObject = stream;
            }
        })
        .catch((err) => {
            console.error("Error accessing webcam:", err);
            addLog(getCurrentTime(), "Error: Could not access webcam.", "warning");
        });
}

// -----------------------
// Initialization
// -----------------------
function attachEventHandlersAndStart() {
    // Grab DOM elements
    video = document.getElementById("camera-feed");
    detectButton = document.getElementById("detect-button");
    emergencyButton = document.getElementById("emergency-button");
    statusIndicator = document.getElementById("status-indicator");
    detectionLog = document.getElementById("detection-log");

    // Setup webcam
    setupWebcam();

    // Setup buttons
    setupButtons();

    // Setup Socket.IO listeners
    setupSocketIO();

    // Optionally add initial demo logs
    addLog(getCurrentTime(), "Dashboard ready.", "info");
}

// Run init after DOM ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachEventHandlersAndStart);
} else {
    attachEventHandlersAndStart();
}
