import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/services/api";
import type { ParticipationState } from "@/types/participations";
export const participationStates: Record<ParticipationState, string> = {
  received: "Recebida",
  reviewed: "Revisada",
  selected: "Selecionada",
  rejected: "Rejeitada",
};
export function isParticipationAccessError(error: unknown) {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}
export function clearParticipationCache(
  client: QueryClient,
  scope: readonly string[],
) {
  void client.cancelQueries({ queryKey: scope });
  client.removeQueries({ queryKey: scope });
  for (const mutation of client
    .getMutationCache()
    .findAll({ mutationKey: scope }))
    client.getMutationCache().remove(mutation);
}
