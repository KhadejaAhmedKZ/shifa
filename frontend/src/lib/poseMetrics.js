// Pure posture / movement maths on MediaPipe Pose landmarks.
// Landmarks are normalised image coordinates (x, y in 0..1, y grows downward).
// No DOM, no camera — unit-tested. Everything is measured in "shoulder widths"
// so it works at any distance from the camera.

export const LM = { nose: 0, lEar: 7, rEar: 8, lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24 };

const seen = (p, min = 0.5) => !!p && (p.visibility == null || p.visibility >= min);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Reduce a pose to the few numbers posture checks need (or null if not visible). */
export function postureFeatures(lm) {
  if (!lm) return null;
  const ls = lm[LM.lShoulder], rs = lm[LM.rShoulder], nose = lm[LM.nose];
  if (!seen(ls) || !seen(rs) || !seen(nose)) return null;
  const sw = dist(ls, rs);
  if (sw < 0.06) return null; // too far away / side-on
  const sm = mid(ls, rs);
  const le = lm[LM.lEar], re = lm[LM.rEar];
  const ears = seen(le) && seen(re);
  const head = ears ? mid(le, re) : nose;
  return {
    // Vertical ear→shoulder gap. Shrinks when you slouch, shrug, or push the head forward.
    neck: (sm.y - head.y) / sw,
    // Apparent head width. Grows when the head moves toward the screen (forward head).
    headSize: ears ? dist(le, re) / sw : null,
    // Shoulder line tilt in degrees (0 = level).
    tilt: Math.abs((Math.atan2(ls.y - rs.y, Math.abs(ls.x - rs.x)) * 180) / Math.PI),
    // Sideways head offset from the middle of the shoulders.
    lean: (head.x - sm.x) / sw,
    shoulderY: sm.y,
    shoulderWidth: sw,
  };
}

/** Average several feature samples into a calibration baseline ("sitting tall"). */
export function averageFeatures(samples) {
  const ok = samples.filter(Boolean);
  if (!ok.length) return null;
  const avg = (k) => {
    const vals = ok.map((s) => s[k]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    neck: avg("neck"), headSize: avg("headSize"), tilt: avg("tilt"),
    lean: avg("lean"), shoulderY: avg("shoulderY"), shoulderWidth: avg("shoulderWidth"),
  };
}

export const POSTURE_LIMITS = {
  slouchDrop: 0.15,     // neck gap shrinks ≥15% vs calibrated upright
  forwardHeadGrow: 0.1, // head looks ≥10% bigger …
  forwardNeckDrop: 0.06, // … and the neck gap has started to close
  tiltDeg: 9,
  uncalibratedNeck: 0.38,
};

/**
 * Classify sitting posture against the person's own calibrated upright pose.
 * @returns {{status: "good"|"slouch"|"forward_head"|"uneven", neckDrop:number, headGrow:number}}
 */
export function classifyPosture(f, baseline) {
  if (!f) return null;
  const L = POSTURE_LIMITS;
  if (!baseline || !baseline.neck) {
    const status = f.neck < L.uncalibratedNeck ? "slouch" : f.tilt > L.tiltDeg ? "uneven" : "good";
    return { status, neckDrop: 0, headGrow: 0 };
  }
  const neckDrop = 1 - f.neck / baseline.neck;
  const headGrow = f.headSize != null && baseline.headSize ? f.headSize / baseline.headSize - 1 : 0;
  let status = "good";
  if (headGrow >= L.forwardHeadGrow && neckDrop >= L.forwardNeckDrop) status = "forward_head";
  else if (neckDrop >= L.slouchDrop) status = "slouch";
  else if (f.tilt - (baseline.tilt || 0) > L.tiltDeg) status = "uneven";
  return { status, neckDrop, headGrow };
}

/**
 * Generic up/down repetition counter with hysteresis.
 * Feed it a signal; a rep is counted when the signal goes above `upAt` and
 * then comes back below `downAt`.
 */
export function createRepCounter({ upAt, downAt, minRepMs = 500 }) {
  let phase = "down";
  let count = 0;
  let peak = 0;
  let upStart = 0;
  let peakTime = 0;
  return {
    get count() { return count; },
    get phase() { return phase; },
    reset() { phase = "down"; count = 0; peak = 0; },
    /** @returns {null | {count, peak, upMs, downMs}} a rep object when one completes */
    update(value, t) {
      if (value == null || Number.isNaN(value)) return null;
      if (phase === "down") {
        if (value >= upAt) { phase = "up"; peak = value; upStart = t; peakTime = t; }
        return null;
      }
      if (value > peak) { peak = value; peakTime = t; }
      if (value <= downAt) {
        phase = "down";
        const total = t - upStart;
        if (total < minRepMs) return null; // jitter, not a real rep
        count += 1;
        return { count, peak, upMs: peakTime - upStart, downMs: t - peakTime, totalMs: total };
      }
      return null;
    },
  };
}

// ---- Guided move 1: chair sit-to-stand -------------------------------------
// Signal: how far the shoulders have risen above the calibrated seated height,
// in shoulder widths. Standing up lifts the shoulders by roughly a thigh length.
export const SIT_TO_STAND = { upAt: 0.55, downAt: 0.2, fullStand: 0.8, minLowerMs: 700, maxLean: 0.3 };

export function sitToStandSignal(f, seated) {
  if (!f || !seated) return null;
  return (seated.shoulderY - f.shoulderY) / seated.shoulderWidth;
}

/** Form feedback key for a finished sit-to-stand rep. */
export function sitToStandFeedback(rep, maxLeanSeen = 0) {
  if (rep.peak < SIT_TO_STAND.fullStand) return "sts_stand_tall";
  if (rep.downMs < SIT_TO_STAND.minLowerMs) return "sts_slow_down";
  if (Math.abs(maxLeanSeen) > SIT_TO_STAND.maxLean) return "sts_centered";
  return "sts_good";
}

// ---- Guided move 2: shoulder rolls -----------------------------------------
// Signal: how much the ear→shoulder gap has closed vs calibrated (shoulders
// lifting toward the ears at the top of each roll), as a fraction.
export const SHOULDER_ROLL = { upAt: 0.12, downAt: 0.05, fullLift: 0.2, minCycleMs: 1200, maxTilt: 8 };

export function shoulderRollSignal(f, seated) {
  if (!f || !seated || !seated.neck) return null;
  return 1 - f.neck / seated.neck;
}

export function shoulderRollFeedback(rep, maxTiltSeen = 0) {
  if (rep.peak < SHOULDER_ROLL.fullLift) return "roll_higher";
  if (maxTiltSeen > SHOULDER_ROLL.maxTilt) return "roll_even";
  if (rep.totalMs < SHOULDER_ROLL.minCycleMs) return "roll_slower";
  return "roll_good";
}

// ---- Sitting timer ----------------------------------------------------------
/** Accumulates seated time; resets after the person stands or leaves for a while. */
export function createSittingTimer({ limitSec, resetAfterAwaySec = 20 }) {
  let seatedMs = 0;
  let awayMs = 0;
  let last = null;
  return {
    get seatedSec() { return seatedMs / 1000; },
    get due() { return seatedMs / 1000 >= limitSec; },
    reset() { seatedMs = 0; awayMs = 0; },
    /** @param {"seated"|"away"} state  "away" = standing, moving or out of frame */
    update(state, t) {
      const dt = last == null ? 0 : Math.min(t - last, 2000);
      last = t;
      if (state === "seated") { seatedMs += dt; awayMs = 0; }
      else { awayMs += dt; if (awayMs / 1000 >= resetAfterAwaySec) seatedMs = 0; }
      return seatedMs / 1000 >= limitSec;
    },
  };
}
