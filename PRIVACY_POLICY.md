# Privacy Policy

Teichos does not collect, transmit, or sell personal data.

## Permissions

This extension requests only the permissions required to block pages based on your filters.

- `storage` — Save filters, groups, schedules, and whitelist entries in `chrome.storage.sync`.
- `alarms` — Schedule snooze expiration so filtering can automatically resume at the time you set.
- `tabs` — Read the active tab URL during navigation and redirect the tab to the blocked page when a match occurs.
- `webNavigation` — Detect navigations as early as possible to block matching pages before they fully load.
- Host permissions (`<all_urls>`) — Required to evaluate and block any URL you choose to configure. This is the core purpose of the extension.

## Data We Store

The extension stores your configuration locally using Chrome's extension storage:

- Filter rules and groups
- Schedules
- Whitelist entries
- Related settings

This data is saved in `chrome.storage.sync` to allow your settings to follow your signed-in browser profile. The data is not sent to any third-party servers by this extension.

## Data We Access

To block pages, the extension evaluates the URLs you navigate to against your filters. URL checks happen locally in the extension and are not transmitted off your device.

## Data We Share

We do not share data with third parties.

## Contact

If you have questions about this policy, please open an issue in this repository.
