# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

NightCode is a terminal-based AI coding agent. It is a Bun workspace monorepo (`packages/*`) with four packages: `cli` (OpenTUI + React terminal client), `server` (Hono API), `shared` (Zod schemas, AI tool contracts), and `database` (Prisma client and schema). Bun is the runtime and package manager throughout. Do not use npm or node.

## Commands

```bash
bun install                                    # also runs prisma generate via the server's postinstall
docker compose up -d --wait                    # local Postgres 17 (nightcode/nightcode @ localhost:5432/nightcode)
bunx --bun prisma db push                      # (from packages/database) sync schema to the DB
bun run dev:server                             # Hono API on http://localhost:3000 (hot reload)
bun run dev:cli                                # CLI in watch mode (run in a second terminal)
bun run build:cli                              # bun build -> packages/cli/dist
bun run link:cli                               # build + `bun link` so `nightcode` is on PATH
bun run --cwd packages/database db:generate    # regenerate Prisma client (output: packages/database/generated/prisma)
bunx tsc --noEmit -p packages/<pkg>            # typecheck a package (there is no lint or test setup)
```

All packages read a single `.env` at the repo root (see `.env.example`). `packages/cli/bin/nightcode` and `packages/database/prisma.config.ts` load it by resolving the path explicitly. The server needs Postgres (`DATABASE_URL`), Clerk OAuth. AI provider keys are not server config: users add them in the CLI with `/provider`. README.md walks through the Clerk OAuth app setup.

## Architecture

### Tools are defined on the server and executed on the client

This split matters most when you change tool behavior:
- `packages/shared/src/schemas.ts` defines the tool **contracts**: `tool()` calls with input schemas and **no `execute`**. `getToolContracts(mode)` returns read-only tools (`readFile`, `listDirectory`, `glob`, `grep`) for `PLAN` mode and all tools (adding `writeFile`, `editFile`, `bash`) for `BUILD` mode.
- The server (`packages/server/src/routes/chat.ts`) passes these contracts to `streamText`. The model emits tool calls, but the server cannot run them.
- The CLI (`packages/cli/src/hooks/use-chat.ts`) handles `onToolCall` by running `executeLocalTool` (`packages/cli/src/lib/local-tools.ts`) against the user's local `process.cwd()`. It then calls `addToolOutput`, and `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` re-posts to the server to continue the turn.
- `local-tools.ts` enforces the sandbox: paths must stay inside the cwd, and it applies output and size limits. It also re-checks PLAN mode as a guard.

To add a tool: add its input schema and contract in `shared/src/schemas.ts`, add it to the right contract set, then implement a `case` in `local-tools.ts`. If the tool is read-only, also add it to the PLAN allow-list there.

### Chat persistence (`server/src/routes/chat.ts`)

- The client sends only the newest message, or the last user message plus an assistant message with tool outputs (see `prepareSendMessagesRequest`). The server merges these by message `id` into `Session.messages`. That column is a JSON array of AI SDK `UIMessage`s, so there is no separate messages table.
- Mode and model travel in message `metadata`, and the server stamps them on each message.
- In `onFinish`, the session is saved **only** when the response has no pending tool calls. Otherwise the turn is still in progress on the client.
- `idleTimeout: 255` in `server/src/index.ts` is intentional because long tool round-trips would otherwise time out.

### Providers and models

- `packages/shared/src/providers.ts` (`AI_PROVIDERS`) is the registry of selectable providers (currently OpenRouter and Ollama Cloud). Each entry has an id, an OpenAI-compatible `baseURL`, a key URL, and a `defaultModel`. To add a provider, add an entry there. The server only accepts provider ids from this registry and never accepts a base URL from the client.
- **Keys live on the client.** `/provider` (`cli/src/components/dialogs/providers-dialog.tsx`) lists providers, then for a provider with a saved key offers use/replace/delete, otherwise asks for a key. Keys are stored in `~/.nightcode/credentials.json` (0600, `cli/src/lib/credentials.ts`). The active provider and the last model per provider are in `~/.nightcode/config.json` (`cli/src/lib/config.ts`).
- `getProviderHeaders()` adds `x-nightcode-provider` and `x-nightcode-provider-key` to every request: in the `api-client.ts` fetch wrapper and in the chat transport's `headers()` in `use-chat.ts`. It reads the config file, so `setProvider` writes it synchronously before the state update.
- Server (`server/src/lib/models.ts`): `getProviderContext()` reads those headers. `listAvailableModels()` reads `{baseURL}/models` (10-minute cache per provider) and keeps only tool-capable models. OpenRouter is filtered by `supported_parameters`, and Ollama by the `capabilities` field of the native `/api/tags`. `resolveChatModel()` builds a per-request `@ai-sdk/openai-compatible` provider. `GET /models` (unauthenticated) needs only the provider header. The chat route also requires a key and rejects models not in the list, unless the list couldn't be fetched.
- In the CLI, the `/models` dialog fetches the list when opened. `PromptConfigProvider` re-validates the model whenever the provider changes and falls back to the provider default. Dialog content renders outside `PromptConfigProvider`, so pass prompt config to dialogs as props via `CommandContext`. Model IDs are plain strings throughout.
- The provider package must stay on the `ai-v6` dist-tag (`^2.x`) to match `ai@6`.

### Typed API client

The server exports `AppType` (the chained Hono routes). The CLI imports it as a dev dependency on `@nightcode/server` and builds a typed `hc<AppType>` client in `cli/src/lib/api-client.ts`. Routes must stay chained (`.route(...)`, `.post(...)`) to keep type inference working. A 401 response clears the stored token.

### Auth

The CLI runs a PKCE OAuth flow against Clerk (`cli/src/lib/oauth.ts`). It opens a local callback server, and the port is encoded in the base64url `state`. Clerk redirects to the server's `/auth/callback`, which forwards the code to `http://localhost:<port>/callback`. The token is stored in `~/.nightcode/auth.json` with mode 0600. The server's `requireAuth` validates the bearer token and sets `userId`.

### CLI UI

The UI is built with OpenTUI React (`@opentui/react`), so use `<box>`/`<text>` primitives, not DOM elements. Routing uses `react-router`'s `createMemoryRouter` (`/`, `/sessions/new`, `/sessions/:id`) inside `RootLayout`. Cross-cutting UI state comes from the providers in `cli/src/providers/`: dialog stack, keyboard layers (which control which component receives keys), prompt config (mode/model), theme, and toast. Slash commands are defined in `components/command-menu/commands.tsx`.

### TypeScript

Every package extends `tsconfig.base.json`, which sets `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (use `import type` for type-only imports), and bundler module resolution with `noEmit`. Workspace packages export their `src/*.ts` directly, so the packages have no build step.

## Tutorial branches

This repo follows a tutorial. Branches `01-…` through `11-the-end` are chapter snapshots, and `main` is the final project.
