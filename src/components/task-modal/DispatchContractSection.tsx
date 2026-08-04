import {
  READINESS_LABELS,
  REVIEW_MODE_LABELS,
  RISK_LEVEL_LABELS,
  type DispatchUiSummary,
} from '@/lib/dispatch-contract';
import type { DispatchReadiness, DispatchReviewMode, DispatchRiskLevel, Task } from '@/lib/types';

interface DispatchContractFormState {
  dispatch_source_issue_url: string;
  dispatch_target_repo: string;
  dispatch_project_workstream: string;
  dispatch_allowed_file_scope: string;
  dispatch_acceptance_criteria: string;
  dispatch_test_requirements: string;
  dispatch_risk_level: DispatchRiskLevel;
  dispatch_readiness: DispatchReadiness;
  dispatch_review_mode: DispatchReviewMode;
  dispatch_impact: string;
  dispatch_rollback_plan: string;
  dispatch_safety_rules: string;
}

export function DispatchContractSection<TForm extends DispatchContractFormState>({
  form,
  updateFormField,
  inputId,
  currentTask,
  dispatchPreview,
  dispatchSummaryClass,
  readinessOptions,
  reviewModeOptions,
  riskOptions,
}: {
  form: TForm;
  updateFormField: <K extends keyof TForm>(key: K, value: TForm[K]) => void;
  inputId: (name: string) => string;
  currentTask?: Task;
  dispatchPreview: DispatchUiSummary;
  dispatchSummaryClass: string;
  readinessOptions: DispatchReadiness[];
  reviewModeOptions: DispatchReviewMode[];
  riskOptions: DispatchRiskLevel[];
}) {
  return (
    <section className="space-y-4" aria-label="Dispatch Contract">
      <div>
        <h3 className="text-sm font-semibold">Dispatch Contract</h3>
        <p className="text-xs text-mc-text-secondary mt-1">
          These fields mirror the GitHub-native readiness contract used to decide whether auto-dispatch is safe.
        </p>
        {currentTask?.status === 'inbox' && currentTask.dispatch_blockers && currentTask.dispatch_blockers.length > 0 && (
          <p className="text-xs text-amber-200 mt-2">
            Why this task is still in Inbox: it is missing one or more required dispatch fields. Fill the scope,
            acceptance criteria, tests, review mode, impact, and rollback plan here, then save before moving it forward.
          </p>
        )}
      </div>

      <div className={`rounded-lg border px-3 py-3 ${dispatchSummaryClass}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{dispatchPreview.headline}</p>
            <p className="mt-1 text-xs opacity-90">
              Readiness: {dispatchPreview.readinessLabel}
              {dispatchPreview.reviewModeLabel ? ` · Review: ${dispatchPreview.reviewModeLabel}` : ''}
              {dispatchPreview.riskLevelLabel ? ` · Risk: ${dispatchPreview.riskLevelLabel}` : ''}
            </p>
          </div>
          {dispatchPreview.state !== 'ready' && (
            <span className="text-[11px] font-medium uppercase tracking-wide opacity-90">
              Save after filling the missing contract fields
            </span>
          )}
        </div>

        {dispatchPreview.blockers.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs list-disc list-inside">
            {dispatchPreview.blockers.slice(0, 4).map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}

        {dispatchPreview.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs list-disc list-inside opacity-90">
            {dispatchPreview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor={inputId('source-issue-url')} className="block text-sm font-medium mb-1">Source Issue URL</label>
        <input
          id={inputId('source-issue-url')}
          type="url"
          value={form.dispatch_source_issue_url}
          onChange={(e) => updateFormField('dispatch_source_issue_url', e.target.value as TForm['dispatch_source_issue_url'])}
          className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
          placeholder="https://github.com/owner/repo/issues/123"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={inputId('target-repo')} className="block text-sm font-medium mb-1">Target Repo</label>
          <input id={inputId('target-repo')} type="text" value={form.dispatch_target_repo} onChange={(e) => updateFormField('dispatch_target_repo', e.target.value as TForm['dispatch_target_repo'])} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent" placeholder="iMelki/mission-control" />
        </div>
        <div>
          <label htmlFor={inputId('project-workstream')} className="block text-sm font-medium mb-1">Project / Workstream</label>
          <input id={inputId('project-workstream')} type="text" value={form.dispatch_project_workstream} onChange={(e) => updateFormField('dispatch_project_workstream', e.target.value as TForm['dispatch_project_workstream'])} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent" placeholder="projects-ops rollout" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={inputId('readiness')} className="block text-sm font-medium mb-1">Readiness</label>
          <select id={inputId('readiness')} value={form.dispatch_readiness} onChange={(e) => updateFormField('dispatch_readiness', e.target.value as TForm['dispatch_readiness'])} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent">
            {readinessOptions.map((value) => <option key={value} value={value}>{READINESS_LABELS[value]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={inputId('review-mode')} className="block text-sm font-medium mb-1">Review Mode</label>
          <select id={inputId('review-mode')} value={form.dispatch_review_mode} onChange={(e) => updateFormField('dispatch_review_mode', e.target.value as TForm['dispatch_review_mode'])} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent">
            {reviewModeOptions.map((value) => <option key={value} value={value}>{REVIEW_MODE_LABELS[value]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={inputId('risk-level')} className="block text-sm font-medium mb-1">Risk Level</label>
          <select id={inputId('risk-level')} value={form.dispatch_risk_level} onChange={(e) => updateFormField('dispatch_risk_level', e.target.value as TForm['dispatch_risk_level'])} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent">
            {riskOptions.map((value) => <option key={value} value={value}>{RISK_LEVEL_LABELS[value]}</option>)}
          </select>
        </div>
      </div>

      <TextInput id={inputId('impact')} label="Impact" value={form.dispatch_impact} onChange={(value) => updateFormField('dispatch_impact', value as TForm['dispatch_impact'])} placeholder="Docs only / code / infra / security" />
      <TextareaInput id={inputId('allowed-file-scope')} label="Allowed File Scope" value={form.dispatch_allowed_file_scope} onChange={(value) => updateFormField('dispatch_allowed_file_scope', value as TForm['dispatch_allowed_file_scope'])} rows={3} placeholder="One file or path per line" />
      <TextareaInput id={inputId('acceptance-criteria')} label="Acceptance Criteria" value={form.dispatch_acceptance_criteria} onChange={(value) => updateFormField('dispatch_acceptance_criteria', value as TForm['dispatch_acceptance_criteria'])} rows={3} placeholder="One acceptance criterion per line" />
      <TextareaInput id={inputId('test-requirements')} label="Test Requirements" value={form.dispatch_test_requirements} onChange={(value) => updateFormField('dispatch_test_requirements', value as TForm['dispatch_test_requirements'])} rows={3} placeholder="One verification command or expected test per line" />
      <TextareaInput id={inputId('safety-rules')} label="Safety Rules" value={form.dispatch_safety_rules} onChange={(value) => updateFormField('dispatch_safety_rules', value as TForm['dispatch_safety_rules'])} rows={2} placeholder="One guardrail per line" />
      <TextareaInput id={inputId('rollback-plan')} label="Rollback / Fallback Plan" value={form.dispatch_rollback_plan} onChange={(value) => updateFormField('dispatch_rollback_plan', value as TForm['dispatch_rollback_plan'])} rows={3} placeholder="How to contain or revert the change if dispatch goes wrong" />
    </section>
  );
}

function TextInput({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent" placeholder={placeholder} />
    </div>
  );
}

function TextareaInput({ id, label, value, onChange, rows, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; rows: number; placeholder: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none" placeholder={placeholder} />
    </div>
  );
}
