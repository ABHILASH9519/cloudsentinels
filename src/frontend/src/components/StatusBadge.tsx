import { cn } from "@/lib/utils";

interface Props {
  status: string;
  className?: string;
}

const STATUS_MAP: Record<string, { dot: string; text: string }> = {
  open: { dot: "bg-sky-400", text: "text-sky-300" },
  active: { dot: "bg-red-500", text: "text-red-400" },
  critical: { dot: "bg-red-500", text: "text-red-400" },
  offline: { dot: "bg-red-500", text: "text-red-400" },
  failed: { dot: "bg-red-500", text: "text-red-400" },
  in_progress: { dot: "bg-amber-500", text: "text-amber-400" },
  investigating: { dot: "bg-amber-500", text: "text-amber-400" },
  warning: { dot: "bg-amber-500", text: "text-amber-400" },
  degraded: { dot: "bg-amber-500", text: "text-amber-400" },
  acknowledged: { dot: "bg-indigo-400", text: "text-indigo-300" },
  resolved: { dot: "bg-emerald-500", text: "text-emerald-400" },
  healthy: { dot: "bg-emerald-500", text: "text-emerald-400" },
  connected: { dot: "bg-emerald-500", text: "text-emerald-400" },
  succeeded: { dot: "bg-emerald-500", text: "text-emerald-400" },
  approval_required: { dot: "bg-amber-500", text: "text-amber-300" },
  "approval required": { dot: "bg-amber-500", text: "text-amber-300" },
  advisory: { dot: "bg-slate-400", text: "text-slate-300" },
};

export function StatusBadge({ status, className }: Props) {
  const lower = status.toLowerCase();
  const style = STATUS_MAP[lower] ?? {
    dot: "bg-slate-400",
    text: "text-muted-foreground",
  };
  const label = status.replace(/_/g, " ");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-xs capitalize whitespace-nowrap",
        style.text,
        className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
