import path from "node:path";

import { installBackgroundPoller } from "../src/background/launch-agent.mjs";
import { DEFAULT_LABEL } from "./launch-agent-utils.mjs";

async function main() {
  const repoDir = process.cwd();
  const configPath = path.resolve(repoDir, process.argv[2] ?? "config.json");
  const label = process.argv[3] ?? process.env.DMV_MONITOR_LABEL ?? DEFAULT_LABEL;
  const status = await installBackgroundPoller({ repoDir, configPath, label });

  console.log(`Installed launch agent: ${status.label}`);
  console.log(`Config: ${configPath}`);
  console.log(`Logs: ${status.stdoutLogPath}`);
  console.log(`Errors: ${status.stderrLogPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
