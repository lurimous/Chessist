// Chessist - Content Script
// Detects Chess.com board, extracts FEN, and displays evaluation bar

(function() {
  'use strict';

  let evalBar = null;
  let evalBarFill = null;
  let evalScore = null;
  let bestMoveEl = null;
  let depthEl = null;
  let turnIndicatorEl = null;  // Debug indicator for turn/player detection
  let currentFen = null;
  let currentTurn = 'w';  // Track whose turn it is
  let playerColor = null; // Track player's color (for perspective)
  let isEnabled = true;
  let showBestMove = false;
  let autoMove = false;
  let lastAutoMoveFen = null;  // Track FEN where we last auto-moved to avoid duplicate moves
  let manualPlayerColor = 'auto';  // 'auto', 'w', or 'b' - manual override for player color
  let boardObserver = null;
  let arrowOverlay = null;  // SVG overlay for best move arrow
  let currentBestMove = null;  // Track current best move to avoid redrawing

  let targetDepth = 18; // Default depth

  // Initialize settings from storage
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['enabled', 'showBestMove', 'autoMove', 'engineDepth', 'playerColor']);
      isEnabled = result.enabled !== false; // Default true
      showBestMove = result.showBestMove === true; // Default false
      autoMove = result.autoMove === true; // Default false
      targetDepth = result.engineDepth || 18;
      manualPlayerColor = result.playerColor || 'auto';
    } catch (e) {
      console.log('Chessist: Using default settings');
    }
  }

  // Piece mapping for FEN construction
  const pieceMap = {
    'wp': 'P', 'wn': 'N', 'wb': 'B', 'wr': 'R', 'wq': 'Q', 'wk': 'K',
    'bp': 'p', 'bn': 'n', 'bb': 'b', 'br': 'r', 'bq': 'q', 'bk': 'k'
  };

  // Convert square notation (e.g., "e2") to file/rank indices (0-7)
  function squareToIndices(square) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // a=0, h=7
    const rank = parseInt(square[1]) - 1; // 1=0, 8=7
    return { file, rank };
  }

  // Get coordinates for a square center in viewBox units (0-100)
  // Chess.com uses viewBox="0 0 100 100", so each square is 12.5 units
  function getSquareCenter(square, isFlipped) {
    const { file, rank } = squareToIndices(square);
    const squareSize = 12.5; // 100 / 8

    let x, y;
    if (isFlipped) {
      // Black's perspective: a1 is top-right, h8 is bottom-left
      x = (7 - file + 0.5) * squareSize;
      y = (rank + 0.5) * squareSize;
    } else {
      // White's perspective: a1 is bottom-left, h8 is top-right
      x = (file + 0.5) * squareSize;
      y = (7 - rank + 0.5) * squareSize;
    }

    return { x, y };
  }

  // Create SVG arrow overlay on the board
  // Uses viewBox="0 0 100 100" to match Chess.com's coordinate system
  function createArrowOverlay(board) {
    // Check if existing overlay is still valid (inside the board)
    if (arrowOverlay && arrowOverlay.parentElement === board) {
      return arrowOverlay;
    }

    // Remove any stale arrow overlays
    if (arrowOverlay) {
      arrowOverlay.remove();
      arrowOverlay = null;
    }

    // Also remove any old overlays that might be lingering
    document.querySelectorAll('.chess-live-eval-arrow-overlay').forEach(el => el.remove());

    // Create SVG element with viewBox matching Chess.com's system
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'chess-live-eval-arrow-overlay');
    svg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
    `;

    // Insert SVG directly into the wc-chess-board element
    board.appendChild(svg);
    arrowOverlay = svg;

    return svg;
  }

  // Draw best move arrow on the board
  function drawBestMoveArrow(move) {
    if (!move || move.length < 4) {
      clearArrow();
      return;
    }

    const board = findBoard();
    if (!board) return;

    // Check if board is flipped (black's perspective)
    const isFlipped = board.classList?.contains('flipped') ||
                      board.getAttribute('data-flipped') === 'true' ||
                      playerColor === 'b';

    // Parse move
    const fromSquare = move.substring(0, 2);
    const toSquare = move.substring(2, 4);

    // Get coordinates in viewBox units (0-100)
    const from = getSquareCenter(fromSquare, isFlipped);
    const to = getSquareCenter(toSquare, isFlipped);

    // Validate coordinates
    if (isNaN(from.x) || isNaN(from.y) || isNaN(to.x) || isNaN(to.y)) {
      console.log('Chessist: Invalid arrow coordinates, skipping');
      return;
    }

    // Create or get overlay
    const svg = createArrowOverlay(board);
    if (!svg) return;

    // Clear existing arrows
    const existingGroup = svg.querySelector('.best-move-arrow-group');
    if (existingGroup) {
      existingGroup.remove();
    }

    // Create a group for the arrow
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'best-move-arrow-group');

    // Calculate arrow geometry (in viewBox units where each square is 12.5)
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);

    // Arrow dimensions in viewBox units
    const strokeWidth = 2.2;
    const arrowHeadLength = 4;
    const arrowHeadWidth = 4;

    // Shorten the line to make room for arrowhead
    const lineEndX = to.x - Math.cos(angle) * arrowHeadLength * 0.6;
    const lineEndY = to.y - Math.sin(angle) * arrowHeadLength * 0.6;

    // Validate calculated values
    if (isNaN(lineEndX) || isNaN(lineEndY) || isNaN(angle)) {
      console.log('Chessist: Invalid arrow geometry, skipping');
      return;
    }

    // Create arrow line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x.toFixed(2));
    line.setAttribute('y1', from.y.toFixed(2));
    line.setAttribute('x2', lineEndX.toFixed(2));
    line.setAttribute('y2', lineEndY.toFixed(2));
    line.setAttribute('stroke', '#3b93e8');
    line.setAttribute('stroke-width', strokeWidth);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.85');

    // Create arrowhead as a polygon
    const headTipX = to.x;
    const headTipY = to.y;
    const headBaseX = to.x - Math.cos(angle) * arrowHeadLength;
    const headBaseY = to.y - Math.sin(angle) * arrowHeadLength;

    // Perpendicular offset for arrowhead width
    const perpX = Math.sin(angle) * arrowHeadWidth / 2;
    const perpY = -Math.cos(angle) * arrowHeadWidth / 2;

    // Validate arrowhead values
    if (isNaN(headTipX) || isNaN(headTipY) || isNaN(headBaseX) || isNaN(headBaseY) || isNaN(perpX) || isNaN(perpY)) {
      console.log('Chessist: Invalid arrowhead geometry, skipping');
      return;
    }

    const arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    arrowHead.setAttribute('points', `
      ${headTipX.toFixed(2)},${headTipY.toFixed(2)}
      ${(headBaseX + perpX).toFixed(2)},${(headBaseY + perpY).toFixed(2)}
      ${(headBaseX - perpX).toFixed(2)},${(headBaseY - perpY).toFixed(2)}
    `);
    arrowHead.setAttribute('fill', '#3b93e8');
    arrowHead.setAttribute('opacity', '0.85');

    group.appendChild(line);
    group.appendChild(arrowHead);
    svg.appendChild(group);
    currentBestMove = move;
  }

  // Clear the best move arrow
  function clearArrow() {
    if (arrowOverlay) {
      const existingGroup = arrowOverlay.querySelector('.best-move-arrow-group');
      if (existingGroup) {
        existingGroup.remove();
      }
    }
    currentBestMove = null;
  }

  // Execute a move on the board (auto-move feature)
  function executeMove(move) {
    if (!move || move.length < 4) return false;

    const board = findBoard();
    if (!board) return false;

    const fromSquare = move.substring(0, 2);
    const toSquare = move.substring(2, 4);
    const promotion = move.length > 4 ? move[4] : null;

    console.log(`Chessist: Auto-moving ${fromSquare} to ${toSquare}${promotion ? ' promoting to ' + promotion : ''}`);

    // Method 1: Try Chess.com's game API directly
    try {
      if (board.game && typeof board.game.move === 'function') {
        board.game.move(fromSquare, toSquare, promotion);
        return true;
      }
    } catch (e) {
      console.log('Chessist: Game API move failed:', e);
    }

    // Method 2: Simulate mouse events on squares
    const isFlipped = board.classList?.contains('flipped') || playerColor === 'b';
    return simulateMove(board, fromSquare, toSquare, isFlipped, promotion);
  }

  // Simulate a move by dispatching pointer/mouse events (drag and drop)
  function simulateMove(board, from, to, isFlipped, promotion) {
    // Find the piece on the from square
    const pieceEl = findPieceOnSquare(board, from);

    if (!pieceEl) {
      console.log('Chessist: Could not find piece on', from);
      return false;
    }

    // Get board rect for coordinate calculation
    const boardRect = board.getBoundingClientRect();
    const squareSize = boardRect.width / 8;

    // Calculate from coordinates (piece center)
    const pieceRect = pieceEl.getBoundingClientRect();
    const fromX = pieceRect.left + pieceRect.width / 2;
    const fromY = pieceRect.top + pieceRect.height / 2;

    // Calculate to coordinates based on square
    const { file: toFile, rank: toRank } = squareToIndices(to);
    let toX, toY;
    if (isFlipped) {
      toX = boardRect.left + (7 - toFile + 0.5) * squareSize;
      toY = boardRect.top + (toRank + 0.5) * squareSize;
    } else {
      toX = boardRect.left + (toFile + 0.5) * squareSize;
      toY = boardRect.top + (7 - toRank + 0.5) * squareSize;
    }

    console.log(`Chessist: Simulating drag from (${fromX.toFixed(0)}, ${fromY.toFixed(0)}) to (${toX.toFixed(0)}, ${toY.toFixed(0)})`);

    // Use pointer events (more reliable for modern web components)
    const pointerDownEvent = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: fromX,
      clientY: fromY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1
    });

    // Also create mouse events as fallback
    const mouseDownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: fromX,
      clientY: fromY,
      button: 0,
      buttons: 1
    });

    // Dispatch on piece element
    pieceEl.dispatchEvent(pointerDownEvent);
    pieceEl.dispatchEvent(mouseDownEvent);

    // Simulate drag with pointermove/mousemove
    setTimeout(() => {
      const pointerMoveEvent = new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: toX,
        clientY: toY,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 1
      });

      const mouseMoveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: toX,
        clientY: toY,
        button: 0,
        buttons: 1
      });

      document.dispatchEvent(pointerMoveEvent);
      document.dispatchEvent(mouseMoveEvent);

      // Release the piece
      setTimeout(() => {
        const pointerUpEvent = new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: toX,
          clientY: toY,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0
        });

        const mouseUpEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: toX,
          clientY: toY,
          button: 0
        });

        document.dispatchEvent(pointerUpEvent);
        document.dispatchEvent(mouseUpEvent);

        // Handle promotion if needed
        if (promotion) {
          setTimeout(() => {
            handlePromotion(promotion);
          }, 200);
        }
      }, 50);
    }, 50);

    return true;
  }

  // Find a piece element on a specific square
  function findPieceOnSquare(board, square) {
    const { file, rank } = squareToIndices(square);
    const squareNum = (file + 1) * 10 + (rank + 1);
    const squareClass = `square-${squareNum}`;

    // Look for piece with this square class
    let el = board.querySelector(`.piece.${squareClass}`);
    if (!el && board.shadowRoot) {
      el = board.shadowRoot.querySelector(`.piece.${squareClass}`);
    }

    return el;
  }

  // Handle pawn promotion selection
  function handlePromotion(piece) {
    // Chess.com shows a promotion dialog - try to click the right piece
    const promotionMap = {
      'q': 'queen',
      'r': 'rook',
      'b': 'bishop',
      'n': 'knight'
    };

    const pieceName = promotionMap[piece.toLowerCase()] || 'queen';

    // Try to find and click the promotion piece
    const promotionEl = document.querySelector(`.promotion-piece.${pieceName}, [data-piece="${pieceName}"], .promotion-${pieceName}`);
    if (promotionEl) {
      promotionEl.click();
    }
  }

  // Find the chess board element
  function findBoard() {
    // Try different selectors used by Chess.com
    const selectors = [
      'wc-chess-board',           // Web component board
      'chess-board',              // Older board
      '.board',                   // Generic board class
      '[class*="board-"]'         // Board with variant classes
    ];

    for (const selector of selectors) {
      const board = document.querySelector(selector);
      if (board) return board;
    }
    return null;
  }

  // Extract FEN from Chess.com board
  function extractFEN(board) {
    // Method 1: Try to get FEN from Chess.com's game controller
    try {
      // Chess.com stores game data in various places
      const gameTag = document.querySelector('chess-board, wc-chess-board');
      if (gameTag) {
        // Try game property
        if (gameTag.game?.getFEN) {
          return gameTag.game.getFEN();
        }
        if (gameTag.game?.fen) {
          return typeof gameTag.game.fen === 'function' ? gameTag.game.fen() : gameTag.game.fen;
        }
      }
    } catch (e) {}

    // Method 2: Check for data-fen attribute
    const gameElement = document.querySelector('[data-fen]');
    if (gameElement) {
      return gameElement.getAttribute('data-fen');
    }

    // Method 3: Try to find FEN in window objects (Chess.com exposes game state)
    try {
      // Look for game controller in common locations
      const gameController = window.chessboard?.game ||
                             document.querySelector('wc-chess-board')?.__vue__?.game ||
                             document.querySelector('.board')?.closest('[class*="game"]')?.__game;
      if (gameController?.getFEN) {
        return gameController.getFEN();
      }
    } catch (e) {}

    // Method 4: Parse pieces from DOM (fallback)
    return parsePiecesFromDOM(board);
  }

  // Parse piece positions from DOM elements
  function parsePiecesFromDOM(board) {
    // Try multiple selectors for pieces
    let pieces = board.querySelectorAll('.piece');

    // If using shadow DOM (wc-chess-board)
    if (!pieces.length && board.shadowRoot) {
      pieces = board.shadowRoot.querySelectorAll('.piece');
    }

    // Try getting pieces from the entire document if board query fails
    if (!pieces.length) {
      pieces = document.querySelectorAll('wc-chess-board .piece, chess-board .piece, .board .piece');
    }

    if (!pieces.length) return null;

    // Initialize empty board
    const boardArray = Array(8).fill(null).map(() => Array(8).fill(null));

    pieces.forEach(piece => {
      // Get piece type from class (e.g., 'piece wk square-51' or 'piece bb square-36')
      const classes = piece.className.split(' ');
      let pieceType = null;
      let square = null;

      for (const cls of classes) {
        // Check for piece type (2 chars: color + piece)
        if (cls.length === 2 && pieceMap[cls]) {
          pieceType = pieceMap[cls];
        }
        // Check for square position
        if (cls.startsWith('square-')) {
          square = cls.replace('square-', '');
        }
      }

      // Chess.com uses square-XY where X is file (1-8) and Y is rank (1-8)
      if (pieceType && square) {
        let file, rank;

        if (square.length === 2) {
          // Format: "51" means file 5, rank 1
          file = parseInt(square[0]) - 1; // 1-8 to 0-7
          rank = parseInt(square[1]) - 1; // 1-8 to 0-7
        } else if (square.length === 3) {
          // Format might be different, try parsing
          file = parseInt(square.substring(0, 1)) - 1;
          rank = parseInt(square.substring(1)) - 1;
        }

        if (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
          // Board array: index 0 = rank 8, index 7 = rank 1
          boardArray[7 - rank][file] = pieceType;
        }
      }
    });

    // Convert to FEN
    let fen = '';
    for (let rank = 0; rank < 8; rank++) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = boardArray[rank][file];
        if (piece) {
          if (empty > 0) {
            fen += empty;
            empty = 0;
          }
          fen += piece;
        } else {
          empty++;
        }
      }
      if (empty > 0) fen += empty;
      if (rank < 7) fen += '/';
    }

    // Determine whose turn from move indicators
    const turn = detectTurn();

    // Basic FEN with minimal info (position + turn)
    fen += ` ${turn} KQkq - 0 1`;

    return fen;
  }

  // Detect if we're in puzzle mode
  function isPuzzleMode() {
    // Check URL for puzzle indicators
    if (window.location.pathname.includes('/puzzles') ||
        window.location.pathname.includes('/puzzle')) {
      return true;
    }
    // Check for puzzle-specific elements
    if (document.querySelector('.puzzle-component, .puzzle-board, [class*="puzzle"]')) {
      return true;
    }
    // Check for puzzle header/title
    if (document.querySelector('.puzzle-title, .daily-puzzle, [class*="DailyPuzzle"]')) {
      return true;
    }
    return false;
  }

  // Detect player's color (which side they're playing)
  function detectPlayerColor() {
    // Manual override takes priority
    if (manualPlayerColor === 'w') {
      console.log('Chessist: Using manual player color: white');
      return 'w';
    }
    if (manualPlayerColor === 'b') {
      console.log('Chessist: Using manual player color: black');
      return 'b';
    }

    // In puzzle mode, the "player" is whoever's turn it is
    // This ensures arrow shows for the move you need to find
    if (isPuzzleMode()) {
      return currentTurn; // Return current turn as player color
    }

    const board = document.querySelector('wc-chess-board');

    // Method 1: Check if board is flipped - if flipped, player is black
    if (board?.classList.contains('flipped')) {
      console.log('Chessist: Detected black via flipped class');
      return 'b';
    }

    // Method 1b: Check board's flipped attribute or property
    if (board?.hasAttribute('flipped') || board?.flipped === true) {
      console.log('Chessist: Detected black via flipped attribute');
      return 'b';
    }

    // Method 1b2: Check Chess.com's coordinate SVG
    // In the SVG, if rank "1" has small y (near top) or file "a" has large x (near right), board is flipped
    if (board) {
      const coordSvg = board.querySelector('svg.coordinates') || board.shadowRoot?.querySelector('svg.coordinates');
      if (coordSvg) {
        const textElements = coordSvg.querySelectorAll('text');
        for (const text of textElements) {
          const content = text.textContent?.trim();
          const y = parseFloat(text.getAttribute('y'));
          const x = parseFloat(text.getAttribute('x'));

          // If rank "1" is near the top (y < 50 in viewBox 0-100), board is flipped
          if (content === '1' && y < 50) {
            console.log('Chessist: Detected black via SVG rank 1 at top (y=' + y + ')');
            return 'b';
          }
          // If rank "8" is near the top, board is normal (white's view)
          if (content === '8' && y < 50) {
            console.log('Chessist: Detected white via SVG rank 8 at top (y=' + y + ')');
            return 'w';
          }
          // If file "a" is on the right (x > 50), board is flipped
          if (content === 'a' && x > 50) {
            console.log('Chessist: Detected black via SVG file a on right (x=' + x + ')');
            return 'b';
          }
          // If file "a" is on the left, board is normal
          if (content === 'a' && x < 50) {
            console.log('Chessist: Detected white via SVG file a on left (x=' + x + ')');
            return 'w';
          }
        }
      }
    }

    // Method 1b3: Check for piece visual position - if white pieces are visually at top, board is flipped
    if (board) {
      const whiteKing = board.querySelector('.piece.wk') || board.shadowRoot?.querySelector('.piece.wk');
      if (whiteKing) {
        const kingRect = whiteKing.getBoundingClientRect();
        const boardRect = board.getBoundingClientRect();
        // If white king is in the top half of the board visually, player is black
        if (kingRect.top < boardRect.top + boardRect.height / 2) {
          console.log('Chessist: Detected black via white king position');
          return 'b';
        } else {
          console.log('Chessist: Detected white via white king position');
          return 'w';
        }
      }
    }

    // Method 1c: Check coordinate labels to detect orientation
    // If 'a' file is on the right side, board is flipped (black's view)
    const coords = document.querySelectorAll('.coords-files text, .coordinates-file, [class*="coordinate"]');
    for (const coord of coords) {
      const text = coord.textContent?.trim().toLowerCase();
      const rect = coord.getBoundingClientRect();
      if (text === 'a' && rect.left > window.innerWidth / 2) {
        // 'a' file is on the right = flipped board = black
        return 'b';
      }
      if (text === 'h' && rect.left < window.innerWidth / 2) {
        // 'h' file is on the left = flipped board = black
        return 'b';
      }
    }

    // Method 1d: Check SVG coordinate elements inside board (including shadow DOM)
    if (board) {
      // Try regular DOM first
      let svgCoords = board.querySelectorAll('text, [class*="coord"]');

      // Also try shadow DOM
      if (board.shadowRoot) {
        const shadowCoords = board.shadowRoot.querySelectorAll('text, [class*="coord"], .coordinates text');
        svgCoords = [...svgCoords, ...shadowCoords];
      }

      for (const coord of svgCoords) {
        const text = coord.textContent?.trim().toLowerCase();
        if (text === '1') {
          const rect = coord.getBoundingClientRect();
          const boardRect = board.getBoundingClientRect();
          // If rank 1 is at the top of the board, it's flipped (black's view)
          if (rect.top < boardRect.top + boardRect.height / 2) {
            return 'b';
          }
        }
        // Also check file 'a' position
        if (text === 'a') {
          const rect = coord.getBoundingClientRect();
          const boardRect = board.getBoundingClientRect();
          // If file 'a' is on the right side, it's flipped (black's view)
          if (rect.left > boardRect.left + boardRect.width / 2) {
            return 'b';
          }
        }
      }
    }

    // Method 1e: Try to access board's internal orientation property
    if (board) {
      try {
        // Chess.com might expose orientation on the element
        if (board.orientation === 'black' || board.getAttribute('orientation') === 'black') {
          return 'b';
        }
        // Or via a game property
        if (board.game?.getOrientation?.() === 'black' || board.game?.orientation === 'black') {
          return 'b';
        }
        // Check for board.isFlipped property
        if (board.isFlipped === true) {
          return 'b';
        }
      } catch (e) {
        // Ignore errors accessing properties
      }
    }

    // Method 2: Check for bottom player indicators
    const bottomPlayer = document.querySelector('.player-component.bottom-player, .player-component.player-bottom, [class*="playerBottom"], [class*="player-bottom"]');
    if (bottomPlayer) {
      // Look for color indicators in the player component
      const pieceImg = bottomPlayer.querySelector('img[class*="piece"]');
      if (pieceImg?.src) {
        return pieceImg.src.includes('/w') ? 'w' : 'b';
      }
    }

    // Method 3: Check for user-tagline (logged in user's position)
    const userTaglines = document.querySelectorAll('.user-tagline-component, [class*="user-tagline"]');
    for (const tagline of userTaglines) {
      const parent = tagline.closest('.player-component, [class*="player"]');
      if (parent) {
        const isBottom = parent.classList.contains('player-bottom') ||
                         parent.classList.contains('bottom-player') ||
                         parent.matches('[class*="bottom"]');
        if (isBottom) {
          // Bottom player with user tagline = we're playing this color
          // If board not flipped, bottom is white
          return 'w';
        }
        const isTop = parent.classList.contains('player-top') ||
                      parent.classList.contains('top-player') ||
                      parent.matches('[class*="top"]');
        if (isTop) {
          // Top player with user tagline = we're playing this color (black)
          return 'b';
        }
      }
    }

    // Method 4: Check for "Your Turn" indicator
    const yourTurnEl = document.querySelector('[class*="your-turn"], [class*="yourTurn"], .clock-player-turn');
    if (yourTurnEl) {
      // If we can see "your turn" indicator, we're playing - use current turn
      return currentTurn;
    }

    // Method 5: Check URL for game context
    const path = window.location.pathname;
    if (path.includes('/play') || path.includes('/game/live') || path.includes('/game/daily')) {
      // We're in a game - if board isn't flipped, assume white
      // (Chess.com shows your pieces at the bottom by default)
      if (board && !board.classList.contains('flipped')) {
        return 'w';
      }
    }

    // Method 6: Analysis mode - treat as "always player's turn" for arrow
    if (path.includes('/analysis') || path.includes('/explorer')) {
      return currentTurn;
    }

    return null; // Unknown (probably spectating)
  }

  // Try to detect whose turn it is
  function detectTurn() {
    // Method 1: Try to get turn from Chess.com's game object directly
    try {
      const gameTag = document.querySelector('chess-board, wc-chess-board');
      if (gameTag?.game?.getTurn) {
        const turn = gameTag.game.getTurn();
        if (turn === 1 || turn === 'white' || turn === 'w') return 'w';
        if (turn === 2 || turn === 'black' || turn === 'b') return 'b';
      }
      if (gameTag?.game?.turn) {
        const turn = typeof gameTag.game.turn === 'function' ? gameTag.game.turn() : gameTag.game.turn;
        if (turn === 1 || turn === 'white' || turn === 'w') return 'w';
        if (turn === 2 || turn === 'black' || turn === 'b') return 'b';
      }
    } catch (e) {}

    // Method 2: Count moves in the vertical move list (vs computer and live games)
    // Each white-black pair is in a div, count all move spans/nodes
    const allMoves = document.querySelectorAll('.main-line-row .node-highlight-content, .move-text-component, .move-node .node-highlight-content');
    if (allMoves.length > 0) {
      return allMoves.length % 2 === 0 ? 'w' : 'b';
    }

    // Method 3: Count white and black move columns separately
    const whiteMoves = document.querySelectorAll('.main-line-row .white-move, .white.node, [class*="white-move"]');
    const blackMoves = document.querySelectorAll('.main-line-row .black-move, .black.node, [class*="black-move"]');
    if (whiteMoves.length > 0 || blackMoves.length > 0) {
      // If equal moves, it's white's turn. If white has one more, it's black's turn.
      return whiteMoves.length === blackMoves.length ? 'w' : 'b';
    }

    // Method 4: Look for active clock indicator
    const activeClocks = document.querySelectorAll('.clock-component.clock-player-turn, [class*="clock"][class*="turn"]');
    if (activeClocks.length > 0) {
      const activeClock = activeClocks[0];
      const playerComp = activeClock.closest('.player-component, [class*="player"]');
      if (playerComp) {
        const isBottom = playerComp.classList.contains('player-bottom') ||
                         playerComp.classList.contains('bottom-player');
        const board = document.querySelector('wc-chess-board');
        const boardFlipped = board?.classList.contains('flipped');
        const bottomIsWhite = !boardFlipped;
        return (isBottom === bottomIsWhite) ? 'w' : 'b';
      }
    }

    // Method 5: Check for data-ply attribute on selected/last move
    const lastMove = document.querySelector('[data-ply]:last-of-type, .node.selected, .move-node.selected');
    if (lastMove) {
      const ply = lastMove.getAttribute('data-ply');
      if (ply) {
        // ply 1 = after white's first move, so next is black. ply 2 = after black, next is white
        return parseInt(ply) % 2 === 1 ? 'b' : 'w';
      }
    }

    // Default to white's turn
    return 'w';
  }

  // Create evaluation bar element
  function createEvalBar(board) {
    // Check if already created
    if (evalBar) return;

    // Try to use Chess.com's native evaluation container first
    const nativeEvalContainer = document.getElementById('board-layout-evaluation');
    const nativeEvalInner = document.getElementById('evaluation');

    if (nativeEvalContainer && nativeEvalInner) {
      console.log('Chessist: Using native Chess.com eval container');

      // Make container visible and style it
      nativeEvalContainer.style.display = 'block';

      // Clear any existing content and use as our eval bar
      nativeEvalInner.innerHTML = '';
      nativeEvalInner.className = 'chess-live-eval-bar';

      evalBar = nativeEvalInner;

      // Create fill (white portion)
      evalBarFill = document.createElement('div');
      evalBarFill.className = 'chess-live-eval-bar-fill';
      evalBarFill.style.height = '50%';

      // Create score display
      evalScore = document.createElement('div');
      evalScore.className = 'chess-live-eval-score equal';
      evalScore.textContent = '0.0';

      // Create best move display (hidden by default)
      bestMoveEl = document.createElement('div');
      bestMoveEl.className = 'chess-live-eval-best-move';
      bestMoveEl.style.display = 'none';

      // Create depth indicator
      depthEl = document.createElement('div');
      depthEl.className = 'chess-live-eval-depth';
      depthEl.textContent = '';

      // Create turn indicator (debug)
      turnIndicatorEl = document.createElement('div');
      turnIndicatorEl.className = 'chess-live-eval-turn';
      turnIndicatorEl.textContent = '';

      evalBar.appendChild(evalBarFill);
      evalBar.appendChild(evalScore);
      evalBar.appendChild(depthEl);
      evalBar.appendChild(bestMoveEl);
      evalBar.appendChild(turnIndicatorEl);

      return;
    }

    // Fallback: Create our own eval bar
    console.log('Chessist: Creating custom eval bar');

    // Find the actual board element with dimensions
    let boardElement = board;
    const possibleBoards = [
      board.querySelector('.board'),
      board.shadowRoot?.querySelector('.board'),
      board
    ];

    for (const b of possibleBoards) {
      if (b) {
        const rect = b.getBoundingClientRect();
        if (rect.height > 100) {
          boardElement = b;
          break;
        }
      }
    }

    // Get board dimensions
    const boardRect = boardElement.getBoundingClientRect();
    const boardHeight = boardRect.height || 400;

    // Create eval bar
    evalBar = document.createElement('div');
    evalBar.className = 'chess-live-eval-bar loading';
    evalBar.style.height = `${boardHeight}px`;
    evalBar.style.position = 'absolute';
    evalBar.style.left = '-32px';
    evalBar.style.top = '0';

    // Create fill (white portion)
    evalBarFill = document.createElement('div');
    evalBarFill.className = 'chess-live-eval-bar-fill';
    evalBarFill.style.height = '50%';

    // Create score display
    evalScore = document.createElement('div');
    evalScore.className = 'chess-live-eval-score equal';
    evalScore.textContent = '0.0';

    // Create best move display (hidden by default)
    bestMoveEl = document.createElement('div');
    bestMoveEl.className = 'chess-live-eval-best-move';
    bestMoveEl.style.display = 'none';

    // Create depth indicator
    depthEl = document.createElement('div');
    depthEl.className = 'chess-live-eval-depth';
    depthEl.textContent = '';

    // Create turn indicator (debug)
    turnIndicatorEl = document.createElement('div');
    turnIndicatorEl.className = 'chess-live-eval-turn';
    turnIndicatorEl.textContent = '';

    evalBar.appendChild(evalBarFill);
    evalBar.appendChild(evalScore);
    evalBar.appendChild(depthEl);
    evalBar.appendChild(bestMoveEl);
    evalBar.appendChild(turnIndicatorEl);

    // Insert eval bar
    let insertParent = board.parentElement;
    const parentStyle = window.getComputedStyle(insertParent);
    if (parentStyle.position === 'static') {
      insertParent.style.position = 'relative';
    }
    insertParent.insertBefore(evalBar, board);

    // Observe board size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        if (newHeight > 100) {
          evalBar.style.height = `${newHeight}px`;
        }
      }
    });
    resizeObserver.observe(boardElement);
  }

  // Update evaluation display
  function updateEval(evaluation) {
    if (!evalBar) return;

    // Only remove loading state when we reach target depth
    if (evaluation.depth >= targetDepth) {
      evalBar.classList.remove('loading');
    }

    // In puzzle mode, always re-detect player color (it changes as you solve)
    // In regular games, only detect if not set
    if (isPuzzleMode() || !playerColor) {
      playerColor = detectPlayerColor();
    }

    let displayScore;
    let fillPercent;
    let scoreClass;

    // IMPORTANT: Stockfish evaluates from the CURRENT TURN's perspective
    // The score is positive when the side to move is winning
    // We need to flip it to show from WHITE's perspective first

    let rawMate = evaluation.mate;
    let rawCp = evaluation.cp || 0;

    // Use the turn from the evaluation (which FEN was being analyzed)
    // This avoids race conditions where currentFen has already changed
    const evalTurn = evaluation.turn || 'w';

    // If it was black's turn when this position was evaluated,
    // Stockfish gave score from black's perspective - flip to white's perspective
    const isBlackToMove = evalTurn === 'b';
    if (isBlackToMove) {
      if (rawMate !== undefined) {
        rawMate = -rawMate;
      }
      rawCp = -rawCp;
    }

    
    // Now rawCp and rawMate are from WHITE's perspective
    // Positive = white winning, Negative = black winning
    
    // Flip everything if player is black (bar and score)
    const viewFromBlack = playerColor === 'b';
    let displayMate = rawMate;
    let displayCp = rawCp;
    
    if (viewFromBlack) {
      // Flip the evaluation for display from black's perspective
      if (displayMate !== undefined) {
        displayMate = -displayMate;
      }
      displayCp = -displayCp;
    }

    if (displayMate !== undefined) {
      // Mate score
      const mateIn = displayMate;
      displayScore = mateIn > 0 ? `M${mateIn}` : `M${Math.abs(mateIn)}`;
      
      // For the bar fill:
      // If player is white: positive rawMate = white winning = 100% fill (white at top)
      // If player is black: positive displayMate = black winning = 100% fill (player's color at top)
      if (viewFromBlack) {
        fillPercent = displayMate > 0 ? 100 : 0;
        scoreClass = displayMate > 0 ? 'black-winning mate' : 'white-winning mate';
      } else {
        fillPercent = rawMate > 0 ? 100 : 0;
        scoreClass = rawMate > 0 ? 'white-winning mate' : 'black-winning mate';
      }
    } else {
      // Centipawn score (convert to pawns)
      const pawns = displayCp / 100;

      // Format score - positive means player is winning
      if (pawns > 0) {
        displayScore = `+${pawns.toFixed(1)}`;
        scoreClass = viewFromBlack ? 'black-winning' : 'white-winning';
      } else if (pawns < 0) {
        displayScore = pawns.toFixed(1);
        scoreClass = viewFromBlack ? 'white-winning' : 'black-winning';
      } else {
        displayScore = '0.0';
        scoreClass = 'equal';
      }

      // Calculate fill percentage
      // For white player: use rawCp (positive = more white fill at top)
      // For black player: use displayCp (positive = more black fill at top)
      const evalForFill = viewFromBlack ? displayCp : rawCp;
      const clampedPawns = Math.max(-10, Math.min(10, evalForFill / 100));
      fillPercent = 50 + (clampedPawns / 10) * 50;
    }

    // Update bar fill
    evalBarFill.style.height = `${fillPercent}%`;

    // Update score display
    evalScore.textContent = displayScore;
    evalScore.className = `chess-live-eval-score ${scoreClass}`;

    // Update best move if enabled
    if (evaluation.bestMove) {
      // Format UCI move (e.g., "e2e4" -> "e2→e4", "e7e8q" -> "e7→e8=Q")
      const move = evaluation.bestMove;
      let formattedMove = move;
      if (move.length >= 4) {
        const from = move.substring(0, 2);
        const to = move.substring(2, 4);
        const promotion = move.length > 4 ? '=' + move[4].toUpperCase() : '';
        formattedMove = `${from}→${to}${promotion}`;
      }

      // Log best move to console only at target depth
      if (evaluation.depth >= targetDepth) {
        console.log(`Best move: ${formattedMove} (depth ${evaluation.depth}, eval: ${displayScore})`);
      }

      if (showBestMove && bestMoveEl) {
        bestMoveEl.textContent = formattedMove;
        bestMoveEl.style.display = 'block';

        // Only draw arrow on player's turn (or always in spectating mode)
        const isPlayerTurn = !playerColor || currentTurn === playerColor;

        // Draw arrow on board only at target depth to avoid flickering
        if (evaluation.depth >= targetDepth && isPlayerTurn) {
          drawBestMoveArrow(move);
        } else if (!isPlayerTurn) {
          // Clear arrow when it's opponent's turn
          clearArrow();
        }
      }
    }
    if (!showBestMove) {
      if (bestMoveEl) {
        bestMoveEl.style.display = 'none';
      }
      clearArrow();
    }

    // Update depth indicator (always show current depth)
    if (depthEl && evaluation.depth) {
      depthEl.textContent = `D${evaluation.depth}`;
    }

    // Auto-move feature: execute the best move automatically
    if (autoMove && evaluation.bestMove && evaluation.depth >= targetDepth) {
      const isPlayerTurn = playerColor && currentTurn === playerColor;

      // CRITICAL: Verify the evaluation is for the CURRENT position
      // This prevents stale evaluations from triggering moves on the wrong position
      let evalMatchesCurrent = true;
      if (evaluation.fen && currentFen) {
        const evalPieces = evaluation.fen.split(' ')[0];
        const currentPieces = currentFen.split(' ')[0];
        evalMatchesCurrent = evalPieces === currentPieces;
      }

      // Only auto-move on player's turn, if eval matches current position,
      // and if we haven't already moved for this position
      if (isPlayerTurn && evalMatchesCurrent && currentFen !== lastAutoMoveFen) {
        lastAutoMoveFen = currentFen;  // Mark this position as processed
        console.log('Chessist: Auto-move triggered for', evaluation.bestMove);

        // Small delay to ensure the UI is ready
        setTimeout(() => {
          executeMove(evaluation.bestMove);
        }, 150);
      } else if (!evalMatchesCurrent) {
        console.log('Chessist: Skipping auto-move - stale evaluation for different position');
      }
    }
  }

  // Request evaluation from background script
  async function requestEval(fen, isMouseRelease = false) {
    if (!isEnabled || !fen) return;

    console.log('Chessist: Requesting eval for FEN:', fen, isMouseRelease ? '(mouse release)' : '');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EVALUATE',
        fen: fen,
        isMouseRelease: isMouseRelease
      });

      if (response && response.evaluation) {
        updateEval(response.evaluation);
      }
    } catch (e) {
      console.error('Chessist: Error requesting evaluation', e);
    }
  }

  // Listen for eval updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EVAL_RESULT' && message.evaluation) {
      // Only compare piece positions (first part of FEN) to detect stale evals
      // This is lenient enough to avoid false rejections while still catching old positions
      if (message.evaluation.fen && currentFen) {
        const evalPieces = message.evaluation.fen.split(' ')[0];
        const currentPieces = currentFen.split(' ')[0];
        if (evalPieces !== currentPieces) {
          // Stale evaluation for a different position - skip silently
          return;
        }
      }
      updateEval(message.evaluation);
    }
  });

  // Start observing board for changes
  function observeBoard(board) {
    if (boardObserver) {
      boardObserver.disconnect();
    }

    // Initial FEN extraction and eval
    const fen = extractFEN(board);
    if (fen && fen !== currentFen) {
      currentFen = fen;
      requestEval(fen);
    }

    // Method 1: MutationObserver for DOM changes
    boardObserver = new MutationObserver(() => {
      checkForPositionChange(false); // Not from mouse release
    });

    boardObserver.observe(board, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'transform']
    });

    // Method 2: Poll for changes (Chess.com uses transforms/animations)
    setInterval(() => {
      checkForPositionChange(false); // Not from mouse release
    }, 500);

    // Method 3: Listen for mouse release on board (PRIMARY - most accurate)
    board.addEventListener('mouseup', () => {
      console.log('Chessist: Mouse released on board');
      setTimeout(() => checkForPositionChange(true), 100); // Mark as mouse release
    });

    // Method 4: Listen for click/move events on board (fallback)
    board.addEventListener('click', () => {
      setTimeout(() => checkForPositionChange(false), 300);
    });

    // Method 5: Listen for keyboard moves
    document.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        setTimeout(() => checkForPositionChange(false), 200);
      }
    });

    // Method 6: Watch for move list changes
    const moveList = document.querySelector('.move-list-wrapper, .vertical-move-list');
    if (moveList) {
      const moveObserver = new MutationObserver(() => {
        setTimeout(() => checkForPositionChange(false), 100);
      });
      moveObserver.observe(moveList, { childList: true, subtree: true });
    }
  }

  // Check if position has changed and request eval
  function checkForPositionChange(isMouseRelease = false) {
    clearTimeout(window.evalDebounce);
    window.evalDebounce = setTimeout(() => {
      const board = findBoard();
      if (!board) {
        console.log('Chessist: No board found');
        return;
      }

      const newFen = extractFEN(board);

      if (newFen && newFen !== currentFen) {

        // Clear the best move arrow when position changes
        clearArrow();

        // Check if this is a completely new game (starting position)
        const isStartingPosition = newFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
        const wasStartingPosition = currentFen && currentFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

        // If we just started a new game, reset the engine
        if (isStartingPosition && !wasStartingPosition && currentFen !== null) {
          console.log('Chessist: New game detected, resetting engine');
          chrome.runtime.sendMessage({ type: 'RESET_ENGINE' }).catch(() => {});
        }

        currentFen = newFen;

        // Update current turn from FEN
        const fenParts = newFen.split(' ');
        if (fenParts.length > 1) {
          currentTurn = fenParts[1];
        }

        // Re-detect player color (in case user switched games)
        playerColor = detectPlayerColor();
        console.log('Chessist: Turn:', currentTurn, 'Player:', playerColor || 'spectating');

        // Update turn indicator for debugging
        if (turnIndicatorEl) {
          const turnText = currentTurn === 'w' ? 'W' : 'B';
          const playerText = playerColor ? (playerColor === 'w' ? 'W' : 'B') : '?';
          const isMyTurn = playerColor && currentTurn === playerColor;
          turnIndicatorEl.textContent = `${turnText}/${playerText}`;
          turnIndicatorEl.title = `Turn: ${currentTurn === 'w' ? 'White' : 'Black'} | You: ${playerColor ? (playerColor === 'w' ? 'White' : 'Black') : 'Spectating'}${isMyTurn ? ' (YOUR TURN)' : ''}`;
          turnIndicatorEl.className = `chess-live-eval-turn ${isMyTurn ? 'my-turn' : ''}`;
        }

        evalBar?.classList.add('loading');
        requestEval(newFen, isMouseRelease);
      }
    }, isMouseRelease ? 50 : 200); // Shorter debounce for mouse release
  }

  // Main initialization
  async function init() {
    await loadSettings();

    if (!isEnabled) return;

    // Reset engine state on page load to clear any stale data
    try {
      await chrome.runtime.sendMessage({ type: 'RESET_ENGINE' });
      console.log('Chessist: Engine reset on page load');
    } catch (e) {
      // Service worker might not be ready yet
    }

    // Wait for board to appear
    const checkForBoard = () => {
      const board = findBoard();
      if (board) {
        createEvalBar(board);
        observeBoard(board);
      } else {
        // Retry after a short delay
        setTimeout(checkForBoard, 500);
      }
    };

    checkForBoard();

    // Also observe for navigation (Chess.com is a SPA)
    const pageObserver = new MutationObserver(() => {
      const board = findBoard();
      if (board && !evalBar) {
        createEvalBar(board);
        observeBoard(board);
      }
    });

    pageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_ENABLED') {
      isEnabled = message.enabled;
      if (evalBar) {
        evalBar.style.display = isEnabled ? 'block' : 'none';
      }
    } else if (message.type === 'SETTINGS_UPDATED') {
      // Update showBestMove if provided
      if (message.showBestMove !== undefined) {
        showBestMove = message.showBestMove;
        if (bestMoveEl) {
          bestMoveEl.style.display = showBestMove ? 'block' : 'none';
        }
        // Clear arrow when best move display is disabled
        if (!showBestMove) {
          clearArrow();
        }
      }
      // Update autoMove if provided
      if (message.autoMove !== undefined) {
        autoMove = message.autoMove;
        // Reset last auto-move FEN when toggled to allow fresh auto-move
        if (autoMove) {
          lastAutoMoveFen = null;
        }
        console.log('Chessist: Auto-move', autoMove ? 'enabled' : 'disabled');
      }
      // Update playerColor if provided
      if (message.playerColor !== undefined) {
        manualPlayerColor = message.playerColor;
        playerColor = detectPlayerColor();  // Re-detect with new manual setting
        console.log('Chessist: Player color set to', manualPlayerColor, '-> detected as', playerColor);
        // Update turn indicator
        if (turnIndicatorEl) {
          const isMyTurn = playerColor && currentTurn === playerColor;
          turnIndicatorEl.textContent = `${currentTurn === 'w' ? 'W' : 'B'}/${playerColor || '?'}`;
          turnIndicatorEl.classList.toggle('my-turn', isMyTurn);
        }
      }
    } else if (message.type === 'RE_EVALUATE') {
      // Engine switched - trigger re-evaluation of current position
      if (currentFen && isEnabled) {
        console.log('Chessist: Re-evaluating after engine switch');
        evalBar?.classList.add('loading');
        requestEval(currentFen);
      }
    }
  });

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
