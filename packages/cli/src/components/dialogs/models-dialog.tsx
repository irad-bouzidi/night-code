import { useCallback, useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import { fetchAvailableModels } from "../../lib/models";

type ModelsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; models: string[] };

type ModelsDialogContentProps = {
  currentModel: string;
  onSelectModel: (modelId: string) => void;
};

export const ModelsDialogContent = ({ currentModel, onSelectModel }: ModelsDialogContentProps) => {
  const dialog = useDialog();
  const [state, setState] = useState<ModelsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetchAvailableModels()
      .then(({ models }) => {
        if (!cancelled) setState({ status: "ready", models });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load models";
        setState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(
    (modelId: string) => {
      onSelectModel(modelId);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  if (state.status === "loading") {
    return <text attributes={TextAttributes.DIM}>Loading models from provider...</text>;
  }

  if (state.status === "error") {
    return <text fg="red">{state.message}</text>;
  }

  return (
    <DialogSearchList
      items={state.models}
      onSelect={handleSelect}
      filterFn={(modelId, query) => modelId.toLowerCase().includes(query.toLowerCase())}
      renderItem={(modelId, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {modelId === currentModel ? `● ${modelId}` : `  ${modelId}`}
        </text>
      )}
      getKey={(modelId) => modelId}
      placeholder="Search models"
      emptyText="The provider returned no models"
    />
  );
};
