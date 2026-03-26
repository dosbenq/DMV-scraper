import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLabel, getLaunchAgentPaths } from "../scripts/launch-agent-utils.mjs";

test("validateLabel accepts valid labels", () => {
  const validLabels = [
    "com.example.app",
    "my-app",
    "app.v1.0",
    "123.456",
    "simple"
  ];

  for (const label of validLabels) {
    assert.doesNotThrow(() => validateLabel(label), `Should accept valid label: ${label}`);
  }
});

test("validateLabel rejects invalid labels", () => {
  const invalidLabels = [
    "app/../evil",
    "app; rm -rf /",
    "app&whoami",
    "app|ls",
    "app name",
    "app!",
    "app@example.com",
    "",
    " ",
    "\n",
    "\t"
  ];

  for (const label of invalidLabels) {
    assert.throws(() => validateLabel(label), {
      message: /Invalid label/
    }, `Should reject invalid label: ${label}`);
  }
});

test("getLaunchAgentPaths throws for invalid label", () => {
  const repoDir = "/tmp/repo";
  const configPath = "/tmp/config.json";

  assert.throws(() => {
    getLaunchAgentPaths({ repoDir, configPath, label: "invalid/label" });
  }, {
    message: /Invalid label/
  });
});

test("getLaunchAgentPaths works with valid label", () => {
  const repoDir = "/tmp/repo";
  const configPath = "/tmp/config.json";
  const label = "valid.label-123";

  const paths = getLaunchAgentPaths({ repoDir, configPath, label });
  assert.equal(paths.label, label);
});
