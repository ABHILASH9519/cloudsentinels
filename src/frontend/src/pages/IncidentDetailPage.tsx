import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  Brain,
  FileText,
  Info,
  Loader2,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SeverityBadge } from "../components/SeverityBadge";
import {
  useAddComment,
  useDeleteIncident,
  useGetComments,
  useGetIncident,
  useUpdateIncidentAIFields,
  useUpdateIncidentStatus,
} from "../hooks/useQueries";

export function IncidentDetailPage() {
  const { id } = useParams({ from: "/incidents/$id" });
  const navigate = useNavigate();
  const incidentId = BigInt(id);

  const { data: incident, isLoading } = useGetIncident(incidentId);
  const { data: comments } = useGetComments(incidentId);
  const updateStatus = useUpdateIncidentStatus();
  const updateAI = useUpdateIncidentAIFields();
  const deleteIncident = useDeleteIncident();
  const addComment = useAddComment();

  const [aiForm, setAiForm] = useState({
    aiSummary: "",
    rootCause: "",
    suggestedFix: "",
  });
  const [commentText, setCommentText] = useState("");

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-ocid="incident_detail.loading_state">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div
        className="p-6 text-center text-muted-foreground"
        data-ocid="incident_detail.error_state"
      >
        Incident not found
      </div>
    );
  }

  const handleStatusChange = async (status: string) => {
    try {
      await updateStatus.mutateAsync({ id: incidentId, status });
      toast.success("Status updated");
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleAISave = async () => {
    try {
      await updateAI.mutateAsync({ id: incidentId, ...aiForm });
      toast.success("AI fields updated");
    } catch {
      toast.error("Failed to update AI fields");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteIncident.mutateAsync(incidentId);
      toast.success("Incident deleted");
      navigate({ to: "/incidents" });
    } catch {
      toast.error("Failed to delete incident");
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    try {
      await addComment.mutateAsync({
        incidentId,
        author: "",
        text: commentText,
      });
      toast.success("Comment added");
      setCommentText("");
    } catch {
      toast.error("Failed to add comment");
    }
  };

  const formatDate = (ts: bigint) =>
    new Date(Number(ts) / 1_000_000).toLocaleString();

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/incidents" })}
            className="mt-0.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="font-display text-xl font-700 text-foreground">
              {incident.title}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <SeverityBadge severity={incident.severity} />
              <span className="text-xs text-muted-foreground font-mono">
                {incident.source}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDate(incident.createdAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Select
            defaultValue={incident.status}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger
              className="w-36"
              data-ocid="incident_detail.status.select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="icon"
                data-ocid="incident_detail.delete.delete_button"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              className="bg-card border-border"
              data-ocid="incident_detail.delete.dialog"
            >
              <AlertDialogHeader>
                <AlertDialogTitle>Delete incident?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-ocid="incident_detail.delete.cancel_button">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  data-ocid="incident_detail.delete.confirm_button"
                  onClick={handleDelete}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="bg-muted/50 border border-border">
          <TabsTrigger
            value="overview"
            data-ocid="incident_detail.overview.tab"
            className="gap-1.5"
          >
            <Info className="w-3.5 h-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger
            value="ai"
            data-ocid="incident_detail.ai.tab"
            className="gap-1.5"
          >
            <Brain className="w-3.5 h-3.5" /> AI Analysis
          </TabsTrigger>
          <TabsTrigger
            value="rawlog"
            data-ocid="incident_detail.rawlog.tab"
            className="gap-1.5"
          >
            <FileText className="w-3.5 h-3.5" /> Raw Log
          </TabsTrigger>
          <TabsTrigger
            value="comments"
            data-ocid="incident_detail.comments.tab"
            className="gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5" /> Comments
          </TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4">
          <Card className="bg-card border-border">
            <CardContent className="p-5 grid grid-cols-2 gap-4 text-sm">
              {[
                ["ID", incident.id.toString()],
                ["Status", incident.status],
                ["Severity", incident.severity],
                ["Source", incident.source],
                ["Assignee", incident.assignee || "Unassigned"],
                ["Created", formatDate(incident.createdAt)],
                ["Updated", formatDate(incident.updatedAt)],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-xs text-muted-foreground mb-0.5">
                    {k}
                  </div>
                  <div className="font-mono text-foreground">{v}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Analysis */}
        <TabsContent value="ai" className="mt-4 space-y-4">
          {incident.aiSummary && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-primary">
                  AI Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-foreground">
                {incident.aiSummary}
              </CardContent>
            </Card>
          )}
          {incident.rootCause && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-amber-400">
                  Root Cause
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-foreground">
                {incident.rootCause}
              </CardContent>
            </Card>
          )}
          {incident.suggestedFix && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-green-400">
                  Suggested Fix
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-foreground">
                {incident.suggestedFix}
              </CardContent>
            </Card>
          )}

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Update AI Fields
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">AI Summary</Label>
                <Textarea
                  data-ocid="incident_detail.ai_summary.textarea"
                  rows={3}
                  placeholder={incident.aiSummary || "Enter AI summary..."}
                  value={aiForm.aiSummary}
                  onChange={(e) =>
                    setAiForm((p) => ({ ...p, aiSummary: e.target.value }))
                  }
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Root Cause</Label>
                <Textarea
                  data-ocid="incident_detail.root_cause.textarea"
                  rows={2}
                  placeholder={incident.rootCause || "Enter root cause..."}
                  value={aiForm.rootCause}
                  onChange={(e) =>
                    setAiForm((p) => ({ ...p, rootCause: e.target.value }))
                  }
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Suggested Fix</Label>
                <Textarea
                  data-ocid="incident_detail.suggested_fix.textarea"
                  rows={2}
                  placeholder={
                    incident.suggestedFix || "Enter suggested fix..."
                  }
                  value={aiForm.suggestedFix}
                  onChange={(e) =>
                    setAiForm((p) => ({ ...p, suggestedFix: e.target.value }))
                  }
                  className="text-sm"
                />
              </div>
              <Button
                onClick={handleAISave}
                disabled={updateAI.isPending}
                data-ocid="incident_detail.ai.save_button"
                className="bg-primary/90 hover:bg-primary text-primary-foreground"
              >
                {updateAI.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Save AI Fields
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Raw Log */}
        <TabsContent value="rawlog" className="mt-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              {incident.rawLog ? (
                <pre className="text-xs font-mono text-green-400 bg-black/40 p-4 rounded-md overflow-x-auto max-h-96 whitespace-pre-wrap">
                  {incident.rawLog}
                </pre>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No raw log attached
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Comments */}
        <TabsContent value="comments" className="mt-4 space-y-4">
          <div className="space-y-3">
            {!comments || comments.length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-ocid="incident_detail.comments.empty_state"
              >
                No comments yet
              </p>
            ) : (
              comments.map((c, i) => (
                <div
                  key={c.id.toString()}
                  data-ocid={`incident_detail.comments.item.${i + 1}`}
                  className="p-3 bg-muted/30 border border-border rounded-md"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-primary">
                      {c.author}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(
                        Number(c.createdAt) / 1_000_000,
                      ).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{c.text}</p>
                </div>
              ))
            )}
          </div>

          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-3">
              <Textarea
                data-ocid="incident_detail.comment.textarea"
                placeholder="Add a comment..."
                rows={3}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <Button
                data-ocid="incident_detail.add_comment.button"
                onClick={handleAddComment}
                disabled={addComment.isPending || !commentText.trim()}
                className="bg-primary/90 hover:bg-primary text-primary-foreground"
              >
                {addComment.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Post Comment
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
