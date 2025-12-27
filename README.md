# 🛡️ Teichos: Page Blocker

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jgioiclbfmdjhonplpifidmmbadbadfa)](https://chromewebstore.google.com/detail/teichos-page-blocker/jgioiclbfmdjhonplpifidmmbadbadfa)
[![Privacy Policy](https://img.shields.io/badge/privacy-policy-blue.svg)](PRIVACY_POLICY.md)
[![Build Status](https://github.com/danielchalmers/Teichos/actions/workflows/ci.yml/badge.svg)](https://github.com/danielchalmers/Teichos/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/danielchalmers/Teichos)](https://github.com/danielchalmers/Teichos/releases/latest)

Block distracting websites with powerful regex patterns and smart scheduling.

## ✨ Features

🔍 **Regex Matching** — Block URLs with flexible pattern matching  
⏰ **Smart Scheduling** — Set active hours for each filter group  
🔄 **Easy Toggles** — Enable/disable filters instantly  
🚫 **Instant Blocking** — Pages blocked immediately on navigation  
✅ **Exception Support** — Allow specific URLs even when filters match

## 🎓 Use Cases

🖥️ **Focus Mode** — Block social media and videos during work hours (9-5, Mon-Fri)  
📚 **Study Time** — Block gaming and streaming sites during your study schedule  
🌙 **Bedtime** — Wind down by blocking stimulating content in the evening

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

### Exception Entries

Need to allow specific URLs even when they match a filter?

1. Click **New Exception**
2. Enter a URL pattern
3. URLs matching exception patterns are never blocked

## 🎯 Pattern Examples

| Goal                 | Pattern                                   | Type   |
| -------------------- | ----------------------------------------- | ------ |
| Block Facebook       | `facebook.com`                            | Simple |
| Block YouTube videos | `youtube.com/watch`                       | Simple |
| Block with regex     | `.*facebook\.com.*`                       | Regex  |
| Block social media   | `.*(facebook\|twitter\|instagram)\.com.*` | Regex  |

> 💡 **Tip:** Test regex patterns at [regex101.com](https://regex101.com) before adding them.

## 🙏 Credits

- esbuild — MIT
- ESLint (@eslint/js, eslint) — MIT
- Prettier — MIT
- TypeScript — Apache-2.0
- typescript-eslint — MIT
- tsx — MIT
- Vitest — MIT
- rimraf — ISC
- @types/chrome, @types/node — MIT
- Shield icons created by Freepik - Flaticon
