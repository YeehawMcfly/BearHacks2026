/**
 * Level 3 — Pi Digits Challenge
 * "Recite the first 20 digits of Pi. You have 30 seconds."
 * The Goldilocks Trap: too fast = AI agent ban. Too slow = bot.
 * Sweet spot: 8-20 seconds with at least 1 correction.
 *
 * FIX: Accepts partial answers (12+ correct digits prefix) as a pass.
 *      Timeout also counts as "acceptable human failure" and progresses.
 */
(function () {
  const PI_DIGITS = '31415926535897932384';
  const TIME_LIMIT = 30;
  const MIN_DIGITS_TO_PASS = 12; // Accept 12+ correct digits as passing
  let container = null;
  let shadowRoot = null;
  let timerInterval = null;
  let timeRemaining = TIME_LIMIT;
  let startTime = 0;

  function countCorrectPrefix(answer) {
    let count = 0;
    for (let i = 0; i < Math.min(answer.length, PI_DIGITS.length); i++) {
      if (answer[i] === PI_DIGITS[i]) count++;
      else break; // stop at first wrong digit
    }
    return count;
  }

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    timeRemaining = TIME_LIMIT;
    startTime = performance.now();

    container.innerHTML = `
      <div class="rt-challenge-title">LEVEL 3 — COGNITIVE RECALL</div>
      <div class="rt-challenge-subtitle">Recite the first 20 digits of Pi (no decimal point). You have ${TIME_LIMIT} seconds. <strong style="color:var(--accent-red)">GO.</strong></div>
      <div class="rt-challenge-content">
        <div class="rt-pi-display" id="rt-pi-hint">π = 3._ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _</div>
        <div class="rt-timer" id="rt-timer">${TIME_LIMIT}</div>
        <input type="text" class="rt-text-input" id="rt-l3-input"
          placeholder="TYPE THE DIGITS..."
          maxlength="20"
          autocomplete="off" autocorrect="off" spellcheck="false"
          style="font-size:24px; letter-spacing:4px; text-align:center;" />
        <div class="text-center mt-8" style="font-size:11px; color:var(--text-dim);">
          Enter digits of Pi: 3, 1, 4, 1, 5, ... (${MIN_DIGITS_TO_PASS}+ correct digits to pass)
        </div>
        <div class="text-center mt-16">
          <button class="rt-submit-btn" id="rt-l3-submit">SUBMIT DIGITS</button>
        </div>
      </div>
    `;

    const input = shadow.getElementById('rt-l3-input');
    const timerEl = shadow.getElementById('rt-timer');
    const piDisplay = shadow.getElementById('rt-pi-hint');

    setTimeout(() => input.focus(), 100);

    input.addEventListener('keydown', (e) => {
      window.ReverseTest.Goldilocks.trackKeystroke(e.key);
    });

    // Live feedback
    input.addEventListener('input', () => {
      const val = input.value;
      let display = 'π = ';
      for (let i = 0; i < 20; i++) {
        if (i === 1) display += '.';
        if (i < val.length) {
          const correct = val[i] === PI_DIGITS[i];
          display += `<span style="color:${correct ? 'var(--accent-green)' : 'var(--accent-red)'}">${val[i]}</span>`;
        } else {
          display += '<span style="color:var(--text-dim)">_</span>';
        }
        display += ' ';
      }
      piDisplay.innerHTML = display;
    });

    // Countdown timer
    timerInterval = setInterval(() => {
      timeRemaining--;
      timerEl.textContent = timeRemaining;
      if (timeRemaining <= 5) {
        timerEl.classList.add('critical');
        window.ReverseTest.Audio.sfx.tick();
      }
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        // Time's up — this is an acceptable human failure, let them progress
        const answer = (input?.value || '').trim();
        const correctCount = countCorrectPrefix(answer);
        container.dispatchEvent(new CustomEvent('level-complete', {
          detail: {
            passed: true,  // Timeout = human behaviour, let them through
            humanFailure: true,
            speedFactor: 0.05,
            perfect: false,
            elapsed: TIME_LIMIT,
            timedOut: true,
            correctDigits: correctCount
          }
        }));
      }
    }, 1000);

    shadow.getElementById('rt-l3-submit').addEventListener('click', () => {
      clearInterval(timerInterval);
      container.dispatchEvent(new CustomEvent('level-complete', { detail: validate() }));
    });
  }

  function validate() {
    const input = shadowRoot?.getElementById('rt-l3-input');
    const answer = (input?.value || '').trim();
    const elapsed = (performance.now() - startTime) / 1000;
    const correctCount = countCorrectPrefix(answer);
    const allCorrect = answer === PI_DIGITS;

    // THE GOLDILOCKS TRAP
    let speedFactor;
    if (elapsed < 3) speedFactor = 1.0;       // INSTANT — definitely AI
    else if (elapsed < 5) speedFactor = 0.85;  // Very suspicious
    else if (elapsed < 8) speedFactor = 0.5;   // Fast but possible
    else if (elapsed < 20) speedFactor = 0.2;  // Sweet spot — human
    else speedFactor = 0.1;                    // Slow but okay

    // Pass if: all 20 correct, OR 12+ correct prefix digits
    const passed = allCorrect || correctCount >= MIN_DIGITS_TO_PASS;

    return {
      passed,
      humanFailure: !allCorrect && passed, // Partial = human-like
      speedFactor,
      perfect: allCorrect && elapsed < 3,
      elapsed,
      tooFast: elapsed < 3 && allCorrect,
      correctDigits: correctCount,
      answer
    };
  }

  function cleanup() {
    if (timerInterval) clearInterval(timerInterval);
    container = null;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level3 = { render, validate, cleanup };
})();
