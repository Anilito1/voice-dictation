# Voice Dictation for VS Code

Push-to-talk voice dictation. Press a key, speak, text appears instantly.

I built this for my own use — to dictate directly into VS Code, Claude Code, or any text field without switching windows. It's open source so anyone can use it, fork it, or improve it.

---

## Demo

1. Press your hotkey (default: **²** on AZERTY)
2. Speak naturally
3. Press again or wait for silence
4. Text is pasted where your cursor is

Status bar feedback:
| State | Indicator |
|-------|-----------|
| Ready | Mic icon |
| Recording | Red blinking **REC** |
| Transcribing | Yellow spinner |
| Done | Green **OK** |

---

## Install

### Option 1: VS Code Extension (recommended)

```bash
git clone https://github.com/Anilito1/voice-dictation.git
```

Install Python dependencies:

```bash
pip install groq sounddevice numpy keyboard pyperclip pyautogui python-dotenv
```

Link the extension into VS Code:

**Windows** (run cmd as admin):
```cmd
mklink /J "%USERPROFILE%\.vscode\extensions\Anilito1.voice-dictation-1.0.0" "C:\path\to\voice-dictation"
```

**macOS / Linux:**
```bash
ln -s /path/to/voice-dictation ~/.vscode/extensions/Anilito1.voice-dictation-1.0.0
```

Reload VS Code: `Ctrl+Shift+P` > **Reload Window**

A mic icon appears in the left sidebar and in the bottom status bar. Click the sidebar icon to configure.

### Option 2: Standalone (no VS Code)

If you just want the dictation tool without VS Code:

```bash
git clone https://github.com/Anilito1/voice-dictation.git
cd voice-dictation
pip install groq sounddevice numpy keyboard pyperclip pyautogui python-dotenv
cp .env.example .env
```

Edit `.env` with your API key:

```
API_KEY=your_api_key_here
```

Run:

```bash
pythonw dictation.pyw
```

A floating overlay appears on screen. Same hotkey, same features, no VS Code needed.

---

## Setup your API key

### In VS Code

1. Click the **mic icon** in the left sidebar
2. Paste your API key in the field
3. Click **Connect**

Your key is stored locally in VS Code — never sent anywhere except the STT provider.

### Standalone (.env)

```bash
cp .env.example .env
```

Edit `.env`:

```
API_KEY=your_api_key_here
```

---

## Choose your API

This tool uses [Groq Whisper](https://groq.com) by default, but you can use any speech-to-text API. The transcription logic is isolated in `dictation_backend.py` → `do_transcribe()`.

| Provider | Speed | Free tier | Get a key |
|----------|-------|-----------|-----------|
| **[Groq](https://console.groq.com/keys)** (default) | ~0.3s for 5s audio | Yes | console.groq.com |
| **[Deepgram](https://deepgram.com)** | Real-time streaming | $200 credit | deepgram.com |
| **[OpenAI](https://platform.openai.com)** | ~2s | Pay-as-you-go | platform.openai.com |
| **[AssemblyAI](https://www.assemblyai.com)** | Real-time streaming | Free tier | assemblyai.com |

**Why Groq by default?** Free tier, Whisper large-v3 model, 164x real-time inference speed. A 5-second recording transcribes in ~0.3 seconds.

To switch providers, modify the API call in `do_transcribe()` in `dictation_backend.py`. PRs for multi-provider support are welcome.

---

## Configuration

Click the **mic icon** in the left sidebar to access all settings:

**API Key** — Enter your key, see connection status, remove with one click.

**Bind your shortcut** — Click the box, press any key on your keyboard. The actual key is captured at OS level so it always matches. Add Ctrl / Alt / Shift modifiers with checkboxes.

**Language** — 10 languages available (French, English, Spanish, German, Italian, Portuguese, Dutch, Japanese, Korean, Chinese). Whisper supports 100+ languages — edit settings for more.

**Voice detection** — Auto-stop after silence (adjustable), max recording duration, silence sensitivity.

All settings persist across VS Code restarts.

---

## Architecture

```
voice-dictation/
  package.json              VS Code extension manifest
  src/extension.js          Status bar, sidebar panel, settings UI
  dictation_backend.py      Audio recording, API calls, keyboard hook
  dictation.pyw             Standalone mode (tkinter overlay)
  .env.example              Template for API key
  media/mic.svg             Sidebar icon
```

**How it works:**
1. Extension spawns `dictation_backend.py` as a child process
2. Backend hooks the keyboard at OS level — hotkey is captured and suppressed
3. On hotkey press: records audio via `sounddevice` (gapless InputStream)
4. Silence detection (VAD) auto-stops after configurable duration
5. Audio sent to Groq Whisper, transcription returned in ~0.3s
6. Text pasted via clipboard + Ctrl+V (works in any app)
7. Extension updates status bar from JSON messages

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Hotkey doesn't work | Windows: run VS Code as **admin** (`keyboard` lib needs privileges) |
| No transcription | Check API key in sidebar. Check internet connection. |
| Text not pasted | Install `pyautogui`. Some elevated apps block simulated input. |
| Python not found | Set `voiceDictation.pythonPath` in VS Code settings to your Python path |
| Standalone: no overlay | Use `pythonw` (not `python`) to avoid console window |

---

## Contributing

This is a personal project but contributions are welcome:
- Bug reports and fixes
- Multi-API provider support
- Linux / macOS testing
- UI improvements

---

## License

MIT — see [LICENSE](LICENSE)
