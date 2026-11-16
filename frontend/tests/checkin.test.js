// Unit tests for the Daily Check-in logic. Run with:  npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  lastConfidence, readSample, summariseScan, toCheckinPayload, RETRY_CONFIDENCE,
} from "../src/lib/vitalsSummary.js";
import {
  postureFeatures, averageFeatures, classifyPosture, createRepCounter,
  sitToStandSignal, sitToStandFeedback, shoulderRollSignal, shoulderRollFeedback,
  createSittingTimer, SIT_TO_STAND, SHOULDER_ROLL,
} from "../src/lib/poseMetrics.js";

// Build a fake upper-body pose. shoulderY/earY in image coords (y down).
function pose({ shoulderY = 0.6, earY = 0.45, earGap = 0.12, shoulderGap = 0.3, tiltY = 0 } = {}) {
  const lm = [];
  lm[0] = { x: 0.5, y: earY + 0.02, visibility: 0.99 };
  lm[7] = { x: 0.5 + earGap / 2, y: earY, visibility: 0.99 };
  lm[8] = { x: 0.5 - earGap / 2, y: earY, visibility: 0.99 };
  lm[11] = { x: 0.5 + shoulderGap / 2, y: shoulderY + tiltY, visibility: 0.99 };
  lm[12] = { x: 0.5 - shoulderGap / 2, y: shoulderY - tiltY, visibility: 0.99 };
  return lm;
}
const vital = (value, confidence) => ({ vitals: { heart_rate: { value, confidence } } });

test("confidence is read from numbers and arrays", () => {
  assert.equal(lastConfidence({ confidence: 0.9 }), 0.9);
  assert.equal(lastConfidence({ confidence: [0.2, 0.8] }), 0.8);
  assert.equal(lastConfidence({}), null);
});

test("a steady, confident scan is accepted", () => {
  const samples = [];
  for (let t = 2; t <= 30; t += 2) {
    samples.push(readSample({
      vitals: {
        heart_rate: { value: 70 + (t % 4 ? 1 : -1), confidence: 0.92 },
        respiratory_rate: { value: 15, confidence: [0.5, 0.85] },
      },
    }, t));
  }
  const s = summariseScan(samples);
  assert.equal(s.ok, true);
  assert.ok(Math.abs(s.heart_rate.value - 70) <= 1.5);
  assert.ok(s.heart_rate.confidence >= RETRY_CONFIDENCE);
  assert.equal(s.respiratory_rate.value, 15);
  assert.equal(s.hrv_sdnn, null); // HRV not available → simply absent
});

test("low confidence asks for a retry and is not shaped as trustworthy", () => {
  const samples = [readSample(vital(88, 0.3), 20), readSample(vital(61, 0.35), 28)];
  const s = summariseScan(samples);
  assert.equal(s.ok, false);
  assert.equal(s.reason, "low_confidence");
});

test("no face → no_face", () => {
  const s = summariseScan([readSample({ vitals: {} }, 10)]);
  assert.equal(s.reason, "no_face");
});

test("payload never contains blood pressure and drops shaky secondary vitals", () => {
  const s = summariseScan([
    readSample({ vitals: {
      heart_rate: { value: 72, confidence: 0.9 },
      respiratory_rate: { value: 22, confidence: 0.2 },
    } }, 25),
  ], { source: "pos-fallback" });
  const p = toCheckinPayload(s);
  assert.equal(p.heart_rate, 72);
  assert.equal(p.respiratory_rate, null);
  assert.equal(p.source, "pos-fallback");
  assert.ok(!Object.keys(p).some((k) => /pressure|bp|systolic|diastolic/i.test(k)));
});

test("posture: upright is good, closing the neck gap is a slouch", () => {
  const upright = postureFeatures(pose());
  const base = averageFeatures([upright, upright]);
  assert.equal(classifyPosture(upright, base).status, "good");
  const slouched = postureFeatures(pose({ earY: 0.49 })); // head sinks toward shoulders
  assert.equal(classifyPosture(slouched, base).status, "slouch");
});

test("posture: head closer to the screen + closing neck gap is forward head", () => {
  const base = averageFeatures([postureFeatures(pose())]);
  const forward = postureFeatures(pose({ earGap: 0.14, earY: 0.465 }));
  assert.equal(classifyPosture(forward, base).status, "forward_head");
});

test("posture: tilted shoulders are flagged as uneven", () => {
  const base = averageFeatures([postureFeatures(pose())]);
  const tilted = postureFeatures(pose({ tiltY: 0.035 }));
  assert.equal(classifyPosture(tilted, base).status, "uneven");
});

test("posture features are null when the person is not visible", () => {
  assert.equal(postureFeatures(null), null);
  const lm = pose(); lm[11].visibility = 0.1;
  assert.equal(postureFeatures(lm), null);
});

test("sit-to-stand: counts full reps and ignores jitter", () => {
  const seated = averageFeatures([postureFeatures(pose())]);
  const counter = createRepCounter({ upAt: SIT_TO_STAND.upAt, downAt: SIT_TO_STAND.downAt });
  let t = 0; const reps = [];
  const feed = (shoulderY, earY, ms) => {
    t += ms;
    const sig = sitToStandSignal(postureFeatures(pose({ shoulderY, earY })), seated);
    const r = counter.update(sig, t); if (r) reps.push(r);
  };
  for (let i = 0; i < 3; i++) {
    feed(0.6, 0.45, 500); feed(0.45, 0.3, 600); feed(0.3, 0.15, 600); // stand (rise = 1.0)
    feed(0.45, 0.3, 700); feed(0.6, 0.45, 700);                       // sit
  }
  assert.equal(counter.count, 3);
  assert.equal(sitToStandFeedback(reps[0]), "sts_good");
  // a tiny bob is not a rep
  feed(0.57, 0.42, 200); feed(0.6, 0.45, 200);
  assert.equal(counter.count, 3);
});

test("sit-to-stand: form feedback", () => {
  assert.equal(sitToStandFeedback({ peak: 0.6, downMs: 1500 }), "sts_stand_tall");
  assert.equal(sitToStandFeedback({ peak: 1.0, downMs: 300 }), "sts_slow_down");
  assert.equal(sitToStandFeedback({ peak: 1.0, downMs: 1500 }, 0.5), "sts_centered");
});

test("shoulder rolls: counts lifts and gives form feedback", () => {
  const seated = averageFeatures([postureFeatures(pose())]);
  const counter = createRepCounter({ upAt: SHOULDER_ROLL.upAt, downAt: SHOULDER_ROLL.downAt });
  let t = 0; let last = null;
  for (let i = 0; i < 4; i++) {
    for (const shoulderY of [0.6, 0.58, 0.56, 0.58, 0.6]) { // shoulders lift ~27% of the neck gap
      t += 400;
      const r = counter.update(shoulderRollSignal(postureFeatures(pose({ shoulderY })), seated), t);
      if (r) last = r;
    }
  }
  assert.equal(counter.count, 4);
  assert.equal(shoulderRollFeedback(last), "roll_good");
  assert.equal(shoulderRollFeedback({ peak: 0.13, totalMs: 2000 }), "roll_higher");
  assert.equal(shoulderRollFeedback({ peak: 0.3, totalMs: 2000 }, 12), "roll_even");
  assert.equal(shoulderRollFeedback({ peak: 0.3, totalMs: 600 }), "roll_slower");
});

test("sitting timer: reminds after the limit and resets after a real break", () => {
  const timer = createSittingTimer({ limitSec: 10, resetAfterAwaySec: 5 });
  let t = 0; let due = false;
  for (let i = 0; i < 12; i++) { t += 1000; due = timer.update("seated", t); }
  assert.equal(due, true);
  for (let i = 0; i < 6; i++) { t += 1000; timer.update("away", t); }
  assert.equal(timer.due, false);
  assert.ok(timer.seatedSec < 1);
});
