import { Mapping } from "./Mapping.js";
import { State } from "./State.js";
import { panel, row, type BridgeSummary } from "./model.js";

export function Summary({ data }: { data: BridgeSummary }) {
  return (
    <div style={panel}>
      <div style={row}><span>Status</span><State value={data.status} /></div>
      <div style={row}><span>Linked factory runs</span><strong>{data.mappings}</strong></div>
      <div style={row}><span>Failed intake deliveries</span><strong>{data.failedDeliveries}</strong></div>
      <div style={row}><span>Failed lifecycle deliveries</span><strong>{data.failedLifecycleDeliveries}</strong></div>
      <div style={row}><span>Exhausted lifecycle retries</span><strong>{data.exhaustedLifecycleDeliveries}</strong></div>
      <div style={row}><span>Freshness</span><time>{data.checkedAt}</time></div>
      {data.rows.map((mapping) => <Mapping key={mapping.correlationId} mapping={mapping} />)}
    </div>
  );
}
