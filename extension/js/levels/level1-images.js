/**
 * Level 1 — Image grid CAPTCHA (reCAPTCHA-style)
 * Primary: POST /api/ai/level1-captcha (Pexels + LoremFlickr on server).
 * Fallback: LoremFlickr-only when server unreachable (topic list mirrors server/level1Topics.mjs).
 */
(function () {
  /** Aligned with server/level1Topics.mjs */
  const L1_OFFLINE_TOPICS = [
    { id: 'hydrant', label: 'a fire hydrant', loremTag: 'fire,hydrant' },
    { id: 'donut', label: 'a donut', loremTag: 'doughnut,glazed' },
    { id: 'traffic_light', label: 'a traffic light', loremTag: 'stoplight,signal' }
  ];
  const OFFLINE_NEG_TAGS = [
    'shark,underwater', 'penguin,ice', 'volcano,lava', 'galaxy,space', 'desert,landscape', 'eagle,mountain', 'medusa,ocean'
  ];

  let selectedCells = new Set();
  let correctCells = new Set();
  let line1Text = 'Select all images that contain';
  let categoryLabel = '';
  let container = null;

  function loremFlickrUrl(tagComma, lock) {
    return `https://loremflickr.com/280/280/${tagComma}?lock=${lock}`;
  }

  function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /** Same topic pool + layout as server/level1Remote.mjs when API is unavailable. */
  function buildOfflineChallenge() {
    const topic = L1_OFFLINE_TOPICS[Math.floor(Math.random() * L1_OFFLINE_TOPICS.length)];
    const kPos = 2 + Math.floor(Math.random() * 3);
    const nNeg = 9 - kPos;
    const lock0 = (Date.now() % 200000) + Math.floor(Math.random() * 1000);
    const posUrls = [];
    for (let p = 0; p < kPos; p++) {
      posUrls.push(loremFlickrUrl(topic.loremTag, lock0 + p * 17));
    }
    const negUrls = [];
    for (let q = 0; q < nNeg; q++) {
      const tag = OFFLINE_NEG_TAGS[q % OFFLINE_NEG_TAGS.length];
      negUrls.push(loremFlickrUrl(tag, lock0 + 500 + q * 19));
    }
    const tiles = [
      ...posUrls.map((url) => ({ url, isPositive: true })),
      ...negUrls.map((url) => ({ url, isPositive: false }))
    ];
    shuffleInPlace(tiles);
    const imageUrls = tiles.map((t) => t.url);
    const correctIndices = [];
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i].isPositive) correctIndices.push(i);
    }
    return {
      missionId: topic.id,
      label: topic.label,
      line1: 'Select all images that contain',
      imageUrls,
      correctIndices
    };
  }

  function buildHtml(count) {
    const cells = Array.from({ length: count }, (_, i) => i)
      .map(
        (i) => `
            <div class="rt-l1-cell" data-index="${i}">
              <div class="rt-l1-shimmer" id="rt-l1-shimmer-${i}"></div>
              <img id="rt-l1-img-${i}" alt="captcha image" style="opacity:0;transition:opacity 0.3s;" />
              <div class="rt-l1-check">✓</div>
            </div>
          `
      )
      .join('');
    return `
      <div class="rt-l1-normal-wrap">
        <div class="rt-l1-header">
          <div class="rt-l1-header-text">
            <span id="rt-l1-line1"></span><br>
            <strong id="rt-l1-category"></strong>
          </div>
          <div class="rt-l1-header-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </div>
        </div>
        <div class="rt-l1-grid" id="rt-l1-grid">
          ${cells}
        </div>
        <div class="rt-l1-footer">
          <button class="rt-l1-verify-btn" id="rt-l1-submit">VERIFY</button>
        </div>
      </div>
    `;
  }

  function wireLine1Label(shadow, line1, label) {
    const l1 = shadow.getElementById('rt-l1-line1');
    const cat = shadow.getElementById('rt-l1-category');
    if (l1) l1.textContent = line1;
    if (cat) cat.textContent = label;
  }

  function bindCells(shadow) {
    const cells = shadow.querySelectorAll('.rt-l1-cell');
    cells.forEach((cell) => {
      cell.addEventListener('click', () => {
        const idx = parseInt(cell.dataset.index, 10);
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
  }

  function loadRemoteImages(shadow, urls) {
    urls.forEach((url, i) => {
      const img = shadow.getElementById(`rt-l1-img-${i}`);
      const shimmer = shadow.getElementById(`rt-l1-shimmer-${i}`);
      if (!img) return;
      try {
        chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url }, (res) => {
          if (res && res.dataUrl) {
            img.src = res.dataUrl;
            img.onload = () => {
              img.style.opacity = '1';
              if (shimmer) shimmer.style.display = 'none';
            };
          } else if (shimmer) {
            shimmer.style.display = 'flex';
            shimmer.style.alignItems = 'center';
            shimmer.style.justifyContent = 'center';
            shimmer.textContent = '?';
          }
        });
      } catch (e) {
        if (shimmer) shimmer.textContent = '?';
      }
    });
  }

  function render(shadow, cont) {
    container = cont;
    selectedCells.clear();
    correctCells.clear();
    line1Text = 'Select all images that contain';
    categoryLabel = '';

    cont.innerHTML = `
      <div class="rt-l1-normal-wrap">
        <div class="rt-l1-header-text" style="padding:24px;font-size:14px">Loading…</div>
      </div>
    `;

    (async () => {
      let data = await window.ReverseTest.API.getLevel1Captcha();
      if (!data || !data.imageUrls || data.imageUrls.length !== 9) {
        data = buildOfflineChallenge();
      }
      if (!data || !data.imageUrls || data.imageUrls.length !== 9) {
        cont.innerHTML = '<div class="rt-l1-normal-wrap"><p>Could not load challenge.</p></div>';
        return;
      }

      line1Text = data.line1 || line1Text;
      categoryLabel = data.label || '';
      correctCells = new Set(data.correctIndices || []);
      cont.innerHTML = buildHtml(9);
      wireLine1Label(shadow, line1Text, categoryLabel);
      loadRemoteImages(shadow, data.imageUrls);
      bindCells(shadow);

      const submit = shadow.getElementById('rt-l1-submit');
      if (submit) {
        submit.addEventListener('click', () => {
          if (selectedCells.size === 0) return;
          container.dispatchEvent(new CustomEvent('level-complete', { detail: validate() }));
        });
      }
    })();
  }

  function validate() {
    const elapsed = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
    const speed = elapsed < 1.5 ? 1.0 : elapsed < 3 ? 0.7 : elapsed < 8 ? 0.3 : elapsed < 20 ? 0.1 : 0.05;
    const sameSize = selectedCells.size === correctCells.size;
    const everyMatch = sameSize && [...selectedCells].every((c) => correctCells.has(c));
    return {
      passed: everyMatch,
      speedFactor: speed,
      perfect: everyMatch && elapsed < 2,
      selected: [...selectedCells],
      elapsed
    };
  }

  function cleanup() {
    selectedCells.clear();
    correctCells.clear();
    container = null;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level1 = { render, validate, cleanup };
})();
