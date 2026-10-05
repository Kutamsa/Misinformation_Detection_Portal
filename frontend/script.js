/**
 * VerifyIt — Client Application Logic (Full Editorial Edition)
 * Connects Voice, Text, Vision, Trending Debunks, AI Forensics, and Live RSS.
 */

const API_BASE = window.location.origin;

// State Variables
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingSeconds = 0;
let activeSourceId = null;
let articlesOffset = 0;
const ARTICLES_PAGE_SIZE = 9;

// ============================================================================
// 1. Toast Notification Helper
// ============================================================================
function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show ${isError ? 'error' : 'success'}`;
    setTimeout(() => {
        toast.className = "toast";
    }, 4500);
}

// ============================================================================
// 2. Mode Switcher (Voice / Text / Image)
// ============================================================================
function switchMode(mode) {
    // 1. Update tab buttons
    document.querySelectorAll(".tab-button").forEach(btn => btn.classList.remove("active"));
    const activeTab = document.getElementById(`tab-${mode}`);
    if (activeTab) activeTab.classList.add("active");

    // 2. Display corresponding mode view
    ["voice", "text", "image"].forEach(m => {
        const view = document.getElementById(`mode-${m}`);
        if (view) view.style.display = (m === mode) ? "block" : "none";
    });

    // 3. Stop recording if switching away during recording
    if (mediaRecorder && mediaRecorder.state === "recording") {
        stopVoiceRecording();
    }
}

// ============================================================================
// 3. Voice Recording Mode
// ============================================================================
async function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        stopVoiceRecording();
    } else {
        startVoiceRecording();
    }
}

async function startVoiceRecording() {
    audioChunks = [];
    recordingSeconds = 0;
    const recordBtn = document.getElementById("recordBtn");
    const recordStatus = document.getElementById("recordStatus");
    const recordTimer = document.getElementById("recordTimer");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = handleRecordingComplete;

        mediaRecorder.start();
        recordBtn.classList.add("recording");
        recordStatus.textContent = "Listening... Speak your claim";
        recordTimer.textContent = "00:00";

        // Increment timer every second
        clearInterval(recordingTimer);
        recordingTimer = setInterval(() => {
            recordingSeconds++;
            const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, "0");
            const secs = String(recordingSeconds % 60).padStart(2, "0");
            recordTimer.textContent = `${mins}:${secs}`;
        }, 1000);

    } catch (err) {
        console.error("Microphone access error:", err);
        showToast("Microphone access denied. Please grant microphone permissions in browser.", true);
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    clearInterval(recordingTimer);
    const recordBtn = document.getElementById("recordBtn");
    const recordStatus = document.getElementById("recordStatus");
    recordBtn.classList.remove("recording");
    recordStatus.textContent = "Transcribing with Whisper...";
}

async function handleRecordingComplete() {
    const audioBlob = new Blob(audioChunks, { type: "audio/mp3" });
    const formData = new FormData();
    formData.append("audio_file", audioBlob, "recording.mp3");

    // Show preview player
    const previewPlayer = document.getElementById("recordedAudioPlayer");
    previewPlayer.src = URL.createObjectURL(audioBlob);
    previewPlayer.style.display = "block";

    setLoading(true, "Transcribing voice with Whisper & verifying claim...");

    try {
        const res = await fetch(`${API_BASE}/factcheck/audio`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        setLoading(false);

        if (res.ok) {
            displayVerdictResult(data);
            document.getElementById("recordStatus").textContent = "Recording verified";
        } else {
            showToast(data.error || "Failed to analyze voice recording.", true);
        }
    } catch (err) {
        setLoading(false);
        showToast("Server connection error during voice analysis.", true);
    }
}

// ============================================================================
// 4. Text Statement Mode
// ============================================================================
function fillSample(text) {
    const input = document.getElementById("inputText");
    input.value = text;
    switchMode('text');
    input.focus();
}

function clearTextInput() {
    document.getElementById("inputText").value = "";
}

async function submitText() {
    const input = document.getElementById("inputText");
    const text = input.value.trim();

    if (!text) {
        showToast("Please enter a news statement or rumor to verify.", true);
        return;
    }

    setLoading(true, "Cross-referencing claim across truth databases...");

    try {
        const res = await fetch(`${API_BASE}/factcheck/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const data = await res.json();
        setLoading(false);

        if (res.ok) {
            displayVerdictResult(data);
        } else {
            showToast(data.error || "Failed to verify statement.", true);
        }
    } catch (err) {
        setLoading(false);
        showToast("Unable to connect to verification server.", true);
    }
}

// ============================================================================
// 5. Image & Screenshot Mode
// ============================================================================
function handleImageSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    const preview = document.getElementById("imagePreview");
    const previewContainer = document.getElementById("imagePreviewContainer");
    const promptWrap = document.getElementById("dropzonePrompt");

    preview.src = URL.createObjectURL(file);
    previewContainer.style.display = "inline-block";
    promptWrap.style.display = "none";
}

function removeImageFile(event) {
    if (event) event.stopPropagation();
    const input = document.getElementById("imageInput");
    input.value = "";
    document.getElementById("imagePreview").src = "";
    document.getElementById("imagePreviewContainer").style.display = "none";
    document.getElementById("dropzonePrompt").style.display = "block";
}

async function uploadImage() {
    const input = document.getElementById("imageInput");
    const captionInput = document.getElementById("captionInput");
    const file = input.files[0];

    if (!file) {
        showToast("Please select a screenshot or image to analyze.", true);
        return;
    }

    const formData = new FormData();
    formData.append("image", file);
    if (captionInput.value.trim()) {
        formData.append("caption", captionInput.value.trim());
    }

    setLoading(true, "Inspecting screenshot claims with Gemini Vision...");

    try {
        const res = await fetch(`${API_BASE}/factcheck/image`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        setLoading(false);

        if (res.ok) {
            displayVerdictResult(data);
        } else {
            showToast(data.error || "Failed to analyze image.", true);
        }
    } catch (err) {
        setLoading(false);
        showToast("Server error during image analysis.", true);
    }
}

// ============================================================================
// 6. Truth-O-Meter Verdict Rendering
// ============================================================================
function displayVerdictResult(data) {
    const placeholder = document.getElementById("resultPlaceholder");
    const resultCard = document.getElementById("resultCard");
    const banner = document.getElementById("verdictBanner");
    const verdictTitle = document.getElementById("verdictTitle");
    const truthScore = document.getElementById("truthScore");
    const truthScoreLabel = document.getElementById("truthScoreLabel");
    const certaintySub = document.getElementById("certaintySub");
    const truthProgressBar = document.getElementById("truthProgressBar");
    const englishSummary = document.getElementById("englishSummaryText");
    const resultText = document.getElementById("resultText");
    const transcriptionSnippet = document.getElementById("transcriptionSnippet");
    const transcriptionContent = document.getElementById("transcriptionContent");
    const audioVerdictWrap = document.getElementById("audioVerdictWrap");
    const verdictAudioPlayer = document.getElementById("verdictAudioPlayer");

    // 1. Hide placeholder and show active verdict card
    if (placeholder) placeholder.style.display = "none";
    resultCard.style.display = "block";

    // 2. Determine Verdict Color, Truth Rating & Model Certainty
    const rawVerdict = (data.verdict || "UNVERIFIED").toUpperCase();
    banner.className = "verdict-header-banner";
    const confVal = data.confidence || 95;

    if (rawVerdict.includes("FALSE") || rawVerdict.includes("FAKE")) {
        banner.classList.add("banner-false");
        verdictTitle.textContent = "🔴 FALSE / MISINFORMATION";
        if (truthScore) truthScore.textContent = "0%";
        if (truthScoreLabel) truthScoreLabel.textContent = "TRUTH SCORE";
        if (certaintySub) certaintySub.textContent = `Certainty: ${confVal}% (Debunked)`;
        if (truthProgressBar) {
            truthProgressBar.style.width = "0%";
            truthProgressBar.style.backgroundColor = "#E53E3E";
        }
    } else if (rawVerdict.includes("TRUE")) {
        banner.classList.add("banner-true");
        verdictTitle.textContent = "🟢 TRUE / VERIFIED FACT";
        const scoreVal = (data.truth_score !== undefined && data.truth_score !== null) ? data.truth_score : (confVal > 90 ? confVal : 100);
        if (truthScore) truthScore.textContent = `${scoreVal}%`;
        if (truthScoreLabel) truthScoreLabel.textContent = "TRUTH SCORE";
        if (certaintySub) certaintySub.textContent = `Certainty: ${confVal}% (Verified)`;
        if (truthProgressBar) {
            truthProgressBar.style.width = `${scoreVal}%`;
            truthProgressBar.style.backgroundColor = "#2E7D32";
        }
    } else if (rawVerdict.includes("MISLEAD")) {
        banner.classList.add("banner-misleading");
        verdictTitle.textContent = "🟡 MISLEADING / MISSING CONTEXT";
        const scoreVal = (data.truth_score !== undefined && data.truth_score !== null) ? data.truth_score : 40;
        if (truthScore) truthScore.textContent = `${scoreVal}%`;
        if (truthScoreLabel) truthScoreLabel.textContent = "PARTIAL TRUTH";
        if (certaintySub) certaintySub.textContent = `Certainty: ${confVal}% (Distorted)`;
        if (truthProgressBar) {
            truthProgressBar.style.width = `${scoreVal}%`;
            truthProgressBar.style.backgroundColor = "#D97706";
        }
    } else {
        banner.classList.add("banner-unverified");
        verdictTitle.textContent = "⚪ UNVERIFIED CLAIM";
        if (truthScore) truthScore.textContent = "--";
        if (truthScoreLabel) truthScoreLabel.textContent = "UNCONFIRMED";
        if (certaintySub) certaintySub.textContent = "Needs Evidence";
        if (truthProgressBar) {
            truthProgressBar.style.width = "0%";
            truthProgressBar.style.backgroundColor = "#9CA3AF";
        }
    }

    // 3. Set Content
    englishSummary.textContent = data.english_summary || "Verification analysis complete.";
    resultText.textContent = data.result || "సమాచార పరిశీలన పూర్తయింది.";

    // 4. Transcription Snippet
    if (data.transcription) {
        transcriptionContent.textContent = `"${data.transcription}"`;
        transcriptionSnippet.style.display = "flex";
    } else {
        transcriptionSnippet.style.display = "none";
    }

    // 5. Audio Player for Spoken Telugu Verdict
    if (data.audio_result) {
        try {
            const byteCharacters = atob(data.audio_result);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: "audio/mp3" });
            verdictAudioPlayer.src = URL.createObjectURL(blob);
            audioVerdictWrap.style.display = "flex";
            verdictAudioPlayer.play().catch(() => {/* Ignore browser autoplay restriction */});
        } catch (e) {
            console.warn("Could not play audio verdict:", e);
            audioVerdictWrap.style.display = "none";
        }
    } else {
        audioVerdictWrap.style.display = "none";
    }

    // 6. Citations from Live RAG Fact-Checking Wire
    const ragCitationsWrap = document.getElementById("ragCitationsWrap");
    const citationsList = document.getElementById("citationsList");
    if (ragCitationsWrap && citationsList) {
        if (data.citations && data.citations.length > 0) {
            citationsList.innerHTML = "";
            data.citations.forEach(c => {
                const chip = document.createElement("a");
                chip.className = "citation-chip";
                chip.href = c.link;
                chip.target = "_blank";
                chip.rel = "noopener noreferrer";
                chip.innerHTML = `
                    <span class="cit-source">📰 ${escapeHtml(c.source)}</span>
                    <span class="cit-title">${escapeHtml(c.title)}</span>
                    <span class="cit-arrow">↗</span>
                `;
                citationsList.appendChild(chip);
            });
            ragCitationsWrap.style.display = "block";
        } else {
            ragCitationsWrap.style.display = "none";
        }
    }

    // 7. Actionable Defense & WhatsApp Debunk Card
    currentWhatsAppCard = data.whatsapp_card || "";
    const actionAdviceText = document.getElementById("actionAdviceText");
    if (actionAdviceText) {
        if (rawVerdict.includes("FALSE") || rawVerdict.includes("FAKE")) {
            actionAdviceText.textContent = "🛡️ Do not forward. This claim is completely debunked. Click below to copy a WhatsApp-ready debunk card to reply in groups.";
        } else if (rawVerdict.includes("MISLEAD")) {
            actionAdviceText.textContent = "⚠️ Handle with caution. Essential context has been omitted or manipulated to mislead viewers.";
        } else if (rawVerdict.includes("TRUE")) {
            actionAdviceText.textContent = "✅ Verified Authentic. This claim is confirmed by credible reporting and official documentation.";
        } else {
            actionAdviceText.textContent = "❓ Unconfirmed. Awaiting primary documentation from independent fact-checking bureaus.";
        }
    }

    // Smooth scroll to verdict card
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

let currentWhatsAppCard = "";

function copyWhatsAppDebunkCard() {
    if (!currentWhatsAppCard) {
        const summary = document.getElementById("englishSummaryText").textContent;
        const verdict = document.getElementById("verdictTitle").textContent;
        currentWhatsAppCard = `🚨 *VERIFYIT FACT-CHECK REPORT* 🚨\n\n📌 *Verdict:* ${verdict}\n📝 *Fact Summary:* ${summary}\n\n🛡️ *Action:* Do not forward unverified rumors!\n🔍 Verified by VerifyIt Portal`;
    }
    navigator.clipboard.writeText(currentWhatsAppCard).then(() => {
        showToast("📲 WhatsApp Debunk Card copied! Ready to paste into groups.");
    }).catch(() => {
        showToast("Could not access clipboard.", true);
    });
}

function copyResultText() {
    const summary = document.getElementById("englishSummaryText").textContent;
    const telugu = document.getElementById("resultText").textContent;
    const textToCopy = `[VerifyIt Fact-Check]\nVerdict Summary: ${summary}\n\nTelugu Explanation: ${telugu}\nVerified by VerifyIt Portal`;

    navigator.clipboard.writeText(textToCopy).then(() => {
        showToast("Fact-check verdict copied to clipboard!");
    });
}

function setLoading(isLoading, message = "Analyzing claim...") {
    const loader = document.getElementById("loadingIndicator");
    const msgEl = document.getElementById("loadingMessage");
    if (loader) {
        loader.style.display = isLoading ? "flex" : "none";
        if (msgEl) msgEl.textContent = message;
    }
}

// ============================================================================
// 7. Trending Debunks Section
// ============================================================================
async function loadTrendingDebunks() {
    try {
        const res = await fetch(`${API_BASE}/api/trending-debunks`);
        const data = await res.json();
        const container = document.getElementById("debunksContainer");
        if (!container || !data.debunks) return;

        container.innerHTML = "";

        data.debunks.forEach(item => {
            const card = document.createElement("div");
            card.className = "debunk-card";

            let badgeClass = "badge-false";
            if (item.verdict === "TRUE") badgeClass = "badge-true";
            else if (item.verdict === "MISLEADING") badgeClass = "badge-mislead";

            card.innerHTML = `
                <div class="debunk-meta-row">
                    <span class="badge-verdict ${badgeClass}">🔴 ${escapeHtml(item.verdict_badge)}</span>
                    <span class="debunk-origin">${escapeHtml(item.origin)}</span>
                </div>
                <h4 class="debunk-claim-text">${escapeHtml(item.claim)}</h4>
                <p class="debunk-summary-text">${escapeHtml(item.summary)}</p>
                <div class="debunk-footer">
                    <span class="debunk-category">${escapeHtml(item.category)}</span>
                    <button class="btn-verify-chip" onclick="loadDebunkIntoMeter('${escapeHtml(item.claim)}')">
                        🔍 Verify in Truth-O-Meter
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        console.warn("Could not load trending debunks:", err);
    }
}

function loadDebunkIntoMeter(claimText) {
    fillSample(claimText);
    document.getElementById("verifier-section").scrollIntoView({ behavior: "smooth" });
    submitText();
}

// ============================================================================
// 8. Live Verified News Wire & RSS Feeds
// ============================================================================
function toggleAddSourceForm() {
    const form = document.getElementById("addSourceForm");
    form.style.display = form.style.display === "none" ? "block" : "none";
}

async function addNewsSource() {
    const nameInput = document.getElementById("sourceNameInput");
    const urlInput = document.getElementById("rssUrlInput");

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    if (!name || !url) {
        showToast("Please enter both a source name and valid RSS feed URL.", true);
        return;
    }

    const formData = new FormData();
    formData.append("source_name", name);
    formData.append("source_url", url);

    try {
        const res = await fetch(`${API_BASE}/news/add_source`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();

        if (res.ok) {
            showToast("Source added and articles synced!");
            nameInput.value = "";
            urlInput.value = "";
            toggleAddSourceForm();
            await loadSources();
            if (data.id) {
                selectSource(data.id);
            }
        } else {
            showToast(data.error || "Failed to add news source.", true);
        }
    } catch (err) {
        showToast("Network error adding news source.", true);
    }
}

async function removeSource(sourceId, event) {
    if (event) event.stopPropagation();
    if (!confirm("Are you sure you want to remove this news source?")) return;

    const formData = new FormData();
    formData.append("source_id", sourceId);

    try {
        const res = await fetch(`${API_BASE}/news/remove_source`, {
            method: "POST",
            body: formData
        });
        if (res.ok) {
            showToast("Source removed from wire.");
            activeSourceId = null;
            await loadSources();
            loadArticles(true);
        } else {
            const data = await res.json();
            showToast(data.error || "Failed to remove source.", true);
        }
    } catch (err) {
        showToast("Network error removing source.", true);
    }
}

async function loadSources() {
    try {
        const res = await fetch(`${API_BASE}/news/sources`);
        const data = await res.json();
        const container = document.getElementById("sourceFiltersContainer");

        container.innerHTML = `
            <button class="source-filter-pill ${activeSourceId === null ? 'active' : ''}" 
                    id="chipAllSources" onclick="selectSource(null)">
                All Feeds
            </button>
        `;

        if (data.sources && data.sources.length > 0) {
            data.sources.forEach(source => {
                const chip = document.createElement("button");
                chip.className = `source-filter-pill ${activeSourceId === source.id ? 'active' : ''}`;
                chip.innerHTML = `
                    <span>${escapeHtml(source.name)}</span>
                    <span class="btn-delete-feed" onclick="removeSource(${source.id}, event)" title="Remove source">✕</span>
                `;
                chip.onclick = () => selectSource(source.id);
                container.appendChild(chip);
            });
        }
    } catch (err) {
        console.warn("Could not load sources:", err);
    }
}

async function selectSource(sourceId) {
    activeSourceId = sourceId;
    articlesOffset = 0;
    await loadSources();
    loadArticles(true);
}

async function loadArticles(reset = false) {
    if (reset) {
        articlesOffset = 0;
        document.getElementById("articlesList").innerHTML = `<div style="text-align: center; color: #64748b; padding: 24px; grid-column: 1/-1;">Syncing verified wire articles...</div>`;
    }

    let url = `${API_BASE}/news/articles?offset=${articlesOffset}&limit=${ARTICLES_PAGE_SIZE}`;
    if (activeSourceId) {
        url += `&source_id=${activeSourceId}`;
    }

    try {
        const res = await fetch(url);
        const data = await res.json();
        const list = document.getElementById("articlesList");
        const loadMoreWrap = document.getElementById("loadMoreWrap");

        if (reset) list.innerHTML = "";

        if (data.articles && data.articles.length > 0) {
            data.articles.forEach(article => {
                const card = document.createElement("div");
                card.className = "article-grid-card";
                const dateStr = article.pubDate ? new Date(article.pubDate).toLocaleDateString() : "Recent";

                card.innerHTML = `
                    <div class="article-grid-meta">
                        <span class="article-source-tag">${escapeHtml(article.source || "News")}</span>
                        <span class="article-date-stamp">📅 ${dateStr}</span>
                    </div>
                    <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer" class="article-headline-link">
                        ${escapeHtml(article.title)}
                    </a>
                `;
                list.appendChild(card);
            });

            articlesOffset += data.articles.length;
            loadMoreWrap.style.display = data.hasMore ? "block" : "none";
        } else if (reset) {
            list.innerHTML = `<div style="text-align: center; color: #64748b; padding: 30px; grid-column: 1/-1;">No articles found for this selection. Try clicking "All Feeds".</div>`;
            loadMoreWrap.style.display = "none";
        }
    } catch (err) {
        console.error("Error loading articles:", err);
        document.getElementById("articlesList").innerHTML = `<div style="text-align: center; color: #ef4444; padding: 24px; grid-column: 1/-1;">Could not connect to news feed database.</div>`;
    }
}

function loadMoreArticles() {
    loadArticles(false);
}

function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ============================================================================
// 9. Page Initialization
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
    switchMode("voice");
    loadTrendingDebunks();
    loadSources();
    loadArticles(true);
});
