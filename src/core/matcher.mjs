import { dateWithinRange, parseTimeToMinutes, weekdayNumber } from "../lib/time.mjs";

function includesNormalized(haystack, needle) {
  return String(haystack ?? "").toLowerCase().includes(String(needle ?? "").toLowerCase());
}

export function slotMatchesWatcher(slot, watcher) {
  if (!watcher.active) {
    return false;
  }

  const officePreferences = watcher.officePreferences ?? {};
  const excludes = officePreferences.exclude ?? [];
  const weekdays = watcher.datePreferences?.daysOfWeek ?? [];

  if (excludes.some((item) => includesNormalized(slot.officeName, item) || includesNormalized(slot.officeAddress, item))) {
    return false;
  }

  if (officePreferences.radiusMiles != null && slot.distanceMiles != null && slot.distanceMiles > officePreferences.radiusMiles) {
    return false;
  }

  if (!dateWithinRange(slot.startAt, watcher.datePreferences?.from, watcher.datePreferences?.to)) {
    return false;
  }

  if (weekdays.length > 0 && !weekdays.includes(weekdayNumber(slot.startAt))) {
    return false;
  }

  const windowStart = parseTimeToMinutes(watcher.timePreferences?.start);
  const windowEnd = parseTimeToMinutes(watcher.timePreferences?.end);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(slot.startAt));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const slotMinutes = hour * 60 + minute;
  if (windowStart != null && slotMinutes < windowStart) {
    return false;
  }
  if (windowEnd != null && slotMinutes > windowEnd) {
    return false;
  }

  return true;
}
