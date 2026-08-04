import { State } from "./State.js";
import { row, type MappingSummary } from "./model.js";

export function Mapping({ mapping }: { mapping: MappingSummary }) {
  return (
    <div style={{ display: "grid", gap: 6, borderTop: "1px solid #d1d5db", paddingTop: 8 }}>
      <div style={row}><span>Correlation</span><code>{mapping.correlationId}</code></div>
      <div style={row}><span>MCK task</span><code>{mapping.mckTaskId}</code></div>
      <div style={row}><span>Attempt</span><code>{mapping.attemptId}</code></div>
      <div style={row}><span>Intake</span><State value={mapping.intakeStatus} /></div>
      <div style={row}><span>Lifecycle</span><State value={mapping.lifecycleStatus ?? "accepted"} /></div>
      <div style={row}><span>Receipt</span><code>{mapping.receiptId ?? "not yet"}</code></div>
      <div style={row}>
        <span>Runs / active</span>
        <strong>{mapping.runMetrics.runCount} / {mapping.runMetrics.activeRunCount}</strong>
      </div>
      <div style={row}>
        <span>Cost / tokens</span>
        <strong>
          {(mapping.runMetrics.costCents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })}
          {" · "}
          {(mapping.runMetrics.inputTokens + mapping.runMetrics.outputTokens).toLocaleString()}
        </strong>
      </div>
      <div style={row}>
        <span>Pending decisions</span>
        <State value={mapping.pendingDecisions.count > 0 ? String(mapping.pendingDecisions.count) : "0"} />
      </div>
      <details>
        <summary>Paperclip issue graph</summary>
        <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
          <div style={row}><span>Parent</span><code>{mapping.parentIssueId ?? "unknown"}</code></div>
          {Object.entries(mapping.stages).map(([stage, issueId]) => (
            <div style={row} key={stage}>
              <span>{stage} · {mapping.stageStatuses[stage] ?? "unknown"}</span>
              <code>{issueId ?? "not created"}</code>
            </div>
          ))}
        </div>
      </details>
      {mapping.pendingDecisions.count > 0 ? (
        <details>
          <summary>Decision evidence</summary>
          <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
            <div>Approvals: {mapping.pendingDecisions.approvals.length}</div>
            <div>Budget incidents: {mapping.pendingDecisions.budgetIncidents.length}</div>
            <div>Invocation blocks: {mapping.pendingDecisions.invocationBlocks.length}</div>
          </div>
        </details>
      ) : null}
      {mapping.lastError ? <div role="alert">Last redacted failure: {mapping.lastError}</div> : null}
    </div>
  );
}
