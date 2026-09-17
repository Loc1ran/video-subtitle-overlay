# Video Subtitle Studio - AI Assistant Extension

Turn **ChatGPT** (chatgpt.com), **DeepSeek** (chat.deepseek.com), or **Gemini** (gemini.google.com) into an automatic subtitle translation engine that drives Video Subtitle Studio directly from your browser — **100% free, no API keys, no local LLM needed**.

## How to Install (Takes 10 Seconds)

1. Open **Google Chrome** or **Microsoft Edge**.
2. Go to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** (top-left).
5. Select the `subtitle-ai-extension` folder inside this repository:
   `<path-to-repository>\subtitle-ai-extension`

Done! The extension icon will appear in your browser toolbar.

---

## How It Works

1. Start **Video Subtitle Studio** (double-click `start.bat` or open `http://localhost:8000`).
2. Upload your video and let it detect dialogue.
3. Open **ChatGPT** (`https://chatgpt.com`) or **DeepSeek** (`https://chat.deepseek.com`).
4. Click the extension icon in your browser toolbar, then click:
   `[⚡ Start Auto-Translation Here]`
5. The extension silently:
   - Automatically types the subtitle prompt into the chat box.
   - Clicks **Send**.
   - Waits for the streaming answer to complete.
   - Extracts the natural translations.
   - Automatically sends the translations back to Video Subtitle Studio!
6. Video Subtitle Studio immediately reloads the subtitles and updates the video preview!
