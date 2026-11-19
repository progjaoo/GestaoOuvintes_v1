import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearParticipationCache,
  isParticipationAccessError,
} from "@/components/participations/participation-utils";

export function usePrivatePollQuery<T>({
  actorId,
  pollId,
  kind,
  after = "",
  queryFn,
}: {
  actorId: string;
  pollId: string;
  kind: "results" | "messages";
  after?: string;
  queryFn: (signal: AbortSignal) => Promise<T>;
}) {
  const client = useQueryClient();
  const [accessError, setAccessError] = useState<Error | null>(null);
  const scope = useMemo(
    () => ["poll-private", actorId, pollId, kind],
    [actorId, pollId, kind],
  );
  useEffect(
    () => () => clearParticipationCache(client, scope),
    [client, scope],
  );
  const query = useQuery({
    queryKey: [...scope, after],
    enabled: !accessError,
    gcTime: 0,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        return await queryFn(signal);
      } catch (error) {
        if (!signal.aborted && isParticipationAccessError(error)) {
          setAccessError(error as Error);
          clearParticipationCache(client, scope);
        }
        throw error;
      }
    },
  });
  return { query, accessError };
}
