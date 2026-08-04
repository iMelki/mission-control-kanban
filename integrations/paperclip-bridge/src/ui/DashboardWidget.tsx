import { usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { DataState } from "./DataState.js";
import { panel, type BridgeSummary } from "./model.js";

export function DashboardWidget({ context }: PluginWidgetProps) {
  const result = usePluginData<BridgeSummary>("bridge-summary", { companyId: context.companyId });
  return (
    <div style={panel}>
      <strong>MCK Agentic Factory</strong>
      <DataState loading={result.loading} error={result.error} data={result.data} />
    </div>
  );
}
