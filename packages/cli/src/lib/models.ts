import { apiClient } from "./api-client";
import { getErrorMessage } from "./http-errors";

export type AvailableModels = {
  provider: string;
  models: string[];
  defaultModel: string | null;
};

/** Fetches the models the configured AI provider exposes (via the server's `/models`). */
export async function fetchAvailableModels(): Promise<AvailableModels> {
  const response = await apiClient.models.$get();

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json();
}
