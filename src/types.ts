export type GuestId = string;
export type TableId = string;
export type ConstraintId = string;

export interface Guest {
  id: GuestId;
  name: string;
  initials: string;
}

export interface SeatingTable {
  id: TableId;
  name: string;
  capacity: number;
  accessible: boolean;
}

interface ConstraintBase {
  id: ConstraintId;
  label: string;
}

export interface TogetherConstraint extends ConstraintBase {
  type: "together";
  guestIds: [GuestId, GuestId];
}

export interface ApartConstraint extends ConstraintBase {
  type: "apart";
  guestIds: [GuestId, GuestId];
}

export interface FixedTableConstraint extends ConstraintBase {
  type: "fixed_table";
  guestId: GuestId;
  tableId: TableId;
}

export interface AccessibleTableConstraint extends ConstraintBase {
  type: "accessible_table";
  guestId: GuestId;
}

export type Constraint =
  | TogetherConstraint
  | ApartConstraint
  | FixedTableConstraint
  | AccessibleTableConstraint;

export type ConstraintDraft =
  | Omit<TogetherConstraint, "id" | "label">
  | Omit<ApartConstraint, "id" | "label">
  | Omit<FixedTableConstraint, "id" | "label">
  | Omit<AccessibleTableConstraint, "id" | "label">;

export type AssignmentMap = Record<GuestId, TableId | null>;

export type ViolationCode =
  | "UNSEATED_GUEST"
  | "UNKNOWN_TABLE"
  | "TABLE_OVER_CAPACITY"
  | "TOGETHER_CONSTRAINT"
  | "APART_CONSTRAINT"
  | "FIXED_TABLE_CONSTRAINT"
  | "ACCESSIBLE_TABLE_CONSTRAINT";

export interface Violation {
  id: string;
  code: ViolationCode;
  message: string;
  guestIds: GuestId[];
  constraintId?: ConstraintId;
  tableId?: TableId;
}

export type ActivityActor = "human" | "agent" | "system";

export interface ActivityEntry {
  id: string;
  actor: ActivityActor;
  action: string;
  detail: string;
  at: string;
  revision: number;
}

export interface SeatingState {
  schemaVersion: 1;
  revision: number;
  guests: Guest[];
  tables: SeatingTable[];
  assignments: AssignmentMap;
  constraints: Constraint[];
  lockedGuestIds: GuestId[];
  violations: Violation[];
  activityLog: ActivityEntry[];
}

export interface RepairOptions {
  respectLocks: boolean;
  preserveCurrentAssignments: boolean;
  signal?: AbortSignal;
}

export interface SolverResult {
  assignments: AssignmentMap | null;
  exploredNodes: number;
  reason?: "UNSATISFIABLE" | "ABORTED";
}

export interface PublicSeatingState {
  revision: number;
  guests: Guest[];
  tables: SeatingTable[];
  assignments: AssignmentMap;
  constraints: Constraint[];
  lockedGuestIds: GuestId[];
  violations: Violation[];
}
