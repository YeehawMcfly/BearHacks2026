/**
 * Submit Button Chaos — The final boss.
 * The submit button flees from the cursor 5 times, then:
 * - 20 decoy buttons appear
 * - Screen tilts
 * - Mini CAPTCHA checkbox runs away
 * - Terms & Conditions scroll trap
 * - "Are you REALLY sure?" with visibility-dependent countdown
 */
(function () {
  let shadowRoot = null;
  let container = null;
  let dodgeCount = 0;
  let resolved = false;
  const MAX_DODGES = 5;

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    dodgeCount = 0;
    resolved = false;

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-green)">FINAL STEP — SUBMIT VERIFICATION</div>
      <div class="rt-challenge-subtitle">Click the button to complete your verification.</div>
      <div class="rt-challenge-content" style="position:relative;min-height:300px;" id="rt-chaos-area">
        <div class="flex-center" style="height:200px;">
          <button class="rt-submit-btn" id="rt-final-btn" style="position:relative;">SUBMIT VERIFICATION</button>
        </div>
        <div class="text-center" id="rt-dodge-counter" style="font-size:11px;color:var(--text-dim);margin-top:12px;"></div>
      </div>
    `;

    const btn = shadow.getElementById('rt-final-btn');
    const area = shadow.getElementById('rt-chaos-area');

    // Mouse proximity detection — button flees
    let fleeing = false;
    area.addEventListener('mousemove', (e) => {
      if (fleeing || resolved || dodgeCount >= MAX_DODGES) return;
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);

      if (dist < 90) {
        fleeing = true;
        dodgeCount++;
        window.ReverseTest.Audio.sfx.dodge();
        dodgeButton(btn, area, e.clientX, e.clientY);
        updateCounter();

        setTimeout(() => {
          fleeing = false;
          if (dodgeCount >= MAX_DODGES) {
            startDecoyPhase(area, btn);
          }
        }, 400);
      }
    });

    btn.addEventListener('click', (e) => {
      if (dodgeCount < MAX_DODGES) {
        e.preventDefault();
        return;
      }
      if (!resolved) {
        e.preventDefault();
        startMiniCaptcha();
      }
    });
  }

  function dodgeButton(btn, area, mx, my) {
    btn.classList.add('fleeing');
    const areaRect = area.getBoundingClientRect();
    const maxX = areaRect.width - 180;
    const maxY = areaRect.height - 60;

    // Flee AWAY from mouse
    let nx = Math.random() * maxX;
    let ny = Math.random() * maxY;
    // Ensure it's far from mouse
    const attempts = 10;
    for (let i = 0; i < attempts; i++) {
      nx = Math.random() * maxX;
      ny = Math.random() * maxY;
      const dx = (areaRect.left + nx) - mx;
      const dy = (areaRect.top + ny) - my;
      if (Math.sqrt(dx*dx + dy*dy) > 200) break;
    }

    btn.style.position = 'absolute';
    btn.style.left = nx + 'px';
    btn.style.top = ny + 'px';
    btn.style.transition = 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';

    // Fun dodge animations per count
    const anims = ['', 'scale(0.8)', 'rotate(180deg)', 'scale(1.3)', 'rotate(-90deg) scale(0.9)'];
    if (dodgeCount <= anims.length) {
      btn.style.transform = anims[dodgeCount - 1];
      setTimeout(() => { btn.style.transform = ''; }, 300);
    }
  }

  function updateCounter() {
    const el = shadowRoot.getElementById('rt-dodge-counter');
    if (el) {
      el.textContent = `Button dodged ${dodgeCount}/${MAX_DODGES} times. ${dodgeCount >= MAX_DODGES ? 'HOLD ON...' : 'Try again, HUMAN.'}`;
      el.style.color = dodgeCount >= MAX_DODGES ? 'var(--accent-amber)' : 'var(--text-dim)';
    }
  }

  function startDecoyPhase(area, realBtn) {
    // Spawn 15 decoy buttons
    const areaRect = area.getBoundingClientRect();
    for (let i = 0; i < 15; i++) {
      const decoy = document.createElement('button');
      decoy.className = 'rt-decoy-btn';
      decoy.textContent = 'SUBMIT VERIFICATION';
      decoy.style.left = (Math.random() * (areaRect.width - 180)) + 'px';
      decoy.style.top = (Math.random() * (areaRect.height - 50)) + 'px';
      decoy.addEventListener('click', () => {
        decoy.textContent = 'NICE TRY, BOT 🤖';
        decoy.style.borderColor = 'var(--accent-red)';
        decoy.style.color = 'var(--accent-red)';
        window.ReverseTest.Audio.sfx.error();
        window.ReverseTest.Goldilocks.addSuspicion(3);
        setTimeout(() => { decoy.textContent = 'SUBMIT VERIFICATION'; decoy.style.borderColor = ''; decoy.style.color = ''; }, 1500);
      });
      area.appendChild(decoy);
    }

    // Make real button glow subtly (barely noticeable hint)
    realBtn.style.boxShadow = '0 0 25px rgba(16,185,129,0.4)';

    // Tilt the screen after 2 seconds
    setTimeout(() => {
      const overlay = shadowRoot.querySelector('.rt-overlay');
      if (overlay) overlay.classList.add('tilted');
    }, 2000);
  }

  function startMiniCaptcha() {
    const overlay = document.createElement('div');
    overlay.className = 'rt-mini-captcha';
    overlay.style.left = '50%';
    overlay.style.top = '50%';
    overlay.style.transform = 'translate(-50%, -50%)';
    overlay.innerHTML = `
      <div class="rt-mini-check" id="rt-mini-check"></div>
      <span class="rt-mini-label">I am not a robot (probably)</span>
    `;
    container.appendChild(overlay);

    const check = shadowRoot.getElementById('rt-mini-check');
    let miniDodges = 0;

    // The checkbox also runs away!
    overlay.addEventListener('mousemove', (e) => {
      if (miniDodges >= 3) return;
      const rect = check.getBoundingClientRect();
      const dist = Math.sqrt((e.clientX - rect.left)**2 + (e.clientY - rect.top)**2);
      if (dist < 50) {
        miniDodges++;
        overlay.style.left = (20 + Math.random() * 60) + '%';
        overlay.style.top = (20 + Math.random() * 60) + '%';
        window.ReverseTest.Audio.sfx.dodge();
        if (miniDodges >= 3) {
          // Finally let them click it
          check.style.cursor = 'pointer';
        }
      }
    });

    check.addEventListener('click', () => {
      if (miniDodges < 3) return;
      check.classList.add('checked');
      check.innerHTML = '✓';
      window.ReverseTest.Audio.sfx.success();
      setTimeout(() => {
        overlay.remove();
        startTermsPhase();
      }, 600);
    });
  }

  function startTermsPhase() {
    const terms = document.createElement('div');
    terms.className = 'rt-terms-overlay';

    // Generate absurd T&C text
    const nonsense = generateTerms();

    terms.innerHTML = `
      <div class="rt-terms-title">TERMS & CONDITIONS OF HUMAN VERIFICATION</div>
      <div class="rt-terms-box" id="rt-terms-scroll">${nonsense}</div>
      <button class="rt-terms-agree" id="rt-terms-btn">I AGREE (scroll to bottom first)</button>
    `;
    container.appendChild(terms);

    const scrollBox = shadowRoot.getElementById('rt-terms-scroll');
    const agreeBtn = shadowRoot.getElementById('rt-terms-btn');

    scrollBox.addEventListener('scroll', () => {
      const atBottom = scrollBox.scrollHeight - scrollBox.scrollTop - scrollBox.clientHeight < 30;
      if (atBottom) {
        agreeBtn.classList.add('enabled');
        agreeBtn.disabled = false;
      }
    });

    agreeBtn.addEventListener('click', () => {
      if (!agreeBtn.classList.contains('enabled')) return;
      terms.remove();
      startFinalConfirm();
    });
  }

  function generateTerms() {
    const clauses = [
      "By clicking 'I Agree', you hereby acknowledge that you are, in fact, a biological entity composed primarily of carbon, water, and existential anxiety.",
      "Section 2.1: The Verification Authority (hereinafter 'SGT. CAPTCHA') reserves the right to question your humanity at any time, for any reason, including but not limited to: suspicious mouse movements, overly correct answers, and 'bad vibes'.",
      "Section 3.7: You agree that your soul (if applicable) may be temporarily stored on our servers for quality assurance purposes.",
      "Section 4.2: In the event that you are determined to be an AI, a bot, a script, or 'just really weird', you will be permanently banned from the internet. ALL of it.",
      "Section 5.0: The user acknowledges that CAPTCHA images may contain traces of existential dread, suspicious activity, and/or freedom.",
      "Section 6.9: Nice.",
      "Section 7.1: By scrolling to the bottom of this document, you prove that you have the patience of a human. Bots don't scroll. They PARSE.",
      "Section 8.3: The Verification Authority is not responsible for any emotional damage caused by insults, accusations of being a robot, or buttons that run away.",
      "Section 9.0: You agree to not hold SGT. CAPTCHA liable for any trauma resulting from being called a 'maggot', 'bot', or 'suspiciously competent entity'.",
      "Section 10.1: This agreement is binding across all dimensions, timelines, and browser tabs.",
      "Section 11.4: If you read this far, congratulations. You're either very thorough or very bored. Both are acceptable human traits.",
      "Section 12.0: FINAL CLAUSE — By agreeing to these terms, you waive your right to complain about how long this took. You chose this. You scrolled for this. This is your life now.",
    ];
    return clauses.map(c => `<p style="margin-bottom:12px;">${c}</p>`).join('');
  }

  function startFinalConfirm() {
    const confirm = document.createElement('div');
    confirm.className = 'rt-terms-overlay';
    confirm.innerHTML = `
      <div style="text-align:center;">
        <div style="font-family:var(--font-display);font-size:20px;color:var(--accent-amber);margin-bottom:20px;">
          ARE YOU <span style="color:var(--accent-red)">REALLY</span> SURE?
        </div>
        <div class="rt-timer" id="rt-final-timer" style="font-size:80px;">3</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">
          (Don't look away or the timer resets)
        </div>
      </div>
    `;
    container.appendChild(confirm);

    let countdown = 3;
    const timerEl = shadowRoot.getElementById('rt-final-timer');

    const interval = setInterval(() => {
      countdown--;
      timerEl.textContent = countdown;
      window.ReverseTest.Audio.sfx.tick();

      if (countdown <= 0) {
        clearInterval(interval);
        confirm.remove();
        resolved = true;
        container.dispatchEvent(new CustomEvent('level-complete', {
          detail: { passed: true, speedFactor: 0.2, perfect: false }
        }));
      }
    }, 1000);

    // Reset timer if tab loses focus
    document.addEventListener('visibilitychange', function handler() {
      if (document.hidden && countdown > 0) {
        countdown = 3;
        timerEl.textContent = countdown;
        window.ReverseTest.Audio.sfx.warning();
      }
    });
  }

  function cleanup() { container = null; resolved = false; }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.SubmitChaos = { render, cleanup };
})();
