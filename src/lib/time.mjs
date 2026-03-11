export function toIsoDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
}

export function parseTimeToMinutes(value) {
  if (!value) {
    return null;
  }

  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function zonedDateTimeToUtc({ year, month, day, hour, minute, second = 0, timeZone }) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = timezoneOffsetMinutes(guess, timeZone);
    const adjusted = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000);
    if (adjusted.getTime() === guess.getTime()) {
      return adjusted;
    }
    guess = adjusted;
  }

  return guess;
}

function timezoneOffsetMinutes(date, timeZone) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  const match = value?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

export function weekdayNumber(dateLike) {
  const date = new Date(dateLike);
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

export function dateWithinRange(dateLike, from, to) {
  const day = toIsoDate(dateLike);
  if (from && day < toIsoDate(from)) {
    return false;
  }
  if (to && day > toIsoDate(to)) {
    return false;
  }
  return true;
}
