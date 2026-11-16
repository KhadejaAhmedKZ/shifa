// Exercise rep + form engine for the Exercise page — a JavaScript port of the
// VIEW POINT FIT pose coach (same thresholds and two-threshold state machines).
// Pure functions on MediaPipe Pose landmarks: no DOM, no camera — unit-tested.
// These are coaching heuristics, NOT medical or injury thresholds.

export const LM = {
  lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
};
const LEGS = [LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];
const armIdx = (side) =>
  side === "left" ? [LM.lShoulder, LM.lElbow, LM.lWrist] : [LM.rShoulder, LM.rElbow, LM.rWrist];

export const CONFIG = {
  squat: { high: 160, low: 100, partial: 140, minRepMs: 700, returnHintMs: 1500, visibility: 0.6, singleSide: 0.8, targetReps: 8 },
  curl: { high: 150, low: 55, partial: 110, minRepMs: 600, returnHintMs: 1500, visibility: 0.6, swingLimit: 40, targetReps: 8 },
  lunge: { high: 155, low: 115, partial: 140, minRepMs: 700, returnHintMs: 1500, visibility: 0.6, sideGap: 15, targetReps: 6 },
};
const ALPHA = 0.3; // EMA weight of the newest angle

const vis = (p) => (p ? p.visibility ?? 1 : 0);
const inFrame = (p) => !!p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1.05;
const ema = (v, prev) => (prev == null ? v : prev + ALPHA * (v - prev));

export function calculateAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y }, cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y) || 1e-6;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function quality(lms, idx) {
  if (!lms) return 0;
  const pts = idx.map((i) => lms[i]);
  return pts.every(inFrame) ? Math.min(...pts.map(vis)) : 0;
}
function bodyStatus(lms, ok) {
  if (ok) return "good";
  if (!lms) return "none";
  const torso = Math.max(vis(lms[LM.lShoulder]), vis(lms[LM.rShoulder]), vis(lms[LM.lHip]), vis(lms[LM.rHip]));
  return torso >= 0.5 ? "partial" : "none";
}

// ---- detector state ---------------------------------------------------------
export function newState() {
  return {
    state: "UNKNOWN", reps: 0, partial: 0, tooFast: 0, returnHints: 0, tracking: false,
    smoothed: [], cycleStart: null, minSince: 180, hoverSince: null, returnHinted: false, maxSwing: 0,
    side: null, lastSide: null, leftReps: 0, rightReps: 0, sideRepeats: 0, repeatedSide: false,
  };
}
const RESET = { cycleStart: null, minSince: 180, hoverSince: null, returnHinted: false, maxSwing: 0, side: null };

// Pause on unreliable data (dropping any in-progress cycle so movement while
// lost never counts); otherwise smooth the inputs.
function begin(d, inputs) {
  if (inputs === null) {
    if (!d.tracking) return { done: { d, event: null } };
    return { done: { d: { ...d, ...RESET, tracking: false, state: "UNKNOWN", smoothed: [] }, event: "lost" } };
  }
  const smoothed = inputs.map((v, i) => ema(v, d.smoothed[i] ?? null));
  const event = !d.tracking && d.reps + d.partial > 0 ? "resumed" : null;
  return { n: { ...d, smoothed, tracking: true }, event };
}
function hoverHint(n, hovering, now, ms) {
  if (!hovering) { n.hoverSince = null; return null; }
  n.hoverSince ??= now;
  if (!n.returnHinted && now - n.hoverSince >= ms) {
    n.returnHinted = true; n.returnHints += 1;
    return "return";
  }
  return null;
}

/** TOP → angle < low → BOTTOM → angle > high → +1 rep (squat knee, curl elbow). */
export function stepRange(d, angle, now, c, swing = 0) {
  const b = begin(d, angle === null ? null : [angle]);
  if (b.done) return b.done;
  const n = b.n; let event = b.event;
  const s = n.smoothed[0];
  if (n.state === "UNKNOWN") { if (s > c.high) n.state = "TOP"; return { d: n, event }; }
  if (n.state === "TOP") {
    if (s < c.high && n.cycleStart === null) n.cycleStart = now;
    if (n.cycleStart !== null) n.maxSwing = Math.max(n.maxSwing, swing);
    n.minSince = Math.min(n.minSince, s);
    if (s < c.low) { n.state = "BOTTOM"; n.hoverSince = null; n.returnHinted = false; }
    else if (s > c.high && n.cycleStart !== null) {
      if (n.minSince < c.partial) { n.partial += 1; event = "partial"; }
      Object.assign(n, RESET);
    }
    return { d: n, event };
  }
  n.maxSwing = Math.max(n.maxSwing, swing);
  if (s > c.high) {
    if (n.cycleStart !== null && now - n.cycleStart >= c.minRepMs) {
      n.reps += 1;
      event = c.swingLimit !== undefined && n.maxSwing > c.swingLimit ? "swing" : "rep";
    } else { n.tooFast += 1; event = "too_fast"; }
    n.state = "TOP";
    Object.assign(n, RESET);
    return { d: n, event };
  }
  return { d: n, event: hoverHint(n, s > c.low + 15, now, c.returnHintMs) ?? event };
}

/** STANDING → LEFT_DOWN / RIGHT_DOWN → STANDING = +1 rep. */
export function stepLunge(d, input, now) {
  const c = CONFIG.lunge;
  const b = begin(d, input && [input.left, input.right]);
  if (b.done) return b.done;
  const n = b.n; let event = b.event;
  const [l, r] = n.smoothed;
  const low = Math.min(l, r);
  const standing = l > c.high && r > c.high;
  if (n.state === "UNKNOWN") { if (standing) n.state = "TOP"; return { d: n, event }; }
  if (n.state === "TOP") {
    if (!standing && n.cycleStart === null) n.cycleStart = now;
    n.minSince = Math.min(n.minSince, low);
    if (low < c.low) {
      n.side = Math.abs(l - r) >= c.sideGap ? (l < r ? "left" : "right") : input.leftAnkleY >= input.rightAnkleY ? "left" : "right";
      n.state = "BOTTOM"; n.hoverSince = null; n.returnHinted = false;
    } else if (standing && n.cycleStart !== null) {
      if (n.minSince < c.partial) { n.partial += 1; event = "partial"; }
      n.cycleStart = null; n.minSince = 180;
    }
    return { d: n, event };
  }
  if (standing) {
    if (n.cycleStart !== null && now - n.cycleStart >= c.minRepMs) {
      const side = n.side;
      n.reps += 1;
      if (side === "left") n.leftReps += 1; else n.rightReps += 1;
      n.repeatedSide = n.lastSide === side;
      if (n.repeatedSide) n.sideRepeats += 1;
      n.lastSide = side;
      event = "rep";
    } else { n.tooFast += 1; event = "too_fast"; }
    Object.assign(n, { state: "TOP", ...RESET });
    return { d: n, event };
  }
  return { d: n, event: hoverHint(n, low > c.low + 15, now, c.returnHintMs) ?? event };
}

// ---- exercise definitions ---------------------------------------------------
function kneeAngles(lms) {
  const one = (h, k, a) => {
    const pts = [lms[h], lms[k], lms[a]];
    return { angle: pts.every(inFrame) ? calculateAngle(...pts) : null, minVis: pts.every(inFrame) ? Math.min(...pts.map(vis)) : 0 };
  };
  return { L: one(LM.lHip, LM.lKnee, LM.lAnkle), R: one(LM.rHip, LM.rKnee, LM.rAnkle) };
}

export const EXERCISES = {
  squat: {
    id: "squat", icon: "🏋️", usesSide: false, targetReps: CONFIG.squat.targetReps, angleKey: "kneeAngle",
    required: () => LEGS,
    read(lms) {
      if (!lms || lms.length < 29) return { status: "none", input: null, angle: null };
      const c = CONFIG.squat;
      const { L, R } = kneeAngles(lms);
      const lOk = L.minVis >= c.visibility, rOk = R.minVis >= c.visibility;
      let angle = null;
      if (lOk && rOk) angle = (L.angle + R.angle) / 2;
      else if (lOk && L.minVis >= c.singleSide) angle = L.angle;
      else if (rOk && R.minVis >= c.singleSide) angle = R.angle;
      return { status: bodyStatus(lms, angle !== null), input: angle, angle };
    },
    step: (d, input, now) => stepRange(d, input, now, CONFIG.squat),
    cue: (e, d) => ({ rep: d.reps === 1 ? "cue_depth" : "cue_rep", swing: "cue_rep", too_fast: "cue_slow", partial: "cue_lower", return: "cue_stand", lost: "cue_fullbody", resumed: "cue_inview" })[e],
    notes: (s) => [s.partial >= 2 && "note_depth", tracking(s) && "note_farther", s.tooFast >= 2 && "note_slow"].filter(Boolean),
  },
  curl: {
    id: "curl", icon: "💪", usesSide: true, targetReps: CONFIG.curl.targetReps, angleKey: "elbowAngle",
    required: armIdx,
    read(lms, side) {
      const idx = armIdx(side);
      const ok = quality(lms, idx) >= CONFIG.curl.visibility;
      if (!ok) return { status: bodyStatus(lms, false), input: null, angle: null };
      const [s, e, w] = idx.map((i) => lms[i]);
      const angle = calculateAngle(s, e, w);
      // Upper-arm angle from vertical: how far the elbow drifts from the torso line.
      const swing = calculateAngle({ x: s.x, y: s.y + 1 }, s, e);
      return { status: "good", input: { angle, swing }, angle };
    },
    step: (d, input, now) => stepRange(d, input ? input.angle : null, now, CONFIG.curl, input ? input.swing : 0),
    cue: (e) => ({ rep: "cue_curl", swing: "cue_elbow", too_fast: "cue_slow", partial: "cue_higher", return: "cue_extend", lost: "cue_arm", resumed: "cue_inview" })[e],
    notes: (s) => [s.partial >= 2 && "note_curl", s.returnHints >= 2 && "note_extend", tracking(s) && "note_farther"].filter(Boolean),
  },
  lunge: {
    id: "lunge", icon: "🦵", usesSide: false, targetReps: CONFIG.lunge.targetReps, angleKey: "kneeAngle",
    required: () => LEGS,
    read(lms) {
      const ok = quality(lms, LEGS) >= CONFIG.lunge.visibility;
      if (!ok) return { status: bodyStatus(lms, false), input: null, angle: null };
      const p = (i) => lms[i];
      const input = {
        left: calculateAngle(p(LM.lHip), p(LM.lKnee), p(LM.lAnkle)),
        right: calculateAngle(p(LM.rHip), p(LM.rKnee), p(LM.rAnkle)),
        leftAnkleY: p(LM.lAnkle).y, rightAnkleY: p(LM.rAnkle).y,
      };
      return { status: "good", input, angle: Math.min(input.left, input.right) };
    },
    step: (d, input, now) => stepLunge(d, input, now),
    cue: (e, d) => (e === "rep" ? (d.repeatedSide ? "cue_alternate" : "cue_rep") : { too_fast: "cue_slow", partial: "cue_lower", return: "cue_stand", lost: "cue_fullbody", resumed: "cue_inview" }[e]),
    notes: (s) => [s.partial >= 2 && "note_depth", (s.sideRepeats >= 3 || Math.abs(s.leftReps - s.rightReps) >= 3) && "note_alternate", tracking(s) && "note_farther"].filter(Boolean),
  },
};
export const EXERCISE_LIST = [EXERCISES.squat, EXERCISES.curl, EXERCISES.lunge];

// ---- session metrics --------------------------------------------------------
export const emptyStats = () => ({ totalFrames: 0, reliableFrames: 0, lostEvents: 0 });

export function trackingQuality(s) {
  return s.totalFrames === 0 ? 0 : Math.round((s.reliableFrames / s.totalFrames) * 100);
}
function tracking(s) { return s.lostEvents >= 2 || trackingQuality(s) < 75; }

/** Form consistency (0–100): 70% share of attempts that were full reps, 30% tracking quality. */
export function formConsistency(s) {
  const attempts = s.reps + s.partial + s.tooFast;
  const share = attempts === 0 ? 0 : s.reps / attempts;
  return Math.round(100 * (0.7 * share + 0.3 * (trackingQuality(s) / 100)));
}

/** Fold detector state + frame stats into one summary object for saving. */
export function summarise(exerciseId, d, stats, durationMs, side) {
  const s = {
    ...stats, reps: d.reps, partial: d.partial, tooFast: d.tooFast, returnHints: d.returnHints,
    leftReps: d.leftReps, rightReps: d.rightReps, sideRepeats: d.sideRepeats,
  };
  const ex = EXERCISES[exerciseId];
  return {
    exercise: exerciseId, reps: d.reps, target_reps: ex.targetReps,
    duration_seconds: Math.round(durationMs / 1000),
    form_consistency: formConsistency(s), tracking_quality: trackingQuality(s),
    partial_reps: d.partial, too_fast: d.tooFast,
    side: ex.usesSide ? side : null,
    notes: ex.notes(s),
  };
}
