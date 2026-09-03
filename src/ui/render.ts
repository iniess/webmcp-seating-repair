import {
  DEMO_PROMPT_COLLABORATE,
  DEMO_PROMPT_REPAIR
} from "../data/demo.js";
import { SeatingStore } from "../state/store.js";
import type { GuestId, SeatingState } from "../types.js";
import type { WebMcpRegistrationStatus } from "../webmcp/registerTools.js";

type DemoPromptKey = "repair" | "collaborate";

export class AppView {
  private selectedGuestId: GuestId | null = null;
  private state: SeatingState;
  private webMcpStatus: Pick<
    WebMcpRegistrationStatus,
    "supported" | "registered" | "message"
  > = {
    supported: false,
    registered: false,
    message: "Checking WebMCP support"
  };
  private copiedPrompt: DemoPromptKey | null = null;
  private copyTimer: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: SeatingStore
  ) {
    this.state = store.getSnapshot();
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.store.subscribe((state) => {
      this.state = state;
      this.render();
    });
  }

  setWebMcpStatus(status: WebMcpRegistrationStatus): void {
    this.webMcpStatus = status;
    this.render();
  }

  private render(): void {
    const previousSeatPositions = this.captureSeatPositions();
    const violationConstraintIds = new Set(
      this.state.violations.flatMap((violation) =>
        violation.constraintId ? [violation.constraintId] : []
      )
    );
    const tableNameById = new Map(
      this.state.tables.map((table) => [table.id, table.name])
    );
    const lockedGuestIds = new Set(this.state.lockedGuestIds);
    const unseatedCount = this.state.guests.filter(
      (guest) => this.state.assignments[guest.id] === null
    ).length;
    const selectedGuestName = this.guestName(this.selectedGuestId);
    const conflictCount = this.state.violations.length;
    const boardStatus = conflictCount === 0 ? "Valid" : "Needs repair";
    const connectionClass = this.webMcpStatus.registered
      ? "status-pill--ok"
      : this.webMcpStatus.supported
        ? "status-pill--error"
        : "";

    document.title = `Seating Repair · ${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`;
    this.root.innerHTML = `
      <div class="app-shell">
        <div class="sr-only" role="status" aria-live="polite">
          Revision ${this.state.revision}. ${conflictCount} conflict${conflictCount === 1 ? "" : "s"}. ${unseatedCount} unseated.
        </div>

        <header class="topbar">
          <div>
            <p class="eyebrow">HUMAN + AGENT WORKSPACE</p>
            <h1>Seating Repair</h1>
            <p class="subtitle">People choose the exceptions. Agents repair everything around them.</p>
          </div>
          <div class="topbar-actions">
            <span class="status-pill status-pill--local" title="This board is stored only in this browser profile.">
              <span class="status-dot" aria-hidden="true"></span>
              Saved in this browser
            </span>
            <span class="status-pill ${connectionClass}" title="${escapeHtml(this.webMcpStatus.message)}">
              <span class="status-dot" aria-hidden="true"></span>
              ${escapeHtml(this.webMcpStatus.message)}
            </span>
            <button class="button button--secondary" type="button" data-action="copy-prompt" data-prompt-key="repair">
              ${this.copiedPrompt === "repair" ? "Prompt copied" : "Copy repair prompt"}
            </button>
            <button class="button" type="button" data-action="reset">Reset demo</button>
          </div>
        </header>

        <section class="summary-strip" aria-label="Board summary">
          <div class="summary-card ${conflictCount > 0 ? "summary-card--danger" : "summary-card--success"}">
            <span class="summary-label">Conflicts</span>
            <strong>${conflictCount}</strong>
          </div>
          <div class="summary-card ${unseatedCount > 0 ? "summary-card--danger" : "summary-card--success"}">
            <span class="summary-label">Unseated</span>
            <strong>${unseatedCount}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Locked</span>
            <strong>${this.state.lockedGuestIds.length}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Revision</span>
            <strong>${this.state.revision}</strong>
          </div>
        </section>

        <main class="workspace">
          <section class="panel guest-panel">
            <div class="panel-heading">
              <div>
                <p class="panel-kicker">HUMAN CONTROL</p>
                <h2>Guests</h2>
              </div>
              <span>${this.state.guests.length}</span>
            </div>
            <p class="panel-help">Select a guest, choose a table, then lock any decision the agent must preserve.</p>
            <div class="guest-list">
              ${this.state.guests
                .map((guest) => {
                  const tableName =
                    tableNameById.get(this.state.assignments[guest.id] ?? "") ??
                    "Unseated";
                  const isSelected = this.selectedGuestId === guest.id;
                  const isLocked = lockedGuestIds.has(guest.id);
                  return `
                    <article class="guest-row ${isSelected ? "guest-row--selected" : ""}">
                      <button class="guest-main" type="button" data-action="select-guest" data-guest-id="${escapeHtml(guest.id)}" aria-pressed="${isSelected}">
                        <span class="avatar" aria-hidden="true">${escapeHtml(guest.initials)}</span>
                        <span class="guest-copy">
                          <strong>${escapeHtml(guest.name)}</strong>
                          <small>${escapeHtml(tableName)}</small>
                        </span>
                      </button>
                      <button class="lock-button ${isLocked ? "lock-button--active" : ""}" type="button" data-action="toggle-lock" data-guest-id="${escapeHtml(guest.id)}" aria-pressed="${isLocked}" aria-label="${isLocked ? "Unlock" : "Lock"} ${escapeHtml(guest.name)}">
                        ${isLocked ? "Locked" : "Lock"}
                      </button>
                    </article>`;
                })
                .join("")}
            </div>
          </section>

          <section class="panel board-panel">
            <div class="panel-heading board-heading">
              <div>
                <p class="panel-kicker">SHARED LIVE STATE</p>
                <h2>Seating chart</h2>
              </div>
              <span class="board-state board-state--${conflictCount === 0 ? "valid" : "repair"}">${boardStatus}</span>
            </div>
            <div class="selection-banner ${selectedGuestName ? "selection-banner--active" : ""}">
              ${
                selectedGuestName
                  ? `Moving <strong>${escapeHtml(selectedGuestName)}</strong> — choose a destination table.`
                  : "Select a guest to make a human edit."
              }
            </div>
            <div class="table-grid">
              ${this.state.tables
                .map((table) => {
                  const occupants = this.state.guests.filter(
                    (guest) => this.state.assignments[guest.id] === table.id
                  );
                  const overCapacity = occupants.length > table.capacity;
                  const canMove = this.selectedGuestId !== null;
                  return `
                    <button class="table-card ${overCapacity ? "table-card--danger" : ""} ${canMove ? "" : "table-card--inactive"}" type="button" data-action="move-selected" data-table-id="${escapeHtml(table.id)}" aria-disabled="${!canMove}" aria-label="${canMove ? `Move ${escapeHtml(selectedGuestName ?? "selected guest")} to ` : "View "}${escapeHtml(table.name)}">
                      <div class="table-card__heading">
                        <div>
                          <strong>${escapeHtml(table.name)}</strong>
                          <small>${table.accessible ? "Accessible" : "Standard access"}</small>
                        </div>
                        <span>${occupants.length} / ${table.capacity}</span>
                      </div>
                      <div class="seat-ring">
                        ${occupants
                          .map(
                            (guest) => `
                              <span class="seat-chip ${lockedGuestIds.has(guest.id) ? "seat-chip--locked" : ""}" data-seat-guest-id="${escapeHtml(guest.id)}">
                                ${escapeHtml(guest.name)}
                              </span>`
                          )
                          .join("")}
                        ${occupants.length === 0 ? '<span class="empty-state">No guests</span>' : ""}
                      </div>
                    </button>`;
                })
                .join("")}
            </div>
            <div class="conflict-list">
              ${
                conflictCount === 0
                  ? '<div class="all-clear">All guests are seated and every hard constraint is satisfied.</div>'
                  : this.state.violations
                      .map(
                        (violation) => `
                          <div class="conflict-item">
                            <span>Conflict</span>
                            <p>${escapeHtml(violation.message)}</p>
                          </div>`
                      )
                      .join("")
              }
            </div>
          </section>

          <aside class="right-column">
            <section class="panel constraints-panel">
              <div class="panel-heading">
                <div>
                  <p class="panel-kicker">RULES</p>
                  <h2>Hard constraints</h2>
                </div>
                <span>${this.state.constraints.length}</span>
              </div>
              <div class="constraint-list">
                ${this.state.constraints
                  .map((constraint) => {
                    const violated = violationConstraintIds.has(constraint.id);
                    return `
                      <div class="constraint-item ${violated ? "constraint-item--danger" : "constraint-item--ok"}">
                        <span>${violated ? "Failed" : "Passed"}</span>
                        <p>${escapeHtml(constraint.label)}</p>
                      </div>`;
                  })
                  .join("")}
              </div>
            </section>

            <section class="panel activity-panel">
              <div class="panel-heading">
                <div>
                  <p class="panel-kicker">AUDIT TRAIL</p>
                  <h2>Activity</h2>
                </div>
              </div>
              <div class="activity-list">
                ${[...this.state.activityLog]
                  .reverse()
                  .slice(0, 5)
                  .map(
                    (entry) => `
                      <div class="activity-item">
                        <span class="actor actor--${entry.actor}">${escapeHtml(entry.actor)}</span>
                        <div>
                          <strong>${escapeHtml(entry.action)}</strong>
                          <p>${escapeHtml(entry.detail)}</p>
                          <small>${escapeHtml(formatActivityTime(entry.at))} · Revision ${entry.revision}</small>
                        </div>
                      </div>`
                  )
                  .join("")}
              </div>
            </section>
          </aside>
        </main>

        <footer class="demo-footer" aria-label="Demo prompts">
          ${this.renderPromptCard("repair", "Prompt 1 · Agent repair", DEMO_PROMPT_REPAIR)}
          ${this.renderPromptCard(
            "collaborate",
            "Prompt 2 · Human override",
            DEMO_PROMPT_COLLABORATE
          )}
        </footer>
      </div>`;

    this.animateSeatMoves(previousSeatPositions);
  }

  private renderPromptCard(
    key: DemoPromptKey,
    title: string,
    prompt: string
  ): string {
    return `
      <article class="prompt-card">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <code>${escapeHtml(prompt)}</code>
        </div>
        <button class="prompt-copy" type="button" data-action="copy-prompt" data-prompt-key="${key}">
          ${this.copiedPrompt === key ? "Copied" : "Copy"}
        </button>
      </article>`;
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>("[data-action]");
    if (!control || control.getAttribute("aria-disabled") === "true") return;

    const action = control.dataset.action;
    const guestId = control.dataset.guestId;

    if (action === "select-guest" && guestId) {
      this.selectedGuestId = this.selectedGuestId === guestId ? null : guestId;
      this.render();
      return;
    }

    if (action === "toggle-lock" && guestId) {
      this.store.toggleGuestLock(guestId);
      return;
    }

    if (action === "move-selected") {
      const tableId = control.dataset.tableId;
      if (this.selectedGuestId && tableId) {
        this.store.moveGuest(this.selectedGuestId, tableId);
      }
      return;
    }

    if (action === "reset") {
      this.selectedGuestId = null;
      this.store.reset();
      return;
    }

    if (action === "copy-prompt") {
      const key = control.dataset.promptKey === "collaborate" ? "collaborate" : "repair";
      void this.copyPrompt(key);
    }
  }

  private async copyPrompt(key: DemoPromptKey): Promise<void> {
    const prompt = key === "collaborate" ? DEMO_PROMPT_COLLABORATE : DEMO_PROMPT_REPAIR;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    if (this.copyTimer !== null) window.clearTimeout(this.copyTimer);
    this.copiedPrompt = key;
    this.render();
    this.copyTimer = window.setTimeout(() => {
      this.copiedPrompt = null;
      this.copyTimer = null;
      this.render();
    }, 1400);
  }

  private captureSeatPositions(): Map<GuestId, DOMRect> {
    return new Map(
      [...this.root.querySelectorAll<HTMLElement>("[data-seat-guest-id]")].flatMap(
        (element) => {
          const guestId = element.dataset.seatGuestId;
          return guestId ? [[guestId, element.getBoundingClientRect()]] : [];
        }
      )
    );
  }

  private animateSeatMoves(previousPositions: Map<GuestId, DOMRect>): void {
    if (
      previousPositions.size === 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    for (const element of this.root.querySelectorAll<HTMLElement>(
      "[data-seat-guest-id]"
    )) {
      const guestId = element.dataset.seatGuestId;
      const previous = guestId ? previousPositions.get(guestId) : undefined;
      if (!previous) continue;

      const current = element.getBoundingClientRect();
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;

      element.animate(
        [
          {
            translate: `${deltaX}px ${deltaY}px`,
            boxShadow: "0 10px 24px rgba(42, 72, 56, 0.22)"
          },
          { translate: "0 0", boxShadow: "0 0 0 rgba(0, 0, 0, 0)" }
        ],
        { duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    }
  }

  private guestName(guestId: GuestId | null): string | null {
    if (!guestId) return null;
    return this.state.guests.find((guest) => guest.id === guestId)?.name ?? null;
  }
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[character] ?? character
  );
}
