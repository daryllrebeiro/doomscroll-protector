# Mindful Scroll – Smart Doomscroll Interrupter

A Manifest V3 Chrome extension that notices when scrolling stops being intentional on
Twitter/X, Reddit, YouTube (feed & Shorts) and Instagram, and interrupts with a small,
dismissible nudge. It is a nudging system, not a blocker: nothing is ever hard-blocked.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this repository folder

## How the detection works

The content script measures *active* scrolling: a scroll event only records a timestamp,
and a 1s interval decides whether the last scroll was recent enough (≤2s) to count as
continuous. The accumulator resets on a click, keypress, form submit, tab hide, or URL
change, so reading and interacting never counts toward the threshold.

When the accumulated time crosses the threshold (default 120s) and no quiet period is
active, an overlay appears in a shadow root at the bottom of the page with three choices:

| Action | Effect |
| --- | --- |
| Continue | Dismiss; quiet for the cooldown (default 3 min) |
| Take a break | Blur the feed for 60s, then quiet for the cooldown |
| Remind me later | Quiet for the snooze period (default 5 min) |

Ignoring the overlay for 30s counts as ignored and applies the cooldown.

**Strict mode** shortens the threshold (×0.6) and the quiet periods (×0.5).
**Adaptive threshold** shortens the threshold further (0.85 per ignored nudge, floored at
×0.5) on days where nudges keep getting ignored.

## Structure

```
manifest.json
src/
  background/service_worker.js   aggregates stats, owns storage, serves popup/options
  content/contentScript.js       scroll detection, overlay, break mode
  content/overlay.css            overlay styling (loaded inside the shadow root)
  popup/                         today's dashboard
  options/                       settings page
  shared/constants.js            settings defaults, site list, message types, helpers
  shared/ui.css                  shared popup/options styling
tools/make_icons.py              regenerates assets/icon*.png
```

`src/shared/constants.js` is a classic script so the same file can be used by the content
script, the popup, the options page, and `importScripts()` in the service worker.

## Storage

`chrome.storage.local` holds `settings` and `stats`. Stats are bucketed by local date
(`YYYY-MM-DD`), which gives the daily reset for free; buckets older than 14 days are pruned
on write. Per-tab session state (start time, scroll seconds, interruptions) lives in memory
in the service worker and is dropped when the tab closes.

## Permissions

`storage`, `activeTab`, `scripting`, plus host permissions for the four supported sites only.
