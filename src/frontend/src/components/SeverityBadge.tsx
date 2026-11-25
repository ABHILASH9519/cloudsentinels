import { cn } from "@/lib/utils";

interface Props {
  severity: string;
  className?: string;
}

const SEVERITY_MAP: Record<string, { dot: string; text: string; label: string }> = {
  critical: {
    dot: "bg-red-500",
    text: "text-red-400",
    label: "Critical",
  },
  high: {
    dot: "bg-amber-500",
    text: "text-amber-400",
    label: "High",
  },
  medium: {
    dot: "bg-sky-400",
    text: "text-sky-300",
    label: "Medium",
  },
  low: {
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    label: "Low",
  },
  info: {
    dot: "bg-slate-400",
    text: "text-slate-300",
    label: "Info",
  },
};

export function SeverityBadge({ severity, className }: Props) {
  const lower = severity.toLowerCase();
  const style = SEVERITY_MAP[lower] ?? {
    dot: "bg-slate-400",
    text: "text-muted-foreground",
    label: severity,
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-xs font-medium whitespace-nowrap",
        style.text,
        className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-[2px]", style.dot)}
        aria-hidden="true"
      />
      {style.label}
    </span>
  );
}
