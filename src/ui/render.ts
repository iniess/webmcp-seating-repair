import {
  DEMO_PROMPT_COLLABORATE,
  DEMO_PROMPT_REPAIR
} from "../data/demo.js";
import { SeatingStore } from "../state/store.js";
import type { GuestId, SeatingState } from "../types.js";
import type { WebMcpRegistrationStatus } from "../webmcp/registerTools.js";

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
  private copyFeedback = false;

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
    const violationConstraintIds = new Set(
      this.state.violations.flatMap((violation) =>
        violation.constraintId ? [violation.constraintId] : []
      )
    );
    const tableNameById = new Map(this.state.tables.map((table) => [table.id, table.name]));
    const lockedGuestIds = new Set(this.state.lockedGuestIds);

    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">OPENAI WEBMCP CHALLENGE</p>
            <h1>Seating Repair</h1>
            <p class="subtitle">People choose the exceptions. Agents repair everything around them.</p>
          </div>
          <div class="topbar-actions">
            <span class="status-pill ${this.webMcpStatus.registered ? "status-pill--ok" : ""}">
              <span class="status-dot"></span>
              ${escapeHtml(this.webMcpStatus.message)}
            </span>
            <button class="button button--secondary" data-action="copy-prompt">
              ${this.copyFeedback ? "Prompt copied" : "Copy test prompt"}
            </button>
            <button class="button" data-action="reset">Reset demo</button>
          </div>
        </header>

        <section class="summary-strip" aria-label="Board summary">
          <div class="summary-card">
            <span class="summary-label">Revision</span>
            <strong>${this.state.revision}</strong>
          </div>
          <div class="summary-card ${this.state.violations.length > 0 ? "summary-card--danger" : "summary-card--success"}">
            <span class="summary-label">Conflicts</span>
            <strong>${this.state.violations.length}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Locked guests</span>
            <strong>${this.state.lockedGuestIds.length}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Selected</span>
            <strong>${escapeHtml(this.guestName(this.selectedGuestId) ?? "None")}</strong>
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
            <p class="panel-help">Select a guest, then choose a table. Lock important choices before asking the agent to repair.</p>
            <div class="guest-list">
              ${this.state.guests
                .map((guest) => {
                  const tableName = tableNameById.get(this.state.assignments[guest.id] ?? "") ?? "Unseated";
                  const isSelected = this.selectedGuestId === guest.id;
                  const isLocked = lockedGuestIds.has(guest.id);
                  return `
                    <article class="guest-row ${isSelected ? "guest-row--selected" : ""}">
                      <button class="guest-main" data-action="select-guest" data-guest-id="${guest.id}" aria-pressed="${isSelected}">
                        <span class="avatar">${escapeHtml(guest.initials)}</span>
                        <span class="guest-copy">
                          <strong>${escapeHtml(guest.name)}</strong>
                          <small>${escapeHtml(tableName)}</small>
                        </span>
                      </button>
                      <button class="lock-button ${isLocked ? "lock-button--active" : ""}" data-action="toggle-lock" data-guest-id="${guest.id}" aria-label="${isLocked ? "Unlock" : "Lock"} ${escapeHtml(guest.name)}">
                        ${isLocked ? "Locked" : "Lock"}
                      </button>
                    </article>`;
                })
                .join("")}
            </div>
          </section>

          <section class="panel board-panel">
            <div class="panel-heading">
              <div>
                <p class="panel-kicker">SHARED LIVE STATE</p>
                <h2>Seating chart</h2>
              </div>
              <span>${this.state.violations.length === 0 ? "Valid" : "Needs repair"}</span>
            </div>
            <div class="table-grid">
              ${this.state.tables
                .map((table) => {
                  const occupants = this.state.guests.filter(
                    (guest) => this.state.assignments[guest.id] === table.id
                  );
                  const overCapacity = occupants.length > table.capacity;
                  return `
                    <button class="table-card ${overCapacity ? "table-card--danger" : ""}" data-action="move-selected" data-table-id="${table.id}" ${this.selectedGuestId ? "" : "disabled"}>
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
                              <span class="seat-chip ${lockedGuestIds.has(guest.id) ? "seat-chip--locked" : ""}">
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
                this.state.violations.length === 0
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
                  .slice(0, 8)
                  .map(
                    (entry) => `
                      <div class="activity-item">
                        <span class="actor actor--${entry.actor}">${escapeHtml(entry.actor)}</span>
                        <div>
                          <strong>${escapeHtml(entry.action)}</strong>
                          <p>${escapeHtml(entry.detail)}</p>
                          <small>Revision ${entry.revision}</small>
                        </div>
                      </div>`
                  )
                  .join("")}
              </div>
            </section>
          </aside>
        </main>

        <footer class="demo-footer">
          <div>
            <strong>Agent prompt 1</strong>
            <code>${escapeHtml(DEMO_PROMPT_REPAIR)}</code>
          </div>
          <div>
            <strong>Agent prompt 2</strong>
            <code>${escapeHtml(DEMO_PROMPT_COLLABORATE)}</code>
          </div>
        </footer>
      </div>`;
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>("[data-action]");
    if (!control) return;

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
      void this.copyPrompt();
    }
  }

  private async copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(DEMO_PROMPT_REPAIR);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = DEMO_PROMPT_REPAIR;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    this.copyFeedback = true;
    this.render();
    window.setTimeout(() => {
      this.copyFeedback = false;
      this.render();
    }, 1400);
  }

  private guestName(guestId: GuestId | null): string | null {
    if (!guestId) return null;
    return this.state.guests.find((guest) => guest.id === guestId)?.name ?? null;
  }
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
