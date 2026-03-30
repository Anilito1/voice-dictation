"""
Voice Dictation Backend - Headless process for VS Code extension.
Handles hotkey via keyboard library (OS-level suppression).
Communicates status via JSON lines on stdout.
Receives config via JSON lines on stdin.
"""

import os
import sys
import json
import tempfile
import wave
import threading
import time

# Force UTF-8 on Windows (pythonw defaults to ASCII pipes)
import io
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
except Exception:
    pass
try:
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", line_buffering=True)
except Exception:
    pass

from dotenv import load_dotenv

_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_dir, ".env"))

import sounddevice as sd
import numpy as np
import keyboard
import pyperclip
import pyautogui
from groq import Groq

# ── Helpers ─────────────────────────────────────────────

def send_msg(msg):
    line = json.dumps(msg, ensure_ascii=True) + "\n"
    sys.stdout.write(line)
    sys.stdout.flush()


# ── Config ──────────────────────────────────────────────
# API key can come from .env (standalone) or from the extension via stdin
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
client = None

def init_client(key=None):
    global client, GROQ_API_KEY
    if key:
        GROQ_API_KEY = key
    if GROQ_API_KEY:
        client = Groq(api_key=GROQ_API_KEY, timeout=30.0)
SAMPLE_RATE = 16000
CHANNELS = 1
BLOCK_SIZE = int(SAMPLE_RATE * 0.1)

config = {
    "language": "fr",
    "silenceDuration": 1.5,
    "maxDuration": 120,
    "silenceThreshold": 0.01,
    "hotkeyScancode": 41,
}

HALLUCINATIONS = [
    "sous-titrage", "radio-canada", "merci d'avoir regard",
    "merci de votre attention", "sous-titres", "amara.org",
    "thank you for watching", "thanks for watching",
    "transcription d'", "ottawa", "merci d'", "vous remercier",
    "bonne journ", "a bientot", "au revoir",
]

# ── State ───────────────────────────────────────────────
recording_event = threading.Event()
processing = threading.Event()
audio_lock = threading.Lock()
audio_frames = []
audio_level = 0.0
last_toggle = 0.0
current_stream = None


def is_hallucination(text):
    lower = text.lower().strip()
    if len(lower) < 3:
        return True
    return any(h in lower for h in HALLUCINATIONS)


# ── Audio ───────────────────────────────────────────────
def audio_callback(indata, frames, time_info, status):
    global audio_level
    if recording_event.is_set():
        with audio_lock:
            audio_frames.append(indata.copy())
        rms = np.sqrt(np.mean(indata.astype(np.float32) ** 2))
        audio_level = min(rms / 8000.0, 1.0)


def check_silence():
    chunks_needed = int(config["silenceDuration"] / 0.1)
    with audio_lock:
        if len(audio_frames) < chunks_needed:
            return False
        recent = list(audio_frames[-chunks_needed:])
    for chunk in recent:
        rms = np.sqrt(np.mean(chunk.astype(np.float32) ** 2)) / 32768.0
        if rms > config["silenceThreshold"]:
            return False
    return True


def vad_monitor():
    time.sleep(1.5)
    while recording_event.is_set():
        if check_silence():
            recording_event.clear()
            threading.Thread(target=do_transcribe, daemon=True).start()
            return
        time.sleep(0.1)


# ── Recording ───────────────────────────────────────────
def do_start():
    global current_stream, audio_level, last_toggle
    now = time.time()
    if now - last_toggle < 0.4:
        return
    if recording_event.is_set() or processing.is_set():
        return
    last_toggle = now

    with audio_lock:
        audio_frames.clear()
    audio_level = 0.0
    recording_event.set()

    try:
        current_stream = sd.InputStream(
            samplerate=SAMPLE_RATE, channels=CHANNELS,
            dtype="int16", blocksize=BLOCK_SIZE, callback=audio_callback,
        )
        current_stream.start()
    except Exception as e:
        recording_event.clear()
        send_msg({"status": "error", "msg": f"Microphone: {e}"})
        return

    send_msg({"status": "recording"})

    def watchdog():
        t0 = time.time()
        while recording_event.is_set():
            if time.time() - t0 > config["maxDuration"]:
                recording_event.clear()
                threading.Thread(target=do_transcribe, daemon=True).start()
                return
            time.sleep(0.05)

    threading.Thread(target=watchdog, daemon=True).start()
    threading.Thread(target=vad_monitor, daemon=True).start()


def do_stop():
    global last_toggle
    now = time.time()
    if now - last_toggle < 0.4:
        return
    if not recording_event.is_set():
        return
    last_toggle = now
    recording_event.clear()
    threading.Thread(target=do_transcribe, daemon=True).start()


def do_transcribe():
    global current_stream

    if current_stream:
        try:
            current_stream.stop()
            current_stream.close()
        except Exception:
            pass
        current_stream = None

    with audio_lock:
        frames_copy = list(audio_frames)

    if not frames_copy:
        send_msg({"status": "skip"})
        return

    total_samples = sum(f.shape[0] for f in frames_copy)
    duration = total_samples / SAMPLE_RATE
    if duration < 0.3:
        send_msg({"status": "skip"})
        return

    processing.set()
    send_msg({"status": "processing"})

    tmp_path = None
    try:
        audio_data = np.concatenate(frames_copy)
        fd, tmp_path = tempfile.mkstemp(suffix=".wav", prefix="dict_")
        os.close(fd)
        with wave.open(tmp_path, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio_data.tobytes())

        with open(tmp_path, "rb") as f:
            audio_bytes = f.read()

        if not client:
            send_msg({"status": "error", "msg": "No API key configured"})
            return
        result = client.audio.transcriptions.create(
            file=("audio.wav", audio_bytes),
            model="whisper-large-v3",
            language=config["language"],
            temperature=0,
        )
        text = result.text.strip()

        if text and not is_hallucination(text):
            try:
                old_clip = pyperclip.paste()
            except Exception:
                old_clip = ""
            pyperclip.copy(text)
            time.sleep(0.05)
            pyautogui.hotkey("ctrl", "v")
            time.sleep(0.2)
            pyperclip.copy(old_clip)
            send_msg({"status": "done", "text": text})
        else:
            send_msg({"status": "skip"})
    except Exception as e:
        send_msg({"status": "error", "msg": str(e)})
    finally:
        processing.clear()
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def toggle():
    if recording_event.is_set():
        do_stop()
    else:
        do_start()


# ── Keyboard hook (OS-level, suppresses the key) ───────
MODIFIER_SCANCODES = {29, 42, 54, 56, 69, 70, 157, 184}
capture_mode = False

# Readable key names for all scancodes (Windows / AZERTY-friendly)
SCANCODE_NAMES = {
    1: "Echap", 2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7",
    9: "8", 10: "9", 11: "0", 12: ")", 13: "=", 14: "Retour",
    15: "Tab", 16: "A", 17: "Z", 18: "E", 19: "R", 20: "T", 21: "Y",
    22: "U", 23: "I", 24: "O", 25: "P", 26: "^", 27: "$", 28: "Entree",
    29: "Ctrl", 30: "Q", 31: "S", 32: "D", 33: "F", 34: "G", 35: "H",
    36: "J", 37: "K", 38: "L", 39: "M", 40: "'", 41: "\u00b2",
    42: "Shift", 43: "*", 44: "W", 45: "X", 46: "C", 47: "V", 48: "B",
    49: "N", 50: ",", 51: ";", 52: ":", 53: "!", 54: "Shift droit",
    55: "Num *", 56: "Alt", 57: "Espace", 58: "Verr Maj",
    59: "F1", 60: "F2", 61: "F3", 62: "F4", 63: "F5", 64: "F6",
    65: "F7", 66: "F8", 67: "F9", 68: "F10", 69: "Verr Num",
    70: "Arr Defil", 71: "Num 7", 72: "Num 8", 73: "Num 9", 74: "Num -",
    75: "Num 4", 76: "Num 5", 77: "Num 6", 78: "Num +",
    79: "Num 1", 80: "Num 2", 81: "Num 3", 82: "Num 0", 83: "Num .",
    86: "<", 87: "F11", 88: "F12",
    91: "Win", 92: "Win droit", 93: "Menu",
    96: "Num Entree", 97: "Ctrl droit", 99: "Impr ecran",
    100: "Alt Gr", 102: "Origine", 103: "Haut", 104: "Page haut",
    105: "Gauche", 106: "Droite", 107: "Fin", 108: "Bas",
    109: "Page bas", 110: "Inser", 111: "Suppr",
}


def scancode_display(scan_code, event_name):
    """Return a user-friendly name for a scancode."""
    if scan_code in SCANCODE_NAMES:
        return SCANCODE_NAMES[scan_code]
    if event_name and event_name.strip() and event_name != "unknown":
        return event_name.capitalize()
    return f"Touche {scan_code}"


def modifiers_match():
    """Check if required modifier keys are currently held."""
    if config.get("hotkeyCtrl") and not keyboard.is_pressed("ctrl"):
        return False
    if config.get("hotkeyAlt") and not keyboard.is_pressed("alt"):
        return False
    if config.get("hotkeyShift") and not keyboard.is_pressed("shift"):
        return False
    return True


def on_key(event):
    global capture_mode

    # Capture mode: user is binding a new key
    if capture_mode and event.event_type == "down":
        if event.scan_code in MODIFIER_SCANCODES:
            return True  # let modifiers through, wait for the actual key
        capture_mode = False
        name = scancode_display(event.scan_code, event.name)
        send_msg({"status": "key_captured", "scancode": event.scan_code, "name": name})
        return False  # suppress

    # Normal mode: check hotkey
    if event.scan_code == config["hotkeyScancode"]:
        if modifiers_match():
            if event.event_type == "down":
                toggle()
            return False  # suppress
    return True  # let all other keys through


# ── Stdin listener for config updates ──────────────────
def stdin_listener():
    global capture_mode
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue

        action = cmd.get("cmd")
        if action == "config":
            old_scancode = config["hotkeyScancode"]
            if "apiKey" in cmd and cmd["apiKey"]:
                init_client(cmd["apiKey"])
            for key in ("language", "silenceDuration", "maxDuration",
                        "silenceThreshold", "hotkeyScancode",
                        "hotkeyCtrl", "hotkeyAlt", "hotkeyShift"):
                if key in cmd:
                    config[key] = cmd[key]
            if config["hotkeyScancode"] != old_scancode:
                keyboard.unhook_all()
                keyboard.hook(on_key, suppress=True)
        elif action == "capture_key":
            capture_mode = True
            send_msg({"status": "capturing"})
        elif action == "start":
            do_start()
        elif action == "stop":
            do_stop()
        elif action == "quit":
            recording_event.clear()
            if current_stream:
                try:
                    current_stream.stop()
                    current_stream.close()
                except Exception:
                    pass
            keyboard.unhook_all()
            break


# ── Main ────────────────────────────────────────────────
def main():
    init_client()
    send_msg({"status": "ready"})
    keyboard.hook(on_key, suppress=True)
    threading.Thread(target=stdin_listener, daemon=True).start()

    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        recording_event.clear()
        keyboard.unhook_all()


if __name__ == "__main__":
    main()
