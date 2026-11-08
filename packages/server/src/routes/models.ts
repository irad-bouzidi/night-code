import { Hono } from "hono";
import { getDefaultModel, getProviderContext, listAvailableModels } from "../lib/models";

const app = new Hono().get("/", async (c) => {
  const result = getProviderContext((name) => c.req.header(name));
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  const { provider } = result.context;
  const models = await listAvailableModels(result.context);

  return c.json({
    provider: provider.id,
    models,
    defaultModel: getDefaultModel(provider, models),
  }, 200);
});

export default app;
