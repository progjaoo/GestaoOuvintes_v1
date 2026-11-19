export type ParticipationState =
  "received" | "reviewed" | "selected" | "rejected";
export type ModerationState = Exclude<ParticipationState, "received">;
export interface ProgramParticipation {
  id: string;
  programId: string;
  programName: string;
  pollId: string;
  pollQuestion: string;
  editionStartsAt: string;
  editionEndsAt: string;
  receivedAt: string;
  state: ParticipationState;
  version: number;
  displayName: string | null;
  neighborhood?: string | null;
  message: string;
  moderatedAt: string | null;
  moderationNote: string | null;
}
export type ParticipationListItem = Omit<
  ProgramParticipation,
  "message" | "moderationNote"
>;
export interface ParticipationFilters {
  programId?: string;
  pollId?: string;
  state?: string;
  after?: string;
}
export interface ParticipationModeration {
  version: number;
  state: ModerationState;
  note?: string;
}
