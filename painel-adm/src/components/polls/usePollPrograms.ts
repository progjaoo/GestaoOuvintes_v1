import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import type { RadioProgram } from "@/types/programming";
export function usePollPrograms() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["polls", "program-options"],
    enabled: hasPermission(user, "program.read"),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const items: RadioProgram[] = [];
      let after: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await api.listPrograms(after);
        items.push(...page.items);
        after = page.nextCursor ?? undefined;
        if (after && seen.has(after))
          throw new Error("Cursor de programas repetido.");
        if (after) seen.add(after);
      } while (after);
      return items;
    },
  });
}
