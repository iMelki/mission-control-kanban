'use client';

/**
 * ActionReviewDialog (fleet EUX-09 primitive).
 * Ported from Component Marketplace `src/components/ui/action-review-dialog.tsx`
 * at 6a49e75, adapted to MCK: vendored shadcn/Radix dialog, mc-* palette, plain
 * house buttons instead of the marketplace Button component. Replaces native
 * confirm()/alert() guards on consequential operator actions (#139).
 */

import * as React from 'react';
import { CircleAlert, ListChecks, LoaderCircle, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ACTION_REVIEW_CONSEQUENCE_KEYS,
  ACTION_REVIEW_CONSEQUENCE_META,
  describeActionReviewError,
  getActionReviewConfirmBlockedReason,
  type ActionReviewConsequences,
  type ActionReviewTone,
} from '@/components/ui/action-review-contract';

export interface ActionReviewTypedConfirmation {
  /** Exact text the operator must type to enable confirm. */
  expectedValue: string;
  /** Overrides the default "Type X to enable confirm" label. */
  inputLabel?: React.ReactNode;
  /** Optional extra context shown under the input. */
  hint?: React.ReactNode;
}

export interface ActionReviewDialogProps {
  title: React.ReactNode;
  /** Structured four-question summary; see ActionReviewConsequences. */
  consequences: ActionReviewConsequences;
  /** Runs on confirm. A rejected promise keeps the dialog open with the error. */
  onConfirm: () => void | Promise<void>;
  /** Optional element rendered as the dialog trigger via Radix asChild. */
  trigger?: React.ReactElement;
  description?: React.ReactNode;
  tone?: ActionReviewTone;
  confirmLabel?: React.ReactNode;
  pendingLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /** Require typing the entity name before confirm unlocks (irreversible actions). */
  typedConfirmation?: ActionReviewTypedConfirmation;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCancel?: () => void;
  className?: string;
}

const toneStyles: Record<
  ActionReviewTone,
  {
    icon: typeof ListChecks;
    iconClassName: string;
    confirmClassName: string;
  }
> = {
  default: {
    icon: ListChecks,
    iconClassName: 'text-mc-accent',
    confirmClassName:
      'bg-mc-accent text-mc-bg hover:bg-mc-accent/90 focus-visible:ring-mc-accent',
  },
  destructive: {
    icon: TriangleAlert,
    iconClassName: 'text-mc-accent-red',
    confirmClassName:
      'bg-mc-accent-red text-white hover:bg-mc-accent-red/90 focus-visible:ring-mc-accent-red',
  },
};

/**
 * Accessible review step for consequential operator actions. Composes the
 * vendored shadcn/Radix Dialog (focus trap, Escape, aria-modal, focus return)
 * and replaces native confirm()/alert() guards. The consequence summary is
 * wired into aria-describedby, cancel stays visually equal to confirm, the
 * destructive tone moves initial focus to Cancel, and an optional typed
 * confirmation gates irreversible actions.
 */
export function ActionReviewDialog({
  title,
  consequences,
  onConfirm,
  trigger,
  description,
  tone = 'default',
  confirmLabel = 'Confirm',
  pendingLabel = 'Working...',
  cancelLabel = 'Cancel',
  typedConfirmation,
  open,
  defaultOpen,
  onOpenChange,
  onCancel,
  className,
}: ActionReviewDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const [pending, setPending] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [typedValue, setTypedValue] = React.useState('');
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const typedInputId = React.useId();
  const typedHintId = React.useId();

  const isOpen = open ?? internalOpen;
  const toneStyle = toneStyles[tone];
  const ToneIcon = toneStyle.icon;
  const blockedReason = getActionReviewConfirmBlockedReason({
    pending,
    expectedConfirmation: typedConfirmation?.expectedValue,
    typedValue,
  });
  const typedMismatch =
    typedValue.length > 0 && blockedReason === 'confirmation_mismatch';

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) {
      return;
    }
    if (!nextOpen) {
      setTypedValue('');
      setErrorMessage(null);
    }
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }

  function handleCancel() {
    onCancel?.();
    handleOpenChange(false);
  }

  async function handleConfirm() {
    if (blockedReason) {
      return;
    }
    setPending(true);
    setErrorMessage(null);
    try {
      await onConfirm();
      setPending(false);
      if (open === undefined) {
        setInternalOpen(false);
      }
      setTypedValue('');
      onOpenChange?.(false);
    } catch (error) {
      setPending(false);
      setErrorMessage(describeActionReviewError(error));
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className={cn('max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto', className)}
        data-action-review-dialog=""
        data-action-review-tone={tone}
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          if (tone === 'destructive') {
            event.preventDefault();
            cancelRef.current?.focus();
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-start gap-2.5">
            <ToneIcon
              aria-hidden="true"
              className={cn('mt-0.5 size-5 shrink-0', toneStyle.iconClassName)}
            />
            <DialogTitle>{title}</DialogTitle>
          </div>
        </DialogHeader>

        {/* Radix wires this block into the dialog's aria-describedby, so the
            four-question consequence summary IS the accessible description. */}
        <DialogDescription asChild>
          <div className="grid gap-3">
            {description ? (
              <p className="m-0 text-sm leading-6 text-mc-text-secondary">{description}</p>
            ) : null}
            <dl className="grid gap-2 sm:grid-cols-2">
              {ACTION_REVIEW_CONSEQUENCE_KEYS.map((key) => (
                <div
                  key={key}
                  className="grid content-start gap-1 rounded-md border border-mc-border bg-mc-bg p-3"
                >
                  <dt className="text-xs font-medium uppercase tracking-[0.14em] text-mc-text-secondary">
                    {ACTION_REVIEW_CONSEQUENCE_META[key].label}
                  </dt>
                  <dd className="m-0 text-sm leading-5 text-mc-text">
                    {consequences[key]}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </DialogDescription>

        {typedConfirmation ? (
          <div className="grid gap-1.5">
            <label
              htmlFor={typedInputId}
              className="text-xs font-medium uppercase tracking-[0.14em] text-mc-text-secondary"
            >
              {typedConfirmation.inputLabel ?? (
                <>
                  Type{' '}
                  <span className="font-semibold normal-case tracking-normal text-mc-text">
                    {typedConfirmation.expectedValue}
                  </span>{' '}
                  to enable confirm
                </>
              )}
            </label>
            <input
              id={typedInputId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={typedValue}
              disabled={pending}
              aria-invalid={typedMismatch || undefined}
              aria-describedby={typedConfirmation.hint ? typedHintId : undefined}
              onChange={(event) => setTypedValue(event.target.value)}
              className="h-10 rounded border border-mc-border bg-mc-bg px-3 text-sm text-mc-text focus:border-mc-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              data-action-review-typed-input=""
            />
            {typedConfirmation.hint ? (
              <p id={typedHintId} className="m-0 text-xs leading-5 text-mc-text-secondary">
                {typedConfirmation.hint}
              </p>
            ) : null}
          </div>
        ) : null}

        {errorMessage ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-mc-accent-red/40 bg-mc-accent-red/10 p-3"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-mc-accent-red" />
            <p className="m-0 text-sm leading-5 text-mc-text">{errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <button
            ref={cancelRef}
            type="button"
            className="rounded border border-mc-border bg-mc-bg-tertiary px-4 py-2 text-sm font-medium text-mc-text hover:bg-mc-border focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent disabled:cursor-not-allowed disabled:opacity-50"
            data-action-review-cancel=""
            disabled={pending}
            onClick={handleCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
              toneStyle.confirmClassName
            )}
            data-action-review-confirm=""
            data-pending={pending || undefined}
            disabled={Boolean(blockedReason)}
            onClick={handleConfirm}
          >
            {pending ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 motion-safe:animate-spin motion-reduce:animate-none"
                />
                {pendingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
