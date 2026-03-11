import { createNotifierFanout } from "./notifiers.mjs";
import { loadConfig } from "./config.mjs";
import { MonitorRunner } from "./runner.mjs";
import { RunStateStore } from "./run-state.mjs";
import { StateStore } from "./store.mjs";
import { NcDmvProvider } from "../providers/nc-dmv.mjs";

export async function createRuntime(configPath) {
  const { config, configPath: resolvedPath } = await loadConfig(configPath);
  const provider = new NcDmvProvider(config.provider);
  const store = new StateStore();
  await store.load();
  const runStateStore = new RunStateStore();
  const notifiers = createNotifierFanout(config.notifiers);
  const runner = new MonitorRunner({ provider, store, notifiers, config, runStateStore });

  return {
    config,
    configPath: resolvedPath,
    provider,
    runStateStore,
    store,
    notifiers,
    runner
  };
}
