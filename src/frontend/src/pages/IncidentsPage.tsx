import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SeverityBadge } from "../components/SeverityBadge";
import { StatusBadge } from "../components/StatusBadge";
import { useCreateIncident, useListIncidents } from "../hooks/useIncidents";

const SKELETON_KEYS = ["sk1", "sk2", "sk3", "sk4", "sk5"];

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function IncidentsPage() {
  const { data: incidents, isLoading } = useListIncidents();
  const createIncident = useCreateIncident();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [form, setForm] = useState({
    title: "",
    severity: "medium",
    source: "",
    rawLog: "",
  });

  const filtered = (incidents ?? []).filter((incident) => {
    if (filterStatus !== "all" && incident.status !== filterStatus) return false;
    if (filterSeverity !== "all" && incident.severity !== filterSeverity)
      return false;
    return true;
  });

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!form.source.trim()) {
      toast.error("Source is required");
      return;
    }
    try {
      await createIncident.mutateAsync(form);
      toast.success("Incident created");
      setOpen(false);
      setForm({ title: "", severity: "medium", source: "", rawLog: "" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create incident",
      );
    }
  };

  return (
    <div className="mission-page p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            Incidents
          </h1>
          <p className="text-sm text-muted-foreground">
            {incidents?.length ?? 0} total incidents
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              data-ocid="incidents.new_incident.button"
              className="bg-primary/90 hover:bg-primary text-primary-foreground gap-2"
            >
              <Plus className="w-4 h-4" />
              New Incident
            </Button>
          </DialogTrigger>
          <DialogContent
            className="bg-card border-border sm:max-w-md"
            data-ocid="incidents.dialog"
          >
            <DialogHeader>
              <DialogTitle className="font-display">
                Create Incident
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  data-ocid="incidents.title.input"
                  placeholder="e.g. Pod crash loop in prod-cluster"
                  value={form.title}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, severity: value }))
                  }
                >
                  <SelectTrigger data-ocid="incidents.severity.select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Input
                  data-ocid="incidents.source.input"
                  placeholder="e.g. kubernetes, prometheus, elk"
                  value={form.source}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, source: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Raw Log</Label>
                <Textarea
                  data-ocid="incidents.rawlog.textarea"
                  placeholder="Paste log output here..."
                  rows={5}
                  className="font-mono text-xs"
                  value={form.rawLog}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, rawLog: event.target.value }))
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                data-ocid="incidents.create.cancel_button"
              >
                Cancel
              </Button>
              <Button
                data-ocid="incidents.create.submit_button"
                onClick={() => void handleCreate()}
                disabled={createIncident.isPending}
                className="bg-primary/90 hover:bg-primary text-primary-foreground"
              >
                {createIncident.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger
            className="w-40"
            data-ocid="incidents.filter_status.select"
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="investigating">Investigating</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger
            className="w-40"
            data-ocid="incidents.filter_severity.select"
          >
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        className="border border-border rounded-lg overflow-hidden"
        data-ocid="incidents.table"
      >
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Title</TableHead>
              <TableHead className="text-muted-foreground">Severity</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Source</TableHead>
              <TableHead className="text-muted-foreground">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              SKELETON_KEYS.map((key) => (
                <TableRow key={key}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-12 text-muted-foreground"
                  data-ocid="incidents.empty_state"
                >
                  No incidents found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((incident, index) => (
                <TableRow
                  key={incident.id}
                  data-ocid={`incidents.item.${index + 1}`}
                  className="cursor-pointer hover:bg-muted/30 border-b border-border transition-colors"
                  onClick={() =>
                    navigate({
                      to: "/incidents/$id",
                      params: { id: incident.id },
                    })
                  }
                >
                  <TableCell className="font-medium text-foreground">
                    {incident.title}
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={incident.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={incident.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {incident.source}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(incident.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
