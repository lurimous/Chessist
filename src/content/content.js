// Chessist - Content Script
// Detects Chess.com board, extracts FEN, and displays evaluation bar

(function() {
  'use strict';

  let evalBar = null;
  let evalBarFill = null;
  let evalScore = null;
  let bestMoveEl = null;
  let depthEl = null;
  let currentFen = null;
  let currentTurn = 'w';  // Track whose turn it is
  let playerColor = null; // Track player's color (for perspective)
  let isEnabled = true;
  let showBestMove = false;
  let boardObserver = null;
  let arrowOverlay = null;  // SVG overlay for best move arrow
  let currentBestMove = null;  // Track current best move to avoid redrawing

  let targetDepth = 18; // Default depth

  // Initialize settings from storage
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['enabled', 'showBestMove', 'engineDepth']);
      isEnabled = result.enabled !== false; // Default true
      showBestMove = result.showBestMove === true; // Default false
      targetDepth = result.engineDepth || 18;
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

    // Create arrow line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', lineEndX);
    line.setAttribute('y2', lineEndY);
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

    const arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    arrowHead.setAttribute('points', `
      ${headTipX},${headTipY}
      ${headBaseX + perpX},${headBaseY + perpY}
      ${headBaseX - perpX},${headBaseY - perpY}
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

  // Detect player's color (which side they're playing)
  function detectPlayerColor() {
    // Check if board is flipped - if flipped, player is black
    const board = document.querySelector('wc-chess-board');
    if (board?.classList.contains('flipped')) {
      return 'b';
    }
    // Check for bottom player indicators
    const bottomPlayer = document.querySelector('.player-component.bottom-player, .player-component.player-bottom');
    if (bottomPlayer) {
      // Look for color indicators in the player component
      const pieceImg = bottomPlayer.querySelector('img[class*="piece"]');
      if (pieceImg?.src) {
        return pieceImg.src.includes('/w') ? 'w' : 'b';
      }
    }
    return null; // Unknown (probably spectating or analysis)
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

      evalBar.appendChild(evalBarFill);
      evalBar.appendChild(evalScore);
      evalBar.appendChild(depthEl);
      evalBar.appendChild(bestMoveEl);

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

    evalBar.appendChild(evalBarFill);
    evalBar.appendChild(evalScore);
    evalBar.appendChild(depthEl);
    evalBar.appendChild(bestMoveEl);

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

    evalBar.classList.remove('loading');

    // Detect player color if not set
    if (!playerColor) {
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
        // Draw arrow on board
        drawBestMoveArrow(move);
      }
    }
    if (!showBestMove) {
      if (bestMoveEl) {
        bestMoveEl.style.display = 'none';
      }
      clearArrow();
    }

    // Update depth indicator
    if (depthEl && evaluation.depth) {
      depthEl.textContent = `D${evaluation.depth}`;
    }
  }

  // Request evaluation from background script
  async function requestEval(fen) {
    if (!isEnabled || !fen) return;

    console.log('Chessist: Requesting eval for FEN:', fen);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EVALUATE',
        fen: fen
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
      checkForPositionChange();
    });

    boardObserver.observe(board, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'transform']
    });

    // Method 2: Poll for changes (Chess.com uses transforms/animations)
    setInterval(() => {
      checkForPositionChange();
    }, 500);

    // Method 3: Listen for click/move events on board
    board.addEventListener('click', () => {
      setTimeout(checkForPositionChange, 300);
    });

    // Method 4: Listen for keyboard moves
    document.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        setTimeout(checkForPositionChange, 200);
      }
    });

    // Method 5: Watch for move list changes
    const moveList = document.querySelector('.move-list-wrapper, .vertical-move-list');
    if (moveList) {
      const moveObserver = new MutationObserver(() => {
        setTimeout(checkForPositionChange, 100);
      });
      moveObserver.observe(moveList, { childList: true, subtree: true });
    }
  }

  // Check if position has changed and request eval
  function checkForPositionChange() {
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

        evalBar?.classList.add('loading');
        requestEval(newFen);
      }
    }, 200);
  }

  // Main initialization
  async function init() {
    await loadSettings();

    if (!isEnabled) return;

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
      showBestMove = message.showBestMove;
      if (bestMoveEl) {
        bestMoveEl.style.display = showBestMove ? 'block' : 'none';
      }
      // Clear arrow when best move display is disabled
      if (!showBestMove) {
        clearArrow();
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
