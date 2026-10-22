# VerifyIt — 100% Free AI Truth Radar & Fact-Checking Portal

An open-source, multi-modal verification platform designed to detect misinformation, fake news, and manipulated media across voice audio, text statements, and photos. Built entirely on **100% free and open services** with zero subscription or infrastructure costs.

[![Python](https://img.shields.io/badge/Python-3.13-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111.0-009688.svg)](https://fastapi.tiangolo.com/)
[![Gemini](https://img.shields.io/badge/AI%20Engine-Google%20Gemini%202.5%20Flash%20(Free)-4285F4.svg)](https://aistudio.google.com/)
[![Database](https://img.shields.io/badge/Database-PostgreSQL%20%2F%20SQLite-336791.svg)](https://neon.tech/)
[![Hosting](https://img.shields.io/badge/Hosting-Render%20Free%20Tier-46E3B7.svg)](https://render.com/)
[![Telegram](https://img.shields.io/badge/Telegram%20Bot-Free-26A5E4.svg)](https://telegram.org/)

---

## Live Deployment

- **Web Portal:** [https://proverify.onrender.com/](https://proverify.onrender.com/)
- **Forensic Academy:** [https://proverify.onrender.com/forensics](https://proverify.onrender.com/forensics)
- **Telegram Assistant:** `@VerifyItFactCheckBot`

---

## The Reality: What Is ACTUALLY Powering This App

To be completely transparent, here is the exact tech stack executing in production:

| Component                              | What is Actually Used                               | Cost                                  | Why / Details                                                                                           |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **AI Reasoning & Fact-Checking** | **Google Gemini 2.5 Flash**                   | **$0.00** (Free Tier)           | Structured JSON verification and claim evaluation via `GEMINI_API_KEY`. OpenAI is **not** used. |
| **Voice Audio Transcription**    | **Gemini 2.5 Flash Multimodal Audio**         | **$0.00** (Free Tier)           | Audio bytes are sent directly to Gemini's native audio understanding. No Whisper or paid API.           |
| **Photo / Visual Analysis**      | **Gemini 2.5 Flash Vision**                   | **$0.00** (Free Tier)           | Inspects circulars, viral claims, and photo graphics for authenticity.                                  |
| **Vernacular Speech Synthesis**  | **gTTS (Google Text-to-Speech)**              | **$0.00** (Free Python Library) | Generates spoken Telugu voice debunks without any Google Cloud billing or credentials.                  |
| **Fact-Check RSS Feeds**         | **Feedparser & HTTPX**                        | **$0.00** (Public RSS)          | Direct scraping of live RSS feeds from BOOM Live, Alt News, FactCheck.org, Snopes, Vishvas News.        |
| **Web Server & Hosting**         | **FastAPI on Render Free Tier**               | **$0.00**                       | Python 3.13 ASGI server running on Render.                                                              |
| **Database**                     | **Neon.tech Serverless Postgres (or SQLite)** | **$0.00**                       | Replaces Render's expired 30-day database with a permanent free cloud PostgreSQL database.              |
| **Mobile Bot**                   | **python-telegram-bot**                       | **$0.00**                       | Free bot token via `@BotFather`.                                                                      |

---

## The Database :

### Neon.tech

 connect to **[Neon Serverless Postgres](https://neon.tech/)**:

- **Cost:** 100% Free forever (0.5 GB storage, generous compute).
- **No 30-Day Expiration:** Your database never expires or deletes itself.
- **Drop-In Compatibility:** Provides a standard `postgresql://...` connection string that works immediately with the existing `backend/app.py` code.

#### How to Connect in 2 Minutes:

1. Sign up for free at [neon.tech](https://neon.tech/) (using GitHub or Google).
2. Create a free project (e.g., `verifyit-db`).
3. Copy the **Connection String** provided on the Neon dashboard:
   ```text
   postgresql://username:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. In your [Render Dashboard](https://dashboard.render.com/) under your **VerifyIt Web Service** -> **Environment**:
   - Set `DATABASE_URL` = `<your_neon_connection_string>`
5. Click **Save Changes**. On restart, `backend/app.py` automatically initializes the `sources` and `articles` tables and syncs verified news!

---

## Features

### 1. Multi-Modal Ingestion Desk

- **Voice Audio:** Speak claims in Telugu or English. Gemini transcribes and verifies the statement.
- **Text Statement:** Paste viral WhatsApp forwards, headlines, or claims.
- **Photo Upload:** Upload photos, news circulars, or social media screenshots.

### 2. Objective Truth-O-Meter & Spoken Telugu Verdict

- Calibrated veracity rating (`TRUE`, `FALSE`, `MISLEADING`, `UNVERIFIED`).
- Executive summary in English + detailed explanation in conversational Telugu.
- Spoken audio playback in Telugu for accessibility in regional groups.
- 1-Click WhatsApp Debunk Card ready to copy and paste into group chats.

### 3. Verified Fact-Checking Wire (Live RAG)

- Continuously aggregates and indexes verified debunks from certified IFCN fact-checking portals:
  - **BOOM Live** (Fast Check)
  - **Alt News**
  - **FactCheck.org**
  - **Snopes**
  - **Vishvas News**
- User queries are cross-referenced against this local database before running AI evaluation.

### 4. Forensic Academy (`forensics.html`)

An interactive citizen field manual on spotting AI deepfakes and manipulated media:

- **Module 01:** Frame-by-Frame Video Deepfake Autopsy (Ocular reflections, labial sync, boundary distortion).
- **Module 02:** Synthetic Voice Clone Detection (Breath gaps, emotional monotone, ambient noise discontinuities).
- **Module 03:** Manipulated Photo & Circular Autopsy (Typography mismatch, gazette file numbers, urgency signals).
- **Module 04:** The 4-Step S.I.F.T. Verification Protocol (`STOP`, `INVESTIGATE`, `FIND`, `TRACE`).
- **Module 05:** Free Citizen Forensic Tools Directory (TinEye, InVID WeVerify, FotoForensics, Hive AI).

---

## Local Setup (100% Free)

### 1. Clone & Set Up Virtual Environment

```bash
git clone https://github.com/Kutamsa/Misinformation_Detection_Portal.git
cd Misinformation_Detection_Portal

python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Configure Environment (`.env`)

Create a `.env` file in the project root:

```env
# 1. Google Gemini API Key (100% Free at https://aistudio.google.com/app/apikey)
GEMINI_API_KEY=your_gemini_api_key_here

# 2. Database URL (Optional: leave empty to use local SQLite, or paste Neon Postgres URL)
DATABASE_URL=

# 3. Telegram Bot Token (Optional: get free from @BotFather on Telegram)
TELEGRAM_BOT_TOKEN=
```

### 3. Run the Server

```bash
python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

Visit `http://127.0.0.1:8000/` in your browser.

---

## API Endpoints

| Method   | Endpoint                  | Description                                                |
| -------- | ------------------------- | ---------------------------------------------------------- |
| `POST` | `/factcheck/text`       | Verifies a text statement against RAG database and Gemini. |
| `POST` | `/factcheck/audio`      | Transcribes and verifies an uploaded audio recording.      |
| `POST` | `/factcheck/image`      | Inspects an uploaded photo or document graphic.            |
| `GET`  | `/api/trending-debunks` | Returns curated viral debunks with fallback data.          |
| `GET`  | `/news/sources`         | Lists all active fact-checking RSS wire sources.           |
| `POST` | `/news/add_source`      | Adds a custom fact-checking RSS feed URL.                  |
| `POST` | `/news/remove_source`   | Deletes an RSS feed source by ID.                          |
| `GET`  | `/news/articles`        | Returns paginated verified articles.                       |
| `GET`  | `/health`               | Application health check.                                  |

---

## License

MIT License · Open Fact-Checking Project for accessible public truth.
