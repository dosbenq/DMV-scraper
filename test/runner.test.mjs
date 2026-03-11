import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { MonitorRunner } from "../src/core/runner.mjs";
import { StateStore } from "../src/core/store.mjs";

test("MonitorRunner notifies again when a slot disappears and reappears", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dmv-runner-"));
  const store = new StateStore(path.join(tempDir, "state.json"));
  await store.load();

  const slot = {
    id: "cary-2026-03-17T15:15:00.000Z",
    officeName: "Cary",
    officeAddress: "Cary DMV",
    distanceMiles: 18.42,
    startAt: "2026-03-17T19:15:00.000Z",
    localStart: "Mar 17, 2026 3:15 PM",
    bookingUrl: "https://skiptheline.ncdot.gov/example"
  };

  const responses = [
    { slots: [slot], debug: { run: 1 } },
    { slots: [slot], debug: { run: 2 } },
    { slots: [], debug: { run: 3 } },
    { slots: [slot], debug: { run: 4 } }
  ];

  let index = 0;
  const provider = {
    async findAppointments() {
      const response = responses[index];
      index += 1;
      return response;
    }
  };

  const events = [];
  const notifiers = [
    {
      async send(event) {
        events.push(event);
      }
    }
  ];

  const config = {
    pollIntervalMs: 180000,
    watchers: [
      {
        id: "primary",
        active: true,
        officePreferences: {},
        datePreferences: {},
        timePreferences: {}
      }
    ]
  };

  const runStateStore = {
    async save(snapshot) {
      return snapshot;
    }
  };

  const runner = new MonitorRunner({ provider, store, notifiers, config, runStateStore });

  const run1 = await runner.runOnce();
  assert.equal(run1.results[0].freshSlots, 1);
  assert.equal(events.length, 1);

  const run2 = await runner.runOnce();
  assert.equal(run2.results[0].freshSlots, 0);
  assert.equal(events.length, 1);

  const run3 = await runner.runOnce();
  assert.equal(run3.results[0].freshSlots, 0);
  assert.equal(events.length, 1);

  const run4 = await runner.runOnce();
  assert.equal(run4.results[0].freshSlots, 1);
  assert.equal(events.length, 2);
});

test("MonitorRunner sends email only for consecutive 15-minute slots within 25 miles", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dmv-runner-email-"));
  const store = new StateStore(path.join(tempDir, "state.json"));
  await store.load();

  const slots = [
    {
      id: "cary-900",
      officeName: "Cary",
      officeAddress: "Cary DMV",
      distanceMiles: 18.42,
      startAt: "2026-03-17T13:00:00.000Z",
      localStart: "3/17/2026, 9:00:00 AM",
      bookingUrl: "https://skiptheline.ncdot.gov/example",
      serviceName: "Driver License - First Time"
    },
    {
      id: "cary-915",
      officeName: "Cary",
      officeAddress: "Cary DMV",
      distanceMiles: 18.42,
      startAt: "2026-03-17T13:15:00.000Z",
      localStart: "3/17/2026, 9:15:00 AM",
      bookingUrl: "https://skiptheline.ncdot.gov/example",
      serviceName: "Driver License - First Time"
    },
    {
      id: "wilson-900",
      officeName: "Wilson",
      officeAddress: "Wilson DMV",
      distanceMiles: 60.82,
      startAt: "2026-03-17T13:00:00.000Z",
      localStart: "3/17/2026, 9:00:00 AM",
      bookingUrl: "https://skiptheline.ncdot.gov/example",
      serviceName: "Driver License - First Time"
    },
    {
      id: "wilson-915",
      officeName: "Wilson",
      officeAddress: "Wilson DMV",
      distanceMiles: 60.82,
      startAt: "2026-03-17T13:15:00.000Z",
      localStart: "3/17/2026, 9:15:00 AM",
      bookingUrl: "https://skiptheline.ncdot.gov/example",
      serviceName: "Driver License - First Time"
    }
  ];

  let runIndex = 0;
  const provider = {
    async findAppointments() {
      runIndex += 1;
      if (runIndex === 1) {
        return { slots, debug: { run: 1 } };
      }
      return { slots: [], debug: { run: runIndex } };
    }
  };

  const slotEvents = [];
  const emailEvents = [];
  const notifiers = [
    {
      channel: "generic",
      async send(event) {
        slotEvents.push(event);
      }
    },
    {
      channel: "email",
      async send(event) {
        emailEvents.push(event);
      }
    }
  ];

  const config = {
    pollIntervalMs: 180000,
    alertPolicies: {
      emailConsecutiveSlots: {
        enabled: true,
        radiusMiles: 25,
        gapMinutes: 15,
        minConsecutiveSlots: 2
      }
    },
    watchers: [
      {
        id: "primary",
        active: true,
        officePreferences: {
          radiusMiles: 200
        },
        datePreferences: {},
        timePreferences: {}
      }
    ]
  };

  const runStateStore = {
    async save(snapshot) {
      return snapshot;
    }
  };

  const runner = new MonitorRunner({ provider, store, notifiers, config, runStateStore });
  const run1 = await runner.runOnce();

  assert.equal(run1.results[0].freshSlots, 4);
  assert.equal(run1.results[0].emailQualifiedSequences, 1);
  assert.equal(run1.results[0].freshEmailAlerts, 1);
  assert.equal(slotEvents.length, 4);
  assert.equal(emailEvents.length, 1);
  assert.equal(emailEvents[0].alertType, "consecutive-sequence");
  assert.equal(emailEvents[0].sequence.officeName, "Cary");
  assert.equal(emailEvents[0].sequence.slotCount, 2);

  const run2 = await runner.runOnce();
  assert.equal(run2.results[0].freshEmailAlerts, 0);
  assert.equal(emailEvents.length, 1);
});
