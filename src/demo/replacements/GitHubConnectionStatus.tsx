// Demo build replacement for src/components/GitHubConnectionStatus.tsx.
import { Github } from '@/components/icons/BrandIcons';

export function GitHubConnectionStatus() {
  return (
    <div className="mck-demo-chip">
      <Github width={16} height={16} />
      <span className="mck-demo-chip__label">GitHub</span>
      <span>Not available in the demo</span>
    </div>
  );
}
