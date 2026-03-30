# Voice Dictation for VS Code

Press a key, speak, text appears. Open source, plug your own API key.

## Install

```bash
git clone https://github.com/Anilito1/voice-dictation.git
cd voice-dictation
pip install groq sounddevice numpy keyboard pyperclip pyautogui python-dotenv
```

Link into VS Code:

```cmd
:: Windows (cmd as admin)
mklink /J "%USERPROFILE%\.vscode\extensions\Anilito1.voice-dictation-1.0.0" "C:\path\to\voice-dictation"
```

```bash
# macOS / Linux
ln -s /path/to/voice-dictation ~/.vscode/extensions/Anilito1.voice-dictation-1.0.0
```

Reload VS Code (`Ctrl+Shift+P` > `Reload Window`).

## Setup

Click the **mic icon** in the left sidebar:
1. Paste your API key → **Connect**
2. Click **Bind your shortcut** → press your key
3. Pick your language
4. Done

## Supported APIs

| Provider | Get a key |
|----------|-----------|
| **[Groq](https://console.groq.com/keys)** (default, free) | console.groq.com |
| **[Deepgram](https://deepgram.com)** | deepgram.com |
| **[OpenAI](https://platform.openai.com)** | platform.openai.com |
| **[AssemblyAI](https://www.assemblyai.com)** | assemblyai.com |

To switch: edit `do_transcribe()` in `dictation_backend.py`.

## Standalone (no VS Code)

```bash
cp .env.example .env   # edit with your key: API_KEY=...
pythonw dictation.pyw
```

## License

MIT
