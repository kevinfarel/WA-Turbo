# Changelog

User-visible changes to WA Turbo. The format follows [Keep a Changelog](https://keepachangelog.com) and the project uses [semantic versioning](https://semver.org). Add entries under **Unreleased** as changes are merged into `development`.

## [Unreleased]

### Added
- More ways to connect an AI, in Settings → AI connection, grouped as subscription, free and pay per use.
  - **Local model:** WA Turbo finds Ollama on the computer and the models installed there (Qwen, Gemma and others), shows them on the card, and picks the best one by itself; summaries then run privately and offline. Nothing is bundled or downloaded by WA Turbo; when no model is found, the box explains how to install Ollama and pull one.
  - **Gemini free key** from Google AI Studio, with a step-by-step guide and an Open Google AI Studio button in the app, after accepting a warning that Google may use the messages on the free tier.
  - **Other (OpenAI-compatible):** Groq, OpenRouter, OpenAI or any compatible address, with your own model name and key.
  - **ChatGPT (Codex)** and **Google (Antigravity)**, marked Experimental: they run the vendor's own CLI signed in on the computer (read-only, in an empty folder). Not yet tried on a real sign-in; Copy diagnostics gives testers a report with no message text. Antigravity is text only.
- Tag people in group chats: type **@** in the composer to pick a member (arrow keys and Enter or Tab, or click), and they get a real WhatsApp tag. Tags in messages now show the person's name instead of a number, in the chat, in notifications and in what the AI reads.
- Paste a photo straight into the composer (a screenshot, a copied image or an image file) to attach it, with no need for the paperclip. Copied text or spreadsheet cells still paste as text.
- On the free AIs, auto summary runs at most 10 chats in any 10 minutes, and on Gemini and Antigravity it also stops for the day after a daily budget (100 runs by default, Settings → Auto summary), so the free quota keeps room for your own Summarize clicks. When a provider says its quota is used up, auto summary waits until it resets.

### Changed
- Wording says "AI" instead of "Claude" wherever it isn't about Claude itself: "AI usage", "AI not connected", "Let the AI see photos", and so on, in English and Bahasa Indonesia.
- Settings → Model shows the Claude model only for the Claude connections; the other connections pick their model in their own box.

## [0.3.0] - 2026-10-31

### Added
- Windows 10/11 (x64) build: one-click installer with no admin prompt and the same built-in PostgreSQL (127.0.0.1 only, password-protected, data in %LOCALAPPDATA%). Windows notification sounds, a flashing taskbar button and unread badge, and a tray icon that reopens the window and quits. Title bar buttons follow the theme, and the wording says "this PC" in English and Indonesian.
- Contacts: import your phone's contacts as a .vcf file (iPhone, Android, Google, iCloud). Chats and group members show the names you saved. When a number has more than one name, a dialog asks which one to keep. Removing the import puts the WhatsApp names back.
- Summary language per linked number, English or Bahasa Indonesia. Claude writes summaries, SUM UP! cards and report overviews in it. A new number gets its language picked once from its 10 most recent conversations (one small Claude Haiku call) once Claude is connected, and you can change it in Settings → Summary language.
- App language: English or Bahasa Indonesia for the whole window, notifications and the menu bar. Chat content and Claude's output are never translated.
- Themes: WA Turbo Light and Dark, WhatsApp Light and Dark, Dark Modern, Dark+ and Monokai. You pick one light and one dark theme; a sun/moon button in the title bar switches between them, or they follow macOS.

### Changed
- Direct chats show your contact name (imported, else the one saved on your phone) before the WhatsApp profile name, as the phone does.
- Settings has a gear icon instead of the sun-like one.
- A cached summary is reused only in the language it was written in.

## [0.2.0] - 2026-10-31

### Added
- Built-in PostgreSQL 18: nothing to install. The app creates its database on first launch and starts and stops it with the app; a force-quit leaves it running for the next launch to pick up.
- Settings → Database: version, size and folder, plus an optional switch that lets database tools (DBeaver, TablePlus) connect on 127.0.0.1 with a password.
- A "database didn't start" screen with the lines from the database log that explain why.

### Changed
- The app connects to its database over a private socket instead of TCP port 5432.
- Starts fresh: data from a separately installed Postgres is not moved over.

### Removed
- The connection-string screen and the saved database URL. `WA_TURBO_DATABASE_URL` remains for development and tests.
- The design mockup and the scripts that used it, from the repository.

## [0.1.0] - 2026-10-31

First macOS release, using a separately installed PostgreSQL (Docker or Postgres.app).

### Added
- Several WhatsApp numbers in one window, each linked as its own device.
- Claude summaries and multi-chat reports, through the Claude Code login (Claude plan) or an Anthropic API key. Default model Claude Haiku 5.5.
- SUM UP! (beta): open questions and promises found by local rules and Claude, with response-time clocks, chases and team-aware direction.
- Pinned chats with automatic summaries; open-loop checks on other chats.
- Sending text and photos, editing your own messages (15 min) and deleting for everyone (48 h), only by your own action.
- Photos shown in full, saved to the Mac, and the most recent ones given to Claude (can be switched off).
- Notifications by tier, menu bar count of pinned chats waiting on you, per-chat mute.
- My team for group chats, and Claude usage per number.

[Unreleased]: https://github.com/kevinfarel/WA-Turbo/compare/v0.3.0...development
[0.3.0]: https://github.com/kevinfarel/WA-Turbo/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kevinfarel/WA-Turbo/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kevinfarel/WA-Turbo/releases/tag/v0.1.0
