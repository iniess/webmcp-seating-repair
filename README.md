# Seating Repair

A shared seating chart that humans and browser agents can repair together through WebMCP.

## Product idea

A person can move and lock important guests on a visual seating board. A browser agent can then read the same live state, add hard constraints, repair the remaining assignments, and validate the result without overriding the person's choices.

The core collaboration loop is:

1. The agent reads structured state through WebMCP.
2. The agent repairs the current constraint violations.
3. A person moves and locks an important guest in the UI.
4. The page revision changes.
5. The agent reads the new state and repairs around that human decision.

## Why WebMCP

The useful state is the page that the person is actively editing: current assignments, locks, constraints, conflicts, and revision. WebMCP lets the agent use explicit tools against that same live page instead of guessing through buttons or operating against a disconnected backend state.

This scaffold uses the imperative API at the top-level document:

```ts
document.modelContext.registerTool({
  name: "get_seating_state",
  description: "Read the current live seating board...",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  annotations: { readOnlyHint: true },
  execute: async () => ({ ok: true, state: store.getPublicSnapshot() })
});
```

## WebMCP tools

| Tool | Type | Purpose |
| --- | --- | --- |
| `get_seating_state` | Read | Returns the current board, locks, constraints, violations, and revision. |
| `add_seating_constraints` | Write | Adds validated hard constraints to the current board. |
| `repair_seating_plan` | Write | Applies a deterministic valid assignment while respecting human locks. |
| `validate_seating_plan` | Read | Rechecks capacity and every hard constraint. |

Write tools require `expectedRevision`. A stale call returns `STATE_CHANGED` rather than overwriting a newer human edit.

## Current scope

- One page
- Twelve fictional guests
- Three tables
- Together, apart, fixed-table, and accessible-table constraints
- Human move and lock controls
- Deterministic browser-only solver
- Local persistence and deterministic reset
- Four imperative WebMCP tools
- No backend or external API

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev
```

Verification:

```bash
npm run check
```

## Demo flow

Start with the fixture showing three conflicts.

Prompt 1:

> Repair this seating plan while respecting every locked guest and all existing constraints. Validate it when finished.

Then move Grandma Rose to the Family Table in the UI and lock her.

Prompt 2:

> Keep Grandma Rose exactly where I placed her. Add a hard constraint that Maya and Liam must sit apart, repair everything else, and validate the result.

The expected outcome is zero conflicts while Grandma Rose stays at the Family Table.

## Project structure

```text
src/
  data/demo.ts
  domain/solver.ts
  domain/validation.ts
  state/store.ts
  ui/render.ts
  webmcp/registerTools.ts
  types.ts
```

See `AGENTS.md` for the constrained implementation brief for Codex.

## References

- WebMCP specification: https://webmachinelearning.github.io/webmcp/
- Chrome WebMCP documentation: https://developer.chrome.com/docs/ai/agents
- OpenAI WebMCP Challenge: https://openai.com/webmcp-challenge/

## License

MIT
