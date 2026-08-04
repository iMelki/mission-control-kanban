import { Summary } from "./Summary.js";
import type { BridgeSummary } from "./model.js";

export function DataState({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: { message: string } | null;
  data: BridgeSummary | null;
}) {
  if (loading) return <div>Loading MCK bridge diagnostics…</div>;
  if (error) return <div role="alert">MCK bridge diagnostics failed: {error.message}</div>;
  if (!data) return <div>No MCK bridge diagnostics are available.</div>;
  return <Summary data={data} />;
}
