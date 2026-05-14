# 🛡️ Teichos: Page Blocker

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jgioiclbfmdjhonplpifidmmbadbadfa)](https://chromewebstore.google.com/detail/teichos-page-blocker/jgioiclbfmdjhonplpifidmmbadbadfa)
[![Privacy Policy](https://img.shields.io/badge/privacy-policy-blue.svg)](PRIVACY_POLICY.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Build Status](https://github.com/danielchalmers/Teichos/actions/workflows/ci.yml/badge.svg)](https://github.com/danielchalmers/Teichos/actions/workflows/ci.yml)

Block distracting websites with smart scheduling and filters.

## 📖 Usage

### Adding Filters

1. Right-click the Teichos icon → **Options**
2. Click **New Filter**
3. Enter a URL pattern (simple text or regex)
4. Choose a group (or use **24/7 Always Active**)
5. Save and browse — matching URLs are blocked!

### Creating Schedule Groups

Want to block sites only during work hours? Create a custom group:

1. Click **New Group**
2. Name it (e.g., "Work Hours")
3. Uncheck **Always Active**
4. Click **New Schedule** to add days and times
5. Assign filters to your new group

## 💻 Development

This project now builds with [Plasmo](https://www.plasmo.com/) on top of the existing TypeScript, Vitest, and Playwright workflow.

- `npm run dev` starts the Plasmo dev server.
- `npm run build` creates the production extension bundle in `build/chrome-mv3-prod`.
- `npm run build:dev` creates the unpacked development bundle in `build/chrome-mv3-dev`.
- `npm run package` creates the production zip at `build/chrome-mv3-prod.zip`.

In VS Code, use **Debug Playwright Chromium Extension** to build the development bundle, install Playwright's bundled Chromium, and launch the unpacked extension from `build/chrome-mv3-dev`.

Run `npm run test:e2e` after `npm run build` to exercise the built extension in Playwright Chromium.

## 🙏 Credits

- Plasmo — MIT
- React, React DOM — MIT
- ESLint (@eslint/js, eslint) — MIT
- Playwright (@playwright/test) — Apache-2.0
- Prettier — MIT
- TypeScript — Apache-2.0
- typescript-eslint — MIT
- Vitest — MIT
- rimraf — ISC
- @types/chrome, @types/node, @types/react, @types/react-dom — MIT
- Shield icons created by Freepik - Flaticon
