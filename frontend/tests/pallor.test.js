// Unit tests for the eyelid colour (pallor) maths. Run with:  npm test
import test from "node:test";
import assert from "node:assert/strict";
import { rgbToLab, greyWorldGains, regionLab, pallorReading } from "../src/lib/pallorMetrics.js";

// Build an RGBA image: background colour, plus coloured discs.
function image(w, h, bg, discs = []) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = bg;
    for (const d of discs) if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r ** 2) c = d.c;
    const i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return data;
}

const SKIN = [200, 150, 125];
const RED_LID = [190, 85, 90];   // healthy-looking inner eyelid
const PALE_LID = [205, 150, 145]; // pale inner eyelid

test("Lab conversion: white is neutral, red has positive a*", () => {
  const [L, a, b] = rgbToLab(255, 255, 255);
  assert.ok(Math.abs(L - 100) < 0.5 && Math.abs(a) < 0.5 && Math.abs(b) < 0.5);
  assert.ok(rgbToLab(200, 60, 60)[1] > 40);
  assert.ok(rgbToLab(60, 200, 60)[1] < -40);
});

test("grey-world gains neutralise a colour cast", () => {
  const data = image(40, 40, [180, 140, 100]); // warm cast
  const [gr, gg, gb] = greyWorldGains(data);
  assert.ok(gr < 1 && gb > 1);
  assert.ok(Math.abs(180 * gr - 100 * gb) < 1);
});

test("region stats ignore glare and shadow pixels", () => {
  const data = image(100, 100, [120, 120, 120], [
    { x: 50, y: 50, r: 20, c: RED_LID },
    { x: 50, y: 50, r: 4, c: [255, 255, 255] }, // glare spot inside
  ]);
  const s = regionLab(data, 100, 100, 50, 50, 18);
  assert.ok(s.used < s.total);
  assert.ok(Math.abs(s.a - rgbToLab(...RED_LID)[1]) < 0.5);
  assert.equal(regionLab(image(50, 50, [5, 5, 5]), 50, 50, 25, 25, 10), null);
});

test("a red eyelid scores higher than a pale one, relative to the same skin", () => {
  const W = 200, H = 160;
  const mk = (lid) => image(W, H, [110, 110, 110], [
    { x: 60, y: 60, r: 25, c: lid }, { x: 140, y: 100, r: 25, c: SKIN },
  ]);
  const read = (data) => {
    const g = greyWorldGains(data);
    return pallorReading(regionLab(data, W, H, 60, 60, 20, g), regionLab(data, W, H, 140, 100, 20, g));
  };
  const red = read(mk(RED_LID));
  const pale = read(mk(PALE_LID));
  assert.equal(red.ok, true);
  assert.ok(red.relative_index > pale.relative_index + 8);
});

test("tapping skin twice (no contrast) asks for a retry", () => {
  const data = image(200, 160, [110, 110, 110], [{ x: 60, y: 60, r: 25, c: SKIN }, { x: 140, y: 100, r: 25, c: SKIN }]);
  const r = pallorReading(regionLab(data, 200, 160, 60, 60, 20), regionLab(data, 200, 160, 140, 100, 20));
  assert.equal(r.ok, false);
  assert.ok(r.issues.includes("not_eyelid"));
});

test("missing region → no reading", () => {
  assert.equal(pallorReading(null, { L: 50, a: 10, b: 10, used: 100, total: 100 }).ok, false);
});
