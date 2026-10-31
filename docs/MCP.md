# FitForge MCP

A small MCP server over a frozen gym dataset (`mcp/dataset.ts`, copied to `data/fitforge.json`). Money is stored as integer millimes (1 TND = 1000 millimes). Timestamps are UTC. Questions in the evals are asked in Africa/Tunis (UTC+1, no daylight-saving shift). List tools return at most 5 rows and a `next_cursor`. Search tools return ids, not the full record. Member rows can carry `deleted_at`. Bookings, classes, and invoices have a status. Refunds are a separate table.

Tool descriptions are one short line. They do not explain those rules.

## Run

HTTP (what TrueForge can attach):

```bash
npm run mcp
# FitForge MCP http://127.0.0.1:8787/mcp
```

`GYM_MCP_PORT` wins, then `PORT`, then 8787. Bind address is `GYM_MCP_HOST` or `127.0.0.1`. One endpoint, `POST /mcp`, stateless JSON-RPC. A body over 1MB gets `413`. A notification gets `202`. `GET` and `DELETE` get `405`.

Stdio (Content-Length frames, for a local client):

```bash
npm run mcp:stdio
```

Nothing is written to stdout except frames.

## TrueForge

TrueForge attaches **remote HTTP** MCP servers. It does not launch this process. Register the URL under Settings → Connectors, or let `npm run setup` / `npm run run-evals` call `settings.mcpServers.createOrUpdate` for the name `fitforge`. The agent manifest lists that name with every tool preloaded and with no approval gate, so an unattended eval does not stop on a tool call. Dynamic subagents are off, so tool calls stay on the eval turn. Web search is off. In the SDK that switch is also the built-in fetch tool (`WebSearchConfig`: "web search and fetch tools"). The manifest does not add another fetch tool. The repo is public, so a fetch tool could read it.

```bash
# terminal 1
npm run mcp

# terminal 2 — private hosts are blocked unless you allow them
OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]' npx @truefoundry/trueforge@latest
```

Set `GYM_MCP_URL` if the server is not on `http://127.0.0.1:8787/mcp`.

### Not verified here

- Creating the connector against a live TrueForge process.
- A model turn that calls these tools through TrueForge.
- Whether this host's TrueForge build reaches `127.0.0.1` without `OUTBOUND_URL_ALLOWED_HOSTS`. The project docs say private addresses are blocked by default for endpoints the server fetches.
- Linux sandbox packages. `skill_mode` is `inline`, which does not need a sandbox. `git` mode needs `bubblewrap`, `socat`, and `ripgrep`, then a TrueForge restart. On this machine `ripgrep` was present and `bubblewrap` / `socat` were not. That path was not run.
- If the MCP process exits mid-session, TrueForge has crashed in its reconnect path before (keep the server up for a run).

Stdio was checked in `mcp/server.test.ts`. HTTP initialize, tool list, and a tool call were checked the same way. Neither check goes through TrueForge.
