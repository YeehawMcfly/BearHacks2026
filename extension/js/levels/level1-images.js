/**
 * Level 1 — Image Grid CAPTCHA (Google-style)
 * Uses real photos from picsum.photos for authentic look.
 * Category is absurd (selected by Gemma when available).
 * In Act I (normal theme), this looks like a real reCAPTCHA.
 */
(function () {
  const CATEGORIES = [
    'existential dread',
    'suspicious activity',
    'images a bot would pick',
    'mild inconvenience',
    'pure chaos',
    'vaguely threatening energy',
    'Tuesday vibes',
    'things that spark joy',
    'potential evidence',
    'something not quite right'
  ];

  // Fixed set of picsum IDs that are clear, recognizable photos
  const IMAGE_IDS = [
    10, 20, 25, 28, 29, 30, 36, 37, 39, 42, 43, 46, 48, 49, 50,
    54, 55, 57, 58, 59, 64, 65, 67, 70, 74, 76, 80, 82, 84, 89,
    91, 96, 100, 103, 106, 110, 111, 112, 116, 119, 120, 122, 127, 129, 130
  ];

  let selectedCells = new Set();
  let correctCells = new Set();
  let categoryLabel = '';
  let container = null;
  let shadowRoot = null;

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    selectedCells.clear();

    // Pick category — try Gemma first
    categoryLabel = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    window.ReverseTest.API.generateChallenge(1).then(data => {
      if (data && data.text) {
        const titleEl = shadow.getElementById('rt-l1-category');
        if (titleEl) titleEl.textContent = data.text.replace(/"/g, '');
      }
    }).catch(() => {});

    // 3-4 cells are "correct"
    correctCells.clear();
    const correctCount = 3 + Math.floor(Math.random() * 2);
    while (correctCells.size < correctCount) {
      correctCells.add(Math.floor(Math.random() * 9));
    }

    // Pick 9 random image IDs
    const shuffled = [...IMAGE_IDS].sort(() => Math.random() - 0.5);
    const nineIds = shuffled.slice(0, 9);

    container.innerHTML = `
      <div class="rt-l1-normal-wrap">
        <div class="rt-l1-header">
          <div class="rt-l1-header-text">
            Select all squares with<br>
            <strong id="rt-l1-category">${categoryLabel}</strong>
          </div>
          <div class="rt-l1-header-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </div>
        </div>
        <div class="rt-l1-grid" id="rt-l1-grid">
          ${nineIds.map((imgId, i) => `
            <div class="rt-l1-cell" data-index="${i}">
              <img src="https://picsum.photos/id/${imgId}/200/200" alt="captcha image"
                   loading="eager" crossorigin="anonymous"
                   onerror="this.src='https://picsum.photos/200/200?random=${i}'"/>
              <div class="rt-l1-check">✓</div>
            </div>
          `).join('')}
        </div>
        <div class="rt-l1-footer">
          <button class="rt-l1-verify-btn" id="rt-l1-submit">VERIFY</button>
        </div>
      </div>
    `;

    // Cell click handlers
    const cells = shadow.querySelectorAll('.rt-l1-cell');
    cells.forEach(cell => {
      cell.addEventListener('click', () => {
        const idx = parseInt(cell.dataset.index);
        if (selectedCells.has(idx)) {
          selectedCells.delete(idx);
          cell.classList.remove('selected');
          window.ReverseTest.Goldilocks.trackCorrection();
        } else {
          selectedCells.add(idx);
          cell.classList.add('selected');
        }
        window.ReverseTest.Goldilocks.trackClick(
          cell.getBoundingClientRect().x,
          cell.getBoundingClientRect().y
        );
      });
    });

    shadow.getElementById('rt-l1-submit').addEventListener('click', () => {
      if (selectedCells.size === 0) return;
      container.dispatchEvent(new CustomEvent('level-complete', { detail: validate() }));
    });
  }

  function validate() {
    const elapsed = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
    const speed = elapsed < 1.5 ? 1.0 : elapsed < 3 ? 0.7 : elapsed < 8 ? 0.3 : elapsed < 20 ? 0.1 : 0.05;
    const perfectMatch = selectedCells.size === correctCells.size &&
      [...selectedCells].every(c => correctCells.has(c));

    return {
      passed: selectedCells.size >= 2 && selectedCells.size <= 6,
      speedFactor: speed,
      perfect: perfectMatch && elapsed < 2,
      selected: [...selectedCells],
      elapsed
    };
  }

  function cleanup() { selectedCells.clear(); container = null; }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level1 = { render, validate, cleanup };
})();
