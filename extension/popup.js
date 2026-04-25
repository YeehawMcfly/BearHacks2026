document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const info = document.getElementById('info');
  const btnReset = document.getElementById('btn-reset');
  const btnToggle = document.getElementById('btn-toggle');

  async function updateUI() {
    const state = await chrome.storage.local.get(null);
    const s = state.captchaState || 'not_started';

    const states = {
      'not_started': { color: '#f59e0b', text: 'AWAITING VERIFICATION', info: 'Open any webpage to begin.' },
      'in_progress': { color: '#06b6d4', text: 'VERIFICATION IN PROGRESS', info: `Suspicion: ${state.suspicionScore || 0}%` },
      'passed':      { color: '#10b981', text: 'VERIFIED HUMAN ✓', info: 'Access granted. SGT. CAPTCHA is watching.' },
      'banned':      { color: '#ff2d2d', text: 'BANNED ✗', info: state.banReason || 'Identified as non-human.' },
      'disabled':    { color: '#64748b', text: 'DISABLED', info: 'Extension is paused.' }
    };

    const st = states[s] || states['not_started'];
    statusDot.style.background = st.color;
    statusDot.style.boxShadow = `0 0 8px ${st.color}`;
    statusText.textContent = st.text;
    info.textContent = st.info;

    btnToggle.textContent = s === 'disabled' ? '▶️ ENABLE EXTENSION' : '⏸️ DISABLE EXTENSION';
  }

  btnReset.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_STATE' }, () => {
      updateUI();
    });
  });

  btnToggle.addEventListener('click', async () => {
    const state = await chrome.storage.local.get('captchaState');
    if (state.captchaState === 'disabled') {
      await chrome.storage.local.set({ captchaState: 'not_started' });
    } else {
      await chrome.storage.local.set({ captchaState: 'disabled' });
    }
    updateUI();

    // Reload all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.url && !tab.url.startsWith('chrome://')) {
          chrome.tabs.reload(tab.id);
        }
      });
    });
  });

  updateUI();
});
