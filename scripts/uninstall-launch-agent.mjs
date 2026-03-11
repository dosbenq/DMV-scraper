import path from "node:path";

import { uninstallBackgroundPoller } from "../src/background/launch-agent.mjs";
import { DEFAULT_LABEL, getLaunchAgentPaths } from "./launch-agent-utils.mjs";

async function main() {
  const repoDir = process.cwd();
  const configPath = path.resolve(repoDir, process.argv[2] ?? "config.json");
  const label = process.argv[3] ?? process.env.DMV_MONITOR_LABEL ?? DEFAULT_LABEL;
  const paths = getLaunchAgentPaths({ repoDir, configPath, label });
  await uninstallBackgroundPoller({ repoDir, configPath, label });
  console.log(`Removed launch agent: ${paths.label}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
