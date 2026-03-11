import { execFileSync } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

import { buildLaunchAgentPlist, DEFAULT_LABEL, getLaunchAgentPaths } from "../../scripts/launch-agent-utils.mjs";

export async function getBackgroundPollerStatus({ repoDir = process.cwd(), configPath, label = DEFAULT_LABEL } = {}) {
  if (process.platform !== "darwin") {
    return {
      supported: false,
      installed: false,
      running: false,
      label
    };
  }

  const paths = getLaunchAgentPaths({
    repoDir,
    configPath: path.resolve(repoDir, configPath ?? "config.json"),
    label
  });

  const installed = await fileExists(paths.plistPath);
  const running = installed ? isAgentRunning(paths) : false;

  return {
    supported: true,
    installed,
    running,
    label: paths.label,
    plistPath: paths.plistPath,
    stdoutLogPath: paths.stdoutLogPath,
    stderrLogPath: paths.stderrLogPath
  };
}

export async function installBackgroundPoller({ repoDir = process.cwd(), configPath, label = DEFAULT_LABEL } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("Background polling install is currently supported only on macOS.");
  }

  const paths = getLaunchAgentPaths({
    repoDir,
    configPath: path.resolve(repoDir, configPath ?? "config.json"),
    label
  });

  await mkdir(path.dirname(paths.plistPath), { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await writeFile(paths.plistPath, buildLaunchAgentPlist(paths));

  try {
    execFileSync("launchctl", ["bootout", paths.domainTarget, paths.plistPath], { stdio: "ignore" });
  } catch {
    // Ignore if not loaded yet.
  }

  execFileSync("launchctl", ["bootstrap", paths.domainTarget, paths.plistPath], { stdio: "ignore" });
  execFileSync("launchctl", ["kickstart", "-k", `${paths.domainTarget}/${paths.label}`], { stdio: "ignore" });

  return getBackgroundPollerStatus({ repoDir, configPath: paths.configPath, label });
}

export async function uninstallBackgroundPoller({ repoDir = process.cwd(), configPath, label = DEFAULT_LABEL } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("Background polling uninstall is currently supported only on macOS.");
  }

  const paths = getLaunchAgentPaths({
    repoDir,
    configPath: path.resolve(repoDir, configPath ?? "config.json"),
    label
  });

  try {
    execFileSync("launchctl", ["bootout", paths.domainTarget, paths.plistPath], { stdio: "ignore" });
  } catch {
    // Ignore if already unloaded.
  }

  await rm(paths.plistPath, { force: true });
  return getBackgroundPollerStatus({ repoDir, configPath: paths.configPath, label });
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isAgentRunning(paths) {
  try {
    execFileSync("launchctl", ["print", `${paths.domainTarget}/${paths.label}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
