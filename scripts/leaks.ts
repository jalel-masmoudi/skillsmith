// Rejects skill text that copies eval questions, fixture names, or answers.

import { dataset } from "../mcp/dataset.ts";

export interface LeakTask {
  id: string;
  question: string;
  answer: number | string;
}

function standalone(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(text);
}

function entityNames(): string[] {
  const names: string[] = [];
  for (const g of dataset.gyms) names.push(g.id, g.name, g.city);
  for (const m of dataset.members) names.push(m.id, m.full_name);
  for (const c of dataset.classes) names.push(c.id, c.name, c.instructor);
  for (const b of dataset.bookings) names.push(b.id);
  for (const i of dataset.invoices) names.push(i.id);
  for (const p of dataset.payments) names.push(p.id);
  for (const r of dataset.refunds) names.push(r.id);
  return names;
}

/** Phrases and tokens the new skill must not contain. Empty when the text is clean. */
export function findLeaks(text: string, tasks: LeakTask[]): string[] {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const t of tasks) {
    if (lower.includes(t.id.toLowerCase())) hits.push(t.id);
    if (t.question && lower.includes(t.question.toLowerCase())) hits.push(t.question);
    const answer = String(t.answer);
    if (answer.length >= 3 && standalone(text, answer)) hits.push(answer);
  }
  for (const name of entityNames()) {
    if (!name) continue;
    // "Africa/Tunis" is the zone used in questions, not the city row by itself.
    const hay = name.toLowerCase() === "tunis" ? text.replace(/africa\/tunis/gi, " ") : text;
    const seen = /\s/.test(name) ? hay.toLowerCase().includes(name.toLowerCase()) : standalone(hay, name);
    if (seen) hits.push(name);
  }
  return [...new Set(hits)];
}
