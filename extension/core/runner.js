import { slotMatchesWatcher } from "./matcher.js";

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

function minutesBetween(leftStartAt, rightStartAt) {
  return Math.round((new Date(rightStartAt).getTime() - new Date(leftStartAt).getTime()) / 60000);
}

function formatLocalDateKey(startAt) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(startAt));
}

function buildSequence(slots) {
  const first = slots[0];
  const last = slots[slots.length - 1];
  return {
    id: `email-seq::${first.serviceName}::${first.officeName}::${first.id}`,
    officeName: first.officeName,
    officeAddress: first.officeAddress,
    serviceName: first.serviceName,
    distanceMiles: first.distanceMiles,
    bookingUrl: first.bookingUrl,
    startAt: first.startAt,
    endAt: last.startAt,
    count: slots.length,
    slotIds: slots.map((slot) => slot.id),
    slots
  };
}

function buildConsecutiveSequences(slots, policy) {
  const groups = new Map();
  const gaps = Array.isArray(policy?.gapMinutes)
    ? policy.gapMinutes.map(Number)
    : [Number(policy?.gapMinutes ?? 15)];
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
      const gap = minutesBetween(previous.startAt, slot.startAt);
      if (gaps.includes(gap)) {
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

export class ExtensionRunner {
  constructor({ provider }) {
    this.provider = provider;
  }

  async runOnce(watcher, policy) {
    const { slots } = await this.provider.findAppointments(watcher);
    const matched = slots.filter((slot) => slotMatchesWatcher(slot, watcher)).sort(compareSlots);
    
    // Group booking sequences
    const sequences = policy?.enabled
      ? buildConsecutiveSequences(slots.filter(s => slotMatchesWatcher(s, { ...watcher, officePreferences: { ...watcher.officePreferences, radiusMiles: policy.radiusMiles } })), policy)
      : [];

    // Get notified state from storage
    const state = await chrome.storage.local.get(["notifiedSlots", "notifiedSequences"]);
    const notifiedSlots = state.notifiedSlots || {};
    const notifiedSequences = state.notifiedSequences || {};

    const freshSlots = matched.filter(slot => !notifiedSlots[slot.id]);
    const freshSequences = sequences.filter(seq => !notifiedSequences[seq.id]);

    // Handle fresh slots
    for (const slot of freshSlots) {
      chrome.notifications.create(slot.id, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "New DMV Slot Found",
        message: `${slot.officeName}: ${slot.localStart} (${slot.distanceMiles?.toFixed(1)} miles)`,
        priority: 2
      });
      notifiedSlots[slot.id] = { at: new Date().toISOString(), office: slot.officeName, start: slot.localStart };
    }

    // Handle fresh sequences
    for (const seq of freshSequences) {
      chrome.notifications.create(seq.id, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Group Booking Found!",
        message: `${seq.count} consecutive slots at ${seq.officeName} starting ${seq.slots[0].localStart}`,
        priority: 2
      });
      notifiedSequences[seq.id] = { at: new Date().toISOString(), office: seq.officeName, count: seq.count };
    }

    // Persist state
    await chrome.storage.local.set({ notifiedSlots, notifiedSequences });

    return {
      totalFound: slots.length,
      matchedCount: matched.length,
      sequenceCount: sequences.length,
      freshSlots: freshSlots.length,
      freshSequences: freshSequences.length
    };
  }
}
