# Voice Dictation for VS Code

Personal project I built to dictate into VS Code and Claude Code without touching the keyboard. Publishing it for free so anyone can use it. Bring your own API key.

**[Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Anilito1.voice-dictation)**

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
- **Any shortcut** — Bind any key + Cmd/Ctrl/Alt/Shift combo, works from anywhere (Windows & macOS)
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

## macOS is here! 🎉

Voice Dictation now works fully on Mac — press your shortcut anywhere (a file,
the terminal, Claude Code…) and your words appear right where your cursor is.

**3 steps to start:**

1. **Add your API key** in the Voice Dictation sidebar.
2. **Pick your shortcut** — click the key button in the sidebar, press the key
   you want, and tick **Cmd**.
3. **Allow VS Code once** — open *System Settings › Privacy & Security ›
   Accessibility* and turn on **Visual Studio Code**. This lets it type for you.

That's it! Press your shortcut, talk, then pause — your text appears. Press again
to stop early.

*Nothing happens? Double-check step 3 — Accessibility has to be on for VS Code.*

## License

MIT — [GitHub](https://github.com/Anilito1/voice-dictation)
