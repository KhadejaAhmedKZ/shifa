// Pure helpers that turn a stream of VitalLens results into ONE check-in
// reading with a confidence value. No DOM, no network — unit-tested.

export const SCAN_SECONDS = 30;
// Below this confidence we do not save the reading — we ask for a retry.
export const RETRY_CONFIDENCE = 0.7;

// VitalLens reports confidence either as a number or as a per-sample array.
export function lastConfidence(vital) {
  const c = vital?.confidence;
  if (Array.isArray(c)) return c.length ? Number(c[c.length - 1]) : null;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

// Pull the fields we care about out of one `vitals` event.
export function readSample(result, atSeconds) {
  const v = result?.vitals || {};
  const pick = (vital) =>
    vital && typeof vital.value === "number" && Number.isFinite(vital.value)
      ? { value: vital.value, confidence: lastConfidence(vital) }
      : null;
  return {
    t: atSeconds,
    heart_rate: pick(v.heart_rate),
    respiratory_rate: pick(v.respiratory_rate),
    hrv_sdnn: pick(v.hrv_sdnn),
  };
}

// Confidence-weighted average over the settled (second) half of the scan.
function settle(samples, key, scanSeconds) {
  const all = samples.filter((s) => s[key]);
  if (!all.length) return null;
  const late = all.filter((s) => s.t >= scanSeconds / 2);
  const pool = late.length ? late : all.slice(-3);
  const known = pool.filter((s) => s[key].confidence != null);
  if (!known.length) {
    const last = pool[pool.length - 1][key];
    return { value: last.value, confidence: null };
  }
  const wSum = known.reduce((a, s) => a + Math.max(s[key].confidence, 0.01), 0);
  const value = known.reduce((a, s) => a + s[key].value * Math.max(s[key].confidence, 0.01), 0) / wSum;
  const confidence = known.reduce((a, s) => a + s[key].confidence, 0) / known.length;
  return { value, confidence };
}

const round1 = (n) => Math.round(n * 10) / 10;
const fmt = (m) =>
  m ? { value: round1(m.value), confidence: m.confidence == null ? null : Math.round(m.confidence * 100) / 100 } : null;

/**
 * Summarise a finished scan.
 * @returns {{heart_rate, respiratory_rate, hrv_sdnn, source, ok, reason}}
 *   reason: null | "no_face" | "low_confidence"
 */
export function summariseScan(samples, { source = "vitallens", scanSeconds = SCAN_SECONDS } = {}) {
  const heart_rate = fmt(settle(samples, "heart_rate", scanSeconds));
  const respiratory_rate = fmt(settle(samples, "respiratory_rate", scanSeconds));
  const hrv_sdnn = fmt(settle(samples, "hrv_sdnn", scanSeconds));

  let reason = null;
  if (!heart_rate) reason = "no_face";
  else if (heart_rate.confidence != null && heart_rate.confidence < RETRY_CONFIDENCE) reason = "low_confidence";

  return { heart_rate, respiratory_rate, hrv_sdnn, source, ok: reason === null, reason };
}

// Shape the summary for POST /checkin. Low-confidence secondary vitals are
// dropped rather than stored.
export function toCheckinPayload(summary) {
  const keep = (m) => (m && (m.confidence == null || m.confidence >= RETRY_CONFIDENCE) ? m : null);
  const rr = keep(summary.respiratory_rate);
  const hrv = keep(summary.hrv_sdnn);
  return {
    heart_rate: summary.heart_rate?.value ?? null,
    heart_rate_conf: summary.heart_rate?.confidence ?? null,
    respiratory_rate: rr?.value ?? null,
    respiratory_rate_conf: rr?.confidence ?? null,
    hrv_sdnn: hrv?.value ?? null,
    hrv_conf: hrv?.confidence ?? null,
    source: summary.source,
  };
}
