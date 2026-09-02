# Submission kit

## Title

Seating Repair

## Tagline

A shared seating chart that agents can repair without overriding human choices.

## Short description

Seating Repair lets a person and a browser agent solve one live constraint puzzle
together. The person makes social exceptions by moving and locking important guests.
Through four WebMCP tools, the agent reads the current board, adds hard constraints,
repairs everything around those locks, and validates the result. Revision guards
reject stale writes, so an agent cannot overwrite a human edit made between calls.

## Inspiration

Seating plans are not just optimization problems. A planner often knows one exception
that should never be negotiated: Grandma needs an accessible table, two relatives
must remain apart, or a host has already chosen a seat. A chat-only solution quickly
loses sync after the planner edits the arrangement. We wanted the page itself to stay
the shared, visible source of truth.

## What it does

The demo starts with 12 fictional guests, three tables, five hard constraints, one
locked guest, and exactly three conflicts. An agent repairs the plan, after which a
person moves and locks Grandma Rose. That human edit changes the live revision and
creates a new conflict. The agent then adds a new apart constraint, rereads the board,
and repairs the rest without moving Grandma.

The UI shows conflicts, unseated guests, locks, revision, constraint status, and a
human/agent audit trail in real time.

## How it is built

- Vite and vanilla TypeScript
- A deterministic backtracking solver running entirely in the browser
- A validator for capacity, together, apart, fixed-table, and accessible-table rules
- A local state store with `localStorage`, monotonic revisions, and atomic mutations
- Four imperative WebMCP tools registered on `document.modelContext`
- Strict JSON Schemas plus runtime validation and abort support
- No backend, database, authentication, OpenAI API call, or external service

## Why WebMCP matters

This is not a remote CRM-style integration. The agent needs the exact board the human
is looking at, including a seat moved seconds ago, a new lock, and the current
revision. WebMCP keeps human and agent on the same page and in the same session.

The revision guard makes that shared-state advantage concrete: if a human edits the
board after the agent reads it, the next write fails with `STATE_CHANGED` and tells
the agent to read again. The human remains in control while the agent handles the
constraint search.

## Challenges

The main challenge was making collaboration reliable rather than merely visual. The
solver has to minimize moves, preserve locks, stop on cancellation, reject invalid
constraints, and commit only a complete valid result. The tool layer also validates
inputs independently of JSON Schema and treats stale state as a recoverable error.

## Accomplishments

- The initial three-conflict fixture repairs with the minimum three moves.
- The full agent → human → agent flow finishes with zero conflicts.
- Human locks survive every default repair.
- Unsatisfiable, cancelled, malformed, duplicate, and stale operations are covered by
  automated tests and do not corrupt state.
- The complete product ships as a small static bundle.

## Two-minute video script

### 0:00–0:12 — Show the result immediately

Show ChatGPT and the red board together. Paste prompt 1. Let the agent call
`get_seating_state`, `repair_seating_plan`, and `validate_seating_plan`. The board
animates from three conflicts to zero.

Voice-over:

> This is Seating Repair. The agent just read structured state from the live page,
> repaired three conflicts, and verified every hard rule.

### 0:12–0:34 — Explain the shared state

Point to the revision, green constraints, and activity log.

Voice-over:

> The website is the source of truth. It owns the assignments, locks, constraints,
> deterministic solver, and validation. There is no backend and no embedded chatbot.

### 0:34–0:55 — Human intervention

Select Grandma Rose, move her to Family Table, then lock her. Show the conflict count
and revision change.

Voice-over:

> Seating is social, so the person makes the exception. I moved Grandma and locked
> that decision. The board changed after the agent's last read.

### 0:55–1:25 — Agent adapts

Paste prompt 2. Show the agent reread state, add the Maya/Liam apart constraint,
repair, and validate. Keep the board visible as cards move.

Voice-over:

> Now the agent works around my choice. It adds a hard constraint, repairs the rest,
> and leaves Grandma exactly where I put her.

### 1:25–1:46 — Concurrency guard

Briefly show `expectedRevision` and the `STATE_CHANGED` response in source or a small
prepared terminal snippet.

Voice-over:

> Every write requires the revision returned by the latest read. A stale write is
> rejected instead of overwriting a human edit.

### 1:46–2:00 — Close on the product

Return to the zero-conflict board and activity log.

Voice-over:

> People choose the exceptions. Agents repair the constraint puzzle. Both work on
> the same live page through WebMCP.

## Recording checklist

- Use a 16:9 frame and zoom so the complete workspace remains legible.
- Start on the working product; omit logos, setup, login, and architecture intros.
- Keep ChatGPT tool-call cards and the board visible at the same time.
- Reset the demo immediately before recording.
- Record narration or voice-over and use no copyrighted music.
- Keep the final public video under three minutes.
