// Eyelid colour (conjunctival pallor) maths — pure functions, no DOM, unit-tested.
//
// Idea (from the literature summarised in TatianaUshakova/Anemia_detection, MIT):
// the inner lower eyelid looks paler when haemoglobin is low. That project
// corrects colour with a printed colour card and then uses the mean colour of
// the masked body part. We have no card, so we:
//   1. white-balance the whole frame with the grey-world assumption, and
//   2. compare the eyelid with the person's OWN cheek skin in the same photo,
// which cancels most of the lighting and camera differences. The result is a
// relative redness score that is only meaningful against the same person's
// earlier readings. It is a wellness prompt, never a haemoglobin estimate.

// ---- colour space ------------------------------------------------------------
const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);

/** sRGB (0-255) → CIELAB (D65). Returns [L, a, b]; a* is the red–green axis. */
export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// ---- white balance -------------------------------------------------------------
/**
 * Grey-world white balance gains from an RGBA pixel buffer: scale each channel
 * so the frame's average colour becomes neutral grey. Gains are clamped so a
 * frame dominated by one colour can't be pushed to extremes.
 */
export function greyWorldGains(data) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) { // every 4th pixel is plenty
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (!n) return [1, 1, 1];
  r /= n; g /= n; b /= n;
  const grey = (r + g + b) / 3;
  const clamp = (v) => Math.min(1.6, Math.max(0.6, v));
  return [clamp(grey / (r || 1)), clamp(grey / (g || 1)), clamp(grey / (b || 1))];
}

// ---- region statistics ---------------------------------------------------------
/**
 * Mean CIELAB colour inside a circle of an RGBA image, after white balance.
 * Glare (very bright, low-saturation) and shadow pixels are dropped — the
 * same job the masks do in the reference project.
 * @returns {{L:number,a:number,b:number,used:number,total:number}|null}
 */
export function regionLab(data, width, height, cx, cy, radius, gains = [1, 1, 1]) {
  let L = 0, A = 0, B = 0, used = 0, total = 0;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      total++;
      const i = (y * width + x) * 4;
      const r = Math.min(255, data[i] * gains[0]);
      const g = Math.min(255, data[i + 1] * gains[1]);
      const b = Math.min(255, data[i + 2] * gains[2]);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 245 && max - min < 25) continue; // specular glare
      if (max < 35) continue;                    // too dark / shadow
      const lab = rgbToLab(r, g, b);
      L += lab[0]; A += lab[1]; B += lab[2]; used++;
    }
  }
  if (!used) return null;
  return { L: L / used, a: A / used, b: B / used, used, total };
}

// ---- reading -------------------------------------------------------------------
export const PALLOR = {
  minPixels: 60,        // too few usable pixels → retry
  minUsedShare: 0.5,    // more than half the circle must be usable (not glare/shadow)
  minLightness: 25,     // photo too dark
  maxLightness: 85,     // photo washed out
  minContrast: 2,       // eyelid should be redder than skin; if not, probably mis-tapped
  retryQuality: 0.6,
};

/**
 * Build one reading from the eyelid and skin region statistics.
 * relative_index = eyelid a* − skin a*  (higher = redder eyelid than your own skin).
 * quality (0-1) reflects pixel count, glare share, exposure and plausibility.
 */
export function pallorReading(eyelid, skin) {
  if (!eyelid || !skin) return { ok: false, reason: "no_region" };
  const P = PALLOR;
  let quality = 1;
  const issues = [];
  const share = Math.min(eyelid.used / eyelid.total, skin.used / skin.total);
  if (eyelid.used < P.minPixels || skin.used < P.minPixels) { quality -= 0.5; issues.push("small"); }
  if (share < P.minUsedShare) { quality -= 0.3; issues.push("glare"); }
  if (eyelid.L < P.minLightness || skin.L < P.minLightness) { quality -= 0.4; issues.push("dark"); }
  if (eyelid.L > P.maxLightness || skin.L > P.maxLightness) { quality -= 0.4; issues.push("bright"); }
  const relative = eyelid.a - skin.a;
  if (relative < P.minContrast) { quality -= 0.5; issues.push("not_eyelid"); }
  quality = Math.max(0, Math.round(quality * 100) / 100);
  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    ok: quality >= P.retryQuality,
    reason: quality >= P.retryQuality ? null : issues[0] || "low_quality",
    issues,
    eyelid_index: round1(eyelid.a),
    skin_index: round1(skin.a),
    relative_index: round1(relative),
    quality,
  };
}
