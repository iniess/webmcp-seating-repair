import assert from "node:assert/strict";
import test from "node:test";
import { createDemoState } from "../.test-dist/src/data/demo.js";
import { solveSeatingPlan } from "../.test-dist/src/domain/solver.js";
import {
  summarizeValidation,
  validateSeatingPlan
} from "../.test-dist/src/domain/validation.js";

test("demo fixture starts with exactly three constraint conflicts", () => {
  const violations = validateSeatingPlan(createDemoState());

  assert.equal(violations.length, 3);
  assert.deepEqual(
    violations.map((violation) => violation.code).sort(),
    ["APART_CONSTRAINT", "TOGETHER_CONSTRAINT", "TOGETHER_CONSTRAINT"]
  );
});

test("validation summary separates seating, capacity, and constraint failures", () => {
  const state = createDemoState();
  state.assignments["grandma-rose"] = null;
  state.assignments["james-wilson"] = "window";
  const summary = summarizeValidation(validateSeatingPlan(state));

  assert.equal(summary.valid, false);
  assert.equal(summary.unseatedCount, 1);
  assert.deepEqual(summary.overCapacityTableIds, ["window"]);
  assert.ok(summary.constraintViolationCount >= 1);
});

test("solver finds the minimum-move repair without moving a locked guest", () => {
  const state = createDemoState();
  const lockedAssignment = state.assignments["emma-davis"];
  const result = solveSeatingPlan(state, {
    respectLocks: true,
    preserveCurrentAssignments: true
  });

  assert.ok(result.assignments);
  assert.equal(result.assignments["emma-davis"], lockedAssignment);
  assert.equal(
    state.guests.filter(
      (guest) => state.assignments[guest.id] !== result.assignments?.[guest.id]
    ).length,
    3
  );
  assert.equal(
    validateSeatingPlan({ ...state, assignments: result.assignments }).length,
    0
  );
  assert.ok(result.exploredNodes < 10_000);
});

test("solver produces the same repair for the same state", () => {
  const state = createDemoState();
  const first = solveSeatingPlan(state);
  const second = solveSeatingPlan(structuredClone(state));

  assert.deepEqual(second, first);
});

test("solver repairs around a human move and lock", () => {
  const state = createDemoState();
  const firstRepair = solveSeatingPlan(state);
  assert.ok(firstRepair.assignments);

  state.assignments = firstRepair.assignments;
  state.assignments["grandma-rose"] = "family";
  state.lockedGuestIds.push("grandma-rose");
  state.constraints.push({
    id: "maya-liam-apart",
    type: "apart",
    guestIds: ["maya-chen", "liam-brooks"],
    label: "Maya and Liam must sit apart"
  });

  const result = solveSeatingPlan(state);
  assert.ok(result.assignments);
  assert.equal(result.assignments["grandma-rose"], "family");
  assert.equal(
    validateSeatingPlan({ ...state, assignments: result.assignments }).length,
    0
  );
});

test("an impossible locked accessible assignment is rejected", () => {
  const state = createDemoState();
  state.assignments["grandma-rose"] = "window";
  state.lockedGuestIds.push("grandma-rose");

  const result = solveSeatingPlan(state, { respectLocks: true });
  assert.equal(result.assignments, null);
  assert.equal(result.reason, "UNSATISFIABLE");
});

test("contradictory fixed-table constraints are rejected before search", () => {
  const state = createDemoState();
  state.constraints.push({
    id: "emma-garden",
    type: "fixed_table",
    guestId: "emma-davis",
    tableId: "garden",
    label: "Emma must sit at the Garden Table"
  });

  const result = solveSeatingPlan(state);
  assert.equal(result.assignments, null);
  assert.equal(result.reason, "UNSATISFIABLE");
  assert.equal(result.exploredNodes, 0);
});

test("invalid constraint references are reported and never solved", () => {
  const state = createDemoState();
  state.constraints.push({
    id: "unknown-guest-rule",
    type: "accessible_table",
    guestId: "missing-guest",
    label: "Unknown guest needs an accessible table"
  });

  assert.ok(
    validateSeatingPlan(state).some(
      (violation) => violation.code === "INVALID_CONSTRAINT"
    )
  );
  assert.equal(solveSeatingPlan(state).reason, "UNSATISFIABLE");
});

test("solver stops immediately when execution is already cancelled", () => {
  const controller = new AbortController();
  controller.abort();

  const result = solveSeatingPlan(createDemoState(), {
    signal: controller.signal
  });
  assert.equal(result.assignments, null);
  assert.equal(result.reason, "ABORTED");
  assert.equal(result.exploredNodes, 0);
});

test("validator reports over-capacity and unknown-table assignments", () => {
  const overCapacity = createDemoState();
  overCapacity.assignments["james-wilson"] = "garden";
  assert.ok(
    validateSeatingPlan(overCapacity).some(
      (violation) => violation.code === "TABLE_OVER_CAPACITY"
    )
  );

  const unknownTable = createDemoState();
  unknownTable.assignments["grandma-rose"] = "missing-table";
  assert.ok(
    validateSeatingPlan(unknownTable).some(
      (violation) => violation.code === "UNKNOWN_TABLE"
    )
  );
});
