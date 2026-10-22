// Demo build only: next.config.mjs points Next's client instrumentation hook
// (`private-next-instrumentation-client-user`) at this file when
// NEXT_PUBLIC_DEMO_MODE=1, so it runs before the app hydrates. Normal builds
// never import it.
import { installDemoNetwork } from './install';

installDemoNetwork();
