export function LoadingBlock() {
  return (
    <div className="space-y-3" aria-label="Carregando conteúdo">
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-20 animate-pulse rounded-xl border border-genesis-border bg-genesis-surface"
        />
      ))}
    </div>
  );
}
