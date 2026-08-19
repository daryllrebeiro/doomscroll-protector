# Mindful Scroll – Smart Doomscroll Interrupter

A Manifest V3 Chrome extension that notices when scrolling stops being intentional on
Twitter/X, Reddit, YouTube (feed & Shorts) and Instagram, and interrupts with a small,
dismissible nudge. It is a nudging system, not a blocker: nothing is ever hard-blocked.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this repository folder

## How the detection works

The content script measures _active_ scrolling: an activity event only records a timestamp,
and a 1s interval decides whether the last one was recent enough (≤2s) to count as
continuous. The accumulator resets on a click, keypress, form submit, tab hide, or URL
change, so reading and interacting never counts toward the threshold.

Scroll is captured on `document` in the capture phase, so inner scroll containers (new
Reddit, YouTube) count too. On virtualized feeds where `scrollTop` never changes — YouTube
Shorts, Instagram Reels — wheel, touch and advance keys count as activity instead.

All of the heuristic lives in `src/content/detector.js`, a pure state machine with an
injectable clock, so the timing rules are unit-tested rather than observed by scrolling for
two minutes. Per-site DOM quirks (what counts as a feed, when a nudge must be suppressed)
live in `src/content/sites/*.js`.

When the accumulated time crosses the threshold (default 120s) and no quiet period is
active, an overlay appears in a shadow root at the bottom of the page with three choices:

| Action          | Effect                                             |
| --------------- | -------------------------------------------------- |
| Continue        | Dismiss; quiet for the cooldown (default 3 min)    |
| Take a break    | Blur the feed for 60s, then quiet for the cooldown |
| Remind me later | Quiet for the snooze period (default 5 min)        |

Ignoring the overlay for 30s counts as ignored and applies the cooldown. Nudges are capped
(default 4/hour, ≥60s apart) and are suppressed — not dropped — while a video is
fullscreen, a dialog is open, or the user is typing: the accumulated time is held and the
nudge appears at the next reasonable moment.

**Strict mode** shortens the threshold (×0.6) and the quiet periods (×0.5).
**Adaptive threshold** shortens the threshold further (0.85 per ignored nudge, floored at
×0.5) on days where nudges keep getting ignored.

## Structure

```
manifest.json
src/
  background/service_worker.js   aggregates stats, owns storage, serves popup/options
  content/contentScript.js       DOM events, overlay, break mode
  content/detector.js            pure detection state machine (unit-tested)
  content/sites/*.js             per-site feed/suppression adapters
  content/overlay.css            overlay styling (loaded inside the shadow root)
  popup/                         today's dashboard + 7-day trend
  options/                       settings page, data export/delete
  shared/constants.js            settings defaults, site list, message types, helpers
  shared/i18n.js                 applies _locales strings to popup/options markup
  shared/migrations.js           storage schema migrations
  shared/ui.css                  shared popup/options styling
_locales/en/messages.json        UI strings
docs/                            production plan, privacy policy, store listing, release runbook
tests/                           Vitest unit tests
tools/check-manifest.mjs         manifest sanity check
tools/package.mjs                builds dist/mindful-scroll-<version>.zip
tools/make_icons.py              regenerates assets/icon*.png
```

`src/shared/constants.js` is a classic script so the same file can be used by the content
script, the popup, the options page, and `importScripts()` in the service worker.

## Storage

`chrome.storage.local` holds `settings` and `stats`, both versioned by `schemaVersion` and
upgraded through `src/shared/migrations.js`. Stats are bucketed by local date
(`YYYY-MM-DD`), which gives the daily reset for free; buckets older than 14 days are pruned
on write. Scroll time is reported with the date it accrued on, so a session that crosses
midnight is split across both days.

Writes are batched: content scripts flush at most once a minute, and the service worker
merges the deltas on a `chrome.alarms` tick, keeping well inside Chrome's write quota with
several feed tabs open.

Per-tab runtime state (cooldown, break, nudge history, session counters) lives in
`chrome.storage.session` via the service worker, so a reload or a suspended service worker
does not reset a cooldown or cancel a break. Nothing leaves the device; the options page can
export everything as JSON or delete it all.

## Localisation

User-visible strings live in `_locales/en/messages.json`. Markup carries the English
text inline plus a `data-i18n` key, and code calls `t(key, englishFallback, subs)`, so a
missing catalogue degrades to English instead of blank UI. `npm run check:manifest`
fails on any `__MSG_*__`, `data-i18n` or `t('…')` key that the catalogue does not define.
To add a language, copy `_locales/en/messages.json` to `_locales/<code>/messages.json`
and translate the `message` values.

## Permissions

`storage`, `alarms`, `commands`, and `notifications`, plus host permissions for the four supported sites only.
Justifications for the store review are in [docs/STORE_LISTING.md](docs/STORE_LISTING.md);
the privacy policy is [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

```bash
npm install
npm run verify   # lint + format check + manifest check + unit tests
npm run package  # dist/mindful-scroll-<version>.zip for the Web Store
```

Releasing is tag-driven — see [docs/RELEASE.md](docs/RELEASE.md).
