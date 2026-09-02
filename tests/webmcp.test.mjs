import assert from "node:assert/strict";
import test from "node:test";
import { SeatingStore } from "../.test-dist/src/state/store.js";
import { registerWebMcpTools } from "../.test-dist/src/webmcp/registerTools.js";

test("registers exactly four distinct tools and disposes them together", async () => {
  const registrations = [];
  const modelContext = {
    registerTool: async (tool, options) => registrations.push({ tool, options })
  };

  await withDocument({ modelContext }, async () => {
    const status = await registerWebMcpTools(new SeatingStore(null));

    assert.equal(status.supported, true);
    assert.equal(status.registered, true);
    assert.deepEqual(
      registrations.map(({ tool }) => tool.name),
      [
        "get_seating_state",
        "add_seating_constraints",
        "repair_seating_plan",
        "validate_seating_plan"
      ]
    );
    const signals = registrations.map(({ options }) => options.signal);
    assert.ok(signals.every((signal) => signal === signals[0]));
    assert.equal(signals[0].aborted, false);
    status.dispose();
    assert.equal(signals[0].aborted, true);
  });
});

test("tools execute the complete collaboration flow against live state", async () => {
  const registrations = [];
  const modelContext = {
    registerTool: async (tool, options) => registrations.push({ tool, options })
  };

  await withDocument({ modelContext }, async () => {
    const store = new SeatingStore(null);
    await registerWebMcpTools(store);
    const signal = new AbortController().signal;
    const getState = toolByName(registrations, "get_seating_state");
    const addConstraints = toolByName(
      registrations,
      "add_seating_constraints"
    );
    const repair = toolByName(registrations, "repair_seating_plan");
    const validate = toolByName(registrations, "validate_seating_plan");

    const initial = await getState.execute({}, { signal });
    assert.equal(initial.state.revision, 0);
    const firstRepair = await repair.execute(
      { expectedRevision: initial.state.revision },
      { signal }
    );
    assert.equal(firstRepair.ok, true);
    assert.equal(firstRepair.conflictsAfter, 0);

    store.moveGuest("grandma-rose", "family");
    store.toggleGuestLock("grandma-rose");
    const afterHumanEdit = await getState.execute({}, { signal });
    const added = await addConstraints.execute(
      {
        expectedRevision: afterHumanEdit.state.revision,
        constraints: [
          {
            type: "apart",
            guestIds: ["maya-chen", "liam-brooks"]
          }
        ]
      },
      { signal }
    );
    assert.equal(added.ok, true);
    assert.equal(added.added.length, 1);

    const secondRepair = await repair.execute(
      { expectedRevision: added.revision },
      { signal }
    );
    const finalValidation = await validate.execute({}, { signal });

    assert.equal(secondRepair.ok, true);
    assert.equal(finalValidation.valid, true);
    assert.equal(finalValidation.unseatedCount, 0);
    assert.deepEqual(finalValidation.overCapacityTableIds, []);
    assert.equal(store.getSnapshot().assignments["grandma-rose"], "family");
  });
});

test("stale tool writes return a recoverable error without mutation", async () => {
  const registrations = [];
  const modelContext = {
    registerTool: async (tool, options) => registrations.push({ tool, options })
  };

  await withDocument({ modelContext }, async () => {
    const store = new SeatingStore(null);
    await registerWebMcpTools(store);
    const repair = toolByName(registrations, "repair_seating_plan");
    const signal = new AbortController().signal;

    store.moveGuest("grandma-rose", "family");
    const before = store.getSnapshot();
    const result = await repair.execute({ expectedRevision: 0 }, { signal });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "STATE_CHANGED");
    assert.equal(result.error.currentRevision, before.revision);
    assert.deepEqual(store.getSnapshot(), before);
  });
});

test("runtime validation rejects extra and malformed input fields", async () => {
  const registrations = [];
  const modelContext = {
    registerTool: async (tool, options) => registrations.push({ tool, options })
  };

  await withDocument({ modelContext }, async () => {
    const store = new SeatingStore(null);
    await registerWebMcpTools(store);
    const signal = new AbortController().signal;
    const getState = toolByName(registrations, "get_seating_state");
    const addConstraints = toolByName(
      registrations,
      "add_seating_constraints"
    );

    const extraReadField = await getState.execute({ unexpected: true }, { signal });
    const malformedConstraint = await addConstraints.execute(
      {
        expectedRevision: 0,
        constraints: [
          {
            type: "apart",
            guestIds: ["maya-chen", "maya-chen"],
            unexpected: true
          }
        ]
      },
      { signal }
    );
    const repair = toolByName(registrations, "repair_seating_plan");
    const lockBypass = await repair.execute(
      { expectedRevision: 0, respectLocks: false },
      { signal }
    );

    assert.equal(extraReadField.error.code, "INVALID_REQUEST");
    assert.equal(malformedConstraint.error.code, "INVALID_REQUEST");
    assert.equal(lockBypass.error.code, "INVALID_REQUEST");
    assert.match(lockBypass.error.message, /cannot be false/);
    assert.equal(store.getSnapshot().revision, 0);
  });
});

test("partial registration failure aborts tools already registered", async () => {
  const registrationSignals = [];
  let calls = 0;
  const modelContext = {
    registerTool: async (_tool, options) => {
      calls += 1;
      registrationSignals.push(options.signal);
      if (calls === 2) throw new Error("registration rejected");
    }
  };

  await withDocument({ modelContext }, async () => {
    const status = await registerWebMcpTools(new SeatingStore(null));
    assert.equal(status.supported, true);
    assert.equal(status.registered, false);
    assert.match(status.message, /registration rejected/);
    assert.ok(registrationSignals.every((signal) => signal.aborted));
  });
});

test("reports a usable fallback when the browser has no WebMCP", async () => {
  await withDocument({}, async () => {
    const status = await registerWebMcpTools(new SeatingStore(null));
    assert.equal(status.supported, false);
    assert.equal(status.registered, false);
    assert.match(status.message, /unavailable/i);
  });
});

function toolByName(registrations, name) {
  const registration = registrations.find(({ tool }) => tool.name === name);
  assert.ok(registration, `Missing ${name}`);
  return registration.tool;
}

async function withDocument(value, operation) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value
  });

  try {
    return await operation();
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  }
}
