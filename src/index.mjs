import { createRuntime } from "./core/runtime.mjs";
import { loadEnvFile } from "./lib/env.mjs";
import { startServer } from "./server.mjs";
import { sendTestEmail } from "./core/notifiers.mjs";

function getCommand() {
  return process.argv[2] ?? "run";
}

function getConfigPath() {
  const flagIndex = process.argv.indexOf("--config");
  return flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
}

async function main() {
  await loadEnvFile();
  const command = getCommand();
  const runtime = await createRuntime(getConfigPath());

  if (command === "debug:journey") {
    console.log(JSON.stringify(await runtime.provider.debugJourney(), null, 2));
    return;
  }

  if (command === "once") {
    console.log(JSON.stringify(await runtime.runner.runOnce(), null, 2));
    return;
  }

  if (command === "run") {
    await runtime.runner.runForever();
    return;
  }

  if (command === "test:email") {
    const watcher = runtime.config.watchers?.[0];
    const result = await sendTestEmail(runtime.notifiers, watcher, watcher?.email);
    if (result.attempted === 0) {
      throw new Error("No email notifier is enabled.");
    }
    if (result.failures.length > 0) {
      throw new Error(result.failures.map((failure) => failure.reason?.message ?? String(failure.reason)).join("; "));
    }
    console.log(JSON.stringify({ ok: true, recipient: watcher?.email }, null, 2));
    return;
  }

  if (command === "web") {
    await startServer({
      configPath: runtime.configPath,
      initialConfig: runtime.config
    });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
