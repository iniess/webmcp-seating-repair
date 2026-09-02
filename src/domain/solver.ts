import type {
  AssignmentMap,
  GuestId,
  RepairOptions,
  SeatingState,
  SolverResult,
  TableId
} from "../types.js";
import { validateSeatingPlan } from "./validation.js";

const DEFAULT_OPTIONS: RepairOptions = {
  respectLocks: true,
  preserveCurrentAssignments: true
};

export function solveSeatingPlan(
  state: SeatingState,
  options: Partial<RepairOptions> = {}
): SolverResult {
  const resolvedOptions: RepairOptions = { ...DEFAULT_OPTIONS, ...options };
  if (resolvedOptions.signal?.aborted) {
    return { assignments: null, exploredNodes: 0, reason: "ABORTED" };
  }

  const tableIds = state.tables.map((table) => table.id);
  const tableById = new Map(state.tables.map((table) => [table.id, table]));
  const guestIds = state.guests.map((guest) => guest.id);
  const guestIdSet = new Set(guestIds);

  if (
    guestIdSet.size !== guestIds.length ||
    tableById.size !== tableIds.length ||
    state.tables.some(
      (table) => !Number.isSafeInteger(table.capacity) || table.capacity < 0
    ) ||
    state.tables.reduce((total, table) => total + table.capacity, 0) <
      state.guests.length
  ) {
    return { assignments: null, exploredNodes: 0, reason: "UNSATISFIABLE" };
  }

  const lockedGuestIds = new Set(state.lockedGuestIds);
  const fixedTableByGuest = new Map<GuestId, TableId>();
  const accessibleGuestIds = new Set<GuestId>();
  const relationDegree = new Map<GuestId, number>();

  for (const guest of state.guests) {
    relationDegree.set(guest.id, 0);
  }

  for (const constraint of state.constraints) {
    if (constraint.type === "fixed_table") {
      if (
        !guestIdSet.has(constraint.guestId) ||
        !tableById.has(constraint.tableId)
      ) {
        return { assignments: null, exploredNodes: 0, reason: "UNSATISFIABLE" };
      }

      const existingFixedTableId = fixedTableByGuest.get(constraint.guestId);
      if (existingFixedTableId && existingFixedTableId !== constraint.tableId) {
        return { assignments: null, exploredNodes: 0, reason: "UNSATISFIABLE" };
      }

      fixedTableByGuest.set(constraint.guestId, constraint.tableId);
      relationDegree.set(
        constraint.guestId,
        (relationDegree.get(constraint.guestId) ?? 0) + 2
      );
    } else if (constraint.type === "accessible_table") {
      if (!guestIdSet.has(constraint.guestId)) {
        return { assignments: null, exploredNodes: 0, reason: "UNSATISFIABLE" };
      }
      accessibleGuestIds.add(constraint.guestId);
      relationDegree.set(
        constraint.guestId,
        (relationDegree.get(constraint.guestId) ?? 0) + 1
      );
    } else {
      if (
        constraint.guestIds[0] === constraint.guestIds[1] ||
        constraint.guestIds.some((guestId) => !guestIdSet.has(guestId))
      ) {
        return { assignments: null, exploredNodes: 0, reason: "UNSATISFIABLE" };
      }
      for (const guestId of constraint.guestIds) {
        relationDegree.set(guestId, (relationDegree.get(guestId) ?? 0) + 1);
      }
    }
  }

  const candidatesByGuest = new Map<GuestId, TableId[]>();

  for (const guest of state.guests) {
    const currentTableId = state.assignments[guest.id] ?? null;
    let candidates = [...tableIds];

    const fixedTableId = fixedTableByGuest.get(guest.id);
    if (fixedTableId) {
      candidates = candidates.filter((tableId) => tableId === fixedTableId);
    }

    if (accessibleGuestIds.has(guest.id)) {
      candidates = candidates.filter((tableId) => tableById.get(tableId)?.accessible);
    }

    if (resolvedOptions.respectLocks && lockedGuestIds.has(guest.id)) {
      candidates = currentTableId === null ? [] : candidates.filter((id) => id === currentTableId);
    }

    candidates.sort((left, right) => {
      if (resolvedOptions.preserveCurrentAssignments) {
        if (left === currentTableId && right !== currentTableId) return -1;
        if (right === currentTableId && left !== currentTableId) return 1;
      }
      return tableIds.indexOf(left) - tableIds.indexOf(right);
    });

    candidatesByGuest.set(guest.id, candidates);
  }

  if ([...candidatesByGuest.values()].some((candidates) => candidates.length === 0)) {
    return { assignments: null, exploredNodes: 0, reason: "UNSATISFIABLE" };
  }

  const orderedGuestIds = state.guests
    .map((guest) => guest.id)
    .sort((left, right) => {
      const candidateDifference =
        (candidatesByGuest.get(left)?.length ?? 0) -
        (candidatesByGuest.get(right)?.length ?? 0);
      if (candidateDifference !== 0) return candidateDifference;

      const relationDifference =
        (relationDegree.get(right) ?? 0) - (relationDegree.get(left) ?? 0);
      if (relationDifference !== 0) return relationDifference;
      return left.localeCompare(right);
    });

  const partialAssignments = new Map<GuestId, TableId>();
  const occupancy = new Map<TableId, number>(tableIds.map((tableId) => [tableId, 0]));
  let bestAssignments: AssignmentMap | null = null;
  let bestMoveCount = Number.POSITIVE_INFINITY;
  let exploredNodes = 0;
  let aborted = false;

  const isPartialPlanValid = (): boolean => {
    for (const constraint of state.constraints) {
      if (constraint.type === "together" || constraint.type === "apart") {
        const [firstGuestId, secondGuestId] = constraint.guestIds;
        const firstTableId = partialAssignments.get(firstGuestId);
        const secondTableId = partialAssignments.get(secondGuestId);

        if (firstTableId && secondTableId) {
          if (constraint.type === "together" && firstTableId !== secondTableId) return false;
          if (constraint.type === "apart" && firstTableId === secondTableId) return false;
        }
      }
    }
    return true;
  };

  const recurse = (index: number, moveCount: number): void => {
    exploredNodes += 1;

    if (resolvedOptions.signal?.aborted) {
      aborted = true;
      return;
    }

    if (moveCount >= bestMoveCount || aborted) {
      return;
    }

    if (index === orderedGuestIds.length) {
      const assignments = Object.fromEntries(
        state.guests.map((guest) => [guest.id, partialAssignments.get(guest.id) ?? null])
      ) as AssignmentMap;
      const candidateState: SeatingState = { ...state, assignments };

      if (validateSeatingPlan(candidateState).length === 0) {
        bestAssignments = assignments;
        bestMoveCount = moveCount;
      }
      return;
    }

    const guestId = orderedGuestIds[index];
    if (!guestId) return;

    const candidates = candidatesByGuest.get(guestId) ?? [];
    for (const tableId of candidates) {
      const table = tableById.get(tableId);
      const currentOccupancy = occupancy.get(tableId) ?? 0;
      if (!table || currentOccupancy >= table.capacity) continue;

      partialAssignments.set(guestId, tableId);
      occupancy.set(tableId, currentOccupancy + 1);

      if (isPartialPlanValid()) {
        const moved = state.assignments[guestId] === tableId ? 0 : 1;
        const nextMoveCount = resolvedOptions.preserveCurrentAssignments
          ? moveCount + moved
          : moveCount;
        recurse(index + 1, nextMoveCount);
      }

      partialAssignments.delete(guestId);
      occupancy.set(tableId, currentOccupancy);

      if (aborted) return;
    }
  };

  recurse(0, 0);

  if (aborted) {
    return { assignments: null, exploredNodes, reason: "ABORTED" };
  }

  if (!bestAssignments) {
    return { assignments: null, exploredNodes, reason: "UNSATISFIABLE" };
  }

  return { assignments: bestAssignments, exploredNodes };
}
