import type { SeatingState } from "../types.js";

export const DEMO_PROMPT_REPAIR =
  "Repair this seating plan while respecting every locked guest and all existing constraints. Validate it when finished.";

export const DEMO_PROMPT_COLLABORATE =
  "Keep Grandma Rose exactly where I placed her. Add a hard constraint that Maya and Liam must sit apart, repair everything else, and validate the result.";

export function createDemoState(): SeatingState {
  return {
    schemaVersion: 1,
    revision: 0,
    guests: [
      { id: "grandma-rose", name: "Grandma Rose", initials: "GR" },
      { id: "maya-chen", name: "Maya Chen", initials: "MC" },
      { id: "liam-brooks", name: "Liam Brooks", initials: "LB" },
      { id: "ava-patel", name: "Ava Patel", initials: "AP" },
      { id: "noah-kim", name: "Noah Kim", initials: "NK" },
      { id: "emma-davis", name: "Emma Davis", initials: "ED" },
      { id: "oliver-reed", name: "Oliver Reed", initials: "OR" },
      { id: "sophia-martin", name: "Sophia Martin", initials: "SM" },
      { id: "james-wilson", name: "James Wilson", initials: "JW" },
      { id: "lucas-gray", name: "Lucas Gray", initials: "LG" },
      { id: "zoe-adams", name: "Zoe Adams", initials: "ZA" },
      { id: "ethan-clark", name: "Ethan Clark", initials: "EC" }
    ],
    tables: [
      { id: "garden", name: "Garden Table", capacity: 4, accessible: true },
      { id: "window", name: "Window Table", capacity: 4, accessible: false },
      { id: "family", name: "Family Table", capacity: 4, accessible: true }
    ],
    assignments: {
      "grandma-rose": "garden",
      "maya-chen": "garden",
      "liam-brooks": "garden",
      "ava-patel": "garden",
      "noah-kim": "window",
      "emma-davis": "window",
      "oliver-reed": "window",
      "sophia-martin": "window",
      "james-wilson": "family",
      "lucas-gray": "family",
      "zoe-adams": "family",
      "ethan-clark": "family"
    },
    constraints: [
      {
        id: "ava-noah-together",
        type: "together",
        guestIds: ["ava-patel", "noah-kim"],
        label: "Ava and Noah must sit together"
      },
      {
        id: "sophia-james-together",
        type: "together",
        guestIds: ["sophia-martin", "james-wilson"],
        label: "Sophia and James must sit together"
      },
      {
        id: "lucas-ethan-apart",
        type: "apart",
        guestIds: ["lucas-gray", "ethan-clark"],
        label: "Lucas and Ethan must sit apart"
      },
      {
        id: "emma-window",
        type: "fixed_table",
        guestId: "emma-davis",
        tableId: "window",
        label: "Emma must remain at the Window Table"
      },
      {
        id: "grandma-accessible",
        type: "accessible_table",
        guestId: "grandma-rose",
        label: "Grandma Rose needs an accessible table"
      }
    ],
    lockedGuestIds: ["emma-davis"],
    violations: [],
    activityLog: [
      {
        id: "activity-initial",
        actor: "system",
        action: "Demo loaded",
        detail: "The fixture starts with three repairable conflicts.",
        at: new Date().toISOString(),
        revision: 0
      }
    ]
  };
}
