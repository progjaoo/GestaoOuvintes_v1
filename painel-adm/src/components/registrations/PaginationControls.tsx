import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Pagination } from "@/types/api";

export function PaginationControls({
  pagination,
  onPageChange,
}: {
  pagination: Pagination;
  onPageChange: (page: number) => void;
}) {
  if (pagination.totalPages <= 1) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-genesis-border bg-genesis-surface p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-center text-sm text-genesis-muted sm:text-left">
        Página <strong className="text-genesis-text">{pagination.page}</strong> de{" "}
        <strong className="text-genesis-text">{pagination.totalPages}</strong>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </Button>
        <Button
          variant="outline"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Próxima
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
