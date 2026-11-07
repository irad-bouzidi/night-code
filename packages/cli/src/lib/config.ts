import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type ConfigData = {
  /** Active AI provider id (see AI_PROVIDERS in @nightcode/shared). */
  provider?: string;
  /** Last model picked for each provider, keyed by provider id. */
  models?: Record<string, string>;
};

const CONFIG_DIR = join(homedir(), ".nightcode");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfig(): ConfigData {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as ConfigData) : {};
  } catch {
    return {};
  }
}

export function updateConfig(patch: Partial<ConfigData>) {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { mode: 0o700 });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...getConfig(), ...patch }, null, 2), { mode: 0o600 });
  } catch {
    // Persisting preferences is best-effort.
  }
}

export function getSavedModel(providerId: string): string | undefined {
  return getConfig().models?.[providerId];
}

export function saveModel(providerId: string, model: string) {
  updateConfig({ models: { ...getConfig().models, [providerId]: model } });
}
