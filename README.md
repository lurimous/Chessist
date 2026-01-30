# Chessist

A Chromium extension that adds a live evaluation bar to Chess.com games, powered by Stockfish.

## Features

- Real-time position evaluation displayed as a vertical bar
- Score shown in pawns format (e.g., +1.5)
- Works on live games, spectating, analysis, and archived games
- Optional best move display
- Configurable engine depth
- Runs entirely in your browser (no server required)

## Setup

### 1. Download Stockfish WASM

The extension needs the Stockfish WASM files to run the chess engine. Download them:

1. Go to https://github.com/nickstern2002/nickstern2002.github.io/tree/master/lib
   or https://github.com/nickstern2002/nickstern2002.github.io
2. Download `stockfish.js` and `stockfish.wasm`
3. Place both files in `src/engine/` (replacing the placeholder stockfish.js)

Alternative: Use the official Stockfish.js build from https://github.com/nickstern2002/nickstern2002.github.io

### 2. Load the Extension in Brave

1. Open Brave and go to `brave://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `Chessist` folder
5. The extension icon should appear in your toolbar

### 3. Test It

1. Go to https://www.chess.com
2. Open any game (live, analysis, or archived)
3. You should see an evaluation bar on the left side of the board

## Configuration

Click the extension icon to:
- Toggle the extension on/off
- See current evaluation

Click "Settings" for:
- Show/hide best move suggestion
- Adjust engine analysis depth (10-24)

## Project Structure

```
chess-live-eval/
├── manifest.json           # Extension configuration
├── src/
│   ├── content/            # Injected into Chess.com pages
│   │   ├── content.js      # Board detection & eval bar
│   │   └── content.css     # Eval bar styling
│   ├── background/
│   │   └── service-worker.js
│   ├── engine/
│   │   ├── stockfish.js    # Stockfish WASM (download required)
│   │   └── stockfish.wasm  # Stockfish binary (download required)
│   ├── offscreen/          # Runs Stockfish engine
│   │   ├── offscreen.html
│   │   └── offscreen.js
│   ├── popup/              # Extension popup
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── options/            # Settings page
│       ├── options.html
│       ├── options.js
│       └── options.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Using Native Stockfish (Faster)

For faster analysis, you can use a locally installed Stockfish instead of the built-in WASM version.

### Requirements
- Python 3 installed and in PATH
- Stockfish installed on your system

### Setup

1. **Install Stockfish**
   - Download from https://stockfishchess.org/download/
   - Extract to `C:\stockfish\` or add to PATH

2. **Run the installer**
   ```
   cd native-host
   install.bat
   ```
   This registers the native messaging host with Chrome/Brave.

3. **Select Native in extension**
   - Click the extension icon
   - Change "Engine" dropdown to "Native (Local)"
   - Status should show "Connected: [path to stockfish]"

### Benefits of Native
- **Multi-threaded**: Uses all CPU cores
- **More memory**: Larger hash tables
- **Higher depth**: Can analyze deeper (depth 30+)
- **Faster**: 10-100x faster than WASM

## Troubleshooting

**Eval bar doesn't appear:**
- Make sure you're on chess.com (not another chess site)
- Try refreshing the page
- Check that the extension is enabled

**"Stockfish not found" or evaluation not working:**
- Make sure you downloaded the Stockfish WASM files
- Check that `stockfish.js` and `stockfish.wasm` are in `src/engine/`

**Extension not loading:**
- Check for errors in `brave://extensions`
- Look at the service worker console for errors

## License

MIT
