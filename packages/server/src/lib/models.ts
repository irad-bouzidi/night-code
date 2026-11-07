import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  findAiProvider,
  PROVIDER_HEADER,
  PROVIDER_KEY_HEADER,
  type AiProvider,
} from "@nightcode/shared";
import type { LanguageModel } from "ai";

const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/** The provider and API key a request asked for, via headers set by the CLI. */
export type ProviderContext = {
  provider: AiProvider;
  apiKey: string | undefined;
};

type HeaderReader = (name: string) => string | undefined;

export function getProviderContext(
  header: HeaderReader,
): { ok: true; context: ProviderContext } | { ok: false; error: string } {
  const providerId = header(PROVIDER_HEADER);
  const provider = findAiProvider(providerId);

  if (!provider) {
    return {
      ok: false,
      error: providerId
        ? `Unknown provider "${providerId}". Run /provider to pick one.`
        : "No AI provider selected. Run /provider to pick one.",
    };
  }

  const apiKey = header(PROVIDER_KEY_HEADER)?.trim() || undefined;
  return { ok: true, context: { provider, apiKey } };
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

type ProviderModel = {
  id?: unknown;
  // OpenRouter lists the request parameters each model accepts.
  supported_parameters?: unknown;
};

function supportsTools(model: ProviderModel) {
  // Providers that don't report capabilities here are filtered elsewhere or trusted as-is.
  if (!Array.isArray(model.supported_parameters)) return true;
  return model.supported_parameters.includes("tools");
}

/**
 * Ollama's OpenAI-compatible `/v1/models` has no capability info, but its native
 * `/api/tags` reports `capabilities` (e.g. "tools"). Returns the tool-capable model
 * names, or null when the endpoint isn't Ollama or doesn't report capabilities.
 */
async function fetchOllamaToolModels({ provider, apiKey }: ProviderContext): Promise<Set<string> | null> {
  if (!/\/v1$/.test(provider.baseURL)) return null;

  try {
    const response = await fetch(`${provider.baseURL.replace(/\/v1$/, "")}/api/tags`, {
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      models?: { name?: unknown; model?: unknown; capabilities?: unknown }[];
    };
    const models = body.models ?? [];
    if (models.length === 0 || !models.some((m) => Array.isArray(m.capabilities))) return null;

    const toolModels = new Set<string>();
    for (const m of models) {
      if (!Array.isArray(m.capabilities) || !m.capabilities.includes("tools")) continue;
      if (typeof m.name === "string") toolModels.add(m.name);
      if (typeof m.model === "string") toolModels.add(m.model);
    }
    return toolModels;
  } catch {
    return null;
  }
}

// Model lists are public per provider, so they are cached by provider id.
const modelsCache = new Map<string, { models: string[]; fetchedAt: number }>();

/**
 * Lists the models a provider exposes on its OpenAI-compatible `GET /models`
 * endpoint, keeping only models that support tool calling when the provider says so.
 * Results are cached; on failure the last good list (or an empty list) is returned.
 */
export async function listAvailableModels(context: ProviderContext): Promise<string[]> {
  const { provider, apiKey } = context;
  const cached = modelsCache.get(provider.id);
  if (cached && Date.now() - cached.fetchedAt < MODELS_CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    const response = await fetch(`${provider.baseURL}/models`, {
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Provider responded with ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { data?: ProviderModel[] };
    const data = body.data ?? [];
    const reportsCapabilities = data.some((model) => Array.isArray(model.supported_parameters));
    const ollamaToolModels = reportsCapabilities ? null : await fetchOllamaToolModels(context);

    const models = data
      .filter(supportsTools)
      .filter((model) => !ollamaToolModels || (typeof model.id === "string" && ollamaToolModels.has(model.id)))
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort((a, b) => a.localeCompare(b));

    modelsCache.set(provider.id, { models, fetchedAt: Date.now() });
    return models;
  } catch (error) {
    console.error("Failed to list provider models", { provider: provider.id, error });
    return cached?.models ?? [];
  }
}

export function getDefaultModel(provider: AiProvider, models: string[]): string | null {
  if (models.length === 0 || models.includes(provider.defaultModel)) {
    return provider.defaultModel;
  }
  return models[0] ?? null;
}

export async function isAvailableModel(context: ProviderContext, modelId: string): Promise<boolean> {
  const models = await listAvailableModels(context);
  // If the provider can't be listed, let the provider itself accept or reject the model.
  return models.length === 0 || models.includes(modelId);
}

export function resolveChatModel({ provider, apiKey }: ProviderContext, modelId: string): LanguageModel {
  return createOpenAICompatible({
    name: provider.id,
    baseURL: provider.baseURL,
    apiKey,
    includeUsage: true,
  })(modelId);
}
