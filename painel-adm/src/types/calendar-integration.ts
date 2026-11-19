import type { PollInput } from "@/types/polls";

export interface CalendarOAuthStatus {
  connected: boolean;
  readOnly: true;
  scopes: string[];
  connectedAt: string | null;
}

export interface CalendarProgram {
  id: string;
  name: string;
}

export interface CalendarSource {
  id: string;
  calendarId: string;
  programId: string;
  programName: string;
  active: boolean;
  version: number;
  incrementalReady: boolean;
  allowedPrograms: CalendarProgram[];
  lastSyncAt: string | null;
}

export type StagedCalendarEventState = "review" | "conflict" | "canceled" | "invalid";
export type CalendarStageReason =
  | "INVALID_SOURCE"
  | "INVALID_EVENT"
  | "UNSUPPORTED_EVENT"
  | "UNSAFE_DESCRIPTION"
  | "INVALID_CONFIG"
  | "PROGRAM_UNAVAILABLE"
  | "EDITION_UNAVAILABLE"
  | "INVALID_WINDOW"
  | "INVALID_POLL";

export interface StagedCalendarEvent {
  id: string;
  eventId: string;
  state: StagedCalendarEventState;
  payload: { programId: string; poll: PollInput } | null;
  reason: CalendarStageReason | null;
  version: number;
  updatedAt: string;
  linkedPollId: string | null;
  linkedPollState: "draft" | "scheduled" | "published" | "closed" | "archived" | "canceled" | null;
  externalState: "active" | "canceled" | "review" | null;
}

export interface CalendarSyncResult {
  scanned: number;
  changed: number;
  pending: number;
  canceled: number;
  skippedPast: number;
  publication?: { scheduled: number; alreadyLinked: number; canceled: number; needsReview: number; failed: number };
  reviewRequired?: boolean;
  fullSyncRequired?: true;
  readOnly: true;
}

export type PollCalendarState = "review" | "scheduled" | "published" | "closed" | "archived" | "canceled" | "invalid" | "conflict";

export interface PollCalendarItem {
  id: string;
  title: string;
  programId: string | null;
  programName: string | null;
  startDate: string | null;
  endDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  origin: "google_calendar";
  importState: "review" | "conflict" | "canceled" | "invalid";
  state: PollCalendarState;
  reason: CalendarStageReason | null;
  linkedPollId: string | null;
  pollState: PollCalendarState | null;
  updatedAt: string;
}

export interface PollCalendarResponse {
  items: PollCalendarItem[];
  nextCursor: string | null;
  from: string;
  to: string;
  timezone: "America/Sao_Paulo";
  readOnly: true;
  configured: boolean;
  connected: boolean;
  lastSyncedAt: string | null;
}
