/**
 * Goldilocks Trap — Behavior analysis engine.
 * Tracks timing, mouse movement, keystrokes, and calculates a suspicion score.
 *
 * THREE ZONES:
 *   BOT  (score < 20)  — Too slow, too many errors, no mouse movement
 *   HUMAN (score 20–65) — Imperfect timing, corrections, natural mouse curves
 *   AI   (score > 65)  — Too fast, too accurate, linear mouse, zero corrections
 *
 * Suspicion is CUMULATIVE across levels. Later levels carry heavier weight.
 */
(function () {
  // Per-level weight multipliers — later levels are harder so anomalies matter more
  const LEVEL_WEIGHTS = { 0: 1.0, 1: 1.0, 2: 1.2, 3: 1.5, 4: 2.0 };

  const state = {
    suspicionScore: 15,        // Start slightly suspicious
    mousePositions: [],
    keystrokeTimes: [],
    clickTimes: [],
    clickPositions: [],
    levelStartTime: 0,
    totalStartTime: 0,
    corrections: 0,            // backspaces, changed selections
    events: [],                // timeline of all events

    // ── Cumulative cross-level tracking ──
    currentLevelIndex: 0,      // which level we are on (0-based)
    levelResults: [],          // history of { level, score, zone, elapsed }
    perfectionStreak: 0,       // consecutive levels with zero corrections + high speed
    totalCorrections: 0,       // lifetime corrections across all levels
    consecutivePasses: 0,      // levels passed in a row without failing once
  };

  function now() { return performance.now(); }

  // ── Mouse entropy ──────────────────────────────────────────────────────
  function mouseEntropy() {
    const pts = state.mousePositions;
    if (pts.length < 10) return 0.5;
    let changes = 0;
    for (let i = 2; i < pts.length; i++) {
      const dx1 = pts[i-1].x - pts[i-2].x;
      const dy1 = pts[i-1].y - pts[i-2].y;
      const dx2 = pts[i].x - pts[i-1].x;
      const dy2 = pts[i].y - pts[i-1].y;
      const dot  = dx1*dx2 + dy1*dy2;
      const mag1 = Math.sqrt(dx1*dx1 + dy1*dy1);
      const mag2 = Math.sqrt(dx2*dx2 + dy2*dy2);
      if (mag1 > 0 && mag2 > 0) {
        const cos = dot / (mag1 * mag2);
        if (cos < 0.8) changes++;
      }
    }
    return Math.min(changes / (pts.length - 2), 1);
  }

  // ── Keystroke variance (coefficient of variation) ──────────────────────
  function keystrokeVariance() {
    const times = state.keystrokeTimes;
    if (times.length < 3) return 0.5;
    const intervals = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i-1]);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    const cv = Math.sqrt(variance) / (mean || 1);
    return Math.min(cv, 1);
  }

  // ── Click pattern sequentiality ────────────────────────────────────────
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

  // ── Zone classification ────────────────────────────────────────────────
  function classifyZone(score) {
    if (score > 65) return 'AI';
    if (score < 20) return 'BOT';
    return 'HUMAN';
  }

  // ── Core suspicion calculation ─────────────────────────────────────────
  function calculateSuspicion(levelResult) {
    let delta = 0; // how much to ADD this level
    const elapsed = (now() - state.levelStartTime) / 1000;
    const weight = LEVEL_WEIGHTS[state.currentLevelIndex] || 1.0;

    // ── Speed analysis ──
    if (levelResult.speedFactor !== undefined) {
      if (levelResult.speedFactor > 0.9)      delta += 25;  // Way too fast
      else if (levelResult.speedFactor > 0.7)  delta += 15;  // Suspiciously fast
      else if (levelResult.speedFactor < 0.1)  delta += 10;  // Way too slow (dumb bot?)
      else                                     delta -= 5;   // Normal speed
    }

    // ── Accuracy analysis ──
    if (levelResult.perfect) delta += 12;
    if (state.corrections > 0) delta -= Math.min(state.corrections * 3, 15);

    // ── Mouse entropy ──
    const entropy = mouseEntropy();
    if (entropy < 0.15)     delta += 15;  // Too linear = bot / automation
    else if (entropy > 0.4) delta -= 5;   // Organic curves

    // ── Keystroke variance ──
    const ksVar = keystrokeVariance();
    if (ksVar < 0.1)        delta += 20;  // Machine-like consistency
    else if (ksVar > 0.25)  delta -= 5;   // Human jitter

    // ── Click pattern ──
    const clickSeq = clickPatternScore();
    if (clickSeq > 0.8) delta += 15;      // Grid-scan clicking = bot

    // ── Perfection streak bonus (cumulative) ──
    const wasPerfectLevel = (state.corrections === 0 && levelResult.speedFactor > 0.6 && levelResult.passed);
    if (wasPerfectLevel) {
      state.perfectionStreak++;
      // Each consecutive "too perfect" level adds escalating suspicion
      if (state.perfectionStreak >= 2) delta += 8 * state.perfectionStreak;
    } else {
      state.perfectionStreak = Math.max(0, state.perfectionStreak - 1);
    }

    // ── Consecutive pass tracking ──
    if (levelResult.passed || levelResult.humanFailure) {
      state.consecutivePasses++;
    } else {
      state.consecutivePasses = 0;
    }

    // ── No-correction penalty across ALL levels ──
    state.totalCorrections += state.corrections;
    if (state.currentLevelIndex >= 2 && state.totalCorrections === 0) {
      // 3+ levels with ZERO lifetime corrections? Very suspicious.
      delta += 10;
    }

    // Apply level weight multiplier
    delta = Math.round(delta * weight);

    // Update cumulative score
    const newScore = Math.max(0, Math.min(100, state.suspicionScore + delta));
    state.suspicionScore = newScore;

    // Record this level's result
    state.levelResults.push({
      level: state.currentLevelIndex,
      scoreDelta: delta,
      finalScore: newScore,
      zone: classifyZone(newScore),
      elapsed,
      corrections: state.corrections,
      perfectionStreak: state.perfectionStreak,
    });

    return newScore;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Goldilocks = {
    startLevel() {
      state.levelStartTime = now();
      if (!state.totalStartTime) state.totalStartTime = now();
      // Reset per-level trackers (mouse, keys, clicks) but NOT cumulative state
      state.mousePositions = [];
      state.keystrokeTimes = [];
      state.clickTimes = [];
      state.clickPositions = [];
      state.corrections = 0;
    },

    /** Call this when overlay.js increments the level index */
    setLevelIndex(i) { state.currentLevelIndex = i; },

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
      const zone = classifyZone(score);
      return {
        suspicionScore: score,
        zone,
        elapsed,
        mouseEntropy: mouseEntropy(),
        keystrokeVariance: keystrokeVariance(),
        corrections: state.corrections,
        totalCorrections: state.totalCorrections,
        perfectionStreak: state.perfectionStreak,
        levelHistory: state.levelResults,
        verdict: score > 80 ? 'BAN' : score > 65 ? 'SUSPICIOUS' : score > 35 ? 'BORDERLINE' : 'HUMAN'
      };
    },

    getScore()      { return state.suspicionScore; },
    getZone()       { return classifyZone(state.suspicionScore); },
    setScore(s)     { state.suspicionScore = Math.max(0, Math.min(100, s)); },
    addSuspicion(n) { state.suspicionScore = Math.max(0, Math.min(100, state.suspicionScore + n)); },

    getBehaviorData() {
      return {
        suspicionScore: state.suspicionScore,
        zone: classifyZone(state.suspicionScore),
        mouseEntropy: mouseEntropy(),
        keystrokeVariance: keystrokeVariance(),
        corrections: state.corrections,
        totalCorrections: state.totalCorrections,
        perfectionStreak: state.perfectionStreak,
        consecutivePasses: state.consecutivePasses,
        levelHistory: state.levelResults,
        totalTime: (now() - state.totalStartTime) / 1000
      };
    }
  };
})();
