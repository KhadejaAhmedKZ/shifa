// Translate scripts/i18n/strings.json into src/i18n/{ar,ur}.json with Gemini.
// Run:  node scripts/i18n/translate.mjs        (reads GEMINI_API_KEY from ../.env)
// Already-translated keys are kept, so re-running only translates new strings.
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const OUT_DIR = path.resolve(HERE, "../../src/i18n");
const strings = JSON.parse(fs.readFileSync(path.join(HERE, "strings.json"), "utf8"));
const env = fs.readFileSync(path.resolve(HERE, "../../../.env"), "utf8");
const KEY = (env.match(/^GEMINI_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) throw new Error("GEMINI_API_KEY missing in .env");
const MODEL = process.env.I18N_MODEL || "gemini-3.5-flash";

const LANGS = {
  ar: "Modern Standard Arabic as used in the UAE",
  ur: "Urdu (Pakistan), written in Urdu script",
};

const SYSTEM = (lang) => `You translate the user interface of "Shifa'", a healthcare companion web app for older adults,
their family carers and doctors in Abu Dhabi. Translate into ${lang}.
Rules:
- Return ONLY a JSON object mapping each input key to its translation.
- Keep placeholders like {0}, {1}, {n}, {name} exactly as they are.
- Keep emojis, arrows (→ ←), bullets, punctuation marks like "·" and "—" where sensible.
- The app name "Shifa'" becomes "شفاء". Keep these as-is: VitalLens, Gemini, UAE PASS, Jitsi, MediaPipe, CBC, HbA1c, AI (you may use the local word for AI).
- Short UI labels stay short (buttons, tabs, menu items). Use warm, simple, respectful language for older adults.
- Medical terms: use the common everyday term, not rare jargon.
- If a key is not natural language (a code, unit or name), return it unchanged.`;

async function translateBatch(langKey, keys) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM(LANGS[langKey]) }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(Object.fromEntries(keys.map((k) => [k, k])), null, 0) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
  };
  for (let attempt = 1; attempt <= 8; attempt++) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
    } catch (e) {
      console.warn(`  network error (${e.cause?.code || e.name}); retry ${attempt} in 10s`);
      await new Promise((r) => setTimeout(r, 10000));
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "{}";
      try { return JSON.parse(text); } catch { console.warn("  bad JSON, retrying"); }
    } else {
      const wait = res.status === 429 ? 30 : 8;
      console.warn(`  HTTP ${res.status}; retry ${attempt} in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  throw new Error("batch failed");
}

const placeholders = (s) => (s.match(/\{[^}]*\}/g) || []).sort().join("|");

fs.mkdirSync(OUT_DIR, { recursive: true });
const BATCH = 120;
// Optional: node translate.mjs ar   → only Arabic (lets you run languages in parallel)
const only = process.argv.slice(2).filter((a) => LANGS[a]);
for (const lang of only.length ? only : Object.keys(LANGS)) {
  const file = path.join(OUT_DIR, `${lang}.json`);
  const dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const todo = Object.keys(strings).filter((k) => !dict[k]);
  console.log(`${lang}: ${todo.length} to translate (${Object.keys(dict).length} cached)`);
  for (let i = 0; i < todo.length; i += BATCH) {
    const keys = todo.slice(i, i + BATCH);
    const out = await translateBatch(lang, keys);
    let ok = 0;
    for (const k of keys) {
      const v = out[k];
      // only accept translations that keep every placeholder
      if (typeof v === "string" && v.trim() && placeholders(v) === placeholders(k)) { dict[k] = v; ok++; }
    }
    fs.writeFileSync(file, JSON.stringify(dict, null, 1));
    console.log(`  ${lang} ${Math.min(i + BATCH, todo.length)}/${todo.length} (+${ok})`);
  }
}
console.log("done");
