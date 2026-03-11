import { DEFAULT_ALERT_EMAIL } from "./defaults.mjs";
import { slotMatchesWatcher } from "./matcher.mjs";

function compareSlots(left, right) {
  const startDiff = new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
  if (startDiff !== 0) {
    return startDiff;
  }

  const leftDistance = left.distanceMiles ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.distanceMiles ?? Number.POSITIVE_INFINITY;
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  return left.officeName.localeCompare(right.officeName);
}

export class MonitorRunner {
  constructor({ provider, store, notifiers, config, runStateStore }) {
    this.provider = provider;
    this.store = store;
    this.notifiers = notifiers;
    this.config = config;
    this.runStateStore = runStateStore;
  }

  async runOnce() {
    const results = [];
    const slotNotifiers = this.notifiers.filter((notifier) => notifier.channel !== "email");
    const emailNotifiers = this.notifiers.filter((notifier) => notifier.channel === "email");

    for (const watcher of this.config.watchers) {
      if (!watcher.active) {
        continue;
      }

      try {
        const { slots, debug } = await this.provider.findAppointments(watcher);
        const matched = slots.filter((slot) => slotMatchesWatcher(slot, watcher)).sort(compareSlots);
        const emailPolicy = this.config.alertPolicies?.emailConsecutiveSlots;
        const emailEligible = emailPolicy?.enabled
          ? slots.filter((slot) => slotMatchesWatcher(slot, buildEmailPolicyWatcher(watcher, emailPolicy))).sort(compareSlots)
          : [];
        const emailSequences = emailPolicy?.enabled
          ? buildConsecutiveEmailSequences(emailEligible, emailPolicy)
          : [];
        const existingOpenNotifications = this.store.getWatcherState(watcher.id);
        const nextOpenNotifications = {};
        const fresh = matched.filter((slot) => !this.store.hasOpenNotification(watcher.id, slot.id));
        const existingEmailAlerts = this.store.getWatcherEmailAlerts(watcher.id);
        const nextEmailAlerts = {};
        const freshEmailSequences = emailSequences.filter((sequence) => !this.store.hasEmailAlert(watcher.id, sequence.id));

        for (const slot of matched) {
          const previous = existingOpenNotifications[slot.id];
          if (previous) {
            nextOpenNotifications[slot.id] = {
              ...previous,
              officeName: slot.officeName,
              startAt: slot.startAt,
              distanceMiles: slot.distanceMiles ?? previous.distanceMiles ?? null
            };
          }
        }

        for (const slot of fresh) {
          const event = { watcher, email: watcher.email || DEFAULT_ALERT_EMAIL, slot, debug };
          const outcomes = await Promise.allSettled(slotNotifiers.map((notifier) => notifier.send(event)));
          const failures = outcomes.filter((outcome) => outcome.status === "rejected");
          if (failures.length === 0) {
            this.store.markOpenNotified(watcher.id, slot.id, {
              officeName: slot.officeName,
              startAt: slot.startAt,
              distanceMiles: slot.distanceMiles ?? null
            });
            nextOpenNotifications[slot.id] = this.store.getWatcherState(watcher.id)[slot.id];
          }
        }

        this.store.replaceWatcher(watcher.id, nextOpenNotifications);

        for (const sequence of emailSequences) {
          const previous = existingEmailAlerts[sequence.id];
          if (previous) {
            nextEmailAlerts[sequence.id] = {
              ...previous,
              officeName: sequence.officeName,
              startAt: sequence.startAt,
              slotIds: sequence.slotIds,
              slotCount: sequence.slotCount
            };
          }
        }

        if (emailNotifiers.length > 0) {
          for (const sequence of freshEmailSequences) {
            const event = {
              alertType: "consecutive-sequence",
              watcher,
              email: watcher.email || DEFAULT_ALERT_EMAIL,
              sequence,
              slots: sequence.slots,
              debug,
              rule: emailPolicy
            };
            const outcomes = await Promise.allSettled(emailNotifiers.map((notifier) => notifier.send(event)));
            const failures = outcomes.filter((outcome) => outcome.status === "rejected");
            if (failures.length === 0) {
              this.store.markEmailAlert(watcher.id, sequence.id, {
                officeName: sequence.officeName,
                startAt: sequence.startAt,
                slotIds: sequence.slotIds,
                slotCount: sequence.slotCount
              });
              nextEmailAlerts[sequence.id] = this.store.getWatcherEmailAlerts(watcher.id)[sequence.id];
            }
          }
        }

        this.store.replaceWatcherEmailAlerts(watcher.id, nextEmailAlerts);

        results.push({
          watcherId: watcher.id,
          totalSlots: slots.length,
          matchedSlots: matched.length,
          freshSlots: fresh.length,
          freshSlotIds: fresh.map((slot) => slot.id),
          emailQualifiedSequences: emailSequences.length,
          freshEmailAlerts: freshEmailSequences.length,
          slots: matched,
          debug
        });
      } catch (error) {
        results.push({
          watcherId: watcher.id,
          error: error.message
        });
      }
    }

    await this.store.save();
    const latestRunAt = new Date().toISOString();
    if (this.runStateStore) {
      await this.runStateStore.save({
        latestResults: results,
        latestRunAt
      });
    }

    return {
      results,
      latestRunAt
    };
  }

  async runForever() {
    for (;;) {
      const startedAt = Date.now();
      const { results, latestRunAt } = await this.runOnce();
      console.log(JSON.stringify({ type: "poll-result", latestRunAt, results }, null, 2));
      const elapsed = Date.now() - startedAt;
      const sleepMs = Math.max(1000, this.config.pollIntervalMs - elapsed);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }
}

function buildEmailPolicyWatcher(watcher, policy) {
  return {
    ...watcher,
    officePreferences: {
      ...(watcher.officePreferences ?? {}),
      radiusMiles: policy?.radiusMiles ?? 25
    }
  };
}

function buildConsecutiveEmailSequences(slots, policy) {
  const groups = new Map();
  const gapMinutes = Number(policy?.gapMinutes ?? 15);
  const minConsecutiveSlots = Number(policy?.minConsecutiveSlots ?? 2);

  for (const slot of slots) {
    if (slot.distanceMiles == null || slot.distanceMiles > (policy?.radiusMiles ?? 25)) {
      continue;
    }

    const key = `${slot.officeName}::${slot.officeAddress ?? ""}::${formatLocalDateKey(slot.startAt)}`;
    const existing = groups.get(key) ?? [];
    existing.push(slot);
    groups.set(key, existing);
  }

  const sequences = [];

  for (const officeSlots of groups.values()) {
    const sorted = [...officeSlots].sort(compareSlots);
    let current = [];

    for (const slot of sorted) {
      if (current.length === 0) {
        current = [slot];
        continue;
      }

      const previous = current[current.length - 1];
      if (minutesBetween(previous.startAt, slot.startAt) === gapMinutes) {
        current.push(slot);
        continue;
      }

      if (current.length >= minConsecutiveSlots) {
        sequences.push(buildSequence(current));
      }
      current = [slot];
    }

    if (current.length >= minConsecutiveSlots) {
      sequences.push(buildSequence(current));
    }
  }

  return sequences.sort((left, right) => compareSlots(left.slots[0], right.slots[0]));
}

function buildSequence(slots) {
  const first = slots[0];
  const last = slots[slots.length - 1];
  return {
    id: `${first.serviceName}::${first.officeName}::${slots.map((slot) => slot.id).join("::")}`,
    officeName: first.officeName,
    officeAddress: first.officeAddress,
    serviceName: first.serviceName,
    distanceMiles: first.distanceMiles,
    bookingUrl: first.bookingUrl,
    startAt: first.startAt,
    endAt: last.startAt,
    slotCount: slots.length,
    slotIds: slots.map((slot) => slot.id),
    slots
  };
}

function formatLocalDateKey(startAt) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(startAt));
}

function minutesBetween(leftStartAt, rightStartAt) {
  return Math.round((new Date(rightStartAt).getTime() - new Date(leftStartAt).getTime()) / 60000);
}
