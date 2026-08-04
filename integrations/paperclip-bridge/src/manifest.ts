import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  PLUGIN_ID,
  PLUGIN_VERSION,
  JOB_RECONCILE_LIFECYCLE,
  SLOT_IDS,
  TOOL_REPORT_LIFECYCLE,
  WEBHOOK_ENDPOINT,
} from "./constants.js";
import { FACTORY_MISSION_CONTROL_BASE_URL } from "./contracts.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "MCK Agentic Factory Bridge",
  description: "Signed MCK dispatch intake, sequential Paperclip execution graph, lifecycle receipts, and redacted diagnostics.",
  author: "iMelki",
  categories: ["connector", "automation", "ui"],
  capabilities: [
    "activity.log.write",
    "agent.tools.register",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "events.subscribe",
    "http.outbound",
    "issue.documents.read",
    "issue.documents.write",
    "issue.relations.read",
    "issue.relations.write",
    "issue.subtree.read",
    "issues.create",
    "issues.orchestration.read",
    "issues.read",
    "issues.update",
    "issues.wakeup",
    "jobs.schedule",
    "metrics.write",
    "secrets.read-ref",
    "ui.dashboardWidget.register",
    "ui.detailTab.register",
    "instance.settings.register",
    "webhooks.receive"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  database: {
    namespaceSlug: "mck_factory_bridge",
    migrationsDir: "migrations",
    coreReadTables: ["issues"]
  },
  instanceConfigSchema: {
    type: "object",
    required: [
      "companyId",
      "projectId",
      "dispatchSecretRef",
      "callbackSecretRef",
      "missionControlOutcomeSecretRef",
      "directorAgentId",
      "builderAgentId",
      "validatorAgentId",
      "reviewerAgentId",
      "integratorAgentId"
    ],
    allOf: [
      {
        if: {
          properties: {
            githubSyncMode: { const: "apply" }
          }
        },
        then: {
          required: ["missionControlBaseUrl"]
        }
      }
    ],
    properties: {
      companyId: { type: "string", title: "Factory company ID" },
      projectId: { type: "string", title: "Factory project ID" },
      allowedRepositoryOwner: { type: "string", title: "Allowed GitHub owner", default: "iMelki" },
      dispatchSecretRef: {
        format: "secret-ref",
        title: "MCK dispatch HMAC secret reference",
      },
      callbackSecretRef: {
        format: "secret-ref",
        title: "MCK callback HMAC secret reference",
      },
      missionControlOutcomeSecretRef: {
        format: "secret-ref",
        title: "Mission Control factory outcome HMAC secret reference",
      },
      missionControlBaseUrl: {
        type: "string",
        const: FACTORY_MISSION_CONTROL_BASE_URL,
        title: "Mission Control base URL",
      },
      githubSyncMode: {
        type: "string",
        title: "Mission Control GitHub publication mode",
        enum: ["apply", "disabled"],
        default: "apply"
      },
      directorAgentId: { type: "string", title: "Director agent ID" },
      builderAgentId: { type: "string", title: "Builder agent ID" },
      validatorAgentId: { type: "string", title: "Validator agent ID" },
      reviewerAgentId: { type: "string", title: "Reviewer agent ID" },
      integratorAgentId: { type: "string", title: "Integrator agent ID" }
    }
  },
  jobs: [
    {
      jobKey: JOB_RECONCILE_LIFECYCLE,
      displayName: "Reconcile MCK lifecycle deliveries",
      description: "Retries signed MCK lifecycle and Mission Control outcome channels independently at most twice and refreshes diagnostics.",
      schedule: "*/5 * * * *"
    }
  ],
  webhooks: [
    {
      endpointKey: WEBHOOK_ENDPOINT,
      displayName: "MCK Dispatch",
      description: "Accepts signed mck.ping and mck.task.dispatch v1/v2 deliveries."
    }
  ],
  tools: [
    {
      name: TOOL_REPORT_LIFECYCLE,
      displayName: "Report MCK Factory Lifecycle",
      description: "Publish a signed lifecycle update for one MCK correlation ID. Completed requires current Validator/Reviewer evidence plus factory-run-receipt.v1.",
      parametersSchema: {
        type: "object",
        required: ["correlation_id", "status", "summary"],
        properties: {
          correlation_id: { type: "string" },
          status: {
            type: "string",
            enum: ["testing", "review", "completed", "blocked", "needs_human", "failed", "cancelled"]
          },
          summary: { type: "string" },
          receipt: { type: "object" }
        }
      }
    }
  ],
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboard,
        displayName: "MCK Factory Bridge",
        exportName: "DashboardWidget"
      },
      {
        type: "taskDetailView",
        id: SLOT_IDS.issue,
        displayName: "MCK Linkage",
        exportName: "IssueLinkagePanel",
        entityTypes: ["issue"]
      },
      {
        type: "settingsPage",
        id: SLOT_IDS.settings,
        displayName: "MCK Bridge Diagnostics",
        exportName: "SettingsPage"
      }
    ]
  }
};

export default manifest;
