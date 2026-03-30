# Voice Dictation for VS Code

Personal project I built to dictate into VS Code and Claude Code without touching the keyboard. Publishing it for free so anyone can use it. Bring your own API key.

![Sidebar](https://raw.githubusercontent.com/Anilito1/voice-dictation/master/media/sidebar.png)
![Status Bar](https://raw.githubusercontent.com/Anilito1/voice-dictation/master/media/statusbar.png)

## How it works

1. Press your hotkey
2. Speak
3. Text appears where your cursor is

## Features

- **Sidebar panel** — API key, shortcut binding, language, all settings in one place
- **Status bar** — Red blinking REC, yellow spinner, green OK
- **Auto-stop** — Detects silence and stops recording automatically
- **Any shortcut** — Bind any key + Ctrl/Alt/Shift combo
- **10 languages** — French, English, Spanish, German, Italian, Portuguese, Dutch, Japanese, Korean, Chinese

## Supported APIs

| Provider | Get a key |
|----------|-----------|
| **[Groq](https://console.groq.com/keys)** (default, free) | console.groq.com |
| **[Deepgram](https://deepgram.com)** | deepgram.com |
| **[OpenAI](https://platform.openai.com)** | platform.openai.com |
| **[AssemblyAI](https://www.assemblyai.com)** | assemblyai.com |

## Requirements

- Python 3.10+
- A microphone

Dependencies are installed automatically on first launch.

## License

MIT — [GitHub](https://github.com/Anilito1/voice-dictation)
