import { NavLink } from "react-router-dom";
import { CalendarDays, ListChecks } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";

const calendarPermissions = [
  "calendar_integration.read",
  "calendar_integration.manage",
  "calendar_integration.sync",
] as const;

export function PollAreaNavigation() {
  const { user } = useAuth();
  const canReadCalendar = calendarPermissions.some((permission) => hasPermission(user, permission));
  const canReadManagement = ["poll.read", "poll.results.read", "participation.read"]
    .some((permission) => hasPermission(user, permission));

  return (
    <nav aria-label="Seções de enquetes" className="-mt-2 flex flex-wrap items-center gap-1 border-b border-border">
      {canReadCalendar && (
        <NavLink
          to="/enquetes/calendario"
          className={({ isActive }) => `inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <CalendarDays aria-hidden="true" data-icon="inline-start" className="size-4" />
          Calendário
        </NavLink>
      )}
      {canReadManagement && (
        <NavLink
          to="/enquetes/gestao"
          className={({ isActive }) => `inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <ListChecks aria-hidden="true" data-icon="inline-start" className="size-4" />
          Gestão
        </NavLink>
      )}
    </nav>
  );
}
