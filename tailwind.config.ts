import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Direction B "Evolve" tokens. The values live on :root in globals.css;
        // these resolve through the `-rgb` channel triples so opacity modifiers
        // (`bg-mc-warn/10`) work and the CSS stays the single source of truth.
        'mc-bg': 'rgb(var(--mc-bg-rgb) / <alpha-value>)',
        'mc-bg-secondary': 'rgb(var(--mc-bg-secondary-rgb) / <alpha-value>)',
        'mc-bg-tertiary': 'rgb(var(--mc-bg-tertiary-rgb) / <alpha-value>)',
        'mc-border': 'rgb(var(--mc-border-rgb) / <alpha-value>)',
        'mc-text': 'rgb(var(--mc-text-rgb) / <alpha-value>)',
        'mc-text-secondary': 'rgb(var(--mc-text-secondary-rgb) / <alpha-value>)',
        'mc-text-muted': 'rgb(var(--mc-text-muted-rgb) / <alpha-value>)',
        'mc-accent': 'rgb(var(--mc-accent-rgb) / <alpha-value>)',
        'mc-accent-ink': 'rgb(var(--mc-accent-ink-rgb) / <alpha-value>)',
        'mc-success': 'rgb(var(--mc-success-rgb) / <alpha-value>)',
        'mc-warn': 'rgb(var(--mc-warn-rgb) / <alpha-value>)',
        'mc-danger': 'rgb(var(--mc-danger-rgb) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      // fleet-motion-primitive v1.0.0 (agent-settings shared/assets/motion-primitive).
      // The tokens themselves live on :root in globals.css; these keys are the
      // Tailwind v3 consumption path, so `duration-fast` / `ease-standard` are real
      // utilities instead of tokens nothing can reference. The v4 `@theme` variant in
      // the primitive's README does not apply here - this app is Tailwind 3.4.
      // Durations resolve through var(), so the reduced-motion block collapses these
      // utilities too rather than only the hand-written CSS.
      transitionDuration: {
        instant: 'var(--duration-instant)',
        fast: 'var(--duration-fast)',
        slow: 'var(--duration-slow)',
        slower: 'var(--duration-slower)',
      },
      transitionTimingFunction: {
        // Only `standard` is added. The primitive's --ease-out / --ease-in are
        // verbatim Tailwind defaults, so `ease-out` / `ease-in` already carry the
        // canonical curves and remapping them would add a var() failure mode for no
        // change in value.
        standard: 'var(--ease-standard)',
      },
    },
  },
  plugins: [],
};

export default config;
