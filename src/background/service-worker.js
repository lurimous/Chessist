// Chessist - Service Worker
// Coordinates communication between content script and Stockfish engine

let offscreenDocumentCreated = false;
let lastEvaluation = null;
let lastBestMove = null;
let pendingRequests = new Map();
let requestId = 0;
let currentEvalFen = null; // Track which FEN is being evaluated
let analysisEvalFen = null; // The FEN actually being analyzed by native engine
let nativeEvalTimeout = null; // Debounce timer for native engine requests
let pendingNativeFen = null; // FEN waiting to be evaluated after debounce

// Native messaging
let nativePort = null;
let nativeConnected = false;
let nativePath = null;
let engineSource = 'wasm'; // 'wasm' or 'native'

// Watchdog for native engine health
let lastNativeResponseTime = Date.now();
let nativeWatchdogTimer = null;

// Load engine source preference
chrome.storage.sync.get(['engineSource']).then(result => {
  engineSource = result.engineSource || 'wasm';
  if (engineSource === 'native') {
    connectNative();
  }
});

// Connect to native Stockfish host
function connectNative() {
  if (nativePort) {
    return; // Already connected
  }

  try {
    console.log('Chessist SW: Connecting to native host...');
    nativePort = chrome.runtime.connectNative('com.chess.live.eval');

    nativePort.onMessage.addListener((message) => {
      console.log('Chessist SW: Native message:', message);
      handleNativeMessage(message);
    });

    nativePort.onDisconnect.addListener(() => {
      console.log('Chessist SW: Native disconnected:', chrome.runtime.lastError?.message);
      nativePort = null;
      nativeConnected = false;
      nativePath = null;
      // Stop watchdog when disconnected
      if (nativeWatchdogTimer) {
        clearInterval(nativeWatchdogTimer);
        nativeWatchdogTimer = null;
      }
    });

    // Start watchdog timer to detect unresponsive engine
    // Use longer timeout for deep analysis (depth 24+ can take time)
    lastNativeResponseTime = Date.now();
    if (!nativeWatchdogTimer) {
      nativeWatchdogTimer = setInterval(() => {
        if (nativeConnected && Date.now() - lastNativeResponseTime > 30000) {
          console.log('Chessist SW: Native engine unresponsive, reconnecting...');
          disconnectNative();
          setTimeout(connectNative, 1000);
        }
      }, 10000);
    }

  } catch (e) {
    console.error('Chessist SW: Failed to connect native:', e);
    nativePort = null;
    nativeConnected = false;
  }
}

// Disconnect native host
function disconnectNative() {
  if (nativePort) {
    nativePort.disconnect();
    nativePort = null;
    nativeConnected = false;
    nativePath = null;
  }
}

// Handle messages from native host
function handleNativeMessage(message) {
  // Reset watchdog timer on any response
  lastNativeResponseTime = Date.now();

  if (message.type === 'started') {
    nativeConnected = true;
    nativePath = message.path;
    console.log('Chessist SW: Native Stockfish started:', message.path);
  }
  else if (message.type === 'ready') {
    console.log('Chessist SW: Native Stockfish ready');
  }
  else if (message.type === 'analyzing') {
    console.log('Chessist SW: Analyzing position:', message.fen, 'depth:', message.depth);
  }
  else if (message.type === 'eval') {
    lastEvaluation = message.data;
    // Add turn info from the FEN being evaluated (use analysisEvalFen to avoid race conditions)
    if (analysisEvalFen) {
      const fenParts = analysisEvalFen.split(' ');
      lastEvaluation.turn = fenParts[1] || 'w';
      lastEvaluation.fen = analysisEvalFen;
    }
    broadcastToContentScripts({
      type: 'EVAL_RESULT',
      evaluation: lastEvaluation
    });
  }
  else if (message.type === 'bestmove') {
    lastBestMove = message.move;
    if (lastEvaluation) {
      lastEvaluation.bestMove = message.move;
      broadcastToContentScripts({
        type: 'EVAL_RESULT',
        evaluation: lastEvaluation
      });
    }
  }
  else if (message.type === 'error') {
    console.error('Chessist SW: Native error:', message.message);
  }
  else if (message.type === 'debug') {
    console.log('Chessist SW: [Python]', message.message);
  }
}

// Create offscreen document for running Stockfish WASM
async function ensureOffscreenDocument() {
  if (offscreenDocumentCreated) return;

  try {
    if (chrome.runtime.getContexts) {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });

      if (existingContexts.length > 0) {
        offscreenDocumentCreated = true;
        return;
      }
    }

    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Running Stockfish chess engine in Web Worker'
    });

    offscreenDocumentCreated = true;
    console.log('Offscreen document created');
  } catch (e) {
    if (e.message?.includes('single offscreen document')) {
      offscreenDocumentCreated = true;
    } else {
      console.error('Failed to create offscreen document:', e);
    }
  }
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Chessist SW: Received message:', message.type);

  if (message.type === 'EVALUATE') {
    handleEvaluateRequest(message.fen, sender.tab?.id, sendResponse);
    return true;
  }

  if (message.type === 'EVAL_UPDATE') {
    lastEvaluation = message.evaluation;
    broadcastToContentScripts({
      type: 'EVAL_RESULT',
      evaluation: message.evaluation
    });
  }

  if (message.type === 'BEST_MOVE') {
    lastBestMove = message.bestMove;
    if (lastEvaluation) {
      lastEvaluation.bestMove = message.bestMove;
      broadcastToContentScripts({
        type: 'EVAL_RESULT',
        evaluation: lastEvaluation
      });
    }
  }

  if (message.type === 'SET_ENGINE_SOURCE') {
    engineSource = message.source;
    if (engineSource === 'native') {
      connectNative();
    } else {
      disconnectNative();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CHECK_NATIVE_STATUS') {
    if (engineSource !== 'native') {
      sendResponse({ connected: false, error: 'Native engine not selected' });
    } else if (nativeConnected) {
      sendResponse({ connected: true, path: nativePath });
    } else {
      connectNative(); // Try to connect
      setTimeout(() => {
        sendResponse({
          connected: nativeConnected,
          path: nativePath,
          error: nativeConnected ? null : 'Failed to connect - run install.bat'
        });
      }, 1000);
      return true;
    }
    return true;
  }

  if (message.type === 'SET_DEPTH') {
    // Forward to native or WASM
    if (engineSource === 'native' && nativePort) {
      nativePort.postMessage({ type: 'set_option', name: 'Depth', value: message.depth });
    }
    // WASM will read from storage
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESET_ENGINE') {
    // Reset the engine (clear hash tables, stop analysis)
    if (engineSource === 'native' && nativePort) {
      nativePort.postMessage({ type: 'reset' });
    } else {
      // Send reset to offscreen document
      chrome.runtime.sendMessage({ type: 'RESET' }).catch(() => {});
    }
    // Clear cached evaluations
    lastEvaluation = null;
    lastBestMove = null;
    sendResponse({ success: true });
    return true;
  }

  return false;
});

// Handle evaluation request
async function handleEvaluateRequest(fen, tabId, sendResponse) {
  const settings = await chrome.storage.sync.get(['engineDepth', 'engineSource']);
  const depth = settings.engineDepth || 18;
  const source = settings.engineSource || 'wasm';

  // Track current FEN being evaluated (for turn info in results)
  currentEvalFen = fen;

  if (source === 'native' && nativePort && nativeConnected) {
    // Skip if already analyzing this exact position
    if (fen === analysisEvalFen && !nativeEvalTimeout) {
      console.log('Chessist SW: Already analyzing this position');
      sendResponse({ evaluation: lastEvaluation || { cp: 0 } });
      return;
    }

    // Debounce rapid requests to prevent overwhelming native engine
    pendingNativeFen = fen;

    if (nativeEvalTimeout) {
      clearTimeout(nativeEvalTimeout);
    }

    nativeEvalTimeout = setTimeout(() => {
      nativeEvalTimeout = null;
      const fenToEval = pendingNativeFen;
      pendingNativeFen = null;

      if (!fenToEval || fenToEval === analysisEvalFen) {
        return;
      }

      // Use native Stockfish
      console.log('Chessist SW: Evaluating with native Stockfish:', fenToEval.substring(0, 40));

      analysisEvalFen = fenToEval;  // Track what we're actually analyzing
      lastNativeResponseTime = Date.now();  // Reset watchdog when sending command
      nativePort.postMessage({ type: 'evaluate', fen: fenToEval, depth: depth });
    }, 400); // 400ms debounce to prevent overwhelming native engine at deep depths

    // Wait for evaluation with timeout
    const id = ++requestId;
    pendingRequests.set(id, { tabId, sendResponse });

    setTimeout(() => {
      if (lastEvaluation) {
        sendResponse({ evaluation: lastEvaluation });
      } else {
        sendResponse({ evaluation: { cp: 0 } });
      }
      pendingRequests.delete(id);
    }, 3000);

  } else {
    // Use WASM Stockfish
    try {
      await ensureOffscreenDocument();

      chrome.runtime.sendMessage({
        type: 'EVALUATE_POSITION',
        fen: fen
      }).catch(e => {
        console.log('Chessist SW: Offscreen message error:', e.message);
      });

      const id = ++requestId;
      pendingRequests.set(id, { tabId, sendResponse });

      setTimeout(() => {
        if (lastEvaluation) {
          sendResponse({ evaluation: lastEvaluation });
        } else {
          sendResponse({ evaluation: { cp: 0 } });
        }
        pendingRequests.delete(id);
      }, 5000);

    } catch (e) {
      console.error('Chessist SW: Evaluation error:', e);
      sendResponse({ error: e.message });
    }
  }
}

// Broadcast message to all Chess.com tabs
async function broadcastToContentScripts(message) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.chess.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (e) {
        // Tab might not have content script loaded
      }
    }
  } catch (e) {
    console.error('Broadcast error:', e);
  }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Chessist installed, reason:', details.reason);

  // Get existing settings to preserve user preferences
  const existing = await chrome.storage.sync.get(['enabled', 'showBestMove', 'engineDepth', 'engineSource']);

  // Only set defaults for missing values (preserves user preferences on updates)
  await chrome.storage.sync.set({
    enabled: existing.enabled ?? true,
    showBestMove: existing.showBestMove ?? false,
    engineDepth: existing.engineDepth ?? 18,
    engineSource: existing.engineSource ?? 'wasm'
  });
});
