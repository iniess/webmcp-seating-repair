import { createDemoState } from "../data/demo.js";
import { solveSeatingPlan } from "../domain/solver.js";
import { validateSeatingPlan } from "../domain/validation.js";
import type {
  ActivityActor,
  Constraint,
  ConstraintDraft,
  GuestId,
  PublicSeatingState,
  RepairOptions,
  SeatingState,
  TableId,
  Violation
} from "../types.js";

const STORAGE_KEY = "webmcp-seating-repair:state:v1";

type Listener = (state: SeatingState) => void;

export class StateChangedError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("The seating board changed after the agent last read it.");
    this.name = "StateChangedError";
    this.currentRevision = currentRevision;
  }
}

export class SeatingStore {
  private state: SeatingState;
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.state = this.loadState() ?? createDemoState();
    this.state.violations = validateSeatingPlan(this.state);
    this.persist();
  }

  getSnapshot(): SeatingState {
    return clone(this.state);
  }

  getPublicSnapshot(): PublicSeatingState {
    const state = this.getSnapshot();
    return {
      revision: state.revision,
      guests: state.guests,
      tables: state.tables,
      assignments: state.assignments,
      constraints: state.constraints,
      lockedGuestIds: state.lockedGuestIds,
      violations: state.violations
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.state = createDemoState();
    this.state.violations = validateSeatingPlan(this.state);
    this.persist();
    this.emit();
  }

  moveGuest(guestId: GuestId, tableId: TableId): void {
    this.requireGuest(guestId);
    this.requireTable(tableId);
    if (this.state.assignments[guestId] === tableId) return;

    const guest = this.state.guests.find((item) => item.id === guestId);
    const table = this.state.tables.find((item) => item.id === tableId);
    const next = this.getSnapshot();
    next.assignments[guestId] = tableId;
    this.commit(
      next,
      "human",
      "Guest moved",
      `${guest?.name ?? guestId} moved to ${table?.name ?? tableId}`
    );
  }

  toggleGuestLock(guestId: GuestId): void {
    this.requireGuest(guestId);
    const next = this.getSnapshot();
    const locked = new Set(next.lockedGuestIds);
    const guest = next.guests.find((item) => item.id === guestId);

    if (locked.has(guestId)) {
      locked.delete(guestId);
      next.lockedGuestIds = [...locked];
      this.commit(next, "human", "Guest unlocked", `${guest?.name ?? guestId} can be moved by the agent`);
      return;
    }

    locked.add(guestId);
    next.lockedGuestIds = [...locked];
    this.commit(next, "human", "Guest locked", `${guest?.name ?? guestId} must remain at the current table`);
  }

  addConstraints(
    expectedRevision: number,
    drafts: ConstraintDraft[]
  ): { added: Constraint[]; revision: number; violations: Violation[] } {
    this.assertExpectedRevision(expectedRevision);
    const next = this.getSnapshot();
    const existingSignatures = new Set(next.constraints.map(constraintSignature));
    const added: Constraint[] = [];

    for (const draft of drafts) {
      this.validateConstraintDraft(draft);
      const signature = constraintSignature(draft);
      if (existingSignatures.has(signature)) continue;

      const constraint = this.materializeConstraint(draft, next.revision, added.length);
      added.push(constraint);
      next.constraints.push(constraint);
      existingSignatures.add(signature);
    }

    if (added.length === 0) {
      return {
        added: [],
        revision: this.state.revision,
        violations: clone(this.state.violations)
      };
    }

    this.commit(
      next,
      "agent",
      "Constraints added",
      `${added.length} hard constraint${added.length === 1 ? "" : "s"} added`
    );

    return {
      added,
      revision: this.state.revision,
      violations: clone(this.state.violations)
    };
  }

  repair(
    expectedRevision: number,
    options: Partial<RepairOptions> = {}
  ):
    | {
        applied: true;
        revision: number;
        movedGuestIds: GuestId[];
        conflictsBefore: number;
        conflictsAfter: number;
        exploredNodes: number;
      }
    | {
        applied: false;
        revision: number;
        reason: "UNSATISFIABLE" | "ABORTED";
        conflictsBefore: number;
        exploredNodes: number;
      } {
    this.assertExpectedRevision(expectedRevision);
    const before = this.getSnapshot();
    const result = solveSeatingPlan(before, options);

    if (!result.assignments) {
      return {
        applied: false,
        revision: this.state.revision,
        reason: result.reason ?? "UNSATISFIABLE",
        conflictsBefore: before.violations.length,
        exploredNodes: result.exploredNodes
      };
    }

    const movedGuestIds = before.guests
      .map((guest) => guest.id)
      .filter((guestId) => before.assignments[guestId] !== result.assignments?.[guestId]);
    const next = this.getSnapshot();
    next.assignments = result.assignments;
    this.commit(
      next,
      "agent",
      "Seating repaired",
      `${movedGuestIds.length} guest${movedGuestIds.length === 1 ? "" : "s"} moved; all hard constraints rechecked`
    );

    return {
      applied: true,
      revision: this.state.revision,
      movedGuestIds,
      conflictsBefore: before.violations.length,
      conflictsAfter: this.state.violations.length,
      exploredNodes: result.exploredNodes
    };
  }

  validate(): { valid: boolean; revision: number; violations: Violation[] } {
    const violations = validateSeatingPlan(this.state);
    return {
      valid: violations.length === 0,
      revision: this.state.revision,
      violations: clone(violations)
    };
  }

  private assertExpectedRevision(expectedRevision: number): void {
    if (expectedRevision !== this.state.revision) {
      throw new StateChangedError(this.state.revision);
    }
  }

  private commit(
    next: SeatingState,
    actor: ActivityActor,
    action: string,
    detail: string
  ): void {
    next.revision = this.state.revision + 1;
    next.violations = validateSeatingPlan(next);
    next.activityLog = [
      ...next.activityLog,
      {
        id: `activity-${next.revision}-${Date.now()}`,
        actor,
        action,
        detail,
        at: new Date().toISOString(),
        revision: next.revision
      }
    ].slice(-40);
    this.state = next;
    this.persist();
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private persist(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private loadState(): SeatingState | null {
    if (typeof localStorage === "undefined") return null;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SeatingState>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.guests) || !Array.isArray(parsed.tables)) {
        return null;
      }
      return parsed as SeatingState;
    } catch {
      return null;
    }
  }

  private requireGuest(guestId: GuestId): void {
    if (!this.state.guests.some((guest) => guest.id === guestId)) {
      throw new Error(`Unknown guest: ${guestId}`);
    }
  }

  private requireTable(tableId: TableId): void {
    if (!this.state.tables.some((table) => table.id === tableId)) {
      throw new Error(`Unknown table: ${tableId}`);
    }
  }

  private validateConstraintDraft(draft: ConstraintDraft): void {
    if (draft.type === "together" || draft.type === "apart") {
      const [firstGuestId, secondGuestId] = draft.guestIds;
      this.requireGuest(firstGuestId);
      this.requireGuest(secondGuestId);
      if (firstGuestId === secondGuestId) {
        throw new Error("A relationship constraint requires two different guests.");
      }
      return;
    }

    this.requireGuest(draft.guestId);
    if (draft.type === "fixed_table") this.requireTable(draft.tableId);
  }

  private materializeConstraint(
    draft: ConstraintDraft,
    revision: number,
    index: number
  ): Constraint {
    const id = `agent-${revision + 1}-${index + 1}-${draft.type}`;
    const guestName = (guestId: GuestId) =>
      this.state.guests.find((guest) => guest.id === guestId)?.name ?? guestId;

    if (draft.type === "together" || draft.type === "apart") {
      const [firstGuestId, secondGuestId] = draft.guestIds;
      const relation = draft.type === "together" ? "together" : "apart";
      return {
        ...draft,
        id,
        label: `${guestName(firstGuestId)} and ${guestName(secondGuestId)} must sit ${relation}`
      };
    }

    if (draft.type === "fixed_table") {
      const tableName =
        this.state.tables.find((table) => table.id === draft.tableId)?.name ?? draft.tableId;
      return {
        ...draft,
        id,
        label: `${guestName(draft.guestId)} must sit at ${tableName}`
      };
    }

    return {
      ...draft,
      id,
      label: `${guestName(draft.guestId)} needs an accessible table`
    };
  }
}

function constraintSignature(constraint: Constraint | ConstraintDraft): string {
  if (constraint.type === "together" || constraint.type === "apart") {
    return `${constraint.type}:${[...constraint.guestIds].sort().join(":")}`;
  }
  if (constraint.type === "fixed_table") {
    return `${constraint.type}:${constraint.guestId}:${constraint.tableId}`;
  }
  return `${constraint.type}:${constraint.guestId}`;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}
