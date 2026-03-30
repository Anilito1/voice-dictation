"""
Voice Dictation - Groq Whisper
Appuie ² pour dicter, ² pour stopper. Texte colle dans le champ actif.
Zero console. Overlay flottant visible.
"""

import os
import sys
import tempfile
import wave
import threading
import time
import logging
import ctypes
import tkinter as tk
from dotenv import load_dotenv

_dir = os.path.dirname(os.path.abspath(__file__))
logging.basicConfig(
    filename=os.path.join(_dir, "dictation.log"),
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.info

load_dotenv(os.path.join(_dir, ".env"))

import sounddevice as sd
import numpy as np
import keyboard
import pyperclip
import pyautogui
from groq import Groq

# ── Config ──────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY or GROQ_API_KEY == "COLLE_TA_CLE_ICI":
    ctypes.windll.user32.MessageBoxW(
        0, "Mets ta cle API Groq dans .env", "Voice Dictation", 0x10
    )
    sys.exit(1)

LANGUAGE = os.getenv("DICTATION_LANGUAGE", "fr")
HOTKEY_SCANCODE = int(os.getenv("DICTATION_HOTKEY_SCANCODE", "41"))
MAX_DURATION = int(os.getenv("DICTATION_MAX_DURATION", "120"))
SILENCE_THRESHOLD = float(os.getenv("DICTATION_SILENCE_THRESHOLD", "0.01"))
SILENCE_DURATION = float(os.getenv("DICTATION_SILENCE_DURATION", "1.5"))

client = Groq(api_key=GROQ_API_KEY, timeout=30.0)
SAMPLE_RATE = 16000
CHANNELS = 1
BLOCK_SIZE = int(SAMPLE_RATE * 0.1)

# ── State ───────────────────────────────────────────────
recording_event = threading.Event()
processing_event = threading.Event()
audio_lock = threading.Lock()
audio_frames: list = []
audio_level = 0.0
last_toggle = 0.0
pulse_phase = 0.0

HALLUCINATIONS = [
    "sous-titrage", "radio-canada", "merci d'avoir regard",
    "merci de votre attention", "sous-titres", "amara.org",
    "thank you for watching", "thanks for watching",
    "transcription d'", "ottawa", "merci d'", "vous remercier",
    "bonne journ", "a bientot", "au revoir",
]

# ── GUI ─────────────────────────────────────────────────
root = tk.Tk()
root.title("VoiceDictation")
root.attributes("-topmost", True)
root.overrideredirect(True)

# Taille du cercle indicateur
SIZE = 44
PADDING = 18
screen_w = root.winfo_screenwidth()
screen_h = root.winfo_screenheight()
x_pos = screen_w - SIZE - PADDING
y_pos = screen_h // 2 - SIZE // 2
root.geometry(f"{SIZE}x{SIZE}+{x_pos}+{y_pos}")

# Transparence : on utilise une couleur de fond comme masque
TRANSPARENT_COLOR = "#010101"
root.configure(bg=TRANSPARENT_COLOR)
root.attributes("-transparentcolor", TRANSPARENT_COLOR)
root.attributes("-alpha", 0.95)

canvas = tk.Canvas(
    root, width=SIZE, height=SIZE,
    bg=TRANSPARENT_COLOR, highlightthickness=0, bd=0
)
canvas.pack()

# Cercle principal
MARGIN = 3
circle_outer = canvas.create_oval(
    0, 0, SIZE, SIZE, fill="#1a1a2e", outline="#333355", width=2
)
circle_inner = canvas.create_oval(
    MARGIN + 4, MARGIN + 4, SIZE - MARGIN - 4, SIZE - MARGIN - 4,
    fill="#333333", outline=""
)
# Petit texte au centre
circle_text = canvas.create_text(
    SIZE // 2, SIZE // 2, text="", fill="white",
    font=("Segoe UI", 7, "bold")
)

root.withdraw()

# Win32 : click-through + tool window (pas dans la taskbar)
GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000


def apply_window_flags():
    root.update_idletasks()
    hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
    style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    style |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
    ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style)


# ── Overlay states ──────────────────────────────────────
def show_recording():
    canvas.itemconfig(circle_inner, fill="#ff3b3b")
    canvas.itemconfig(circle_outer, outline="#ff6b6b")
    canvas.itemconfig(circle_text, text="REC", fill="white")
    root.deiconify()
    root.attributes("-topmost", True)
    apply_window_flags()


def show_processing():
    canvas.itemconfig(circle_inner, fill="#f0a030")
    canvas.itemconfig(circle_outer, outline="#ffc857")
    canvas.itemconfig(circle_text, text="...", fill="white")


def show_success():
    canvas.itemconfig(circle_inner, fill="#2ecc71")
    canvas.itemconfig(circle_outer, outline="#58d68d")
    canvas.itemconfig(circle_text, text="OK", fill="white")


def show_error():
    canvas.itemconfig(circle_inner, fill="#e74c3c")
    canvas.itemconfig(circle_outer, outline="#ff6b6b")
    canvas.itemconfig(circle_text, text="ERR", fill="white")


def hide_overlay():
    root.withdraw()


# ── Pulse animation pendant recording ──────────────────
def animate():
    global pulse_phase
    if recording_event.is_set():
        pulse_phase += 0.15
        # Pulsation du cercle interieur
        import math
        pulse = 0.5 + 0.5 * math.sin(pulse_phase)
        level = min(audio_level, 1.0)

        # Couleur qui varie avec le volume
        r = int(180 + 75 * level)
        g = int(50 - 30 * level)
        b = int(50 - 30 * level)
        color = f"#{min(r,255):02x}{max(g,0):02x}{max(b,0):02x}"
        canvas.itemconfig(circle_inner, fill=color)

        # Taille qui pulse
        shrink = int(3 * pulse)
        m = MARGIN + 4 + shrink
        canvas.coords(circle_inner, m, m, SIZE - m, SIZE - m)

        # Glow de l'outline
        glow = int(100 + 155 * pulse)
        canvas.itemconfig(circle_outer, outline=f"#{min(glow,255):02x}3030", width=2)

        root.after(33, animate)
    elif processing_event.is_set():
        pulse_phase += 0.2
        import math
        pulse = 0.5 + 0.5 * math.sin(pulse_phase)
        glow = int(180 + 75 * pulse)
        canvas.itemconfig(circle_outer, outline=f"#ff{min(glow,255):02x}30", width=2)
        root.after(50, animate)


# ── Audio ───────────────────────────────────────────────
def audio_callback(indata, frames, time_info, status):
    global audio_level
    if recording_event.is_set():
        with audio_lock:
            audio_frames.append(indata.copy())
        rms = np.sqrt(np.mean(indata.astype(np.float32) ** 2))
        audio_level = min(rms / 8000.0, 1.0)


def check_silence() -> bool:
    chunks_needed = int(SILENCE_DURATION / 0.1)
    with audio_lock:
        if len(audio_frames) < chunks_needed:
            return False
        recent = list(audio_frames[-chunks_needed:])
    for chunk in recent:
        rms = np.sqrt(np.mean(chunk.astype(np.float32) ** 2)) / 32768.0
        if rms > SILENCE_THRESHOLD:
            return False
    return True


def vad_monitor():
    time.sleep(1.5)
    while recording_event.is_set():
        if check_silence():
            log("[VAD] Silence -> auto-stop")
            root.after(0, do_stop)
            return
        time.sleep(0.1)


def is_hallucination(text: str) -> bool:
    lower = text.lower().strip()
    if len(lower) < 3:
        return True
    return any(h in lower for h in HALLUCINATIONS)


# ── Recording logic ─────────────────────────────────────
def do_start():
    global audio_level, last_toggle, pulse_phase
    now = time.time()
    if now - last_toggle < 0.4:
        return
    if recording_event.is_set() or processing_event.is_set():
        return
    last_toggle = now

    with audio_lock:
        audio_frames.clear()
    audio_level = 0.0
    pulse_phase = 0.0
    recording_event.set()
    log("[REC] Start")

    show_recording()
    animate()

    try:
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE, channels=CHANNELS,
            dtype="int16", blocksize=BLOCK_SIZE, callback=audio_callback,
        )
        stream.start()
    except Exception as e:
        log(f"[ERR] Micro: {e}")
        recording_event.clear()
        show_error()
        root.after(1500, hide_overlay)
        return

    def watch():
        try:
            t0 = time.time()
            while recording_event.is_set():
                if time.time() - t0 > MAX_DURATION:
                    root.after(0, do_stop)
                    break
                time.sleep(0.05)
        finally:
            stream.stop()
            stream.close()

    threading.Thread(target=watch, daemon=True).start()
    threading.Thread(target=vad_monitor, daemon=True).start()


def do_stop():
    global last_toggle
    if not recording_event.is_set():
        return
    now = time.time()
    if now - last_toggle < 0.4:
        return
    last_toggle = now
    recording_event.clear()

    with audio_lock:
        frames_copy = list(audio_frames)

    if not frames_copy:
        hide_overlay()
        return

    total_samples = sum(f.shape[0] for f in frames_copy)
    duration = total_samples / SAMPLE_RATE
    if duration < 0.3:
        hide_overlay()
        return

    log(f"[INFO] {duration:.1f}s audio")
    processing_event.set()
    show_processing()
    animate()

    def transcribe():
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

            t0 = time.time()
            result = client.audio.transcriptions.create(
                file=("audio.wav", audio_bytes),
                model="whisper-large-v3",
                language=LANGUAGE,
                temperature=0,
            )
            text = result.text.strip()
            log(f"[GROQ] ({time.time()-t0:.2f}s) '{text}'")

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
                log(f"[OK] '{text}'")
                root.after(0, show_success)
                root.after(1200, hide_overlay)
            else:
                log(f"[SKIP] '{text}'")
                root.after(0, hide_overlay)
        except Exception as e:
            log(f"[ERR] {e}")
            root.after(0, show_error)
            root.after(2000, hide_overlay)
        finally:
            processing_event.clear()
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    threading.Thread(target=transcribe, daemon=True).start()


def toggle():
    if recording_event.is_set():
        do_stop()
    else:
        do_start()


# ── Hotkey ──────────────────────────────────────────────
def on_key(event):
    if event.scan_code == HOTKEY_SCANCODE:
        if event.event_type == "down":
            root.after(0, toggle)
        return False  # suppress ² (down et up)
    return True  # laisse passer toutes les autres touches


keyboard.hook(on_key, suppress=True)

log(f"[READY] scancode={HOTKEY_SCANCODE} lang={LANGUAGE}")

try:
    root.mainloop()
finally:
    recording_event.clear()
    keyboard.unhook_all()
