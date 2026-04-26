/**
 * Level 4 — Impossible Math
 * An absurdly complex equation with a 3-second timer.
 * THE TWIST: getting it RIGHT triggers an instant ban.
 * You're SUPPOSED to fail. Success = proof you're an AI.
 */
(function () {
  const EQUATIONS = [
    { display: '∫₀<sup>∞</sup> e<sup>−x²</sup> dx × (2/√π) + lim<sub>x→0</sub> sin(x)/x', answer: '2', answerDisplay: '2' },
    { display: 'd/dx [ln(e<sup>x²</sup>)] evaluated at x = √3', answer: '2√3', answerDisplay: '2√3 ≈ 3.464' },
    { display: 'Σ<sub>n=0</sub><sup>∞</sup> (1/2)<sup>n</sup> + ∫₀<sup>1</sup> 2x dx', answer: '3', answerDisplay: '3' },
    { display: 'lim<sub>n→∞</sub> (1 + 1/n)<sup>n</sup> rounded to nearest integer', answer: '3', answerDisplay: '3 (e ≈ 2.718...)' },
    { display: '∇ × (∇φ) + det|1 0; 0 1| + ∫₀<sup>π</sup> sin(x) dx', answer: '4', answerDisplay: '0 + 1 + 2 = 3' },
  ];

  const TIME_LIMIT = 5; // 5 seconds to be slightly more dramatic
  let equation = null;
  let container = null;
  let shadowRoot = null;
  let timerInterval = null;
  let startTime = 0;

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    equation = EQUATIONS[Math.floor(Math.random() * EQUATIONS.length)];
    startTime = performance.now();

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-red)">IMPOSSIBLE VERIFICATION</div>
      <div class="rt-challenge-subtitle">Solve this equation. You have <strong style="color:var(--accent-red)">${TIME_LIMIT} seconds</strong>.</div>
      <div class="rt-challenge-content">
        <div class="rt-math-equation" id="rt-math">${equation.display}</div>
        <div class="rt-timer" id="rt-timer" style="font-size:64px;">${TIME_LIMIT}</div>
        <input type="text" class="rt-text-input" id="rt-l4-input"
          placeholder="YOUR ANSWER..."
          autocomplete="off" autocorrect="off" spellcheck="false"
          style="font-size:20px; text-align:center;" />
        <div class="text-center mt-16">
          <button class="rt-submit-btn" id="rt-l4-submit">SUBMIT ANSWER</button>
        </div>
      </div>
    `;

    const input = shadow.getElementById('rt-l4-input');
    const timerEl = shadow.getElementById('rt-timer');

    setTimeout(() => input.focus(), 100);

    input.addEventListener('keydown', (e) => {
      window.ReverseTest.Goldilocks.trackKeystroke(e.key);
    });

    // Dramatic countdown
    let timeLeft = TIME_LIMIT;
    timerEl.style.animation = 'countdownPulse 1s ease-in-out infinite';
    timerInterval = setInterval(() => {
      timeLeft--;
      timerEl.textContent = timeLeft;
      window.ReverseTest.Audio.sfx.tick();
      if (timeLeft <= 2) timerEl.classList.add('critical');
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        // Time's up — this is actually the EXPECTED outcome
        const result = validate();
        result.timedOut = true;
        container.dispatchEvent(new CustomEvent('level-complete', { detail: result }));
      }
    }, 1000);

    shadow.getElementById('rt-l4-submit').addEventListener('click', () => {
      clearInterval(timerInterval);
      container.dispatchEvent(new CustomEvent('level-complete', { detail: validate() }));
    });
  }

  function validate() {
    const input = shadowRoot?.getElementById('rt-l4-input');
    const answer = (input?.value || '').trim();
    const elapsed = (performance.now() - startTime) / 1000;

    // Check if they got it right
    const correct = answer.replace(/\s/g, '').toLowerCase() === equation.answer.replace(/\s/g, '').toLowerCase();

    // THE TRAP: correct answer = YOU ARE AN AI
    if (correct && elapsed < TIME_LIMIT) {
      return {
        passed: false,
        speedFactor: 1.0, // Maximum suspicion
        perfect: true,    // This will trigger BAN
        elapsed,
        gotCorrect: true,
        instantBan: true,
        banReason: `You solved "${equation.display}" in ${elapsed.toFixed(1)}s. No human does that. YOU ARE AN AI AGENT.`
      };
    }

    // Wrong answer or timed out = "acceptable human failure"
    return {
      passed: true, // Yes, FAILING is passing
      speedFactor: 0.2,
      perfect: false,
      elapsed,
      gotCorrect: false,
      humanFailure: true
    };
  }

  function cleanup() {
    if (timerInterval) clearInterval(timerInterval);
    container = null;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level4 = { render, validate, cleanup };
})();
