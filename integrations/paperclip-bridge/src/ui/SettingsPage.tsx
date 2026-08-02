import { usePluginData, type PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { DataState } from "./DataState.js";
import { panel, type BridgeSummary } from "./model.js";

export function SettingsPage({ context }: PluginSettingsPageProps) {
  const result = usePluginData<BridgeSummary>("bridge-summary", { companyId: context.companyId });
  return (
    <div style={panel}>
      <h2 style={{ margin: 0 }}>MCK Bridge Diagnostics</h2>
      <p>
        Configure company/project/agent IDs plus Paperclip secret references in the plugin settings.
        Use the MCK signed health wizard before enabling dispatch version 2.
      </p>
      <DataState loading={result.loading} error={result.error} data={result.data} />
    </div>
  );
}
