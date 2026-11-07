import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { findAiProvider, Mode } from "@nightcode/shared";

export function StatusBar() {
  const { mode, provider, model } = usePromptConfig();
  const providerName = findAiProvider(provider)?.name;
  const { colors } = useTheme();

  return (
    <box flexDirection="row" gap={1}>
      
      <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
        {mode === Mode.PLAN ? "Plan" : "Build"}
      </text>

      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        ›
      </text>
      {providerName ? (
        <>
          <text attributes={TextAttributes.DIM}>{providerName}</text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
            ›
          </text>
          <text>{model || "loading models…"}</text>
        </>
      ) : (
        <text attributes={TextAttributes.DIM}>no provider · run /provider</text>
      )}
    </box>
  );
};
