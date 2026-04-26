document.addEventListener('DOMContentLoaded', async () => {
  const domainInput = document.getElementById('domainInput');
  const addBtn = document.getElementById('addBtn');
  const domainList = document.getElementById('domainList');

  // Load existing domains
  const { whitelistedDomains } = await chrome.storage.local.get('whitelistedDomains');
  let domains = whitelistedDomains || [];

  function render() {
    domainList.innerHTML = '';
    domains.forEach((domain, index) => {
      const li = document.createElement('li');
      
      const span = document.createElement('span');
      span.textContent = domain;
      
      const btn = document.createElement('button');
      btn.className = 'remove-btn';
      btn.textContent = 'REMOVE';
      btn.onclick = async () => {
        domains.splice(index, 1);
        await chrome.storage.local.set({ whitelistedDomains: domains });
        render();
      };

      li.appendChild(span);
      li.appendChild(btn);
      domainList.appendChild(li);
    });
  }

  addBtn.onclick = async () => {
    let val = domainInput.value.trim().toLowerCase();
    if (!val) return;
    
    // Clean up URLs if the user pasted a full link
    try {
      if (val.startsWith('http')) {
        const url = new URL(val);
        val = url.hostname;
      }
    } catch(e) {}
    
    // Strip www. if they added it
    if (val.startsWith('www.')) val = val.substring(4);

    if (val && !domains.includes(val)) {
      domains.push(val);
      await chrome.storage.local.set({ whitelistedDomains: domains });
      domainInput.value = '';
      render();
    }
  };

  domainInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });

  render();
});
