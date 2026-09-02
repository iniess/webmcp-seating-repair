import assert from "node:assert/strict";
import test from "node:test";
import { createDemoState } from "../.test-dist/src/data/demo.js";
import { solveSeatingPlan } from "../.test-dist/src/domain/solver.js";
import { validateSeatingPlan } from "../.test-dist/src/domain/validation.js";

test("demo fixture starts with exactly three conflicts", () => {
  const state = createDemoState();
  const violations = validateSeatingPlan(state);
  assert.equal(violations.length, 3);
});

test("solver repairs the fixture without moving a locked guest", () => {
  const state = createDemoState();
  state.violations = validateSeatingPlan(state);
  const lockedAssignment = state.assignments["emma-davis"];

  const result = solveSeatingPlan(state, {
    respectLocks: true,
    preserveCurrentAssignments: true
  });

  assert.ok(result.assignments);
  assert.equal(result.assignments["emma-davis"], lockedAssignment);
  assert.equal(validateSeatingPlan({ ...state, assignments: result.assignments }).length, 0);
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
  assert.equal(validateSeatingPlan({ ...state, assignments: result.assignments }).length, 0);
});

test("an impossible locked accessible assignment is rejected", () => {
  const state = createDemoState();
  state.assignments["grandma-rose"] = "window";
  state.lockedGuestIds.push("grandma-rose");

  const result = solveSeatingPlan(state, { respectLocks: true });
  assert.equal(result.assignments, null);
  assert.equal(result.reason, "UNSATISFIABLE");
});
