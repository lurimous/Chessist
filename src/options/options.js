// Chessist - Options Page Script

document.addEventListener('DOMContentLoaded', async () => {
  const showBestMove = document.getElementById('showBestMove');
  const engineDepth = document.getElementById('engineDepth');
  const depthValue = document.getElementById('depthValue');
  const statusBar = document.getElementById('statusBar');

  // Load current settings
  const settings = await chrome.storage.sync.get(['showBestMove', 'engineDepth']);

  showBestMove.checked = settings.showBestMove === true;
  engineDepth.value = settings.engineDepth || 18;
  depthValue.textContent = engineDepth.value;

  // Show best move toggle
  showBestMove.addEventListener('change', async () => {
    await saveSettings();
    notifyContentScripts();
  });

  // Engine depth slider
  engineDepth.addEventListener('input', () => {
    depthValue.textContent = engineDepth.value;
  });

  engineDepth.addEventListener('change', async () => {
    await saveSettings();
    notifyOffscreenDocument();
  });

  // Save settings to storage
  async function saveSettings() {
    await chrome.storage.sync.set({
      showBestMove: showBestMove.checked,
      engineDepth: parseInt(engineDepth.value)
    });

    showStatus('Settings saved');
  }

  // Notify content scripts of settings change
  async function notifyContentScripts() {
    const tabs = await chrome.tabs.query({ url: 'https://www.chess.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_UPDATED',
          showBestMove: showBestMove.checked
        });
      } catch (e) {
        // Tab might not have content script
      }
    }
  }

  // Notify offscreen document of depth change
  async function notifyOffscreenDocument() {
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_DEPTH',
        depth: parseInt(engineDepth.value)
      });
    } catch (e) {
      // Offscreen document might not be running
    }
  }

  // Show status message
  function showStatus(message) {
    statusBar.textContent = message;
    statusBar.classList.add('visible');

    setTimeout(() => {
      statusBar.classList.remove('visible');
    }, 2000);
  }
});
