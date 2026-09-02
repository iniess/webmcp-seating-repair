import { createDemoState } from "../data/demo.js";
import { solveSeatingPlan } from "../domain/solver.js";
import {
  summarizeValidation,
  validateSeatingPlan
} from "../domain/validation.js";
import type {
  ActivityEntry,
  ActivityActor,
  AssignmentMap,
  Constraint,
  ConstraintDraft,
  Guest,
  GuestId,
  PublicSeatingState,
  RepairOptions,
  SeatingTable,
  SeatingState,
  TableId,
  ValidationSummary,
  Violation
} from "../types.js";

const STORAGE_KEY = "webmcp-seating-repair:state:v1";
const MAX_CONSTRAINTS = 64;
const MAX_ACTIVITY_ENTRIES = 40;
const MAX_GUESTS = 80;
const MAX_TABLES = 20;

export interface StateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

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

  constructor(private readonly storage: StateStorage | null = getBrowserStorage()) {
    this.state = this.loadState() ?? createDemoState();
    this.state.violations = validateSeatingPlan(this.state);
    this.state.activityLog = this.state.activityLog.slice(-MAX_ACTIVITY_ENTRIES);
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
      next.lockedGuestIds = next.guests
        .map((item) => item.id)
        .filter((id) => locked.has(id));
      this.commit(next, "human", "Guest unlocked", `${guest?.name ?? guestId} can be moved by the agent`);
      return;
    }

    locked.add(guestId);
    next.lockedGuestIds = next.guests
      .map((item) => item.id)
      .filter((id) => locked.has(id));
    this.commit(next, "human", "Guest locked", `${guest?.name ?? guestId} must remain at the current table`);
  }

  addConstraints(
    expectedRevision: number,
    drafts: ConstraintDraft[]
  ): {
    added: Constraint[];
    movedGuestIds: GuestId[];
    revision: number;
    conflictsBefore: number;
    conflictsAfter: number;
    violations: Violation[];
  } {
    this.assertExpectedRevision(expectedRevision);
    if (drafts.length === 0 || drafts.length > 12) {
      throw new Error("Add between 1 and 12 constraints at a time.");
    }

    const next = this.getSnapshot();
    const conflictsBefore = next.violations.length;
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

    if (next.constraints.length > MAX_CONSTRAINTS) {
      throw new Error(`The board supports at most ${MAX_CONSTRAINTS} constraints.`);
    }

    if (added.length === 0) {
      return {
        added: [],
        movedGuestIds: [],
        revision: this.state.revision,
        conflictsBefore,
        conflictsAfter: conflictsBefore,
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
      added: clone(added),
      movedGuestIds: [],
      revision: this.state.revision,
      conflictsBefore,
      conflictsAfter: this.state.violations.length,
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
      movedGuestIds: GuestId[];
      conflictsBefore: number;
      conflictsAfter: number;
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
        movedGuestIds: [],
        conflictsBefore: before.violations.length,
        conflictsAfter: before.violations.length,
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

  validate(): ValidationSummary & { revision: number } {
    const violations = validateSeatingPlan(this.state);
    return {
      revision: this.state.revision,
      ...summarizeValidation(clone(violations))
    };
  }

  private assertExpectedRevision(expectedRevision: number): void {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("expectedRevision must be a non-negative safe integer.");
    }
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
    ].slice(-MAX_ACTIVITY_ENTRIES);
    this.state = next;
    this.persist();
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Persistence is a progressive enhancement; the live session remains usable.
    }
  }

  private loadState(): SeatingState | null {
    if (!this.storage) return null;

    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return parseStoredState(JSON.parse(raw) as unknown);
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

function getBrowserStorage(): StateStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function parseStoredState(value: unknown): SeatingState | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (!isNonNegativeSafeInteger(value.revision)) return null;
  if (
    !Array.isArray(value.guests) ||
    value.guests.length === 0 ||
    value.guests.length > MAX_GUESTS ||
    !value.guests.every(isGuest)
  ) {
    return null;
  }
  if (
    !Array.isArray(value.tables) ||
    value.tables.length === 0 ||
    value.tables.length > MAX_TABLES ||
    !value.tables.every(isTable)
  ) {
    return null;
  }

  const guests = value.guests as Guest[];
  const tables = value.tables as SeatingTable[];
  const guestIds = new Set(guests.map((guest) => guest.id));
  const tableIds = new Set(tables.map((table) => table.id));
  if (guestIds.size !== guests.length || tableIds.size !== tables.length) return null;

  const assignments = value.assignments;
  if (!isRecord(assignments)) return null;
  const assignmentEntries = Object.entries(assignments);
  if (
    assignmentEntries.length !== guests.length ||
    assignmentEntries.some(
      ([guestId, tableId]) =>
        !guestIds.has(guestId) ||
        (tableId !== null &&
          (typeof tableId !== "string" || !tableIds.has(tableId)))
    ) ||
    guests.some((guest) => !(guest.id in assignments))
  ) {
    return null;
  }

  if (
    !Array.isArray(value.constraints) ||
    value.constraints.length > MAX_CONSTRAINTS ||
    !value.constraints.every((constraint) =>
      isConstraint(constraint, guestIds, tableIds)
    )
  ) {
    return null;
  }
  const constraints = value.constraints as Constraint[];
  if (new Set(constraints.map((constraint) => constraint.id)).size !== constraints.length) {
    return null;
  }

  if (
    !Array.isArray(value.lockedGuestIds) ||
    !value.lockedGuestIds.every(
      (guestId) => typeof guestId === "string" && guestIds.has(guestId)
    ) ||
    new Set(value.lockedGuestIds).size !== value.lockedGuestIds.length
  ) {
    return null;
  }

  if (
    !Array.isArray(value.activityLog) ||
    !value.activityLog.every((entry) => isActivityEntry(entry, value.revision as number))
  ) {
    return null;
  }

  return clone({
    schemaVersion: 1,
    revision: value.revision,
    guests,
    tables,
    assignments: assignments as AssignmentMap,
    constraints,
    lockedGuestIds: value.lockedGuestIds as GuestId[],
    violations: [],
    activityLog: (value.activityLog as ActivityEntry[]).slice(-MAX_ACTIVITY_ENTRIES)
  });
}

function isGuest(value: unknown): value is Guest {
  return (
    isRecord(value) &&
    isStableId(value.id) &&
    isBoundedString(value.name, 80) &&
    isBoundedString(value.initials, 4)
  );
}

function isTable(value: unknown): value is SeatingTable {
  return (
    isRecord(value) &&
    isStableId(value.id) &&
    isBoundedString(value.name, 80) &&
    isNonNegativeSafeInteger(value.capacity) &&
    typeof value.accessible === "boolean"
  );
}

function isConstraint(
  value: unknown,
  guestIds: Set<GuestId>,
  tableIds: Set<TableId>
): value is Constraint {
  if (
    !isRecord(value) ||
    !isStableId(value.id) ||
    !isBoundedString(value.label, 180)
  ) {
    return false;
  }

  if (value.type === "together" || value.type === "apart") {
    return (
      Array.isArray(value.guestIds) &&
      value.guestIds.length === 2 &&
      value.guestIds.every(
        (guestId) => typeof guestId === "string" && guestIds.has(guestId)
      ) &&
      value.guestIds[0] !== value.guestIds[1]
    );
  }

  if (value.type === "fixed_table") {
    return (
      typeof value.guestId === "string" &&
      guestIds.has(value.guestId) &&
      typeof value.tableId === "string" &&
      tableIds.has(value.tableId)
    );
  }

  return (
    value.type === "accessible_table" &&
    typeof value.guestId === "string" &&
    guestIds.has(value.guestId)
  );
}

function isActivityEntry(value: unknown, currentRevision: number): value is ActivityEntry {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 120) &&
    (value.actor === "human" || value.actor === "agent" || value.actor === "system") &&
    isBoundedString(value.action, 100) &&
    isBoundedString(value.detail, 300) &&
    isBoundedString(value.at, 60) &&
    isNonNegativeSafeInteger(value.revision) &&
    value.revision <= currentRevision
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)
  );
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
