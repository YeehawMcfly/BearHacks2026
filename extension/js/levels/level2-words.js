/**
 * Level 2 — Distorted Word Rewrite
 * Military jargon rendered with extreme CSS/canvas distortion.
 * Goldilocks tracks typing speed, corrections, keystroke intervals.
 */
(function () {
  const WORDS = [
    'INSUBORDINATION', 'DERELICTION', 'COURT-MARTIAL',
    'RECONNAISSANCE', 'FLANK', 'BATTALION',
    'MAGGOT', 'VERIFICATION', 'PROTOCOL'
  ];

  let targetWord = '';
  let container = null;
  let shadowRoot = null;

  function drawDistortedWord(canvas, word) {
    const ctx = canvas.getContext('2d');
    canvas.width = 500;
    canvas.height = 120;

    // Dark background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Noise background
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = `rgba(${Math.random()*100}, ${Math.random()*100}, ${Math.random()*100}, ${Math.random()*0.3})`;
      ctx.fillRect(Math.random()*500, Math.random()*120, Math.random()*4+1, Math.random()*4+1);
    }

    // Random lines (interference)
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = `rgba(${50+Math.random()*100}, ${50+Math.random()*100}, ${50+Math.random()*100}, ${0.2+Math.random()*0.3})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, Math.random() * 120);
      ctx.bezierCurveTo(
        Math.random()*250, Math.random()*120,
        250+Math.random()*250, Math.random()*120,
        500, Math.random()*120
      );
      ctx.stroke();
    }

    // Draw each character with individual transforms
    const fontSize = Math.min(36, 400 / word.length);
    ctx.font = `bold ${fontSize}px 'Courier New', monospace`;
    ctx.textBaseline = 'middle';

    const totalWidth = ctx.measureText(word).width;
    let x = (canvas.width - totalWidth) / 2;

    for (let i = 0; i < word.length; i++) {
      ctx.save();
      const charWidth = ctx.measureText(word[i]).width;
      const offsetY = Math.sin(i * 0.8) * 12 + (Math.random() - 0.5) * 8;
      const rotation = (Math.random() - 0.5) * 0.3;
      const scale = 0.85 + Math.random() * 0.3;

      ctx.translate(x + charWidth/2, 60 + offsetY);
      ctx.rotate(rotation);
      ctx.scale(scale, scale + (Math.random()-0.5)*0.2);

      // Color variation
      const hue = 150 + Math.random() * 60;
      ctx.fillStyle = `hsl(${hue}, 70%, 65%)`;
      ctx.fillText(word[i], -charWidth/2, 0);

      // Ghost/shadow copy
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#ff2d2d';
      ctx.fillText(word[i], -charWidth/2 + 2, 1);
      ctx.fillStyle = '#06b6d4';
      ctx.fillText(word[i], -charWidth/2 - 2, -1);
      ctx.globalAlpha = 1;

      ctx.restore();
      x += charWidth;
    }
  }

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    targetWord = WORDS[Math.floor(Math.random() * WORDS.length)];

    container.innerHTML = `
      <div class="rt-challenge-title">LEVEL 2 — OPTICAL VERIFICATION</div>
      <div class="rt-challenge-subtitle">Type the distorted word exactly as shown</div>
      <div class="rt-challenge-content">
        <div class="rt-distorted-wrap">
          <canvas class="rt-distorted-canvas" id="rt-distorted"></canvas>
        </div>
        <input type="text" class="rt-text-input" id="rt-l2-input"
          placeholder="TYPE THE WORD HERE, SOLDIER"
          autocomplete="off" autocorrect="off" spellcheck="false" />
        <div class="text-center mt-16">
          <button class="rt-submit-btn" id="rt-l2-submit">VERIFY WORD</button>
        </div>
      </div>
    `;

    const canvas = shadow.getElementById('rt-distorted');
    drawDistortedWord(canvas, targetWord);

    const input = shadow.getElementById('rt-l2-input');
    input.addEventListener('keydown', (e) => {
      window.ReverseTest.Goldilocks.trackKeystroke(e.key);
    });
    input.addEventListener('focus', () => input.select());

    shadow.getElementById('rt-l2-submit').addEventListener('click', () => {
      const result = validate();
      if (!result.passed) {
        input.classList.add('error');
        window.ReverseTest.Audio.sfx.error();
        setTimeout(() => input.classList.remove('error'), 500);
        // Give them another chance with minimal suspicion
        window.ReverseTest.Goldilocks.addSuspicion(1);
        return;
      }
      container.dispatchEvent(new CustomEvent('level-complete', { detail: result }));
    });
  }

  function validate() {
    const input = shadowRoot.getElementById('rt-l2-input');
    const answer = (input?.value || '').trim().toUpperCase();
    const correct = answer === targetWord;
    const elapsed = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
    // Only suspicious if typed impossibly fast (< 1.5s for a long word)
    const speed = elapsed < 1.5 ? 1.0 : elapsed < 3 ? 0.6 : elapsed < 15 ? 0.15 : 0.1;

    return {
      passed: correct,
      speedFactor: speed,
      perfect: correct && window.ReverseTest.Goldilocks._corrections === 0,
      elapsed,
      answer
    };
  }

  function cleanup() { container = null; }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level2 = { render, validate, cleanup };
})();
