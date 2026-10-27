import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useInternetIdentity } from "../hooks/useInternetIdentity";
import { useGetUserProfile, useSaveUserProfile } from "../hooks/useQueries";

export function SettingsPage() {
  const { data: profile, isLoading } = useGetUserProfile();
  const saveProfile = useSaveUserProfile();
  const { identity } = useInternetIdentity();
  const [name, setName] = useState("");

  const principal = identity?.getPrincipal().toString();

  const handleSave = async () => {
    try {
      await saveProfile.mutateAsync({ name: name || profile?.name || "" });
      toast.success("Profile saved");
    } catch {
      toast.error("Failed to save profile");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div>
        <h1 className="font-display text-2xl font-700 text-foreground">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your account preferences
        </p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            User Profile
          </CardTitle>
          <CardDescription>Update your display name</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton
              className="h-10"
              data-ocid="settings.profile.loading_state"
            />
          ) : (
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                data-ocid="settings.name.input"
                placeholder={profile?.name || "Your name"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          {principal && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Principal ID
              </Label>
              <div className="text-xs font-mono text-muted-foreground bg-muted/30 p-2 rounded-md break-all border border-border">
                {principal}
              </div>
            </div>
          )}
          <Button
            data-ocid="settings.profile.save_button"
            onClick={handleSave}
            disabled={saveProfile.isPending}
            className="bg-primary/90 hover:bg-primary text-primary-foreground"
          >
            {saveProfile.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            Save Profile
          </Button>
          {saveProfile.isSuccess && (
            <p
              className="text-xs text-green-400"
              data-ocid="settings.profile.success_state"
            >
              Profile saved successfully
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()}. Built with love using{" "}
        <a
          href="https://github.com/ABHILASH9519/cloudsentinels"
          className="text-primary hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          CloudSentinels
        </a>
      </p>
    </div>
  );
}
