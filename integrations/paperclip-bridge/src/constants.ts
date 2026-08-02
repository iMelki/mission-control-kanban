export const PLUGIN_ID = "imelki.mck-paperclip-bridge";
export const PLUGIN_VERSION = "0.1.0";
export const WEBHOOK_ENDPOINT = "mck-dispatch";
export const ORIGIN_KIND = `plugin:${PLUGIN_ID}` as const;
export const TOOL_REPORT_LIFECYCLE = "report-lifecycle";
export const JOB_RECONCILE_LIFECYCLE = "reconcile-lifecycle";
export const MAX_LIFECYCLE_DELIVERY_ATTEMPTS = 3;

export const STAGE_KEYS = ["plan", "build", "validate", "review", "release"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const SLOT_IDS = {
  dashboard: "bridge-health",
  issue: "mck-linkage",
  settings: "bridge-diagnostics",
} as const;
