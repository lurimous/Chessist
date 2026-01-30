// Chessist - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const showBestMove = document.getElementById('showBestMove');
  const engineDepth = document.getElementById('engineDepth');
  const depthValue = document.getElementById('depthValue');
  const currentEval = document.getElementById('currentEval');
  const currentDepth = document.getElementById('currentDepth');
  const wasmBtn = document.getElementById('wasmBtn');
  const nativeBtn = document.getElementById('nativeBtn');
  const nativeStatus = document.getElementById('nativeStatus');
  const nativeStatusIcon = document.getElementById('nativeStatusIcon');
  const nativeStatusText = document.getElementById('nativeStatusText');
  const nativeHelp = document.getElementById('nativeHelp');
  const copyIdBtn = document.getElementById('copyIdBtn');
  const extensionIdEl = document.getElementById('extensionId');
  const autoMoveToggle = document.getElementById('autoMove');
  const colorAutoBtn = document.getElementById('colorAuto');
  const colorWhiteBtn = document.getElementById('colorWhite');
  const colorBlackBtn = document.getElementById('colorBlack');

  let currentEngineSource = 'wasm';
  let currentPlayerColor = 'auto'; // 'auto', 'w', or 'b'

  // Display the extension ID for native host setup
  const extensionId = chrome.runtime.id;
  extensionIdEl.textContent = extensionId;
  extensionIdEl.title = 'Click to copy extension ID';

  // Load current settings
  const settings = await chrome.storage.sync.get(['enabled', 'showBestMove', 'autoMove', 'engineDepth', 'engineSource', 'playerColor']);
  enableToggle.checked = settings.enabled !== false;
  showBestMove.checked = settings.showBestMove === true;
  autoMoveToggle.checked = settings.autoMove === true;
  engineDepth.value = settings.engineDepth || 18;
  depthValue.textContent = engineDepth.value;
  currentEngineSource = settings.engineSource || 'wasm';
  currentPlayerColor = settings.playerColor || 'auto';

  // Update button states
  updateEngineButtons();
  updateNativeStatusVisibility();
  updateColorButtons();

  // Toggle enabled state
  enableToggle.addEventListener('change', async () => {
    const enabled = enableToggle.checked;
    await chrome.storage.sync.set({ enabled });
    notifyContentScripts({ type: 'TOGGLE_ENABLED', enabled });
  });

  // Toggle best move
  showBestMove.addEventListener('change', async () => {
    await chrome.storage.sync.set({ showBestMove: showBestMove.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', showBestMove: showBestMove.checked });
  });

  // Toggle auto move
  autoMoveToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ autoMove: autoMoveToggle.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', autoMove: autoMoveToggle.checked });
  });

  // Engine depth slider
  engineDepth.addEventListener('input', () => {
    depthValue.textContent = engineDepth.value;
  });

  engineDepth.addEventListener('change', async () => {
    await chrome.storage.sync.set({ engineDepth: parseInt(engineDepth.value) });
    // Notify offscreen document
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_DEPTH',
        depth: parseInt(engineDepth.value)
      });
    } catch (e) {
      // Offscreen document might not be running
    }
  });

  // Engine button clicks
  wasmBtn.addEventListener('click', () => selectEngine('wasm'));
  nativeBtn.addEventListener('click', () => selectEngine('native'));

  // Player color button clicks
  colorAutoBtn.addEventListener('click', () => selectPlayerColor('auto'));
  colorWhiteBtn.addEventListener('click', () => selectPlayerColor('w'));
  colorBlackBtn.addEventListener('click', () => selectPlayerColor('b'));

  async function selectPlayerColor(color) {
    currentPlayerColor = color;
    await chrome.storage.sync.set({ playerColor: color });
    updateColorButtons();
    notifyContentScripts({ type: 'SETTINGS_UPDATED', playerColor: color });
  }

  function updateColorButtons() {
    colorAutoBtn.classList.toggle('active', currentPlayerColor === 'auto');
    colorWhiteBtn.classList.toggle('active', currentPlayerColor === 'w');
    colorBlackBtn.classList.toggle('active', currentPlayerColor === 'b');
  }

  // Copy extension ID button
  copyIdBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(extensionId);
      copyIdBtn.classList.add('copied');
      const originalText = extensionIdEl.textContent;
      extensionIdEl.textContent = 'Copied!';
      setTimeout(() => {
        copyIdBtn.classList.remove('copied');
        extensionIdEl.textContent = originalText;
      }, 1500);
    } catch (e) {
      // Fallback: select the text
      extensionIdEl.select?.();
    }
  });

  async function selectEngine(source) {
    currentEngineSource = source;
    await chrome.storage.sync.set({ engineSource: source });
    updateEngineButtons();
    updateNativeStatusVisibility();

    // Notify service worker to switch engine
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_ENGINE_SOURCE',
        source: source
      });

      // Wait for engine to connect, then trigger re-evaluation
      if (source === 'native') {
        // Wait for native connection before re-evaluating
        setTimeout(async () => {
          const status = await chrome.runtime.sendMessage({ type: 'CHECK_NATIVE_STATUS' });
          if (status?.connected) {
            notifyContentScripts({ type: 'RE_EVALUATE' });
          }
        }, 1500);
      } else {
        // WASM is always ready, trigger re-evaluation immediately
        notifyContentScripts({ type: 'RE_EVALUATE' });
      }
    } catch (e) {
      console.error('Failed to set engine source:', e);
    }
  }

  // Update button active states
  function updateEngineButtons() {
    if (currentEngineSource === 'wasm') {
      wasmBtn.classList.add('active');
      nativeBtn.classList.remove('active');
    } else {
      wasmBtn.classList.remove('active');
      nativeBtn.classList.add('active');
    }
  }

  // Update native status visibility based on selected engine
  function updateNativeStatusVisibility() {
    if (currentEngineSource === 'native') {
      nativeStatus.classList.remove('hidden');
      nativeHelp.classList.remove('hidden');
      checkNativeStatus();
    } else {
      nativeStatus.classList.add('hidden');
      nativeHelp.classList.add('hidden');
    }
  }

  // Check native Stockfish connection status
  async function checkNativeStatus() {
    nativeStatusIcon.textContent = '⏳';
    nativeStatusText.textContent = 'Connecting...';
    nativeStatus.classList.remove('connected', 'error');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_NATIVE_STATUS' });
      if (response && response.connected) {
        nativeStatus.classList.remove('error');
        nativeStatus.classList.add('connected');
        nativeStatusIcon.textContent = '✓';
        nativeStatusText.textContent = `Connected: ${response.path || 'Stockfish'}`;
        nativeHelp.classList.add('hidden');
      } else {
        nativeStatus.classList.remove('connected');
        nativeStatus.classList.add('error');
        nativeStatusIcon.textContent = '✗';
        nativeStatusText.textContent = response?.error || 'Not connected';
        nativeHelp.classList.remove('hidden');
      }
    } catch (e) {
      nativeStatus.classList.remove('connected');
      nativeStatus.classList.add('error');
      nativeStatusIcon.textContent = '✗';
      nativeStatusText.textContent = 'Not connected';
      nativeHelp.classList.remove('hidden');
    }
  }

  // Notify content scripts helper
  async function notifyContentScripts(message) {
    const tabs = await chrome.tabs.query({ url: 'https://www.chess.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (e) {
        // Tab might not have content script
      }
    }
  }

  // Listen for eval updates and engine source changes
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'EVAL_RESULT' && message.evaluation) {
      updateEvalDisplay(message.evaluation);
    }
    // Handle auto-fallback from native to WASM (e.g., Opera browser)
    if (message.type === 'ENGINE_SOURCE_CHANGED') {
      currentEngineSource = message.source;
      updateEngineButtons();
      updateNativeStatusVisibility();
      if (message.source === 'wasm') {
        // Show brief notification that we fell back
        nativeStatus.classList.remove('hidden', 'connected');
        nativeStatus.classList.add('error');
        nativeStatusIcon.textContent = '⚠';
        nativeStatusText.textContent = 'Native not supported, using WASM';
        setTimeout(() => {
          nativeStatus.classList.add('hidden');
        }, 3000);
      }
    }
  });

  // Update eval display
  function updateEvalDisplay(evaluation) {
    let displayText;
    let depthText = '';
    let className = '';

    if (evaluation.mate !== undefined) {
      const mateIn = evaluation.mate;
      displayText = mateIn > 0 ? `M${mateIn}` : `-M${Math.abs(mateIn)}`;
      className = mateIn > 0 ? 'positive' : 'negative';
    } else if (evaluation.cp !== undefined) {
      const pawns = evaluation.cp / 100;
      if (pawns > 0) {
        displayText = `+${pawns.toFixed(1)}`;
        className = 'positive';
      } else if (pawns < 0) {
        displayText = pawns.toFixed(1);
        className = 'negative';
      } else {
        displayText = '0.0';
      }
    }

    if (evaluation.depth) {
      depthText = `Depth ${evaluation.depth}`;
    }

    if (displayText) {
      currentEval.textContent = displayText;
      currentEval.className = `eval-value ${className}`;
    }

    if (depthText) {
      currentDepth.textContent = depthText;
    }
  }
});
