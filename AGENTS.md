# Agent Instructions

## Layout
- Bun-workspace monorepo; all code lives in `packages/cli` (`@night-code/cli`), the TUI app. No other packages yet.
- Entrypoint: `packages/cli/src/index.tsx` — top-level `await createCliRenderer()` then `createRoot(renderer).render(<App />)`.
- Install from the repo root: `bun install` (Bun >= 1.3.0 per `packages/cli/package.json`; use `bun`, not npm/yarn).

## Commands
- Dev watch mode: `bun run dev:cli` from the root, or `bun run dev` inside `packages/cli`. There is no build step; Bun executes `src/index.tsx` directly.
- Verify changes: `bun run typecheck` inside `packages/cli` — the root has no typecheck script.
- No tests, lint, formatter, or CI config exist in this repo; don't go looking for them.

## TUI gotchas
- Running the dev command takes over the terminal and never exits on its own; it cannot verify anything for an agent. Use `typecheck` instead, and run the TUI manually only for visual checks (quit with `/exit` or Ctrl+C).
- JSX compiles with `jsxImportSource: "@opentui/react"`, so intrinsics are TUI primitives (`<box>`, `<text>`, `<textarea>`, `<scrollbox>`, `<ascii-font>`) configured via props (`flexDirection`, `backgroundColor`, `paddingX`, ...) — not HTML/CSS.
- Import mixing: hooks/components such as `useKeyboard` and `useRenderer` come from `@opentui/react`; renderable types and constants such as `TextareaRenderable`, `ScrollBoxRenderable`, `KeyBinding`, `TextAttributes` come from `@opentui/core`.
- `tsconfig.base.json` enables `verbatimModuleSyntax` (type-only imports must use `import type`) and `noUncheckedIndexedAccess` (indexed access yields `T | undefined`).

## Slash-command menu
- Commands are defined in `packages/cli/src/components/command-menu/commands.tsx`; prefix filtering lives in `filter-commands.ts`; query, selection, and keyboard state in `use-command-menu.ts`.
- A command's `action` receives `{ exit }` (wired to `renderer.destroy()`). Commands without an `action` insert their `value` into the textarea.
