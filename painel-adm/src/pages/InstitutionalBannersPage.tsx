import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadingBlock } from "@/components/ui/LoadingBlock";
import { api, ApiError } from "@/services/api";
import type { InstitutionalBanner } from "@/types/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { validateInstitutionalBannerFile } from "@/features/institutional-banners/banner-file";

const bannerErrorMessages: Record<string, string> = {
  INVALID_IMAGE_TYPE: "Selecione uma imagem JPEG, PNG, WebP ou AVIF válida.",
  INVALID_IMAGE: "A imagem está corrompida ou não pôde ser processada.",
  IMAGE_TOO_LARGE: "A imagem deve ter no máximo 10 MiB.",
  FILE_REQUIRED: "Selecione uma imagem antes de salvar o banner.",
  MEDIA_PUBLIC_URL_NOT_CONFIGURED: "Configure R2_PUBLIC_BASE_URL para gerar a URL pública do banner.",
  MEDIA_STORAGE_NOT_CONFIGURED: "O armazenamento R2 não está configurado neste ambiente. Revise MEDIA_STORAGE_DRIVER, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_PUBLIC_BASE_URL no Vercel.",
  R2_UPLOAD_FAILED: "O R2 recusou o upload. Verifique bucket, permissões da Access Key e Account ID no Vercel.",
};

function getR2DiagnosticSuffix(error: ApiError) {
  if (error.code !== "R2_UPLOAD_FAILED" && error.code !== "R2_DELETE_FAILED") {
    return "";
  }

  const details = error.details ?? {};
  const providerCode = typeof details.providerCode === "string" ? details.providerCode : null;
  const errorName = typeof details.errorName === "string" ? details.errorName : null;
  const httpStatusCode = typeof details.httpStatusCode === "number" ? details.httpStatusCode : null;
  const requestId = typeof details.requestId === "string" ? details.requestId : null;
  const diagnostics = [
    providerCode || errorName ? `R2: ${providerCode || errorName}` : null,
    httpStatusCode ? `HTTP ${httpStatusCode}` : null,
    requestId ? `request ${requestId}` : null,
  ].filter(Boolean);

  return diagnostics.length ? ` (${diagnostics.join(" · ")})` : "";
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return `${bannerErrorMessages[error.code] ?? error.message}${getR2DiagnosticSuffix(error)}`;
  }
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

export function InstitutionalBannersPage() {
  usePageTitle("Banners institucionais");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<InstitutionalBanner | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const bannersQuery = useQuery({
    queryKey: ["institutional-banners"],
    queryFn: api.listInstitutionalBanners,
  });
  const storageQuery = useQuery({
    queryKey: ["institutional-banner-storage"],
    queryFn: api.checkInstitutionalBannerStorage,
    retry: false,
  });
  const items = useMemo(() => bannersQuery.data?.items ?? [], [bannersQuery.data]);
  const storage = storageQuery.data?.storage;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["institutional-banners"] });

  const reorderMutation = useMutation({
    mutationFn: api.reorderInstitutionalBanners,
    onSuccess: async () => {
      await refresh();
      toast.success("Ordem dos banners atualizada.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.setInstitutionalBannerActive(id, active),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteInstitutionalBanner,
    onSuccess: async () => {
      await refresh();
      toast.success("Banner removido.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const writeCheckMutation = useMutation({
    mutationFn: api.checkInstitutionalBannerStorageWrite,
    onSuccess: (result) => {
      toast.success(
        `Escrita no R2 validada em ${result.writeCheck.bucketName}/${result.writeCheck.objectPrefix}.`,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const ids = items.map(({ id }) => id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMutation.mutate(ids);
  };

  const dropOn = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const ids = items.map(({ id }) => id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDraggedId(null);
    reorderMutation.mutate(ids);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <PageHeader
          eyebrow="Site institucional"
          title="Banners institucionais"
          description="Gerencie as imagens promocionais do Hero. O banner branco da Rádio 88 FM permanece fixo e não pode ser removido."
          actions={
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4" />
              Novo banner
            </Button>
          }
        />

        <div className="rounded-xl border border-genesis-border bg-indigo-50 p-4 text-sm text-genesis-muted">
          As imagens são otimizadas pela API e armazenadas no Cloudflare R2. Formatos aceitos: JPEG, PNG, WebP e AVIF, até 10 MiB.
        </div>

        {storageQuery.isError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Não foi possível validar a configuração do R2: {errorMessage(storageQuery.error)}
          </div>
        ) : storage && !storage.ready ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            R2 incompleto neste ambiente. Confirme MEDIA_STORAGE_DRIVER=r2, credenciais, R2_PUBLIC_BASE_URL, bucket e prefixo nas Environment Variables do Vercel.
          </div>
        ) : storage?.ready ? (
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
            <span>
              R2 configurado para o bucket <span className="font-mono">{storage.bucketName}</span> em <span className="font-mono">{storage.objectPrefix}</span>.
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => writeCheckMutation.mutate()}
              disabled={writeCheckMutation.isPending}
            >
              {writeCheckMutation.isPending ? "Testando..." : "Testar escrita R2"}
            </Button>
          </div>
        ) : null}

        {bannersQuery.isLoading ? (
          <LoadingBlock />
        ) : bannersQuery.isError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-genesis-error">
            Não foi possível carregar os banners.
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ImagePlus}
            title="Nenhum banner promocional"
            description="Adicione o primeiro banner. O slide branco continuará sendo o primeiro do carrossel."
          />
        ) : (
          <section className="space-y-3" aria-label="Ordem dos banners">
            {items.map((banner, index) => (
              <article
                key={banner.id}
                draggable
                onDragStart={() => setDraggedId(banner.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropOn(banner.id)}
                className="grid gap-4 rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm transition hover:border-genesis-primary/30 sm:grid-cols-[220px_1fr_auto] sm:items-center"
              >
                <div className="aspect-video overflow-hidden rounded-lg bg-genesis-bg">
                  {banner.imageUrl ? (
                    <img
                      src={banner.imageUrl}
                      alt={banner.altText}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-genesis-muted">
                      CDN ainda não configurado
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-genesis-muted">
                      #{banner.displayOrder}
                    </span>
                    <Badge tone={banner.active ? "green" : "gray"}>
                      {banner.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <h2 className="mt-2 font-display text-lg font-semibold text-genesis-text">
                    {banner.title}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm text-genesis-muted">
                    {banner.altText}
                  </p>
                  {banner.objectKey && (
                    <p className="mt-2 break-all font-mono text-xs text-genesis-muted">
                      {banner.objectKey}
                    </p>
                  )}
                  {banner.destinationUrl && (
                    <a
                      href={banner.destinationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-genesis-primary"
                    >
                      Ver destino <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 sm:max-w-[220px] sm:justify-end">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Mover para cima"
                    disabled={index === 0 || reorderMutation.isPending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Mover para baixo"
                    disabled={index === items.length - 1 || reorderMutation.isPending}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setEditing(banner); setDialogOpen(true); }}
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </Button>
                  <Button
                    variant={banner.active ? "secondary" : "primary"}
                    onClick={() => toggleMutation.mutate({ id: banner.id, active: !banner.active })}
                  >
                    {banner.active ? "Desativar" : "Ativar"}
                  </Button>
                  <Button
                    variant="danger"
                    size="icon"
                    aria-label="Remover banner"
                    onClick={() => {
                      if (window.confirm("Remover este banner?")) {
                        deleteMutation.mutate(banner.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>

      {dialogOpen && (
        <BannerDialog
          open
          banner={editing}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditing(null);
          }}
          onSaved={async () => {
            await refresh();
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      )}
    </AppShell>
  );
}

function BannerDialog({
  open,
  banner,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  banner: InstitutionalBanner | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(banner?.title ?? "");
  const [altText, setAltText] = useState(banner?.altText ?? "");
  const [destinationUrl, setDestinationUrl] = useState(banner?.destinationUrl ?? "");
  const [openInNewTab, setOpenInNewTab] = useState(banner?.openInNewTab ?? false);
  const [active, setActive] = useState(banner?.active ?? false);
  const [file, setFile] = useState<File | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let mediaAssetId = banner?.mediaAssetId;
      if (file) {
        mediaAssetId = (await api.uploadInstitutionalBannerAsset(file)).id;
      }

      const baseInput = {
        title,
        altText,
        placementKey: "home_hero",
        destinationUrl: destinationUrl || null,
        openInNewTab,
        active,
      };

      if (!mediaAssetId) throw new Error("Selecione uma imagem.");

      const input = {
        ...baseInput,
        mediaAssetId,
      };
      return banner
        ? api.updateInstitutionalBanner(banner.id, input)
        : api.createInstitutionalBanner(input);
    },
    onSuccess: async () => {
      toast.success(banner ? "Banner atualizado." : "Banner criado.");
      await onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !altText.trim() || (!banner && !file)) {
      toast.error("Preencha título, texto alternativo e imagem.");
      return;
    }
    if (file) {
      const validationError = validateInstitutionalBannerFile(file);
      if (validationError) {
        toast.error(validationError);
        return;
      }
    }
    saveMutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={banner ? "Editar banner" : "Novo banner"}
      description="O banner branco principal não é editável por esta tela."
    >
      <form className="space-y-5" onSubmit={submit}>
        <label className="block text-sm font-semibold text-genesis-text">
          Título
          <Input className="mt-2" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </label>
        <label className="block text-sm font-semibold text-genesis-text">
          Texto alternativo
          <Input className="mt-2" value={altText} onChange={(e) => setAltText(e.target.value)} maxLength={220} />
          <span className="mt-1 block text-xs font-normal text-genesis-muted">
            Descreva objetivamente a imagem para leitores de tela.
          </span>
        </label>
        <label className="block text-sm font-semibold text-genesis-text">
          Link de destino (opcional)
          <Input
            className="mt-2"
            type="url"
            placeholder="https://..."
            value={destinationUrl}
            onChange={(e) => setDestinationUrl(e.target.value)}
          />
        </label>
        <label className="block text-sm font-semibold text-genesis-text">
          {banner ? "Substituir imagem (opcional)" : "Imagem"}
          <Input
            className="mt-2"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="mt-1 block text-xs font-normal text-genesis-muted">
            Upload pelo painel otimiza e publica a imagem no Cloudflare R2. O novo banner será adicionado ao final da ordem atual.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-lg border border-genesis-border p-3 text-sm font-semibold">
            <input type="checkbox" checked={openInNewTab} onChange={(e) => setOpenInNewTab(e.target.checked)} />
            Abrir link em nova aba
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-genesis-border p-3 text-sm font-semibold">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Publicar banner
          </label>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-genesis-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Salvando..." : "Salvar banner"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
