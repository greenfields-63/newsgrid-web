/**
 * NewsGrid Web — High-Performance Live Quad-View Player
 * Optimized for GitHub Pages & Smart TV/Desktop Browsers
 */

const GIST_URL = "https://gist.githubusercontent.com/greenfields-63/47648eee6d12acaa2ae5146a10d02b33/raw/channels.json";

// State
let availableChannels = [];
let selectedChannels = [];
let hlsInstances = [null, null, null, null];
let activeAudioIndex = 0;
let userHasInteracted = false;
let isAudioMuted = false;
let fullScreenIndex = -1;
let makoRenewalTimer = null;
let retryCounts = [0, 0, 0, 0];

// Fallback channel lineup if Gist cannot be reached
const DEFAULT_CHANNELS = [
    {
        name: "Kan 11",
        url: "https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8",
        referer: "https://www.kan.org.il/"
    },
    {
        name: "Channel 12",
        url: "https://mako-streaming.akamaized.net/direct/hls/live/2033791/k12/index.m3u8",
        referer: "https://www.mako.co.il/",
        type: "mako",
        params: {
            lp: "/direct/hls/live/2033791/k12/index.m3u8",
            dv: "1e2258089b67f510VgnVCM2000002a0c10acRCRD"
        }
    },
    {
        name: "Reshet 13",
        url: "https://d18b0e6mopany4.cloudfront.net/out/v1/2f2bc414a3db4698a8e94b89eaf2da2a/index.m3u8",
        referer: "https://13tv.co.il/"
    },
    {
        name: "Channel 14",
        url: "https://n-121-6.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8",
        referer: "https://www.now14.co.il/"
    }
];

// ----------------------------------------------------
// Channel Fetching & Mako Ticket Management
// ----------------------------------------------------

async function fetchChannels() {
    try {
        // Append cache-buster so updates to the Gist are reflected immediately without waiting for CDN cache
        const res = await fetch(`${GIST_URL}?_=${Date.now()}`);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                availableChannels = data.filter(c => c.enabled !== false);
            }
        }
    } catch (e) {
        console.warn("[NewsGrid] Gist fetch failed, using built-in channels:", e);
    }

    if (availableChannels.length === 0) {
        availableChannels = [...DEFAULT_CHANNELS];
    }

    loadSavedChannels();
}

async function getMakoTicket(channel) {
    const lp = channel.params?.lp || "/direct/hls/live/2033791/k12/index.m3u8";
    const dv = channel.params?.dv || "1e2258089b67f510VgnVCM2000002a0c10acRCRD";
    const deviceId = "web-" + Math.random().toString(36).substring(2, 12);
    const reqUrl = `https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp?et=gt&lp=${encodeURIComponent(lp)}&dv=${dv}&rv=AKAMAI&du=${deviceId}`;

    try {
        const res = await fetch(reqUrl, { credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const ticket = data.tickets?.[0]?.ticket;
        const path = data.tickets?.[0]?.url || lp;

        if (ticket) {
            const separator = path.includes("?") ? "&" : "?";
            const fullUrl = `https://mako-streaming.akamaized.net${path}${separator}${ticket}`;

            // Parse token expiration (Akamai tokens format: ...exp=1792413767...)
            const expMatch = ticket.match(/exp=(\d+)/);
            const expiresAtMs = expMatch ? parseInt(expMatch[1], 10) * 1000 : Date.now() + 14 * 60 * 1000;

            return { url: fullUrl, ticket, expiresAtMs };
        }
    } catch (e) {
        console.warn("[NewsGrid] Mako ticket fetch error:", e);
    }

    return { url: channel.url, ticket: null, expiresAtMs: 0 };
}

function scheduleMakoRenewal(index, channel, expiresAtMs) {
    if (makoRenewalTimer) clearTimeout(makoRenewalTimer);

    // Renew 2.5 minutes before ticket expiration, or after 12 minutes
    const renewInMs = Math.max(30000, expiresAtMs - Date.now() - 150000);
    console.log(`[NewsGrid] Scheduling Mako ticket renewal in ${Math.round(renewInMs / 1000)}s`);

    makoRenewalTimer = setTimeout(async () => {
        if (selectedChannels[index]?.type === "mako") {
            console.log("[NewsGrid] Proactively renewing Mako ticket...");
            await loadTileStream(index, selectedChannels[index]);
        }
    }, renewInMs);
}

// ----------------------------------------------------
// Storage & Grid Setup
// ----------------------------------------------------

function loadSavedChannels() {
    const saved = localStorage.getItem("newsgrid_web_selected");
    if (saved) {
        try {
            const urls = JSON.parse(saved);
            selectedChannels = [];
            for (const url of urls) {
                const found = availableChannels.find(c => c.url === url);
                if (found) selectedChannels.push(found);
            }
        } catch (e) {}
    }

    // Default: channels 11, 12, 13, 14
    if (selectedChannels.length < 4) {
        selectedChannels = availableChannels.filter(c =>
            c.name.includes("11") || c.name.includes("12") || c.name.includes("13") || c.name.includes("14")
        ).slice(0, 4);

        if (selectedChannels.length < 4) {
            selectedChannels = availableChannels.slice(0, 4);
        }
    }

    initGrid();
}

function initGrid() {
    for (let i = 0; i < 4; i++) {
        loadTileStream(i, selectedChannels[i]);
    }
}

async function loadTileStream(index, channel) {
    const videoEl = document.getElementById(`video-${index}`);
    const labelEl = document.getElementById(`label-${index}`);
    const overlayEl = document.getElementById(`overlay-${index}`);
    const msgEl = document.getElementById(`msg-${index}`);

    if (!channel) {
        labelEl.textContent = "Empty";
        return;
    }

    labelEl.textContent = channel.name;
    showTileOverlay(index, "Connecting...");

    // Clean up existing Hls and video state to avoid memory leaks
    if (hlsInstances[index]) {
        hlsInstances[index].destroy();
        hlsInstances[index] = null;
    }
    videoEl.pause();
    videoEl.removeAttribute("src");
    videoEl.load();

    let streamUrl = channel.url;

    // Handle Mako ticket authentication
    if (channel.type === "mako") {
        const ticketInfo = await getMakoTicket(channel);
        streamUrl = ticketInfo.url;
        if (ticketInfo.expiresAtMs > 0) {
            scheduleMakoRenewal(index, channel, ticketInfo.expiresAtMs);
        }
    }

    if (Hls.isSupported()) {
        const hlsConfig = {
            enableWorker: true,
            lowLatencyMode: true,
            // Optimization: cap resolution to player container size in grid mode
            capLevelToPlayerSize: fullScreenIndex !== index,
            maxBufferLength: 10,
            maxMaxBufferLength: 20,
            backBufferLength: 0,
            initialLiveManifestSize: 1,
            autoStartLoad: true,
            xhrSetup: (xhr) => {
                // Ensure credentials are false to adhere strictly to CORS
                xhr.withCredentials = false;
            }
        };

        const hls = new Hls(hlsConfig);
        hls.loadSource(streamUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            hideTileOverlay(index);
            videoEl.play().catch(() => {});
            updateAudioState();
        });

        hls.on(Hls.Events.FRAG_LOADED, () => {
            hideTileOverlay(index);
            retryCounts[index] = 0;
        });

        hls.on(Hls.Events.ERROR, async (event, data) => {
            if (data.fatal) {
                console.warn(`[NewsGrid] Fatal error on Tile ${index}:`, data.type, data.details);
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        handleNetworkError(index, channel, hls, data);
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log(`[NewsGrid] Recovering media error on Tile ${index}`);
                        hls.recoverMediaError();
                        break;
                    default:
                        showTileOverlay(index, "Stream failed", true);
                        hls.destroy();
                        break;
                }
            }
        });

        hlsInstances[index] = hls;
    } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        // Native Safari HLS
        videoEl.src = streamUrl;
        videoEl.addEventListener("loadedmetadata", () => {
            hideTileOverlay(index);
            videoEl.play().catch(() => {});
            updateAudioState();
        });
        videoEl.addEventListener("error", () => {
            showTileOverlay(index, "Playback error", true);
        });
    }
}

function handleNetworkError(index, channel, hls, data) {
    retryCounts[index] = (retryCounts[index] || 0) + 1;

    // If Mako stream 403, renew token immediately
    if (channel.type === "mako" && data.response?.code === 403) {
        console.log(`[NewsGrid] Mako 403 detected on Tile ${index}, renewing ticket...`);
        showTileOverlay(index, "Refreshing ticket...");
        loadTileStream(index, channel);
        return;
    }

    if (retryCounts[index] <= 3) {
        const delay = Math.pow(2, retryCounts[index] - 1) * 1000;
        showTileOverlay(index, `Reconnecting in ${delay / 1000}s...`);
        setTimeout(() => {
            hls.startLoad();
        }, delay);
    } else {
        showTileOverlay(index, "Stream unavailable", true);
    }
}

function showTileOverlay(index, message, showRetryBtn = false) {
    const overlay = document.getElementById(`overlay-${index}`);
    const msg = document.getElementById(`msg-${index}`);
    const spinner = overlay?.querySelector(".spinner");
    const retryBtn = document.getElementById(`retry-${index}`);

    if (overlay && msg) {
        msg.textContent = message;
        overlay.classList.add("visible");
        if (spinner) spinner.style.display = showRetryBtn ? "none" : "block";
        if (retryBtn) retryBtn.style.display = showRetryBtn ? "inline-block" : "none";
    }
}

function hideTileOverlay(index) {
    const overlay = document.getElementById(`overlay-${index}`);
    if (overlay) {
        overlay.classList.remove("visible");
    }
}

// ----------------------------------------------------
// Audio Management & Autoplay Handling
// ----------------------------------------------------

function setAudioFocus(index) {
    activeAudioIndex = index;
    userHasInteracted = true;
    dismissUnmuteBanner();
    updateAudioState();
}

function updateAudioState() {
    document.querySelectorAll(".tile").forEach((tile, i) => {
        const videoEl = document.getElementById(`video-${i}`);
        if (i === activeAudioIndex) {
            tile.classList.add("active");
            if (videoEl) {
                if (userHasInteracted && !isAudioMuted) {
                    videoEl.muted = false;
                    videoEl.volume = 1.0;
                } else {
                    videoEl.muted = true;
                }
            }
        } else {
            tile.classList.remove("active");
            if (videoEl) {
                videoEl.muted = true;
            }
        }
    });
}

function enableAudioFromGesture() {
    if (!userHasInteracted) {
        userHasInteracted = true;
        isAudioMuted = false;
        dismissUnmuteBanner();
        updateAudioState();
    }
}

function toggleMute() {
    isAudioMuted = !isAudioMuted;
    updateAudioState();
}

function dismissUnmuteBanner() {
    const banner = document.getElementById("unmute-banner");
    if (banner) {
        banner.classList.add("hidden");
    }
}

// ----------------------------------------------------
// Fullscreen & Hardware Resource Optimization
// ----------------------------------------------------

function toggleFullScreen(index) {
    const tile = document.getElementById(`tile-${index}`);
    const settingsBtn = document.getElementById("open-settings");

    if (fullScreenIndex === index) {
        exitFullScreen();
    } else {
        // Exit any prior fullscreen
        if (fullScreenIndex !== -1) {
            document.getElementById(`tile-${fullScreenIndex}`)?.classList.remove("fullscreen");
        }

        fullScreenIndex = index;
        tile.classList.add("fullscreen");
        if (settingsBtn) settingsBtn.classList.add("hidden");

        // Focus audio on the fullscreen tile
        setAudioFocus(index);

        // Hardware saving: pause and stop loading for the 3 hidden background tiles
        for (let i = 0; i < 4; i++) {
            const hls = hlsInstances[i];
            const video = document.getElementById(`video-${i}`);
            if (i === index) {
                if (hls) hls.capLevelToPlayerSize = false; // Allow full 1080p
            } else {
                if (hls) hls.stopLoad();
                if (video) video.pause();
            }
        }
    }
}

function exitFullScreen() {
    if (fullScreenIndex === -1) return;

    const tile = document.getElementById(`tile-${fullScreenIndex}`);
    const settingsBtn = document.getElementById("open-settings");

    if (tile) tile.classList.remove("fullscreen");
    if (settingsBtn) settingsBtn.classList.remove("hidden");

    // Restore background tiles
    for (let i = 0; i < 4; i++) {
        const hls = hlsInstances[i];
        const video = document.getElementById(`video-${i}`);
        if (hls) {
            hls.capLevelToPlayerSize = true;
            hls.startLoad();
        }
        if (video) {
            video.play().catch(() => {});
        }
    }

    fullScreenIndex = -1;
    updateAudioState();
}

// ----------------------------------------------------
// Keyboard & Remote Control Navigation
// ----------------------------------------------------

window.addEventListener("keydown", (e) => {
    // Don't intercept if inside modal
    const modal = document.getElementById("modal");
    if (modal.classList.contains("open")) {
        if (e.key === "Escape") modal.classList.remove("open");
        return;
    }

    enableAudioFromGesture();

    switch (e.key) {
        case "1": setAudioFocus(0); break;
        case "2": setAudioFocus(1); break;
        case "3": setAudioFocus(2); break;
        case "4": setAudioFocus(3); break;

        // D-Pad / Arrow keys navigation
        case "ArrowRight":
            if (activeAudioIndex === 0) setAudioFocus(1);
            else if (activeAudioIndex === 2) setAudioFocus(3);
            break;
        case "ArrowLeft":
            if (activeAudioIndex === 1) setAudioFocus(0);
            else if (activeAudioIndex === 3) setAudioFocus(2);
            break;
        case "ArrowDown":
            if (activeAudioIndex === 0) setAudioFocus(2);
            else if (activeAudioIndex === 1) setAudioFocus(3);
            break;
        case "ArrowUp":
            if (activeAudioIndex === 2) setAudioFocus(0);
            else if (activeAudioIndex === 3) setAudioFocus(1);
            break;

        // Fullscreen toggle
        case "f":
        case "F":
        case "Enter":
            toggleFullScreen(activeAudioIndex);
            break;

        case "Escape":
            if (fullScreenIndex !== -1) {
                exitFullScreen();
            }
            break;

        // Mute toggle
        case "m":
        case "M":
            toggleMute();
            break;

        // Settings
        case "s":
        case "S":
            openSettingsModal();
            break;
    }
});

// ----------------------------------------------------
// Click & Event Listeners
// ----------------------------------------------------

// Unmute banner click
document.getElementById("unmute-banner")?.addEventListener("click", enableAudioFromGesture);
window.addEventListener("click", enableAudioFromGesture, { once: true });

// Tile click listeners
document.querySelectorAll(".tile").forEach(tile => {
    const index = parseInt(tile.dataset.index, 10);

    tile.addEventListener("click", (e) => {
        // Prevent click if clicking direct controls
        if (e.target.closest(".tile-controls") || e.target.closest(".overlay-btn")) return;

        if (fullScreenIndex === index) {
            exitFullScreen();
        } else if (activeAudioIndex === index) {
            toggleFullScreen(index);
        } else {
            setAudioFocus(index);
        }
    });

    // Double click to toggle fullscreen
    tile.addEventListener("dblclick", () => {
        toggleFullScreen(index);
    });
});

// Tile control fullscreen buttons
document.querySelectorAll(".fullscreen-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index, 10);
        toggleFullScreen(index);
    });
});

// Retry buttons
for (let i = 0; i < 4; i++) {
    document.getElementById(`retry-${i}`)?.addEventListener("click", (e) => {
        e.stopPropagation();
        retryCounts[i] = 0;
        loadTileStream(i, selectedChannels[i]);
    });
}

// ----------------------------------------------------
// Modal & Channel Customization
// ----------------------------------------------------

const modal = document.getElementById("modal");
const channelList = document.getElementById("channel-list");
const countLabel = document.getElementById("count-label");

function openSettingsModal() {
    renderModalList();
    modal.classList.add("open");
}

document.getElementById("open-settings")?.addEventListener("click", openSettingsModal);
document.getElementById("close-modal")?.addEventListener("click", () => modal.classList.remove("open"));

function renderModalList() {
    channelList.innerHTML = "";
    const selectedUrls = selectedChannels.map(c => c.url);

    availableChannels.forEach(channel => {
        const item = document.createElement("label");
        item.className = "channel-item";
        const isChecked = selectedUrls.includes(channel.url);

        item.innerHTML = `
            <span>${channel.name}</span>
            <input type="checkbox" value="${channel.url}" ${isChecked ? "checked" : ""}>
        `;

        const checkbox = item.querySelector("input");
        checkbox.addEventListener("change", () => {
            const checkedBoxes = channelList.querySelectorAll("input:checked");
            if (checkedBoxes.length > 4) {
                checkbox.checked = false;
                alert("Please select exactly 4 channels.");
            }
            updateModalCount();
        });

        channelList.appendChild(item);
    });

    updateModalCount();
}

function updateModalCount() {
    const count = channelList.querySelectorAll("input:checked").length;
    countLabel.textContent = `(${count}/4 selected)`;
}

document.getElementById("save-channels")?.addEventListener("click", () => {
    const checkedUrls = Array.from(channelList.querySelectorAll("input:checked")).map(cb => cb.value);
    if (checkedUrls.length !== 4) {
        alert("Please select exactly 4 channels to fill the 2x2 grid.");
        return;
    }

    selectedChannels = [];
    for (const url of checkedUrls) {
        const found = availableChannels.find(c => c.url === url);
        if (found) selectedChannels.push(found);
    }

    localStorage.setItem("newsgrid_web_selected", JSON.stringify(checkedUrls));
    modal.classList.remove("open");
    initGrid();
});

// Boot
fetchChannels();
