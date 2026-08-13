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
        // Dark theme colors matching the screenshot
        'mc-bg': '#0d1117',
        'mc-bg-secondary': '#161b22',
        'mc-bg-tertiary': '#21262d',
        'mc-border': '#30363d',
        'mc-text': '#c9d1d9',
        'mc-text-secondary': '#8b949e',
        'mc-accent': '#58a6ff',
        'mc-accent-green': '#3fb950',
        'mc-accent-yellow': '#d29922',
        'mc-accent-red': '#f85149',
        'mc-accent-purple': '#a371f7',
        'mc-accent-pink': '#db61a2',
        'mc-accent-cyan': '#39d353',
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
