# Release runbook

## Cutting a build

1. Bump the version in **both** `package.json` and `manifest.json` (the manifest
   check fails if they drift).
2. `npm run verify` and `npm run package` locally.
3. Merge to `main`, then tag: `git tag v1.2.0 && git push origin v1.2.0`.
4. The Release workflow re-runs `verify`, asserts the tag matches the manifest
   version, packages, and attaches `dist/mindful-scroll-<version>.zip` to a
   GitHub release.

Build the store zip on Linux (CI does). Windows `Compress-Archive` writes zip
entries with backslash separators, which some tooling dislikes; the CI artifact
is the one to upload.

## Uploading to the Chrome Web Store

1. Download the zip from the GitHub release (or the CI artifact).
2. Chrome Web Store developer dashboard → the item → **Package** → upload it.
3. Copy the listing text, privacy answers and permission justifications from
   `docs/STORE_LISTING.md`; the privacy policy URL points at `docs/PRIVACY.md`.
4. Attach screenshots (see the assets checklist in `docs/STORE_LISTING.md`).
5. Submit. Review typically takes a few days and is outside our control.

## Manual smoke test before submitting

Load the repo root unpacked at `chrome://extensions` and confirm:

- No manifest or service-worker errors on the extensions page.
- Popup opens, shows today's numbers, the seven-day trend and per-site rows.
- Settings save, and survive a reload of the options page.
- On a supported feed with the threshold set to 1 minute: the overlay appears
  after roughly a minute of continuous scrolling, and does not appear while
  typing a reply or in fullscreen video.
- **Continue** dismisses and stays quiet for the cooldown; **Remind me later**
  and `Esc` snooze; **Take a break** blurs the feed and counts down.
- Reloading during a break resumes the break rather than escaping it.
- Export downloads JSON; **Delete all data** empties it.
- Focus lands on a button when the overlay opens, `Tab` stays inside it, and
  focus returns to the page afterwards.
