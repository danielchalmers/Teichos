# PageBlock Implementation Summary

## Overview
PageBlock is a TypeScript-based web extension (Manifest V3) that allows users to block URLs based on configurable regex patterns with time-based scheduling support.

## Key Features Implemented

### 1. URL Blocking System
- **Regex-based pattern matching**: Each filter uses regex to match URLs
- **Instant blocking**: URLs are blocked immediately upon navigation
- **Informative blocked page**: Users see a clean page explaining why the URL was blocked

### 2. Filter Management
- Add unlimited filters with regex patterns
- Each filter can have an optional description
- Enable/disable filters individually with toggle switches
- Assign filters to specific groups for time-based control
- Regex validation prevents invalid patterns from being saved

### 3. Time-Based Scheduling
- **Default 24/7 Group**: Always-active group for permanent blocking
- **Custom Groups**: Create groups with specific schedules
- **Day Selection**: Choose which days of the week the filter should be active (Sun-Sat)
- **Time Ranges**: Set start and end times (HH:MM format) for each schedule
- **Multiple Schedules**: Each group can have multiple time ranges

### 4. User Interface
- **Options Page**: Clean, modern interface for managing filters and groups
  - View all groups and their filter counts
  - Add/Edit/Delete filters
  - Add/Edit/Delete groups (except default 24/7)
  - Toggle filters on/off with visual switches
- **Blocked Page**: Beautiful gradient background with clear messaging
  - Shows the blocked URL
  - "Go Back" button to return to previous page
  - "Manage Filters" button to open options

## Technical Architecture

### Files Structure
```
src/
├── types.ts          # TypeScript interfaces and utility functions
├── storage.ts        # Browser storage API wrapper functions
├── background.ts     # Service worker for URL interception
├── options.ts        # Options page logic
├── options.html      # Options page UI
├── blocked.ts        # Blocked page logic
├── blocked.html      # Blocked page UI
└── manifest.json     # Extension manifest (V3)
```

### Data Model

#### Filter
```typescript
{
  id: string;           // Unique identifier
  pattern: string;      // Regex pattern
  groupId: string;      // Associated group ID
  enabled: boolean;     // On/off toggle
  description?: string; // Optional description
}
```

#### FilterGroup
```typescript
{
  id: string;                // Unique identifier
  name: string;              // Display name
  schedules: TimeSchedule[]; // Array of time schedules
  is24x7: boolean;           // Always active flag
}
```

#### TimeSchedule
```typescript
{
  daysOfWeek: number[];  // 0-6 (Sunday-Saturday)
  startTime: string;     // HH:MM format
  endTime: string;       // HH:MM format
}
```

### Blocking Logic

1. **Tab Navigation Monitoring**: 
   - Listens to `chrome.tabs.onUpdated` for tab changes
   - Listens to `chrome.webNavigation.onBeforeNavigate` for navigation events

2. **URL Evaluation**:
   - Loads all filters and groups from storage
   - For each filter:
     - Check if filter is enabled
     - Check if filter's group schedule is currently active
     - Test URL against filter's regex pattern
   - If any filter matches, redirect to blocked page

3. **Schedule Evaluation**:
   - 24/7 groups are always active
   - Custom groups check current day of week and time
   - Returns true if current time falls within any schedule

## Build System

- **TypeScript**: Strong typing and modern JavaScript features
- **Webpack**: Bundles TypeScript into browser-compatible JavaScript
- **Build Command**: `npm run build`
- **Watch Mode**: `npm run watch` for development

## Storage

- Uses browser's `storage.sync` API
- Data syncs across devices when user is signed in
- Single storage key: `pageblock_data`
- Stores both groups and filters in one object

## Browser Compatibility

- Microsoft Edge: Full support (Manifest V3)

## Example Use Cases

1. **Social Media Blocking**: Block Facebook, Twitter, Instagram during work hours
   - Pattern: `.*(facebook|twitter|instagram)\.com.*`
   - Group: "Work Hours" (9 AM - 5 PM, Mon-Fri)

2. **Video Site Blocking**: Block YouTube during study time
   - Pattern: `.*youtube\.com.*`
   - Group: "Study Time" (custom schedule)

3. **Shopping Site Blocking**: Block shopping sites to avoid distractions
   - Pattern: `.*(amazon|ebay|shopping)\.com.*`
   - Group: 24/7 or custom schedule

4. **News Site Limiting**: Block news sites during focus time
   - Pattern: `.*(news|cnn|bbc)\.com.*`
   - Group: Custom focus hours

## Installation Instructions

1. Build the extension: `npm run build`
2. Open Edge and navigate to `edge://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist` folder
6. Extension is now active!

## Testing

The extension has been verified to:
- ✅ Build successfully with no TypeScript errors
- ✅ Include all required manifest permissions
- ✅ Have proper file structure
- ✅ Display clean UI for options and blocked pages
- ✅ Handle regex validation
- ✅ Support time-based scheduling logic

## Future Enhancements (Not Implemented)

Potential features for future versions:
- Import/Export filter configurations
- Statistics and blocking history
- Whitelist support (allow certain URLs even if they match)
- Password protection for filter management
- Notification system
- Browser action popup for quick filter toggle
