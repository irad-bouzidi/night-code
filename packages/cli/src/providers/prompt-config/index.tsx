import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { findAiProvider, Mode, type ModeType } from "@nightcode/shared";
import { fetchAvailableModels } from "../../lib/models";
import { getConfig, getSavedModel, saveModel, updateConfig } from "../../lib/config";

type PromptConfigContextValue = {
  mode: ModeType;
  toggleMode: () => void;
  setMode: (mode: ModeType) => void;
  /** Active AI provider id, or "" when none has been picked yet. */
  provider: string;
  setProvider: (provider: string) => void;
  model: string;
  setModel: (model: string) => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(null);

export function usePromptConfig(): PromptConfigContextValue {
  const value = useContext(PromptConfigContext);
  if (!value) {
    throw new Error("usePromptConfig must be used within a PromptConfigProvider");
  }
  return value;
};

type PromptConfigProviderProps = {
  children: ReactNode;
};

function getInitialProvider() {
  return findAiProvider(getConfig().provider)?.id ?? "";
}

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
  const [mode, setMode] = useState<ModeType>(Mode.BUILD);
  const [provider, setProviderState] = useState<string>(getInitialProvider);
  // Start with the model picked for this provider in a previous run, if any.
  const [model, setModelState] = useState<string>(() => {
    const initialProvider = getInitialProvider();
    return initialProvider ? (getSavedModel(initialProvider) ?? "") : "";
  });

  // Whenever the provider changes, make sure the model still exists there; otherwise use its default.
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;

    fetchAvailableModels()
      .then(({ provider: listedProvider, models, defaultModel }) => {
        if (cancelled || listedProvider !== provider) return;
        setModelState((current) => {
          if (current && (models.length === 0 || models.includes(current))) return current;
          return defaultModel ?? current;
        });
      })
      .catch(() => {
        // Server unreachable; keep the saved model (if any) and let /models retry later.
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  const setProvider = useCallback((next: string) => {
    // Written synchronously so the next request already carries the new provider headers.
    updateConfig({ provider: next });
    setProviderState(next);
    setModelState(getSavedModel(next) ?? "");
  }, []);

  const setModel = useCallback((next: string) => {
    setModelState(next);
    const activeProvider = getConfig().provider;
    if (activeProvider) saveModel(activeProvider, next);
  }, []);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === Mode.BUILD ? Mode.PLAN : Mode.BUILD));
  }, []);

  return (
    <PromptConfigContext.Provider
      value={{
        mode,
        toggleMode,
        setMode,
        provider,
        setProvider,
        model,
        setModel,
    }}>
      {children}
    </PromptConfigContext.Provider>
  );
};
