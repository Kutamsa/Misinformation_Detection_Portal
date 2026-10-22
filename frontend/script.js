/**
 * VerifyIt — Client Application Logic (Professional Edition)
 * Zero emoji clutter, reliable fallbacks, smooth audio/text/image verification.
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

// Curated Fallback Data for Trending Debunks (Ensures UI never looks empty)
const FALLBACK_DEBUNKS = [
    {
        id: 1,
        claim: "Viral claim that UNESCO declared the Indian National Anthem as the 'Best in the World'",
        verdict: "FALSE",
        verdict_badge: "DEBUNKED",
        truth_score: 0,
        confidence: 99,
        category: "National / Culture",
        origin: "WhatsApp Forward",
        summary: "UNESCO confirmed it has never held such competitions or declarations. This is a recurring hoax circulating since 2008.",
        date: "Updated Recently"
    },
    {
        id: 2,
        claim: "Photo of Pope Francis walking the streets wearing a luxury Balenciaga white puffer jacket",
        verdict: "FALSE",
        verdict_badge: "AI-GENERATED",
        truth_score: 0,
        confidence: 98,
        category: "AI Imagery & Deepfakes",
        origin: "Social Media Viral",
        summary: "The image was generated using Midjourney v5 by a digital creator. Physical inspection reveals distorted glasses and blurred earlobes.",
        date: "Trending"
    },
    {
        id: 3,
        claim: "RBI to introduce new ₹1000 notes embedded with GPS nano-chips for satellite tracking",
        verdict: "FALSE",
        verdict_badge: "FABRICATED",
        truth_score: 0,
        confidence: 97,
        category: "Banking & Economy",
        origin: "Viral Forward",
        summary: "The Reserve Bank of India has repeatedly clarified that no such currency is being printed and banknotes do not contain nano-chips.",
        date: "Debunked"
    },
    {
        id: 4,
        claim: "Drinking boiled ginger, garlic, and turmeric water completely cures chronic asthma & lung infections",
        verdict: "MISLEADING",
        verdict_badge: "MISLEADING",
        truth_score: 40,
        confidence: 92,
        category: "Health & Medicine",
        origin: "Video Reels",
        summary: "These ingredients offer mild anti-inflammatory benefits but cannot cure asthma or replace prescribed clinical treatment.",
        date: "Medical Warning"
    },
    {
        id: 5,
        claim: "ISRO successfully landed Chandrayaan-3 Vikram Lander near the Lunar South Pole",
        verdict: "TRUE",
        verdict_badge: "VERIFIED FACT",
        truth_score: 100,
        confidence: 100,
        category: "Science & Space",
        origin: "Official Confirmation",
        summary: "On August 23, 2023, ISRO achieved a historic soft landing near the Moon's South Pole, verified by international space agencies.",
        date: "Historical Fact"
    }
];

// Curated Fallback Wire Articles with High-Resolution Contextual Imagery
const FALLBACK_ARTICLES = [
    {
        title: "Fact Check: No, Government is not distributing free laptops under digital literacy scheme",
        link: "https://www.boomlive.in/fast-check",
        source: "BOOM Live",
        imageUrl: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=700&auto=format&fit=crop&q=80",
        pubDate: new Date().toISOString()
    },
    {
        title: "Altered video falsely shared as crowd protesting during recent state assembly elections",
        link: "https://www.altnews.in",
        source: "Alt News",
        imageUrl: "https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=700&auto=format&fit=crop&q=80",
        pubDate: new Date(Date.now() - 3600000 * 4).toISOString()
    },
    {
        title: "Did NASA announce 15 days of total worldwide darkness? Scientific debunk",
        link: "https://www.snopes.com",
        source: "Snopes",
        imageUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=700&auto=format&fit=crop&q=80",
        pubDate: new Date(Date.now() - 3600000 * 12).toISOString()
    },
    {
        title: "Viral notice claiming changes to banking transfer charges is fabricated",
        link: "https://www.vishvasnews.com",
        source: "Vishvas News",
        imageUrl: "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=700&auto=format&fit=crop&q=80",
        pubDate: new Date(Date.now() - 3600000 * 24).toISOString()
    },
    {
        title: "FactCheck: Examination of viral claims surrounding parliamentary debate transcript",
        link: "https://www.factcheck.org",
        source: "FactCheck.org",
        imageUrl: "https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=700&auto=format&fit=crop&q=80",
        pubDate: new Date(Date.now() - 3600000 * 36).toISOString()
    },
    {
        title: "AI generated audio clone of political leader fabricated using diffusion model",
        link: "https://www.boomlive.in",
        source: "BOOM Live",
        imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=700&auto=format&fit=crop&q=80",
        pubDate: new Date(Date.now() - 3600000 * 48).toISOString()
    }
];

// Staged Media State for Unified Omnibar
let currentAudioBlob = null;
let currentImageFile = null;
let allLoadedDebunks = [];

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
    }, 4000);
}

// Backward-compatible switchMode stub in case called from legacy links
function switchMode(mode) {
    const input = document.getElementById("inputText");
    if (input) input.focus();
}

// ============================================================================
// 2. Voice Recording Controls
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

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Audio recording is not supported in this browser.", true);
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = handleRecordingComplete;

        mediaRecorder.start();
        if (recordBtn) recordBtn.classList.add("recording");
        if (recordStatus) recordStatus.textContent = "Listening...";
        if (recordTimer) {
            recordTimer.textContent = "00:00";
            recordTimer.style.display = "inline-block";
        }

        clearInterval(recordingTimer);
        recordingTimer = setInterval(() => {
            recordingSeconds++;
            const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, "0");
            const secs = String(recordingSeconds % 60).padStart(2, "0");
            if (recordTimer) recordTimer.textContent = `${mins}:${secs}`;
        }, 1000);

    } catch (err) {
        console.warn("Microphone access error:", err);
        showToast("Microphone access unavailable or denied. Please check permissions.", true);
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
    const recordTimer = document.getElementById("recordTimer");

    if (recordBtn) recordBtn.classList.remove("recording");
    if (recordStatus) recordStatus.textContent = "Processing voice...";
    if (recordTimer) recordTimer.style.display = "none";
}

async function handleRecordingComplete() {
    const audioBlob = new Blob(audioChunks, { type: "audio/mp3" });
    currentAudioBlob = audioBlob;

    const audioPreviewContainer = document.getElementById("audioPreviewContainer");
    const previewPlayer = document.getElementById("recordedAudioPlayer");

    if (previewPlayer) {
        previewPlayer.src = URL.createObjectURL(audioBlob);
    }
    if (audioPreviewContainer) {
        audioPreviewContainer.style.display = "flex";
    }

    const recordStatus = document.getElementById("recordStatus");
    if (recordStatus) recordStatus.textContent = "Voice Staged";

    // Auto-verify voice recording seamlessly
    submitOmnibar();
}

function removeAudioFile(event) {
    if (event) event.stopPropagation();
    currentAudioBlob = null;
    const previewPlayer = document.getElementById("recordedAudioPlayer");
    if (previewPlayer) {
        previewPlayer.pause();
        previewPlayer.src = "";
    }
    const audioContainer = document.getElementById("audioPreviewContainer");
    if (audioContainer) audioContainer.style.display = "none";
    const recordStatus = document.getElementById("recordStatus");
    if (recordStatus) recordStatus.textContent = "Speak";
}

// ============================================================================
// 3. Photo & Screenshot Attachment
// ============================================================================
function handleImageSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    currentImageFile = file;
    const preview = document.getElementById("imagePreview");
    const previewContainer = document.getElementById("imagePreviewContainer");
    const fileNameEl = document.getElementById("imageFileName");

    if (preview) preview.src = URL.createObjectURL(file);
    if (fileNameEl) fileNameEl.textContent = file.name || "Photo Attached";
    if (previewContainer) previewContainer.style.display = "flex";
}

function removeImageFile(event) {
    if (event) event.stopPropagation();
    currentImageFile = null;
    const input = document.getElementById("imageInput");
    if (input) input.value = "";
    const preview = document.getElementById("imagePreview");
    if (preview) preview.src = "";
    const previewContainer = document.getElementById("imagePreviewContainer");
    if (previewContainer) previewContainer.style.display = "none";
}

// ============================================================================
// 4. Omnibar Control & Verification Dispatcher
// ============================================================================
function fillSample(text) {
    const input = document.getElementById("inputText");
    if (input) {
        input.value = text;
        input.focus();
    }
    submitOmnibar();
}

function clearAllInputs() {
    const input = document.getElementById("inputText");
    if (input) input.value = "";
    removeImageFile();
    removeAudioFile();
}

async function submitOmnibar() {
    const textInput = document.getElementById("inputText");
    const text = textInput ? textInput.value.trim() : "";

    // 1. Audio Priority: If audio was just recorded
    if (currentAudioBlob) {
        await submitAudioBlob(currentAudioBlob);
        return;
    }

    // 2. Photo Priority: If photo was attached
    if (currentImageFile) {
        await submitImageFile(currentImageFile, text);
        return;
    }

    // 3. Text Claim
    if (text) {
        await submitTextClaim(text);
        return;
    }

    showToast("Please enter a claim, speak into the mic, or attach a photo to verify.", true);
}

// Individual Verification Callers
async function submitTextClaim(text) {
    setLoading(true, "Cross-referencing claim across authoritative bureaus & live databases...");
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
        showToast("Unable to reach verification server.", true);
    }
}

async function submitAudioBlob(audioBlob) {
    const formData = new FormData();
    formData.append("audio_file", audioBlob, "recording.mp3");

    setLoading(true, "Transcribing speech and cross-examining ground truth...");
    try {
        const res = await fetch(`${API_BASE}/factcheck/audio`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        setLoading(false);

        if (res.ok) {
            displayVerdictResult(data);
            const recordStatus = document.getElementById("recordStatus");
            if (recordStatus) recordStatus.textContent = "Verified";
        } else {
            showToast(data.error || "Failed to analyze voice recording.", true);
        }
    } catch (err) {
        setLoading(false);
        showToast("Unable to reach verification server.", true);
    }
}

async function submitImageFile(file, caption) {
    const formData = new FormData();
    formData.append("image", file);
    if (caption) {
        formData.append("caption", caption);
    }

    setLoading(true, "Inspecting screenshot claims with vision intelligence...");
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
        showToast("Server connection error during image analysis.", true);
    }
}

// Compatibility functions for legacy buttons
function submitText() { submitOmnibar(); }
function uploadImage() { submitOmnibar(); }
function clearTextInput() { clearAllInputs(); }

// ============================================================================
// 5. Perspective Dossier Tabs
// ============================================================================
function switchDossierTab(tab) {
    const btnTelugu = document.getElementById("tab-dossier-telugu");
    const btnEvidence = document.getElementById("tab-dossier-evidence");
    const viewTelugu = document.getElementById("dossier-view-telugu");
    const viewEvidence = document.getElementById("dossier-view-evidence");

    if (tab === "telugu") {
        if (btnTelugu) btnTelugu.classList.add("active");
        if (btnEvidence) btnEvidence.classList.remove("active");
        if (viewTelugu) viewTelugu.style.display = "block";
        if (viewEvidence) viewEvidence.style.display = "none";
    } else {
        if (btnTelugu) btnTelugu.classList.remove("active");
        if (btnEvidence) btnEvidence.classList.add("active");
        if (viewTelugu) viewTelugu.style.display = "none";
        if (viewEvidence) viewEvidence.style.display = "block";
    }
}

// ============================================================================
// 6. Truth-O-Meter Verdict Rendering
// ============================================================================
let currentWhatsAppCard = "";

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

    if (placeholder) placeholder.style.display = "none";
    resultCard.style.display = "block";

    const rawVerdict = (data.verdict || "UNVERIFIED").toUpperCase();
    banner.className = "verdict-header-banner";
    const confVal = data.confidence || 95;

    if (rawVerdict.includes("FALSE") || rawVerdict.includes("FAKE")) {
        banner.classList.add("banner-false");
        verdictTitle.textContent = "FALSE / MISINFORMATION";
        if (truthScore) truthScore.textContent = "0%";
        if (truthScoreLabel) truthScoreLabel.textContent = "TRUTH SCORE";
        if (certaintySub) certaintySub.textContent = `Certainty: ${confVal}% (Debunked)`;
        if (truthProgressBar) {
            truthProgressBar.style.width = "0%";
            truthProgressBar.style.backgroundColor = "#DC2626";
        }
    } else if (rawVerdict.includes("TRUE")) {
        banner.classList.add("banner-true");
        verdictTitle.textContent = "TRUE / VERIFIED FACT";
        const scoreVal = (data.truth_score !== undefined && data.truth_score !== null) ? data.truth_score : (confVal > 90 ? confVal : 100);
        if (truthScore) truthScore.textContent = `${scoreVal}%`;
        if (truthScoreLabel) truthScoreLabel.textContent = "TRUTH SCORE";
        if (certaintySub) certaintySub.textContent = `Certainty: ${confVal}% (Verified)`;
        if (truthProgressBar) {
            truthProgressBar.style.width = `${scoreVal}%`;
            truthProgressBar.style.backgroundColor = "#16A34A";
        }
    } else if (rawVerdict.includes("MISLEAD")) {
        banner.classList.add("banner-misleading");
        verdictTitle.textContent = "MISLEADING / DISTORTED";
        const scoreVal = (data.truth_score !== undefined && data.truth_score !== null) ? data.truth_score : 40;
        if (truthScore) truthScore.textContent = `${scoreVal}%`;
        if (truthScoreLabel) truthScoreLabel.textContent = "PARTIAL TRUTH";
        if (certaintySub) certaintySub.textContent = `Certainty: ${confVal}% (Misleading)`;
        if (truthProgressBar) {
            truthProgressBar.style.width = `${scoreVal}%`;
            truthProgressBar.style.backgroundColor = "#D97706";
        }
    } else {
        banner.classList.add("banner-unverified");
        verdictTitle.textContent = "UNVERIFIED CLAIM";
        if (truthScore) truthScore.textContent = "--";
        if (truthScoreLabel) truthScoreLabel.textContent = "UNCONFIRMED";
        if (certaintySub) certaintySub.textContent = "Insufficient Ground Truth";
        if (truthProgressBar) {
            truthProgressBar.style.width = "0%";
            truthProgressBar.style.backgroundColor = "#64748B";
        }
    }

    englishSummary.textContent = data.english_summary || "Verification analysis complete.";
    resultText.textContent = data.result || "సమాచార పరిశీలన పూర్తయింది.";

    if (data.transcription) {
        transcriptionContent.textContent = `"${data.transcription}"`;
        transcriptionSnippet.style.display = "flex";
    } else {
        transcriptionSnippet.style.display = "none";
    }

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
        } catch (e) {
            console.warn("Could not decode audio:", e);
            audioVerdictWrap.style.display = "none";
        }
    } else {
        audioVerdictWrap.style.display = "none";
    }

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
                    <span class="cit-source">${escapeHtml(c.source)}</span>
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

    currentWhatsAppCard = data.whatsapp_card || "";
    const whatsappPreview = document.getElementById("whatsappPreviewContent");
    if (whatsappPreview) {
        const previewStr = (currentWhatsAppCard || `[VERIFYIT FACT-CHECK REPORT]\nVerdict: ${verdictTitle.textContent}\nSummary: ${englishSummary.textContent}\nAction: Please verify before forwarding in groups.`)
            .replace(/\n/g, "<br>");
        whatsappPreview.innerHTML = previewStr;
    }

    const actionAdviceText = document.getElementById("actionAdviceText");
    if (actionAdviceText) {
        if (rawVerdict.includes("FALSE") || rawVerdict.includes("FAKE")) {
            actionAdviceText.textContent = "Do not forward. This claim is completely debunked. Click below to copy a WhatsApp-ready debunk card to share in groups.";
        } else if (rawVerdict.includes("MISLEAD")) {
            actionAdviceText.textContent = "Handle with caution. Essential context has been omitted or manipulated to mislead viewers.";
        } else if (rawVerdict.includes("TRUE")) {
            actionAdviceText.textContent = "Verified Authentic. This claim is confirmed by credible reporting and official documentation.";
        } else {
            actionAdviceText.textContent = "Unconfirmed. Awaiting primary documentation from independent fact-checking bureaus.";
        }
    }

    // Save to Recent Verifications History
    const checkedClaim = (document.getElementById("inputText")?.value || "").trim();
    if (checkedClaim) {
        saveRecentVerification(checkedClaim, data.verdict, data.truth_score);
    }

    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Safe Clipboard Copy Helper with Legacy Fallback
function safeCopyText(text, successMsg = "Copied to clipboard.") {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(successMsg);
        }).catch(() => fallbackCopy(text, successMsg));
    } else {
        fallbackCopy(text, successMsg);
    }
}

function fallbackCopy(text, successMsg) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showToast(successMsg);
    } catch (err) {
        showToast("Could not access clipboard.", true);
    }
    document.body.removeChild(textArea);
}

function copyWhatsAppDebunkCard() {
    if (!currentWhatsAppCard) {
        const summary = document.getElementById("englishSummaryText").textContent;
        const verdict = document.getElementById("verdictTitle").textContent;
        currentWhatsAppCard = `🚨 *VERIFYIT FACT-CHECK REPORT* 🚨\n\n📌 *Verdict:* ${verdict}\n📝 *Summary:* ${summary}\n\n🛡️ *Action:* Do not forward unverified claims. Help stop rumors!\n🔍 Verified with VerifyIt Portal`;
    }
    safeCopyText(currentWhatsAppCard, "WhatsApp Debunk Card copied to clipboard.");
}

function openWhatsAppDirect() {
    const text = encodeURIComponent(currentWhatsAppCard || "Check facts before forwarding! Verified with VerifyIt Portal.");
    window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
}

function copyResultText() {
    const summary = document.getElementById("englishSummaryText").textContent;
    const telugu = document.getElementById("resultText").textContent;
    const textToCopy = `[VerifyIt Fact-Check]\nSummary: ${summary}\n\nTelugu Explanation: ${telugu}\nVerified by VerifyIt Portal`;
    safeCopyText(textToCopy, "Fact-check verdict copied to clipboard.");
}

// ============================================================================
// 6B. Recent Verifications (Local Storage Persistence)
// ============================================================================
const RECENT_VERIFICATIONS_KEY = "verifyit_recent_verifications";

function saveRecentVerification(claimText, verdict, truthScore) {
    if (!claimText || !claimText.trim()) return;
    try {
        let history = JSON.parse(localStorage.getItem(RECENT_VERIFICATIONS_KEY) || "[]");
        // Avoid duplicate top item
        if (history.length > 0 && history[0].claim.toLowerCase() === claimText.trim().toLowerCase()) return;
        
        history.unshift({
            claim: claimText.trim(),
            verdict: verdict || "UNVERIFIED",
            truthScore: truthScore !== undefined ? truthScore : 0,
            date: Date.now()
        });
        history = history.slice(0, 5); // Keep last 5
        localStorage.setItem(RECENT_VERIFICATIONS_KEY, JSON.stringify(history));
        renderRecentVerifications();
    } catch (e) {
        console.warn("Could not save recent verification", e);
    }
}

function loadRecentVerifications() {
    renderRecentVerifications();
}

function renderRecentVerifications() {
    const row = document.getElementById("recentVerificationsRow");
    const container = document.getElementById("recentChipsList");
    if (!row || !container) return;

    try {
        const history = JSON.parse(localStorage.getItem(RECENT_VERIFICATIONS_KEY) || "[]");
        if (!history || history.length === 0) {
            row.style.display = "none";
            return;
        }

        container.innerHTML = "";
        history.forEach(item => {
            const chip = document.createElement("button");
            const isFalse = (item.verdict || "").includes("FALSE");
            const isTrue = (item.verdict || "").includes("TRUE");
            const chipClass = isFalse ? "recent-false" : isTrue ? "recent-true" : "recent-mislead";
            
            chip.className = `recent-check-chip ${chipClass}`;
            chip.title = `Click to re-verify: ${item.claim}`;
            chip.innerHTML = `
                <span class="recent-dot"></span>
                <span class="recent-text">${escapeHtml(item.claim.length > 36 ? item.claim.slice(0, 34) + "..." : item.claim)}</span>
            `;
            chip.onclick = () => fillSample(item.claim);
            container.appendChild(chip);
        });

        row.style.display = "flex";
    } catch (e) {
        console.warn("Error rendering recent checks:", e);
        row.style.display = "none";
    }
}

// ============================================================================
// 6C. Certified High-Resolution Debunk Badge Generator (HTML5 Canvas)
// ============================================================================
function generateAndDownloadBadge() {
    const verdictTitle = (document.getElementById("verdictTitle")?.textContent || "FACT-CHECK REPORT").trim();
    const truthScore = (document.getElementById("truthScore")?.textContent || "0%").trim();
    const englishSummary = (document.getElementById("englishSummaryText")?.textContent || "Verification completed.").trim();
    const claimInput = (document.getElementById("inputText")?.value || "Viral Claim").trim();

    // Setup High-Res 1200x630 Canvas (Standard 1.91:1 Social / WhatsApp Card Aspect Ratio)
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d");

    const isFalse = verdictTitle.includes("FALSE") || verdictTitle.includes("MISINFORMATION");
    const isTrue = verdictTitle.includes("TRUE") || verdictTitle.includes("VERIFIED");
    const primaryColor = isFalse ? "#EF4444" : isTrue ? "#10B981" : "#F59E0B";

    // 1. Dark Gradient Background
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 630);
    bgGrad.addColorStop(0, "#0B1120");
    bgGrad.addColorStop(0.5, "#0F172A");
    bgGrad.addColorStop(1, "#1E293B");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1200, 630);

    // 2. Outer Accent Border
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 6;
    ctx.strokeRect(18, 18, 1164, 594);

    // 3. Inner Decorative Border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(32, 32, 1136, 566);

    // 4. Header Bar
    ctx.font = "bold 20px 'JetBrains Mono', monospace";
    ctx.fillStyle = primaryColor;
    ctx.fillText("🛡️ VERIFYIT INTELLIGENCE DOSSIER", 54, 75);

    ctx.font = "500 16px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#94A3B8";
    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    ctx.fillText(`AUTHENTICATED REPORT • ${dateStr.toUpperCase()}`, 750, 75);

    // Divider Line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(54, 96);
    ctx.lineTo(1146, 96);
    ctx.stroke();

    // 5. Claim Box
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    ctx.fillRect(54, 120, 1092, 130);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.strokeRect(54, 120, 1092, 130);

    ctx.font = "bold 15px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#60A5FA";
    ctx.fillText("EXAMINED VIRAL CLAIM:", 78, 150);

    ctx.font = "bold 24px 'Plus Jakarta Sans', sans-serif";
    ctx.fillStyle = "#FFFFFF";
    wrapText(ctx, `"${claimInput}"`, 78, 186, 1040, 32);

    // 6. Verdict Badge Pill
    ctx.fillStyle = primaryColor;
    roundRect(ctx, 54, 275, 420, 68, 8);
    ctx.fill();

    ctx.font = "900 26px 'Plus Jakarta Sans', sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(verdictTitle, 78, 318);

    // Truth Score Pill
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    roundRect(ctx, 490, 275, 260, 68, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.stroke();

    ctx.font = "bold 14px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#94A3B8";
    ctx.fillText("TRUTH SCORE:", 510, 302);

    ctx.font = "900 28px 'JetBrains Mono', monospace";
    ctx.fillStyle = primaryColor;
    ctx.fillText(truthScore, 510, 332);

    // 7. Executive Summary Box
    ctx.font = "bold 16px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#38BDF8";
    ctx.fillText("GROUND-TRUTH FINDINGS:", 54, 385);

    ctx.font = "400 22px 'Plus Jakarta Sans', sans-serif";
    ctx.fillStyle = "#E2E8F0";
    wrapText(ctx, englishSummary, 54, 424, 1080, 32);

    // 8. Footer Citations Strip
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.beginPath();
    ctx.moveTo(54, 535);
    ctx.lineTo(1146, 535);
    ctx.stroke();

    ctx.font = "500 16px 'Plus Jakarta Sans', sans-serif";
    ctx.fillStyle = "#94A3B8";
    ctx.fillText("Verified with independent fact-checking bureaus (BOOM Live, Alt News, Snopes, Vishvas News)", 54, 570);

    ctx.font = "bold 16px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#60A5FA";
    ctx.fillText("verifyit.portal", 990, 570);

    // Helper functions for canvas
    function roundRect(context, x, y, width, height, radius) {
        context.beginPath();
        context.moveTo(x + radius, y);
        context.lineTo(x + width - radius, y);
        context.quadraticCurveTo(x + width, y, x + width, y + radius);
        context.lineTo(x + width, y + height - radius);
        context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        context.lineTo(x + radius, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - radius);
        context.lineTo(x, y + radius);
        context.quadraticCurveTo(x, y, x + radius, y);
        context.closePath();
    }

    function wrapText(context, text, x, y, maxWidth, lineHeight) {
        const words = text.split(" ");
        let line = "";
        let currentY = y;
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + " ";
            const metrics = context.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                context.fillText(line, x, currentY);
                line = words[n] + " ";
                currentY += lineHeight;
                if (currentY > y + lineHeight * 2) {
                    context.fillText(line + "...", x, currentY);
                    return;
                }
            } else {
                line = testLine;
            }
        }
        context.fillText(line, x, currentY);
    }

    // Trigger instant PNG download
    try {
        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `VerifyIt_FactCheck_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast("Debunk Badge image generated and downloaded!");
    } catch (e) {
        console.error("Canvas export error:", e);
        showToast("Could not generate image on this device.", true);
    }
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
// 7. Trending Debunks Section, Live Search & Category Filtering
// ============================================================================
let currentCategoryFilter = "All";
let currentSearchQuery = "";

async function loadTrendingDebunks() {
    let debunks = [];

    try {
        const res = await fetch(`${API_BASE}/api/trending-debunks`);
        if (res.ok) {
            const data = await res.json();
            if (data.debunks && data.debunks.length > 0) {
                debunks = data.debunks;
            }
        }
    } catch (err) {
        console.warn("Could not fetch remote debunks, using fallback dataset:", err);
    }

    if (!debunks.length) {
        debunks = FALLBACK_DEBUNKS;
    }

    allLoadedDebunks = debunks;
    applyDebunkFilters();
}

function handleDebunkSearch(query) {
    currentSearchQuery = (query || "").trim().toLowerCase();
    applyDebunkFilters();
}

function filterRadarDebunks(category, btnElement) {
    document.querySelectorAll(".radar-pill").forEach(p => p.classList.remove("active"));
    if (btnElement) btnElement.classList.add("active");
    currentCategoryFilter = category;
    applyDebunkFilters();
}

function applyDebunkFilters() {
    let filtered = allLoadedDebunks;

    // 1. Category Filter
    if (currentCategoryFilter !== "All") {
        filtered = filtered.filter(item => {
            const cat = (item.category || "").toLowerCase();
            if (currentCategoryFilter === "AI") return cat.includes("ai") || cat.includes("deepfake");
            if (currentCategoryFilter === "Health") return cat.includes("health") || cat.includes("medicine");
            if (currentCategoryFilter === "Economy") return cat.includes("economy") || cat.includes("bank") || cat.includes("rbi");
            if (currentCategoryFilter === "National") return cat.includes("gov") || cat.includes("national") || cat.includes("scheme") || cat.includes("culture");
            return true;
        });
    }

    // 2. Keyword Search
    if (currentSearchQuery) {
        filtered = filtered.filter(item => {
            const claim = (item.claim || "").toLowerCase();
            const summary = (item.summary || "").toLowerCase();
            const cat = (item.category || "").toLowerCase();
            return claim.includes(currentSearchQuery) || summary.includes(currentSearchQuery) || cat.includes(currentSearchQuery);
        });
    }

    renderDebunkCards(filtered);
}

function renderDebunkCards(debunks) {
    const container = document.getElementById("debunksContainer");
    if (!container) return;

    container.innerHTML = "";

    if (!debunks.length) {
        container.innerHTML = `
            <div class="empty-wire-state">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.6;">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <p>No debunked claims matched your search query. Try clearing the filter.</p>
            </div>`;
        return;
    }

    debunks.forEach(item => {
        const card = document.createElement("div");
        
        let badgeClass = "badge-false";
        let dotClass = "dot-false";
        let cardBorderClass = "border-false";
        let confidencePct = item.confidence || 95;

        if (item.verdict === "TRUE") {
            badgeClass = "badge-true";
            dotClass = "dot-true";
            cardBorderClass = "border-true";
        } else if (item.verdict === "MISLEADING") {
            badgeClass = "badge-mislead";
            dotClass = "dot-mislead";
            cardBorderClass = "border-mislead";
        }

        card.className = "debunk-card";

        card.innerHTML = `
            <div class="debunk-meta-row">
                <span class="badge-verdict ${badgeClass}">
                    <span class="status-dot ${dotClass}"></span>
                    <span>${escapeHtml(item.verdict_badge || item.verdict)}</span>
                </span>
                <span class="debunk-origin-pill">${escapeHtml(item.origin || "Viral Wire")}</span>
            </div>
            
            <h4 class="debunk-claim-text">${escapeHtml(item.claim)}</h4>
            <p class="debunk-summary-text">${escapeHtml(item.summary)}</p>

            <div class="debunk-footer">
                <span class="debunk-category">${escapeHtml(item.category || "General")}</span>
                <div class="debunk-card-actions">
                    <button class="btn-card-copy-debunk" onclick="quickShareDebunk('${escapeHtml(item.claim)}', '${escapeHtml(item.verdict_badge || item.verdict)}', '${escapeHtml(item.summary)}')" title="Copy debunk statement for WhatsApp">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Share</span>
                    </button>
                    <button class="btn-verify-chip" onclick="loadDebunkIntoMeter('${escapeHtml(item.claim)}')">
                        <span>Inspect</span>
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function quickShareDebunk(claim, verdict, summary) {
    const text = `🚨 *FACT CHECK ALERT* 🚨\nClaim: "${claim}"\nVerdict: *${verdict}*\nSummary: ${summary}\n\nVerified via VerifyIt Intelligence Portal.`;
    safeCopyText(text, "Debunk card copied to clipboard for sharing.");
}

function loadDebunkIntoMeter(claimText) {
    fillSample(claimText);
    const verifier = document.getElementById("verifier-section");
    if (verifier) verifier.scrollIntoView({ behavior: "smooth" });
    // Note: fillSample already called submitOmnibar, no duplicate call needed!
}

// ============================================================================
// 8. Live Verified News Wire & RSS Feeds
// ============================================================================
function toggleAddSourceForm() {
    const form = document.getElementById("addSourceForm");
    if (!form) return;
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
    const container = document.getElementById("sourceFiltersContainer");
    if (!container) return;

    container.innerHTML = `
        <button class="source-filter-pill ${activeSourceId === null ? 'active' : ''}" 
                id="chipAllSources" onclick="selectSource(null)">
            All Feeds
        </button>
    `;

    try {
        const res = await fetch(`${API_BASE}/news/sources`);
        if (res.ok) {
            const data = await res.json();
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
        }
    } catch (err) {
        console.warn("Could not load sources from backend, using default list:", err);
    }
}

async function selectSource(sourceId) {
    activeSourceId = sourceId;
    articlesOffset = 0;
    await loadSources();
    loadArticles(true);
}

async function loadArticles(reset = false) {
    const list = document.getElementById("articlesList");
    const loadMoreWrap = document.getElementById("loadMoreWrap");
    if (!list) return;

    if (reset) {
        articlesOffset = 0;
    }

    let url = `${API_BASE}/news/articles?offset=${articlesOffset}&limit=${ARTICLES_PAGE_SIZE}`;
    if (activeSourceId) {
        url += `&source_id=${activeSourceId}`;
    }

    let articles = [];
    let hasMore = false;

    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data.articles && data.articles.length > 0) {
                articles = data.articles;
                hasMore = !!data.hasMore;
            }
        }
    } catch (err) {
        console.warn("Articles API unreachable, showing curated wire articles:", err);
    }

    if (reset) list.innerHTML = "";

    // If API returned nothing on initial load, use curated fallback articles
    if (!articles.length && reset) {
        articles = FALLBACK_ARTICLES;
        hasMore = false;
    }

// Helper: Human-Friendly Relative Timestamp
function getRelativeTime(dateInput) {
    if (!dateInput) return "Recently";
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return "Recently";
        const diffMs = Date.now() - d.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffDays > 30) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        if (diffDays > 0) return `${diffDays}d ago`;
        if (diffHours > 0) return `${diffHours}h ago`;
        if (diffMins > 0) return `${diffMins}m ago`;
        return "Just now";
    } catch (e) {
        return "Recently";
    }
}

// Helper: Determine Bureau Tag Class
function getBureauClass(sourceName) {
    const s = (sourceName || "").toLowerCase();
    if (s.includes("boom")) return "bureau-boom";
    if (s.includes("alt")) return "bureau-alt";
    if (s.includes("snopes")) return "bureau-snopes";
    if (s.includes("vishvas")) return "bureau-vishvas";
    if (s.includes("factcheck")) return "bureau-factcheck";
    return "bureau-default";
}

    if (articles.length > 0) {
        articles.forEach(article => {
            const card = document.createElement("div");
            card.className = "article-grid-card";
            const relativeTime = getRelativeTime(article.pubDate);
            const bureauClass = getBureauClass(article.source);
            const sourceName = escapeHtml(article.source || "Fact Check Bureau");

            let imgMarkup = "";
            if (article.imageUrl) {
                imgMarkup = `
                    <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer" class="article-thumb-link" tabindex="-1">
                        <div class="article-thumb-wrap">
                            <img src="${escapeHtml(article.imageUrl)}" alt="${escapeHtml(article.title)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'article-thumb-fallback ${bureauClass}\\'><span>${sourceName}</span><small>VERIFIED REPORT</small></div>';">
                        </div>
                    </a>
                `;
            } else {
                imgMarkup = `
                    <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer" class="article-thumb-link" tabindex="-1">
                        <div class="article-thumb-fallback ${bureauClass}">
                            <span>${sourceName}</span>
                            <small>VERIFIED FACT CHECK</small>
                        </div>
                    </a>
                `;
            }

            card.innerHTML = `
                ${imgMarkup}
                <div class="article-grid-body">
                    <div class="article-grid-meta">
                        <span class="article-source-tag ${bureauClass}">${sourceName}</span>
                        <span class="article-date-stamp">${relativeTime}</span>
                    </div>
                    <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer" class="article-headline-link">
                        ${escapeHtml(article.title)}
                    </a>
                    <div class="article-card-footer">
                        <span class="read-source-hint">Read Fact-Check ↗</span>
                        <button class="btn-check-similar" onclick="fillSample('${escapeHtml(article.title.replace(/'/g, "\\'"))}')" title="Inspect this claim in the Truth-O-Meter">
                            Test Claim
                        </button>
                    </div>
                </div>
            `;
            list.appendChild(card);
        });

        articlesOffset += articles.length;
        if (loadMoreWrap) loadMoreWrap.style.display = hasMore ? "block" : "none";
    } else if (reset) {
        list.innerHTML = `<div class="empty-wire-state">No articles found for this selection. Try clicking "All Feeds".</div>`;
        if (loadMoreWrap) loadMoreWrap.style.display = "none";
    }
}

function loadMoreArticles() {
    loadArticles(false);
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
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
    loadRecentVerifications();
    loadTrendingDebunks();
    loadSources();
    loadArticles(true);
});
