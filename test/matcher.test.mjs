import test from "node:test";
import assert from "node:assert/strict";

import { slotMatchesWatcher } from "../src/core/matcher.mjs";

test("slotMatchesWatcher enforces exclusion, radius, date, and time preferences", () => {
  const watcher = {
    active: true,
    officePreferences: {
      exclude: ["Durham"],
      radiusMiles: 20
    },
    datePreferences: {
      from: "2026-03-10",
      to: "2026-03-20",
      daysOfWeek: [1, 2, 3, 4, 5]
    },
    timePreferences: {
      start: "08:00",
      end: "12:00"
    }
  };

  const slot = {
    officeName: "Raleigh North",
    officeAddress: "",
    distanceMiles: 10,
    startAt: "2026-03-12T14:00:00.000Z"
  };

  assert.equal(slotMatchesWatcher(slot, watcher), true);
  assert.equal(
    slotMatchesWatcher({ ...slot, officeName: "Durham South" }, watcher),
    false
  );
  assert.equal(
    slotMatchesWatcher({ ...slot, distanceMiles: 25 }, watcher),
    false
  );
});
