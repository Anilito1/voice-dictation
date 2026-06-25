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

## macOS

macOS now has the same global hotkey as Windows — press your key from anywhere
(editor, integrated terminal, Claude Code, any panel) and the text is pasted
where your cursor is.

1. **Python** is auto-detected (`python3`). If yours lives elsewhere, set
   `voiceDictation.pythonPath` (e.g. a venv: `/Users/you/.venv/bin/python`).
2. **Bind a key** in the sidebar: click the shortcut button, press your key, and
   tick **Cmd** (recommended — so the hotkey itself types nothing).
3. **Grant Accessibility** to VS Code: *System Settings › Privacy & Security ›
   Accessibility*. Without it, the transcription is produced but the Cmd+V paste
   silently does nothing.

Then: put your cursor anywhere, press your hotkey, speak, and press again to stop
(or let it auto-stop on silence) — text appears at the cursor.

> Bind the key in the sidebar, **not** in VS Code's Keyboard Shortcuts — a VS Code
> keybinding can't fire when a terminal or webview has focus, and binding both
> would double-trigger. If the hotkey still doesn't fire, also grant *Input
> Monitoring* to VS Code in the same Privacy & Security settings.

## License

MIT — [GitHub](https://github.com/Anilito1/voice-dictation)
