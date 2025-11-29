# PageBlock

A web extension to block URLs based on configurable regex filters with time-based scheduling.

## Features

- **Regex-based URL filtering**: Block URLs using powerful regular expression patterns
- **Time-based scheduling**: Create groups with specific days and hours when blocking should be active
- **Default 24/7 group**: Filters can be set to always block or assigned to custom schedules
- **Enable/disable filters**: Easily toggle individual filters on and off
- **Instant blocking**: Pages are blocked immediately with a clear blocked page notification
- **Easy management**: Clean, intuitive options page to configure all settings

## Installation

### From Source

1. Clone this repository
2. Install dependencies: `npm install`
3. Build the extension: `npm run build`
4. Load the `dist` folder as an unpacked extension in your browser:
   - **Chrome/Edge**: Go to `chrome://extensions/`, enable "Developer mode", click "Load unpacked", and select the `dist` folder
   - **Firefox**: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and select the `manifest.json` file in the `dist` folder

## Usage

1. Click the extension icon or go to the extension's options page
2. Create filter groups with custom schedules (or use the default 24/7 group)
3. Add filters with regex patterns to match URLs you want to block
4. Enable/disable filters as needed
5. Browse the web - matching URLs will be blocked instantly

### Example Filters

- Block Facebook: `.*facebook\.com.*`
- Block YouTube: `.*youtube\.com.*`
- Block social media: `.*(facebook|twitter|instagram)\.com.*`
- Block specific path: `.*example\.com/blocked-page.*`

## Development

- `npm run build` - Build the extension for production
- `npm run watch` - Watch for changes and rebuild automatically

## License

MIT - See [LICENSE](LICENSE) file for details
