/**
 * Background Service Worker — The Reverse Turing Test
 * Manages global CAPTCHA state across all tabs via chrome.storage.local.
 * States: "not_started" | "in_progress" | "passed" | "banned"
 */

// Initialize state on install
chrome.runtime.onInstalled.addListener(async () => {
  const { captchaState } = await chrome.storage.local.get('captchaState');
  if (!captchaState) {
    await chrome.storage.local.set({
      captchaState: 'not_started',
      currentLevel: 0,
      suspicionScore: 0,
      banReason: '',
      sessionStart: null
    });
  }
  updateBadge('not_started');
});

// Listen for state changes to update badge
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.captchaState) {
    updateBadge(changes.captchaState.newValue);
  }
});

// Update extension badge based on state
function updateBadge(state) {
  const badges = {
    'not_started': { text: '!', color: '#f59e0b' },
    'in_progress': { text: '⏳', color: '#06b6d4' },
    'passed':      { text: '✓', color: '#10b981' },
    'banned':      { text: '✗', color: '#ff2d2d' }
  };
  const badge = badges[state] || badges['not_started'];
  chrome.action.setBadgeText({ text: badge.text });
  chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RESET_STATE') {
    chrome.storage.local.set({
      captchaState: 'not_started',
      currentLevel: 0,
      suspicionScore: 0,
      banReason: '',
      sessionStart: null
    }).then(() => {
      updateBadge('not_started');
      // Reload all tabs to re-trigger overlay
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && !tab.url.startsWith('chrome://')) {
            chrome.tabs.reload(tab.id);
          }
        });
      });
      sendResponse({ success: true });
    });
    return true; // async response
  }

  if (message.type === 'GET_STATE') {
    chrome.storage.local.get(null).then(state => sendResponse(state));
    return true;
  }
});
