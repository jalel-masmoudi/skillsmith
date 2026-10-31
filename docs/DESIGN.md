# Next change: accept a skill edit only when the train score rises

`npm run improve` reads training misses and extra-call tasks, asks a diagnosis session to use subagents, then has the agent rewrite the skill and commits that edit. It does not re-score before the commit. Run `npm run run-evals` afterward. Keeping an edit only when the train score rises is still a manual choice (`git reset --hard HEAD~1` drops it).

## Loop

1. Run the fixed evals (`npm run run-evals`). Holdout tasks are scored and are not shown to the editor.
2. For each failed training task, a trace-reading subagent gets that task's tool calls and tool results (from `runs/run-NN/session.json`) plus the scorer's correct/incorrect flag and the call counts. It does not get the stored answer. It writes a few sentences: what the trace shows about the tools, and what the notes failed to say.
3. A curator subagent proposes one small edit to `agent/skills/fitforge-notes/SKILL.md` (and, only if the output contract is untouched, `agent/instructions.md`). One failure pattern per edit. This is the same shape as ACE (arXiv 2510.04618): reflect on the trace, then add a short bullet, instead of rewriting the whole manual. GEPA (arXiv 2507.19457) is the selection rule: keep a candidate only when it scores higher on the same train tasks.
4. Apply the edit on a scratch copy of `agent/`. Re-score the **training** tasks only. Accept the edit when the train mean is strictly higher. Drop it otherwise.
5. Each accepted edit is its own commit. The commit message ends with the trailer `Agent-Session: <session_id>` of the curator session. That trailer is for those later commits. It is not used on the commits that add this harness.
6. Then run the full set again, holdout included, and append `runs/summary.csv`.

Stop after a fixed number of rejected edits in a row, or when every training task passes.

## Guards

- The curator may write only `agent/instructions.md` and `agent/skills/<name>/SKILL.md`. The path check in `scripts/improve.ts` stays.
- It must not write `evals/`, `mcp/`, `scripts/`, or `data/`.
- The new text must not contain a task id, a question, or a string answer of 12 characters or more. The existing leak check stays.
- The output contract (`"answer"`) stays. A skill edit that drops the frontmatter is rejected.
- Answers stay in `evals/tasks/*.json`. They are not part of the prompt. The starter has no hash for expected answers; numeric tolerance (±0.01) needs the number at score time, on the runner, which is not the agent.

## What this change does not do

It does not add schedules, a second model, or a hand-written manual. The notes in the skill come from an accepted edit or they stay empty.
