export function State({ value }: { value: string }) {
  const color = ["ok", "accepted", "completed"].includes(value)
    ? "#15803d"
    : ["degraded", "processing"].includes(value)
      ? "#b45309"
      : "#334155";
  return <strong style={{ color }}>{value}</strong>;
}
