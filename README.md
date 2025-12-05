# 🛡️ Teichos: Page Blocker

Block distracting websites with powerful regex patterns and smart scheduling.

## ✨ Features

- 🔍 **Regex Matching** — Block URLs with flexible pattern matching
- ⏰ **Smart Scheduling** — Set active hours for each filter group
- 🔄 **Easy Toggles** — Enable/disable filters instantly
- 🚫 **Instant Blocking** — Pages blocked immediately on navigation
- ✅ **Whitelist Support** — Allow specific URLs even when filters match

## 🚀 Quick Start

```bash
npm install
npm run build
```

Load in Chrome/Edge:
1. Go to `chrome://extensions/` or `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist` folder

## 📖 Usage

### Adding Filters

1. Right-click the Teichos icon → **Options**
2. Click **+ Add Filter**
3. Enter a URL pattern (simple text or regex)
4. Choose a group (or use **24/7 Always Active**)
5. Save and browse — matching URLs are blocked!

### Creating Schedule Groups

Want to block sites only during work hours? Create a custom group:

1. Click **+ Add Group**
2. Name it (e.g., "Work Hours")
3. Uncheck **Always Active**
4. Add schedules with days and times
5. Assign filters to your new group

### Whitelist Entries

Need to allow specific URLs even when they match a filter?

1. Click **+ Add Whitelist Entry**
2. Enter a URL pattern
3. URLs matching whitelist patterns are never blocked

## 🎯 Pattern Examples

| Goal                 | Pattern                                   | Type   |
| -------------------- | ----------------------------------------- | ------ |
| Block Facebook       | `facebook.com`                            | Simple |
| Block YouTube videos | `youtube.com/watch`                       | Simple |
| Block with regex     | `.*facebook\.com.*`                       | Regex  |
| Block social media   | `.*(facebook\|twitter\|instagram)\.com.*` | Regex  |

> 💡 **Tip:** Test regex patterns at [regex101.com](https://regex101.com) before adding them.

## 🎓 Use Cases

**🖥️ Focus Mode** — Block social media and videos during work hours (9-5, Mon-Fri)

**📚 Study Time** — Block gaming and streaming sites during your study schedule

**🌙 Bedtime** — Wind down by blocking stimulating content in the evening

## 🛠️ Development

```bash
npm run dev         # Watch mode with auto-rebuild
npm run build       # Production build
npm run test        # Run tests
npm run lint        # Run ESLint
npm run typecheck   # Run TypeScript type checking
```

### Project Structure

```
src/
├── background/      # Service worker
│   ├── index.ts     # Entry point
│   └── handlers/    # Event handlers
├── popup/           # Popup UI
│   ├── index.ts
│   ├── index.html
│   └── styles/
├── options/         # Options page
│   ├── index.ts
│   ├── index.html
│   └── styles/
├── blocked/         # Blocked page
│   ├── index.ts
│   ├── index.html
│   └── styles/
├── shared/          # Shared code
│   ├── types/       # TypeScript types
│   ├── api/         # Chrome API wrappers
│   └── utils/       # Utilities
└── assets/          # Static assets
    └── icons/
```

## 📄 License

[MIT](LICENSE)

