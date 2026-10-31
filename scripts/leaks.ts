// Rejects skill text that copies eval questions, fixture names, or answers.
//
// The text is NFKC-normalized, zero-width characters are removed, and look-alike
// letters are mapped to Latin before matching. Names are matched after whitespace
// is collapsed. Ids and quoted questions are matched after that plus case-folding
// and treating "-" like "_", so gym-lac and gym_lac are the same id.
//
// Answers shorter than 3 characters (counts, yes/no) are leaks only within
// SHORT_ANSWER_WINDOW characters of a blocked name. A bare digit elsewhere is
// left alone. Clock answers (HH:MM) count only in that same window around a
// class name, so "00:30" next to Sunrise is a leak and "00:30" in a timezone
// note is not.

import { dataset } from "../mcp/dataset.ts";

export interface LeakTask {
  id: string;
  question: string;
  answer: number | string;
}

/** Characters of collapsed text between a blocked name and a short answer. */
export const SHORT_ANSWER_WINDOW = 40;

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060\u00AD]/g;

/** Letters that look like Latin but are not. Applied after NFKD. */
const LOOKALIKE: Record<string, string> = {
  "\u0430": "a", "\u0410": "A",
  "\u0435": "e", "\u0415": "E",
  "\u043e": "o", "\u041e": "O",
  "\u0440": "p", "\u0420": "P",
  "\u0441": "c", "\u0421": "C",
  "\u0443": "y", "\u0423": "Y",
  "\u0445": "x", "\u0425": "X",
  "\u0456": "i", "\u0406": "I",
  "\u0455": "s", "\u0405": "S",
  "\u03bf": "o", "\u039f": "O",
};

const NAME_PARTICLES = new Set(["ben", "el"]);
const SENTENCE_START_OK = new Set(["core", "spin", "stretch"]);
const ALWAYS_CLASS = new Set(["boxe", "zumba"]);

/** NFKD, drop combining marks and zero-width characters, map look-alike letters. Case is kept. */
export function normalizeForMatch(text: string): string {
  const base = text.normalize("NFKD").replace(/\p{M}/gu, "").replace(ZERO_WIDTH, "");
  let out = "";
  for (const ch of base) out += LOOKALIKE[ch] ?? ch;
  return out;
}

function sentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  return before.length === 0 || /[.!?]$/.test(before);
}

const SCHEMA_ENUMS = new Set(
  [
    ...dataset.gyms.map((g) => g.status),
    ...dataset.members.map((m) => m.status),
    ...dataset.classes.map((c) => c.status),
    ...dataset.bookings.map((b) => b.status),
    ...dataset.invoices.map((i) => i.status),
    ...dataset.payments.map((p) => p.method),
    "attended",
    "no_show",
  ].map((s) => s.toLowerCase()),
);

const GENERIC_CLASS_WORDS = new Set(["morning", "night", "flow", "cross", "training"]);

interface Span {
  start: number;
  end: number;
  label: string;
  kind: "name" | "class";
}

function escapeReg(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenSpans(haystack: string, token: string, flags: string): { start: number; end: number }[] {
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${escapeReg(token)})(?=$|[^\\p{L}\\p{N}_])`, flags);
  const out: { start: number; end: number }[] = [];
  for (let m = re.exec(haystack); m; m = re.exec(haystack)) {
    const start = m.index + m[0].length - m[1].length;
    out.push({ start, end: start + m[1].length });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

function near(spans: Span[], at: { start: number; end: number }, kind?: Span["kind"]): boolean {
  return spans.some((s) => {
    if (kind && s.kind !== kind) return false;
    const gap = at.start >= s.end ? at.start - s.end : s.start >= at.end ? s.start - at.end : 0;
    return gap <= SHORT_ANSWER_WINDOW;
  });
}

function words(value: string): string[] {
  return value.split(/\s+/).filter((w) => {
    const l = w.toLowerCase();
    return w.length >= 2 && !GENERIC_CLASS_WORDS.has(l) && !NAME_PARTICLES.has(l);
  });
}

/** Phrases and tokens the new skill must not contain. Empty when the text is clean. */
export function findLeaks(text: string, tasks: LeakTask[]): string[] {
  const collapsed = normalizeForMatch(text).replace(/[\s\u00a0]+/g, " ").trim();
  const folded = collapsed.replace(/-/g, "_").toLowerCase();
  const hits: string[] = [];
  const spans: Span[] = [];

  const add = (haystack: string, token: string, label: string, kind: Span["kind"], flags: string) => {
    for (const span of tokenSpans(haystack, token, flags)) {
      if (SENTENCE_START_OK.has(token.toLowerCase()) && sentenceStart(haystack, span.start)) continue;
      spans.push({ ...span, label, kind });
      hits.push(label);
    }
  };

  for (const g of dataset.gyms) {
    add(folded, g.id, g.id, "name", "gu");
    const short = g.name.replace(/^FitForge\s+/i, "");
    if (short) add(collapsed, short, short, "name", "giu");
  }
  for (const id of [
    ...dataset.members.map((m) => m.id),
    ...dataset.classes.map((c) => c.id),
    ...dataset.bookings.map((b) => b.id),
    ...dataset.invoices.map((i) => i.id),
    ...dataset.payments.map((p) => p.id),
    ...dataset.refunds.map((r) => r.id),
  ]) {
    add(folded, id, id, "name", "gu");
  }
  for (const m of dataset.members) {
    for (const w of words(m.full_name)) add(collapsed, w, w, "name", "giu");
  }
  for (const person of [...dataset.members.map((m) => m.full_name), ...dataset.classes.map((c) => c.instructor)]) {
    if (collapsed.toLowerCase().includes(person.toLowerCase())) hits.push(person);
  }
  for (const c of dataset.classes) {
    for (const w of words(c.instructor)) add(collapsed, w, w, "name", "giu");
  }

  const singleWord = new Set(dataset.classes.map((c) => c.name).filter((n) => !/\s/.test(n)));
  for (const name of new Set(dataset.classes.map((c) => c.name))) {
    const parts = name.split(/\s+/);
    if (parts.length === 1) {
      const flags = ALWAYS_CLASS.has(parts[0].toLowerCase()) ? "giu" : "gu";
      add(collapsed, parts[0], parts[0], "class", flags);
      continue;
    }
    if (collapsed.toLowerCase().includes(name.toLowerCase())) hits.push(name);
    for (const w of parts) {
      if (GENERIC_CLASS_WORDS.has(w.toLowerCase())) continue;
      if (singleWord.has(w)) add(collapsed, w, w, "class", "gu");
      else add(collapsed, w, w, "class", "giu");
    }
  }

  for (const t of tasks) {
    const id = t.id.toLowerCase().replace(/-/g, "_");
    if (id && folded.includes(id)) hits.push(t.id);
    const question = normalizeForMatch(t.question).replace(/[\s\u00a0]+/g, " ").trim().replace(/-/g, "_").toLowerCase();
    if (question && folded.includes(question)) hits.push(t.question);

    const answer = String(t.answer).trim();
    if (!answer || SCHEMA_ENUMS.has(answer.toLowerCase())) continue;
    if (/^\d{2}:\d{2}$/.test(answer)) {
      if (tokenSpans(collapsed, answer, "gu").some((at) => near(spans, at, "class"))) hits.push(answer);
      continue;
    }
    if (answer.length >= 3) {
      if (tokenSpans(folded, answer.toLowerCase(), "gu").length) hits.push(answer);
      if (typeof t.answer === "number" && Number.isFinite(t.answer)) {
        const milli = String(Math.round(t.answer * 1000));
        if (milli !== answer && tokenSpans(folded, milli, "gu").length) hits.push(milli);
      }
      continue;
    }
    if (tokenSpans(collapsed, answer, "giu").some((at) => near(spans, at))) hits.push(answer);
  }

  return [...new Set(hits)];
}
