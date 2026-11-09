import { useAwsActor } from "../aws/useAwsActor";

// Keep the existing query/mutation hooks stable while switching the backing
// implementation from an ICP actor to the authenticated AWS API adapter.
export function useActor() {
  return useAwsActor();
}
