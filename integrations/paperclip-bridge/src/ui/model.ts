import type React from "react";

export interface MappingSummary {
  correlationId: string;
  mckTaskId: string;
  attemptId: string;
  parentIssueId: string | null;
  stages: Record<string, string | null>;
  stageStatuses: Record<string, string | null>;
  intakeStatus: "processing" | "accepted" | "failed";
  lifecycleStatus: string | null;
  receiptId: string | null;
  runMetrics: {
    runCount: number;
    activeRunCount: number;
    costCents: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
  pendingDecisions: {
    count: number;
    approvals: unknown[];
    budgetIncidents: unknown[];
    invocationBlocks: unknown[];
  };
  lastError: string | null;
  updatedAt: string;
}

export interface BridgeSummary {
  status: "ok" | "degraded";
  checkedAt: string;
  mappings: number;
  failedDeliveries: number;
  failedLifecycleDeliveries: number;
  exhaustedLifecycleDeliveries: number;
  rows: MappingSummary[];
}

export const panel = {
  display: "grid",
  gap: 10,
  fontSize: 13,
  lineHeight: 1.45,
} satisfies React.CSSProperties;

export const row = {
  display: "flex",
  gap: 12,
  justifyContent: "space-between",
  alignItems: "baseline",
} satisfies React.CSSProperties;
