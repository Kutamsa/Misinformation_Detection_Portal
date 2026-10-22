# VerifyIt - Fact-Checking Portal - [Website](https://proverify.onrender.com/)

An open-source verification platform designed to detect disinformation, manipulated media, and viral rumors across text statements, voice notes, and images. Built with FastAPI, Google Gemini, and automated retrieval-augmented generation (RAG) across verified fact-checking bureaus.

[![Python](https://img.shields.io/badge/Python-3.13+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111.0-009688.svg)](https://fastapi.tiangolo.com/)
[![Gemini](https://img.shields.io/badge/AI%20Engine-Google%20Gemini%202.5%20Flash-4285F4.svg)](https://aistudio.google.com/)
[![Database](https://img.shields.io/badge/Database-PostgreSQL%20-336791.svg)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Key Features

### 1. Multi-Modal Verification Desk

- **Voice Audio:** Speak claims in Telugu or English. Transcribed and fact-checked via multi-modal audio understanding.
- **Text Statements:** Cross-examine viral WhatsApp forwards, news headlines, and political claims.
- **Photo & Document Inspection:** Upload screenshots, circulars, or images to detect manipulation and context discrepancies.

### 2. Calibrated Truth Scoring & Spoken Explanations

- Objective veracity classifications: `TRUE`, `FALSE`, `MISLEADING`, and `UNVERIFIED` with calibrated truth scores (0–100%).
- Bilingual debunks: Concise English executive summary paired with natural Telugu conversational explanations.
- Spoken audio playback in Telugu for regional accessibility.
- Instant 1-click formatted debunks ready to forward directly to chat groups.

### 3. Swipe The Fake — Interactive Verification Game (`game.html`)

- Rapid-fire 10-round educational game challenging users to spot misinformation.
- Swipe or tap (Left = Fake, Right = Real) across a rotating bank of 100+ viral Indian and global claims.
- Real-time scorecards, tactile feedback, and streak tracking saved in local storage.

### 4. Spot The Fake — Forensic Field Manual (`forensics.html`)

A practical, 60-second inspection guide for citizens and journalists:

- **Video Deepfakes:** Ocular corneal reflections, plosive lip-sync latency, and boundary warping.
- **Voice Clones:** Pulmonary breath gaps, prosodic cadence flattening, and ambient noise gating.
- **Photos & Circulars:** Font antialiasing mismatches, government gazette tracking numbers, and urgency triggers.
- **S.I.F.T. Protocol:** 4-step framework (`Stop`, `Investigate Source`, `Find Better Coverage`, `Trace to Context`).
- **OSINT Tools:** Free citizen tools including TinEye, InVID WeVerify, FotoForensics, and Hive AI.

### 5. Automated Fact-Checking Wire (Live RAG)

- Continuously aggregates and indexes verified debunks from accredited IFCN sources (BOOM Live, Alt News, FactCheck.org, Snopes, Vishvas News).
- Automatically cross-references claims against local indices before AI evaluation to prevent hallucinations.

### 6. Mobile Telegram Assistant

- Submit forwarded voice notes, images, or text queries directly to the bot (`@Verifyitprobot`) for real-time verification and audio notes on mobile.

---

## Architecture & Tech Stack

| Layer                           | Technology              | Details                                                                 |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| **Backend API**           | FastAPI (Python 3.13)   | Asynchronous REST endpoints, CORS middleware, static file serving       |
| **AI Reasoning & Vision** | Google Gemini 2.5 Flash | Multimodal evaluation across text, image bytes, and raw audio           |
| **Database**              | PostgreSQL / SQLite     | Stores RSS feed registry and verified fact-checking article cache       |
| **Text-to-Speech**        | gTTS / Google Cloud TTS | Generates natural Telugu audio debunks                                  |
| **Wire Scraping**         | Feedparser & HTTPX      | Automated background synchronization of certified debunk feeds          |
| **Frontend**              | Vanilla HTML5, CSS3, JS | Responsive editorial UI with Lucide iconography, zero framework lock-in |

---

## Quickstart & Local Setup

### 1. Prerequisites

- Python 3.11+ (Python 3.13 recommended)
- Git

### 2. Clone & Setup Environment

```bash
git clone https://github.com/Kutamsa/Misinformation_Detection_Portal.git
cd Misinformation_Detection_Portal

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Environment Configuration (`.env`)

Create a `.env` file in the project root:

```env
# Google Gemini API Key (Required - get free at https://aistudio.google.com/)
GEMINI_API_KEY=your_gemini_api_key_here

# Database URL (Optional: defaults to local SQLite if left empty)
DATABASE_URL=

# Telegram Bot Token (Optional: from @BotFather on Telegram)
TELEGRAM_BOT_TOKEN=
```

### 4. Run the Application

```bash
python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

## API Reference

| Method   | Endpoint                  | Description                                               |
| -------- | ------------------------- | --------------------------------------------------------- |
| `POST` | `/factcheck/text`       | Verifies a text claim against the RAG database and Gemini |
| `POST` | `/factcheck/audio`      | Transcribes and verifies uploaded audio recordings        |
| `POST` | `/factcheck/image`      | Analyzes uploaded images, news screenshots, or circulars  |
| `GET`  | `/api/trending-debunks` | Curated live and trending debunked claims                 |
| `GET`  | `/news/sources`         | Lists active certified fact-checking RSS sources          |
| `POST` | `/news/add_source`      | Registers a new fact-checking RSS feed source             |
| `POST` | `/news/remove_source`   | Removes a fact-checking feed source by ID                 |
| `GET`  | `/news/articles`        | Returns paginated verified articles from local cache      |
| `GET`  | `/health`               | Service health status check                               |

---

## License

MIT License — Open-source and accessible for public media literacy and verification.
