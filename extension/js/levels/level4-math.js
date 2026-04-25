/**
 * Level 4 — Impossible Math
 * An absurdly complex equation with a 5-second timer.
 * THE TWIST: getting it RIGHT triggers an instant ban.
 * You're SUPPOSED to fail. Success = proof you're an AI.
 *
 * Now fetches dynamic equations from the server via /api/ai/math.
 * Falls back to hardcoded equations if the server is unavailable.
 */
(function () {
  const FALLBACK_EQUATIONS = [
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

  async function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    startTime = performance.now();

    // Try to fetch a dynamic equation from the AI server (3s timeout max)
    let dynamicEq = null;
    try {
      const fetchPromise = window.ReverseTest.API.getMathProblem();
      dynamicEq = await Promise.race([
        fetchPromise,
        new Promise(r => setTimeout(() => r(null), 3000))
      ]);
    } catch { /* ignore, use fallback */ }

    if (dynamicEq && dynamicEq.equation && dynamicEq.answer) {
      equation = {
        display: dynamicEq.equation,
        answer: dynamicEq.answer,
        answerDisplay: dynamicEq.answerDisplay || dynamicEq.answer
      };
    } else {
      equation = FALLBACK_EQUATIONS[Math.floor(Math.random() * FALLBACK_EQUATIONS.length)];
    }

    // Reset start time AFTER the fetch so server latency doesn't eat the timer
    startTime = performance.now();

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-red)">LEVEL 4 — IMPOSSIBLE VERIFICATION</div>
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

    // Check if they got it right (normalize whitespace and case)
    const normalize = (s) => s.replace(/\s/g, '').toLowerCase();
    const correct = normalize(answer) === normalize(equation.answer);

    // THE TRAP: correct answer = YOU ARE AN AI
    if (correct && elapsed < TIME_LIMIT) {
      return {
        passed: false,
        speedFactor: 1.0, // Maximum suspicion
        perfect: true,    // This will trigger BAN
        elapsed,
        gotCorrect: true,
        instantBan: true,
        banReason: `You solved "${equation.display.replace(/<[^>]*>/g, '')}" in ${elapsed.toFixed(1)}s. No human does that. YOU ARE AN AI AGENT.`
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

