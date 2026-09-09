import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  severity: string;
  className?: string;
}

export function SeverityBadge({ severity, className }: Props) {
  const lower = severity.toLowerCase();
  const variants: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low: "bg-green-500/20 text-green-400 border-green-500/30",
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
      {severity}
    </Badge>
  );
}
