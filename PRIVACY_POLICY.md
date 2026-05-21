# Privacy Policy

Teichos does not collect, transmit, or sell personal data.

## Permissions

This extension requests only the permissions required to block pages based on your filters.

- `storage` — Save filters, groups, schedules, and whitelist entries in `chrome.storage.sync`.
- `alarms` — Schedule snooze expiration so filtering can automatically resume at the time you set.
- `tabs` — Read active and open tab URLs where Chrome exposes them, redirect blocked tabs, restore the last allowed URL, and focus or reuse the options tab.
- `webNavigation` — Detect navigations as early as possible to block matching pages before they fully load.

## Data We Store

The extension stores your configuration locally using Chrome's extension storage:

- Filter rules and groups
- Schedules
- Whitelist entries
- Related settings

This data is saved in `chrome.storage.sync` to allow your settings to follow your signed-in browser profile. The data is not sent to any third-party servers by this extension.

## Data We Access

To block pages, the extension evaluates navigation event URLs and tab URLs exposed by the retained Chrome permissions against your filters. These checks happen locally in the extension and are not transmitted off your device.

## Data We Share

We do not share data with third parties.

## Contact

If you have questions about this policy, please open an issue in this repository.
