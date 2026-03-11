import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_VERSION = 3;

function emptyState() {
  return {
    version: STORE_VERSION,
    openNotified: {},
    emailAlerts: {}
  };
}

export class StateStore {
  constructor(filePath = path.resolve(process.cwd(), "data/state.json")) {
    this.filePath = filePath;
    this.state = emptyState();
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed?.version === STORE_VERSION &&
        isRecord(parsed.openNotified) &&
        isRecord(parsed.emailAlerts)
      ) {
        this.state = {
          version: STORE_VERSION,
          openNotified: parsed.openNotified,
          emailAlerts: parsed.emailAlerts
        };
        return;
      }

      if (parsed?.version === 2 && isRecord(parsed.openNotified)) {
        this.state = {
          version: STORE_VERSION,
          openNotified: parsed.openNotified,
          emailAlerts: {}
        };
        return;
      }

      // Legacy files stored lifetime dedupe, which would suppress alerts forever.
      // Reset them when upgrading to edge-triggered notifications.
      this.state = emptyState();
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  getWatcherState(watcherId) {
    if (!watcherId) {
      return {};
    }
    return this.state.openNotified?.[watcherId] ?? {};
  }

  getWatcherEmailAlerts(watcherId) {
    if (!watcherId) {
      return {};
    }
    return this.state.emailAlerts?.[watcherId] ?? {};
  }

  hasOpenNotification(watcherId, slotId) {
    return Boolean(this.getWatcherState(watcherId)?.[slotId]);
  }

  markOpenNotified(watcherId, slotId, metadata) {
    this.state.openNotified[watcherId] ??= {};
    const previous = this.state.openNotified[watcherId][slotId] ?? {};
    this.state.openNotified[watcherId][slotId] = {
      ...previous,
      notifiedAt: previous.notifiedAt ?? new Date().toISOString(),
      ...metadata
    };
  }

  hasEmailAlert(watcherId, alertId) {
    return Boolean(this.getWatcherEmailAlerts(watcherId)?.[alertId]);
  }

  markEmailAlert(watcherId, alertId, metadata) {
    this.state.emailAlerts[watcherId] ??= {};
    const previous = this.state.emailAlerts[watcherId][alertId] ?? {};
    this.state.emailAlerts[watcherId][alertId] = {
      ...previous,
      notifiedAt: previous.notifiedAt ?? new Date().toISOString(),
      ...metadata
    };
  }

  replaceWatcher(watcherId, nextState) {
    if (!watcherId) {
      return;
    }

    if (!nextState || Object.keys(nextState).length === 0) {
      delete this.state.openNotified?.[watcherId];
      return;
    }

    this.state.openNotified[watcherId] = nextState;
  }

  replaceWatcherEmailAlerts(watcherId, nextState) {
    if (!watcherId) {
      return;
    }

    if (!nextState || Object.keys(nextState).length === 0) {
      delete this.state.emailAlerts?.[watcherId];
      return;
    }

    this.state.emailAlerts[watcherId] = nextState;
  }

  clearWatcher(watcherId) {
    if (!watcherId) {
      return;
    }
    delete this.state.openNotified?.[watcherId];
    delete this.state.emailAlerts?.[watcherId];
  }

  clearAll() {
    this.state = emptyState();
  }

  async save() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2));
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
