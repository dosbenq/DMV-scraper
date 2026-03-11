import os from "node:os";
import path from "node:path";

export const DEFAULT_LABEL = "com.nc-dmv-appointment-monitor";

export function getLaunchAgentPaths({ repoDir, configPath, label = DEFAULT_LABEL }) {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const logsDir = path.resolve(repoDir, "logs");
  const plistPath = path.join(launchAgentsDir, `${label}.plist`);

  return {
    label,
    repoDir,
    configPath,
    logsDir,
    plistPath,
    stdoutLogPath: path.join(logsDir, "launchd.out.log"),
    stderrLogPath: path.join(logsDir, "launchd.err.log"),
    nodePath: process.execPath,
    entryPath: path.resolve(repoDir, "src/index.mjs"),
    domainTarget: `gui/${process.getuid()}`
  };
}

export function buildLaunchAgentPlist(paths) {
  const values = {
    label: xmlEscape(paths.label),
    nodePath: xmlEscape(paths.nodePath),
    entryPath: xmlEscape(paths.entryPath),
    configPath: xmlEscape(paths.configPath),
    repoDir: xmlEscape(paths.repoDir),
    stdoutLogPath: xmlEscape(paths.stdoutLogPath),
    stderrLogPath: xmlEscape(paths.stderrLogPath)
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${values.label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${values.nodePath}</string>
      <string>${values.entryPath}</string>
      <string>run</string>
      <string>--config</string>
      <string>${values.configPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${values.repoDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${values.stdoutLogPath}</string>
    <key>StandardErrorPath</key>
    <string>${values.stderrLogPath}</string>
  </dict>
</plist>
`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
