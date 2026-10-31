// Writes data/fitforge.json and evals/tasks/*.json from the fixture and the ground-truth queries.
//   npm run generate
//   npm run generate -- --check     exit 1 if the committed files differ

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataset } from "../mcp/dataset.ts";
import { buildTasks } from "../evals/ground-truth.ts";
import { ROOT } from "./lib.ts";

const dataPath = join(ROOT, "data", "fitforge.json");
const tasksDir = join(ROOT, "evals", "tasks");

function stable(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function files(): Map<string, string> {
  const out = new Map<string, string>();
  out.set(dataPath, stable(dataset));
  for (const t of buildTasks()) out.set(join(tasksDir, `${t.id}.json`), stable(t));
  return out;
}

const check = process.argv.includes("--check");
const next = files();

if (check) {
  const problems: string[] = [];
  const onDisk = new Set(readdirSync(tasksDir).filter((f) => f.endsWith(".json")).map((f) => join(tasksDir, f)));
  for (const [path, text] of next) {
    onDisk.delete(path);
    let have = "";
    try {
      have = readFileSync(path, "utf8");
    } catch {
      problems.push(`missing ${path}`);
      continue;
    }
    if (have !== text) problems.push(`differs ${path}`);
  }
  for (const extra of onDisk) problems.push(`extra ${extra}`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`ok ${next.size} files`);
} else {
  mkdirSync(join(ROOT, "data"), { recursive: true });
  mkdirSync(tasksDir, { recursive: true });
  for (const name of readdirSync(tasksDir)) {
    if (name.endsWith(".json") && !next.has(join(tasksDir, name))) rmSync(join(tasksDir, name));
  }
  for (const [path, text] of next) writeFileSync(path, text);
  console.log(`wrote ${next.size} files`);
}
