import { JourneySession } from "./journey-session.mjs";
import { zonedDateTimeToUtc } from "../lib/time.mjs";

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function includesNormalized(haystack, needle) {
  return normalize(haystack).toLowerCase().includes(normalize(needle).toLowerCase());
}

function parseQflowItems(html) {
  const items = [];
  const officeRegex =
    /<div class="QflowObjectItem form-control ui-selectable([^"]*)"[^>]*data-id="([^"]+)"[^>]*>\s*<div title="([^"]*)"><div>([^<]+)<\/div>(?:<div class="No-Availability"[^>]*>[\s\S]*?<\/div>)?(?:<div class="form-control-child">([\s\S]*?)<\/div>)?(?:<div class="(?:disabled-unitDistance|unitDistance|Enabled-unit)">([\s\S]*?)<\/div>)?<\/div><\/div>/gi;
  const serviceRegex =
    /<div class="QflowObjectItem form-control ui-selectable([^"]*)"[^>]*data-id="([^"]+)"[^>]*>\s*<div class="hover-div" title="([^"]*)">([\s\S]*?)<\/div><\/div>/gi;

  for (const match of html.matchAll(officeRegex)) {
    const classes = normalize(match[1]);
    items.push({
      id: match[2],
      classes,
      active: classes.includes("Active-Unit"),
      title: normalize(match[3]),
      label: normalize(match[4]),
      address: normalize(match[5]),
      distanceText: normalize(match[6])
    });
  }

  for (const match of html.matchAll(serviceRegex)) {
    const classes = normalize(match[1]);
    const label = normalize(match[4].split("<br/>")[0]);

    items.push({
      id: match[2],
      classes,
      active: classes.includes("Active-Unit"),
      title: normalize(match[3]),
      label,
      address: "",
      distanceText: ""
    });
  }

  return dedupeItems(items);
}

function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

function extractDates(html) {
  const list = html.match(/var Dates = \[([^\]]*)\]/);
  if (!list) {
    return [];
  }

  return [...list[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function extractTimeOptions(html) {
  return [...html.matchAll(/<option[^>]*data-serviceid="([^"]*)"[^>]*data-datetime="([^"]*)"[^>]*data-appointmenttypeid="([^"]*)"[^>]*>([^<]*)<\/option>/gi)]
    .map((match) => ({
      serviceId: match[1],
      dateTime: match[2],
      appointmentTypeId: match[3],
      label: normalize(match[4])
    }))
    .filter((option) => option.dateTime);
}

function parseDateTime(value) {
  const match = normalize(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[4]) % 12;
  if (match[7].toUpperCase() === "PM") {
    hour += 12;
  }

  return zonedDateTimeToUtc({
    year: Number(match[3]),
    month: Number(match[1]),
    day: Number(match[2]),
    hour,
    minute: Number(match[5]),
    second: Number(match[6]),
    timeZone: "America/New_York"
  });
}

function officeDistanceMiles(office) {
  const match = office.distanceText.match(/([\d.]+)\s*(?:mi|miles)/i);
  return match ? Number(match[1]) : null;
}

function groupStepControls(step) {
  const groups = new Map();

  for (const input of step.inputs) {
    const match = input.name.match(/^StepControls\[(\d+)\]\.(.+)$/);
    if (!match) {
      continue;
    }

    const index = match[1];
    const field = match[2];
    const group = groups.get(index) ?? { controlIndex: Number(index) };
    group[field] = input.value;
    groups.set(index, group);
  }

  return [...groups.values()];
}

function controlValueFieldName(control) {
  if (control?.controlIndex == null) {
    return null;
  }
  return `StepControls[${control.controlIndex}].Model.Value`;
}

function controlValueFieldPrefix(control) {
  if (control?.controlIndex == null) {
    return null;
  }
  return `StepControls[${control.controlIndex}].Model.Value`;
}

function serviceMatchesWatcher(service, watcher) {
  if (watcher.serviceName && normalize(service.label) === normalize(watcher.serviceName)) {
    return true;
  }

  const keywords = watcher.serviceKeywords ?? [];
  return keywords.length === 0 || keywords.every((keyword) => includesNormalized(service.label, keyword));
}

function pickService(services, watcher) {
  if (watcher.serviceName) {
    const exact = services.find((service) => normalize(service.label) === normalize(watcher.serviceName));
    if (exact) {
      return exact;
    }

    return null;
  }

  const keywords = watcher.serviceKeywords ?? [];
  if (keywords.length > 0) {
    const ranked = services
      .map((service) => ({
        service,
        score: keywords.reduce((score, keyword) => score + (includesNormalized(service.label, keyword) ? 1 : 0), 0)
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    if (ranked.length > 0) {
      return ranked[0].service;
    }
  }

  return null;
}

function officeMatchesWatcher(office, watcher) {
  const exclude = watcher.officePreferences?.exclude ?? [];
  const radiusMiles = watcher.officePreferences?.radiusMiles;

  if (exclude.some((value) => includesNormalized(office.label, value) || includesNormalized(office.address, value))) {
    return false;
  }

  if (radiusMiles != null) {
    const distanceMiles = officeDistanceMiles(office);
    if (distanceMiles != null && distanceMiles > radiusMiles) {
      return false;
    }
  }

  return true;
}

function buildSlot(office, service, option, bookingUrl) {
  const start = parseDateTime(option.dateTime);
  if (!start) {
    return null;
  }

  return {
    id: [
      service.label,
      office.id,
      option.dateTime,
      option.serviceId,
      option.appointmentTypeId
    ].join("::"),
    provider: "nc-dmv",
    serviceName: service.label,
    officeName: office.label,
    officeAddress: office.address,
    distanceMiles: officeDistanceMiles(office),
    startAt: start.toISOString(),
    localStart: start.toLocaleString("en-US", { timeZone: "America/New_York" }),
    bookingUrl,
    metadata: {
      officeId: office.id,
      serviceId: option.serviceId,
      appointmentTypeId: option.appointmentTypeId
    }
  };
}

export class NcDmvProvider {
  constructor(config) {
    this.config = config;
  }

  createSession() {
    return new JourneySession({
      baseUrl: this.config.baseUrl,
      path: this.config.journeyPath
    });
  }

  async debugJourney() {
    const session = this.createSession();
    await session.get();
    await session.submit({ includeSubmitValue: "Make an Appointment" });

    return {
      history: session.history,
      current: session.summarizeCurrentStep(),
      parsedItems: parseQflowItems(session.currentStep.rawHtml)
    };
  }

  async listServiceOptions() {
    const session = this.createSession();
    await session.get();
    await session.submit({ includeSubmitValue: "Make an Appointment" });
    return parseQflowItems(session.currentStep.rawHtml).map((item) => item.label);
  }

  async findAppointments(watcher) {
    const session = this.createSession();
    await session.get();
    await session.submit({ includeSubmitValue: "Make an Appointment" });

    const services = parseQflowItems(session.currentStep.rawHtml);
    const service = pickService(services, watcher);

    if (!service) {
      return {
        slots: [],
        debug: {
          history: session.history,
          availableServices: services.map((item) => item.label),
          reason: watcher.serviceName
            ? `Requested service not found: ${watcher.serviceName}`
            : "No DMV service selected"
        }
      };
    }

    const serviceStepControls = groupStepControls(session.currentStep);
    const serviceControl = serviceStepControls.find((group) => group.FieldName === "AppointmentType");
    const locationControl = serviceStepControls.find((group) => group.FieldName === "GeoLocation");
    const serviceValueField = controlValueFieldName(serviceControl) ?? "StepControls[0].Model.Value";
    const locationPrefix = controlValueFieldPrefix(locationControl) ?? "StepControls[2].Model.Value";

    await session.submit({
      overrides: {
        [serviceValueField]: service.id,
        [`${locationPrefix}.Latitude`]: watcher.officePreferences?.latitude ?? "",
        [`${locationPrefix}.Longitude`]: watcher.officePreferences?.longitude ?? ""
      },
      includeSubmitValue: "Next"
    });

    let locationStep = session.currentStep;
    const locationControls = groupStepControls(locationStep);
    const zipControl = locationControls.find((group) => group.FieldName === "ZipCodeSearch");
    const officeControl = locationControls.find((group) => group.FieldName === "UnitIdList");

    if (watcher.officePreferences?.anchorZip && zipControl && officeControl) {
      const zipHtml = await session.amendStep({
        sourceControlId: zipControl.StepControlId,
        targetControlId: officeControl.StepControlId,
        overrides: {
          "StepControls[1].Model.Value": watcher.officePreferences.anchorZip
        }
      });
      locationStep = {
        ...locationStep,
        rawHtml: zipHtml
      };
    }

    const allLocationOffices = parseQflowItems(locationStep.rawHtml);
    const nearestOffices = allLocationOffices
      .map((office) => ({
        office,
        distanceMiles: officeDistanceMiles(office)
      }))
      .filter((item) => item.distanceMiles != null)
      .sort((left, right) => left.distanceMiles - right.distanceMiles)
      .slice(0, 12)
      .map((item) => ({
        name: item.office.label,
        distanceMiles: item.distanceMiles,
        active: item.office.active
      }));
    const discoveredActiveOffices = allLocationOffices.filter((office) => office.active);
    const offices = discoveredActiveOffices.filter((office) => officeMatchesWatcher(office, watcher));
    const filteredOutActiveOffices = discoveredActiveOffices
      .filter((office) => !officeMatchesWatcher(office, watcher))
      .map((office) => ({
        name: office.label,
        distanceMiles: officeDistanceMiles(office)
      }));

    const slots = [];

    for (const office of offices) {
      const officeSession = this.createSession();
      await officeSession.get();
      await officeSession.submit({ includeSubmitValue: "Make an Appointment" });
      const officeServiceStepControls = groupStepControls(officeSession.currentStep);
      const officeServiceControl = officeServiceStepControls.find((group) => group.FieldName === "AppointmentType");
      const officeLocationControl = officeServiceStepControls.find((group) => group.FieldName === "GeoLocation");
      const officeServiceValueField = controlValueFieldName(officeServiceControl) ?? "StepControls[0].Model.Value";
      const officeLocationPrefix = controlValueFieldPrefix(officeLocationControl) ?? "StepControls[2].Model.Value";
      await officeSession.submit({
        overrides: {
          [officeServiceValueField]: service.id,
          [`${officeLocationPrefix}.Latitude`]: watcher.officePreferences?.latitude ?? "",
          [`${officeLocationPrefix}.Longitude`]: watcher.officePreferences?.longitude ?? ""
        },
        includeSubmitValue: "Next"
      });
      const officeLocationStepControls = groupStepControls(officeSession.currentStep);
      const unitControl = officeLocationStepControls.find((group) => group.FieldName === "UnitIdList");
      const officeValueField = controlValueFieldName(unitControl) ?? "StepControls[3].Model.Value";
      await officeSession.submit({
        overrides: { [officeValueField]: office.id },
        includeSubmitValue: "Next"
      });

      const dateTimeControls = groupStepControls(officeSession.currentStep);
      const dateControl = dateTimeControls.find((group) => group.FieldName === "AppointmentDate");
      const timeControl = dateTimeControls.find((group) => group.FieldName === "AppointmentTime");

      if (!dateControl || !timeControl) {
        continue;
      }

      const dates = extractDates(officeSession.currentStep.rawHtml);

      for (const date of dates) {
        const dateValueField = controlValueFieldName(dateControl) ?? "StepControls[2].Model.Value";
        const timeHtml = await officeSession.amendStep({
          sourceControlId: dateControl.StepControlId,
          targetControlId: timeControl.StepControlId,
          overrides: {
            [dateValueField]: date
          }
        });

        for (const option of extractTimeOptions(timeHtml)) {
          const bookingLink = "https://skiptheline.ncdot.gov/Webapp/Appointment/Index/a7ceb24a-7bc5-40b5-a8fa-c3dc92a2a466";
          const slot = buildSlot(office, service, option, bookingLink);
          if (slot) {
            slots.push(slot);
          }
        }
      }
    }

      return {
      slots,
      debug: {
        history: session.history,
        service: service.label,
        availableServices: services.map((item) => item.label),
        officeFilter: {
          exclude: watcher.officePreferences?.exclude ?? [],
          radiusMiles: watcher.officePreferences?.radiusMiles ?? null
        },
        notes: [
          "nearestOffices is only a preview of the closest offices returned by the DMV site, not the full list within the configured radius.",
          "discoveredActiveOffices shows offices with live availability before your distance and exclusion filters are applied."
        ],
        nearestOffices,
        discoveredActiveOffices: discoveredActiveOffices.map((office) => office.label),
        filteredOutActiveOffices,
        activeOffices: offices.map((office) => office.label)
      }
    };
  }
}
