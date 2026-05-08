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

In VS Code, use **Debug Chrome for Testing Extension** to build the extension, install
Chrome for Testing through the local npm package, and launch the unpacked extension.

## 🙏 Credits

- esbuild — MIT
- ESLint (@eslint/js, eslint) — MIT
- Prettier — MIT
- @puppeteer/browsers — Apache-2.0
- TypeScript — Apache-2.0
- typescript-eslint — MIT
- tsx — MIT
- Vitest — MIT
- rimraf — ISC
- @types/chrome, @types/node — MIT
- Shield icons created by Freepik - Flaticon
