import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_ALERT_EMAIL } from "./defaults.mjs";

const DEFAULT_CONFIG_FILE = "config.json";
const DEFAULT_PROVIDER = {
  type: "nc-dmv",
  baseUrl: "https://skiptheline.ncdot.gov",
  journeyPath: "/Webapp/Appointment/Index/a7ade79b-996d-4971-8766-97feb75254de"
};
const DEFAULT_EMAIL_POLICY = {
  enabled: true,
  radiusMiles: 25,
  gapMinutes: 15,
  minConsecutiveSlots: 2
};

export async function loadConfig(explicitPath) {
  const configPath = path.resolve(process.cwd(), explicitPath ?? DEFAULT_CONFIG_FILE);
  const raw = await readFile(configPath, "utf8");
  const parsed = normalizeConfig(JSON.parse(raw));

  return { config: parsed, configPath };
}

export async function saveConfig(configPath, config) {
  const normalized = normalizeConfig(config);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(normalized, null, 2));
  return normalized;
}

export function normalizeConfig(config) {
  const normalized = structuredClone(config);
  normalized.pollIntervalMs ??= 180000;
  normalized.provider = {
    ...DEFAULT_PROVIDER,
    ...(normalized.provider ?? {})
  };
  normalized.alertPolicies ??= {};
  normalized.alertPolicies.emailConsecutiveSlots = {
    ...DEFAULT_EMAIL_POLICY,
    ...(normalized.alertPolicies.emailConsecutiveSlots ?? {})
  };
  normalized.notifiers ??= {};
  normalized.notifiers.console ??= { enabled: true };
  normalized.notifiers.appleMail = {
    enabled: false,
    ...(normalized.notifiers.appleMail ?? {})
  };
  normalized.notifiers.resend = {
    enabled: false,
    apiKeyEnv: "RESEND_API_KEY",
    from: "",
    ...(normalized.notifiers.resend ?? {})
  };
  normalized.notifiers.webhook = {
    enabled: false,
    urlEnv: "APPOINTMENT_WEBHOOK_URL",
    ...(normalized.notifiers.webhook ?? {})
  };
  normalized.watchers ??= [];
  normalized.watchers = normalized.watchers.map(normalizeWatcher);
  return normalized;
}

function normalizeWatcher(watcher) {
  const normalized = structuredClone(watcher);
  normalized.id ??= `watcher-${Math.random().toString(36).slice(2, 8)}`;
  normalized.active ??= true;
  normalized.email = DEFAULT_ALERT_EMAIL;
  normalized.serviceName ??= "";
  normalized.serviceKeywords ??= [];
  normalized.officePreferences ??= {};
  delete normalized.officePreferences.include;
  normalized.officePreferences.exclude ??= [];
  normalized.officePreferences.anchorZip ??= "";
  normalized.officePreferences.radiusMiles ??= null;
  normalized.officePreferences.latitude ??= null;
  normalized.officePreferences.longitude ??= null;
  normalized.datePreferences ??= {};
  normalized.datePreferences.from ??= "";
  normalized.datePreferences.to ??= "";
  normalized.datePreferences.daysOfWeek ??= [];
  normalized.timePreferences ??= {};
  normalized.timePreferences.start ??= "";
  normalized.timePreferences.end ??= "";
  return normalized;
}
