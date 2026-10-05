import io
import base64
try:
    from pydub import AudioSegment
except ImportError:
    AudioSegment = None

from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from telegram.constants import ParseMode

# Global references initialized from app.py
_openai_client = None
_tts_function = None
_authorized_user_ids = []
_perform_image_factcheck_function = None
_transcribe_audio_function = None


def detect_image_mime(image_bytes: bytes) -> str:
    """Safe MIME detection without deprecated imghdr."""
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    elif image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    elif image_bytes.startswith(b"GIF87a") or image_bytes.startswith(b"GIF89a"):
        return "image/gif"
    elif len(image_bytes) >= 12 and image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def initialize_bot_components(
    openai_client_instance,
    tts_func,
    authorized_ids,
    perform_image_factcheck_func,
    transcribe_audio_func,
):
    """Initializes handlers with dependencies injected from app.py."""
    global _openai_client, _tts_function, _authorized_user_ids
    global _perform_image_factcheck_function, _transcribe_audio_function

    _openai_client = openai_client_instance
    _tts_function = tts_func
    _authorized_user_ids = authorized_ids
    _perform_image_factcheck_function = perform_image_factcheck_func
    _transcribe_audio_function = transcribe_audio_func


def is_authorized(user_id: int) -> bool:
    """Checks if the user has access. If no IDs configured, allow all."""
    if not _authorized_user_ids:
        return True
    return user_id in _authorized_user_ids


async def _perform_text_factcheck(text: str) -> str:
    """Fact checks text statement using OpenAI."""
    if not _openai_client:
        return "Error: OpenAI client is not configured."
    try:
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a friendly and honest fact checker. You speak naturally in Telugu "
                    "with minimal English only where necessary. Be accurate, clear, and real (under 100 words)."
                ),
            },
            {
                "role": "user",
                "content": f"Fact-check this statement and answer directly:\n\"{text}\"",
            },
        ]
        completion = _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
        )
        return completion.choices[0].message.content
    except Exception as e:
        return f"Error fact-checking: {e}"


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_authorized(update.effective_user.id):
        await update.message.reply_text("You are not authorized to use this bot.")
        return
    welcome_text = (
        "👋 *Welcome to VerifyIt Fact Checker!*\n\n"
        "Send me any of the following:\n"
        "• 📝 *Text*: Type any news or statement.\n"
        "• 🎤 *Voice Note*: Record a voice message.\n"
        "• 🖼️ *Photo*: Send an image with an optional caption.\n\n"
        "I will analyze the claim and reply with the verified truth!"
    )
    await update.message.reply_text(welcome_text, parse_mode=ParseMode.MARKDOWN)


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await start_command(update, context)


async def _send_audio_reply(context: ContextTypes.DEFAULT_TYPE, chat_id: int, result_text: str):
    """Helper to generate and send voice note reply if TTS is enabled."""
    if not _tts_function:
        return
    try:
        audio_b64 = _tts_function(result_text)
        if not audio_b64:
            return
        audio_bytes = base64.b64decode(audio_b64)
        audio_seg = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
        ogg_io = io.BytesIO()
        audio_seg.export(ogg_io, format="ogg", codec="libopus")
        ogg_io.seek(0)
        await context.bot.send_voice(chat_id=chat_id, voice=ogg_io, caption="🔊 Voice Verdict")
    except Exception as e:
        print(f"[Bot Voice Reply Error] {e}")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.effective_user.id
    if not is_authorized(user_id):
        await update.message.reply_text("You are not authorized to use this bot.")
        return

    msg = update.message
    chat_id = msg.chat_id

    try:
        # 1. Text Message
        if msg.text:
            status_msg = await msg.reply_text("🔍 Fact-checking your statement...")
            result = await _perform_text_factcheck(msg.text)
            await status_msg.edit_text(result)
            await _send_audio_reply(context, chat_id, result)

        # 2. Voice Note
        elif msg.voice and _transcribe_audio_function:
            status_msg = await msg.reply_text("🎙️ Transcribing voice note...")
            voice_file = await context.bot.get_file(msg.voice.file_id)

            ogg_bytes = io.BytesIO()
            await voice_file.download_to_memory(ogg_bytes)
            ogg_bytes.seek(0)

            # Convert OGG to MP3
            audio_seg = AudioSegment.from_ogg(ogg_bytes)
            mp3_bytes = io.BytesIO()
            audio_seg.export(mp3_bytes, format="mp3")
            mp3_bytes.seek(0)

            transcript = await _transcribe_audio_function(mp3_bytes.getvalue())
            await status_msg.edit_text(f"📝 *Transcript:* \"{transcript}\"\n\n🔍 Fact-checking claim...", parse_mode=ParseMode.MARKDOWN)

            result = await _perform_text_factcheck(transcript)
            await msg.reply_text(result)
            await _send_audio_reply(context, chat_id, result)

        # 3. Photo
        elif msg.photo and _perform_image_factcheck_function:
            status_msg = await msg.reply_text("🖼️ Analyzing image for claims...")
            photo = msg.photo[-1]
            photo_file = await context.bot.get_file(photo.file_id)

            img_io = io.BytesIO()
            await photo_file.download_to_memory(img_io)
            img_bytes = img_io.getvalue()
            mime = detect_image_mime(img_bytes)

            caption = msg.caption or ""
            res = await _perform_image_factcheck_function(img_bytes, mime, caption)

            if "error" in res:
                await status_msg.edit_text(f"❌ {res['error']}")
            else:
                await status_msg.edit_text(res["result"])
                await _send_audio_reply(context, chat_id, res["result"])

        else:
            await msg.reply_text("Please send a text message, voice note, or photo to fact-check.")

    except Exception as e:
        print(f"[Bot Error] {e}")
        await msg.reply_text(f"An unexpected error occurred: {e}")


def setup_telegram_bot_application(token: str) -> Application:
    """Builds Telegram application with command and message handlers."""
    application = Application.builder().token(token).build()
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    application.add_handler(MessageHandler(filters.VOICE, handle_message))
    application.add_handler(MessageHandler(filters.PHOTO, handle_message))
    return application
