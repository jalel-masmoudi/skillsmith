# SkillSmith

An agent that writes its own manual for an API it has never seen. The API is **FitForge**, a fictional Tunisian gym chain, served as a small MCP server with a frozen dataset. The agent answers 20 fixed questions. When it misses, it rewrites its own skill. A later run should score higher on the same questions and the same scorer.

This repo started from the [TrueForge starter](https://github.com/nerdconf/trueforge-starter) for the Stranger Builds challenge *"Build an agent that gets better every time it runs"*.

```
run the evals ──► score ──► the agent rewrites its own skill ──► run again ──► higher score?
   (TrueForge session)         (committed with Agent-Session: <id>)
```

The skill at `agent/skills/fitforge-notes/SKILL.md` started as an empty seed. The agent has filled it in from its own runs. The measured comparison is in [Run 1 vs run 3](#run-1-vs-run-3).

## Run 1 vs run N

- **Task and score:** 20 FitForge questions (14 train, 6 holdout). A wrong answer scores 0. A right answer scores `0.8 + 0.2 × min(1, best_calls / actual_calls)`. The run score is `100 ×` the mean.
- **Run 1 → run N:** Run 1 scored 75.96, run 2 scored 72.3, and run 3 scored 81.83 (`runs/summary.csv`).
- **The change that did it:** the agent rewrote its skill after run 1 ([8e11168](https://github.com/jalel-masmoudi/skillsmith/commit/8e111681adf2ab4868d59ea17f6f5fecfe0a7005)) and again after run 2 ([9e895f2](https://github.com/jalel-masmoudi/skillsmith/commit/9e895f2140ca14b82ef2668abe9aca36c122ed17)).
- **What the agent learned:** after run 1, reuse ids from search and paginate every list. After run 2, a cut-off page and a missing timezone conversion were the named causes of the misses.
- **What still fails:** on run 3, training task 04 and holdout tasks 16 and 20 are still wrong. See [Run 1 vs run 3](#run-1-vs-run-3).

## Run 1 vs run 3

These figures are copied from `runs/summary.csv` and from `score.json` and `results.json` in each run folder.

| Run | Score | Tasks passed | Tokens | Tool calls | Duration (seconds) | Agent commit |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| [1](runs/run-01) | 75.96 | 6 / 20 | 225321 | 74 | 140 | [`cbc0e20`](https://github.com/jalel-masmoudi/skillsmith/commit/cbc0e208392d55b2c7e5505879f5add1a4cd3dee) |
| [2](runs/run-02) | 72.3 | 7 / 20 | 243402 | 72 | 138 | [`8e11168`](https://github.com/jalel-masmoudi/skillsmith/commit/8e111681adf2ab4868d59ea17f6f5fecfe0a7005) |
| [3](runs/run-03) | 81.83 | 8 / 20 | 270312 | 72 | 152 | [`9e895f2`](https://github.com/jalel-masmoudi/skillsmith/commit/9e895f2140ca14b82ef2668abe9aca36c122ed17) |

Run 2 scored 72.3, which is lower than run 1. The agent then learned again from run 2's misses, and run 3 scored 81.83. That beats 75.96 on the same 20 tasks, the same scorer, and the same model, `truefoundry/tfy-managed-claude-haiku-4-5-20251001`.

The agent's own skill rewrites are [8e11168](https://github.com/jalel-masmoudi/skillsmith/commit/8e111681adf2ab4868d59ea17f6f5fecfe0a7005) and [9e895f2](https://github.com/jalel-masmoudi/skillsmith/commit/9e895f2140ca14b82ef2668abe9aca36c122ed17). The saved runs are [runs/run-01](runs/run-01), [runs/run-02](runs/run-02), and [runs/run-03](runs/run-03).

The first rewrite says to reuse ids from search results, always paginate list operations, and avoid parallel searches when one result already has the id. The second says truncated responses and missing timezone conversion caused the misses, and redundant searches and inefficient filtering chains caused the extra calls.

Per-task scores from `results.json`. Tasks 01–14 are training. Tasks 15–20 are held out.

| Task | Split | Run 1 | Run 3 |
| --- | --- | ---: | ---: |
| 01-lac-current-members | train | 1 | 1 |
| 02-lac-march-net | train | 0 | 1 |
| 03-yoga-bookings | train | 0.9 | 0.92 |
| 04-amira-owed | train | 0.9333 | 0 |
| 05-lac-classes-15-mar | train | 1 | 1 |
| 06-yoga-instructor | train | 0.9 | 0.9333 |
| 07-youssef-sfax-status | train | 1 | 1 |
| 08-nour-current | train | 0.9333 | 0.9333 |
| 09-lac-march-refunds | train | 1 | 1 |
| 10-sunrise-local-time | train | 0.9 | 0.9333 |
| 11-sunrise-booked-names | train | 0.9333 | 0.9333 |
| 12-lac-march-invoices | train | 0 | 1 |
| 13-ariana-status | train | 1 | 1 |
| 14-amira-march-net | train | 0.95 | 0.95 |
| 15-boxe-free-seats | holdout | 0.92 | 0.95 |
| 16-sousse-april-net | holdout | 0 | 0 |
| 17-sfax-classes-2-apr | holdout | 1 | 1 |
| 18-omar-march-method | holdout | 0.9333 | 0.9333 |
| 19-zumba-booked-names | holdout | 0.8889 | 0.88 |
| 20-sarra-april-net | holdout | 0 | 0 |

On run 3 the answer is still wrong for training task `04-amira-owed` and for holdout tasks `16-sousse-april-net` and `20-sarra-april-net`. Each of those three scores 0. Task 04 was correct on run 1. Tasks 02 and 12 were wrong on run 1 and score 1 on run 3.

### Reproduce

Leave the gym server running, then set up the agent, let it rewrite the skill, and score again.

```bash
npm run mcp
npm run setup
npm run improve
npm run run-evals
```

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
  skills/fitforge-notes/SKILL.md     notes the agent rewrites from its runs
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

**5. Run the evals, then let the agent edit its skill**

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

See [How the agent improves itself](#how-the-agent-improves-itself).

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

Not verified here: a live model call. `npm run improve` is checked against the saved run 1 fixture. Details of the server are in [docs/MCP.md](docs/MCP.md).

## How the agent improves itself

`npm run run-evals` scores all 20 tasks. `npm run improve` reads that run. Misses are training answers that did not match (run 1: tasks 02 and 12). Extra calls are training answers that matched but used more calls than a short solution. Holdouts 15–20 are omitted. A diagnosis session uses subagents, then the agent rewrites its skill. The leak guard checks the edit. A clean edit is committed with `Agent-Session:` and the rewrite session id, including `runs/run-NN/diagnose-session.json`. Review with `git show`. Drop with `git reset --hard HEAD~1`. Then `npm run run-evals` again.

## License

MIT, see [LICENSE](LICENSE).
