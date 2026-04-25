/**
 * Submit Button Chaos — The final boss.
 * Flow:
 *   1. Button dodges cursor 5 times with escalating taunts
 *   2. Decoy buttons flood the screen (staggered spawn)
 *   3. User clicks the real button (subtly glowing)
 *   4. SGT. CAPTCHA says "JUST KIDDING" — fake ban scare
 *   5. A clean final button appears — user clicks to pass
 */
(function () {
  let shadowRoot = null;
  let container = null;
  let dodgeCount = 0;
  let resolved = false;
  const MAX_DODGES = 5;

  const DODGE_TAUNTS = [
    "Too slow, MAGGOT!",
    "You call that a click?!",
    "MY GRANDMOTHER IS FASTER!",
    "Are you even TRYING?!",
    "LAST CHANCE, WORM!"
  ];

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    dodgeCount = 0;
    resolved = false;

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-green)">FINAL STEP — SUBMIT VERIFICATION</div>
      <div class="rt-challenge-subtitle">Click the button to complete your verification.</div>
      <div class="rt-challenge-content" style="position:relative;min-height:420px;overflow:hidden;" id="rt-chaos-area">
        <div class="flex-center" style="height:200px;">
          <button class="rt-submit-btn" id="rt-final-btn" style="position:relative;">SUBMIT VERIFICATION</button>
        </div>
        <div class="text-center" id="rt-dodge-counter" style="font-size:11px;color:var(--text-dim);margin-top:12px;"></div>
        <div id="rt-taunt" style="text-align:center;font-family:var(--font-mono);font-size:13px;color:var(--accent-red);margin-top:8px;min-height:20px;"></div>
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

      if (dist < 100) {
        fleeing = true;
        dodgeCount++;
        window.ReverseTest.Audio.sfx.dodge();
        dodgeButton(btn, area, e.clientX, e.clientY);
        updateCounter();
        showTaunt(DODGE_TAUNTS[dodgeCount - 1]);

        setTimeout(() => {
          fleeing = false;
          if (dodgeCount >= MAX_DODGES) {
            startDecoyPhase(area, btn);
          }
        }, 400);
      }
    });

    btn.addEventListener('click', (e) => {
      if (resolved) return;
      if (dodgeCount < MAX_DODGES) {
        e.preventDefault();
        return;
      }
      // They found the real button among decoys!
      e.preventDefault();
      startJustKidding();
    });
  }

  function showTaunt(text) {
    const el = shadowRoot.getElementById('rt-taunt');
    if (el) {
      el.textContent = text;
      el.style.animation = 'none';
      void el.offsetHeight; // force reflow
      el.style.animation = 'shake 0.4s';
    }
  }

  function dodgeButton(btn, area, mx, my) {
    btn.classList.add('fleeing');
    const areaRect = area.getBoundingClientRect();
    const maxX = areaRect.width - 200;
    const maxY = areaRect.height - 60;

    // Flee AWAY from mouse
    let nx, ny;
    for (let i = 0; i < 15; i++) {
      nx = 10 + Math.random() * maxX;
      ny = 10 + Math.random() * maxY;
      const dx = (areaRect.left + nx) - mx;
      const dy = (areaRect.top + ny) - my;
      if (Math.sqrt(dx*dx + dy*dy) > 180) break;
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
      el.textContent = dodgeCount >= MAX_DODGES ? 'HOLD ON...' : '';
      el.style.color = 'var(--accent-amber)';
    }
  }

  function startDecoyPhase(area, realBtn) {
    const areaRect = area.getBoundingClientRect();
    const w = areaRect.width;
    const h = areaRect.height;

    // Clear the taunt + counter
    const tauntEl = shadowRoot.getElementById('rt-taunt');
    if (tauntEl) tauntEl.textContent = 'Find the REAL button...';
    const counterEl = shadowRoot.getElementById('rt-dodge-counter');
    if (counterEl) counterEl.textContent = '';

    // Spawn decoy buttons with staggered animation
    const decoyCount = 20;
    for (let i = 0; i < decoyCount; i++) {
      setTimeout(() => {
        const decoy = document.createElement('button');
        decoy.className = 'rt-decoy-btn';
        decoy.textContent = 'SUBMIT VERIFICATION';
        decoy.style.position = 'absolute';
        decoy.style.left = (10 + Math.random() * (w - 210)) + 'px';
        decoy.style.top = (10 + Math.random() * (h - 60)) + 'px';
        decoy.style.opacity = '0';
        decoy.style.transition = 'opacity 0.2s, border-color 0.2s, color 0.2s, transform 0.2s';

        decoy.addEventListener('click', () => {
          decoy.textContent = '\u274C NICE TRY';
          decoy.style.borderColor = 'var(--accent-red)';
          decoy.style.color = 'var(--accent-red)';
          decoy.style.transform = 'scale(0.9)';
          window.ReverseTest.Audio.sfx.error();
          window.ReverseTest.Goldilocks.addSuspicion(2);
          setTimeout(() => {
            decoy.textContent = 'SUBMIT VERIFICATION';
            decoy.style.borderColor = '';
            decoy.style.color = '';
            decoy.style.transform = '';
          }, 1200);
        });

        area.appendChild(decoy);
        // Fade in
        requestAnimationFrame(() => { decoy.style.opacity = '1'; });
        window.ReverseTest.Audio.sfx.click();
      }, i * 80); // staggered spawn: each 80ms
    }

    // Move the real button to a new random position among decoys
    realBtn.style.left = (10 + Math.random() * (w - 210)) + 'px';
    realBtn.style.top = (10 + Math.random() * (h - 60)) + 'px';
    // Subtle glow hint — the only visual difference
    realBtn.style.boxShadow = '0 0 30px rgba(16,185,129,0.35)';
    realBtn.style.zIndex = '200';

    // Tilt the screen after 2 seconds for extra chaos
    setTimeout(() => {
      const overlay = shadowRoot.querySelector('.rt-overlay');
      if (overlay) overlay.classList.add('tilted');
    }, 2000);
  }

  function startJustKidding() {
    // Clear everything from the area
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:350px;gap:20px;">
        <div id="rt-jk-stamp" style="
          font-family:var(--font-display);font-size:56px;color:var(--accent-red);
          letter-spacing:6px;text-shadow:0 0 40px rgba(255,45,45,0.5);
          transform:rotate(-5deg);border:4px solid var(--accent-red);
          padding:12px 32px;border-radius:8px;animation:stampIn 0.5s cubic-bezier(0.17,0.67,0.24,1.2);
        ">BANNED</div>
        <div id="rt-jk-reason" style="
          font-family:var(--font-mono);font-size:14px;color:var(--text-dim);text-align:center;max-width:400px;
        ">Suspicion threshold exceeded. AI behavior confirmed. Internet access revoked.</div>
      </div>
    `;

    // Un-tilt immediately
    const overlay = shadowRoot.querySelector('.rt-overlay');
    if (overlay) overlay.classList.remove('tilted');

    // Ban alarm
    window.ReverseTest.Audio.sfx.ban();
    window.ReverseTest.Audio.sfx.alarm();

    // Wait 2.5 seconds, then reveal it's a joke
    setTimeout(() => {
      const stamp = shadowRoot.getElementById('rt-jk-stamp');
      const reason = shadowRoot.getElementById('rt-jk-reason');

      if (stamp) {
        stamp.style.transition = 'all 0.6s';
        stamp.style.color = 'var(--accent-green)';
        stamp.style.borderColor = 'var(--accent-green)';
        stamp.style.textShadow = '0 0 40px rgba(16,185,129,0.5)';
        stamp.textContent = 'JUST KIDDING';
      }
      if (reason) {
        reason.textContent = '...you actually fell for that? Click below to finish, you paranoid little human.';
        reason.style.color = 'var(--text-primary)';
      }

      window.ReverseTest.Audio.sfx.success();
      window.ReverseTest.Audio.speak("Just kidding. You may proceed. But I will be watching. ALWAYS watching.", 'sinister');

      // Show the REAL final button after a beat
      setTimeout(() => {
        const wrapper = container.querySelector('div');
        if (!wrapper) return;

        const btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'text-align:center;margin-top:24px;animation:fadeIn 0.5s ease-out;';

        const finalBtn = document.createElement('button');
        finalBtn.className = 'rt-submit-btn';
        finalBtn.textContent = 'FINISH VERIFICATION';
        finalBtn.style.cssText = 'font-size:18px;padding:16px 48px;';

        finalBtn.addEventListener('click', () => {
          if (resolved) return;
          resolved = true;
          window.ReverseTest.Audio.sfx.success();
          container.dispatchEvent(new CustomEvent('level-complete', {
            detail: { passed: true, speedFactor: 0.2, perfect: false }
          }));
        });

        btnWrap.appendChild(finalBtn);
        wrapper.appendChild(btnWrap);
      }, 800);
    }, 2500);
  }

  function cleanup() { container = null; resolved = false; }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.SubmitChaos = { render, cleanup };
})();
