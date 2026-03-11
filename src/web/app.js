const weekdayLabels = [
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
  ["Sun", 7]
];

const elements = {
  form: document.querySelector("#config-form"),
  save: document.querySelector("#save-config"),
  runOnce: document.querySelector("#run-once"),
  togglePolling: document.querySelector("#toggle-polling"),
  useLocation: document.querySelector("#use-location"),
  enableBrowserAlerts: document.querySelector("#enable-browser-alerts"),
  testEmail: document.querySelector("#test-email"),
  resetSeen: document.querySelector("#reset-seen"),
  formMessage: document.querySelector("#form-message"),
  weekdayGrid: document.querySelector("#weekday-grid"),
  backgroundStatus: document.querySelector("#background-status"),
  browserAlertStatus: document.querySelector("#browser-alert-status"),
  runStatus: document.querySelector("#run-status"),
  pollStatus: document.querySelector("#poll-status"),
  lastRun: document.querySelector("#last-run"),
  resultSummary: document.querySelector("#result-summary"),
  results: document.querySelector("#results"),
  resultTemplate: document.querySelector("#result-template"),
  searchPreview: document.querySelector("#search-preview"),
  summaryService: document.querySelector("#summary-service"),
  summaryArea: document.querySelector("#summary-area"),
  summaryWindow: document.querySelector("#summary-window"),
  summaryAlerts: document.querySelector("#summary-alerts"),
  toolbarSlotCount: document.querySelector("#toolbar-slot-count"),
  toolbarFilterSummary: document.querySelector("#toolbar-filter-summary"),
  slotSort: document.querySelector("#slot-sort"),
  slotSearch: document.querySelector("#slot-search"),
  newOnly: document.querySelector("#new-only"),
  showDiagnostics: document.querySelector("#show-diagnostics"),
  toggleBackground: document.querySelector("#toggle-background")
};

const LAST_SEEN_RUN_KEY = "dmv-monitor:last-seen-run-at";
const NOTIFIED_SLOT_CACHE_KEY = "dmv-monitor:notified-slot-cache-v1";

const defaultConfig = {
  pollIntervalMs: 180000,
  provider: {
    type: "nc-dmv",
    baseUrl: "https://skiptheline.ncdot.gov",
    journeyPath: "/Webapp/Appointment/Index/a7ade79b-996d-4971-8766-97feb75254de"
  },
  notifiers: {
    console: { enabled: true },
    appleMail: { enabled: false },
    resend: {
      enabled: false,
      apiKeyEnv: "RESEND_API_KEY",
      from: ""
    },
    webhook: {
      enabled: false,
      urlEnv: "APPOINTMENT_WEBHOOK_URL"
    }
  },
  watchers: []
};

let appState = {
  config: null,
  services: [],
  latestResults: [],
  latestRunAt: null,
  isRunning: false,
  background: { supported: false, installed: false, running: false },
  polling: { active: false }
};

const viewState = {
  formDirty: false,
  showValidation: false,
  pendingAction: null,
  flash: null,
  sort: "nearest",
  search: "",
  newOnly: false,
  showDiagnostics: false
};

buildWeekdayInputs();
wireEvents();
await loadServices();
await refreshStatus({ syncForm: true });
window.setInterval(() => {
  refreshStatus({ syncForm: !viewState.formDirty }).catch((error) => {
    setFlash("warning", error.message);
    render();
  });
}, 15000);

function buildWeekdayInputs() {
  for (const [label, value] of weekdayLabels) {
    const wrapper = document.createElement("label");
    wrapper.className = "weekday-chip";

    const span = document.createElement("span");
    span.textContent = label;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(value);
    input.name = "weekday";

    wrapper.append(span, input);
    elements.weekdayGrid.append(wrapper);
  }
}

function wireEvents() {
  elements.form.addEventListener("input", handleFormEdited);
  elements.form.addEventListener("change", handleFormEdited);

  elements.save.addEventListener("click", async () => {
    if (!ensureValidForm()) {
      return;
    }
    await saveConfig();
  });

  elements.runOnce.addEventListener("click", async () => {
    if (!ensureValidForm()) {
      return;
    }

    await saveConfig({ quiet: true });
    await performAction("run", async () => {
      const response = await fetch("/api/run-once", { method: "POST" });
      const status = await response.json();
      maybeDispatchBrowserNotifications(status);
      appState = {
        ...status,
        services: appState.services ?? []
      };
      setFlash("success", "Run complete. Latest openings are below.");
    });
  });

  elements.togglePolling.addEventListener("click", async () => {
    if (!ensureValidForm()) {
      return;
    }

    await saveConfig({ quiet: true });
    await performAction("polling", async () => {
      const endpoint = appState.polling.active ? "/api/polling/stop" : "/api/polling/start";
      const response = await fetch(endpoint, { method: "POST" });
      const status = await response.json();
      maybeDispatchBrowserNotifications(status);
      appState = {
        ...status,
        services: appState.services ?? []
      };
      setFlash("success", appState.polling.active ? "Session polling started." : "Session polling stopped.");
    });
  });

  elements.toggleBackground.addEventListener("click", async () => {
    if (!appState.background?.installed && !ensureValidForm()) {
      return;
    }

    if (!appState.background?.installed) {
      await saveConfig({ quiet: true });
    }
    await performAction("background", async () => {
      const endpoint = appState.background?.installed ? "/api/background/disable" : "/api/background/enable";
      const response = await fetch(endpoint, { method: "POST" });
      const status = await response.json();
      maybeDispatchBrowserNotifications(status);
      appState = {
        ...status,
        services: appState.services ?? []
      };
      setFlash(
        "success",
        appState.background?.installed
          ? "Background poller enabled. It will keep running at login."
          : "Background poller removed."
      );
    });
  });

  elements.enableBrowserAlerts.addEventListener("click", async () => {
    if (!supportsBrowserNotifications()) {
      setFlash("warning", browserNotificationUnavailableReason());
      render();
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setFlash("success", "Browser alerts enabled for this DMV monitor.");
      notifyTestBrowserAlert();
    } else if (permission === "denied") {
      setFlash("warning", "Browser alerts were blocked by the browser.");
    } else {
      setFlash("info", "Browser alert permission was dismissed.");
    }

    render();
  });

  elements.testEmail.addEventListener("click", async () => {
    await performAction("test-email", async () => {
      const response = await fetch("/api/test-email", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to send test email.");
      }
      setFlash("success", "Test email sent.");
    });
  });

  elements.resetSeen.addEventListener("click", async () => {
    await performAction("reset-seen", async () => {
      const response = await fetch("/api/seen/reset", { method: "POST" });
      const status = await response.json();
      appState = {
        ...status,
        services: appState.services ?? []
      };
      clearBrowserNotificationCache();
      setFlash("success", "Seen history cleared. The next Check Now will treat current openings as new.");
    });
  });

  elements.useLocation.addEventListener("click", async () => {
    if (!navigator.geolocation) {
      setFlash("warning", "Geolocation is not available in this browser.");
      render();
      return;
    }

    elements.useLocation.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue("latitude", position.coords.latitude);
        setValue("longitude", position.coords.longitude);
        viewState.formDirty = true;
        viewState.showValidation = false;
        setFlash("info", "Current coordinates inserted into the form.");
        elements.useLocation.disabled = false;
        render();
      },
      () => {
        setFlash("warning", "Unable to retrieve your location.");
        elements.useLocation.disabled = false;
        render();
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  elements.slotSort.addEventListener("change", () => {
    viewState.sort = elements.slotSort.value;
    render();
  });

  elements.slotSearch.addEventListener("input", () => {
    viewState.search = elements.slotSearch.value.trim();
    render();
  });

  elements.newOnly.addEventListener("change", () => {
    viewState.newOnly = elements.newOnly.checked;
    render();
  });

  elements.showDiagnostics.addEventListener("change", () => {
    viewState.showDiagnostics = elements.showDiagnostics.checked;
    render();
  });
}

function handleFormEdited(event) {
  if (!event.target.closest("#config-form")) {
    return;
  }

  viewState.formDirty = true;
  viewState.showValidation = false;
  if (viewState.flash?.tone === "success") {
    viewState.flash = null;
  }
  render();
}

async function refreshStatus({ syncForm = false } = {}) {
  const response = await fetch("/api/status");
  const status = await response.json();
  maybeDispatchBrowserNotifications(status);
  appState = {
    ...status,
    services: appState.services ?? []
  };
  render({ syncForm });
}

async function loadServices() {
  const response = await fetch("/api/service-options");
  const data = await response.json();
  appState.services = data.services ?? [];
  populateServiceOptions();
}

async function saveConfig({ quiet = false } = {}) {
  const config = formToConfig();
  await performAction("save", async () => {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config })
    });
    const data = await response.json();
    appState.config = data.config;
    viewState.formDirty = false;
    viewState.showValidation = false;
    if (!quiet) {
      setFlash("success", "Settings saved.");
    }
  });
}

async function performAction(actionName, task) {
  viewState.pendingAction = actionName;
  render();
  try {
    await task();
  } finally {
    viewState.pendingAction = null;
    render({ syncForm: !viewState.formDirty });
  }
}

function render({ syncForm = false } = {}) {
  populateServiceOptions();

  if (appState.config && (syncForm || !viewState.formDirty)) {
    fillForm(appState.config);
    viewState.formDirty = false;
  }

  const activeConfig = currentConfig();
  const watcher = activeConfig.watchers?.[0] ?? {};
  const totalOpen = (appState.latestResults ?? []).reduce((sum, item) => sum + (item.matchedSlots ?? 0), 0);
  const totalFresh = (appState.latestResults ?? []).reduce((sum, item) => sum + (item.freshSlots ?? 0), 0);

  elements.runStatus.textContent = appState.isRunning ? "Running" : "Idle";
  elements.pollStatus.textContent = appState.polling.active ? "Active" : "Stopped";
  elements.backgroundStatus.textContent = formatBackgroundStatus(appState.background);
  elements.browserAlertStatus.textContent = formatBrowserAlertStatus();
  elements.lastRun.textContent = appState.latestRunAt ? new Date(appState.latestRunAt).toLocaleString() : "Never";
  elements.resultSummary.textContent = appState.latestResults?.length
    ? `${totalOpen} open slot${totalOpen === 1 ? "" : "s"}, ${totalFresh} new`
    : "No runs yet";

  renderOverview(watcher, totalOpen, totalFresh, activeConfig);
  renderButtons();
  renderMessage(activeConfig);
  renderResults(appState.latestResults ?? []);
}

function renderOverview(watcher, totalOpen, totalFresh, config) {
  elements.summaryService.textContent = watcher.serviceName || "Not selected";
  elements.summaryArea.textContent = formatAreaSummary(watcher.officePreferences ?? {});
  elements.summaryWindow.textContent = formatScheduleSummary(watcher);
  elements.summaryAlerts.textContent = appState.latestResults?.length
    ? `${totalOpen} open / ${totalFresh} new`
    : "Run once to load availability";
  elements.searchPreview.textContent = formatSearchPreview(watcher, config);
}

function renderButtons() {
  const busy = Boolean(viewState.pendingAction);

  elements.save.disabled = busy;
  elements.runOnce.disabled = busy;
  elements.togglePolling.disabled = busy;
  elements.toggleBackground.disabled = busy || appState.background?.supported === false;
  elements.enableBrowserAlerts.disabled = busy || !supportsBrowserNotifications();
  elements.testEmail.disabled = busy;
  elements.resetSeen.disabled = busy;

  elements.save.textContent = viewState.pendingAction === "save" ? "Saving..." : "Save Settings";
  elements.runOnce.textContent = viewState.pendingAction === "run" ? "Checking..." : "Check Now";
  elements.resetSeen.textContent = viewState.pendingAction === "reset-seen" ? "Resetting..." : "Reset Seen State";
  elements.testEmail.textContent = viewState.pendingAction === "test-email" ? "Sending..." : "Send Test Email";

  if (appState.polling.active) {
    elements.togglePolling.textContent = viewState.pendingAction === "polling" ? "Updating..." : "Stop Session Polling";
  } else {
    elements.togglePolling.textContent = viewState.pendingAction === "polling" ? "Updating..." : "Start Session Polling";
  }

  if (appState.background?.supported === false) {
    elements.toggleBackground.textContent = "Background Poller Unavailable";
  } else if (appState.background?.installed) {
    elements.toggleBackground.textContent = viewState.pendingAction === "background" ? "Updating..." : "Disable Background Poller";
  } else {
    elements.toggleBackground.textContent = viewState.pendingAction === "background" ? "Updating..." : "Enable Background Poller";
  }

  if (!supportsBrowserNotifications()) {
    elements.enableBrowserAlerts.textContent = "Browser Alerts Unavailable";
  } else if (Notification.permission === "granted") {
    elements.enableBrowserAlerts.textContent = "Browser Alerts Enabled";
  } else if (Notification.permission === "denied") {
    elements.enableBrowserAlerts.textContent = "Browser Alerts Blocked";
  } else {
    elements.enableBrowserAlerts.textContent = "Enable Browser Alerts";
  }
}

function renderMessage(config) {
  const validation = viewState.showValidation ? validationMessage(config) : "";
  const message = validation || viewState.flash?.text || "";

  if (!message) {
    elements.formMessage.hidden = true;
    elements.formMessage.textContent = "";
    elements.formMessage.removeAttribute("data-tone");
    return;
  }

  elements.formMessage.hidden = false;
  elements.formMessage.textContent = message;
  elements.formMessage.dataset.tone = validation ? "warning" : viewState.flash?.tone ?? "info";
}

function renderResults(results) {
  elements.results.innerHTML = "";

  if (results.length === 0) {
    elements.results.append(buildEmptyState("No checks have been run yet.", "Save your settings, then click Check Now."));
    elements.toolbarSlotCount.textContent = "0 slots shown";
    elements.toolbarFilterSummary.textContent = summarizeToolbarState(0);
    return;
  }

  let totalShown = 0;
  let totalOfficesShown = 0;

  for (const result of results) {
    const visibleSlots = getVisibleSlots(result);
    const officeGroups = groupSlotsByOffice(visibleSlots, result.freshSlotIds ?? []);
    totalShown += visibleSlots.length;
    totalOfficesShown += officeGroups.length;

    const fragment = elements.resultTemplate.content.cloneNode(true);
    const heading = fragment.querySelector("h3");
    const meta = fragment.querySelector(".meta");
    const pill = fragment.querySelector(".pill");
    const banner = fragment.querySelector(".result-banner");
    const summaryGrid = fragment.querySelector(".summary-grid");
    const sectionStack = fragment.querySelector(".section-stack");

    heading.textContent = result.watcherId ?? "Watcher";

    if (result.error) {
      pill.textContent = "Error";
      pill.className = "pill pill-error";
      meta.textContent = result.error;
      banner.hidden = false;
      banner.textContent = result.error;
      sectionStack.append(buildEmptyState("This run failed.", "Fix the error above and run the monitor again."));
      elements.results.append(fragment);
      continue;
    }

    pill.textContent = `${officeGroups.length} office${officeGroups.length === 1 ? "" : "s"}`;
    pill.className = "pill";
    meta.textContent = `${result.matchedSlots ?? 0} open, ${result.freshSlots ?? 0} new, ${visibleSlots.length} visible slot${visibleSlots.length === 1 ? "" : "s"}`;

    const debug = result.debug ?? {};
    const summaryItems = [
      ["Selected Service", debug.service ?? "None"],
      ["Radius", formatDistanceRule(debug.officeFilter)],
      ["Active Offices", String((debug.activeOffices ?? []).length)],
      ["New Alerts", String(result.freshSlots ?? 0)]
    ];

    for (const [label, value] of summaryItems) {
      summaryGrid.append(buildSummaryItem(label, value));
    }

    sectionStack.append(buildOfficeSection("Closest Offices With Open Slots", officeGroups));

    if (viewState.showDiagnostics) {
      sectionStack.append(buildDiagnosticsDetails(debug));
    }

    elements.results.append(fragment);
  }

  elements.toolbarSlotCount.textContent = `${totalOfficesShown} office${totalOfficesShown === 1 ? "" : "s"}, ${totalShown} slot${totalShown === 1 ? "" : "s"} shown`;
  elements.toolbarFilterSummary.textContent = summarizeToolbarState(totalShown);
}

function buildSummaryItem(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "summary-item";

  const labelEl = document.createElement("span");
  labelEl.className = "summary-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "summary-value";
  valueEl.textContent = value;

  wrapper.append(labelEl, valueEl);
  return wrapper;
}

function buildOfficeSection(titleText, officeGroups) {
  const section = document.createElement("section");
  section.className = "result-section";

  const title = document.createElement("h4");
  title.textContent = titleText;
  section.append(title);

  if (!officeGroups || officeGroups.length === 0) {
    section.append(buildEmptyState("No slots match the current toolbar filters.", "Adjust the search box, sort, or New only toggle."));
    return section;
  }

  const list = document.createElement("div");
  list.className = "office-list";

  for (const office of officeGroups) {
    const item = document.createElement("article");
    item.className = "office-card";

    const head = document.createElement("div");
    head.className = "office-head";

    const titleWrap = document.createElement("div");
    const titleLine = document.createElement("p");
    titleLine.className = "office-title";
    titleLine.textContent = office.officeName;

    const subtitle = document.createElement("p");
    subtitle.className = "office-subtitle";
    subtitle.textContent = office.officeAddress || "Address unavailable";
    titleWrap.append(titleLine, subtitle);

    head.append(titleWrap);

    const badgeRow = document.createElement("div");
    badgeRow.className = "office-badges";
    badgeRow.append(
      buildTag(office.distanceLabel, true),
      buildTag(`${office.slots.length} time slot${office.slots.length === 1 ? "" : "s"}`, false)
    );

    if (office.freshCount > 0) {
      const badge = document.createElement("span");
      badge.className = "pill pill-new";
      badge.textContent = `${office.freshCount} new`;
      badgeRow.append(badge);
    }
    head.append(badgeRow);

    const dateGroups = document.createElement("div");
    dateGroups.className = "date-group-list";
    for (const dateGroup of office.dateGroups) {
      const dateBlock = document.createElement("section");
      dateBlock.className = "date-group";

      const dateHeading = document.createElement("p");
      dateHeading.className = "date-group-title";
      dateHeading.textContent = dateGroup.label;

      const times = document.createElement("div");
      times.className = "time-chip-list";
      for (const slot of dateGroup.slots) {
        const timeChip = document.createElement("span");
        timeChip.className = dateGroup.freshIds.has(slot.id) ? "time-chip time-chip-new" : "time-chip";
        timeChip.textContent = formatTimeLabel(slot.startAt);
        times.append(timeChip);
      }

      dateBlock.append(dateHeading, times);
      dateGroups.append(dateBlock);
    }

    const link = document.createElement("a");
    link.className = "slot-link";
    link.href = office.bookingUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open booking page";

    const actions = document.createElement("div");
    actions.className = "office-actions";
    const earliest = document.createElement("span");
    earliest.className = "slot-address";
    earliest.textContent = `Soonest opening: ${formatOfficeEarliestLabel(office.earliestStartAt)}`;

    actions.append(earliest, link);
    item.append(head, dateGroups, actions);
    list.append(item);
  }

  section.append(list);
  return section;
}

function buildTag(text, emphasis) {
  const tag = document.createElement("span");
  tag.className = emphasis ? "slot-tag slot-tag-emphasis" : "slot-tag";
  tag.textContent = text;
  return tag;
}

function groupSlotsByOffice(slots, freshSlotIds) {
  const freshSet = new Set(freshSlotIds ?? []);
  const groups = new Map();

  for (const slot of slots) {
    const key = `${slot.officeName}::${slot.officeAddress ?? ""}`;
    const existing = groups.get(key) ?? {
      officeName: slot.officeName,
      officeAddress: slot.officeAddress,
      distanceMiles: slot.distanceMiles ?? null,
      distanceLabel: slot.distanceMiles != null ? `${slot.distanceMiles} mi away` : "Distance unavailable",
      bookingUrl: slot.bookingUrl,
      earliestStartAt: slot.startAt,
      freshCount: 0,
      slots: []
    };

    existing.slots.push(slot);
    if (freshSet.has(slot.id)) {
      existing.freshCount += 1;
    }
    if (new Date(slot.startAt).getTime() < new Date(existing.earliestStartAt).getTime()) {
      existing.earliestStartAt = slot.startAt;
    }
    if (existing.distanceMiles == null && slot.distanceMiles != null) {
      existing.distanceMiles = slot.distanceMiles;
      existing.distanceLabel = `${slot.distanceMiles} mi away`;
    }
    groups.set(key, existing);
  }

  const sortedGroups = [...groups.values()].sort((left, right) => compareOfficeGroups(left, right, viewState.sort));
  return sortedGroups.map((group) => ({
    ...group,
    slots: group.slots.sort((left, right) => compareDates(left, right) || compareDistances(left, right)),
    dateGroups: groupSlotsByDate(group.slots, freshSet)
  }));
}

function groupSlotsByDate(slots, freshSet) {
  const groups = new Map();

  for (const slot of slots) {
    const key = formatDateKey(slot.startAt);
    const existing = groups.get(key) ?? {
      key,
      label: formatDateLabel(slot.startAt),
      slots: [],
      freshIds: new Set()
    };
    existing.slots.push(slot);
    if (freshSet.has(slot.id)) {
      existing.freshIds.add(slot.id);
    }
    groups.set(key, existing);
  }

  return [...groups.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((group) => ({
      ...group,
      slots: group.slots.sort((left, right) => compareDates(left, right))
    }));
}

function compareOfficeGroups(left, right, sortMode) {
  if (sortMode === "office") {
    return compareGroupNames(left, right) || compareGroupDates(left, right) || compareGroupDistances(left, right);
  }

  if (sortMode === "soonest") {
    return compareGroupDates(left, right) || compareGroupDistances(left, right) || compareGroupNames(left, right);
  }

  return compareGroupDistances(left, right) || compareGroupDates(left, right) || compareGroupNames(left, right);
}

function compareGroupDates(left, right) {
  return new Date(left.earliestStartAt).getTime() - new Date(right.earliestStartAt).getTime();
}

function compareGroupDistances(left, right) {
  const leftDistance = left.distanceMiles ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.distanceMiles ?? Number.POSITIVE_INFINITY;
  return leftDistance - rightDistance;
}

function compareGroupNames(left, right) {
  return left.officeName.localeCompare(right.officeName);
}

function buildDiagnosticsDetails(debug = {}) {
  const details = document.createElement("details");
  details.className = "result-section debug-card";

  const summary = document.createElement("summary");
  summary.textContent = "DMV site diagnostics";
  details.append(summary);

  const stack = document.createElement("div");
  stack.className = "section-stack";
  stack.append(
    buildListSection("Nearby Offices", formatNearbyOffices(debug.nearestOffices)),
    buildListSection("Active Offices", debug.activeOffices ?? []),
    buildListSection("Hidden By Distance Or Exclusions", formatFilteredOffices(debug.filteredOutActiveOffices)),
    buildListSection("All Active Offices Before Filtering", debug.discoveredActiveOffices ?? [])
  );

  if ((debug.notes ?? []).length > 0) {
    stack.append(buildListSection("Notes", debug.notes));
  }

  details.append(stack);
  return details;
}

function buildListSection(titleText, items) {
  const section = document.createElement("section");
  section.className = "result-section";

  const title = document.createElement("h4");
  title.textContent = titleText;
  section.append(title);

  if (!items || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "result-empty";
    empty.textContent = "None";
    section.append(empty);
    return section;
  }

  const list = document.createElement("ul");
  list.className = titleText === "Notes" ? "note-list" : "result-list";

  for (const itemText of items) {
    const item = document.createElement("li");
    item.textContent = itemText;
    list.append(item);
  }

  section.append(list);
  return section;
}

function buildEmptyState(titleText, detailText) {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";

  const title = document.createElement("strong");
  title.textContent = titleText;

  const detail = document.createElement("p");
  detail.className = "result-empty";
  detail.textContent = detailText;

  wrapper.append(title, detail);
  return wrapper;
}

function getVisibleSlots(result) {
  const slots = [...(result.slots ?? [])];
  const freshSet = new Set(result.freshSlotIds ?? []);
  const query = viewState.search.toLowerCase();

  const filtered = slots.filter((slot) => {
    if (viewState.newOnly && !freshSet.has(slot.id)) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [slot.officeName, slot.officeAddress, slot.localStart].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  filtered.sort((left, right) => compareSlots(left, right, viewState.sort));
  return filtered;
}

function compareSlots(left, right, sortMode) {
  if (sortMode === "nearest") {
    return compareDistances(left, right) || compareDates(left, right) || compareOffices(left, right);
  }

  if (sortMode === "office") {
    return compareOffices(left, right) || compareDates(left, right) || compareDistances(left, right);
  }

  return compareDates(left, right) || compareDistances(left, right) || compareOffices(left, right);
}

function compareDates(left, right) {
  return new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
}

function compareDistances(left, right) {
  const leftDistance = left.distanceMiles ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.distanceMiles ?? Number.POSITIVE_INFINITY;
  return leftDistance - rightDistance;
}

function compareOffices(left, right) {
  return left.officeName.localeCompare(right.officeName);
}

function formatDateKey(startAt) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(startAt));
}

function formatDateLabel(startAt) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(startAt));
}

function formatTimeLabel(startAt) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(startAt));
}

function formatOfficeEarliestLabel(startAt) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(startAt));
}

function populateServiceOptions() {
  const select = document.querySelector("#serviceName");
  const currentValue = select.value;
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a DMV service";
  select.append(placeholder);

  for (const service of appState.services ?? []) {
    const option = document.createElement("option");
    option.value = service;
    option.textContent = service;
    select.append(option);
  }

  if (currentValue) {
    select.value = currentValue;
  }
}

function fillForm(config) {
  const watcher = config.watchers?.[0] ?? {};
  const office = watcher.officePreferences ?? {};
  const date = watcher.datePreferences ?? {};
  const time = watcher.timePreferences ?? {};
  const appleMail = config.notifiers?.appleMail ?? {};
  const resend = config.notifiers?.resend ?? {};
  const webhook = config.notifiers?.webhook ?? {};

  setValue("pollIntervalMs", config.pollIntervalMs ?? "");
  setValue("watcherId", watcher.id ?? "default-search");
  setValue("serviceName", watcher.serviceName ?? "");
  setValue("officeExclude", (office.exclude ?? []).join(", "));
  setValue("anchorZip", office.anchorZip ?? "");
  setValue("radiusMiles", office.radiusMiles ?? "");
  setValue("latitude", office.latitude ?? "");
  setValue("longitude", office.longitude ?? "");
  setValue("dateFrom", date.from ?? "");
  setValue("dateTo", date.to ?? "");
  setValue("timeStart", time.start ?? "");
  setValue("timeEnd", time.end ?? "");
  setChecked("appleMailEnabled", appleMail.enabled ?? false);
  setChecked("resendEnabled", resend.enabled ?? false);
  setValue("resendFrom", resend.from ?? "");
  setChecked("webhookEnabled", webhook.enabled ?? false);

  const selectedDays = new Set((date.daysOfWeek ?? []).map(String));
  for (const input of elements.weekdayGrid.querySelectorAll('input[name="weekday"]')) {
    input.checked = selectedDays.has(input.value);
  }
}

function formToConfig() {
  const baseConfig = appState.config ?? defaultConfig;
  const watcher = baseConfig.watchers?.[0] ?? {};

  return {
    ...baseConfig,
    pollIntervalMs: Number(getValue("pollIntervalMs") || 180000),
    watchers: [
      {
        ...watcher,
        id: getValue("watcherId").trim() || "default-search",
        active: true,
        email: "aditya.aggarwal5598@gmail.com",
        serviceName: getValue("serviceName").trim(),
        serviceKeywords: [],
        officePreferences: {
          exclude: splitList(getValue("officeExclude")),
          anchorZip: getValue("anchorZip").trim(),
          radiusMiles: getValue("radiusMiles") ? Number(getValue("radiusMiles")) : null,
          latitude: getValue("latitude") ? Number(getValue("latitude")) : null,
          longitude: getValue("longitude") ? Number(getValue("longitude")) : null
        },
        datePreferences: {
          ...(watcher.datePreferences ?? {}),
          from: getValue("dateFrom"),
          to: getValue("dateTo"),
          daysOfWeek: [...elements.weekdayGrid.querySelectorAll('input[name="weekday"]:checked')].map((input) =>
            Number(input.value)
          )
        },
        timePreferences: {
          ...(watcher.timePreferences ?? {}),
          start: getValue("timeStart"),
          end: getValue("timeEnd")
        }
      }
    ],
    notifiers: {
      ...(baseConfig.notifiers ?? {}),
      appleMail: {
        ...(baseConfig.notifiers?.appleMail ?? {}),
        enabled: getChecked("appleMailEnabled")
      },
      resend: {
        ...(baseConfig.notifiers?.resend ?? {}),
        enabled: getChecked("resendEnabled"),
        from: getValue("resendFrom").trim()
      },
      webhook: {
        ...(baseConfig.notifiers?.webhook ?? {}),
        enabled: getChecked("webhookEnabled")
      }
    }
  };
}

function currentConfig() {
  if (viewState.formDirty) {
    return formToConfig();
  }
  return appState.config ?? defaultConfig;
}

function ensureValidForm() {
  const config = formToConfig();
  const message = validationMessage(config);
  viewState.showValidation = Boolean(message);
  if (message) {
    render();
    window.alert(message);
    return false;
  }
  return true;
}

function validationMessage(config) {
  const watcher = config.watchers?.[0] ?? {};
  if (!watcher.serviceName?.trim()) {
    return "Select a DMV service before saving or running the monitor.";
  }
  return "";
}

function setFlash(tone, text) {
  viewState.flash = text ? { tone, text } : null;
}

function formatBackgroundStatus(background = {}) {
  if (background.supported === false) {
    return "Unavailable";
  }
  if (background.running) {
    return "Running at login";
  }
  if (background.installed) {
    return "Installed";
  }
  return "Not installed";
}

function supportsBrowserNotifications() {
  return typeof window !== "undefined" && "Notification" in window && window.isSecureContext;
}

function browserNotificationUnavailableReason() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "This browser does not support desktop notifications.";
  }
  if (!window.isSecureContext) {
    return "Browser notifications require localhost or HTTPS.";
  }
  return "Browser notifications are unavailable.";
}

function formatBrowserAlertStatus() {
  if (!supportsBrowserNotifications()) {
    return "Unavailable";
  }
  if (Notification.permission === "granted") {
    return "Enabled";
  }
  if (Notification.permission === "denied") {
    return "Blocked";
  }
  return "Not enabled";
}

function maybeDispatchBrowserNotifications(status) {
  const latestRunAt = status?.latestRunAt;
  if (!latestRunAt) {
    return;
  }

  const lastSeenRunAt = localStorage.getItem(LAST_SEEN_RUN_KEY);
  const isNewRun = latestRunAt !== lastSeenRunAt;

  if (isNewRun && supportsBrowserNotifications() && Notification.permission === "granted") {
    const cache = loadNotificationCache();
    for (const slot of collectFreshNotificationSlots(status)) {
      const cacheKey = `${latestRunAt}::${slot.id}`;
      if (cache.includes(cacheKey)) {
        continue;
      }

      dispatchBrowserNotification(slot);
      cache.push(cacheKey);
    }
    saveNotificationCache(cache);
  }

  localStorage.setItem(LAST_SEEN_RUN_KEY, latestRunAt);
}

function collectFreshNotificationSlots(status) {
  const slots = [];

  for (const result of status.latestResults ?? []) {
    const freshSet = new Set(result.freshSlotIds ?? []);
    for (const slot of result.slots ?? []) {
      if (freshSet.has(slot.id)) {
        slots.push(slot);
      }
    }
  }

  return slots;
}

function dispatchBrowserNotification(slot) {
  const body = [slot.officeName, slot.localStart, slot.distanceMiles != null ? `${slot.distanceMiles} mi away` : null]
    .filter(Boolean)
    .join(" • ");

  const notification = new Notification("New NC DMV opening", {
    body,
    tag: `slot-${slot.id}`
  });

  notification.onclick = () => {
    window.focus();
    window.open(slot.bookingUrl, "_blank", "noopener,noreferrer");
    notification.close();
  };
}

function notifyTestBrowserAlert() {
  if (!supportsBrowserNotifications() || Notification.permission !== "granted") {
    return;
  }

  const notification = new Notification("Browser alerts are enabled", {
    body: "This DMV monitor tab will alert you when a new opening appears."
  });

  window.setTimeout(() => notification.close(), 4000);
}

function loadNotificationCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTIFIED_SLOT_CACHE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(-200) : [];
  } catch {
    return [];
  }
}

function saveNotificationCache(cache) {
  localStorage.setItem(NOTIFIED_SLOT_CACHE_KEY, JSON.stringify(cache.slice(-200)));
}

function clearBrowserNotificationCache() {
  localStorage.removeItem(LAST_SEEN_RUN_KEY);
  localStorage.removeItem(NOTIFIED_SLOT_CACHE_KEY);
}

function formatAreaSummary(officePreferences) {
  const radius = officePreferences.radiusMiles != null ? `${officePreferences.radiusMiles} mi` : "No limit";
  const anchor = formatAnchor(officePreferences);
  return `${radius}${anchor ? ` from ${anchor}` : ""}`;
}

function formatAnchor(officePreferences) {
  if (officePreferences.latitude != null && officePreferences.longitude != null) {
    return `${Number(officePreferences.latitude).toFixed(4)}, ${Number(officePreferences.longitude).toFixed(4)}`;
  }

  if (officePreferences.anchorZip) {
    return `ZIP ${officePreferences.anchorZip}`;
  }

  return "";
}

function formatScheduleSummary(watcher) {
  const weekdayText = formatWeekdays(watcher.datePreferences?.daysOfWeek ?? []);
  const timeText = formatTimeWindow(watcher.timePreferences ?? {});
  return `${weekdayText}, ${timeText}`;
}

function formatSearchPreview(watcher, config) {
  const service = watcher.serviceName || "No service selected";
  const area = formatAreaSummary(watcher.officePreferences ?? {});
  const dates = formatDateRange(watcher.datePreferences ?? {});
  const timeText = formatTimeWindow(watcher.timePreferences ?? {});
  const notifications = formatNotificationSummary(config, watcher);

  return `${service}. ${area}. ${dates}. ${timeText}. ${notifications}.`;
}

function formatDateRange(datePreferences) {
  if (datePreferences.from && datePreferences.to) {
    return `Dates ${datePreferences.from} to ${datePreferences.to}`;
  }
  if (datePreferences.from) {
    return `Starting ${datePreferences.from}`;
  }
  if (datePreferences.to) {
    return `Up to ${datePreferences.to}`;
  }
  return "Any date";
}

function formatTimeWindow(timePreferences) {
  const start = timePreferences.start || "";
  const end = timePreferences.end || "";

  if (start && end) {
    return `${start} to ${end}`;
  }
  if (start) {
    return `After ${start}`;
  }
  if (end) {
    return `Before ${end}`;
  }
  return "Any time";
}

function formatWeekdays(days) {
  if (!days || days.length === 0) {
    return "Any weekday";
  }

  const labels = weekdayLabels.filter(([, value]) => days.includes(value)).map(([label]) => label);
  if (labels.length === 7) {
    return "Every day";
  }
  return labels.join(", ");
}

function formatNotificationSummary(config, watcher) {
  const parts = [];
  if (config.notifiers?.appleMail?.enabled && watcher.email) {
    parts.push(`Mail app email to ${watcher.email}`);
  }
  if (config.notifiers?.resend?.enabled && watcher.email) {
    parts.push(`Email to ${watcher.email}`);
  }
  if (config.notifiers?.webhook?.enabled) {
    parts.push("Webhook enabled");
  }
  if (config.notifiers?.console?.enabled ?? true) {
    parts.push("Console logging on");
  }
  return parts.join(", ") || "No notifier enabled";
}

function summarizeToolbarState(totalShown) {
  const labels = [sortLabel(viewState.sort)];
  if (viewState.newOnly) {
    labels.push("new only");
  }
  if (viewState.search) {
    labels.push(`matching "${viewState.search}"`);
  }

  if (totalShown === 0) {
    labels.push("no visible slots");
  }

  return labels.join(" · ");
}

function sortLabel(sort) {
  if (sort === "nearest") {
    return "Closest offices first";
  }
  if (sort === "office") {
    return "Office A-Z";
  }
  return "Soonest first";
}

function formatDistanceRule(filter = {}) {
  return filter.radiusMiles != null ? `${filter.radiusMiles} mi` : "No limit";
}

function formatNearbyOffices(offices = []) {
  return offices.map((office) => {
    const state = office.active ? "active" : "inactive";
    return `${office.name} (${office.distanceMiles} mi, ${state})`;
  });
}

function formatFilteredOffices(offices = []) {
  return offices.map((office) => `${office.name}${office.distanceMiles != null ? ` (${office.distanceMiles} mi)` : ""}`);
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getValue(id) {
  return document.getElementById(id).value;
}

function setValue(id, value) {
  document.getElementById(id).value = value ?? "";
}

function getChecked(id) {
  return document.getElementById(id).checked;
}

function setChecked(id, checked) {
  document.getElementById(id).checked = Boolean(checked);
}
