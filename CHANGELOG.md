# Changelog

## v1.0.2

### Added
- **Live accuracy display** on the eval bar — shows your running average accuracy as a colored icon + percentage (green/yellow/red based on performance)
- **Accuracy persistence** — accuracy is saved to local storage per game ID and restored on page refresh mid-game
- **Move classification icons** on the board — best, excellent, good, inaccuracy, mistake, blunder icons drawn at the destination square after each move
- **Show Move Icon** toggle in popup settings
- **Auto-move** via `chrome.scripting.executeScript({ world: 'MAIN' })` — runs in page context with trusted events for reliable move submission
- **Smart timing** for auto-move — adjusts delay based on move complexity, eval magnitude, and captures
- **Target Accuracy** setting — intentionally play at a lower accuracy percentage
- **W/L Balance** — automatically throws a game after winning too many in a row, then wins the next
- **Match Player ELO** — Stockfish plays at your detected Chess.com rating; supports manual override
- **Auto Rematch / Auto New Game** after game ends
- **Stealth Mode** — suppresses all console logs
- **Best move arrow** drawn as SVG overlay on the board
- **Native Stockfish engine** support via native messaging host (much faster than WASM)
- **PV cache** — instant eval response when opponent plays the expected move
- **Position cache** — revisited positions return instantly from cache

### Fixed
- Auto-move `movePending` deadlock that blocked every move after the first in bot games
- Move icon appearing on the wrong square (FROM instead of TO)
- CSP blocking inline script injection — removed `tryPageContextMove` in favour of service worker scripting
- `moveIconEl is not defined` error after cleanup of old eval bar elements
- Accuracy eval never triggering because opponent's position wasn't being evaluated
- Eval bar glitching on game load due to `board.game.move()` mutating the DOM silently

---

## v1.0.1

### Added
- Instant move mode
- Countdown timer shown on eval bar during delayed auto-move
- Depth indicator on eval bar
- Turn indicator (debug)
- Auto-detection of player color from board SVG rank orientation

### Fixed
- Various eval bar positioning issues on Chess.com layout changes
- Shadow DOM piece lookup for `wc-chess-board`

---

## v1.0.0 — Initial Release

- Live evaluation bar injected into Chess.com
- WASM Stockfish engine (built-in, no install required)
- Best move display on eval bar
- Skill level slider
- Analysis depth control
- Auto-move with configurable min/max delay
- Playing As color override (Auto / White / Black)
- Native engine support with install script
