import { SeatingStore, StateChangedError } from "../state/store.js";
import type { ConstraintDraft } from "../types.js";

export interface WebMcpRegistrationStatus {
  supported: boolean;
  registered: boolean;
  message: string;
  dispose: () => void;
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

const CONSTRAINT_SCHEMA = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: { const: "together" },
        guestIds: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2
        }
      },
      required: ["type", "guestIds"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { const: "apart" },
        guestIds: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2
        }
      },
      required: ["type", "guestIds"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { const: "fixed_table" },
        guestId: { type: "string" },
        tableId: { type: "string" }
      },
      required: ["type", "guestId", "tableId"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { const: "accessible_table" },
        guestId: { type: "string" }
      },
      required: ["type", "guestId"],
      additionalProperties: false
    }
  ]
} as const;

export async function registerWebMcpTools(
  store: SeatingStore
): Promise<WebMcpRegistrationStatus> {
  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") {
    return {
      supported: false,
      registered: false,
      message: "WebMCP unavailable in this browser",
      dispose: () => undefined
    };
  }

  const controller = new AbortController();

  try {
    await modelContext.registerTool(
      {
        name: "get_seating_state",
        title: "Read the seating board",
        description:
          "Read the current guests, tables, assignments, locked guests, hard constraints, violations, and revision. This tool is read-only and should be called before any write tool.",
        inputSchema: EMPTY_OBJECT_SCHEMA,
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input) => {
          requirePlainObject(input);
          return { ok: true, state: store.getPublicSnapshot() };
        }
      },
      { signal: controller.signal }
    );

    await modelContext.registerTool(
      {
        name: "add_seating_constraints",
        title: "Add hard seating constraints",
        description:
          "Add one or more hard constraints to the current seating board. This changes live page state. Pass the revision returned by get_seating_state so a stale agent write cannot overwrite newer human work.",
        inputSchema: {
          type: "object",
          properties: {
            expectedRevision: { type: "integer", minimum: 0 },
            constraints: {
              type: "array",
              items: CONSTRAINT_SCHEMA,
              minItems: 1,
              maxItems: 12
            }
          },
          required: ["expectedRevision", "constraints"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) =>
          executeSafely(() => {
            const parsed = parseAddConstraintsInput(input);
            return {
              ok: true,
              ...store.addConstraints(parsed.expectedRevision, parsed.constraints)
            };
          })
      },
      { signal: controller.signal }
    );

    await modelContext.registerTool(
      {
        name: "repair_seating_plan",
        title: "Repair the seating plan",
        description:
          "Compute and apply a valid seating plan for the current live board. By default the solver preserves human-locked guests and minimizes other moves. This changes assignments but never applies a partial or invalid result.",
        inputSchema: {
          type: "object",
          properties: {
            expectedRevision: { type: "integer", minimum: 0 },
            respectLocks: { type: "boolean", default: true },
            preserveCurrentAssignments: { type: "boolean", default: true }
          },
          required: ["expectedRevision"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input, options) =>
          executeSafely(() => {
            const parsed = parseRepairInput(input);
            const result = store.repair(parsed.expectedRevision, {
              respectLocks: parsed.respectLocks,
              preserveCurrentAssignments: parsed.preserveCurrentAssignments,
              ...(options?.signal ? { signal: options.signal } : {})
            });
            return { ok: result.applied, ...result };
          })
      },
      { signal: controller.signal }
    );

    await modelContext.registerTool(
      {
        name: "validate_seating_plan",
        title: "Validate the seating plan",
        description:
          "Check the current live seating board for unseated guests, capacity problems, and hard-constraint violations. This tool is read-only and does not change page state.",
        inputSchema: EMPTY_OBJECT_SCHEMA,
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input) => {
          requirePlainObject(input);
          return { ok: true, ...store.validate() };
        }
      },
      { signal: controller.signal }
    );

    return {
      supported: true,
      registered: true,
      message: "4 WebMCP tools connected",
      dispose: () => controller.abort()
    };
  } catch (error) {
    controller.abort();
    return {
      supported: true,
      registered: false,
      message: error instanceof Error ? error.message : "WebMCP registration failed",
      dispose: () => undefined
    };
  }
}

function parseAddConstraintsInput(input: unknown): {
  expectedRevision: number;
  constraints: ConstraintDraft[];
} {
  const record = requirePlainObject(input);
  const expectedRevision = requireRevision(record.expectedRevision);
  if (!Array.isArray(record.constraints) || record.constraints.length === 0) {
    throw new Error("constraints must be a non-empty array");
  }

  return {
    expectedRevision,
    constraints: record.constraints.map(parseConstraintDraft)
  };
}

function parseConstraintDraft(input: unknown): ConstraintDraft {
  const record = requirePlainObject(input);

  if (record.type === "together" || record.type === "apart") {
    if (!Array.isArray(record.guestIds) || record.guestIds.length !== 2) {
      throw new Error(`${record.type}.guestIds must contain exactly two guest IDs`);
    }
    const firstGuestId = requireString(record.guestIds[0], "guestIds[0]");
    const secondGuestId = requireString(record.guestIds[1], "guestIds[1]");
    return { type: record.type, guestIds: [firstGuestId, secondGuestId] };
  }

  if (record.type === "fixed_table") {
    return {
      type: "fixed_table",
      guestId: requireString(record.guestId, "guestId"),
      tableId: requireString(record.tableId, "tableId")
    };
  }

  if (record.type === "accessible_table") {
    return {
      type: "accessible_table",
      guestId: requireString(record.guestId, "guestId")
    };
  }

  throw new Error("Unsupported constraint type");
}

function parseRepairInput(input: unknown): {
  expectedRevision: number;
  respectLocks: boolean;
  preserveCurrentAssignments: boolean;
} {
  const record = requirePlainObject(input);
  return {
    expectedRevision: requireRevision(record.expectedRevision),
    respectLocks: requireOptionalBoolean(record.respectLocks, true, "respectLocks"),
    preserveCurrentAssignments: requireOptionalBoolean(
      record.preserveCurrentAssignments,
      true,
      "preserveCurrentAssignments"
    )
  };
}

function requirePlainObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tool input must be an object");
  }
  return value as Record<string, unknown>;
}

function requireRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error("expectedRevision must be a non-negative integer");
  }
  return value as number;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireOptionalBoolean(
  value: unknown,
  fallback: boolean,
  field: string
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function executeSafely(operation: () => unknown): unknown {
  try {
    return operation();
  } catch (error) {
    if (error instanceof StateChangedError) {
      return {
        ok: false,
        error: {
          code: "STATE_CHANGED",
          message: error.message,
          currentRevision: error.currentRevision,
          recommendedAction: "Call get_seating_state again before retrying the write."
        }
      };
    }

    return {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: error instanceof Error ? error.message : "Unknown tool execution error"
      }
    };
  }
}
