import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded border border-mc-border bg-mc-bg px-4 py-2 text-base text-mc-text shadow-sm outline-none transition-colors',
        'placeholder:text-mc-text-secondary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-mc-text',
        'focus-visible:border-mc-accent focus-visible:ring-2 focus-visible:ring-mc-accent',
        'aria-[invalid=true]:border-mc-accent-red aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-mc-accent-red/40',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
