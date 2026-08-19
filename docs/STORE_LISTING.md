# Chrome Web Store listing

Copy for the developer dashboard. Keep this file and `manifest.json` /
`_locales/en/messages.json` in sync — the store shows the manifest name and
description, not this file.

## Item details

**Name** (45 char limit): `Mindful Scroll – Smart Doomscroll Interrupter`

**Short description** (132 char limit):

> Detects endless scrolling on addictive sites and gently interrupts with a mindful nudge. Not a blocker.

**Category:** Workflow & Planning
**Language:** English

## Detailed description

> Mindful Scroll notices when scrolling has stopped being a choice, and asks one
> quiet question: "You've been scrolling for a while. Still intentional?"
>
> It is not a blocker. Nothing is hidden, no site is banned, no timer locks you
> out. You get a small card with three honest options — continue, take a short
> break, or be reminded later — and then it gets out of the way.
>
> HOW IT WORKS
> • Watches only for continuous scrolling on X/Twitter, Reddit, YouTube and Instagram.
> • Understands feeds that do not move the page: YouTube Shorts and Instagram Reels count too.
> • Any real interaction — clicking a post, typing, navigating — resets the timer, because that is engagement, not drift.
> • Stays silent while you are typing a reply, watching fullscreen video, or in a dialog.
> • Hard frequency cap: never more than a few nudges an hour, never two within a minute.
>
> WHAT YOU CAN TUNE
> • Threshold from 1 to 10 minutes of continuous scrolling.
> • Snooze, cooldown and break length.
> • Which sites are active.
> • Strict mode (interrupts sooner) and an adaptive threshold that nudges earlier on days you keep ignoring it.
>
> WHAT IT SHOWS YOU
> The toolbar popup has today's scrolling time, how many nudges appeared, how
> many you ignored, a seven-day trend, and a per-site breakdown.
>
> PRIVACY
> No accounts, no analytics, no network requests, no remote code. The extension
> stores per-day counters and your settings on your own machine and nothing
> else — no URLs, no page content, nothing you type. Export or delete everything
> from the settings page at any time.

## Privacy tab answers

**Single purpose:** Detect prolonged continuous scrolling on a small set of
social feed sites and show an in-page reminder that lets the user continue,
pause, or snooze.

**Permission justifications:**

- `storage` — Persists user settings and per-day aggregate counters (seconds
  scrolled, nudges shown, actions taken) that the popup displays. No browsing
  data is stored.
- `alarms` — Wakes the MV3 service worker roughly once a minute to flush
  buffered counters to storage. Without it, counters would either be lost when
  the worker is suspended or written far too frequently.
- `commands` — Enables keyboard shortcuts for quick access to extension features
  (toggle on/off, open settings, quick snooze). Improves user convenience.
- `notifications` — Shows brief confirmation messages when keyboard shortcuts
  are used (e.g., "Mindful Scroll paused", "Snoozed for 5 minutes"). No personal
  data is transmitted.
- **Host permissions** (`twitter.com`, `x.com`, `*.reddit.com`, `*.youtube.com`,
  `*.instagram.com`) — The scroll detector and the overlay run as content
  scripts on exactly these feeds. The extension requests no other host.
- **Remote code:** No. All code ships in the package.

**Data usage disclosures:** none of the categories apply. Nothing is collected
or transmitted; the extension makes no network requests. Certify:

- Not being sold to third parties.
- Not used or transferred for purposes unrelated to the item's single purpose.
- Not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:**
https://github.com/daryllrebeiro/doomscroll-protector/blob/main/docs/PRIVACY.md

## Assets still needed before submission

These require a running browser and cannot be generated from source:

- 1280×800 (or 640×400) screenshots, 1–5 of them: the overlay on a real feed,
  the break panel, the popup dashboard, the settings page.
- 440×280 small promo tile.
- 128×128 store icon — `assets/icon128.png` already satisfies this.
