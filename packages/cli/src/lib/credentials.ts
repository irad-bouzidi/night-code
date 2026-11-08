import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findAiProvider, PROVIDER_HEADER, PROVIDER_KEY_HEADER } from "@nightcode/shared";
import { getConfig } from "./config";

type StoredCredential = {
  apiKey: string;
  savedAt: string;
};

type CredentialsFile = Record<string, StoredCredential>;

const CREDENTIALS_DIR = join(homedir(), ".nightcode");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

function readCredentials(): CredentialsFile {
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as CredentialsFile) : {};
  } catch {
    return {};
  }
}

function writeCredentials(data: CredentialsFile) {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { mode: 0o700 });
  }
  // Owner-only permissions so other users on the machine can't read API keys.
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function getProviderKey(providerId: string): string | undefined {
  const apiKey = readCredentials()[providerId]?.apiKey;
  return typeof apiKey === "string" && apiKey.length > 0 ? apiKey : undefined;
}

export function setProviderKey(providerId: string, apiKey: string) {
  writeCredentials({
    ...readCredentials(),
    [providerId]: { apiKey, savedAt: new Date().toISOString() },
  });
}

export function deleteProviderKey(providerId: string) {
  const { [providerId]: _removed, ...rest } = readCredentials();
  writeCredentials(rest);
}

/** Masks a key for display, keeping only the last 4 characters. */
export function maskKey(apiKey: string) {
  if (apiKey.length <= 8) return "•".repeat(apiKey.length);
  return `${"•".repeat(8)}${apiKey.slice(-4)}`;
}

/** Headers telling the server which provider (and key) the active selection uses. */
export function getProviderHeaders(): Record<string, string> {
  const provider = findAiProvider(getConfig().provider);
  if (!provider) return {};

  const apiKey = getProviderKey(provider.id);
  return {
    [PROVIDER_HEADER]: provider.id,
    ...(apiKey ? { [PROVIDER_KEY_HEADER]: apiKey } : {}),
  };
}
