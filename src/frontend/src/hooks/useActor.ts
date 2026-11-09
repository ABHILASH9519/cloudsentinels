import { useAwsActor } from "../aws/useAwsActor";

// Keep existing query and mutation hooks stable while changing their backend.
export function useActor() {
  return useAwsActor();
}
