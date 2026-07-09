# <img src="public/assets/icons/icon.svg" width="32" height="32" align="absmiddle" alt="" /> Teichos: Page Blocker

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jgioiclbfmdjhonplpifidmmbadbadfa)](https://chromewebstore.google.com/detail/teichos-page-blocker/jgioiclbfmdjhonplpifidmmbadbadfa)
[![Privacy Policy](https://img.shields.io/badge/privacy-policy-blue.svg)](PRIVACY_POLICY.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Build Status](https://github.com/danielchalmers/Teichos/actions/workflows/ci.yml/badge.svg)](https://github.com/danielchalmers/Teichos/actions/workflows/ci.yml)

Teichos is a free, open-source website blocker for Chrome and other Chromium browsers. Block distracting sites all the time, or only during the hours that matter to you, like work, study, or sleep. No account, no tracking, no data leaves your browser.

<img width="1280" height="720" alt="Teichos hero image" src="https://github.com/user-attachments/assets/c65b4a38-cfb7-431d-b461-211dd9dcbe7f" />

## Features

- **Scheduled groups.** Sort filters into groups and give each one a schedule. Block social media during work hours, everything at bedtime, or a site around the clock.
- **Flexible filters.** Match a whole domain with plain text, or use an exact URL or regular expression. Name each filter so your list stays readable.
- **Exceptions.** Keep the pages you still need, like a specific playlist on an otherwise blocked YouTube.
- **Temporary blocks.** One-off blocks that expire on their own, right from the popup.
- **Snooze.** Pause all filtering for a set time when you genuinely need a break.
- **A calm block page.** See which filter caught the page, and continue anyway when you really mean to. It's a speed bump, not a brick wall.
- **Private & synced.** Settings sync through your browser profile. There's no account, no analytics, and no third-party servers ([privacy policy](PRIVACY_POLICY.md)).

## Get Teichos

**Chrome, Edge, Brave, and other Chromium browsers:**

1. Install [Teichos: Page Blocker from the Chrome Web Store](https://chromewebstore.google.com/detail/teichos-page-blocker/jgioiclbfmdjhonplpifidmmbadbadfa). On Edge or Brave, allow extensions from the Chrome Web Store when prompted.
2. Pin the Teichos icon to your toolbar for quick access to temporary blocks and snooze.
3. Right-click the icon and choose **Options** to set up your filters and schedules.

**Build from source:**

```sh
git clone https://github.com/danielchalmers/Teichos.git
cd Teichos
npm install
npm run build
```

Then load the unpacked extension: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `.output/chrome-mv3`.

## Quick start

1. Open **Options** and click **New Filter**.
2. Enter a URL pattern. Typing `reddit` is enough to block the whole site.
3. Pick a group: **Always Active** blocks it 24/7, or create a group like "Work Hours" with its own days and times.
4. Browse as usual. Matching pages are blocked before they load.
