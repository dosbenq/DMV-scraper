import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_RUN_STATE = {
  latestResults: [],
  latestRunAt: null
};

export class RunStateStore {
  constructor(filePath = path.resolve(process.cwd(), "data/latest-run.json")) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        ...EMPTY_RUN_STATE,
        ...parsed,
        latestResults: Array.isArray(parsed.latestResults) ? parsed.latestResults : []
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { ...EMPTY_RUN_STATE };
      }
      throw error;
    }
  }

  async save(snapshot) {
    const normalized = {
      latestResults: Array.isArray(snapshot?.latestResults) ? snapshot.latestResults : [],
      latestRunAt: snapshot?.latestRunAt ?? null
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(normalized, null, 2));
    return normalized;
  }

  async clear() {
    return this.save(EMPTY_RUN_STATE);
  }
}
