# How to Publish Mindful Scroll to Chrome Web Store

This guide walks you through building and publishing the Mindful Scroll extension to the Chrome Web Store.

## Prerequisites

- Chrome Developer Account ($5 one-time fee)
- Git repository access
- Node.js and npm installed
- Chrome browser for testing

## Step 1: Pre-Publishing Checklist

### Code Quality

- [ ] Run `npm run verify` - all checks must pass
- [ ] Run `npm run test` - all 83 tests must pass
- [ ] Manual testing on all supported sites (Twitter/X, Reddit, YouTube, Instagram)
- [ ] Test keyboard shortcuts (Ctrl+Shift+M/S/Z)
- [ ] Verify settings import/export functionality
- [ ] Test time-based scheduling

### Documentation

- [ ] Update version in `package.json` and `manifest.json` (must match)
- [ ] Update `CHANGELOG.md` with release notes
- [ ] Review privacy policy in `docs/PRIVACY.md`
- [ ] Review store listing copy in `docs/STORE_LISTING.md`

### Assets

- [ ] 128×128 store icon (use `assets/icon128.png`)
- [ ] 1280×800 screenshots (at least 1, max 5):
  - Overlay appearing on a feed
  - Break mode in action
  - Popup dashboard with stats
  - Settings page
  - Weekly summary/insights
- [ ] 440×280 small promo tile

## Step 2: Build the Extension

```bash
# Install dependencies (if not already done)
npm install

# Run all verification checks
npm run verify

# Package the extension
npm run package
```

This creates `dist/mindful-scroll-<version>.zip` ready for upload.

## Step 3: Create Git Tag

```bash
# Stage all changes
git add .

# Commit changes
git commit -m "Release v1.2.0 - [Your release notes]"

# Create and push tag
git tag v1.2.0
git push origin main
git push origin v1.2.0
```

The GitHub Actions workflow will automatically:

- Run all verification checks
- Validate tag matches manifest version
- Package the extension
- Create a GitHub release with the zip attached

## Step 4: Chrome Web Store Submission

### 4.1 Developer Dashboard Setup

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with your developer account
3. Click **+ Add new item**

### 4.2 Upload Extension

1. **Upload Package**

   - Download the zip from the GitHub release (or CI artifact)
   - Or use the locally created `dist/mindful-scroll-<version>.zip`
   - Upload to the dashboard

2. **Store Listing**

   - Copy the item details from `docs/STORE_LISTING.md`:
     - Name: "Mindful Scroll – Smart Doomscroll Interrupter"
     - Short description: "Detects endless scrolling on addictive sites and gently interrupts with a mindful nudge. Not a blocker."
     - Detailed description: Use the full description from STORE_LISTING.md
     - Category: Workflow & Planning
     - Language: English

3. **Privacy**

   - Privacy policy URL: `https://github.com/daryllrebeiro/doomscroll-protector/blob/main/docs/PRIVACY.md`
   - Use the permission justifications from STORE_LISTING.md

4. **Images**

   - Upload your 128×128 icon
   - Upload 1280×800 screenshots (1-5 required)
   - Upload 440×280 small promo tile

5. **Permissions**
   - The manifest already includes minimal permissions:
     - `storage` - for settings and stats
     - `alarms` - for background tasks
     - `commands` - for keyboard shortcuts
     - `notifications` - for shortcut confirmations
   - Host permissions for the four supported sites only

### 4.3 Store Review

- Click **Submit for review**
- Review typically takes 1-5 business days
- You'll receive email notifications about the review status

## Step 5: Post-Submission

### Monitor Review

- Check your email for review feedback
- Address any reviewer comments promptly
- Common issues: permissions justification, privacy policy clarity, asset quality

### Initial Rollout

- Start with **Trusted Tester** track (if available)
- Monitor crash reports and user feedback
- Gradually increase rollout: 20% → 50% → 100%

### User Support

- Monitor GitHub issues for bug reports
- Be responsive to Chrome Web Store reviews
- Consider adding FAQ in store listing for common questions

## Troubleshooting

### Build Issues

```bash
# If npm run verify fails
npm run lint          # check for linting errors
npm run format:check  # check for formatting issues
npm run check:manifest # validate manifest
npm run test          # run unit tests
```

### Upload Issues

- Ensure zip file is created on Linux (CI does this)
- Windows `Compress-Archive` may create incompatible paths
- Use the GitHub release artifact if local upload fails

### Store Review Rejections

- **Permissions**: Ensure all permissions are justified in STORE_LISTING.md
- **Privacy**: Verify privacy policy URL is accessible
- **Assets**: Check screenshot resolution and quality
- **Description**: Ensure no marketing claims that can't be proven

## Version Bumping

For new releases:

1. Update version in both `package.json` and `manifest.json`
2. Update `CHANGELOG.md`
3. Run full verification: `npm run verify`
4. Create git tag: `git tag v1.3.0`
5. Push tag: `git push origin v1.3.0`
6. GitHub Actions automatically creates release with new zip

## Automated Deployment

The repository includes GitHub Actions workflows for CI/CD:

- **CI**: Runs on every push to main (lint, format, manifest, tests, package)
- **Release**: Triggers on git tags (verifies version match, packages, creates GitHub release)

To use automated deployment to Chrome Web Store (optional):

1. Set up Chrome Web Store API credentials
2. Add `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` as GitHub secrets
3. Modify release workflow to call Chrome Web Store API

## Emergency Rollback

If critical issues are discovered after release:

1. **Unpublish**: Remove from Chrome Web Store immediately
2. **Fix**: Create hotfix with incremented version
3. **Test**: Thoroughly test the fix
4. **Republish**: Submit new version with detailed changelog
5. **Communicate**: Inform users about the issue and fix

## Support Resources

- [Chrome Web Store Developer Documentation](https://developer.chrome.com/docs/webstore)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [GitHub Issues](https://github.com/daryllrebeiro/doomscroll-protector/issues)

## Quick Reference

```bash
# Development workflow
npm install              # Install dependencies
npm run verify          # Full verification
npm run test            # Unit tests only
npm run package         # Build store zip

# Release workflow
git add .
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z

# Manual testing
# Load unpacked at chrome://extensions
# Test on all supported sites
# Verify keyboard shortcuts
# Check insights and weekly summary
```

For the most up-to-date information, always refer to the main [README.md](README.md) and [docs/RELEASE.md](docs/RELEASE.md).
