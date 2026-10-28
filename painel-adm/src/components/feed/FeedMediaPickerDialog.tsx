import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileImage, Film, ImagePlus, RefreshCw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FeedMediaGuidance } from "@/components/feed/FeedMediaGuidance";
import { api, ApiError } from "@/services/api";
import type { EditorialMediaAsset } from "@/types/feed";

export type FeedMediaType = EditorialMediaAsset["mediaType"];

const labels: Record<FeedMediaType, string> = { image: "Imagem", gif: "GIF", video: "Vídeo MP4" };
const accepts: Record<FeedMediaType, string> = {
  image: "image/jpeg,image/png,image/webp,image/avif",
  gif: "image/gif",
  video: "video/mp4",
};

export function FeedMediaPickerDialog({
  open,
  onOpenChange,
  allowedTypes,
  onSelect,
  selectable = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowedTypes: FeedMediaType[];
  onSelect: (asset: EditorialMediaAsset) => void;
  selectable?: boolean;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingName, setUploadingName] = useState("");
  const assets = useQuery({
    queryKey: ["feed-assets", allowedTypes.join(",")],
    queryFn: () => api.listFeedAssets({ page: 1, pageSize: 50 }),
    enabled: open,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const kind = mediaTypeFor(file);
      if (!kind || !allowedTypes.includes(kind)) throw new Error(`Este campo aceita: ${allowedTypes.map((type) => labels[type]).join(", ")}.`);
      uploadController.current = new AbortController();
      setUploadingName(file.name);
      setUploadProgress(0);
      return api.uploadFeedAsset(file, kind, setUploadProgress, uploadController.current.signal);
    },
    onSuccess: async (asset) => {
      toast.success(`${labels[asset.mediaType]} enviada e validada. Agora você pode usar a mídia.`);
      await queryClient.invalidateQueries({ queryKey: ["feed-assets"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : error.message || "Não foi possível enviar a mídia."),
    onSettled: () => {
      uploadController.current = null;
      setUploadProgress(null);
      setUploadingName("");
    },
  });

  const visible = (assets.data?.items ?? []).filter((asset) => allowedTypes.includes(asset.mediaType));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && upload.isPending) uploadController.current?.abort();
        onOpenChange(next);
      }}
      title="Biblioteca de mídia"
      description={`Escolha uma mídia validada ou envie um novo arquivo: ${allowedTypes.map((type) => labels[type]).join(", ")}.`}
      className="sm:max-w-5xl"
      footer={<Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>}
    >
      <div className="space-y-5">
        <div className="flex flex-col justify-between gap-3 rounded-lg border border-genesis-border bg-neutral-50 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="font-semibold text-genesis-text">Adicionar arquivo</p>
            <p className="mt-1 text-xs leading-5 text-genesis-muted">Imagem até 10 MB · GIF até 10 MB/15 s · MP4 até 50 MB/120 s. O arquivo vai primeiro para o bucket privado de Preview.</p>
            <div className="mt-3"><FeedMediaGuidance /></div>
          </div>
          <div className="flex shrink-0 gap-2">
            <input ref={inputRef} type="file" accept={allowedTypes.map((type) => accepts[type]).join(",")} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.currentTarget.value = ""; }} />
            <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}><Upload size={16} /> Enviar mídia</Button>
            {upload.isPending && <Button variant="outline" onClick={() => uploadController.current?.abort()}><X size={16} /> Cancelar</Button>}
          </div>
          {upload.isPending && (
            <div className="w-full sm:col-span-2" role="status" aria-live="polite">
              <div className="mb-1 flex justify-between gap-3 text-xs text-genesis-muted"><span className="truncate">{uploadingName}</span><span>{uploadProgress ?? 0}%</span></div>
              <progress className="h-2 w-full accent-genesis-primary" max={100} value={uploadProgress ?? 0} aria-label="Progresso do envio" />
              {uploadProgress === 100 && <p className="mt-1 text-xs text-genesis-muted">Upload concluído; verificando formato e integridade do arquivo…</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div><h3 className="font-display text-lg font-bold text-genesis-text">Arquivos prontos</h3><p className="text-sm text-genesis-muted">{visible.length} mídia(s) compatível(is) nesta página</p></div>
          <Button variant="outline" size="sm" onClick={() => void assets.refetch()} disabled={assets.isFetching}><RefreshCw size={15} className={assets.isFetching ? "animate-spin" : ""} /> Atualizar</Button>
        </div>

        {assets.isLoading ? <p role="status" className="py-12 text-center text-sm text-genesis-muted">Carregando biblioteca…</p> : assets.isError ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Não foi possível abrir a biblioteca. Atualize a lista ou verifique sua permissão `feed.media.manage`.</div> : visible.length === 0 ? <div className="rounded-lg border border-dashed border-genesis-border px-5 py-12 text-center"><ImagePlus className="mx-auto text-genesis-muted" /><p className="mt-3 font-semibold text-genesis-text">Nenhuma mídia compatível ainda</p><p className="mt-1 text-sm text-genesis-muted">Envie uma imagem, GIF ou vídeo para começar.</p></div> : (
          <div className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((asset) => <MediaCard key={asset.id} asset={asset} selectable={selectable} onSelect={selectable ? () => { onSelect(asset); onOpenChange(false); } : undefined} />)}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function MediaCard({ asset, onSelect, selectable }: { asset: EditorialMediaAsset; onSelect?: () => void; selectable: boolean }) {
  const isVisual = asset.mediaType !== "video";
  const content = <>
      <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100">
        {isVisual && asset.previewUrl ? <img src={asset.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" /> : <div className="grid h-full place-items-center text-genesis-muted">{asset.mediaType === "video" ? <Film size={30} /> : <FileImage size={30} />}</div>}
        <span className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">{labels[asset.mediaType]}</span>
        {asset.status !== "ready" && <span className="absolute inset-0 grid place-items-center bg-white/70 text-xs font-semibold text-neutral-700">{asset.status === "rejected" ? "Rejeitada" : "Validando"}</span>}
      </div>
      <div className="p-3"><p className="truncate text-sm font-semibold text-genesis-text">{asset.originalName ?? "Mídia sem nome"}</p><p className="mt-1 text-xs text-genesis-muted">{formatBytes(asset.byteSize)}{asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ""}</p></div>
    </>;
  return selectable ? <button type="button" onClick={onSelect} disabled={asset.status !== "ready"} className="group overflow-hidden rounded-lg border border-genesis-border bg-white text-left transition hover:border-genesis-primary hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-genesis-primary disabled:cursor-not-allowed disabled:opacity-60">{content}</button> : <div className="overflow-hidden rounded-lg border border-genesis-border bg-white">{content}</div>;
}

function mediaTypeFor(file: File): FeedMediaType | null {
  if (file.type === "image/gif") return "gif";
  if (file.type === "video/mp4") return "video";
  if (["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) return "image";
  return null;
}

function formatBytes(value: number) {
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
