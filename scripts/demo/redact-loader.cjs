// Demo build only (wired in next.config.mjs when NEXT_PUBLIC_DEMO_MODE=1).
// Rewrites a few operator-specific example strings in src/ before compiling,
// so the public demo bundle carries neutral placeholders instead. Source files
// and normal builds are untouched.
const REPLACEMENTS = [
  ['https://github.com/iMelki/projects-ops/issues/6', 'https://github.com/owner/repo/issues/123'],
  ['iMelki/mission-control', 'owner/repo'],
  ['projects-ops rollout', 'launch readiness'],
  ['http://localhost:3000', 'https://mission-control.example'],
  ['e.g., Assistants', 'e.g., Product Launch'],
  // Catch-all for any remaining owner handle in example text.
  ['iMelki', 'owner'],
];

module.exports = function redactDemoStrings(source) {
  let output = source;
  for (const [from, to] of REPLACEMENTS) output = output.split(from).join(to);
  return output;
};
