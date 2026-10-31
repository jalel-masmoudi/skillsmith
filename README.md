# SkillSmith

An agent that writes its own manual for an API it has never seen. The API is **FitForge**, a fictional Tunisian gym chain, served as a small MCP server with a frozen dataset. The agent answers 20 fixed questions. When it misses, it rewrites its own skill. A later run should score higher on the same questions and the same scorer.

This repo started from the [TrueForge starter](https://github.com/nerdconf/trueforge-starter) for the Stranger Builds challenge *"Build an agent that gets better every time it runs"*.

```
run the evals ──► score ──► the agent rewrites its own skill ──► run again ──► higher score?
   (TrueForge session)         (committed with Agent-Session: <id>)
```

The skill at `agent/skills/fitforge-notes/SKILL.md` is an empty seed. Nothing in that file explains the API. The agent fills it in from its own runs.

## Run 1 vs run N

> Fill this in after the first measured runs. Five lines max. Keep the heading: the challenge checks for it.

- **Task and score:** 20 FitForge questions (14 train, 6 holdout). Wrong, or a right answer with zero tool calls when the reference uses tools, scores 0. Otherwise a right answer scores `0.8 + 0.2 × min(1, best_calls / actual_calls)`. Run score = `100 × mean`.
- **Run 1 → run N:** not run yet. This change has no model key.
- **The change that did it:** none yet.
- **What the agent learned:** nothing yet. The skill file is still empty.
- **What still fails:** the whole set. Run 1 has not happened.

## What the challenge asks

Build an agent on TrueForge that looks at its own runs, rewrites its own skills or instructions, and does the job better the next time. Then prove it in a public repo. You **complete** the challenge when your repo shows all four:

1. **GitHub:** a public repo, created on or after Sat 31 Oct, **not a fork** (made from this template is fine).
2. **TrueForge runtime:** your agent runs on TrueForge, and each run you count is a TrueForge session.
3. **Run 1 vs a later run:** same tasks, same scorer. The later run comes after at least one change the agent made to itself.
4. **The agent changed itself, and it got better:** a commit with the agent's change to `agent/`, between run 1 and the later run, ending with `Agent-Session: <session_id>`, and a higher score after it.

The rule: **the agent writes the change.** You can review it, keep it or drop it. You don't write it.

## What's in here

```
agent/
  agent.json                         name, model, skill_mode (inline)
  instructions.md                    system prompt and the JSON answer contract
  skills/fitforge-notes/SKILL.md     empty seed; the agent rewrites this
mcp/                                 FitForge MCP server (HTTP and stdio) and the frozen rows
data/fitforge.json                   the same rows, written by npm run generate
evals/tasks/*.json                   20 questions; answers computed, not typed in
evals/score.ts                       deterministic scorer
evals/ground-truth.ts                derives answers and best_calls from the rows
scripts/                             setup, run-evals, improve (the starter loop)
docs/MCP.md                          how to run the server, and what was not verified
docs/DESIGN.md                       the next change: keep a skill edit only if train score rises
docs/QUESTIONS.md                    the 20 questions, text only
```

## Quickstart

You need Node.js 22.14+ and git. A model key is required only when you actually run TrueForge. Tests do not need one.

**1. Install**

```bash
npm install
cp .env.example .env
```

**2. Check the fixture, the scorer, and the MCP server**

```bash
npm test
npm run typecheck
```

`npm run generate` rewrites `data/fitforge.json` and `evals/tasks/*.json`. `npm run generate -- --check` fails if those files drift.

**3. Start the gym API** (leave it running):

```bash
npm run mcp
```

**4. Start TrueForge** in another terminal, with this host allowed, then create the agent:

```bash
OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]' npx @truefoundry/trueforge@latest
```

```bash
npm run setup
```

Add a model under Settings → Models and set `TF_MODEL` if you are not using `anthropic/claude-sonnet-4-6`. Model keys go in the TrueForge UI, not in this repo.

**5. Run 1, then let the agent edit its skill**

```bash
npm run run-evals
npm run improve
npm run run-evals
```

After run 1, do not change `evals/` again. Same tasks, same scorer, every run.

Question text is in [docs/QUESTIONS.md](docs/QUESTIONS.md). How the server runs, and what has not been tried against a live TrueForge, is in [docs/MCP.md](docs/MCP.md).

## The loop

**`npm run run-evals`**

1. Refuses to run if `agent/` or `evals/` has uncommitted changes.
2. Syncs the TrueForge agent with `agent/`, and registers the `fitforge` MCP server at `GYM_MCP_URL`.
3. Opens one TrueForge session. Each question is one root turn (`previousTurnId: "none"`).
4. Scores every reply. MCP call counts come from `model.message` tool calls on that turn. Writes `runs/run-NN/` and a row in `runs/summary.csv`.
5. Commits `runs/` as `run NN: score X` (skip with `--no-commit`).

**`npm run improve`**

Shows the failed training questions (never the holdout), whether the answer matched, and the call counts. It does not show the stored answer. The agent may change only `agent/instructions.md` and `agent/skills/<name>/SKILL.md`. The new text must not quote a task id, a question, or a fixture name or id. Short answers count only when they sit next to a name. Schema words such as frozen or closed stay allowed. The commit trailer is `Agent-Session: <session_id>`.

**`npm run score -- --selftest`** checks perfect, wrong, unparseable, and wasteful replies. **`npm run score -- runs/run-NN`** re-scores a saved run.

## Scorer

Per question: 0 if the answer is missing, wrong, or right with zero tool calls when `best_calls` is above 0. Otherwise a right answer scores `0.8 + 0.2 × min(1, best_calls / actual_calls)`. Text must match after trim, casefold, and collapsed whitespace. Numbers match within ±0.01. The run score is `100 ×` the mean. A question passes when it is correct and the call ratio is 1.

`best_calls` is the number of tool calls in the reference sequence in `evals/ground-truth.ts`. That sequence is run against the tools; its result has to equal a separate query over the rows. Both are checked by `npm test`.

## Skills, MCP, sandbox

`skill_mode` is `inline`: the skill text is pasted into the instructions, and no sandbox is required. The agent also gets the FitForge MCP server. That is two of the TrueForge pieces the challenge asks for (skills and MCP), on top of the SDK the starter already uses. The eval config turns dynamic subagents off and web search off. Web search is the SDK's web and fetch switch. Nothing else in the manifest adds a fetch tool.

`git` mode registers real skills and turns the sandbox on. Local npx on Linux needs `bubblewrap`, `socat`, and `ripgrep`, then a TrueForge restart. See [docs/MCP.md](docs/MCP.md) for what was and was not run on this machine.

## Verified in this change

- `npm test` and `npm run typecheck`.
- Ground truth matches the committed task files, including the six holdout ids.
- HTTP and stdio speak MCP to this process. Tool descriptions stay short. List pages, millime amounts, deleted members, and cancelled bookings behave as the tests describe.

Not verified: a live TrueForge server, connector registration, a real model, `skill_mode: "git"`, or the Linux sandbox packages. Details in [docs/MCP.md](docs/MCP.md).

The next edit policy (trace subagents, one small skill edit, keep it only if the train score rises) is in [docs/DESIGN.md](docs/DESIGN.md). It is not built yet.

## License

MIT, see [LICENSE](LICENSE).
