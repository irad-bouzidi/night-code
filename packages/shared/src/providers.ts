/**
 * AI providers a user can pick with `/provider` in the CLI. Each one exposes an
 * OpenAI-compatible API (`{baseURL}/models`, `{baseURL}/chat/completions`).
 * The user's API key is stored locally by the CLI and sent per request; the
 * server never persists it.
 */
export const AI_PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/settings/keys",
    defaultModel: "anthropic/claude-sonnet-4.5",
  },
  {
    id: "ollama",
    name: "Ollama Cloud",
    baseURL: "https://ollama.com/v1",
    keyUrl: "https://ollama.com/settings/keys",
    defaultModel: "gpt-oss:120b",
  },
] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiProviderId = AiProvider["id"];

export function findAiProvider(id: string | null | undefined): AiProvider | undefined {
  return AI_PROVIDERS.find((provider) => provider.id === id);
}

/** Request headers the CLI uses to tell the server which provider and key to use. */
export const PROVIDER_HEADER = "x-nightcode-provider";
export const PROVIDER_KEY_HEADER = "x-nightcode-provider-key";
