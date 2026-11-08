import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { backendInterface } from "../backend";
import { useClerkAuth } from "./useClerkAuth";

const ACTOR_QUERY_KEY = "actor";

function createGatewayActor(getToken: () => Promise<string | null>): backendInterface {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        return async (...args: unknown[]) => {
          const token = await getToken();
          if (!token) throw new Error("Your Clerk session has expired. Please sign in again.");

          const response = await fetch("/api/canister", {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify(
              { method: property, args },
              (_key, value) =>
                typeof value === "bigint"
                  ? { __bigint: value.toString() }
                  : value,
            ),
          });

          const text = await response.text();
          let payload: { result?: unknown; error?: string };
          try {
            payload = JSON.parse(text, (_key, value) => {
              if (
                value &&
                typeof value === "object" &&
                Object.keys(value).length === 1 &&
                typeof value.__bigint === "string" &&
                /^-?\\d+$/.test(value.__bigint)
              ) {
                return BigInt(value.__bigint);
              }
              return value;
            });
          } catch {
            throw new Error("The authenticated gateway returned an invalid response.");
          }

          if (!response.ok) {
            throw new Error(payload.error || `Canister request failed (${response.status}).`);
          }
          return payload.result;
        };
      },
    },
  ) as backendInterface;
}

export function useActor() {
  const { user, isLoaded, isSignedIn, getToken } = useClerkAuth();
  const queryClient = useQueryClient();

  const actorQuery = useQuery<backendInterface>({
    queryKey: [ACTOR_QUERY_KEY, user?.id ?? null],
    queryFn: async () => createGatewayActor(getToken),
    enabled: isLoaded && isSignedIn && !!user,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  useEffect(() => {
    if (actorQuery.data) {
      queryClient.invalidateQueries({
        predicate: (query) => !query.queryKey.includes(ACTOR_QUERY_KEY),
      });
    }
  }, [actorQuery.data, queryClient]);

  const actor = useMemo(
    () => (isSignedIn ? actorQuery.data ?? null : null),
    [isSignedIn, actorQuery.data],
  );

  return {
    actor,
    isFetching: !isLoaded || (isSignedIn && actorQuery.isFetching),
    error: actorQuery.error,
  };
}
