// Demo build replacement for src/components/LocalControlPanel.tsx. The real
// panel links to services on the operator's own machine.
import { NotInDemo } from '@/demo/NotInDemo';

export function LocalControlPanel() {
  return (
    <NotInDemo
      className="mck-demo-note--spaced"
      title="Local control panel"
      detail="In the full app it lists health and links for the services that run alongside the board"
    />
  );
}
