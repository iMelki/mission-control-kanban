import { usePluginData, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { DataState } from "./DataState.js";
import { panel, type BridgeSummary } from "./model.js";

export function IssueLinkagePanel({ context }: PluginDetailTabProps) {
  const result = usePluginData<BridgeSummary>("bridge-summary", {
    companyId: context.companyId,
    issueId: context.entityId,
  });
  return (
    <div style={panel}>
      <strong>MCK linkage and receipt</strong>
      <p>This view shows stable cross-system IDs and redacted evidence. Secret values and raw authorization headers are never returned.</p>
      <DataState loading={result.loading} error={result.error} data={result.data} />
    </div>
  );
}
