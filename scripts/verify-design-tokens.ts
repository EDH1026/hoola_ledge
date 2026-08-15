// Static regression check for the v2.19 배치 A design-token sweep (PRD §24).
// Purely textual/regex-based — it doesn't parse JSX — so it's a net that
// catches regressions, not a proof of correctness. Checks 1-3 are precise
// enough to fail the build; checks 4-6 are heuristics over raw source text
// (multi-line JSX attributes, string interpolation, etc. can trip false
// positives) and only print warnings.
//
// Usage:
//   npx tsx scripts/verify-design-tokens.ts
//   npm run verify:design

import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { PARTICIPANT_PALETTE } from "../src/lib/participant-colors";
import { HEAT_TIER_COLORS, HEAT_TIER_ORDER } from "../src/lib/heatmap-tiers";

// ---- WCAG 2.x relative luminance / contrast ratio, no external deps ----
// (배치 C, PRD §24.13 작업 7 — "외부 의존성 추가하지 마")
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACE_HEX = "#0f172a"; // --color-surface
const LIGHT_TEXT_HEX = "#f8fafc"; // near --color-content, used on heat tiles

const SRC_DIR = path.join(__dirname, "..", "src");
const UI_DIR = path.join(SRC_DIR, "components", "ui");

interface Hit {
  file: string;
  line: number;
  text: string;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/** Every non-overlapping match of `pattern` (must be `g`-flagged) across every file, as file:line hits. */
function findAll(files: string[], pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      hits.push({
        file: path.relative(process.cwd(), file),
        line: lineNumberAt(content, m.index),
        text: m[0],
      });
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width infinite loop
    }
  }
  return hits;
}

function report(title: string, hits: Hit[]) {
  console.log(`\n${title}: ${hits.length} hit(s)`);
  for (const h of hits.slice(0, 50)) {
    console.log(`  ${h.file}:${h.line}  ${h.text.trim().slice(0, 100)}`);
  }
  if (hits.length > 50) console.log(`  ... and ${hits.length - 50} more`);
}

const allFiles = listSourceFiles(SRC_DIR);
const nonUiFiles = allFiles.filter((f) => !f.startsWith(UI_DIR + path.sep));

let hardFail = false;

// ---- 1. text|bg|border-slate-600 = 0 ----
const slate600 = findAll(allFiles, /\b(?:text|bg|border)-slate-600\b/g);
report("1. slate-600 usage (must be 0)", slate600);
if (slate600.length > 0) hardFail = true;

// ---- 2. text-red-500 = 0 ----
const redText500 = findAll(allFiles, /\btext-red-500\b/g);
report("2. text-red-500 usage (must be 0)", redText500);
if (redText500.length > 0) hardFail = true;

// ---- 3. bg-slate-100 = 0 ----
const bgSlate100 = findAll(allFiles, /\bbg-slate-100\b/g);
report("3. bg-slate-100 usage (must be 0)", bgSlate100);
if (bgSlate100.length > 0) hardFail = true;

// ---- 4. raw <h2> that bypassed SectionTitle (warn only) ----
// Looks for an <h2 ...> tag whose className has font-semibold but either
// text-sm or no text-{size} utility at all.
const h2Hits: Hit[] = [];
for (const file of nonUiFiles) {
  const content = readFileSync(file, "utf8");
  const tagRe = /<h2\b[\s\S]*?(?<!=)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content))) {
    const tag = m[0];
    const classMatch = tag.match(/className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/);
    const cls = classMatch ? classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? "" : "";
    const hasFontSemibold = /font-semibold/.test(cls);
    const hasTextSize = /\btext-(xs|sm|base|lg|xl|2xl)\b/.test(cls);
    if (hasFontSemibold && (!hasTextSize || /\btext-sm\b/.test(cls))) {
      h2Hits.push({
        file: path.relative(process.cwd(), file),
        line: lineNumberAt(content, m.index),
        text: tag.replace(/\s+/g, " "),
      });
    }
  }
}
report("4. [warn] raw <h2> bypassing SectionTitle", h2Hits);

// ---- 5. <button> outside ui/ with hover: but no focus-visible: (warn only) ----
const buttonHits: Hit[] = [];
for (const file of nonUiFiles) {
  const content = readFileSync(file, "utf8");
  const tagRe = /<button\b[\s\S]*?(?<!=)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content))) {
    const tag = m[0];
    const classMatch = tag.match(/className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{([^}]*)\})/);
    const cls = classMatch
      ? classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? classMatch[4] ?? ""
      : "";
    if (/hover:/.test(cls) && !/focus-visible:/.test(cls)) {
      buttonHits.push({
        file: path.relative(process.cwd(), file),
        line: lineNumberAt(content, m.index),
        text: tag.replace(/\s+/g, " "),
      });
    }
  }
}
report("5. [warn] raw <button> with hover: but no focus-visible:", buttonHits);

// ---- 6. p-5 / rounded-xl on a bespoke card container outside ui/ (warn only) ----
// Heuristic signature of a hand-rolled card: rounded-xl or p-5 co-occurring
// with a border/bg class in the same className. Prone to false positives
// (e.g. legitimate one-off shells like the login page), hence warn-only.
const cardBypassHits: Hit[] = [];
for (const file of nonUiFiles) {
  const content = readFileSync(file, "utf8");
  const classAttrRe = /className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
  let m: RegExpExecArray | null;
  while ((m = classAttrRe.exec(content))) {
    const cls = m[1] ?? m[2] ?? m[3] ?? "";
    const looksLikeCard = /\bborder\b|\bbg-(surface|slate)-?\w*/.test(cls);
    if (looksLikeCard && (/\brounded-xl\b/.test(cls) || /\bp-5\b/.test(cls))) {
      cardBypassHits.push({
        file: path.relative(process.cwd(), file),
        line: lineNumberAt(content, m.index),
        text: cls,
      });
    }
  }
}
report("6. [warn] possible Card-bypass (rounded-xl/p-5 + border/bg outside ui/)", cardBypassHits);

// ---- 7. interactive <button> without a 44px (or 36px dense-chip) hit target (warn only) ----
// PRD §24.11: primary/destructive/row actions/steppers/calendar cells need
// min-h-11 (44px); dense filter chips are an explicit exception at min-h-9
// (36px) — both count as "has a considered hit target" here. Heuristic only:
// a button styled entirely via a template-literal ternary (chipClassName()
// helpers etc.) won't have its className visible on the tag itself, so this
// under-reports rather than over-reports.
const smallButtonHits: Hit[] = [];
for (const file of nonUiFiles) {
  const content = readFileSync(file, "utf8");
  const tagRe = /<button\b[\s\S]*?(?<!=)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content))) {
    const tag = m[0];
    const classMatch = tag.match(/className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{([^}]*)\})/);
    const cls = classMatch
      ? classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? classMatch[4] ?? ""
      : "";
    const isInteractive = /onClick=|type=["']submit["']/.test(tag);
    const hasHitTarget = /\b(?:min-h-(?:9|11|12)|h-11|h-12|w-11|w-12)\b/.test(cls);
    if (isInteractive && cls && !hasHitTarget) {
      smallButtonHits.push({
        file: path.relative(process.cwd(), file),
        line: lineNumberAt(content, m.index),
        text: tag.replace(/\s+/g, " "),
      });
    }
  }
}
report(
  "7. [warn] interactive <button> without a min-h-11/min-h-9 hit target",
  smallButtonHits
);

// ---- 8. title= on an interactive element (warn only) ----
// PRD §24.10/§24.12: a title tooltip is unreachable by touch, so interactive
// elements should surface the same info via visible text or aria-label
// instead.
const titleHits: Hit[] = [];
for (const file of nonUiFiles) {
  const content = readFileSync(file, "utf8");
  const tagRe = /<(button|a)\b[\s\S]*?(?<!=)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content))) {
    const tag = m[0];
    if (/\btitle=/.test(tag)) {
      titleHits.push({
        file: path.relative(process.cwd(), file),
        line: lineNumberAt(content, m.index),
        text: tag.replace(/\s+/g, " "),
      });
    }
  }
}
report("8. [warn] title= on an interactive <button>/<a> (unreachable by touch)", titleHits);

// ---- 9. participant palette contrast (배치 C, PRD §24.13 작업 7) ----
// Every color in PARTICIPANT_PALETTE must hit >=3:1 against --color-surface
// — this is what makes a chart line/dot legible against the app's dark
// background. Precise math, not a heuristic, so it fails the build like
// checks 1-3.
console.log("\n9. participant palette contrast vs surface (must be >=3:1):");
let paletteFail = false;
for (const hex of PARTICIPANT_PALETTE) {
  const ratio = contrastRatio(hex, SURFACE_HEX);
  const ok = ratio >= 3;
  console.log(`  ${hex}  ${ratio.toFixed(2)}:1  ${ok ? "OK" : "FAIL"}`);
  if (!ok) paletteFail = true;
}
if (paletteFail) hardFail = true;

// ---- 10. heatmap tier contrast (배치 C, PRD §24.13 작업 7) ----
// Each of the 5 discrete heat-tier colors must hit >=1.5:1 against the
// surrounding surface (so the tile itself reads as "colored" against the
// page), and light text on top of the tile must hit >=4.5:1 (so the number
// inside stays legible per WCAG AA body text).
console.log("\n10. heatmap tier contrast (tile vs surface >=1.5:1, text vs tile >=4.5:1):");
let heatmapFail = false;
for (const tier of HEAT_TIER_ORDER) {
  const hex = HEAT_TIER_COLORS[tier];
  const bgRatio = contrastRatio(hex, SURFACE_HEX);
  const textRatio = contrastRatio(LIGHT_TEXT_HEX, hex);
  const bgOk = bgRatio >= 1.5;
  const textOk = textRatio >= 4.5;
  console.log(
    `  ${tier} ${hex}  vs surface ${bgRatio.toFixed(2)}:1 ${bgOk ? "OK" : "FAIL"}  |  text vs tile ${textRatio.toFixed(2)}:1 ${textOk ? "OK" : "FAIL"}`
  );
  if (!bgOk || !textOk) heatmapFail = true;
}
if (heatmapFail) hardFail = true;

console.log(
  `\n${hardFail ? "FAIL" : "PASS"}: checks 1-3, 9-10 ${hardFail ? "found violations" : "clean"}. Checks 4-8 are informational.`
);
if (hardFail) process.exit(1);
