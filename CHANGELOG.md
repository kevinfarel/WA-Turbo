# Changelog

User-visible changes to WA Turbo. The format follows [Keep a Changelog](https://keepachangelog.com) and the project uses [semantic versioning](https://semver.org). Add entries under **Unreleased** as changes are merged into `development`.

## [Unreleased]

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

[Unreleased]: https://github.com/kevinfarel/WA-Turbo/compare/v0.2.0...development
[0.2.0]: https://github.com/kevinfarel/WA-Turbo/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kevinfarel/WA-Turbo/releases/tag/v0.1.0
