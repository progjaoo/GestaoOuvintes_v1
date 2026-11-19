export type PollState =
  "draft" | "scheduled" | "published" | "closed" | "archived" | "canceled";
export type PollAction = "publish" | "close" | "archive" | "cancel";
export type PollMode = "vote" | "message" | "mixed";
export interface PollInput {
  mode: PollMode;
  imageUrl?: string;
  slug: string;
  question: string;
  context: string;
  identificationPolicy: "anonymous" | "optional" | "required";
  allowMessage: boolean;
  options: string[];
  editionStartsAt: string;
  editionEndsAt: string;
  startsAt: string;
  endsAt: string;
}
export interface Poll extends Omit<PollInput, "options"> {
  id: string;
  programId: string;
  programName: string;
  options: { id: string; text: string }[];
  state: PollState;
  version: number;
  totalVotes: number;
}
export interface PollResults {
  totalVotes: number;
  options: { id: string; text: string; votes: number; percentage: number }[];
}
