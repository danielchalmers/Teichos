# 🛡️ Teichos: Page Blocker

Block distracting websites with powerful regex patterns and smart scheduling.

## ✨ Features

- 🔍 **Regex Matching** — Block URLs with flexible pattern matching
- ⏰ **Smart Scheduling** — Set active hours for each filter group
- 🔄 **Easy Toggles** — Enable/disable filters instantly
- 🚫 **Instant Blocking** — Pages blocked immediately on navigation

## 🚀 Quick Start

```bash
npm install
npm run build
```

Load in Edge:
1. Go to `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist` folder

## 📖 Usage

### Adding Filters

1. Right-click the Teichos icon → **Options**
2. Click **+ Add Filter**
3. Enter a regex pattern and optional description
4. Choose a group (or use **24/7 Always Active**)
5. Save and browse — matching URLs are blocked!

### Creating Schedule Groups

Want to block sites only during work hours? Create a custom group:

1. Click **+ Add Group**
2. Name it (e.g., "Work Hours")
3. Uncheck **Always Active**
4. Add schedules with days and times
5. Assign filters to your new group

## 🎯 Pattern Examples

| Goal | Pattern |
|------|---------|
| Block Facebook | `.*facebook\.com.*` |
| Block YouTube videos | `.*youtube\.com/watch.*` |
| Block social media | `.*(facebook\|twitter\|instagram)\.com.*` |
| Block news sites | `.*(cnn\|bbc\|news)\.com.*` |

> 💡 **Tip:** Test patterns at [regex101.com](https://regex101.com) before adding them.

## 🎓 Use Cases

**🖥️ Focus Mode** — Block social media and videos during work hours (9-5, Mon-Fri)

**📚 Study Time** — Block gaming and streaming sites during your study schedule

**🌙 Bedtime** — Wind down by blocking stimulating content in the evening

## 🛠️ Development

```bash
npm run watch    # Auto-rebuild on changes
./verify.sh      # Verify build output
```

## 📄 License

[MIT](LICENSE)
