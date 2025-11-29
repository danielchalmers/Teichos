# PageBlock Quick Start Guide

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the extension:**
   ```bash
   npm run build
   ```

3. **Load in browser:**
   - Open Edge
   - Navigate to `edge://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `dist` folder in this project

## Basic Usage

### Adding Your First Filter

1. Right-click the PageBlock icon and select "Options"
2. Under "Filters" section, click "+ Add Filter"
3. Enter a regex pattern (e.g., `.*facebook\.com.*`)
4. Add an optional description (e.g., "Block Facebook")
5. Select a group (use "24/7 (Always Active)" for permanent blocking)
6. Make sure "Enabled" is checked
7. Click "Save Filter"

### Creating Time-Based Groups

1. In the Options page, under "Groups" section, click "+ Add Group"
2. Enter a name (e.g., "Work Hours")
3. Uncheck "Always Active (24/7)"
4. Click "+ Add Schedule"
5. Select days of the week (e.g., Mon-Fri)
6. Set start and end times (e.g., 09:00 to 17:00)
7. Add more schedules if needed
8. Click "Save Group"

Now you can assign filters to this group, and they'll only be active during the specified times!

## Regex Pattern Examples

### Simple Patterns
- `.*example\.com.*` - Blocks any URL containing "example.com"
- `.*facebook\.com.*` - Blocks Facebook
- `.*youtube\.com.*` - Blocks YouTube

### Multiple Sites
- `.*(facebook|twitter|instagram)\.com.*` - Blocks multiple social media sites
- `.*(news|cnn|bbc)\.com.*` - Blocks news sites

### Specific Paths
- `.*youtube\.com/watch.*` - Blocks YouTube videos only
- `.*reddit\.com/r/.*` - Blocks Reddit subreddits
- `.*amazon\.com/.*buy.*` - Blocks Amazon purchase pages

### Advanced Patterns
- `^https?://.*\.facebook\.com.*` - Only blocks Facebook main domain
- `.*\.(facebook|fb)\.com.*` - Blocks both facebook.com and fb.com
- `.*/videos?/.*` - Blocks any path containing "video" or "videos"

## Tips & Tricks

### Testing Patterns
- Use a regex tester (like regex101.com) to validate your patterns before adding them
- Remember to escape special characters like `.` with `\`
- Use `.*` to match any characters

### Managing Filters
- Disable filters temporarily instead of deleting them
- Use descriptive names to easily identify filters
- Group related filters together (e.g., "Social Media", "Shopping")

### Time Schedules
- You can have multiple schedules per group
- Overlapping schedules are OK
- If you want weekend-only blocking, create a schedule with only Sat/Sun selected

### Troubleshooting
- If a site isn't being blocked, check:
  1. Is the filter enabled? (toggle should be green)
  2. Is it assigned to the correct group?
  3. If using a time-based group, is the current time within the schedule?
  4. Is the regex pattern correct? (test it with the actual URL)

## Common Use Cases

### Focus Mode (Block Distractions)
Create a "Focus Hours" group (e.g., 9 AM - 5 PM, Mon-Fri) and add:
- Social media: `.*(facebook|twitter|instagram|tiktok)\.com.*`
- Video sites: `.*(youtube|vimeo|twitch)\.com.*`
- News: `.*(news|cnn|bbc)\.com.*`

### Study Time
Create a "Study Time" group with your study hours and block:
- Gaming: `.*(steam|epicgames|twitch)\.com.*`
- Entertainment: `.*(netflix|hulu|disney)\.com.*`
- Social media: `.*(facebook|twitter|instagram)\.com.*`

### Bedtime Routine
Create an "Evening Wind-Down" group (e.g., 9 PM - 11 PM) and block:
- Stimulating content: `.*(news|reddit|twitter)\.com.*`
- Shopping: `.*(amazon|ebay)\.com.*`
- Work sites: `.*(slack|teams|zoom)\.com.*`

### Parental Controls
Use the 24/7 group for permanent blocks:
- Adult content: (add appropriate patterns)
- Gambling sites: `.*(bet|casino|gambling)\.com.*`
- Social media for young children: `.*(facebook|instagram|snapchat)\.com.*`

## Development

### Watch Mode
For development, use watch mode to automatically rebuild on changes:
```bash
npm run watch
```

After making changes, reload the extension in `edge://extensions/`

### Verification
Run the verification script to check the build:
```bash
./verify.sh
```

## Support

For issues or feature requests, please open an issue on GitHub.

## License

MIT License - See LICENSE file for details.
