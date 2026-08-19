# Privacy Policy — Mindful Scroll

_Last updated: 2026-08-19_

Mindful Scroll is a Chrome extension that notices long stretches of continuous
scrolling on a small set of feed sites and shows a gentle nudge.

## The short version

Mindful Scroll collects nothing. No account, no analytics, no telemetry, no
network requests. Everything it measures stays in your browser profile and never
leaves your device.

## What is stored, and where

All data lives in Chrome's local extension storage on your own machine:

| Data                                                            | Storage                  | Retention                          |
| --------------------------------------------------------------- | ------------------------ | ---------------------------------- |
| Your settings (threshold, snooze, cooldown, per-site toggles)   | `chrome.storage.local`   | Until you change or delete them    |
| Daily counters: seconds scrolled, nudges shown, buttons pressed | `chrome.storage.local`   | 14 days, then pruned automatically |
| Per-tab cooldown, snooze and break timers                       | `chrome.storage.session` | Cleared when Chrome closes         |

The daily counters are aggregate numbers per site per day, for example
"reddit: 412 seconds on 2026-08-19". Mindful Scroll never records URLs, page
content, post text, search queries, keystrokes, or anything you type.

## What is never collected

- No browsing history or URLs.
- No page content, DOM snapshots, or screenshots.
- No personal or identifying information.
- No cookies, credentials, or form data.
- No data sent to any server — the extension makes no network requests at all,
  and has no remote code.

## Permissions and why they exist

| Permission                                                                                | Why                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `storage`                                                                                 | Save your settings and the local daily counters shown in the popup.                                                      |
| `alarms`                                                                                  | Wake the service worker about once a minute to write buffered counters, so the extension does not write on every scroll. |
| Host access to `twitter.com`, `x.com`, `*.reddit.com`, `*.youtube.com`, `*.instagram.com` | Run the scroll detector and draw the overlay on exactly those feeds. No other site is touched.                           |

`activeTab` and `scripting` are deliberately **not** requested.

## Your controls

- **Export data** (Settings) downloads everything the extension holds as JSON.
- **Reset statistics** (Settings) clears the counters.
- **Delete all data** (Settings) removes settings and statistics.
- Uninstalling the extension removes all of its storage.

## Contact

Questions or a privacy concern: open an issue at
https://github.com/daryllrebeiro/doomscroll-protector/issues
