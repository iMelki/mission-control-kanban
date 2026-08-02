// Thin re-exports over the shadcn `Card` primitives (src/components/ui/card.tsx).
// Kept for backwards compatibility with existing call sites (see mission-control-kanban#48);
// prefer importing `Card`/`CardHeader`/`CardContent`/`CardFooter` directly in new code.
import { Card, CardHeader, CardContent, CardFooter } from './card';

export const Panel = Card;
export const PanelHeader = CardHeader;
export const PanelBody = CardContent;
export const PanelFooter = CardFooter;
