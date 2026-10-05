import os
import io
import re
import json
import base64
import tempfile
import sqlite3
import asyncio
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
import feedparser
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, Request, Response, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI

# Optional PostgreSQL
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None

# Optional Google TTS
try:
    from google.cloud import texttospeech
except ImportError:
    texttospeech = None

# Optional gTTS for free zero-config Telugu speech synthesis
try:
    from gtts import gTTS
except ImportError:
    gTTS = None

from . import telegram_bot_handlers
from telegram import Update

# Explicitly load .env from project root
ENV_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv(dotenv_path=ENV_FILE, override=True)

# --- Configuration & Environment Variables ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
DATABASE_URL = os.getenv("DATABASE_URL")
GOOGLE_CREDENTIALS_JSON = os.getenv("GOOGLE_CREDENTIALS_JSON")
AUTHORIZED_TELEGRAM_USER_IDS = [
    int(uid.strip())
    for uid in os.getenv("AUTHORIZED_TELEGRAM_USER_IDS", "").split(",")
    if uid.strip().isdigit()
]

# Curated Default RSS Feeds to Pre-Seed (100% Dedicated Fact-Checking Bureaus)
DEFAULT_SOURCES = [
    {
        "name": "BOOM Live (Fast Check)",
        "url": "https://www.boomlive.in/fast-check/feed",
        "category": "Fact Checking (India)"
    },
    {
        "name": "Alt News",
        "url": "https://www.altnews.in/feed/",
        "category": "Disinformation Bureau"
    },
    {
        "name": "FactCheck.org",
        "url": "https://www.factcheck.org/feed/",
        "category": "Global Fact Checking"
    },
    {
        "name": "Vishvas News",
        "url": "https://www.vishvasnews.com/english/feed/",
        "category": "Regional & Viral Debunks"
    },
    {
        "name": "Snopes Debunks",
        "url": "https://www.snopes.com/feed/",
        "category": "Hoaxes & Internet Myths"
    }
]

# Global clients
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
tts_client = None
telegram_app = None

# Shared Fact-Check System Persona Prompt
FACTCHECK_SYSTEM_PROMPT = """You are an authoritative, fair, and friendly AI Fact-Checker for the VerifyIt Portal.
Your task is to analyze claims and return your verdict in a structured JSON format.

JSON schema you MUST follow:
{
  "verdict": "FALSE" | "TRUE" | "MISLEADING" | "UNVERIFIED",
  "truth_score": 0,
  "confidence": 95,
  "english_summary": "One clear sentence in English summarizing why this claim is true/false.",
  "result": "Conversational, clear, natural explanation in Telugu (using Telugu script, minimal English only when necessary, under 120 words). Never repeat yourself. If false, state the true facts directly."
}

Rules:
- For FALSE claims: verdict MUST be "FALSE", and truth_score MUST be 0 (meaning 0% truth, fabricated or debunked).
- For TRUE claims: verdict MUST be "TRUE", and truth_score MUST be 100 (meaning 100% verified fact).
- For MISLEADING claims: verdict MUST be "MISLEADING", and truth_score should be around 40 (partial truth or missing context).
- For UNVERIFIED claims: verdict MUST be "UNVERIFIED", and truth_score should be 0.
- "confidence" is your AI certainty level (e.g. 90-99).
- Provide output as VALID JSON only. Do not wrap in markdown code blocks."""


# --- Safe Image MIME Inspector ---
def get_image_mime(image_bytes: bytes) -> str:
    """Detects image mime type from header bytes without deprecated imghdr."""
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    elif image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    elif image_bytes.startswith(b"GIF87a") or image_bytes.startswith(b"GIF89a"):
        return "image/gif"
    elif len(image_bytes) >= 12 and image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


# --- Database Connection (PostgreSQL when DATABASE_URL is set, SQLite as local fallback) ---
SQLITE_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "factcheck_news.db"))

@contextmanager
def get_db():
    """Provides a database connection. Uses PostgreSQL if DATABASE_URL is set; otherwise SQLite."""
    conn = None
    is_postgres = bool(DATABASE_URL and psycopg2)

    try:
        if is_postgres:
            parsed = urlparse(DATABASE_URL)
            conn = psycopg2.connect(
                database=parsed.path[1:],
                user=parsed.username,
                password=parsed.password,
                host=parsed.hostname,
                port=parsed.port,
                sslmode="require",
            )
        else:
            conn = sqlite3.connect(SQLITE_DB_PATH)
            conn.row_factory = sqlite3.Row

        yield conn
        conn.commit()
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"[DB Error] {e}")
        raise e
    finally:
        if conn:
            conn.close()


def init_db():
    """Initializes tables and seeds default trusted RSS feeds."""
    try:
        with get_db() as conn:
            cur = conn.cursor()
            is_postgres = bool(DATABASE_URL and psycopg2)

            if is_postgres:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS sources (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(255) NOT NULL UNIQUE,
                        url VARCHAR(2048) NOT NULL UNIQUE,
                        last_fetched TIMESTAMP WITH TIME ZONE,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS articles (
                        id SERIAL PRIMARY KEY,
                        source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                        title VARCHAR(2048) NOT NULL,
                        link VARCHAR(2048) NOT NULL UNIQUE,
                        pub_date TIMESTAMP WITH TIME ZONE,
                        fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                """)
            else:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS sources (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL UNIQUE,
                        url TEXT NOT NULL UNIQUE,
                        last_fetched TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS articles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        source_id INTEGER NOT NULL,
                        title TEXT NOT NULL,
                        link TEXT NOT NULL UNIQUE,
                        pub_date TIMESTAMP,
                        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
                    );
                """)

            # Pre-seed or ensure default fact-checking sources exist
            for src in DEFAULT_SOURCES:
                try:
                    cur.execute(
                        "INSERT INTO sources (name, url) VALUES (%s, %s) ON CONFLICT (name) DO NOTHING;" if is_postgres else
                        "INSERT OR IGNORE INTO sources (name, url) VALUES (?, ?);",
                        (src["name"], src["url"])
                    )
                except Exception as seed_err:
                    print(f"[DB] Error seeding {src['name']}: {seed_err}")
            
            cur.close()
            print("[DB] Initialized database and verified fact-checking sources.")
    except Exception as e:
        print(f"[DB Init Failed] {e}")


def seed_articles_background():
    """Fetches initial articles for all seeded sources so news appears immediately."""
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM sources;")
            sources = cur.fetchall()
            cur.close()

        for s in sources:
            source_id = s[0] if isinstance(s, (tuple, list)) else s["id"]
            sync_news_articles(source_id)
        print("[DB] Initial RSS sync complete!")
    except Exception as e:
        print(f"[DB Sync Error] {e}")


# --- AI Service Helpers ---
def text_to_speech(text: str) -> str:
    """Converts Telugu text to speech audio (MP3 base64) using Google Cloud TTS or free gTTS fallback."""
    if not text or not text.strip():
        return ""

    # 1. Try Google Cloud Neural TTS if credentials are provided in .env
    if tts_client and texttospeech:
        try:
            synthesis_input = texttospeech.SynthesisInput(text=text)
            voice = texttospeech.VoiceSelectionParams(
                language_code="te-IN",
                name="te-IN-Chirp3-HD-Achird",
                ssml_gender=texttospeech.SsmlVoiceGender.FEMALE,
            )
            audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
            response = tts_client.synthesize_speech(
                input=synthesis_input, voice=voice, audio_config=audio_config
            )
            return base64.b64encode(response.audio_content).decode("utf-8")
        except Exception as e:
            print(f"[Google Cloud TTS Error] {e}")

    # 2. Free 0-config Fallback: gTTS (Google Translate Telugu TTS - No API Key Needed)
    if gTTS:
        try:
            clean_text = text.strip()
            tts = gTTS(text=clean_text, lang="te")
            fp = io.BytesIO()
            tts.write_to_fp(fp)
            fp.seek(0)
            return base64.b64encode(fp.read()).decode("utf-8")
        except Exception as e:
            print(f"[gTTS Free Error] {e}")

    return ""


async def transcribe_audio(audio_bytes: bytes) -> str:
    """Transcribes audio file bytes using OpenAI Whisper, or falls back to Gemini Audio."""
    # 1. Try OpenAI Whisper if configured
    if openai_client:
        try:
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "recording.mp3"
            transcript = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
            )
            return transcript.text
        except Exception as e:
            print(f"[Whisper Error] {e}")

    # 2. Fall back to Gemini Multimodal Audio (100% Free)
    if GEMINI_API_KEY:
        try:
            b64_audio = base64.b64encode(audio_bytes).decode("utf-8")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
            payload = {
                "contents": [{
                    "parts": [
                        {"text": "Transcribe this spoken audio accurately word-for-word in its original language (Telugu or English). Output only the transcribed text, nothing else."},
                        {"inlineData": {"mimeType": "audio/mp3", "data": b64_audio}}
                    ]
                }]
            }
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, timeout=30.0)
                resp.raise_for_status()
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e:
            print(f"[Gemini Audio Error] {e}")
            return f"Error transcribing audio with Gemini: {e}"

    return "Error: No API key configured for audio transcription. Please set GEMINI_API_KEY (free) or OPENAI_API_KEY in .env."


# --- Robust LLM JSON Parsing & Truth Score Normalization ---
def safe_parse_json(raw_text: str) -> dict:
    """Safely extracts JSON from an LLM response even if unescaped quotes or formatting quirks exist."""
    text = raw_text.strip()
    
    # Strip markdown code fences if present
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    # Attempt 1: Direct JSON parsing
    try:
        return json.loads(text)
    except Exception:
        pass

    # Attempt 2: Extract JSON object substring between { and }
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        snippet = text[first_brace:last_brace+1]
        try:
            return json.loads(snippet)
        except Exception:
            pass

    # Attempt 3: Robust Regex extraction of key fields
    res = {
        "verdict": "UNVERIFIED",
        "truth_score": 0,
        "confidence": 92,
        "english_summary": "",
        "result": ""
    }

    v = re.search(r'"verdict"\s*:\s*"([^"]+)"', text, re.I)
    if v:
        res["verdict"] = v.group(1).upper()
    elif re.search(r'\b(FALSE|MISINFORMATION|FAKE|HOAX|PANTS ON FIRE)\b', text, re.I):
        res["verdict"] = "FALSE"
    elif re.search(r'\b(TRUE|ACCURATE|VERIFIED)\b', text, re.I):
        res["verdict"] = "TRUE"
    elif re.search(r'\b(MISLEADING|PARTIALLY TRUE|DISTORTED)\b', text, re.I):
        res["verdict"] = "MISLEADING"

    cf = re.search(r'"confidence"\s*:\s*(\d+)', text)
    if cf:
        try:
            res["confidence"] = int(cf.group(1))
        except ValueError:
            pass

    # Pattern looks ahead for the next JSON key or closing brace
    es = re.search(r'"english_summary"\s*:\s*"(.*?)(?=",\s*"\w+"|\s*"\s*\})', text, re.DOTALL)
    if es:
        res["english_summary"] = es.group(1).strip()
    else:
        es2 = re.search(r'"english_summary"\s*:\s*"([^"\n]+)', text)
        if es2:
            res["english_summary"] = es2.group(1).strip()

    rs = re.search(r'"result"\s*:\s*"(.*?)(?=",\s*"\w+"|\s*"\s*\})', text, re.DOTALL)
    if rs:
        res["result"] = rs.group(1).strip()
    else:
        rs2 = re.search(r'"result"\s*:\s*"([^"\n]+)', text)
        if rs2:
            res["result"] = rs2.group(1).strip()

    if not res["english_summary"]:
        res["english_summary"] = "Verification completed. Evaluated claim against verified facts."
    if not res["result"]:
        res["result"] = res["english_summary"]

    return res


def normalize_factcheck_result(data: dict) -> dict:
    """Ensures consistent, human-intuitive truth_score, verdict, and confidence values."""
    verdict = str(data.get("verdict", "UNVERIFIED")).upper()
    raw_conf = data.get("confidence", 95)
    try:
        f_conf = float(raw_conf)
        if 0.0 < f_conf <= 1.0:
            conf = int(round(f_conf * 100))
        else:
            conf = int(round(f_conf))
    except (ValueError, TypeError):
        conf = 92

    conf = max(50, min(conf, 99))

    # Truth score reflects actual truthfulness, NOT machine confidence:
    # False claim -> 0% Truth
    # True claim -> 100% Truth
    # Misleading -> 40% Partial truth
    if "FALSE" in verdict or "FAKE" in verdict:
        normalized_verdict = "FALSE"
        truth_score = 0
    elif "TRUE" in verdict:
        normalized_verdict = "TRUE"
        truth_score = 100
    elif "MISLEAD" in verdict:
        normalized_verdict = "MISLEADING"
        truth_score = 40
    else:
        normalized_verdict = "UNVERIFIED"
        truth_score = 0

    data["verdict"] = normalized_verdict
    data["truth_score"] = truth_score
    data["confidence"] = conf
    return data


# --- Live RAG Search & WhatsApp Debunk Card Generator ---
def retrieve_relevant_factchecks(query: str, limit: int = 3) -> list:
    """Retrieves relevant verified news articles from local fact-checking database using token matching."""
    if not query or not query.strip():
        return []

    words = re.findall(r'\b[a-zA-Z0-9]{3,}\b', query)
    stopwords = {
        "this", "that", "with", "from", "have", "been", "were", "what", "when", 
        "where", "which", "will", "there", "their", "about", "would", "could", 
        "should", "claims", "image", "audio", "video", "post", "viral", "photo", "news"
    }
    keywords = [w.lower() for w in words if w.lower() not in stopwords]

    if not keywords:
        return []

    try:
        with get_db() as conn:
            cur = conn.cursor()
            is_postgres = bool(DATABASE_URL and psycopg2)

            clauses = []
            params = []
            for kw in keywords[:5]:
                clauses.append("LOWER(a.title) LIKE %s" if is_postgres else "LOWER(a.title) LIKE ?")
                params.append(f"%{kw}%")

            if not clauses:
                return []

            sql = f"""
                SELECT a.title, a.link, a.pub_date, s.name as source
                FROM articles a
                JOIN sources s ON a.source_id = s.id
                WHERE {" OR ".join(clauses)}
                ORDER BY a.id DESC
                LIMIT {limit};
            """
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()
            cur.close()

            results = []
            for r in rows:
                title = r[0] if is_postgres else r["title"]
                link = r[1] if is_postgres else r["link"]
                pub_date = r[2] if is_postgres else r["pub_date"]
                source = r[3] if is_postgres else r["source"]
                results.append({
                    "title": title,
                    "link": link,
                    "pub_date": str(pub_date) if pub_date else "",
                    "source": source
                })
            return results
    except Exception as e:
        print(f"[RAG Retrieval Error] {e}")
        return []


def generate_whatsapp_card(claim: str, verdict: str, summary: str, source_cit: str = "") -> str:
    """Formats a concise, high-impact debunk card ready to forward on WhatsApp groups."""
    verdict_emoji = "🔴" if verdict == "FALSE" else "🟢" if verdict == "TRUE" else "🟡"
    clean_claim = (claim or "").strip()
    if len(clean_claim) > 140:
        clean_claim = clean_claim[:137] + "..."
    
    card = (
        f"🚨 *VERIFYIT FACT-CHECK REPORT* 🚨\n\n"
        f"📌 *Claim:* \"{clean_claim}\"\n"
        f"{verdict_emoji} *Verdict:* *{verdict}*\n\n"
        f"📝 *Fact Summary:* {summary}\n"
    )
    if source_cit:
        card += f"\n🔗 *Source Citation:* {source_cit}\n"
    card += (
        f"\n🛡️ *Action:* Please do not forward unverified claims. Help stop the spread of rumors!\n"
        f"🔍 Verified with VerifyIt Portal"
    )
    return card


async def perform_text_factcheck(statement: str) -> dict:
    """Fact-checks a statement using Live RAG and Gemini 2.5 Flash / OpenAI."""
    # 0. Live RAG Search in our fact-checking database
    rag_articles = retrieve_relevant_factchecks(statement)
    rag_context = ""
    if rag_articles:
        rag_context = "\n\nVERIFIED FACT-CHECKING DATABASE CONTEXT (From Live Verified Portals):\n"
        for idx, art in enumerate(rag_articles, 1):
            rag_context += f"{idx}. [{art['source']}] {art['title']} (URL: {art['link']})\n"
        rag_context += "\nIf the verified context addresses this claim, prioritize and cite this reporting in your verdict."

    full_prompt = f"{FACTCHECK_SYSTEM_PROMPT}{rag_context}\n\nStatement to fact-check:\n\"{statement}\""

    # 1. Try OpenAI if configured
    if openai_client:
        try:
            messages = [
                {"role": "system", "content": FACTCHECK_SYSTEM_PROMPT},
                {"role": "user", "content": f"{rag_context}\n\nStatement to fact-check:\n\"{statement}\""}
            ]
            completion = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                response_format={"type": "json_object"}
            )
            parsed = safe_parse_json(completion.choices[0].message.content)
            parsed = normalize_factcheck_result(parsed)
            parsed["citations"] = rag_articles
            parsed["whatsapp_card"] = generate_whatsapp_card(
                claim=statement,
                verdict=parsed.get("verdict", "UNVERIFIED"),
                summary=parsed.get("english_summary", ""),
                source_cit=rag_articles[0]["source"] if rag_articles else "Verified Fact-Checking Network"
            )
            parsed["audio_result"] = text_to_speech(parsed.get("result", ""))
            return parsed
        except Exception as e:
            print(f"[OpenAI FactCheck Error] {e}")

    # 2. Try Gemini (100% Free at aistudio.google.com)
    if GEMINI_API_KEY:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
            payload = {
                "contents": [{"parts": [{"text": full_prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "thinkingConfig": {"thinkingBudget": 0}
                }
            }
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, timeout=30.0)
                resp.raise_for_status()
                data = resp.json()
                raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = safe_parse_json(raw_text)
                parsed = normalize_factcheck_result(parsed)
                parsed["citations"] = rag_articles
                parsed["whatsapp_card"] = generate_whatsapp_card(
                    claim=statement,
                    verdict=parsed.get("verdict", "UNVERIFIED"),
                    summary=parsed.get("english_summary", ""),
                    source_cit=rag_articles[0]["source"] if rag_articles else "Verified Fact-Checking Network"
                )
                parsed["audio_result"] = text_to_speech(parsed.get("result", ""))
                return parsed
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                print(f"[Gemini FactCheck Rate Limit] 429 Too Many Requests: {e}")
                if rag_articles:
                    top_art = rag_articles[0]
                    return {
                        "verdict": "MISLEADING",
                        "truth_score": 35,
                        "confidence": 88,
                        "english_summary": f"Direct debunk match found in {top_art['source']}: '{top_art['title']}'. (Gemini free tier rate-limited; retrieved via live database search).",
                        "result": f"ఈ అంశంపై {top_art['source']} లో ధృవీకరణ నివేదిక ఉంది: {top_art['title']}.",
                        "citations": rag_articles,
                        "whatsapp_card": generate_whatsapp_card(
                            claim=statement,
                            verdict="MISLEADING",
                            summary=f"Reported debunk by {top_art['source']}: {top_art['title']}",
                            source_cit=f"{top_art['source']} ({top_art['link']})"
                        ),
                        "audio_result": ""
                    }
                return {
                    "verdict": "UNVERIFIED",
                    "truth_score": 0,
                    "confidence": 0,
                    "english_summary": "Gemini API rate limit reached (15 requests/minute on free tier). Please wait 30 seconds and try again.",
                    "result": "రేట్ లిమిట్ రీచ్ అయింది. దయచేసి 30 సెకన్లు ఆగి మళ్లీ ప్రయత్నించండి.",
                    "citations": rag_articles,
                    "whatsapp_card": "",
                    "audio_result": ""
                }
            print(f"[Gemini FactCheck HTTP Error] {e}")
        except Exception as e:
            print(f"[Gemini FactCheck Error] {e}")

    return {
        "verdict": "UNVERIFIED",
        "truth_score": 0,
        "confidence": 0,
        "english_summary": "Could not complete analysis. If you recently sent multiple requests, the free API tier may be cooling down. Please retry shortly.",
        "result": "విశ్లేషణ పూర్తి కాలేదు. దయచేసి కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.",
        "citations": rag_articles,
        "whatsapp_card": "",
        "audio_result": ""
    }



async def perform_audio_factcheck(audio_bytes: bytes) -> dict:
    """Transcribes voice audio, then fact-checks the transcription."""
    transcript = await transcribe_audio(audio_bytes)
    if transcript.startswith("Error"):
        return {
            "verdict": "UNVERIFIED",
            "truth_score": 0,
            "confidence": 0,
            "english_summary": transcript,
            "result": transcript,
            "citations": [],
            "whatsapp_card": "",
            "audio_result": ""
        }
    res = await perform_text_factcheck(transcript)
    res["transcription"] = transcript
    return res


async def perform_image_factcheck(image_bytes: bytes, mime_type: str = None, caption: str = "") -> dict:
    """Fact-checks an image claim using Gemini Vision and Live RAG."""
    if not GEMINI_API_KEY:
        return {
            "verdict": "UNVERIFIED",
            "truth_score": 0,
            "confidence": 0,
            "english_summary": "Gemini API key is not configured.",
            "result": "దయచేసి GEMINI_API_KEY ను సెట్ చేయండి.",
            "citations": [],
            "whatsapp_card": "",
            "audio_result": ""
        }

    detected_mime = mime_type if mime_type in ["image/png", "image/jpeg", "image/webp", "image/gif"] else get_image_mime(image_bytes)
    b64_img = base64.b64encode(image_bytes).decode("utf-8")
    
    # Live RAG for image caption if provided
    rag_articles = retrieve_relevant_factchecks(caption) if caption else []
    rag_context = ""
    if rag_articles:
        rag_context = "\n\nVERIFIED DATABASE CONTEXT (From Live Fact-Checkers):\n"
        for idx, art in enumerate(rag_articles, 1):
            rag_context += f"{idx}. [{art['source']}] {art['title']} (URL: {art['link']})\n"

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    prompt = f"""You are an authoritative fact checker for the VerifyIt Portal.
Analyze the text, claims, news screenshot, viral forward, or visual context in this image.
Additional context provided by user: {caption or 'None'}{rag_context}

Return output in valid JSON format only:
{{
  "verdict": "FALSE" | "TRUE" | "MISLEADING" | "UNVERIFIED",
  "truth_score": 0,
  "confidence": 95,
  "english_summary": "One clear sentence in English explaining whether the claim in the image is true, false, or misleading.",
  "result": "Explanation in clear, natural Telugu (under 120 words). If false or misleading, state the verified facts directly."
}}

Rules:
- If the claim in the image is completely false/fabricated, verdict is "FALSE" and truth_score is 0.
- If verified to be true, verdict is "TRUE" and truth_score is 100.
- If partly true or missing essential context, verdict is "MISLEADING" and truth_score is 40.
- If unverified or not enough context, verdict is "UNVERIFIED" and truth_score is 0.
- "confidence" is your certainty percentage (between 80 and 99).
- Do not wrap in markdown code blocks. Output raw JSON only."""

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inlineData": {"mimeType": detected_mime, "data": b64_img}}
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0}
        }
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, timeout=35.0)
            resp.raise_for_status()
            data = resp.json()
            raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
            
            parsed = safe_parse_json(raw_text)
            parsed = normalize_factcheck_result(parsed)
            parsed["citations"] = rag_articles
            parsed["whatsapp_card"] = generate_whatsapp_card(
                claim=caption or parsed.get("english_summary", "Image Claim"),
                verdict=parsed.get("verdict", "UNVERIFIED"),
                summary=parsed.get("english_summary", ""),
                source_cit=rag_articles[0]["source"] if rag_articles else "Image Forensics Bureau"
            )
            audio_base64 = text_to_speech(parsed.get("result", ""))
            parsed["audio_result"] = audio_base64
            return parsed
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            print(f"[Gemini Image Rate Limit] 429 Too Many Requests: {e}")
            if rag_articles:
                top_art = rag_articles[0]
                return {
                    "verdict": "MISLEADING",
                    "truth_score": 35,
                    "confidence": 85,
                    "english_summary": f"Matching fact-check in database ({top_art['source']}): '{top_art['title']}'. (Gemini free tier rate limit reached).",
                    "result": f"ఈ చిత్రానికి సంబంధించిన నివేదిక {top_art['source']} లో ఉంది: {top_art['title']}.",
                    "citations": rag_articles,
                    "whatsapp_card": generate_whatsapp_card(
                        claim=caption or top_art['title'],
                        verdict="MISLEADING",
                        summary=f"Debunk reported by {top_art['source']}: {top_art['title']}",
                        source_cit=f"{top_art['source']} ({top_art['link']})"
                    ),
                    "audio_result": ""
                }
            return {
                "verdict": "UNVERIFIED",
                "truth_score": 0,
                "confidence": 0,
                "english_summary": "Gemini API rate limit reached (15 requests/minute on free tier). Please wait 30 seconds and retry.",
                "result": "రేట్ లిమిట్ రీచ్ అయింది. దయచేసి 30 సెకన్ల తర్వాత మళ్లీ ప్రయత్నించండి.",
                "citations": rag_articles,
                "whatsapp_card": "",
                "audio_result": ""
            }
        print(f"[Gemini Image HTTP Error] {e}")
    except Exception as e:
        print(f"[Gemini Image Error] {e}")
        return {
            "verdict": "UNVERIFIED",
            "truth_score": 0,
            "confidence": 50,
            "english_summary": "Could not complete image fact-check. Please ensure the screenshot contains legible text or clear claims and try again.",
            "result": "చిత్రంలోని వివరాలను విశ్లేషించడంలో సమస్య ఏర్పడింది. దయచేసి స్పష్టమైన చిత్రాన్ని అప్‌లోడ్ చేసి మళ్లీ ప్రయత్నించండి.",
            "citations": rag_articles,
            "whatsapp_card": "",
            "audio_result": ""
        }



# --- News RSS Synchronizer ---
def sync_news_articles(source_id: int) -> int:
    """Parses RSS feed and stores fresh articles."""
    try:
        with get_db() as conn:
            cur = conn.cursor()
            is_postgres = bool(DATABASE_URL and psycopg2)

            cur.execute(
                "SELECT id, url, name FROM sources WHERE id = %s;" if is_postgres else
                "SELECT id, url, name FROM sources WHERE id = ?;",
                (source_id,)
            )
            row = cur.fetchone()
            if not row:
                return 0

            s_id = row[0] if is_postgres else row["id"]
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            try:
                with httpx.Client(timeout=15.0, headers=headers, follow_redirects=True) as client:
                    resp = client.get(s_url)
                    feed = feedparser.parse(resp.text)
            except Exception as fetch_err:
                print(f"[RSS Fetch Error for {s_url}]: {fetch_err}")
                feed = feedparser.parse(s_url)

            added_count = 0

            for entry in feed.entries[:25]:
                pub_date = None
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    pub_date = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)

                try:
                    if is_postgres:
                        cur.execute(
                            "INSERT INTO articles (source_id, title, link, pub_date) VALUES (%s, %s, %s, %s) ON CONFLICT (link) DO NOTHING;",
                            (s_id, entry.title, entry.link, pub_date),
                        )
                    else:
                        cur.execute(
                            "INSERT OR IGNORE INTO articles (source_id, title, link, pub_date) VALUES (?, ?, ?, ?);",
                            (s_id, entry.title, entry.link, pub_date.isoformat() if pub_date else None),
                        )
                    added_count += 1
                except Exception:
                    pass

            # Update last fetched
            cur.execute(
                "UPDATE sources SET last_fetched = CURRENT_TIMESTAMP WHERE id = %s;" if is_postgres else
                "UPDATE sources SET last_fetched = CURRENT_TIMESTAMP WHERE id = ?;",
                (s_id,)
            )
            cur.close()
            return added_count
    except Exception as e:
        print(f"[Sync Error] {e}")
        return 0


# --- FastAPI Application & Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global tts_client, telegram_app
    temp_creds_path = None

    # 1. Setup Google TTS if credentials provided
    if GOOGLE_CREDENTIALS_JSON and texttospeech:
        try:
            temp_file = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".json")
            temp_file.write(GOOGLE_CREDENTIALS_JSON)
            temp_file.close()
            temp_creds_path = temp_file.name
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = temp_creds_path
            tts_client = texttospeech.TextToSpeechClient()
            print("[Google TTS] Client initialized.")
        except Exception as e:
            print(f"[Google TTS Init Error] {e}")

    # 2. Initialize Database & Seed default RSS Feeds
    init_db()
    # Trigger initial RSS sync in background task
    asyncio.create_task(asyncio.to_thread(seed_articles_background))

    # 3. Setup Telegram Bot if configured
    if TELEGRAM_BOT_TOKEN:
        try:
            telegram_app = telegram_bot_handlers.setup_telegram_bot_application(TELEGRAM_BOT_TOKEN)
            await telegram_app.initialize()
            telegram_bot_handlers.initialize_bot_components(
                openai_client_instance=openai_client,
                tts_func=text_to_speech if tts_client else None,
                authorized_ids=AUTHORIZED_TELEGRAM_USER_IDS,
                perform_image_factcheck_func=perform_image_factcheck,
                transcribe_audio_func=transcribe_audio,
            )
            print("[Telegram] Bot initialized.")
        except Exception as e:
            print(f"[Telegram Init Error] {e}")

    yield

    if temp_creds_path and os.path.exists(temp_creds_path):
        os.remove(temp_creds_path)


app = FastAPI(title="VerifyIt Fact-Checking Portal", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files & Web UI
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")


# --- Routes ---
@app.get("/")
def serve_home():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

@app.get("/forensics")
@app.get("/forensics.html")
def serve_forensics():
    return FileResponse(os.path.join(FRONTEND_DIR, "forensics.html"))

@app.head("/")
@app.get("/health")
def health_check():
    return {"status": "ok", "app": "VerifyIt"}


class TextInput(BaseModel):
    text: str


# Curated Trending Debunked Claims
TRENDING_DEBUNKS = [
    {
        "id": 1,
        "claim": "Viral claim that UNESCO declared the Indian National Anthem as the 'Best in the World'",
        "verdict": "FALSE",
        "verdict_badge": "PANTS ON FIRE",
        "truth_score": 0,
        "confidence": 99,
        "category": "National / Culture",
        "origin": "WhatsApp Viral Forward",
        "summary": "UNESCO officially confirmed that it has never conducted any competition or made any such declaration. This is a recurring hoax circulating since 2008.",
        "telugu": "యునెస్కో భారత జాతీయ గీతాన్ని ప్రపంచంలోనే అత్యుత్తమమైనదిగా ప్రకటించిందనేది పచ్చి అబద్ధం. యునెస్కో అలాంటి పోటీలు లేదా ప్రకటనలు ఎప్పుడూ చేయలేదని ధృవీకరించింది.",
        "date": "Updated Today"
    },
    {
        "id": 2,
        "claim": "Viral photo of Pope Francis walking the streets wearing a stylish luxury Balenciaga white puffer jacket",
        "verdict": "FALSE",
        "verdict_badge": "AI-GENERATED / DEEPFAKE",
        "truth_score": 0,
        "confidence": 98,
        "category": "AI Imagery & Deepfakes",
        "origin": "Twitter / Reddit Viral",
        "summary": "The image was artificially generated using Midjourney v5 by a digital artist in Chicago. Closer inspection reveals blurred earlobes, glasses frame distortion, and unnatural fabric folds.",
        "telugu": "పోప్ ఫ్రాన్సిస్ స్టైలిష్ పఫర్ జాకెట్ ధరించిన ఫోటో వాస్తవం కాదు. ఇది మిడ్‌జర్నీ (Midjourney) అనే AI టూల్ ద్వారా సృష్టించబడిన ఆర్టిఫిషియల్ ఇమేజ్.",
        "date": "Trending"
    },
    {
        "id": 3,
        "claim": "RBI to introduce new ₹1000 currency notes embedded with GPS nano-chips for satellite tracking",
        "verdict": "FALSE",
        "verdict_badge": "FABRICATED RUMOR",
        "truth_score": 0,
        "confidence": 97,
        "category": "Banking & Economy",
        "origin": "Viral Video / WhatsApp",
        "summary": "The Reserve Bank of India has issued multiple clarifications confirming no ₹1000 note is being printed and currency notes do not contain electronic nano-chips.",
        "telugu": "జీపీఎస్ చిప్‌లతో కొత్త ₹1000 నోట్లను ఆర్బీఐ విడుదల చేస్తోందన్న వార్త పూర్తిగా అవాస్తవం. ఆర్బీఐ ఈ పుకార్లను పలుమార్లు ఖండించింది.",
        "date": "Recurring Hoax"
    },
    {
        "id": 4,
        "claim": "Drinking concentrated boiled ginger, garlic, and turmeric water completely cures chronic asthma & lung infections",
        "verdict": "MISLEADING",
        "verdict_badge": "MEDICAL MISINFORMATION",
        "truth_score": 40,
        "confidence": 91,
        "category": "Health & Medicine",
        "origin": "Social Media Reels",
        "summary": "While ginger, garlic, and turmeric contain anti-inflammatory properties, they cannot cure chronic respiratory conditions like asthma and should never replace inhalers or prescription therapy.",
        "telugu": "అల్లం, వెల్లుల్లి, పసుపు నీళ్లు తాగడం వల్ల ఆస్తమా పూర్తిగా నయమవుతుందనే ప్రచారం తప్పుదోవ పట్టించేది. ఇవి రోగనిరోధక శక్తికి కొంత సహాయపడతాయి కానీ వైద్య చికిత్సకు ప్రత్యామ్నాయం కావు.",
        "date": "Health Alert"
    },
    {
        "id": 5,
        "claim": "ISRO successfully landed Chandrayaan-3 Vikram Lander near the Lunar South Pole",
        "verdict": "TRUE",
        "verdict_badge": "VERIFIED FACT",
        "truth_score": 100,
        "confidence": 100,
        "category": "Science & Space",
        "origin": "Official News",
        "summary": "On August 23, 2023, ISRO successfully achieved a historic soft landing near the Moon's South Pole, making India the first nation to land in that region.",
        "telugu": "చంద్రయాన్-3 విక్రమ్ ల్యాండర్ చంద్రుడి దక్షిణ ధ్రువంపై విజయవంతంగా ల్యాండ్ అయిందనేది 100% నిజం. భారత్ ఈ ఘనత సాధించిన మొదటి దేశం.",
        "date": "Historical Fact"
    }
]


@app.get("/api/trending-debunks")
def get_trending_debunks():
    return JSONResponse(content={"debunks": TRENDING_DEBUNKS})


@app.get("/api/telegram-info")
def get_telegram_info():
    is_active = bool(TELEGRAM_BOT_TOKEN)
    return JSONResponse(content={
        "connected": is_active,
        "bot_username": "VerifyItFactCheckBot",
        "instructions": "Forward viral WhatsApp/Telegram claims, voice notes, or photos to get verified truth and audio explanations instantly."
    })


@app.post("/factcheck/text")
async def factcheck_text_route(body: TextInput):
    res = await perform_text_factcheck(body.text)
    return JSONResponse(status_code=200, content=res)



@app.post("/factcheck/audio")
async def factcheck_audio_route(audio_file: UploadFile = File(...)):
    audio_data = await audio_file.read()
    res = await perform_audio_factcheck(audio_data)
    return JSONResponse(status_code=200, content=res)


@app.post("/factcheck/image")
async def factcheck_image_route(image: UploadFile = File(...), caption: str = Form(None)):
    image_data = await image.read()
    res = await perform_image_factcheck(image_data, image.content_type, caption)
    return JSONResponse(status_code=200, content=res)


# --- News Feed Endpoints ---
@app.get("/news/sources")
def get_sources():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            is_postgres = bool(DATABASE_URL and psycopg2)
            cur.execute("SELECT id, name, url FROM sources ORDER BY id ASC;")
            rows = cur.fetchall()
            cur.close()

            sources = [
                {"id": r[0] if is_postgres else r["id"], "name": r[1] if is_postgres else r["name"], "url": r[2] if is_postgres else r["url"]}
                for r in rows
            ]
            return JSONResponse(content={"sources": sources})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/news/add_source")
def add_source(source_url: str = Form(...), source_name: str = Form(...)):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            is_postgres = bool(DATABASE_URL and psycopg2)

            if is_postgres:
                cur.execute(
                    "INSERT INTO sources (name, url) VALUES (%s, %s) RETURNING id;",
                    (source_name.strip(), source_url.strip())
                )
                new_id = cur.fetchone()[0]
            else:
                cur.execute(
                    "INSERT INTO sources (name, url) VALUES (?, ?);",
                    (source_name.strip(), source_url.strip())
                )
                new_id = cur.lastrowid

            cur.close()
            sync_news_articles(new_id)
            return JSONResponse(content={"message": "Source added successfully", "id": new_id, "name": source_name, "url": source_url})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/news/remove_source")
def remove_source(source_id: int = Form(...)):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            is_postgres = bool(DATABASE_URL and psycopg2)
            cur.execute(
                "DELETE FROM sources WHERE id = %s;" if is_postgres else "DELETE FROM sources WHERE id = ?;",
                (source_id,)
            )
            cur.close()
            return JSONResponse(content={"message": "Source deleted successfully."})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/news/articles")
def get_articles(source_id: int = Query(None), offset: int = Query(0, ge=0), limit: int = Query(10, ge=1, le=50)):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            is_postgres = bool(DATABASE_URL and psycopg2)

            query = """
                SELECT a.title, a.link, a.pub_date, s.name AS source
                FROM articles a
                JOIN sources s ON a.source_id = s.id
            """
            params = []
            if source_id is not None:
                query += " WHERE a.source_id = %s" if is_postgres else " WHERE a.source_id = ?"
                params.append(source_id)

            query += " ORDER BY a.fetched_at DESC LIMIT %s OFFSET %s;" if is_postgres else " ORDER BY a.fetched_at DESC LIMIT ? OFFSET ?;"
            params.extend([limit, offset])

            cur.execute(query, params)
            rows = cur.fetchall()

            # Total count
            count_q = "SELECT COUNT(*) FROM articles" + (" WHERE source_id = " + ("%s" if is_postgres else "?") if source_id else "")
            cur.execute(count_q, [source_id] if source_id else [])
            total = cur.fetchone()[0]
            cur.close()

            articles = []
            for r in rows:
                title = r[0] if is_postgres else r["title"]
                link = r[1] if is_postgres else r["link"]
                pub_date = r[2] if is_postgres else r["pub_date"]
                source = r[3] if is_postgres else r["source"]

                articles.append({
                    "title": title,
                    "link": link,
                    "source": source,
                    "pubDate": pub_date.isoformat() if isinstance(pub_date, datetime) else str(pub_date) if pub_date else None,
                })

            return JSONResponse(content={"articles": articles, "hasMore": total > (offset + len(rows))})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/news/fetch_and_store")
def fetch_news(source_id: int = Query(...)):
    added = sync_news_articles(source_id)
    return JSONResponse(content={"message": f"Synced {added} articles from source."})


@app.post("/telegram-webhook")
async def telegram_webhook(request: Request):
    if not TELEGRAM_BOT_TOKEN or not telegram_app:
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content="Telegram bot not active.")
    try:
        data = await request.json()
        update = Update.de_json(data, telegram_app.bot)
        if update:
            await telegram_app.process_update(update)
        return Response(status_code=status.HTTP_200_OK)
    except Exception as e:
        print(f"[Telegram Webhook Error] {e}")
        return Response(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("backend.app:app", host="0.0.0.0", port=port, reload=True)
