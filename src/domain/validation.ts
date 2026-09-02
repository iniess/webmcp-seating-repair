import type {
  Constraint,
  GuestId,
  SeatingState,
  TableId,
  ValidationSummary,
  Violation
} from "../types.js";

function assignedTable(state: SeatingState, guestId: GuestId): TableId | null {
  return state.assignments[guestId] ?? null;
}

export function validateSeatingPlan(state: SeatingState): Violation[] {
  const violations: Violation[] = [];
  const tableById = new Map(state.tables.map((table) => [table.id, table]));
  const guestById = new Map(state.guests.map((guest) => [guest.id, guest]));
  const guestsByTable = new Map<TableId, GuestId[]>();

  for (const table of state.tables) {
    guestsByTable.set(table.id, []);
  }

  for (const guest of state.guests) {
    const tableId = assignedTable(state, guest.id);

    if (tableId === null) {
      violations.push({
        id: `unseated:${guest.id}`,
        code: "UNSEATED_GUEST",
        message: `${guest.name} is not seated`,
        guestIds: [guest.id]
      });
      continue;
    }

    const table = tableById.get(tableId);
    if (!table) {
      violations.push({
        id: `unknown-table:${guest.id}:${tableId}`,
        code: "UNKNOWN_TABLE",
        message: `${guest.name} is assigned to an unknown table`,
        guestIds: [guest.id],
        tableId
      });
      continue;
    }

    guestsByTable.get(tableId)?.push(guest.id);
  }

  for (const table of state.tables) {
    const guestIds = guestsByTable.get(table.id) ?? [];
    if (guestIds.length > table.capacity) {
      violations.push({
        id: `capacity:${table.id}`,
        code: "TABLE_OVER_CAPACITY",
        message: `${table.name} is over capacity by ${guestIds.length - table.capacity}`,
        guestIds,
        tableId: table.id
      });
    }
  }

  for (const constraint of state.constraints) {
    validateConstraint(constraint, state, guestById, tableById, violations);
  }

  return violations.sort((left, right) => left.id.localeCompare(right.id));
}

function validateConstraint(
  constraint: Constraint,
  state: SeatingState,
  guestById: Map<GuestId, SeatingState["guests"][number]>,
  tableById: Map<TableId, SeatingState["tables"][number]>,
  violations: Violation[]
): void {
  if (constraint.type === "together" || constraint.type === "apart") {
    const [firstGuestId, secondGuestId] = constraint.guestIds;
    const missingGuestIds = constraint.guestIds.filter(
      (guestId) => !guestById.has(guestId)
    );
    if (missingGuestIds.length > 0 || firstGuestId === secondGuestId) {
      violations.push({
        id: `constraint:${constraint.id}`,
        code: "INVALID_CONSTRAINT",
        message:
          missingGuestIds.length > 0
            ? `${constraint.label} references an unknown guest`
            : `${constraint.label} must reference two different guests`,
        guestIds: [...constraint.guestIds],
        constraintId: constraint.id
      });
      return;
    }

    const firstTableId = assignedTable(state, firstGuestId);
    const secondTableId = assignedTable(state, secondGuestId);

    if (firstTableId === null || secondTableId === null) {
      return;
    }

    const isViolated =
      constraint.type === "together"
        ? firstTableId !== secondTableId
        : firstTableId === secondTableId;

    if (!isViolated) {
      return;
    }

    const firstName = guestById.get(firstGuestId)?.name ?? firstGuestId;
    const secondName = guestById.get(secondGuestId)?.name ?? secondGuestId;
    const wording = constraint.type === "together" ? "sit together" : "sit apart";

    violations.push({
      id: `constraint:${constraint.id}`,
      code:
        constraint.type === "together"
          ? "TOGETHER_CONSTRAINT"
          : "APART_CONSTRAINT",
      message: `${firstName} and ${secondName} must ${wording}`,
      guestIds: [firstGuestId, secondGuestId],
      constraintId: constraint.id
    });
    return;
  }

  if (constraint.type === "fixed_table") {
    if (
      !guestById.has(constraint.guestId) ||
      !tableById.has(constraint.tableId)
    ) {
      violations.push({
        id: `constraint:${constraint.id}`,
        code: "INVALID_CONSTRAINT",
        message: `${constraint.label} references an unknown guest or table`,
        guestIds: [constraint.guestId],
        constraintId: constraint.id,
        tableId: constraint.tableId
      });
      return;
    }

    const actualTableId = assignedTable(state, constraint.guestId);
    if (actualTableId === constraint.tableId) {
      return;
    }

    const guestName = guestById.get(constraint.guestId)?.name ?? constraint.guestId;
    const tableName = tableById.get(constraint.tableId)?.name ?? constraint.tableId;

    violations.push({
      id: `constraint:${constraint.id}`,
      code: "FIXED_TABLE_CONSTRAINT",
      message: `${guestName} must sit at ${tableName}`,
      guestIds: [constraint.guestId],
      constraintId: constraint.id,
      tableId: constraint.tableId
    });
    return;
  }

  if (!guestById.has(constraint.guestId)) {
    violations.push({
      id: `constraint:${constraint.id}`,
      code: "INVALID_CONSTRAINT",
      message: `${constraint.label} references an unknown guest`,
      guestIds: [constraint.guestId],
      constraintId: constraint.id
    });
    return;
  }

  const tableId = assignedTable(state, constraint.guestId);
  if (tableId === null) {
    return;
  }

  const table = tableById.get(tableId);
  if (!table) {
    return;
  }
  if (table?.accessible) {
    return;
  }

  const guestName = guestById.get(constraint.guestId)?.name ?? constraint.guestId;
  violations.push({
    id: `constraint:${constraint.id}`,
    code: "ACCESSIBLE_TABLE_CONSTRAINT",
    message: `${guestName} needs an accessible table`,
    guestIds: [constraint.guestId],
    constraintId: constraint.id,
    tableId
  });
}

export function isPlanValid(state: SeatingState): boolean {
  return validateSeatingPlan(state).length === 0;
}

export function summarizeValidation(violations: Violation[]): ValidationSummary {
  return {
    valid: violations.length === 0,
    unseatedCount: violations.filter(
      (violation) => violation.code === "UNSEATED_GUEST"
    ).length,
    overCapacityTableIds: [
      ...new Set(
        violations.flatMap((violation) =>
          violation.code === "TABLE_OVER_CAPACITY" && violation.tableId
            ? [violation.tableId]
            : []
        )
      )
    ],
    constraintViolationCount: violations.filter(
      (violation) => violation.constraintId !== undefined
    ).length,
    violations
  };
}
