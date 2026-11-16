// Unit tests for the Exercise rep/form engine. Run with:  npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXERCISES, newState, calculateAngle, formConsistency, trackingQuality, summarise,
} from "../src/lib/exerciseEngine.js";

const P = (x, y) => ({ x, y, visibility: 0.95 });

// Front-on body with both knees bent to `knee` degrees (180 = straight leg).
function body({ leftKnee = 180, rightKnee = 180, elbow = 170, swing = 0 } = {}) {
  const lm = Array.from({ length: 33 }, () => P(0.5, 0.5));
  const leg = (hipX, deg, iHip, iKnee, iAnkle) => {
    const hip = P(hipX, 0.5), knee = P(hipX, 0.7);
    const a = ((180 - deg) * Math.PI) / 180; // shin rotates away from straight
    lm[iHip] = hip; lm[iKnee] = knee;
    lm[iAnkle] = P(knee.x + 0.2 * Math.sin(a), knee.y + 0.2 * Math.cos(a));
  };
  leg(0.55, leftKnee, 23, 25, 27);
  leg(0.45, rightKnee, 24, 26, 28);
  // left arm: shoulder → elbow (upper arm swung from vertical) → wrist
  const sh = P(0.6, 0.25), sw = (swing * Math.PI) / 180;
  const el = P(sh.x + 0.15 * Math.sin(sw), sh.y + 0.15 * Math.cos(sw));
  const a = ((180 - elbow) * Math.PI) / 180 + sw;
  lm[11] = sh; lm[13] = el; lm[15] = P(el.x + 0.15 * Math.sin(a), el.y + 0.15 * Math.cos(a));
  lm[12] = P(0.4, 0.25);
  return lm;
}

// Drive an exercise through a list of [pose options, ms] keyframes, holding each.
function run(id, frames, side = "left") {
  const ex = EXERCISES[id];
  let d = newState(); let t = 0; const events = [];
  for (const [opts, ms] of frames) {
    for (let k = 0; k < ms / 50; k++) {
      t += 50;
      const r = ex.read(opts === null ? undefined : body(opts), side);
      const s = ex.step(d, r.input, t);
      d = s.d; if (s.event) events.push(s.event);
    }
  }
  return { d, events };
}

test("angle helper", () => {
  assert.ok(Math.abs(calculateAngle(P(0, 0), P(0, 1), P(1, 1)) - 90) < 0.01);
});

test("squat: full reps count, shallow ones are flagged", () => {
  const rep = [[{}, 600], [{ leftKnee: 85, rightKnee: 85 }, 700], [{}, 700]];
  const { d } = run("squat", [...rep, ...rep, ...rep]);
  assert.equal(d.reps, 3);
  const shallow = run("squat", [[{}, 600], [{ leftKnee: 125, rightKnee: 125 }, 700], [{}, 700]]);
  assert.equal(shallow.d.reps, 0);
  assert.equal(shallow.d.partial, 1);
  assert.ok(shallow.events.includes("partial"));
});

test("squat: losing the body pauses and never counts", () => {
  const { d, events } = run("squat", [[{}, 500], [{ leftKnee: 85, rightKnee: 85 }, 500], [null, 500], [{}, 600]]);
  assert.equal(d.reps, 0);
  assert.ok(events.includes("lost"));
});

test("curl: counts curls and warns when the elbow swings", () => {
  const rep = [[{ elbow: 170 }, 500], [{ elbow: 40 }, 600], [{ elbow: 170 }, 600]];
  const clean = run("curl", [...rep, ...rep]);
  assert.equal(clean.d.reps, 2);
  assert.ok(clean.events.includes("rep"));
  const swingy = run("curl", [[{ elbow: 170 }, 500], [{ elbow: 40, swing: 60 }, 600], [{ elbow: 170 }, 600]]);
  assert.equal(swingy.d.reps, 1);
  assert.ok(swingy.events.includes("swing"));
});

test("lunge: counts each side and notices repeats", () => {
  const stand = [{}, 600];
  const left = [{ leftKnee: 95, rightKnee: 150 }, 700];
  const right = [{ leftKnee: 150, rightKnee: 95 }, 700];
  const { d } = run("lunge", [stand, left, stand, right, stand, right, stand]);
  assert.equal(d.reps, 3);
  assert.equal(d.leftReps, 1);
  assert.equal(d.rightReps, 2);
  assert.equal(d.sideRepeats, 1);
});

test("form consistency and summary", () => {
  const stats = { totalFrames: 100, reliableFrames: 90, lostEvents: 0 };
  assert.equal(trackingQuality(stats), 90);
  assert.equal(formConsistency({ ...stats, reps: 8, partial: 2, tooFast: 0 }), Math.round(100 * (0.7 * 0.8 + 0.3 * 0.9)));
  const d = { ...newState(), reps: 8, partial: 2 };
  const sum = summarise("squat", d, stats, 61000, "left");
  assert.equal(sum.reps, 8);
  assert.equal(sum.duration_seconds, 61);
  assert.equal(sum.side, null);
  assert.deepEqual(sum.notes, ["note_depth"]);
});
