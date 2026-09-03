# Seating Repair

**Repair constrained plans with AI—without overriding human decisions.**

Seating Repair is a WebMCP application for constrained allocation and minimal-disruption repair. It uses seating as a simple visual example of a much broader problem: assigning people or other entities to limited resources while respecting capacity, relationships, eligibility rules, existing commitments, and live human decisions.

The demo focuses on seating because the constraints are immediately visible. Guests can need to stay together or apart, require an accessible table, be fixed to a specific table, or be locked in place by a person. When something changes, the goal is not to generate a completely new plan from scratch, but to repair the current one while preserving as much of it as possible.

A person and a browser agent work on the same live board. The person can move and lock important guests directly in the UI. Through WebMCP, the agent reads that same state, adds hard constraints, repairs the remaining assignments, and validates the result.

Everything runs in the browser with no backend, account, embedded chatbot, external API, or hidden agent state. The page itself remains the source of truth.

## Why WebMCP

The useful context is the page a person is editing right now: assignments, locks,
constraints, conflicts, and a monotonic revision. WebMCP gives the agent narrow,
typed tools over that live state instead of making it infer intent from buttons or
operate on a disconnected integration.

The collaboration loop is visible and testable:

1. The agent reads revision `n` and repairs the current conflicts.
2. A person moves Grandma Rose and locks that decision in the UI.
3. The page advances to revision `n + 1`.
4. Any stale agent write is rejected with `STATE_CHANGED`.
5. After rereading, the agent repairs around the human lock and validates the board.

## WebMCP tools

Exactly four tools are registered imperatively on the top-level document:

| Tool | Effect | Contract |
| --- | --- | --- |
| `get_seating_state` | Read-only | Returns guests, tables, assignments, locks, constraints, violations, and the current revision. |
| `add_seating_constraints` | Writes state | Adds 1–12 validated `together`, `apart`, `fixed_table`, or `accessible_table` constraints. Requires `expectedRevision`. |
| `repair_seating_plan` | Writes state | Atomically applies a deterministic valid plan, preserving locks and minimizing moves by default. Requires `expectedRevision`. |
| `validate_seating_plan` | Read-only | Reports unseated guests, over-capacity tables, constraint violations, and overall validity. |

Every schema rejects additional properties, and every input is validated again at
runtime. Tool registration lifecycle is scoped with `AbortSignal`, and repair fails
without committing when invoked with an aborted signal.

## Safety and consistency

- **Optimistic concurrency:** both write tools require the exact current revision.
- **Human locks:** the WebMCP repair tool never accepts `respectLocks: false`; a
  person must unlock a guest in the page before an agent may move them.
- **Atomic solver:** an unsatisfiable or cancelled search leaves state unchanged.
- **Deterministic repair:** candidate ordering and move minimization make repeated
  runs against the same state produce the same result.
- **Fail-closed persistence:** malformed `localStorage` data is ignored and reset to
  the known demo fixture.
- **Browser-local state:** the board is stored under this site's origin in the
  current browser profile. It is not shared between visitors or synced to a
  ChatGPT account.
- **No network data path:** all application logic runs in the browser.

## Run locally

Requirements: Node.js 22.12 or newer.

```bash
git clone https://github.com/iniess/webmcp-seating-repair.git
cd webmcp-seating-repair
npm ci
npm run dev
```

Open the localhost URL printed by Vite. The manual board works in a normal browser;
the header reports whether the current browser exposes WebMCP.

To verify the exact release checks:

```bash
npm run check
```

This runs TypeScript type checking, 23 domain/store/WebMCP tests, and a production
Vite build. To inspect the production bundle locally:

```bash
npm run preview
```

## Demo in a WebMCP-capable browser

1. Open the app as a top-level page in the ChatGPT built-in browser or a compatible
   Chrome WebMCP environment. Do not place it in an iframe.
2. Confirm the header says **4 WebMCP tools connected**.
3. Use the first prompt:

   > Repair this seating plan while respecting every locked guest and all existing constraints. Validate it when finished.

4. In the page, select **Grandma Rose**, move her to **Family Table**, and press
   **Lock**. The human edit creates a new conflict and increments the revision.
5. Use the second prompt:

   > Keep Grandma Rose exactly where I placed her. Add a hard constraint that Maya and Liam must sit apart, repair everything else, and validate the result.

Expected result: the board returns to zero conflicts, Grandma Rose remains locked at
Family Table, Maya and Liam sit apart, and the activity log distinguishes human and
agent changes.

Use **Reset demo** before each recording. The fixture always returns to 12 guests,
three tables, one initial human lock, and exactly three repairable conflicts.

## Architecture

```text
src/
  data/demo.ts              Fixed fixture and copyable demo prompts
  domain/validation.ts      Deterministic capacity and constraint validator
  domain/solver.ts          Browser-only backtracking solver
  state/store.ts            Source of truth, persistence, locks, revision guard
  ui/render.ts              Accessible one-page human editing surface
  webmcp/registerTools.ts   Four imperative WebMCP tool registrations
  types.ts                  Shared domain contracts
tests/
  domain.test.mjs           Validator and solver behavior
  store.test.mjs            Mutation, persistence, and concurrency behavior
  webmcp.test.mjs           Registration and end-to-end tool execution
```

The production build is a static `dist/` directory and can be hosted on any HTTPS
static host.

## References

- [OpenAI WebMCP documentation](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP specification](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp)

## License

[MIT](LICENSE)
