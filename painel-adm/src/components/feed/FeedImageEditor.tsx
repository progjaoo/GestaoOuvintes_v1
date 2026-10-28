import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { exportEditedImage, imageCrop } from "@/services/feed-image-edit";

export function FeedImageEditor({ file, initialRatio = "original", onCancel, onConfirm }: {
  file: File; initialRatio?: string; onCancel: () => void; onConfirm: (file: File) => void;
}) {
  const [url, setUrl] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState(initialRatio);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    // The object URL belongs to this effect, including StrictMode remounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const width = rotation % 180 ? size.height : size.width;
  const height = rotation % 180 ? size.width : size.height;
  const aspect = ratio === "original" ? (width / height || 1) : Number(ratio);
  const crop = width && height ? imageCrop(width, height, aspect, zoom, x, y) : null;
  const confirm = async () => {
    if (!image.current || !crop) return;
    setBusy(true); setError("");
    try { onConfirm(await exportEditedImage(image.current, file, rotation, crop, ratio === String(7 / 5) ? 1260 : 1920)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível editar a imagem."); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }} title="Editar imagem" description="Recorte, amplie e gire antes de enviar. Uma nova mídia será criada; o arquivo anterior não será alterado." className="sm:max-w-4xl" footer={<>
    <Button variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button>
    <Button variant="outline" disabled={busy} onClick={() => onConfirm(file)}>Enviar original</Button>
    <Button disabled={busy || !crop || Boolean(error)} onClick={() => void confirm()}>{busy ? "Preparando imagem…" : "Aplicar e enviar"}</Button>
  </>}>
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg bg-neutral-200 p-3">
        <div className="relative max-h-[50vh] w-full overflow-hidden bg-white" style={{ aspectRatio: aspect, maxWidth: `${50 * aspect}vh` }}>
          <img ref={image} src={url || undefined} alt="Prévia do recorte" onLoad={(event) => {
            const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
            if (w * h > 40_000_000) { setError("A imagem deve ter no máximo 40 megapixels."); return; }
            setSize({ width: w, height: h });
          }} onError={() => setError("Não foi possível abrir esta imagem no navegador. Tente PNG, JPEG ou WebP.")}
          className="pointer-events-none absolute max-w-none" style={crop ? {
            width: `${size.width / crop.width * 100}%`, height: `${size.height / crop.height * 100}%`,
            left: `${(width / 2 - crop.x) / crop.width * 100}%`, top: `${(height / 2 - crop.y) / crop.height * 100}%`,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          } : { opacity: 0 }} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">{Array.from({ length: 9 }, (_, at) => <span key={at} className="border border-white/30" />)}</div>
        </div>
      </div>
      <div className="space-y-4 text-sm text-genesis-text">
        <label className="block font-semibold">Proporção<select value={ratio} onChange={(event) => { setRatio(event.target.value); setZoom(1); setX(50); setY(50); }} className="mt-2 w-full rounded border p-2"><option value="original">Original</option><option value={String(7 / 5)}>Capa · 7:5 (1260 × 900)</option><option value={String(16 / 9)}>Abertura · 16:9 (1920 × 1080)</option><option value="1">Quadrada · 1:1</option></select></label>
        <label className="block">Ampliação · {zoom.toFixed(1)}×<input className="mt-2 w-full" aria-label="Ampliação" type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <label className="block">Posição horizontal<input className="mt-2 w-full" aria-label="Posição horizontal" type="range" min="0" max="100" value={x} onChange={(event) => setX(Number(event.target.value))} /></label>
        <label className="block">Posição vertical<input className="mt-2 w-full" aria-label="Posição vertical" type="range" min="0" max="100" value={y} onChange={(event) => setY(Number(event.target.value))} /></label>
        <Button variant="outline" onClick={() => { setRotation((value) => (value + 90) % 360); setX(50); setY(50); }}><RotateCw size={16} /> Girar 90°</Button>
        {crop && <p className="text-xs text-genesis-muted">Recorte de {Math.round(crop.width)} × {Math.round(crop.height)} px. A exportação não amplia arquivos pequenos.</p>}
      </div>
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </Dialog>;
}
