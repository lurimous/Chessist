# Instant Move Feature

## Overview
Added a toggleable "Instant Move" option for the auto-move feature. When enabled, moves are executed immediately without any delay. When disabled, moves execute with a random delay between the configured min and max values.

## Changes Made

### 1. UI Changes (popup.html)
- Added a new "Instant Move" toggle checkbox under the Auto Move settings
- This appears as a sub-toggle with indentation to show it's part of auto-move settings
- Added ID `delaySettings` to the delay controls container for conditional styling

### 2. Styling (popup.css)
- Added `.sub-toggle` class for the indented checkbox
- Added `.disabled` class for the delay settings that makes them appear grayed out when instant move is enabled
- Delay inputs become non-interactive when instant move is on

### 3. Settings Logic (popup.js)
- Added `instantMoveToggle` element reference
- Added `instantMove` to the settings loaded from storage
- Added event listener for the instant move toggle
- Created `updateDelaySettingsVisibility()` function that:
  - Adds/removes the `disabled` class on delay settings
  - Makes delay inputs non-interactive when instant move is enabled
- Instant move setting is persisted to Chrome storage
- Content scripts are notified when the setting changes

### 4. Auto-Move Logic (content.js)
- Added `instantMove` variable (default: false)
- Added `instantMove` to settings loading
- Modified the auto-move execution logic to check `instantMove`:
  - **If instant move is ON**: Execute move immediately with `executeMove(moveToPlay)`
  - **If instant move is OFF**: Use existing random delay logic with setTimeout
- Added message handler to update `instantMove` when changed via popup

## How It Works

### User Experience
1. Enable "Auto Move" toggle
2. Auto-move settings panel appears
3. Toggle "Instant Move" ON:
   - Moves execute immediately when evaluation completes
   - Delay inputs become grayed out and non-interactive
4. Toggle "Instant Move" OFF:
   - Moves execute with random delay between min/max values
   - Delay inputs become active again

### Technical Flow
```javascript
// When evaluation completes and auto-move is enabled:
if (instantMove) {
  // Execute immediately
  log('Chessist: Instant auto-move for', moveToPlay);
  executeMove(moveToPlay);
} else {
  // Execute with random delay
  const randomDelay = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
  log('Chessist: Auto-move triggered for', moveToPlay, 'with delay', randomDelay, 'ms');
  
  setTimeout(() => {
    // Verify position hasn't changed during delay
    if (nowPosition !== expectedPosition) {
      log('Chessist: Aborting auto-move - position changed during delay');
      return;
    }
    executeMove(moveToPlay);
  }, randomDelay);
}
```

## Settings Storage
The instant move setting is stored in Chrome sync storage with the key `instantMove` (boolean).

## Default Behavior
- Default: `instantMove = false` (uses random delay)
- This maintains backward compatibility with existing behavior

## Benefits
1. **Speed**: Users who want maximum speed can get instant moves
2. **Stealth**: Users who want more human-like play can use delays
3. **Flexibility**: Easy to toggle on/off as needed
4. **UI Clarity**: Delay settings are clearly disabled when instant move is on

## Files Modified
- `src/popup/popup.html` - Added instant move toggle UI
- `src/popup/popup.css` - Added sub-toggle and disabled state styling  
- `src/popup/popup.js` - Added instant move logic and handlers
- `src/content/content.js` - Modified auto-move execution to respect instant move setting
