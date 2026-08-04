import type { StageKey } from "./constants.js";

export interface StageDefinition {
  key: StageKey;
  title: string;
  description: string;
  assigneeConfigKey: string;
  blockedBy?: StageKey;
}

export function buildStageDefinitions(taskTitle: string): StageDefinition[] {
  return [
    {
      key: "plan",
      title: `Plan/context: ${taskTitle}`,
      description: "Confirm the immutable task envelope, workspace, prior context, and bounded implementation plan.",
      assigneeConfigKey: "directorAgentId",
    },
    {
      key: "build",
      title: `Build: ${taskTitle}`,
      description: "Implement the requested code and documentation in the primary dev workspace.",
      assigneeConfigKey: "builderAgentId",
      blockedBy: "plan",
    },
    {
      key: "validate",
      title: `Deterministic validation: ${taskTitle}`,
      description: "Run only repository-declared argv and publish the validation evidence document.",
      assigneeConfigKey: "validatorAgentId",
      blockedBy: "build",
    },
    {
      key: "review",
      title: `Independent review: ${taskTitle}`,
      description: "Review from a fresh session and publish an accepted or changes-requested decision.",
      assigneeConfigKey: "reviewerAgentId",
      blockedBy: "validate",
    },
    {
      key: "release",
      title: `Release: ${taskTitle}`,
      description: "Verify exact-path staging, commit and push dev, then publish factory-run-receipt.v1.",
      assigneeConfigKey: "integratorAgentId",
      blockedBy: "review",
    },
  ];
}
