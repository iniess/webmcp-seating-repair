import assert from "node:assert/strict";
import test from "node:test";
import {
  SeatingStore,
  StateChangedError
} from "../.test-dist/src/state/store.js";

test("stale writes fail closed without changing state", () => {
  const store = new SeatingStore(null);
  const before = store.getSnapshot();

  assert.throws(
    () =>
      store.addConstraints(before.revision + 1, [
        {
          type: "apart",
          guestIds: ["maya-chen", "liam-brooks"]
        }
      ]),
    StateChangedError
  );
  assert.deepEqual(store.getSnapshot(), before);
});

test("reversed relationship duplicates are idempotent", () => {
  const store = new SeatingStore(null);
  const before = store.getSnapshot();
  const result = store.addConstraints(before.revision, [
    {
      type: "together",
      guestIds: ["noah-kim", "ava-patel"]
    }
  ]);

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.movedGuestIds, []);
  assert.equal(result.revision, before.revision);
  assert.equal(result.conflictsBefore, result.conflictsAfter);
  assert.deepEqual(store.getSnapshot(), before);
});

test("unsatisfiable repair never mutates the board", () => {
  const store = new SeatingStore(null);
  store.moveGuest("grandma-rose", "window");
  store.toggleGuestLock("grandma-rose");
  const before = store.getSnapshot();

  const result = store.repair(before.revision, {
    respectLocks: true,
    preserveCurrentAssignments: true
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "UNSATISFIABLE");
  assert.equal(result.revision, before.revision);
  assert.deepEqual(result.movedGuestIds, []);
  assert.deepEqual(store.getSnapshot(), before);
});

test("complete human-agent-human flow preserves the human lock", () => {
  const store = new SeatingStore(null);
  const first = store.repair(0);
  assert.equal(first.applied, true);
  assert.equal(first.conflictsAfter, 0);

  store.moveGuest("grandma-rose", "family");
  store.toggleGuestLock("grandma-rose");
  const afterHumanEdit = store.getSnapshot();
  const added = store.addConstraints(afterHumanEdit.revision, [
    {
      type: "apart",
      guestIds: ["maya-chen", "liam-brooks"]
    }
  ]);
  const second = store.repair(added.revision);
  const validation = store.validate();

  assert.equal(second.applied, true);
  assert.equal(store.getSnapshot().assignments["grandma-rose"], "family");
  assert.equal(validation.valid, true);
  assert.equal(validation.unseatedCount, 0);
  assert.deepEqual(validation.overCapacityTableIds, []);
  assert.equal(validation.constraintViolationCount, 0);
});

test("malformed persisted state falls back to the deterministic demo", () => {
  const writes = [];
  const storage = {
    getItem: () => JSON.stringify({ schemaVersion: 1, revision: 99 }),
    setItem: (key, value) => writes.push([key, value])
  };

  const store = new SeatingStore(storage);
  const state = store.getSnapshot();

  assert.equal(state.revision, 0);
  assert.equal(state.guests.length, 12);
  assert.equal(state.tables.length, 3);
  assert.equal(state.violations.length, 3);
  assert.equal(writes.length, 1);
});

test("storage failures do not break the live session", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    }
  };

  const store = new SeatingStore(storage);
  assert.doesNotThrow(() => store.moveGuest("grandma-rose", "family"));
  assert.equal(store.getSnapshot().revision, 1);
});

test("returned constraint data cannot mutate internal state", () => {
  const store = new SeatingStore(null);
  const result = store.addConstraints(0, [
    {
      type: "apart",
      guestIds: ["maya-chen", "liam-brooks"]
    }
  ]);
  assert.equal(result.added.length, 1);

  result.added[0].label = "tampered";
  assert.notEqual(store.getSnapshot().constraints.at(-1)?.label, "tampered");
});
