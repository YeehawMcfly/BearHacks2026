/**
 * Goldilocks Trap — Behavior analysis engine (REBALANCED).
 * Tracks timing, mouse movement, keystrokes, and calculates a suspicion score.
 * Too perfect = bot. Too slow = bot. Must be "flawed human".
 *
 * KEY CHANGE: score starts low (5), actively DECREASES for human-like behaviour,
 * only spikes on clear bot signals. BAN threshold raised to 85.
 */
(function () {
  const state = {
    suspicionScore: 5,
    mousePositions: [],
    keystrokeTimes: [],
    clickTimes: [],
    clickPositions: [],
    levelStartTime: 0,
    totalStartTime: 0,
    corrections: 0,
    events: [],
    levelsCompleted: 0,
    lastBroadcast: 0,
    broadcastQueued: false,
    newMousePts: []
  };

  function now() { return performance.now(); }

  function mouseEntropy() {
    const pts = state.mousePositions;
    if (pts.length < 10) return 0.5;
    let changes = 0;
    for (let i = 2; i < pts.length; i++) {
      const dx1 = pts[i-1].x - pts[i-2].x;
      const dy1 = pts[i-1].y - pts[i-2].y;
      const dx2 = pts[i].x - pts[i-1].x;
      const dy2 = pts[i].y - pts[i-1].y;
      const dot = dx1*dx2 + dy1*dy2;
      const mag1 = Math.sqrt(dx1*dx1 + dy1*dy1);
      const mag2 = Math.sqrt(dx2*dx2 + dy2*dy2);
      if (mag1 > 0 && mag2 > 0) {
        if (dot / (mag1 * mag2) < 0.8) changes++;
      }
    }
    return Math.min(changes / (pts.length - 2), 1);
  }

  function keystrokeVariance() {
    const times = state.keystrokeTimes;
    if (times.length < 3) return 0.5;
    const intervals = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i-1]);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    return Math.min(Math.sqrt(variance) / (mean || 1), 1);
  }

  function clickPatternScore() {
    const pos = state.clickPositions;
    if (pos.length < 3) return 0;
    let sequential = 0;
    for (let i = 1; i < pos.length; i++) {
      if (pos[i].x > pos[i-1].x || (pos[i].x === pos[i-1].x && pos[i].y > pos[i-1].y)) {
        sequential++;
      }
    }
    return sequential / (pos.length - 1);
  }

  function calculateSuspicion(levelResult) {
    let score = state.suspicionScore;

    // ── Speed analysis (the primary signal) ──
    if (levelResult.speedFactor !== undefined) {
      if (levelResult.speedFactor > 0.9) score += 20;      // Way too fast → big spike
      else if (levelResult.speedFactor > 0.7) score += 10;  // Suspiciously fast
      else if (levelResult.speedFactor < 0.15) score += 5;  // Very slow
      else score -= 3; // Normal speed → trust reward
    }

    // Only suspicious if BOTH perfect AND very fast — slow careful typing is human
    if (levelResult.perfect && state.corrections === 0 && levelResult.speedFactor > 0.5) {
      score += 8; // Fast + perfect + zero corrections = likely AI
    } else if (state.corrections > 0) {
      score -= Math.min(state.corrections * 2, 10); // Corrections = very human
    }

    // ── Mouse entropy (only penalise clearly robotic movement) ──
    const entropy = mouseEntropy();
    if (state.mousePositions.length >= 15) {
      if (entropy < 0.08) score += 10;      // Perfectly linear movement
      else if (entropy > 0.3) score -= 2;   // Natural jitter → trust
    }

    // ── Keystroke variance (only penalise machine-like consistency) ──
    if (state.keystrokeTimes.length >= 5) {
      const ksVar = keystrokeVariance();
      if (ksVar < 0.05) score += 15;        // Robotic consistency
      else if (ksVar > 0.2) score -= 2;     // Human variation → trust
    }

    // ── Click pattern (only matters for image grid) ──
    if (state.clickPositions.length >= 3) {
      const clickSeq = clickPatternScore();
      if (clickSeq > 0.9) score += 8;       // Perfectly sequential
    }

    // ── Level completion trust bonus ──
    // Each level passed "normally" earns trust (prevents accumulation to ban)
    if (levelResult.passed || levelResult.humanFailure) {
      score -= 3;
      state.levelsCompleted++;
    }

    // Clamp 0–100
    score = Math.max(0, Math.min(100, score));
    state.suspicionScore = score;
    return score;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Goldilocks = {
    startLevel() {
      state.levelStartTime = now();
      if (!state.totalStartTime) state.totalStartTime = now();
      state.mousePositions = [];
      state.keystrokeTimes = [];
      state.clickTimes = [];
      state.clickPositions = [];
      state.corrections = 0;
    },

    trackMouse(x, y) {
      state.mousePositions.push({ x, y, t: now() });
      state.newMousePts.push({ x, y, click: false });
      if (state.mousePositions.length > 200) state.mousePositions.shift();
      this.queueBroadcast();
    },

    trackKeystroke(key) {
      state.keystrokeTimes.push(now());
      if (key === 'Backspace' || key === 'Delete') state.corrections++;
      state.events.push({ type: 'key', key, t: now() });
      this.broadcastState(); // Instant update for keys
    },

    trackClick(x, y) {
      state.clickTimes.push(now());
      state.clickPositions.push({ x, y });
      state.newMousePts.push({ x, y, click: true });
      state.events.push({ type: 'click', x, y, t: now() });
      this.broadcastState(); // Instant update for clicks
    },

    trackCorrection() { state.corrections++; this.broadcastState(); },

    evaluate(levelResult) {
      const score = calculateSuspicion(levelResult);
      const elapsed = (now() - state.levelStartTime) / 1000;
      return {
        suspicionScore: score,
        elapsed,
        mouseEntropy: mouseEntropy(),
        keystrokeVariance: keystrokeVariance(),
        corrections: state.corrections,
        verdict: score >= 85 ? 'BAN' : score >= 60 ? 'SUSPICIOUS' : score >= 35 ? 'BORDERLINE' : 'HUMAN'
      };
    },

    getScore() { return state.suspicionScore; },
    setScore(s) { state.suspicionScore = Math.max(0, Math.min(100, s)); },
    addSuspicion(n) { state.suspicionScore = Math.max(0, Math.min(100, state.suspicionScore + n)); },

    // Expose internals for level modules
    get _levelStart() { return state.levelStartTime; },
    set _levelStart(v) { state.levelStartTime = v; },
    get _corrections() { return state.corrections; },

    getBehaviorData() {
      return {
        suspicionScore: state.suspicionScore,
        mouseEntropy: mouseEntropy(),
        keystrokeVariance: keystrokeVariance(),
        corrections: state.corrections,
        totalTime: (now() - state.totalStartTime) / 1000,
        levelsCompleted: state.levelsCompleted
      };
    },

    queueBroadcast() {
      if (state.broadcastQueued) return;
      const timeSince = now() - state.lastBroadcast;
      if (timeSince > 500) {
        this.broadcastState();
      } else {
        state.broadcastQueued = true;
        setTimeout(() => this.broadcastState(), 500 - timeSince);
      }
    },

    async broadcastState() {
      state.broadcastQueued = false;
      state.lastBroadcast = now();
      
      const ksIntervals = [];
      for (let i = 1; i < state.keystrokeTimes.length; i++) {
        ksIntervals.push(state.keystrokeTimes[i] - state.keystrokeTimes[i-1]);
      }

      const payload = {
        state: {
          ...this.getBehaviorData(),
          ksIntervals,
          newMousePts: [...state.newMousePts]
        }
      };
      state.newMousePts = []; // clear after sending

      // Try sending (ignore failure)
      try {
        await fetch('http://localhost:3000/api/dashboard/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(1000)
        });
      } catch (_) {}
    }
  };
})();
