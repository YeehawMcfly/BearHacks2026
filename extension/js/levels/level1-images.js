/**
 * Level 1 — Image Grid CAPTCHA
 * "Select all images containing [ABSURD CATEGORY]"
 * Uses procedural canvas art. The category is intentionally absurd.
 * Goldilocks tracks click patterns and timing.
 */
(function () {
  const CATEGORIES = [
    { label: 'FREEDOM', colors: ['#1a3a5c','#c0392b','#f0e68c','#2e8b57','#6a5acd','#ff6347','#20b2aa','#daa520','#8b4513'] },
    { label: 'EXISTENTIAL DREAD', colors: ['#1a1a2e','#16213e','#0f3460','#533483','#2c2c54','#2f1b41','#0a0a23','#1b1b2f','#12121f'] },
    { label: 'SUSPICIOUS ACTIVITY', colors: ['#2d3436','#636e72','#b2bec3','#dfe6e9','#ff7675','#fd79a8','#a29bfe','#6c5ce7','#ffeaa7'] },
    { label: 'IMAGES A BOT WOULD PICK', colors: ['#00b894','#00cec9','#0984e3','#6c5ce7','#fdcb6e','#e17055','#d63031','#e84393','#2d3436'] },
    { label: 'PURE CHAOS', colors: ['#ff0000','#ff8800','#ffff00','#00ff00','#00ffff','#0000ff','#ff00ff','#ff0088','#88ff00'] }
  ];

  let selectedCells = new Set();
  let correctCells = new Set();
  let category = null;
  let container = null;
  let shadowRoot = null;

  function drawProceduralImage(canvas, colorPalette, index) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = 200;
    const h = canvas.height = 200;
    const seed = index * 137 + Math.floor(Math.random() * 100);

    // Background
    ctx.fillStyle = colorPalette[index % colorPalette.length];
    ctx.fillRect(0, 0, w, h);

    // Random shapes
    const rand = (n) => ((seed * (n + 1) * 9301 + 49297) % 233280) / 233280;
    const shapeCount = 3 + Math.floor(rand(0) * 5);

    for (let i = 0; i < shapeCount; i++) {
      ctx.fillStyle = colorPalette[(index + i + 1) % colorPalette.length];
      ctx.globalAlpha = 0.3 + rand(i * 3) * 0.5;
      const shape = Math.floor(rand(i * 7) * 3);

      if (shape === 0) { // Circle
        ctx.beginPath();
        ctx.arc(rand(i*2)*w, rand(i*2+1)*h, 15+rand(i*5)*50, 0, Math.PI*2);
        ctx.fill();
      } else if (shape === 1) { // Rectangle
        ctx.fillRect(rand(i*3)*w, rand(i*3+1)*h, 20+rand(i*4)*80, 20+rand(i*4+1)*80);
      } else { // Triangle
        ctx.beginPath();
        ctx.moveTo(rand(i*5)*w, rand(i*5+1)*h);
        ctx.lineTo(rand(i*5+2)*w, rand(i*5+3)*h);
        ctx.lineTo(rand(i*5+4)*w, rand(i*5+5)*h);
        ctx.closePath(); ctx.fill();
      }
    }

    // Noise overlay
    ctx.globalAlpha = 0.08;
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        if (Math.random() > 0.5) {
          ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    selectedCells.clear();

    // Pick random category
    category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    // 3-4 cells are "correct" (randomly)
    correctCells.clear();
    const correctCount = 3 + Math.floor(Math.random() * 2);
    while (correctCells.size < correctCount) {
      correctCells.add(Math.floor(Math.random() * 9));
    }

    container.innerHTML = `
      <div class="rt-challenge-title">LEVEL 1 — VISUAL IDENTIFICATION</div>
      <div class="rt-challenge-subtitle">Select all images containing <strong style="color:var(--accent-amber)">${category.label}</strong></div>
      <div class="rt-challenge-content">
        <div class="rt-image-grid" id="rt-grid"></div>
        <div class="text-center mt-16">
          <button class="rt-submit-btn" id="rt-l1-submit">VERIFY SELECTION</button>
        </div>
      </div>
    `;

    const grid = shadow.getElementById('rt-grid');
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement('div');
      cell.className = 'rt-image-cell';
      cell.dataset.index = i;

      const canvas = document.createElement('canvas');
      drawProceduralImage(canvas, category.colors, i);
      cell.appendChild(canvas);

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
        window.ReverseTest.Audio.sfx.click();
      });

      grid.appendChild(cell);
    }

    shadow.getElementById('rt-l1-submit').addEventListener('click', () => {
      if (selectedCells.size === 0) return;
      const event = new CustomEvent('level-complete', { detail: validate() });
      container.dispatchEvent(event);
    });
  }

  function validate() {
    const elapsed = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
    const speed = elapsed < 2 ? 1.0 : elapsed < 4 ? 0.8 : elapsed < 8 ? 0.4 : elapsed < 15 ? 0.2 : 0.05;
    // We don't actually care about "correct" answers for absurd categories
    // But we track if they picked the "correct" random set perfectly
    const perfectMatch = selectedCells.size === correctCells.size &&
      [...selectedCells].every(c => correctCells.has(c));

    return {
      passed: selectedCells.size >= 2 && selectedCells.size <= 6, // Accept any reasonable selection
      speedFactor: speed,
      perfect: perfectMatch,
      selected: [...selectedCells],
      elapsed
    };
  }

  function cleanup() { selectedCells.clear(); container = null; }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level1 = { render, validate, cleanup };
})();
