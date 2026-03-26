import test from "node:test";
import assert from "node:assert/strict";

import { normalizeConfig } from "../src/core/config.mjs";
import { DEFAULT_ALERT_EMAIL } from "../src/core/defaults.mjs";

test("normalizeConfig applies default top-level values", () => {
  const config = {};
  const normalized = normalizeConfig(config);

  assert.equal(normalized.pollIntervalMs, 180000);
  assert.deepEqual(normalized.provider, {
    type: "nc-dmv",
    baseUrl: "https://skiptheline.ncdot.gov",
    journeyPath: "/Webapp/Appointment/Index/a7ade79b-996d-4971-8766-97feb75254de"
  });
  assert.deepEqual(normalized.alertPolicies.emailConsecutiveSlots, {
    enabled: true,
    radiusMiles: 25,
    gapMinutes: 15,
    minConsecutiveSlots: 2
  });
  assert.equal(normalized.notifiers.console.enabled, true);
  assert.equal(normalized.notifiers.appleMail.enabled, false);
  assert.equal(normalized.notifiers.resend.enabled, false);
  assert.equal(normalized.notifiers.resend.apiKeyEnv, "RESEND_API_KEY");
  assert.equal(normalized.notifiers.webhook.enabled, false);
  assert.equal(normalized.notifiers.webhook.urlEnv, "APPOINTMENT_WEBHOOK_URL");
  assert.deepEqual(normalized.watchers, []);
});

test("normalizeConfig merges custom values with defaults", () => {
  const config = {
    pollIntervalMs: 60000,
    provider: {
      type: "custom-type"
    }
  };
  const normalized = normalizeConfig(config);

  assert.equal(normalized.pollIntervalMs, 60000);
  assert.equal(normalized.provider.type, "custom-type");
  assert.equal(normalized.provider.baseUrl, "https://skiptheline.ncdot.gov");
  assert.equal(normalized.notifiers.console.enabled, true);
});

test("normalizeConfig performs a deep clone and does not mutate input", () => {
  const config = {
    provider: { type: "test" },
    watchers: [{ active: true }]
  };
  const normalized = normalizeConfig(config);

  assert.notEqual(normalized, config);
  assert.notEqual(normalized.provider, config.provider);
  assert.notEqual(normalized.watchers[0], config.watchers[0]);

  normalized.pollIntervalMs = 0;
  assert.equal(config.pollIntervalMs, undefined);
});

test("normalizeConfig normalizes watchers", () => {
  const config = {
    watchers: [
      {
        officePreferences: {
          include: ["Raleigh"],
          exclude: ["Durham"]
        }
      }
    ]
  };
  const normalized = normalizeConfig(config);
  const watcher = normalized.watchers[0];

  assert.match(watcher.id, /^watcher-[a-z0-9]+$/);
  assert.equal(watcher.active, true);
  assert.equal(watcher.email, DEFAULT_ALERT_EMAIL);
  assert.strictEqual(watcher.officePreferences.include, undefined);
  assert.deepEqual(watcher.officePreferences.exclude, ["Durham"]);
  assert.equal(watcher.officePreferences.anchorZip, "");
  assert.equal(watcher.datePreferences.from, "");
  assert.deepEqual(watcher.datePreferences.daysOfWeek, []);
  assert.equal(watcher.timePreferences.start, "");
});

test("normalizeConfig preserves existing watcher id and active state", () => {
  const config = {
    watchers: [
      {
        id: "my-id",
        active: false
      }
    ]
  };
  const normalized = normalizeConfig(config);
  const watcher = normalized.watchers[0];

  assert.equal(watcher.id, "my-id");
  assert.equal(watcher.active, false);
});
