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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SeverityBadge } from "../components/SeverityBadge";
import {
  useAddComment,
  useAnalyzeIncident,
  useDeleteIncident,
  useGetComments,
  useGetIncident,
  useUpdateIncidentAIFields,
  useUpdateIncidentStatus,
} from "../hooks/useIncidents";
import { CloudSentinelsApiError } from "../lib/cloudSentinels";

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function IncidentDetailPage() {
  const { id } = useParams({ from: "/incidents/$id" });
  const navigate = useNavigate();

  const {
    data: incident,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetIncident(id);
  const {
    data: comments,
    isLoading: commentsLoading,
    isError: commentsError,
    error: commentsQueryError,
    refetch: refetchComments,
  } = useGetComments(id);
  const updateStatus = useUpdateIncidentStatus();
  const updateAI = useUpdateIncidentAIFields();
  const analyzeIncident = useAnalyzeIncident();
  const deleteIncident = useDeleteIncident();
  const addComment = useAddComment();

  const [aiForm, setAiForm] = useState({
    aiSummary: "",
    rootCause: "",
    suggestedFix: "",
  });
  const [aiFormDirty, setAiFormDirty] = useState(false);
  const [commentText, setCommentText] = useState("");

  useEffect(() => {
    setAiForm({ aiSummary: "", rootCause: "", suggestedFix: "" });
    setAiFormDirty(false);
  }, [id]);

  useEffect(() => {
    if (!incident || incident.id !== id || aiFormDirty) return;
    setAiForm({
      aiSummary: incident.aiSummary ?? "",
      rootCause: incident.rootCause ?? "",
      suggestedFix: incident.suggestedFix ?? "",
    });
  }, [incident, aiFormDirty]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-ocid="incident_detail.loading_state">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof CloudSentinelsApiError && error.status === 404;
    return (
      <div
        className="p-6 text-center text-muted-foreground space-y-3"
        data-ocid="incident_detail.error_state"
        role="alert"
      >
        <p>{notFound ? "Incident not found" : error instanceof Error ? error.message : "Unable to load incident."}</p>
        {!notFound && (
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        )}
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
      await updateStatus.mutateAsync({ id, status });
      toast.success("Status updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update status",
      );
    }
  };

  const handleAIAnalyze = async () => {
    try {
      await analyzeIncident.mutateAsync(id);
      toast.success("Explainable triage completed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Triage analysis failed",
      );
    }
  };

  const handleAISave = async () => {
    try {
      await updateAI.mutateAsync({ id, ...aiForm });
      setAiFormDirty(false);
      toast.success("Triage fields updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update triage fields",
      );
    }
  };

  const handleDelete = async () => {
    try {
      await deleteIncident.mutateAsync(id);
      toast.success("Incident deleted");
      navigate({ to: "/incidents" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete incident",
      );
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    try {
      await addComment.mutateAsync({ incidentId: id, text: commentText });
      toast.success("Comment added");
      setCommentText("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add comment",
      );
    }
  };

  return (
    <div className="mission-page p-6 space-y-5 max-w-4xl">
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
            <h1 className="font-display text-xl font-bold text-foreground">
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
            onValueChange={(value) => void handleStatusChange(value)}
          >
            <SelectTrigger
              className="w-36"
              data-ocid="incident_detail.status.select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="investigating">Investigating</SelectItem>
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
                  onClick={() => void handleDelete()}
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
            <Brain className="w-3.5 h-3.5" /> Triage
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
                ["ID", incident.id],
                ["Status", incident.status],
                ["Severity", incident.severity],
                ["Source", incident.source],
                ["Target", incident.target || "—"],
                ["Assignee", incident.assignee || "Unassigned"],
                ["Created", formatDate(incident.createdAt)],
                ["Updated", formatDate(incident.updatedAt)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs text-muted-foreground mb-0.5">
                    {label}
                  </div>
                  <div className="font-mono text-foreground break-all">
                    {value}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          {incident.description && (
            <Card className="bg-card border-border mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Description
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-foreground whitespace-pre-wrap">
                {incident.description}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Triage */}
        <TabsContent value="ai" className="mt-4 space-y-4">
          <Card className="bg-card border-border">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Explainable triage
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Generate an evidence-based summary, likely cause and safe next
                  steps using the deterministic rules engine.
                </p>
              </div>
              <Button
                onClick={() => void handleAIAnalyze()}
                disabled={analyzeIncident.isPending}
                data-ocid="incident_detail.ai.generate_button"
                className="shrink-0 bg-primary/90 hover:bg-primary text-primary-foreground"
              >
                {analyzeIncident.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Brain className="mr-2 h-4 w-4" />
                )}
                Generate analysis
              </Button>
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground">
            Triage is produced by an explainable, deterministic rules engine — it
            is not a trained ML model or LLM. Suggestions are advisory and never
            execute remediation.
          </p>
          {incident.aiSummary && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-primary">
                  Triage Summary
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
                  Likely Cause
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
                  Safe Next Steps
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
                Update triage fields
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Triage Summary</Label>
                <Textarea
                  data-ocid="incident_detail.ai_summary.textarea"
                  rows={3}
                  placeholder={incident.aiSummary || "Enter summary..."}
                  value={aiForm.aiSummary}
                  disabled={updateAI.isPending}
                  onChange={(event) => {
                    setAiForm((prev) => ({
                      ...prev,
                      aiSummary: event.target.value,
                    }));
                    setAiFormDirty(true);
                  }}
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Likely Cause</Label>
                <Textarea
                  data-ocid="incident_detail.root_cause.textarea"
                  rows={2}
                  placeholder={incident.rootCause || "Enter likely cause..."}
                  value={aiForm.rootCause}
                  disabled={updateAI.isPending}
                  onChange={(event) => {
                    setAiForm((prev) => ({
                      ...prev,
                      rootCause: event.target.value,
                    }));
                    setAiFormDirty(true);
                  }}
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Safe Next Steps</Label>
                <Textarea
                  data-ocid="incident_detail.suggested_fix.textarea"
                  rows={2}
                  placeholder={incident.suggestedFix || "Enter next steps..."}
                  value={aiForm.suggestedFix}
                  disabled={updateAI.isPending}
                  onChange={(event) => {
                    setAiForm((prev) => ({
                      ...prev,
                      suggestedFix: event.target.value,
                    }));
                    setAiFormDirty(true);
                  }}
                  className="text-sm"
                />
              </div>
              <Button
                onClick={() => void handleAISave()}
                disabled={updateAI.isPending}
                data-ocid="incident_detail.ai.save_button"
                className="bg-primary/90 hover:bg-primary text-primary-foreground"
              >
                {updateAI.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Save triage fields
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
            {commentsError ? (
              <div className="flex flex-col items-start gap-2" role="alert" data-ocid="incident_detail.comments.error_state">
                <p className="text-sm text-muted-foreground">
                  {commentsQueryError instanceof Error ? commentsQueryError.message : "Unable to load comments."}
                </p>
                <Button variant="outline" size="sm" onClick={() => void refetchComments()}>
                  Retry
                </Button>
              </div>
            ) : commentsLoading ? (
              <p className="text-muted-foreground text-sm">Loading comments…</p>
            ) : !comments || comments.length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-ocid="incident_detail.comments.empty_state"
              >
                No comments yet
              </p>
            ) : (
              comments.map((comment, index) => (
                <div
                  key={comment.id}
                  data-ocid={`incident_detail.comments.item.${index + 1}`}
                  className="p-3 bg-muted/30 border border-border rounded-md"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-primary">
                      {comment.author}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(comment.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {comment.text}
                  </p>
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
                onChange={(event) => setCommentText(event.target.value)}
              />
              <Button
                data-ocid="incident_detail.add_comment.button"
                onClick={() => void handleAddComment()}
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
