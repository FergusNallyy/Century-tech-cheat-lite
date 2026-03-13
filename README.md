# Century Tech Solver Lite

A lightweight Tampermonkey userscript that uses AI to solve questions on [Century Tech](https://app.century.tech). It supports multiple choice, typed answer, and drag-and-drop matching questions.

---

## Features

- Solves multiple choice, exact answer, and drag-and-drop matching questions
- Floating panel with Start / Stop / Solve Once controls
- API key input built into the panel — no need to edit the script
- OCR fallback for image-based questions using [ocr.space](https://ocr.space)
- Works across SPA navigation (no reload needed between questions)
- Panel survives React re-renders and persists across page changes

---

## Requirements

- [Tampermonkey](https://www.tampermonkey.net/) browser extension
- A free [Groq API key](https://console.groq.com) (takes 2 minutes to get)

---

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser
2. Click **Create new script** in the Tampermonkey dashboard
3. Paste the contents of `century-lite.js` and save
4. Navigate to [app.century.tech](https://app.century.tech) — the panel will appear in the top-right corner

---

## Getting a Groq API Key

Groq is free and requires no payment details.

1. Go to [console.groq.com](https://console.groq.com) and sign up
2. Click **API Keys** in the left menu
3. Click **Create API Key**, give it any name
4. Copy the key (it starts with `gsk_`)
5. Paste it into the panel on Century Tech and click **Save**

The key is stored locally in Tampermonkey storage and never leaves your browser except to make requests to Groq.

---

## Usage

| Button | Action |
|---|---|
| **Start** | Continuously solves questions as you progress |
| **Stop** | Pauses the solver |
| **Solve Once** | Solves only the current question |

For exact-answer and letter-choice questions, the answer appears in a hint overlay at the bottom of the screen. Copy it and type it in manually.

---

## Notes

- The script reads question text from the DOM — it cannot see images directly. For image-heavy questions it falls back to OCR.
- Drag-and-drop matching uses colour coding to show which item belongs in which slot. (This is buggy at the moment, I am working on a fix.)

---

## License

MIT
