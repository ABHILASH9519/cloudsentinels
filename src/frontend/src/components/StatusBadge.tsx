import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: Props) {
  const lower = status.toLowerCase();
  const variants: Record<string, string> = {
    open: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    in_progress: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    resolved: "bg-green-500/20 text-green-400 border-green-500/30",
    acknowledged: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    active: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize font-mono text-xs font-semibold border",
        variants[lower] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}
