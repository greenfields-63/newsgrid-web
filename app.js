/**
 * NewsGrid Extension Main Application Script
 */

const gistUrl = "https://gist.githubusercontent.com/greenfields-63/47648eee6d12acaa2ae5146a10d02b33/raw/channels.json";
let availableChannels = [];
let selectedChannels = [];
let hlsInstances = [null, null, null, null];
let activeAudioIndex = 0;

async function fetchGistChannels() {
    try {
        const res = await fetch(gistUrl);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                availableChannels = data.filter(c => c.enabled !== false).map(c => {
                    if (c.type === "mako") {
                        c.url = "https://mako-streaming.akamaized.net/stream/hls/live/2033791/k12n12wad/index.m3u8";
                        c.params = c.params || {};
                        c.params.lp = "/stream/hls/live/2033791/k12n12wad/index.m3u8";
                    }
                    return c;
                });
            }
        }
    } catch (e) {
        console.warn("Failed to fetch Gist channels", e);
    }
    if (availableChannels.length === 0) {
        availableChannels = [
            { name: "Kan 11", url: "https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8", referer: "https://www.kan.org.il/" },
            { name: "Channel 12", url: "https://mako-streaming.akamaized.net/stream/hls/live/2033791/k12n12wad/index.m3u8", referer: "https://www.mako.co.il/", type: "mako", params: { lp: "/stream/hls/live/2033791/k12n12wad/index.m3u8", dv: "1e2258089b67f510VgnVCM2000002a0c10acRCRD" } },
            { name: "Reshet 13", url: "https://d18b0e6mopany4.cloudfront.net/out/v1/2f2bc414a3db4698a8e94b89eaf2da2a/index.m3u8", referer: "https://13tv.co.il/" },
            { name: "Channel 14", url: "https://n-121-6.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8", referer: "https://www.now14.co.il/" }
        ];
    }
    loadSavedSelection();
}

async function getMakoTicket(channel) {
    try {
        const lp = channel.params?.lp || "/stream/hls/live/2033791/k12n12wad/index.m3u8";
        const dv = channel.params?.dv || "1e2258089b67f510VgnVCM2000002a0c10acRCRD";

        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ action: "get-mako-ticket", lp, dv }, (response) => {
                    if (response && response.success && response.url) {
                        console.log("[Mako Ext] Got signed Mako URL from background:", response.url);
                        resolve(response.url);
                    } else {
                        console.warn("[Mako Ext] Background ticket fetch failed, fallback to url:", response?.error);
                        resolve(channel.url);
                    }
                });
            } else {
                const deviceId = "web-" + Math.random().toString(36).substring(2, 12);
                const reqUrl = `https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp?et=gt&lp=${encodeURIComponent(lp)}&dv=${dv}&rv=AKAMAI&du=${deviceId}`;
                fetch(reqUrl)
                    .then(res => res.json())
                    .then(data => {
                        const ticket = data.tickets?.[0]?.ticket;
                        if (ticket) {
                            resolve(`https://mako-streaming.akamaized.net${lp}?${ticket}`);
                        } else {
                            resolve(channel.url);
                        }
                    })
                    .catch(() => resolve(channel.url));
            }
        });
    } catch (e) {
        console.error("[Mako Ext] Mako ticket error:", e);
        return channel.url;
    }
}

function loadSavedSelection() {
    const saved = localStorage.getItem("newsgrid_ext_selected");
    if (saved) {
        try {
            const urls = JSON.parse(saved);
            selectedChannels = availableChannels.filter(c => urls.includes(c.url)).slice(0, 4);
        } catch (e) {}
    }
    if (selectedChannels.length < 4) {
        selectedChannels = availableChannels.filter(c =>
            c.name.includes("11") || c.name.includes("12") || c.name.includes("13") || c.name.includes("14")
        ).slice(0, 4);
        if (selectedChannels.length === 0) {
            selectedChannels = availableChannels.slice(0, 4);
        }
    }
    initGrid();
}

async function initGrid() {
    for (let i = 0; i < 4; i++) {
        if (hlsInstances[i]) {
            hlsInstances[i].destroy();
            hlsInstances[i] = null;
        }
        const channel = selectedChannels[i];
        const videoEl = document.getElementById(`video-${i}`);
        const labelEl = document.getElementById(`label-${i}`);

        if (!channel) {
            labelEl.textContent = "Empty";
            continue;
        }

        labelEl.textContent = channel.name;

        let streamUrl = channel.url;
        let makoToken = null;
        if (channel.type === "mako") {
            const makoFullUrl = await getMakoTicket(channel);
            if (makoFullUrl && makoFullUrl.includes("?")) {
                streamUrl = makoFullUrl;
                makoToken = makoFullUrl.substring(makoFullUrl.indexOf("?") + 1);
            } else {
                streamUrl = makoFullUrl;
            }
        }

        if (Hls.isSupported()) {
            const isCnn = channel.url.includes("cloudfront.net");
            const isKan = channel.name.includes("Kan 11");
            const hlsConfig = {
                enableWorker: true,
                debug: false,
                lowLatencyMode: false,
                liveSyncDurationCount: isCnn ? 3 : (isKan ? 4 : 2),
                liveMaxLatencyDurationCount: isCnn ? 8 : (isKan ? 15 : 8),
                maxLiveSyncPlaybackRate: 1.1,
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                abrEwmaDefaultEstimate: 2000000,
                startLevel: isCnn ? undefined : 0,
                autoStartLoad: true,
                fragLoadMaxRetry: 6,
                fragLoadRetryDelay: 1000,
                maxLoadingDelay: 4,
                xhrSetup: (xhr, url) => {
                    if (url.includes("mako.co.il") || url.includes("akamaized.net")) {
                        xhr.withCredentials = true;
                        if (makoToken && !url.includes("hdnea")) {
                            const sep = url.includes("?") ? "&" : "?";
                            url = url + sep + makoToken;
                        }
                    }
                    xhr.open('GET', url, true);
                }
            };
            videoEl.muted = true;
            const hls = new Hls(hlsConfig);
            hls.loadSource(streamUrl);
            hls.attachMedia(videoEl);
            if (isKan) {
                hls.startLoad();
                hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                    let lowestLevel = 0;
                    let minBw = data.levels[0].bitrate;
                    for (let j = 1; j < data.levels.length; j++) {
                        if (data.levels[j].bitrate < minBw) {
                            minBw = data.levels[j].bitrate;
                            lowestLevel = j;
                        }
                    }
                    hls.currentLevel = lowestLevel;
                    videoEl.muted = true;
                    videoEl.play().then(() => {
                        setAudioFocus(activeAudioIndex);
                    }).catch(err => {
                        videoEl.muted = true;
                        videoEl.play().catch(() => {});
                    });
                });
            } else {
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    videoEl.play().then(() => {
                        setAudioFocus(activeAudioIndex);
                    }).catch(() => {});
                });
            }

            hls.on(Hls.Events.ERROR, async (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hls.recoverMediaError();
                            break;
                        default:
                            hls.recoverMediaError();
                            hls.startLoad();
                            break;
                    }
                } else if (data.details === 'bufferStalledError' || data.details === 'fragLoadError') {
                    hls.startLoad();
                    videoEl.play().catch(() => {});
                }
            });
            hlsInstances[i] = hls;

            // Kan 11 startup stall recovery watchdog
            if (isKan) {
                setTimeout(() => {
                    if (videoEl && videoEl.paused && hls) {
                        hls.recoverMediaError();
                        hls.startLoad();
                        videoEl.play().catch(() => {});
                    }
                }, 2500);
            }

            // Auto-recovery watchdog: if stream stalls on startup, kickstart it automatically after 2 seconds
            setTimeout(() => {
                if (videoEl && videoEl.paused && hls) {
                    hls.startLoad();
                    videoEl.play().catch(() => {});
                }
            }, 2000);
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.muted = true;
            videoEl.src = streamUrl;
            videoEl.play().then(() => {
                setAudioFocus(activeAudioIndex);
            }).catch(() => {});
        }
    }
    setAudioFocus(activeAudioIndex);
}

function setAudioFocus(index) {
    activeAudioIndex = index;
    document.querySelectorAll('.tile').forEach((tile, i) => {
        const videoEl = document.getElementById(`video-${i}`);
        if (i === index) {
            tile.classList.add('active');
            if (videoEl) {
                videoEl.muted = false;
                videoEl.volume = 1.0;
                videoEl.play().catch(err => {
                    console.warn("[NewsGrid] Audio focus play blocked, keeping muted:", err);
                    videoEl.muted = true;
                    videoEl.play().catch(() => {});
                });
            }
        } else {
            tile.classList.remove('active');
            if (videoEl) videoEl.muted = true;
        }
    });
}

// One-time interaction listener to enable audio on first click/tap
document.addEventListener('click', () => {
    const activeVideo = document.getElementById(`video-${activeAudioIndex}`);
    if (activeVideo && activeVideo.muted) {
        activeVideo.muted = false;
        activeVideo.play().catch(() => {});
    }
}, { once: true });

document.querySelectorAll('.tile').forEach(tile => {
    const index = parseInt(tile.dataset.index);
    tile.addEventListener('click', () => {
        if (tile.classList.contains('fullscreen')) {
            tile.classList.remove('fullscreen');
        } else if (activeAudioIndex === index) {
            document.querySelectorAll('.tile').forEach(t => t.classList.remove('fullscreen'));
            tile.classList.toggle('fullscreen');
        } else {
            setAudioFocus(index);
        }
    });
});

const modal = document.getElementById('modal');
const channelList = document.getElementById('channel-list');
const countLabel = document.getElementById('count-label');

document.getElementById('open-settings').addEventListener('click', () => {
    renderModalList();
    modal.classList.add('open');
});

document.getElementById('close-modal').addEventListener('click', () => { modal.classList.remove('open'); });

function renderModalList() {
    channelList.innerHTML = '';
    const selectedUrls = selectedChannels.map(c => c.url);
    availableChannels.forEach(channel => {
        const item = document.createElement('label');
        item.className = 'channel-item';
        const isChecked = selectedUrls.includes(channel.url);
        item.innerHTML = '<span>' + channel.name + '</span><input type="checkbox" value="' + channel.url + '" ' + (isChecked ? 'checked' : '') + '>';
        const checkbox = item.querySelector('input');
        checkbox.addEventListener('change', () => {
            if (channelList.querySelectorAll('input:checked').length > 4) {
                checkbox.checked = false;
                alert("Select up to 4 channels only.");
            }
            const count = channelList.querySelectorAll('input:checked').length;
            countLabel.textContent = '(' + count + '/4 selected)';
        });
        channelList.appendChild(item);
    });
    const totalCount = channelList.querySelectorAll('input:checked').length;
    countLabel.textContent = '(' + totalCount + '/4 selected)';
}

document.getElementById('save-channels').addEventListener('click', () => {
    const checkedUrls = Array.from(channelList.querySelectorAll('input:checked')).map(cb => cb.value);
    if (checkedUrls.length === 0) return;
    selectedChannels = availableChannels.filter(c => checkedUrls.includes(c.url)).slice(0, 4);
    localStorage.setItem("newsgrid_ext_selected", JSON.stringify(selectedChannels.map(c => c.url)));
    modal.classList.remove('open');
    initGrid();
});

fetchGistChannels();

// Universal playback stall & freeze recovery watchdog
setInterval(() => {
    for (let i = 0; i < 4; i++) {
        const v = document.getElementById(`video-${i}`);
        const h = hlsInstances[i];
        if (v && h) {
            if (!v.paused && v.readyState < 3) {
                h.startLoad();
                h.recoverMediaError();
                v.play().catch(() => {});
            }
            if (v.paused && selectedChannels[i]) {
                v.play().catch(() => {});
            }
        }
    }
}, 3000);
