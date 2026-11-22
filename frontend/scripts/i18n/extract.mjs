// Collect every user-facing English string in src/ into scripts/i18n/strings.json.
// Run:  node scripts/i18n/extract.mjs   (then translate.mjs)
//
// Picks up JSX text, user-facing JSX attributes (title, placeholder, aria-label, alt)
// and string / template literals that read like English UI text. Numbers are
// normalised to {0},{1}… so "3 of 8 reps" and "5 of 8 reps" share one entry —
// the runtime translator does the same.
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseMod from "@babel/traverse";

const traverse = traverseMod.default || traverseMod;
const ROOT = path.resolve(import.meta.dirname, "../../src");
const OUT = path.resolve(import.meta.dirname, "strings.json");

const UI_ATTRS = new Set(["title", "placeholder", "aria-label", "alt", "label", "hint", "sub", "desc", "description", "name"]);
const SKIP_ATTRS = new Set(["className", "class", "style", "href", "to", "src", "id", "key", "type", "role", "dir", "lang", "name", "htmlFor", "path", "element"]);
// Some files hold non-UI data (Arabic copy, model config, course text is already UI though).
const SKIP_FILES = [/\/lib\/(exerciseEngine|poseMetrics|vitalsSummary)\.js$/, /\/i18n\//];

export function normalise(text) {
  let i = 0;
  return text.replace(/\s+/g, " ").trim().replace(/\d+(?:[.,:]\d+)*/g, () => `{${i++}}`);
}

export function looksLikeUi(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 600) return false;
  if (!/[A-Za-z]{2,}/.test(t)) return false;                 // needs real letters
  if (/[؀-ۿ]/.test(t)) return false;                 // already Arabic/Urdu
  if (/^(https?:|\/|\.\/|#|data:|mailto:)/.test(t)) return false; // URLs, paths
  if (/^[a-z0-9_.\-/:@]+$/.test(t) && !/\s/.test(t)) {
    // single lowercase token: identifiers, keys, css values… keep only common words
    return /^(ok|yes|no|home|chat|more|close|cancel|save|send|start|stop|back|next|done|edit|delete|logout|login|search|loading)$/i.test(t);
  }
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 4 && t.includes("_")) return false; // CONSTANT_NAMES
  if (/^(var\(|rgba?\(|#[0-9a-f]{3,8}$|linear-gradient|\d+px|\d+(\.\d+)?(rem|em|%|ms|s)$)/i.test(t)) return false;
  if (/^[\w-]+(\s[\w-]+)*$/.test(t) && /^(btn|card|row|grid|badge|tab|muted|pulse|checkin|exercise|fc-|nav|sidebar|topbar|stat|icon|lang|quick|hero)/.test(t)) return false; // class lists
  if (/[{};]\s*$/.test(t) && /:\s/.test(t)) return false;    // css blobs
  if (/^(GET|POST|PUT|DELETE)$/.test(t)) return false;
  if (/^[a-z]+[A-Z][A-Za-z]*$/.test(t)) return false;             // camelCase keys
  if (/^[a-z]{2}-[A-Z]{2}$/.test(t)) return false;                // locale codes
  if (/^data(Min|Max)/.test(t)) return false;                     // chart domains
  return true;
}

const found = new Map(); // normalised -> example
function add(raw, file) {
  if (typeof raw !== "string") return;
  // Split multi-line JSX text into its pieces the DOM will show separately.
  for (const piece of raw.split(/\n\s*\n/)) {
    if (!looksLikeUi(piece)) continue;
    const key = normalise(piece);
    if (key && !found.has(key)) found.set(key, { example: piece.replace(/\s+/g, " ").trim(), file });
  }
}

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?)$/.test(f) && !SKIP_FILES.some((r) => r.test(p))) scan(p);
  }
}

function scan(file) {
  const code = fs.readFileSync(file, "utf8");
  let ast;
  try { ast = parse(code, { sourceType: "module", plugins: ["jsx"] }); }
  catch (e) { console.warn("skip (parse error)", file, e.message); return; }
  const rel = path.relative(ROOT, file);
  traverse(ast, {
    JSXText(p) { add(p.node.value, rel); },
    JSXAttribute(p) {
      const name = p.node.name.name;
      if (SKIP_ATTRS.has(name) && !UI_ATTRS.has(name)) { p.skip(); return; }
      if (p.node.value?.type === "StringLiteral" && UI_ATTRS.has(name)) add(p.node.value.value, rel);
    },
    StringLiteral(p) {
      const parent = p.parent;
      if (parent.type === "ImportDeclaration" || parent.type === "ExportAllDeclaration" || parent.type === "ExportNamedDeclaration") return;
      if (parent.type === "JSXAttribute") return; // handled above
      // object keys / property names that are clearly not UI
      if (parent.type === "ObjectProperty" && parent.key === p.node) return;
      if (parent.type === "CallExpression" && /^(querySelector|querySelectorAll|getItem|setItem|removeItem|addEventListener|removeEventListener|getElementById|toggle|contains|add|remove|request|fetch|matchMedia|setAttribute|getAttribute|includes|startsWith|endsWith|test|split|join|replace|padStart|toLocaleString|toLocaleDateString|toLocaleTimeString|Intl)$/.test(parent.callee?.property?.name || parent.callee?.name || "")) return;
      if (parent.type === "BinaryExpression" && ["===", "!==", "==", "!="].includes(parent.operator)) return; // comparisons
      if (parent.type === "SwitchCase") return;
      // Only English values inside the {en,ar} string tables: skip the ar table.
      const objProp = p.findParent((q) => q.isObjectProperty() && ["ar", "ur"].includes(q.node.key?.name));
      if (objProp) return;
      add(p.node.value, rel);
    },
    TemplateLiteral(p) {
      if (p.parent.type === "TaggedTemplateExpression") return;
      if (p.parent.type === "JSXExpressionContainer" && p.parentPath.parent.type === "JSXAttribute" && !UI_ATTRS.has(p.parentPath.parent.name.name)) return;
      if (p.parent.type === "CallExpression" && /^(request|fetch)$/.test(p.parent.callee?.name || p.parent.callee?.property?.name || "")) return;
      // Join the static parts with a placeholder so "Hello, ${name}!" → "Hello, {name}!" pieces.
      for (const q of p.node.quasis) add(q.value.cooked, rel);
    },
  });
}

walk(ROOT);
// Words that reach the page from the database or as fragments around <b> tags,
// so they never appear as literals in the source.
const EXTRA = [
  "patient", "caregiver", "provider", "Patient", "Caregiver", "Provider", "Primary Carer", "Doctor",
  "easy", "medium", "hard", "normal", "high", "low", "critical", "stable", "watch", "moderate",
  "scheduled", "completed", "cancelled", "confirmed", "missed", "taken", "pending", "open",
  "acknowledged", "resolved", "requested", "delivered", "dispatched", "preparing", "in_transit",
  "recent", "ref", "result", "results", "session", "sessions", "lesson", "lessons", "meal", "meals",
  "logged", "unlocked", "locked", "reps", "rep", "pts", "points", "bpm", "breaths/min", "ms", "min",
  "head", "and", "blink", "or", "of", "to", "today", "yesterday", "tomorrow", "now",
  "breakfast", "lunch", "dinner", "snack", "morning", "afternoon", "evening", "night",
  "male", "female", "left", "right", "mild", "severe",
  "I've been feeling dizzy for two days.",
];
for (const s of EXTRA) if (!found.has(normalise(s))) found.set(normalise(s), { example: s, file: "extra" });
const extra = process.argv.includes("--merge") && fs.existsSync(path.resolve(import.meta.dirname, "crawled.json"))
  ? JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "crawled.json"), "utf8")) : [];
for (const s of extra) add(s, "crawl");
const out = Object.fromEntries([...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.example]));
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`${Object.keys(out).length} strings → ${path.relative(process.cwd(), OUT)}`);
