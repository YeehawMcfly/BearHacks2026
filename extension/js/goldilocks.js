/**
 * Goldilocks Trap — Behavior analysis engine.
 * Tracks timing, mouse movement, keystrokes, and calculates a suspicion score.
 * Too perfect = bot. Too slow = bot. Must be "flawed human".
 */
(function () {
  const state = {
    suspicionScore: 15, // Start slightly suspicious
    mousePositions: [],
    keystrokeTimes: [],
    clickTimes: [],
    clickPositions: [],
    levelStartTime: 0,
    totalStartTime: 0,
    corrections: 0, // backspaces, changed selections
    events: [] // timeline of all events
  };

  function now() { return performance.now(); }

  function mouseEntropy() {
    const pts = state.mousePositions;
    if (pts.length < 10) return 0.5;
    // Calculate direction changes — bots move linearly
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
        const cos = dot / (mag1 * mag2);
        if (cos < 0.8) changes++;
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
    const cv = Math.sqrt(variance) / (mean || 1); // coefficient of variation
    // Humans: cv ~0.3-0.8. Bots: cv ~0-0.1.
    return Math.min(cv, 1);
  }

  function clickPatternScore() {
    const pos = state.clickPositions;
    if (pos.length < 3) return 0;
    // Check if clicks are in a sequential grid pattern (bot behavior)
    let sequential = 0;
    for (let i = 1; i < pos.length; i++) {
      if (pos[i].x > pos[i-1].x || (pos[i].x === pos[i-1].x && pos[i].y > pos[i-1].y)) {
        sequential++;
      }
    }
    return sequential / (pos.length - 1); // 1.0 = perfectly sequential = suspicious
  }

  function calculateSuspicion(levelResult) {
    let score = state.suspicionScore;
    const elapsed = (now() - state.levelStartTime) / 1000;

    // Speed analysis
    if (levelResult.speedFactor !== undefined) {
      if (levelResult.speedFactor > 0.9) score += 25;      // Way too fast
      else if (levelResult.speedFactor > 0.7) score += 15;  // Suspiciously fast
      else if (levelResult.speedFactor < 0.1) score += 10;  // Way too slow
      else score -= 5; // Normal speed, reduce suspicion
    }

    // Accuracy analysis
    if (levelResult.perfect) score += 12; // Perfect accuracy is suspicious
    if (state.corrections > 0) score -= Math.min(state.corrections * 3, 15); // Corrections = human

    // Mouse entropy
    const entropy = mouseEntropy();
    if (entropy < 0.15) score += 15; // Too linear = bot
    else if (entropy > 0.4) score -= 5; // Natural movement

    // Keystroke variance
    const ksVar = keystrokeVariance();
    if (ksVar < 0.1) score += 20; // Machine-like consistency
    else if (ksVar > 0.25) score -= 5;

    // Click pattern
    const clickSeq = clickPatternScore();
    if (clickSeq > 0.8) score += 15; // Sequential clicking = bot

    // Clamp
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
      if (state.mousePositions.length > 200) state.mousePositions.shift();
    },

    trackKeystroke(key) {
      state.keystrokeTimes.push(now());
      if (key === 'Backspace' || key === 'Delete') state.corrections++;
      state.events.push({ type: 'key', key, t: now() });
    },

    trackClick(x, y) {
      state.clickTimes.push(now());
      state.clickPositions.push({ x, y });
      state.events.push({ type: 'click', x, y, t: now() });
    },

    trackCorrection() { state.corrections++; },

    evaluate(levelResult) {
      const score = calculateSuspicion(levelResult);
      const elapsed = (now() - state.levelStartTime) / 1000;
      return {
        suspicionScore: score,
        elapsed,
        mouseEntropy: mouseEntropy(),
        keystrokeVariance: keystrokeVariance(),
        corrections: state.corrections,
        verdict: score > 80 ? 'BAN' : score > 60 ? 'SUSPICIOUS' : score > 35 ? 'BORDERLINE' : 'HUMAN'
      };
    },

    getScore() { return state.suspicionScore; },
    setScore(s) { state.suspicionScore = Math.max(0, Math.min(100, s)); },
    addSuspicion(n) { state.suspicionScore = Math.max(0, Math.min(100, state.suspicionScore + n)); },

    getBehaviorData() {
      return {
        suspicionScore: state.suspicionScore,
        mouseEntropy: mouseEntropy(),
        keystrokeVariance: keystrokeVariance(),
        corrections: state.corrections,
        totalTime: (now() - state.totalStartTime) / 1000
      };
    }
  };
})();
