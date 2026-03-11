import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  getBackgroundPollerStatus,
  installBackgroundPoller,
  uninstallBackgroundPoller
} from "./background/launch-agent.mjs";
import { createRuntime } from "./core/runtime.mjs";
import { loadConfig, normalizeConfig, saveConfig } from "./core/config.mjs";
import { sendTestEmail } from "./core/notifiers.mjs";

const PUBLIC_DIR = path.resolve(process.cwd(), "src/web");

export async function startServer({ configPath, initialConfig }) {
  const initialRuntime = await createRuntime(configPath);
  const initialRunState = await initialRuntime.runStateStore.load();
  const state = {
    configPath,
    config: normalizeConfig(initialConfig),
    repoDir: process.cwd(),
    latestResults: initialRunState.latestResults,
    latestRunAt: initialRunState.latestRunAt,
    isRunning: false,
    runStateStore: initialRuntime.runStateStore,
    background: await getBackgroundPollerStatus({ repoDir: process.cwd(), configPath }),
    polling: {
      active: false,
      timer: null,
      startedAt: null
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/api/config") {
        await syncConfigState(state);
        return json(res, 200, { config: state.config });
      }

      if (req.method === "PUT" && url.pathname === "/api/config") {
        const body = await readJson(req);
        state.config = await saveConfig(state.configPath, body.config ?? body);
        state.background = await getBackgroundPollerStatus({ repoDir: state.repoDir, configPath: state.configPath });
        return json(res, 200, { ok: true, config: state.config });
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        await syncConfigState(state);
        state.background = await getBackgroundPollerStatus({ repoDir: state.repoDir, configPath: state.configPath });
        await syncRunState(state);
        return json(res, 200, publicStatus(state));
      }

      if (req.method === "GET" && url.pathname === "/api/service-options") {
        const runtime = await createRuntime(state.configPath);
        const services = await runtime.provider.listServiceOptions();
        return json(res, 200, { services });
      }

      if (req.method === "POST" && url.pathname === "/api/run-once") {
        if (state.isRunning) {
          return json(res, 409, { error: "A run is already in progress" });
        }

        await executeRun(state);
        return json(res, 200, publicStatus(state));
      }

      if (req.method === "POST" && url.pathname === "/api/polling/start") {
        state.config = normalizeConfig(await saveConfig(state.configPath, state.config));
        startPolling(state);
        return json(res, 200, publicStatus(state));
      }

      if (req.method === "POST" && url.pathname === "/api/polling/stop") {
        stopPolling(state);
        return json(res, 200, publicStatus(state));
      }

      if (req.method === "POST" && url.pathname === "/api/background/enable") {
        state.config = normalizeConfig(await saveConfig(state.configPath, state.config));
        state.background = await installBackgroundPoller({ repoDir: state.repoDir, configPath: state.configPath });
        return json(res, 200, publicStatus(state));
      }

      if (req.method === "POST" && url.pathname === "/api/background/disable") {
        state.background = await uninstallBackgroundPoller({ repoDir: state.repoDir, configPath: state.configPath });
        return json(res, 200, publicStatus(state));
      }

      if (req.method === "POST" && url.pathname === "/api/seen/reset") {
        await syncConfigState(state);
        const runtime = await createRuntime(state.configPath);
        const watcherId = state.config.watchers?.[0]?.id;
        runtime.store.clearWatcher(watcherId);
        await runtime.store.save();
        const emptySnapshot = await state.runStateStore.clear();
        state.latestResults = emptySnapshot.latestResults;
        state.latestRunAt = emptySnapshot.latestRunAt;
        return json(res, 200, publicStatus(state));
      }

      if (req.method === "POST" && url.pathname === "/api/test-email") {
        await syncConfigState(state);
        const runtime = await createRuntime(state.configPath);
        const watcher = state.config.watchers?.[0];
        const result = await sendTestEmail(runtime.notifiers, watcher, watcher?.email);
        if (result.attempted === 0) {
          return json(res, 400, { error: "No email notifier is enabled." });
        }
        if (result.failures.length > 0) {
          return json(res, 500, {
            error: result.failures.map((failure) => failure.reason?.message ?? String(failure.reason)).join("; ")
          });
        }
        return json(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/") {
        return sendFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
      }

      if (req.method === "GET" && url.pathname === "/app.js") {
        return sendFile(res, path.join(PUBLIC_DIR, "app.js"), "text/javascript; charset=utf-8");
      }

      if (req.method === "GET" && url.pathname === "/styles.css") {
        return sendFile(res, path.join(PUBLIC_DIR, "styles.css"), "text/css; charset=utf-8");
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  const port = Number(process.env.PORT ?? "3001");
  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`NC DMV monitor UI: http://localhost:${port}`);
}

async function executeRun(state) {
  state.isRunning = true;
  try {
    const runtime = await createRuntime(state.configPath);
    state.config = runtime.config;
    const snapshot = await runtime.runner.runOnce();
    state.latestResults = snapshot.results;
    state.latestRunAt = snapshot.latestRunAt;
    return snapshot;
  } finally {
    state.isRunning = false;
  }
}

async function syncRunState(state) {
  const snapshot = await state.runStateStore.load();
  state.latestResults = snapshot.latestResults;
  state.latestRunAt = snapshot.latestRunAt;
}

async function syncConfigState(state) {
  const { config } = await loadConfig(state.configPath);
  state.config = config;
}

function startPolling(state) {
  stopPolling(state);
  state.polling.active = true;
  state.polling.startedAt = new Date().toISOString();

  const loop = async () => {
    if (!state.polling.active || state.isRunning) {
      return;
    }
    await executeRun(state);
  };

  loop().catch((error) => {
    state.latestResults = [{ watcherId: "polling", error: error.message }];
  });

  state.polling.timer = setInterval(() => {
    loop().catch((error) => {
      state.latestResults = [{ watcherId: "polling", error: error.message }];
    });
  }, state.config.pollIntervalMs);
}

function stopPolling(state) {
  state.polling.active = false;
  state.polling.startedAt = null;
  if (state.polling.timer) {
    clearInterval(state.polling.timer);
    state.polling.timer = null;
  }
}

function publicStatus(state) {
  return {
    config: state.config,
    latestResults: state.latestResults,
    latestRunAt: state.latestRunAt,
    isRunning: state.isRunning,
    polling: {
      active: state.polling.active,
      startedAt: state.polling.startedAt
    },
    background: state.background
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function sendFile(res, filePath, contentType) {
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
