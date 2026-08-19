# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Type checking via `tsc --noEmit --allowJs --checkJs` with JSDoc annotations
- Pre-commit hooks (husky + lint-staged) running ESLint and Prettier
- `eslint-plugin-no-unsanitized` to catch XSS via `innerHTML`
- `CHANGELOG.md` for release tracking

### Changed

- `npm run verify` now includes type checking
- Replaced `innerHTML` usage in popup with safe DOM APIs

## [1.2.0] - 2026-08-19

### Added

- Keyboard shortcuts: toggle extension, open settings, quick snooze
- Import/export settings and statistics as JSON
- Usage analytics: peak usage times, personalized insights, weekly summary
- Time-based scheduling to auto-enable during specific hours
- Trend indicators in the popup dashboard

### Fixed

- Lint errors in test files

## [1.1.0] - 2026-08-19

### Added

- Capture-phase, container-aware scroll detection for inner scroll containers
- Per-site adapters for Twitter/X, Reddit, YouTube, and Instagram
- Virtual feed support for YouTube Shorts and Instagram Reels
- Runtime state persistence in `chrome.storage.session`
- Schema versioning and storage migrations
- Batched storage writes (≤2/min) via `chrome.alarms`
- Keyboard-accessible overlay with focus trap and Esc handling
- Suppression rules for fullscreen video, typing, and dialogs
- Frequency capping for nudges
- Persisted break mode that survives page reloads
- Internationalisation with `_locales/en/messages.json`
- Unit tests for detector, constants, and migrations
- ESLint, Prettier, manifest check, and CI pipeline
- Privacy policy, store listing, and release runbook

## [1.0.0] - 2026-08-19

### Added

- Initial MVP: doomscroll detection on Twitter/X, Reddit, YouTube, and Instagram
- Overlay with three actions: Continue, Take a break, Remind me later
- Popup dashboard with today's stats and 7-day trend
- Options page with configurable thresholds and per-site toggles
- Strict mode and adaptive threshold
