import { hc } from "hono/client";
import type { AppType } from "@nightcode/server";
import { clearAuth, getAuth } from "./auth";
import { getProviderHeaders } from "./credentials";

export const apiClient = hc<AppType>(
  process.env.API_URL ?? "http://localhost:3000",
  {
    fetch: async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const headers = new Headers(init?.headers);
      const auth = getAuth();

      if (auth) {
        headers.set("Authorization", `Bearer ${auth.token}`);
      }

      for (const [name, value] of Object.entries(getProviderHeaders())) {
        headers.set(name, value);
      }

      const response = await fetch(input, { ...init, headers });
      if (response.status === 401) {
        clearAuth();
      }

      return response;
    }
  }
);
