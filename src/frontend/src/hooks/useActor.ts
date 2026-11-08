import { useMemo } from "react";
import type { backendInterface } from "../backend";
import { useClerkAuth } from "./useClerkAuth";

function createGatewayActor(
  getToken: () => Promise<string | null>,
): backendInterface {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || property === "then") {
          return undefined;
        }
        return async (...args: unknown[]) => {
          const token = await getToken();
          if (!token)
            throw new Error(
              "Your Clerk session has expired. Please sign in again.",
            );

          const response = await fetch("/api/canister", {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({ method: property, args }, (_key, value) =>
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
            throw new Error(
              "The authenticated gateway returned an invalid response.",
            );
          }

          if (!response.ok) {
            throw new Error(
              payload.error || `Canister request failed (${response.status}).`,
            );
          }
          return payload.result;
        };
      },
    },
  ) as backendInterface;
}

export function useActor() {
  const { user, isLoaded, isSignedIn, getToken, error } = useClerkAuth();
  const userId = user?.id;

  const actor = useMemo(
    () =>
      isLoaded && isSignedIn && userId ? createGatewayActor(getToken) : null,
    [getToken, isLoaded, isSignedIn, userId],
  );

  return {
    actor,
    isFetching: !isLoaded,
    error,
  };
}
