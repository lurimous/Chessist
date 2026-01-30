<p align="center">
  <img src="icons/icon128.png" alt="Chessist Logo" width="128" height="128">
</p>

<h1 align="center">Chessist</h1>

<p align="center">
  A Chromium extension that adds a live evaluation bar to Chess.com games, powered by Stockfish.
  <br>
  <strong>Created by <a href="https://github.com/lurimous/">lurimous</a></strong>
</p>

<p align="center">
  <a href="https://github.com/lurimous/Chessist">GitHub</a> •
  <a href="https://discord.gg/2WgHtrgqZm">Discord</a>
</p>

---

## Features

- Real-time position evaluation displayed as a vertical bar
- Score shown in pawns format (e.g., +1.5)
- Works on live games, spectating, analysis, and archived games
- Optional best move display with arrow overlay
- Auto-move functionality
- Configurable engine depth (up to 50)
- Native Stockfish support for faster analysis
- Runs entirely in your browser (no server required)

## Quick Start

### 1. Download the Extension

Download or clone this repository:
```
git clone https://github.com/lurimous/Chessist.git
```

### 2. Load the Extension

**For Chrome/Brave/Edge:**

1. Open your browser and go to `chrome://extensions` (or `brave://extensions` / `edge://extensions`)
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `Chessist` folder
5. The extension icon should appear in your toolbar

### 3. Play Chess!

1. Go to https://www.chess.com
2. Open any game (live, analysis, or archived)
3. You should see an evaluation bar on the left side of the board

That's it! The built-in WASM engine works out of the box.

## Configuration

Click the extension icon to:
- Toggle the extension on/off
- See current evaluation
- Show/hide best move suggestion
- Enable auto-move
- Adjust engine analysis depth (10-50)
- Select playing color (Auto/White/Black)
- Switch between WASM and Native engine

## Using Native Stockfish (Recommended)

For much faster analysis (10-100x), you can use a locally installed Stockfish.

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
   Enter your extension ID when prompted (shown in the extension popup).

3. **Select Native in extension**
   - Click the extension icon
   - Click "Native" under Engine
   - Status should show "Connected: [path to stockfish]"

### Benefits of Native
- **Multi-threaded**: Uses all CPU cores
- **More memory**: Larger hash tables
- **Higher depth**: Can analyze deeper (depth 50+)
- **Faster**: 10-100x faster than WASM

## Project Structure

```
Chessist/
├── manifest.json           # Extension configuration
├── src/
│   ├── content/            # Injected into Chess.com pages
│   │   ├── content.js      # Board detection & eval bar
│   │   └── content.css     # Eval bar styling
│   ├── background/
│   │   └── service-worker.js
│   ├── engine/
│   │   ├── stockfish.js    # Stockfish WASM (included)
│   │   └── stockfish.wasm  # Stockfish binary (included)
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
├── native-host/            # Native Stockfish integration
│   ├── install.bat
│   ├── stockfish_host.py
│   └── manifest.json.template
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Troubleshooting

**Eval bar doesn't appear:**
- Make sure you're on chess.com (not another chess site)
- Try refreshing the page
- Check that the extension is enabled

**Extension not loading:**
- Check for errors in `chrome://extensions`
- Look at the service worker console for errors

**"Extension context invalidated" error:**
- This happens after playing many games when Chrome restarts the service worker
- Simply refresh the Chess.com page to restore functionality

**Native engine not connecting:**
- Run `install.bat` again with the correct extension ID
- Make sure Python 3 is installed and in PATH
- Check that Stockfish is installed and accessible

## Credits

- Created by [lurimous](https://github.com/lurimous/)
- Powered by [Stockfish](https://stockfishchess.org/)
- WASM build from [lichess-org/stockfish.js](https://github.com/lichess-org/stockfish.js)

## License

MIT
