"use client";

import {
  hashKey,
  keepPreviousData,
  skipToken,
  useQuery,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  type PreloadedWorkspaceAvailability,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import { loadWorkspaceAvailability } from "@/features/reservation/workspace-availability-client";

type UseReservationAvailabilityOptions = {
  readonly debounceMs?: number;
  /** Server-loaded availability, used only for a query it was loaded for. */
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly keepPreviousData?: boolean;
  readonly replacementToken?: string;
};

const useDebouncedAvailabilityQuery = (
  query: WorkspaceAvailabilityQuery | undefined,
  debounceMs: number
) => {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    if (debounceMs <= 0 || query === debouncedQuery) return;

    const timeout = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timeout);
  }, [debounceMs, debouncedQuery, query]);

  return debounceMs > 0
    ? {
        isDebouncing: query !== debouncedQuery,
        query: debouncedQuery,
      }
    : { isDebouncing: false, query };
};

// Matches by the query key hash, the identity TanStack Query caches under.
const findPreloadedAvailability = (
  initialAvailability: ReadonlyArray<PreloadedWorkspaceAvailability> = [],
  query: WorkspaceAvailabilityQuery
) => {
  const queryHash = hashKey([query]);
  return initialAvailability.find(
    (preloaded) => hashKey([preloaded.query]) === queryHash
  );
};

export function useReservationAvailability(
  query: WorkspaceAvailabilityQuery | undefined,
  options: UseReservationAvailabilityOptions = {}
) {
  const debounced = useDebouncedAvailabilityQuery(
    query,
    options.debounceMs ?? 0
  );
  const availabilityQuery = debounced.query;
  const preloaded = availabilityQuery
    ? findPreloadedAvailability(options.initialAvailability, availabilityQuery)
    : undefined;
  const result = useQuery<WorkspaceAvailability>({
    queryKey: availabilityQuery
      ? [
          ...workspaceAvailabilityKeys.availability(availabilityQuery),
          options.replacementToken ?? null,
        ]
      : ["workspace-availability", "empty"],
    queryFn: availabilityQuery
      ? ({ signal }) =>
          loadWorkspaceAvailability({
            query: availabilityQuery,
            signal,
            replacementToken: options.replacementToken,
          })
      : skipToken,
    initialData: preloaded?.availability,
    initialDataUpdatedAt: preloaded?.loadedAt,
    ...(options.keepPreviousData && { placeholderData: keepPreviousData }),
    retry: (failureCount) => failureCount < 3,
    staleTime: 30_000,
  });

  return {
    ...result,
    availability:
      result.isError || debounced.isDebouncing ? null : (result.data ?? null),
    isFetching: result.isFetching || debounced.isDebouncing,
    // Whether the current query still waits for a usable response:
    // debouncing, loading, showing a previous key's placeholder, or retrying
    // after a failure (an errored query keeps its error status while it
    // refetches stale data). A background refetch of successful data is not
    // pending, and an empty query never is.
    isPending:
      debounced.isDebouncing ||
      Boolean(
        availabilityQuery &&
          (result.isPending ||
            result.isPlaceholderData ||
            (result.isError && result.isFetching))
      ),
  };
}
