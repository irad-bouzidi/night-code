import { useCallback, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { AI_PROVIDERS, type AiProvider } from "@nightcode/shared";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import type { ToastContextValue } from "../../providers/toast";
import { DialogSearchList } from "../dialog-search-list";
import {
  deleteProviderKey,
  getProviderKey,
  maskKey,
  setProviderKey,
} from "../../lib/credentials";

type ProvidersDialogContentProps = {
  currentProvider: string;
  onSelectProvider: (providerId: string) => void;
  toast: ToastContextValue;
};

type Step =
  | { name: "list" }
  | { name: "actions"; provider: AiProvider }
  | { name: "key"; provider: AiProvider; replacing: boolean };

type ProviderAction = "use" | "replace" | "delete" | "back";

const ACTION_LABELS: Record<ProviderAction, string> = {
  use: "Use this provider",
  replace: "Replace API key",
  delete: "Delete API key",
  back: "Back",
};

export const ProvidersDialogContent = ({
  currentProvider,
  onSelectProvider,
  toast,
}: ProvidersDialogContentProps) => {
  const dialog = useDialog();
  const [step, setStep] = useState<Step>({ name: "list" });

  const activate = useCallback(
    (provider: AiProvider) => {
      onSelectProvider(provider.id);
      toast.show({ variant: "success", message: `Using ${provider.name}` });
      dialog.close();
    },
    [dialog, onSelectProvider, toast],
  );

  if (step.name === "key") {
    return (
      <ApiKeyStep
        provider={step.provider}
        replacing={step.replacing}
        onCancel={() => setStep(step.replacing ? { name: "actions", provider: step.provider } : { name: "list" })}
        onSave={(apiKey) => {
          setProviderKey(step.provider.id, apiKey);
          activate(step.provider);
        }}
      />
    );
  }

  if (step.name === "actions") {
    const { provider } = step;
    const apiKey = getProviderKey(provider.id);
    const actions: ProviderAction[] = ["use", "replace", "delete", "back"];

    return (
      <box flexDirection="column" gap={1}>
        <text attributes={TextAttributes.DIM}>
          {provider.name} · key {apiKey ? maskKey(apiKey) : "not set"}
        </text>
        <DialogSearchList
          items={actions}
          onSelect={(action) => {
            if (action === "use") {
              activate(provider);
            } else if (action === "replace") {
              setStep({ name: "key", provider, replacing: true });
            } else if (action === "delete") {
              deleteProviderKey(provider.id);
              toast.show({ message: `Deleted ${provider.name} API key` });
              setStep({ name: "list" });
            } else {
              setStep({ name: "list" });
            }
          }}
          filterFn={(action, query) => ACTION_LABELS[action].toLowerCase().includes(query.toLowerCase())}
          renderItem={(action, isSelected) => (
            <text selectable={false} fg={isSelected ? "black" : "white"}>
              {action === "use" && provider.id === currentProvider
                ? `${ACTION_LABELS.use} (active)`
                : ACTION_LABELS[action]}
            </text>
          )}
          getKey={(action) => action}
          placeholder="Search actions"
        />
      </box>
    );
  }

  return (
    <DialogSearchList
      items={[...AI_PROVIDERS]}
      onSelect={(provider) => {
        // A provider with a saved key offers use/replace/delete; otherwise ask for a key.
        if (getProviderKey(provider.id)) {
          setStep({ name: "actions", provider });
        } else {
          setStep({ name: "key", provider, replacing: false });
        }
      }}
      filterFn={(provider, query) => provider.name.toLowerCase().includes(query.toLowerCase())}
      renderItem={(provider, isSelected) => {
        const marker = provider.id === currentProvider ? "●" : " ";
        const status = getProviderKey(provider.id) ? "key saved" : "no key";
        return (
          <box flexDirection="row" justifyContent="space-between" width="100%">
            <text selectable={false} fg={isSelected ? "black" : "white"}>
              {`${marker} ${provider.name}`}
            </text>
            <text selectable={false} fg={isSelected ? "black" : undefined} attributes={TextAttributes.DIM}>
              {status}
            </text>
          </box>
        );
      }}
      getKey={(provider) => provider.id}
      placeholder="Search providers"
      emptyText="No matching providers"
    />
  );
};

type ApiKeyStepProps = {
  provider: AiProvider;
  replacing: boolean;
  onSave: (apiKey: string) => void;
  onCancel: () => void;
};

function ApiKeyStep({ provider, replacing, onSave, onCancel }: ApiKeyStepProps) {
  const { colors } = useTheme();
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  return (
    <box flexDirection="column" gap={1}>
      <text>
        {replacing ? "Paste a new" : "Paste your"} {provider.name} API key
      </text>
      <text attributes={TextAttributes.DIM}>Get one at {provider.keyUrl}</text>
      {/* The input text is drawn in the background color so the key stays hidden on screen. */}
      <box backgroundColor={colors.surface} paddingX={1}>
        <input
          focused
          placeholder="API key"
          backgroundColor={colors.surface}
          focusedBackgroundColor={colors.surface}
          textColor={colors.surface}
          focusedTextColor={colors.surface}
          onInput={setValue}
          onSubmit={() => {
            if (trimmed) onSave(trimmed);
          }}
        />
      </box>
      <text attributes={TextAttributes.DIM}>
        {trimmed ? `${maskKey(trimmed)} (${trimmed.length} chars)` : " "}
      </text>
      <box flexDirection="row" gap={2}>
        <text attributes={TextAttributes.DIM}>enter save</text>
        <text attributes={TextAttributes.DIM} onMouseDown={onCancel}>
          back
        </text>
      </box>
    </box>
  );
}
